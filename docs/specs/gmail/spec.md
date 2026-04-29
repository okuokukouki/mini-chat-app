# Gmail スキル実装 Spec

**ステータス**: 策定完了  
**関連調査**: [`docs/reference/agentcore-identity-investigation.md`](../../reference/agentcore-identity-investigation.md)  
**前提条件**: [`docs/specs/runtime-deploy/spec.md`](../runtime-deploy/spec.md) が完了していること

---

## 概要

Strands Agent から Gmail（受信トレイの読み取り・検索）を操作できるスキルを実装する。  
認証基盤に **AgentCore Identity（3LO OAuth）** を使い、参照リポジトリと同構成で実装する。  
OAuth 同意が必要なときはフロントエンドでポップアップウィンドウを自動表示する。

すべてのインフラリソースは CDK で管理する。コンソール・CLI の手動操作は行わない。

---

## 決定事項

| # | 項目 | 決定内容 |
|---|---|---|
| D-1 | 認証基盤 | **AgentCore Identity（Option A）**。参照 repo と同構成 |
| D-2 | 提供ツール | **3 ツール**（`list_emails` / `search_emails` / `read_email`） |
| D-3 | OAuth スコープ | **`gmail.readonly`**（最小権限） |
| D-4 | スキル統合 | **skill_executor 経由**（既存スキルシステムに統合） |
| D-5 | SKILL.md | **実装する**（L1/L2 段階的開示） |
| D-6 | Google Cloud | **CDK のみで設定**（OAuth クライアント ID / Secret は Secrets Manager で管理） |
| D-7 | AWS リージョン | **us-east-1** |
| D-8 | Identity CDK 配置 | **`infra/identity/`**（独立 CDK プロジェクト） |
| D-9 | ローカル開発時の動作 | **モックのみ**。実 OAuth フローは AWS デプロイ後に検証 |
| D-10 | フロントエンド OAuth UI | **自動ポップアップ**（`window.open` で OAuth URL を新規ウィンドウで開く） |
| D-11 | コンソール・CLI 手動操作 | **行わない**。すべて CDK で完結 |

---

## アーキテクチャ

### 全体構成

```
【AWS インフラ（infra/identity/）】

Cognito User Pool
  └─ ユーザー認証 → JWT (id_token)
  └─ User Pool Client（フロントエンド用）

AgentCore Identity
  └─ Google OAuth プロバイダー（GoogleOauth2 タイプ）
  └─ OAuth client_id / client_secret → Secrets Manager から参照
  └─ callback UUID が自動生成 → SSM に保存
  └─ prevent_destroy = true（callback UUID 固定のため削除禁止）

SSM Parameter Store
  └─ /mini-chat-app/oauth2-callback-url  ← Identity callback URL
  └─ /mini-chat-app/cognito-user-pool-id
  └─ /mini-chat-app/cognito-client-id

Secrets Manager
  └─ mini-chat-app/google-oauth  ← { client_id, client_secret }

DynamoDB（Token Vault）
  └─ OAuth アクセストークンをユーザー別に永続化

【実行フロー】

フロントエンド
  ├─ Cognito でユーザー認証 → JWT 取得
  └─ POST /invocations（Bearer JWT）→ AgentCore Runtime（クラウド）
         └─ skill_executor（mcp_runtime パス）
               └─ MCPRuntimeClient
                    headers:
                      Authorization: Bearer {JWT}
                      MCP-OAuth2-Callback-URL: {SSM の URL}
                         ↓
                    AgentCore Identity（AWS）
                         ├─ キャッシュ hit → Gmail API 呼び出し成功
                         └─ キャッシュ miss → OAuth URL を返却
                               ↓
                         ElicitationBridge
                               └─ SSE で { type: "oauth_url", url: "..." } を配信
                                     ↓
                               フロントエンド
                                     └─ window.open(url) でポップアップ
                                           ↓
                               [ユーザーが Google 同意画面で承認]
                                           ↓
                               GET /oauth-complete（Runtime）
                                     └─ CompleteResourceTokenAuth 実行
                                     └─ Token Vault（DynamoDB）に保存
                                     └─ SSE で { type: "oauth_complete" } を配信
                                           ↓
                               フロントエンドがポップアップを閉じ
                               ユーザーが再送信 → キャッシュ hit → 成功
```

### skill_executor への追加経路

```
skill_executor 呼び出し
  ├─ Local Tool?       → 関数を直接呼び出し（execute_code, browse_web）
  ├─ Gateway MCP?      → FilteredMCPClient（SigV4）（Tavily）
  └─ MCP Runtime?      → MCPRuntimeClient（Bearer JWT + callback URL）← 新規追加
```

SKILL.md に `type: mcp_runtime` を記載し、`skill_registry` が判別する。

---

## 実装コンポーネント一覧

### 1. `infra/identity/`（新規 CDK プロジェクト）

```
infra/identity/
├── bin/
│   └── identity.ts             # CDK App エントリポイント
├── lib/
│   ├── cognito-stack.ts        # Cognito User Pool + Client
│   ├── secrets-stack.ts        # Google OAuth シークレット
│   └── identity-stack.ts       # AgentCore Identity + DynamoDB + SSM
├── cdk.json
├── package.json
└── tsconfig.json
```

**CognitoStack** が作成するリソース:

| リソース | 内容 |
|---|---|
| Cognito User Pool | メール/パスワード認証。JWT 発行元 |
| User Pool Client | PKCE 対応。フロントエンド用（シークレットなし） |
| テストユーザー | CDK Custom Resource で初期ユーザー作成（メール・パスワード） |
| SSM Parameter | `/mini-chat-app/cognito-user-pool-id`, `/mini-chat-app/cognito-client-id` |

**SecretsStack** が作成するリソース:

| リソース | 内容 |
|---|---|
| Secrets Manager | `mini-chat-app/google-oauth`。初期値 `{ client_id: "REPLACE_ME", client_secret: "REPLACE_ME" }` |

> Google Cloud で OAuth クライアント ID 取得後、CDK の `CfnOutput` に従い Secrets Manager の値を CDK CustomResource 経由で更新する。  
> ただし Google OAuth の設定（クライアント ID / Secret の発行）自体は Google Cloud Console で手動操作が必要。

**IdentityStack** が作成するリソース:

| リソース | 内容 |
|---|---|
| AgentCore Identity | `GoogleOauth2` タイプ。Secrets Manager から client_id / client_secret を参照 |
| DynamoDB テーブル | Token Vault。パーティションキー: `user_id` / ソートキー: `provider` |
| SSM Parameter | `/mini-chat-app/oauth2-callback-url` に Identity の callback URL を保存 |

> `prevent_destroy = true` を CDK の `RemovalPolicy.RETAIN` で表現する。

### 2. バックエンド新規ファイル

| ファイル | 内容 |
|---|---|
| `src/agent/mcp/mcp_runtime_client.py` | Cognito JWT + callback URL を MCP ヘッダーに設定してリクエスト |
| `src/agent/mcp/elicitation_bridge.py` | OAuth 同意フロー待機。`in_memory` モード（ローカル）と `dynamodb` モード（本番）を切り替え |
| `agentcore/skills/gmail/SKILL.md` | スキル定義（type: mcp_runtime、ツール一覧） |

### 3. バックエンド既存ファイルの変更

| ファイル | 変更内容 |
|---|---|
| `src/skill/skill_tools.py` | `skill_executor` に `mcp_runtime` 実行経路を追加（SKILL.md の type で判定） |
| `src/skill/skill_registry.py` | `type` フィールドを SKILL.md から読み込む対応 |
| `src/main.py` | `GET /oauth-complete` エンドポイントを追加（Starlette ルートとして追加） |
| `src/config.py` | `COGNITO_JWT`・`MCP_OAUTH2_CALLBACK_URL`・`ELICITATION_MODE` 環境変数を追加 |
| `src/agents/agent.py` | Gmail スキルを `registry.bind_tools` に登録（MCP Runtime ツールは bind 不要だが SKILL.md のスキャンは必要） |

### 4. フロントエンド変更

| ファイル | 変更内容 |
|---|---|
| `frontend/src/app/page.tsx` | SSE で `oauth_url` イベント受信 → `window.open(url, '_blank', 'width=500,height=600')` でポップアップ |
| `frontend/src/app/page.tsx` | SSE で `oauth_complete` イベント受信 → ポップアップを `popup.close()` で閉じる + 「再送信してください」メッセージ表示 |
| `frontend/.env.local` | `NEXT_PUBLIC_COGNITO_CLIENT_ID` / `NEXT_PUBLIC_COGNITO_USER_POOL_ID` を追加 |

---

## 提供ツール詳細

### `list_emails`

```
入力:
  label_ids: list[str] = ["INBOX"]   # フィルタするラベル（例: ["INBOX", "UNREAD"]）
  max_results: int = 10

出力（JSON 文字列）:
  [{ "id": "...", "subject": "...", "from": "...", "date": "..." }, ...]
```

### `search_emails`

```
入力:
  query: str        # Gmail 検索クエリ（例: "from:foo@example.com is:unread"）
  max_results: int = 10

出力（JSON 文字列）:
  [{ "id": "...", "subject": "...", "from": "...", "date": "...", "snippet": "..." }, ...]
```

### `read_email`

```
入力:
  message_id: str   # list_emails / search_emails で取得した ID

出力（JSON 文字列）:
  { "subject": "...", "from": "...", "to": "...", "date": "...", "body": "..." }
```

---

## `agentcore/skills/gmail/SKILL.md` の内容

```markdown
---
name: gmail
description: Read Gmail inbox, search emails, and fetch email content
type: mcp_runtime
scopes:
  - https://www.googleapis.com/auth/gmail.readonly
---

# Gmail スキル

## Available Tools

- list_emails(label_ids=["INBOX"], max_results=10)
  受信トレイのメール一覧を返す

- search_emails(query, max_results=10)
  Gmail クエリ構文でメールを検索する（例: "from:foo@example.com is:unread"）

- read_email(message_id)
  メールの本文を取得する

## Usage Guidelines

- メールを検索するときは search_emails を使う
- メール本文が必要な場合は read_email で ID を指定して取得する
- 個人情報を含む出力は要約して表示すること
```

---

## 環境変数

| 変数名 | 説明 | ローカル値 | 本番値 |
|---|---|---|---|
| `COGNITO_JWT` | Cognito ID Token | テスト用 JWT（手動取得） | フロントエンドが動的に設定 |
| `MCP_OAUTH2_CALLBACK_URL` | OAuth callback URL | `http://localhost:8080/oauth-complete` | SSM `/mini-chat-app/oauth2-callback-url` から取得 |
| `ELICITATION_MODE` | Elicitation Bridge モード | `in_memory` | `dynamodb` |
| `DYNAMODB_TOKEN_VAULT_TABLE` | Token Vault テーブル名 | （未使用） | CDK Output から取得 |

---

## Google Cloud セットアップ（CDK デプロイ後に実施）

> ここだけは Google Cloud Console での手動操作が必要（AWS 外部サービスのため）。

1. Google Cloud Console でプロジェクト作成（または既存を使用）
2. Gmail API を有効化
3. OAuth 同意画面を設定（テスト用、スコープ: `gmail.readonly`）
4. OAuth 2.0 クライアント ID を作成（種別: **ウェブアプリケーション**）
5. 承認済みリダイレクト URI に **CDK Output の callback URL** を登録
6. クライアント ID / Secret を Secrets Manager（`mini-chat-app/google-oauth`）に設定  
   → CDK CustomResource または手動で `aws secretsmanager put-secret-value` を実行

---

## クラウドデプロイ手順

実装は完了済み。以下の手順でデプロイする。

### Step 1 — identity スタック（Cognito + Secrets）

```bash
cd infra/identity
npm install

# Cognito User Pool を作成。SSM に user-pool-id / client-id を書き込む。
npx cdk deploy MiniChatCognitoStack

# Secrets Manager に google-oauth のプレースホルダーを作成。
npx cdk deploy MiniChatSecretsStack
```

### Step 2 — runtime スタック

```bash
cd infra/runtime
npm install

# AgentCore Runtime を作成。Cognito の SSM 値が前提。
# SSM に runtime-endpoint を書き込む。
npx cdk deploy MiniChatRuntimeStack
```

デプロイ後、CDK Outputs の `RuntimeEndpointUrl` と `RuntimeId` をメモする。

### Step 3 — Google Cloud Console 設定

> ここだけ Google Cloud Console での手動操作が必要（AWS 外部サービスのため）。

1. Google Cloud Console でプロジェクト作成（または既存を使用）
2. Gmail API を有効化
3. OAuth 同意画面を設定（テスト用、スコープ: `gmail.readonly`）
4. OAuth 2.0 クライアント ID を作成（種別: **ウェブアプリケーション**）
5. Step 4 で取得する `OAuthCallbackUrl` を承認済みリダイレクト URI に登録
6. クライアント ID / Secret を控えておく（Step 4 後に Secrets Manager へ設定）

### Step 4 — identity スタック（AgentCore Identity）

```bash
cd infra/identity

# CfnOAuth2CredentialProvider を作成。Secrets Manager の値を参照する。
npx cdk deploy MiniChatIdentityStack
```

CDK Outputs の `OAuthCallbackUrl` を Google Cloud Console のリダイレクト URI に登録する（Step 3-5）。

### Step 5 — Google OAuth シークレットの更新

```bash
# Secrets Manager の mini-chat-app/google-oauth に実際の値を設定
aws secretsmanager put-secret-value \
  --secret-id mini-chat-app/google-oauth \
  --secret-string '{"client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET"}'
```

### Step 6 — フロントエンド環境変数の更新

SSM から値を取得して `frontend/.env.production` を更新する。

```bash
# Runtime エンドポイント
aws ssm get-parameter --name /mini-chat-app/runtime-endpoint --query Parameter.Value --output text

# Cognito User Pool ID / Client ID
aws ssm get-parameter --name /mini-chat-app/cognito-user-pool-id --query Parameter.Value --output text
aws ssm get-parameter --name /mini-chat-app/cognito-client-id --query Parameter.Value --output text
```

`frontend/.env.production` の `REPLACE_WITH_*` を取得した値に書き換える。

### Step 7 — 動作確認

```bash
# フロントエンドをビルド・起動
cd frontend
npm run build
npm run dev

# ブラウザで http://localhost:3000 を開き、
# Cognito でサインイン → 「Gmail を見せて」と入力 → OAuth ポップアップが開く
```

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-26 | 初版作成。D-1〜D-3 を未決定として提示 |
| 2026-04-26 | D-1〜D-10 確定。アーキテクチャ・実装コンポーネント追記 |
| 2026-04-26 | D-11 追加（CDK のみ）。Runtime クラウドデプロイを前提条件として追記。全決定事項確定 |
| 2026-04-27 | デプロイ手順を Step 1〜7 の完全版に更新（runtime / identity / Google Cloud / 環境変数） |
