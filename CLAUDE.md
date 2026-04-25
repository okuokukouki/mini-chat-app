# mini-chat-app

## プロジェクト概要
Strands Agents と Amazon Bedrock AgentCore を使ったミニマムなチャットアプリ。
参照リポジトリ（aws-samples/sample-strands-agent-with-agentcore）を最小構成で再現し、仕組みを理解することが目的。
学習目的のため、コードはできるだけシンプルに保つこと。

## ドキュメント

### ファイル一覧

| ファイル | 内容 |
|---|---|
| [`docs/reference-repo.md`](docs/reference-repo.md) | 参照リポジトリの概要・仕様まとめ |
| [`docs/tavily-gateway-investigation.md`](docs/tavily-gateway-investigation.md) | Tavily ツールの参照 repo 実装調査 |
| [`docs/infra-cdk-investigation.md`](docs/infra-cdk-investigation.md) | 参照 repo の CDK / Terraform インフラ構成調査 |
| [`docs/spec-tavily-gateway.md`](docs/spec-tavily-gateway.md) | Tavily Gateway 実装 Spec（決定済み） |

### 参照タイミング

実装タスクに着手する前に、必ず `docs/` 配下のドキュメントを参照し、参照リポジトリの設計・仕様と照らし合わせながら実装方針を検討すること。新機能の追加やリファクタリングの際は「参照リポジトリではどう実装されているか」を確認した上で、本プロジェクトの最小構成に合わせた設計を選択する。

## ドキュメント管理規則

### 調査結果の記録

参照リポジトリや外部リソースの調査を行った場合は、**必ず** `docs/` 配下に調査結果の MD ファイルを作成すること。

- ファイル名は `<対象>-investigation.md` または `<対象>-research.md` とする（例: `tavily-gateway-investigation.md`）
- ファイル先頭に調査対象・調査日・関連ドキュメントへのリンクを記載する
- 結論（サマリー）を冒頭に置き、詳細はその後に記述する

### Spec ファイルの管理

実装計画は `docs/spec-<機能名>.md` として管理する。

- 決定前の項目は `- [ ]` で未決定とし、決定後に `決定内容` として記載する
- 変更のたびに末尾の「変更履歴」テーブルを更新する

### CLAUDE.md のドキュメント一覧更新

`docs/` に新しいファイルを追加した場合は、この CLAUDE.md の「ドキュメント → ファイル一覧」テーブルに必ず追記すること。

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
│   ├── agentcore.json       # ランタイム設定（エントリポイント・コード場所など）
│   ├── pyproject.toml       # Python 依存関係
│   ├── skills/              # スキル定義ディレクトリ（将来拡張用）
│   └── src/
│       ├── main.py          # AgentCoreエントリポイント（POST /invocations）
│       ├── agents/
│       │   └── agent.py     # Strands Agent の定義
│       └── tools/
│           ├── calculator.py
│           └── weather.py
└── frontend/                # Next.js アプリ
    └── src/app/
        └── page.tsx         # チャット画面
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
