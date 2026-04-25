# プロジェクト共通設定。AWSリージョン等を一元管理する。

import os

REGION = "us-east-1"
GATEWAY_ENDPOINT = os.environ.get("GATEWAY_ENDPOINT", "")
