# AgentCore Runtime クラウドデプロイ Spec

**ステータス**: 策定完了  
**関連調査**: [`docs/reference/overview.md`](../../reference/overview.md)

---

## 概要

現在ローカル（`localhost:8080`）で動作している AgentCore Runtime を AWS クラウドにデプロイし、  
フロントエンドの接続先をクラウドエンドポイントに切り替える。  
Gmail スキル実装（`docs/specs/gmail/spec.md`）の前提条件となる作業。

すべてのリソースは CDK で管理する。コンソール・CLI の手動操作は行わない。

---

## 決定事項

| # | 項目 | 決定内容 |
|---|---|---|
| D-1 | CDK スタック配置 | `infra/runtime/`（独立 CDK プロジェクト） |
| D-2 | ビルド方式 | **CodeZip**（`agentcore.json` の既存設定を使用） |
| D-3 | ネットワークモード | **PUBLIC**（`agentcore.json` の既存設定を使用） |
| D-4 | Runtime バージョン | **PYTHON_3_14**（`agentcore.json` の既存設定を使用） |
| D-5 | Runtime エンドポイント URL 共有 | **SSM Parameter Store**（`/mini-chat-app/runtime-endpoint`）に保存し、他スタックと共有 |
| D-6 | フロントエンドの接続先切り替え | 環境変数 `NEXT_PUBLIC_AGENTCORE_ENDPOINT` で管理。`.env.local` で上書き可能 |
| D-7 | コンソール・CLI 手動操作 | **行わない**。すべて CDK で完結 |

---

## アーキテクチャ

### デプロイ後の全体構成

```
【AWS クラウド】
AgentCore Runtime（PUBLIC エンドポイント）
  └─ POST /invocations  ← フロントエンドから呼び出し
  └─ GET  /ping         ← ヘルスチェック
  └─ GET  /oauth-complete ← OAuth コールバック（Gmail スキル実装時に追加）
       │
       └─ 実行コード: agentcore/src/ （CodeZip でパッケージング）
            └─ Strands Agent（Bedrock）
                 ├─ skill_dispatcher
                 ├─ skill_executor → Gateway（SigV4）→ Lambda（Tavily）
                 ├─ execute_code
                 └─ browse_web

SSM Parameter Store
  └─ /mini-chat-app/runtime-endpoint  ← Runtime の URL を保存

【フロントエンド（localhost:3000）】
  └─ NEXT_PUBLIC_AGENTCORE_ENDPOINT → SSM の値を参照してデプロイ
```

### 現状との差分

| 項目 | 変更前 | 変更後 |
|---|---|---|
| Runtime 実行場所 | `localhost:8080`（`npx agentcore dev`） | AWS クラウド |
| フロントエンドの呼び出し先 | `http://localhost:8080/invocations` | `https://<runtime-endpoint>/invocations` |
| ローカル開発 | `npx agentcore dev` で引き続き可能 | `.env.local` で `localhost:8080` を指定 |

---

## 実装コンポーネント一覧

### 1. `infra/runtime/`（新規 CDK プロジェクト）

```
infra/runtime/
├── bin/
│   └── runtime.ts          # CDK App エントリポイント
├── lib/
│   ├── iam-stack.ts        # Runtime 実行ロール
│   └── runtime-stack.ts    # AgentCore Runtime リソース + SSM 出力
├── cdk.json
├── package.json
└── tsconfig.json
```

**IamStack** が作成するリソース:

| リソース | 内容 |
|---|---|
| Runtime 実行ロール | `bedrock-agentcore.amazonaws.com` が Assume |
| Bedrock 権限 | `bedrock:InvokeModel`（Claude モデル呼び出し） |
| AgentCore Gateway 権限 | `bedrock-agentcore:*`（Gateway / Identity アクセス） |
| CloudWatch Logs 権限 | ログ書き込み |
| Secrets Manager 権限 | Tavily API キー読み取り |

**RuntimeStack** が作成するリソース:

| リソース | 内容 |
|---|---|
| AgentCore Runtime | `agentcore.json` の設定（name / build / entrypoint / codeLocation / runtimeVersion / networkMode）に基づいて作成 |
| SSM Parameter | `/mini-chat-app/runtime-endpoint` に Runtime URL を保存 |

### 2. `agentcore.json`（変更なし）

既存の設定をそのまま使用する。

```json
{
  "managedBy": "CDK",
  "runtimes": [{
    "name": "mini-chat-app",
    "build": "CodeZip",
    "entrypoint": "main.py",
    "codeLocation": "agentcore/src/",
    "runtimeVersion": "PYTHON_3_14",
    "networkMode": "PUBLIC",
    "protocol": "HTTP"
  }]
}
```

### 3. フロントエンド（`frontend/`）

| ファイル | 変更内容 |
|---|---|
| `src/app/page.tsx` | API 呼び出し先を `NEXT_PUBLIC_AGENTCORE_ENDPOINT` 環境変数から取得するよう変更 |
| `.env.local`（新規, gitignore 対象） | `NEXT_PUBLIC_AGENTCORE_ENDPOINT=http://localhost:8080`（ローカル開発用） |
| `.env.production`（新規） | `NEXT_PUBLIC_AGENTCORE_ENDPOINT=https://<runtime-endpoint>`（本番用） |

---

## デプロイ手順

すべて CDK のみ。手動操作なし。

```bash
# 1. CDK プロジェクト初期化
cd infra/runtime
npm install

# 2. CDK ブートストラップ（初回のみ・アカウント/リージョン単位）
npx cdk bootstrap

# 3. IamStack をデプロイ
npx cdk deploy MiniChatRuntimeIamStack

# 4. RuntimeStack をデプロイ（IamStack に依存）
npx cdk deploy MiniChatRuntimeStack

# 5. Runtime エンドポイントの確認（SSM から取得）
#    CDK Outputs にも表示される
```

デプロイ後、フロントエンドの `.env.production` に出力された Runtime URL を設定する。

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-26 | 初版作成。全決定事項確定 |
