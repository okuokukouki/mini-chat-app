# mini-chat-app

## プロジェクト概要
Strands Agents と Amazon Bedrock AgentCore を使ったミニマムなチャットアプリ。
参照リポジトリ（aws-samples/sample-strands-agent-with-agentcore）を最小構成で再現し、仕組みを理解することが目的。
学習目的のため、コードはできるだけシンプルに保つこと。

## ドキュメント

### ファイル一覧

**`docs/reference/`** — 参照リポジトリ調査ドキュメント

| ファイル | 内容 |
|---|---|
| [`docs/reference/overview.md`](docs/reference/overview.md) | 参照リポジトリの概要・仕様まとめ |
| [`docs/reference/tavily-gateway-investigation.md`](docs/reference/tavily-gateway-investigation.md) | Tavily ツールの実装調査 |
| [`docs/reference/infra-cdk-investigation.md`](docs/reference/infra-cdk-investigation.md) | CDK / Terraform インフラ構成調査 |
| [`docs/reference/agentcore-identity-investigation.md`](docs/reference/agentcore-identity-investigation.md) | AgentCore Identity（3LO OAuth）実装調査 |

**`docs/specs/`** — 機能ごとの実装 Spec

| ファイル | 内容 |
|---|---|
| [`docs/specs/tavily-gateway/spec.md`](docs/specs/tavily-gateway/spec.md) | Tavily Gateway 実装 Spec（実装完了） |
| [`docs/specs/runtime-deploy/spec.md`](docs/specs/runtime-deploy/spec.md) | AgentCore Runtime クラウドデプロイ Spec（策定完了） |
| [`docs/specs/gmail/spec.md`](docs/specs/gmail/spec.md) | Gmail スキル実装 Spec（策定完了） |

**`docs/design/`** — プロジェクト設計ドキュメント（Mermaid 図入り）

| ファイル | 内容 |
|---|---|
| [`docs/design/architecture.md`](docs/design/architecture.md) | システム全体構成図・技術スタック・コンポーネント一覧 |
| [`docs/design/basic-design.md`](docs/design/basic-design.md) | ユースケース一覧・データフロー・主要な設計判断と理由 |
| [`docs/design/backend.md`](docs/design/backend.md) | バックエンド詳細設計（ファイル役割・依存関係・主要モジュール） |
| [`docs/design/frontend.md`](docs/design/frontend.md) | フロントエンド詳細設計（状態管理・SSE パース・OAuth ポップアップ） |
| [`docs/design/infra.md`](docs/design/infra.md) | インフラ詳細設計（CDK スタック構成・リソース一覧・デプロイ順序） |
| [`docs/design/sequences/chat-flow.md`](docs/design/sequences/chat-flow.md) | シーケンス図：通常チャットフロー（L1→L2→L3 + Gateway） |
| [`docs/design/sequences/oauth-flow.md`](docs/design/sequences/oauth-flow.md) | シーケンス図：Gmail OAuth 3LO フロー |
| [`docs/design/sequences/skill-flow.md`](docs/design/sequences/skill-flow.md) | シーケンス図：スキルディスパッチフロー（L1→L2→L3 の詳細） |

### 参照タイミング

実装タスクに着手する前に、必ず `docs/` 配下のドキュメントを参照し、参照リポジトリの設計・仕様と照らし合わせながら実装方針を検討すること。新機能の追加やリファクタリングの際は「参照リポジトリではどう実装されているか」を確認した上で、本プロジェクトの最小構成に合わせた設計を選択する。

## ドキュメント管理規則

### 参照リポジトリ調査（`docs/reference/`）

参照リポジトリや外部リソースの調査を行った場合は、**必ず** `docs/reference/` 配下に調査結果の MD ファイルを作成すること。

- ファイル名は `<対象>-investigation.md` とする（例: `tavily-gateway-investigation.md`）
- ファイル先頭に調査対象・調査日・関連ドキュメントへのリンクを記載する
- 結論（サマリー）を冒頭に置き、詳細はその後に記述する
- 実装タスクに関連する参照リポジトリのコードや仕様に変化があった場合は、対応するドキュメントを自動更新する

### 機能 Spec（`docs/specs/<機能名>/`）

実装に着手する前に `docs/specs/<機能名>/spec.md` を作成すること。

- 決定前の項目は `- [ ]` で未決定とし、決定後に内容を記載する
- 変更のたびに末尾の「変更履歴」テーブルを更新する
- 関連する調査ドキュメントへのリンクを冒頭に記載する

### 設計ドキュメント（`docs/design/`）

コードを変更したときは、**変更内容に応じて以下のドキュメントを必ず更新すること**。

| 変更箇所 | 更新するドキュメント |
|---|---|
| `agentcore/src/main.py` | `backend.md`（エントリポイント・ルーティング）・`sequences/chat-flow.md` |
| `agentcore/src/agents/agent.py` | `backend.md`（Agent ファクトリ） |
| `agentcore/src/skill/` | `backend.md`（スキルシステム）・`sequences/skill-flow.md` |
| `agentcore/src/agent/gateway/` | `backend.md`（Gateway クライアント）・`sequences/chat-flow.md` |
| `agentcore/src/agent/mcp/` | `backend.md`（MCP クライアント）・`sequences/oauth-flow.md` |
| `agentcore/src/config.py` | `backend.md`（設定一元管理） |
| `frontend/src/` | `frontend.md` |
| `infra/` | `infra.md`・必要に応じて `architecture.md` |
| 新機能・スキル追加 | `basic-design.md`（ユースケース追加）・`architecture.md`（構成図更新） |

更新ルール:
- 各ドキュメント末尾の「変更履歴」テーブルに日付と変更内容を追記する
- 図（Mermaid）も変更内容を反映して更新する
- 設計判断が変わった場合は `basic-design.md` に理由とともに記録する

### CLAUDE.md のファイル一覧更新

`docs/` に新しいファイルを追加・移動・削除した場合は、この CLAUDE.md の「ドキュメント → ファイル一覧」テーブルを必ず更新すること。

## 技術スタック
- バックエンド（`agentcore/src/`）: Python 3.14 / bedrock-agentcore / Strands Agents / Amazon Bedrock
- フロントエンド（`frontend/`）: Next.js 16 / React 19 / TypeScript
- パッケージ管理: uv（バックエンド）/ npm（フロントエンド）
- AgentCore CLIツール（`node_modules/`）: @aws/agentcore
- AWSリージョン: us-east-1（`agentcore/src/config.py` で一元管理）

## ディレクトリ構成
```
mini-chat-app/
├── agentcore/               # AgentCore CLI の設定ファイル + バックエンドソース
│   ├── agentcore.json       # ランタイム設定（CDK マネージド・認証設定含む）
│   ├── pyproject.toml       # Python 依存関係
│   ├── skills/              # SKILL.md スキル定義ディレクトリ
│   │   ├── gmail/SKILL.md   # Gmail スキル（type: mcp_runtime）
│   │   └── tavily-search/SKILL.md
│   └── src/
│       ├── main.py          # AgentCoreエントリポイント（POST /invocations, GET /oauth-complete）
│       ├── config.py        # 共通設定（リージョン・環境変数）
│       ├── agents/agent.py  # Strands Agent の定義
│       ├── agent/
│       │   ├── gateway/mcp_client.py    # Gateway（SigV4）クライアント
│       │   └── mcp/
│       │       ├── elicitation_bridge.py  # OAuth URL → SSE ブリッジ
│       │       └── mcp_runtime_client.py  # Gmail API クライアント（OAuth）
│       └── skill/
│           ├── skill_registry.py  # SKILL.md スキャン・管理
│           └── skill_tools.py     # skill_dispatcher / skill_executor
├── infra/                   # CDK インフラ（共有 node_modules）
│   ├── gateway/             # AgentCore Gateway（Tavily MCP Lambda）
│   ├── runtime/             # AgentCore Runtime クラウドデプロイ
│   ├── identity/            # Cognito + AgentCore Identity（Gmail OAuth）
│   └── frontend/            # Amplify Hosting（Next.js フロントエンド）
└── frontend/                # Next.js アプリ
    └── src/app/page.tsx     # チャット画面（OAuth ポップアップ対応）
```

## AgentCore ローカルサーバーについて
- エンドポイント: `POST http://localhost:8080/invocations`
- リクエスト形式: `{"prompt": "...", "session_id": "..."}`
- レスポンス形式: SSE（`data: "JSON文字列"\n\n`）
- ヘルスチェック: `GET http://localhost:8080/ping`

## コーディング方針
- 日本語でコメントを書く
- 各ファイルの先頭にそのファイルの役割を説明するコメントを入れる
- エラーハンドリングは最小限でOK（学習目的のため）

## 環境・依存関係の方針
- npm・pip・gem など **グローバル環境へのインストールは行わない**
- パッケージは必ずプロジェクト内の仮想環境に含める
  - Python: `uv add <package>`（グローバルの pip install は不可）
  - Node.js ツールが必要な場合: `npm install --save-dev` または `npx` で実行する

## よく使うコマンド
```bash
# バックエンド（agentcore/ で実行）
cd agentcore
uv add <package>                          # 依存追加
uv run python src/main.py                 # 開発サーバー起動（ポート8080）
uv run pytest                             # テスト

# AgentCore CLI（プロジェクトルートで実行）
npx agentcore dev                         # ローカル開発サーバー起動（ポート8080）
npx agentcore dev "東京の天気は？"         # プロンプトを送信して動作確認

# フロントエンド（frontend/ で実行）
cd frontend
npm install                               # 依存インストール
npm run dev                               # 開発サーバー起動（ポート3000）
```
