# 参照リポジトリ概要

**リポジトリ**: https://github.com/aws-samples/sample-strands-agent-with-agentcore  
**用途**: 本プロジェクトの実装参考。AWS Bedrock AgentCore + Strands Agent の参照アーキテクチャ。

---

## アーキテクチャ概要

```
フロントエンド（Next.js）
    ↓ SSE / AG-UI
バックエンド（FastAPI on AgentCore Runtime）
    ↓
Strands Agent（Bedrock）
    ↓
ツール / AgentCoreサービス
```

---

## ディレクトリ構成

```
sample-strands-agent-with-agentcore/
├── chatbot-app/
│   ├── frontend/          # Next.js 16 + React 18 + Tailwind + Radix UI
│   └── agentcore/         # Python バックエンド（FastAPI + Strands）
│       ├── skills/        # スキル定義ディレクトリ（25個）← 後述
│       └── src/
│           ├── main.py            # FastAPI アプリ
│           ├── routers/           # chat / health / voice 等のエンドポイント
│           ├── agents/            # BaseAgent / ChatAgent / SkillChatAgent
│           ├── agent/             # セッション管理・MCP・ストリーミング処理
│           ├── skill/             # スキルシステム（レジストリ・ディスパッチャ）
│           ├── tools/             # ローカルツール（可視化等）
│           └── models/            # リクエスト/レスポンス スキーマ
├── infra/
│   └── registry/definitions/skills/  # スキル定義 YAML（インフラ連携用）
├── mobile-app/            # React Native モバイルアプリ
└── telegram-app/          # Telegram ボット
```

> 本プロジェクトで参照する範囲は `chatbot-app/` 配下のみ。

---

## バックエンド（agentcore/src/）の主要ファイル

| ファイル | 役割 |
|---|---|
| `main.py` | FastAPI アプリ。ライフサイクル管理・ルーター登録 |
| `routers/chat.py` | POST /chat。SSE ストリーミング + AG-UI イベント処理 |
| `routers/health.py` | GET /health, /ping |
| `agents/chat_agent.py` | Strands Agent のラッパー。ツール登録・プロンプト構築 |
| `agent/session/` | セッション管理（ファイル / AgentCore Memory） |
| `agent/streaming/` | AG-UI プロトコルのイベント変換処理 |

---

## AgentCore が提供するサービス

| サービス | 概要 |
|---|---|
| **Runtime** | エージェントをマネージドコンテナで実行。ローカル開発は `agentcore dev` |
| **Memory** | 短期・長期の会話メモリを永続化 |
| **Gateway** | Lambda ツールを MCP エンドポイントとして公開 |
| **Identity** | 3LO OAuth（Gmail / GitHub / Google Calendar / Notion）|
| **Browser** | Nova Act によるビジュアルブラウザ自動化 |

> 本プロジェクトで現在使用しているのは **Runtime のみ**（ローカル開発）。

---

## AgentCore Runtime のローカルサーバー仕様

| 項目 | 値 |
|---|---|
| エンドポイント | `POST /invocations` |
| ヘルスチェック | `GET /ping` |
| デフォルトポート | `8080` |
| リクエスト形式 | `{"prompt": "...", "session_id": "..."}` |
| レスポンス形式 | SSE（`data: "JSON文字列"\n\n`） |
| セッションヘッダー | `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` |

`BedrockAgentCoreApp` は Starlette ベース。`@app.entrypoint` に async generator を登録すると自動的に SSE ストリーミングになる。

---

## ツール構成（参照リポジトリ）

参照リポジトリでは 3 種類のツールを使い分けている。

| 種類 | 説明 | 例 |
|---|---|---|
| **ローカルツール** | Python 関数として直接定義（`@tool`） | 計算機・天気（モック）|
| **ビルトインツール** | AWS SDK 経由（WebSocket）| Code Interpreter, Browser |
| **ゲートウェイツール** | MCP 経由（AgentCore Gateway）| Wikipedia, Tavily, Finance |

> 本プロジェクトで現在使用しているのは **ローカルツールのみ**（calculator, weather）。

---

## スキルシステム

参照リポジトリの最大の特徴。**段階的開示（L1→L2→L3）** によりプロンプトサイズを最小化しながら 25 個のスキルを管理する。

### スキルフォルダ構成（25 個）

```
agentcore/skills/
├── arxiv-search/        ├── google-maps/
├── browser-automation/  ├── google-web-search/
├── code-agent/          ├── notion/
├── code-interpreter/    ├── powerpoint-presentations/
├── doc-coauthoring/     ├── research-agent/
├── excalidraw/          ├── tavily-search/
├── excel-spreadsheets/  ├── url-fetcher/
├── financial-news/      ├── visual-design/
├── github/              ├── visualization/
├── gmail/               ├── weather/
├── google-calendar/     ├── web-search/
│                        ├── wikipedia-search/
│                        ├── word-documents/
│                        └── workspace/
```

各スキルフォルダの中身は **SKILL.md のみ**（シンプルなスキル）、または追加ガイド MD を含む（例：`code-agent/` は DESIGN.md・IMPLEMENT.md・REVIEW.md も持つ）。

### SKILL.md のフォーマット

```markdown
---
name: web-search
description: Search the web using DuckDuckGo   ← L1 カタログに使われる
---

# Web Search

## Available Tools
- ddg_web_search(query, max_results=5)

## Usage Guidelines
...

## Citation Format
<cite source="タイトル" url="URL">引用テキスト</cite>
```

### 段階的開示の仕組み（L1 → L2 → L3）

| レベル | タイミング | 内容 | トークン規模 |
|---|---|---|---|
| **L1 カタログ** | 常時（システムプロンプト） | スキル名 + 1行説明の一覧 | ~500 |
| **L2 指示書** | `skill_dispatcher` 呼び出し時 | SKILL.md 本体 + ツールスキーマ JSON | オンデマンド |
| **L3 実行** | `skill_executor` 呼び出し時 | 実際のツール関数 / MCP / スクリプト実行 | — |

LLM は L1 でスキルを把握 → 必要なスキルを `skill_dispatcher` でアクティベート → `skill_executor` で実行、という流れで動く。

### src/skill/ の主要ファイル

| ファイル | 役割 |
|---|---|
| `skill_registry.py` | `skills/` をスキャンしてインデックス構築。`get_catalog()` / `load_instructions()` / `get_tools()` を提供 |
| `skill_tools.py` | `skill_dispatcher`（L2）・`skill_executor`（L3）ツール関数を定義 |
| `decorators.py` | `@skill("スキル名")` デコレータ。ツール関数にスキル名を紐付ける |

### ツール登録パターン

```python
# local_tools/visualization.py
from skill import skill

@skill("visualization")   # ← スキル名を紐付け
@tool
def create_visualization(chart_type, data, title=""):
    ...
```

### skill_dispatcher / skill_executor の役割

```python
# L2: SKILL.md とツールスキーマを返す
skill_dispatcher(skill_name="web-search")
# → { "instructions": "...", "available_tools": [...] }

# L3: 実際のツールを実行する
skill_executor(skill_name="web-search", tool_name="ddg_web_search",
               tool_input={"query": "AI agents"})
# → { "results": [...] }
```

`skill_executor` はローカルツール / MCP / A2A / スクリプト（`.py`）を統一インターフェースで実行する。

### コンポジットスキル

複数スキルを束ねたスキルも定義可能：

```yaml
---
name: research-agent
type: composite
compose: [web-search, arxiv-search, url-fetcher, visualization]
---
```

> **本プロジェクトとの差分**: 本プロジェクトは現時点でスキルシステムを未実装。ツールは `@tool` で直接 Agent に登録している。

---

## フロントエンド（frontend/）の主要構成

```
src/
├── app/
│   ├── page.tsx              # メインページ（ChatInterface を呼び出す）
│   └── api/                  # Next.js API ルート（BFF）
├── components/
│   ├── ChatInterface.tsx      # チャット UI 本体
│   └── ui/                   # Radix UI コンポーネントラッパー
├── hooks/
│   └── useChat.ts             # チャット状態管理フック
└── types/                     # TypeScript 型定義
```

参照リポジトリでは **AG-UI プロトコル**（`@ag-ui/client`）でバックエンドと通信。  
本プロジェクトは SSE を直接 fetch で処理するシンプル版。

---

## 参照リポジトリとの差分（本プロジェクトの現状）

| 機能 | 参照リポジトリ | 本プロジェクト |
|---|---|---|
| バックエンドフレームワーク | FastAPI | BedrockAgentCoreApp（Starlette） |
| ディレクトリ構成 | `agentcore/src/` + `agentcore/skills/` | 同構成（実装済み） |
| ストリーミングプロトコル | AG-UI | SSE（直接 fetch） |
| セッション管理 | AgentCore Memory / ファイル | メモリ上の dict |
| ツール | ローカル + ビルトイン + ゲートウェイ | ローカルのみ |
| **スキルシステム** | L1/L2/L3 段階的開示（25 スキル） | 未実装（`skills/` は空） |
| 認証 | Cognito + Amplify | なし |
| インフラ | Terraform（本番）| ローカルのみ |
