# 参照リポジトリ インフラ構成調査（CDK / Terraform）

**調査対象**: https://github.com/aws-samples/sample-strands-agent-with-agentcore  
**調査日**: 2026-04-26  
**関連 Spec**: [`docs/spec-tavily-gateway.md`](spec-tavily-gateway.md)

---

## 結論

参照リポジトリは **CDK（TypeScript）と Terraform の両方** を使い分けている。

| 対象 | ツール | 場所 |
|---|---|---|
| Gateway + Lambda（複雑なビルドロジック） | **CDK TypeScript** | `agent-blueprint/agentcore-gateway-stack/infrastructure/` |
| 全体インフラ（Runtime, Memory, Auth 等） | **Terraform** | `infra/` |

本プロジェクトでは Gateway + Lambda のみを対象とするため、**CDK TypeScript** を採用する。

---

## CDK スタック構成

参照リポジトリは 4 スタックに分割し、依存関係順にデプロイする。

```
GatewayIamStack    # IAM ロール・Secrets Manager インポート
    ↓ addDependency
GatewayStack       # AgentCore Gateway リソース
    ↓ addDependency
LambdaStack        # Lambda 関数のビルド・デプロイ
    ↓ addDependency
GatewayTargetStack # Gateway ターゲット（Lambda → Gateway の接続）
```

### GatewayIamStack

- **Lambda 実行ロール**: CloudWatch Logs 書き込み + Secrets Manager 読み取り
- **Gateway 実行ロール**: `bedrock-agentcore.amazonaws.com` が Assume、Lambda 呼び出し権限
- **Secrets Manager 参照**: `fromSecretNameV2()` でインポート（リソース新規作成は別途 CLI）
  - AWS は自動で 6 文字サフィックスを付与するため IAM リソース ARN はワイルドカード対応

### GatewayStack

```typescript
new bedrock.CfnGateway(this, 'Gateway', {
  protocolConfig: { mcpConfig: { enableMcp: true, protocolVersions: ['2025-03-26', '2025-06-18'] } },
  authConfig: { authType: 'AWS_IAM' },   // SigV4 認証
});
```

- 出力を AWS Systems Manager Parameter Store に保存:
  - `/{projectName}/{environment}/mcp/gateway-arn`
  - `/{projectName}/{environment}/mcp/gateway-url`
  - `/{projectName}/{environment}/mcp/gateway-id`

### LambdaStack

- **S3 バケット**: ビルド成果物保存用（7 日でライフサイクル削除）
- **CodeBuild プロジェクト**: ARM64 (AL2) 環境で `pip install` + ZIP 圧縮
- **Lambda 関数仕様**（参照リポジトリの Tavily）:

| 項目 | 値 |
|---|---|
| ランタイム | Python 3.13 |
| アーキテクチャ | ARM64 |
| メモリ | 1 GB |
| タイムアウト | 5 分 |
| ハンドラ | `lambda_function.lambda_handler` |
| パッケージング | ZIP（S3 経由） |

### GatewayTargetStack

- 各 Lambda ツールを Gateway にターゲットとして接続
- ターゲット名は `<skill-name>___<tool-name>` 形式（例: `tavily-search___tavily_search`）
- Lambda 側でツール名を `___` で分割して処理を分岐

---

## Lambda パッケージング詳細

```
CodeBuild（ARM64 AL2）
  └─ pip install -r requirements.txt --target ./package
  └─ zip -r lambda_<tool>.zip ./package lambda_function.py
  └─ aws s3 cp lambda_<tool>.zip s3://<bucket>/<tool>/
        ↓
Lambda（S3 から取得してデプロイ）
```

ZIP に含めるもの:
- `lambda_function.py`
- `requirements.txt` でインストールした依存パッケージ（`./package/` 以下）

---

## Secrets Manager の扱い

参照リポジトリでは **IaC 側はリソースを「参照（import）」するだけ**で、シークレットの作成は deploy スクリプトが CLI で行う。

```bash
# infra/scripts/deploy.sh より
aws secretsmanager create-secret \
  --name tavily-api-key \
  --secret-string "<TAVILY_API_KEY>"
```

CDK 側では `Secret.fromSecretNameV2()` で既存シークレットを参照する（`new Secret()` で新規作成はしない）。

> **本プロジェクトでの採用方針**: CDK で `aws_secretsmanager.Secret` リソースを作成（値はダミー）し、デプロイ後に CLI で実際の値を `put-secret-value` する。

---

## ディレクトリ構成（参照リポジトリ）

```
agent-blueprint/
└── agentcore-gateway-stack/
    ├── infrastructure/              # CDK プロジェクト
    │   ├── bin/
    │   │   └── gateway-stack.ts    # CDK App エントリポイント
    │   ├── lib/
    │   │   ├── iam-stack.ts        # IAM・Secrets Manager
    │   │   ├── gateway-stack.ts    # Gateway リソース
    │   │   ├── lambda-stack.ts     # Lambda 関数群
    │   │   └── gateway-target-stack.ts  # Gateway ターゲット接続
    │   ├── cdk.json
    │   ├── package.json
    │   └── tsconfig.json
    └── lambda-functions/            # Lambda 関数コード（Python）
        ├── tavily/
        │   ├── lambda_function.py
        │   └── requirements.txt
        ├── wikipedia/
        ├── arxiv/
        └── ...（計 7 関数）

infra/                               # Terraform（全体インフラ）
├── environments/dev/
│   ├── main.tf
│   └── variables.tf
└── modules/
    ├── gateway/
    ├── gateway-lambda-tool/
    ├── runtime/
    └── ...（計 12 モジュール）
```

---

## 本プロジェクトへの適用方針

参照リポジトリの CDK 構成を最小化して採用する。

| 参照リポジトリ | 本プロジェクト |
|---|---|
| 4 スタック分割 | **2 スタック**（IamStack + MainStack）に簡略化 |
| 7 Lambda 関数 | **1 Lambda 関数**（tavily のみ） |
| CodeBuild でビルド | **CDK BundlingOptions** または ローカル zip |
| `infra/` に Terraform | **使用しない**（本プロジェクトは CDK のみ） |
| `agent-blueprint/agentcore-gateway-stack/infrastructure/` | **`infra/gateway/`**（プロジェクトルート直下） |

### ディレクトリ構成（本プロジェクト）

```
infra/
└── gateway/
    ├── bin/
    │   └── gateway.ts
    ├── lib/
    │   ├── iam-stack.ts
    │   └── gateway-stack.ts     # Gateway + Lambda + Targets を 1 スタックに統合
    ├── cdk.json
    ├── package.json
    └── tsconfig.json

agentcore/
└── lambda/
    └── tavily/
        ├── lambda_function.py
        └── requirements.txt
```
