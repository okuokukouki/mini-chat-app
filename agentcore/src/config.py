# プロジェクト共通設定。AWSリージョン等を一元管理する。

import os

REGION = "us-east-1"


def _load_gateway_endpoint() -> str:
    """GATEWAY_ENDPOINT を環境変数 → SSM の順に読み込む。
    クラウド Runtime では環境変数が設定されないため SSM から取得する。
    """
    env_val = os.environ.get("GATEWAY_ENDPOINT", "")
    if env_val:
        return env_val
    try:
        import boto3
        ssm = boto3.client("ssm", region_name=REGION)
        resp = ssm.get_parameter(Name="/mini-chat-app/gateway-endpoint")
        return resp["Parameter"]["Value"]
    except Exception:
        return ""


GATEWAY_ENDPOINT = _load_gateway_endpoint()

# CORS 許可オリジン（カンマ区切りで複数指定可）
# デフォルトは * （クラウド Runtime はソースが JWT で保護されているため許容）
# ローカル開発では ALLOWED_ORIGINS=http://localhost:3000 を .env で設定することで絞り込み可
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

# AgentCore Identity / OAuth 関連
COGNITO_JWT = os.environ.get("COGNITO_JWT", "")
MCP_OAUTH2_CALLBACK_URL = os.environ.get("MCP_OAUTH2_CALLBACK_URL", "http://localhost:8080/oauth-complete")
ELICITATION_MODE = os.environ.get("ELICITATION_MODE", "in_memory")  # in_memory | dynamodb
DYNAMODB_TOKEN_VAULT_TABLE = os.environ.get("DYNAMODB_TOKEN_VAULT_TABLE", "")
