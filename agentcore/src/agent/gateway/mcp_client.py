# AgentCore Gateway の MCP エンドポイントを SigV4 署名付きで呼び出すクライアント。
# tools/call メソッドを使って Gateway Target の Lambda 関数を経由する。

import json
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials


class FilteredMCPClient:
    """SigV4 署名付きで AgentCore Gateway を呼び出す MCP クライアント"""

    def __init__(self, gateway_endpoint: str, region: str):
        self.gateway_endpoint = gateway_endpoint.rstrip("/")
        self.region = region

    def _sign_request(self, method: str, url: str, body: bytes) -> dict:
        """SigV4 署名を施したリクエストヘッダーを返す"""
        session = boto3.Session()
        credentials = session.get_credentials().get_frozen_credentials()

        aws_request = AWSRequest(
            method=method,
            url=url,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        SigV4Auth(credentials, "bedrock-agentcore", self.region).add_auth(aws_request)
        return dict(aws_request.headers)

    def call_tool(self, tool_name: str, tool_input: dict, timeout: int = 360) -> str:
        """Gateway 経由でツールを呼び出し、結果テキストを返す"""
        url = f"{self.gateway_endpoint}"
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": tool_input,
                },
            }
        ).encode("utf-8")

        headers = self._sign_request("POST", url, payload)

        response = httpx.post(url, content=payload, headers=headers, timeout=timeout)
        response.raise_for_status()

        data = response.json()

        # MCP レスポンスから text コンテンツを抽出
        if "result" in data:
            contents = data["result"].get("content", [])
            texts = [c.get("text", "") for c in contents if c.get("type") == "text"]
            return "\n".join(texts) if texts else str(data["result"])

        if "error" in data:
            return f"Gateway エラー: {data['error']}"

        return str(data)
