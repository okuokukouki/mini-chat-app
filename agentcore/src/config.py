# プロジェクト共通設定。AWSリージョン等を一元管理する。

import os

REGION = "us-east-1"
GATEWAY_ENDPOINT = os.environ.get("GATEWAY_ENDPOINT", "")

# AgentCore Identity / OAuth 関連
COGNITO_JWT = os.environ.get("COGNITO_JWT", "")
MCP_OAUTH2_CALLBACK_URL = os.environ.get("MCP_OAUTH2_CALLBACK_URL", "http://localhost:8080/oauth-complete")
ELICITATION_MODE = os.environ.get("ELICITATION_MODE", "in_memory")  # in_memory | dynamodb
DYNAMODB_TOKEN_VAULT_TABLE = os.environ.get("DYNAMODB_TOKEN_VAULT_TABLE", "")
