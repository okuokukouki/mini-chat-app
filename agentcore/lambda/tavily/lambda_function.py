# AgentCore Gateway のターゲット Lambda 関数。
# tavily_search / tavily_extract の 2 ツールをルーティングして処理する。
# ツール名は context.client_context.custom.bedrockAgentCoreToolName から取得する。

import json
import os

import boto3
import requests


def _get_api_key(params: dict) -> str:
    """Tavily API キーを取得する（Secrets Manager → 環境変数の優先順）"""
    # ユーザー指定のキーがあれば最優先
    user_keys = params.get("__user_api_keys", {})
    if user_keys.get("tavily_api_key"):
        return user_keys["tavily_api_key"]

    # Secrets Manager から取得
    secret_name = os.environ.get("TAVILY_API_KEY_SECRET_NAME")
    if secret_name:
        client = boto3.client("secretsmanager")
        response = client.get_secret_value(SecretId=secret_name)
        secret = response.get("SecretString", "")
        try:
            return json.loads(secret).get("TAVILY_API_KEY", secret)
        except json.JSONDecodeError:
            return secret

    # 環境変数フォールバック（ローカルテスト用）
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        raise ValueError("Tavily API キーが見つかりません")
    return api_key


def tavily_search(params: dict) -> dict:
    """Tavily の Web 検索を実行する"""
    api_key = _get_api_key(params)
    query = params.get("query", "")
    search_depth = params.get("search_depth", "basic")
    topic = params.get("topic", "general")

    response = requests.post(
        "https://api.tavily.com/search",
        json={
            "api_key": api_key,
            "query": query,
            "search_depth": search_depth,
            "topic": topic,
            "max_results": 5,
            "include_images": False,
            "include_raw_content": False,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()

    results = data.get("results", [])
    lines = []
    for r in results:
        lines.append(f"## {r.get('title', '')}")
        lines.append(f"URL: {r.get('url', '')}")
        lines.append(r.get("content", ""))
        lines.append("")
    text = "\n".join(lines) if lines else "(結果なし)"

    return {
        "statusCode": 200,
        "body": {"content": [{"type": "text", "text": text}]},
    }


def tavily_extract(params: dict) -> dict:
    """指定 URL からコンテンツを抽出する"""
    api_key = _get_api_key(params)
    urls_raw = params.get("urls", "")
    urls = [u.strip() for u in urls_raw.split(",") if u.strip()]
    extract_depth = params.get("extract_depth", "basic")

    response = requests.post(
        "https://api.tavily.com/extract",
        json={
            "api_key": api_key,
            "urls": urls,
            "extract_depth": extract_depth,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()

    results = data.get("results", [])
    lines = []
    for r in results:
        lines.append(f"## {r.get('url', '')}")
        lines.append(r.get("raw_content", ""))
        lines.append("")
    text = "\n".join(lines) if lines else "(結果なし)"

    return {
        "statusCode": 200,
        "body": {"content": [{"type": "text", "text": text}]},
    }


def lambda_handler(event, context):
    """Lambda エントリポイント。ツール名に応じて処理を分岐する"""
    try:
        # Gateway が bedrockAgentCoreToolName を client_context.custom に渡す
        tool_name = ""
        if context and context.client_context and context.client_context.custom:
            tool_name = context.client_context.custom.get("bedrockAgentCoreToolName", "")

        # "tavily-search___tavily_search" → "tavily_search"
        if "___" in tool_name:
            tool_name = tool_name.split("___")[-1]

        params = event if isinstance(event, dict) else {}

        if tool_name == "tavily_search":
            return tavily_search(params)
        elif tool_name == "tavily_extract":
            return tavily_extract(params)
        else:
            return {
                "statusCode": 400,
                "body": {"error": f"未知のツール名: {tool_name}"},
            }
    except Exception as e:
        return {
            "statusCode": 500,
            "body": {"error": str(e)},
        }
