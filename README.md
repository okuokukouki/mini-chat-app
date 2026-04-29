# mini-chat-app

Strands Agents と Amazon Bedrock AgentCore を使ったミニマムなチャットアプリ。  
参照リポジトリ（[aws-samples/sample-strands-agent-with-agentcore](https://github.com/aws-samples/sample-strands-agent-with-agentcore)）を最小構成で再現し、仕組みを理解することが目的の学習用プロジェクト。

---

## アーキテクチャ

```
【ローカル】
Next.js (port 3000)
  └─ POST /invocations → SSE ストリーミング

AgentCore Runtime (port 8080)
  └─ Strands Agent (Claude Sonnet 4.5)
       ├─ skill_dispatcher  ── スキル情報を返す
       ├─ skill_executor    ── スキルのツールを実行（MCP / ローカル自動判定）
       ├─ execute_code      ── AgentCore Code Interpreter（Python / JS / TS）
       └─ browse_web        ── AgentCore Browser（Playwright / WebSocket）

【AWS】
AgentCore Gateway（IAM SigV4 認証）
  └─ Lambda: mcp-tavily（Python 3.13 / ARM64）
       ├─ tavily_search   ── Web 検索
       └─ tavily_extract  ── URL コンテンツ抽出
            └─ Secrets Manager（TAVILY_API_KEY）
```

---

## ディレクトリ構成

```
mini-chat-app/
├── agentcore/               # バックエンド（Python）
│   ├── lambda/
│   │   └── tavily/          # Lambda 関数（tavily_search / tavily_extract）
│   ├── skills/              # スキル定義（SKILL.md）
│   │   ├── browser/
│   │   ├── code-interpreter/
│   │   └── tavily-search/
│   └── src/
│       ├── main.py          # AgentCore エントリポイント
│       ├── config.py        # 共通設定（REGION / GATEWAY_ENDPOINT）
│       ├── agent/
│       │   └── gateway/
│       │       └── mcp_client.py  # SigV4 署名付き Gateway クライアント
│       ├── agents/
│       │   └── agent.py     # Strands Agent 定義
│       ├── skill/           # スキルシステム
│       │   ├── decorators.py
│       │   ├── skill_registry.py
│       │   └── skill_tools.py
│       └── tools/
│           ├── browser.py
│           └── code_interpreter.py
├── frontend/                # フロントエンド（Next.js）
│   └── src/app/
│       └── page.tsx         # チャット画面
├── infra/
│   └── gateway/             # CDK インフラ（TypeScript）
│       ├── bin/gateway.ts   # CDK App エントリポイント
│       └── lib/
│           ├── iam-stack.ts    # IAM ロール・Secrets Manager
│           └── gateway-stack.ts # Gateway + Lambda + Targets
└── docs/                    # 設計ドキュメント・調査メモ
```

---

## 技術スタック

| 層 | 技術 |
|---|---|
| バックエンド | Python 3.14 / bedrock-agentcore / strands-agents |
| フロントエンド | Next.js 16 / React 19 / TypeScript |
| Lambda | Python 3.13 / ARM64 |
| IaC | AWS CDK TypeScript |
| モデル | Amazon Bedrock（Claude Sonnet 4.5） |
| 認証 | AWS IAM SigV4 |

---

## セットアップ

### 前提条件

- Python 3.14（`uv` でパッケージ管理）
- Node.js 20+（`npm` でパッケージ管理）
- AWS CLI（`us-east-1` リージョンの認証情報設定済み）
- Tavily API キー（[tavily.com](https://tavily.com) で取得）

### バックエンド（agentcore）

```bash
cd agentcore

# 依存パッケージのインストール
uv sync

# .env.local を作成して GATEWAY_ENDPOINT を設定（AWS デプロイ後）
echo "GATEWAY_ENDPOINT=https://<gateway-id>.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp" > .env.local

# 開発サーバー起動（port 8080）
uv run python src/main.py
```

### フロントエンド（frontend）

```bash
cd frontend

# 依存パッケージのインストール
npm install

# 開発サーバー起動（port 3000）
npm run dev
```

ブラウザで `http://localhost:3000` を開くとチャット画面が表示される。

---

## AWS デプロイ（AgentCore Gateway）

Tavily 検索を使うには AWS 側に Gateway をデプロイする必要がある。

```bash
# 1. CDK ブートストラップ（初回のみ）
cd infra/gateway
npm install
npx cdk bootstrap

# 2. スタックをデプロイ
npx cdk deploy --all
# IamStack → GatewayStack の順にデプロイされる

# 3. Tavily API キーを Secrets Manager に設定
aws secretsmanager put-secret-value \
  --secret-id mini-chat-app/tavily-api-key \
  --secret-string '{"TAVILY_API_KEY": "<YOUR_TAVILY_API_KEY>"}'

# 4. Gateway URL を取得して agentcore/.env.local に設定
aws cloudformation describe-stacks \
  --stack-name MiniChatGatewayStack \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayUrl'].OutputValue" \
  --output text
```

取得した URL を `agentcore/.env.local` の `GATEWAY_ENDPOINT` に設定してバックエンドを再起動する。

---

## 動作確認

バックエンドが起動した状態で `http://localhost:3000` を開き、以下のようなメッセージを送信する。

| メッセージ例 | 使われるツール |
|---|---|
| `2の10乗を計算して` | execute_code（Code Interpreter） |
| `https://example.com の内容を教えて` | browse_web（Browser） |
| `今日のAIニュースを検索して`（Gateway デプロイ後） | skill_executor → tavily_search |

---

## スキルシステム

`agentcore/skills/` 配下の SKILL.md がスキル定義。Agent はリクエスト内容に応じて `skill_dispatcher` でスキル情報を取得し、`skill_executor` でツールを実行する。

- **ローカルツール**（`execute_code`, `browse_web`）: 関数を直接呼び出す
- **MCP ツール**（`tavily_search`, `tavily_extract`）: `FilteredMCPClient` 経由で AgentCore Gateway を呼び出す（SigV4 署名付き）

新しいスキルを追加する場合は `agentcore/skills/<skill-name>/SKILL.md` を作成するだけで自動検出される。

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| [`docs/reference-repo.md`](docs/reference-repo.md) | 参照リポジトリの概要・仕様まとめ |
| [`docs/tavily-gateway-investigation.md`](docs/tavily-gateway-investigation.md) | Tavily ツールの参照 repo 実装調査 |
| [`docs/infra-cdk-investigation.md`](docs/infra-cdk-investigation.md) | 参照 repo の CDK / Terraform インフラ構成調査 |
| [`docs/spec-tavily-gateway.md`](docs/spec-tavily-gateway.md) | Tavily Gateway 設計決定事項・デプロイ手順 |
