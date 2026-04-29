# MCPRuntimeClient: OAuth 認証が必要なスキルのツール呼び出しを担当するクライアント。
# ELICITATION_MODE=in_memory（ローカル）ではモックデータを返す。
# ELICITATION_MODE=dynamodb（クラウド）では AgentCore Identity でトークンを取得し Gmail API を呼び出す。

import asyncio
import base64
import concurrent.futures
import contextvars
import json
import urllib.parse
import urllib.request
from typing import Optional

from config import ELICITATION_MODE, MCP_OAUTH2_CALLBACK_URL, REGION
from agent.mcp.elicitation_bridge import get_bridge


class MCPRuntimeClient:
    """OAuth 認証が必要なスキルのツールを実行するクライアント。"""

    def __init__(self, provider_name: str, scopes: list[str]):
        self.provider_name = provider_name
        self.scopes = scopes

    def call_tool(self, tool_name: str, params: dict) -> str:
        """ツールを実行して結果を返す。ローカルではモックデータを返す。"""
        if ELICITATION_MODE == "in_memory":
            return self._call_mock(tool_name, params)
        return self._call_real(tool_name, params)

    # --- モック実装（ローカル開発用） ---

    def _call_mock(self, tool_name: str, params: dict) -> str:
        if tool_name == "list_emails":
            return json.dumps([
                {"id": "mock-001", "subject": "テストメール 1", "from": "sender1@example.com", "date": "2026-04-26"},
                {"id": "mock-002", "subject": "テストメール 2", "from": "sender2@example.com", "date": "2026-04-25"},
            ], ensure_ascii=False)
        if tool_name == "search_emails":
            query = params.get("query", "")
            return json.dumps([
                {"id": "mock-003", "subject": f"検索結果: {query}", "from": "result@example.com",
                 "date": "2026-04-24", "snippet": "これはモック検索結果です。"},
            ], ensure_ascii=False)
        if tool_name == "read_email":
            message_id = params.get("message_id", "unknown")
            return json.dumps({
                "subject": "テストメール", "from": "sender@example.com",
                "to": "me@example.com", "date": "2026-04-26",
                "body": f"これは {message_id} のモック本文です。",
            }, ensure_ascii=False)
        return json.dumps({"error": f"未知のツール: {tool_name}"})

    # --- クラウド実装 ---

    def _get_oauth_token(self) -> str:
        """AgentCore Identity 経由で OAuth アクセストークンを取得する。
        Strands は asyncio.to_thread でツールを呼び出すため、ここは別スレッド上で実行される。
        さらに別スレッドプールで asyncio.run() を呼び、worker loop への干渉を避ける。
        """
        from bedrock_agentcore.runtime import BedrockAgentCoreContext
        from bedrock_agentcore.services.identity import IdentityClient

        bridge = get_bridge()

        def on_auth_url(url: str) -> None:
            if bridge:
                bridge.emit_oauth_url(url)

        agent_identity_token = BedrockAgentCoreContext.get_workload_access_token()
        if not agent_identity_token:
            raise RuntimeError("workload_access_token がセットされていません。Runtime 外で呼び出された可能性があります。")

        client = IdentityClient(REGION)

        async def _fetch() -> str:
            token = await client.get_token(
                provider_name=self.provider_name,
                scopes=self.scopes,
                agent_identity_token=agent_identity_token,
                on_auth_url=on_auth_url,
                auth_flow="USER_FEDERATION",
                callback_url=MCP_OAUTH2_CALLBACK_URL,
            )
            # トークン取得完了を SSE で通知
            if bridge:
                bridge.emit_oauth_complete()
            return token

        # worker loop とは別のスレッドで asyncio.run() を実行
        ctx = contextvars.copy_context()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(ctx.run, asyncio.run, _fetch())
            return future.result()

    def _call_real(self, tool_name: str, params: dict) -> str:
        """OAuth トークンを取得して Gmail API を呼び出す"""
        token = self._get_oauth_token()
        if tool_name == "list_emails":
            return _gmail_list_emails(token, **params)
        if tool_name == "search_emails":
            return _gmail_search_emails(token, **params)
        if tool_name == "read_email":
            return _gmail_read_email(token, **params)
        return json.dumps({"error": f"未知のツール: {tool_name}"})


# --- Gmail API ヘルパー ---

def _gmail_list_emails(access_token: str, label_ids: list = None, max_results: int = 10) -> str:
    """受信トレイのメール一覧を取得する"""
    label_ids = label_ids or ["INBOX"]
    params = urllib.parse.urlencode({"labelIds": label_ids, "maxResults": max_results}, doseq=True)
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?{params}"

    data = _gmail_get(url, access_token)
    messages = data.get("messages", [])
    return json.dumps([_fetch_message_detail(access_token, m["id"]) for m in messages], ensure_ascii=False)


def _gmail_search_emails(access_token: str, query: str, max_results: int = 10) -> str:
    """Gmail クエリ構文でメールを検索する"""
    params = urllib.parse.urlencode({"q": query, "maxResults": max_results})
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?{params}"

    data = _gmail_get(url, access_token)
    messages = data.get("messages", [])
    return json.dumps([_fetch_message_detail(access_token, m["id"]) for m in messages], ensure_ascii=False)


def _gmail_read_email(access_token: str, message_id: str) -> str:
    """指定 ID のメール本文を取得する"""
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}?format=full"
    msg = _gmail_get(url, access_token)

    headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
    body = _extract_body(msg.get("payload", {}))
    return json.dumps({
        "subject": headers.get("Subject", ""),
        "from": headers.get("From", ""),
        "to": headers.get("To", ""),
        "date": headers.get("Date", ""),
        "body": body,
    }, ensure_ascii=False)


def _fetch_message_detail(access_token: str, message_id: str) -> dict:
    """メッセージのメタデータ（件名・送信者・日付）を取得する"""
    params = urllib.parse.urlencode({
        "format": "metadata",
        "metadataHeaders": ["Subject", "From", "Date"],
    }, doseq=True)
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}?{params}"
    msg = _gmail_get(url, access_token)

    headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
    return {"id": message_id, "subject": headers.get("Subject", ""),
            "from": headers.get("From", ""), "date": headers.get("Date", "")}


def _gmail_get(url: str, access_token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _extract_body(payload: dict) -> str:
    """メール本文（テキスト）を再帰的に抽出する"""
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    for part in payload.get("parts", []):
        result = _extract_body(part)
        if result:
            return result
    return ""
