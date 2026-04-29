# AgentCore Identity（3LO OAuth）実装調査

**調査対象**: `aws-samples/sample-strands-agent-with-agentcore`  
**調査日**: 2026-04-26  
**関連ドキュメント**: [`docs/reference/overview.md`](overview.md)

---

## サマリー

参照リポジトリでは **AgentCore Identity** を使って Gmail・GitHub・Google Calendar・Notion の OAuth 認証を実装している。スキル側は SKILL.md でツールを宣言するだけで、認証処理は AgentCore ランタイムが透過的に処理する設計。

**Identity を使っているスキル（4つ）**:

| スキル | サービス | OAuth プロバイダー種別 |
|---|---|---|
| `gmail/` | Gmail（読み取り・送信・削除など） | Google OAuth2（native） |
| `github/` | GitHub（リポジトリ操作・PR 作成など） | Custom OAuth2 |
| `google-calendar/` | Google カレンダー（イベント CRUD） | Google OAuth2（native） |
| `notion/` | Notion（ページ・ブロック操作） | Custom OAuth2 |

---

## 1. 認証フロー概要（3LO OAuth）

```
[ユーザー] チャットメッセージ送信
    ↓ Cognito JWT
[AgentCore Runtime MCP Server]
    ↓ WorkloadAccessToken ヘッダー付きで要求
[AgentCore Identity]
    ├── キャッシュ hit → アクセストークン返却 → API 呼び出し成功
    └── キャッシュ miss → Authorization URL を返却
            ↓
        [Elicitation Bridge] SSE で OAuth URL をフロントエンドに送信
            ↓
        [ユーザー] Google/GitHub/Notion の OAuth 同意画面で承認
            ↓
        [/oauth-complete コールバック]
            ↓ CompleteResourceTokenAuthCommand を実行
        [Token Vault (DynamoDB)]  トークンを永続化
            ↓
        [ユーザー] 手動リトライ → キャッシュ hit → 実行成功
```

初回認証はユーザーが OAuth 同意画面を経由する必要があり、**自動的には完了しない**。2回目以降はキャッシュから取得するため即座に実行される。

---

## 2. 主要コンポーネント

| コンポーネント | ファイル | 役割 |
|---|---|---|
| MCP クライアント | `src/agent/mcp/mcp_runtime_client.py` | JWT + コールバック URL をヘッダーに設定してリクエスト |
| Elicitation Bridge | `src/agent/mcp/elicitation_bridge.py` | OAuth 同意フローの待機・完了処理 |
| Token Vault | DynamoDB（本番）/ メモリ（ローカル） | トークンの永続化 |
| コールバックエンドポイント | `/oauth-complete` | 承認後の処理（`CompleteResourceTokenAuth` 実行） |

### MCP クライアントのヘッダー構成

```python
# src/agent/mcp/mcp_runtime_client.py
self.headers = {
    "Authorization": f"Bearer {cognito_jwt}",
    "MCP-OAuth2-Callback-URL": oauth_callback_url  # SSM Parameter Store から取得
}
```

### Elicitation Bridge の動作

```python
# src/agent/mcp/elicitation_bridge.py
async def handle_elicitation(self, elicitation_id, oauth_url):
    # 1. OAuth URL を SSE イベントキューに追加（フロントエンドへ送信）
    self.outbound_queue.put({"type": "oauth_elicitation", "oauth_url": oauth_url})

    # 2. ユーザー承認を待機（最大 300 秒）
    result = await self.elicitation_store.wait_for_completion(elicitation_id, timeout_seconds=300)

    # 3. AgentCore に Token Auth 完了を通知
    await self.orchestrator.complete_resource_token_auth(
        oauth_session_uri=result["oauth_session_uri"]
    )
```

Elicitation Bridge は本番（DynamoDB）とローカル開発（メモリ）の 2 モードを持ち、ローカルでも OAuth フローをテストできる。

---

## 3. インフラ側の設定（Terraform）

### OAuth プロバイダーの登録

```hcl
# infra/modules/oauth-providers/main.tf

# Google（Gmail / Google Calendar 共通）
resource "aws_bedrockagent_agent_action_group_credential_provider" "google_provider" {
  credential_provider_type = "GoogleOauth2"
  google_oauth2_credential_details = {
    client_id     = var.google_client_id
    client_secret = var.google_client_secret
  }
  prevent_destroy = true  # callback UUID が外部登録済みのため削除禁止
}

# GitHub（Custom OAuth2）
resource "aws_bedrockagent_agent_action_group_credential_provider" "github_provider" {
  credential_provider_type = "CustomOauth2"
  custom_oauth2_credential_details = {
    client_id     = var.github_client_id
    client_secret = var.github_client_secret
    auth_endpoint  = "https://github.com/login/oauth/authorize"
    token_endpoint = "https://github.com/login/oauth/access_token"
  }
  prevent_destroy = true
}

# Notion（Custom OAuth2）
resource "aws_bedrockagent_agent_action_group_credential_provider" "notion_provider" {
  credential_provider_type = "CustomOauth2"
  custom_oauth2_credential_details = {
    client_id     = var.notion_client_id
    client_secret = var.notion_client_secret
    auth_endpoint  = "https://api.notion.com/v1/oauth/authorize"
    token_endpoint = "https://api.notion.com/v1/oauth/token"
  }
  prevent_destroy = true
}
```

`prevent_destroy = true` は重要。プロバイダー削除→再作成すると callback UUID が変わり、外部 OAuth アプリへの登録が無効化されるため。

### コールバック URL の管理

1. Terraform が OAuth プロバイダーを作成 → 一意の callback UUID が生成される
2. CloudFront デプロイ後、`https://<CloudFront Domain>/oauth-complete` を SSM Parameter Store に保存
3. MCP クライアントが SSM から URL を取得し、ヘッダーに設定

### トークン設定（Cognito）

| トークン | 有効期限 |
|---|---|
| Access Token / ID Token | 8 時間 |
| Refresh Token | 30 日（Google テストアプリは 7 日） |

---

## 4. 各スキルの主要ツール

### Gmail (`skills/gmail/`)

| ツール | 操作 |
|---|---|
| `list_emails()` | ラベル別メール一覧 |
| `search_emails()` | クエリ構文での検索 |
| `read_email()` | 本文・添付ファイル取得 |
| `send_email()` | 送信（CC/BCC 対応） |
| `create_draft()` | 下書き作成 |
| `modify_email()` | ラベル追加/削除 |
| `bulk_delete_emails()` | 一括削除（**ユーザー承認必須**） |

### GitHub (`skills/github/`)

| ツール | 操作 | 承認 |
|---|---|---|
| `github_search_repos()` | リポジトリ検索 | 不要 |
| `github_list_issues()` | Issue 一覧 | 不要 |
| `github_get_file()` | ファイル取得 | 不要 |
| `github_create_branch()` | ブランチ作成 | **必須** |
| `github_push_file()` | ファイルコミット | **必須** |
| `github_create_pull_request()` | PR 作成 | **必須** |

書き込み操作はすべてユーザー承認が必須。自動実行不可の設計。

### Google Calendar (`skills/google-calendar/`)

| ツール | 操作 |
|---|---|
| `list_calendars()` | カレンダー一覧 |
| `list_events()` | イベント一覧（最大 100 件） |
| `create_event()` | イベント作成（参加者・リマインダー対応） |
| `quick_add_event()` | 自然言語でイベント作成（"明日3時に会議"） |
| `update_event()` | 更新 |
| `delete_event()` | 削除 |
| `check_availability()` | 空き時間確認 |

日時は RFC3339 形式（例: `2024-01-15T09:00:00Z`）。終日イベントは `YYYY-MM-DD` + `all_day=true`。

### Notion (`skills/notion/`)

| ツール | 操作 |
|---|---|
| `notion_search()` | ページ・DB 検索 |
| `notion_fetch()` | ページ内容を Markdown で取得 |
| `notion_create_page()` | ページ作成 |
| `notion_append_blocks()` | ブロック追加 |
| `notion_update_page()` | プロパティ更新 |

---

## 5. 設計上の特徴・注意点

### スキル実装は宣言的

スキル側は SKILL.md でツールを宣言するだけ。OAuth トークンの取得・管理・リフレッシュは AgentCore Identity が透過的に処理するため、スキル実装コードに認証ロジックは不要。

### トークン再同意が必要なケース

- 新しい Cognito セッション（JTI 値が変わる）
- Google テストアプリ使用中（Refresh Token が 7 日で失効）
- OAuth スコープ変更後のデプロイ
- ユーザーが外部サービス側で明示的に認可を取り消した場合

### ローカル開発での制約

ローカル開発環境（`agentcore dev`）では Identity フローはモックになる想定。実際の OAuth フローには AWS 環境へのデプロイが必要。

---

## 6. 参考ファイル（参照リポジトリ内）

| ファイル | 内容 |
|---|---|
| `docs/guides/THREE_LEGGED_OAUTH_FLOW.md` | 3LO OAuth フロー詳細ガイド |
| `docs/guides/GOOGLE_OAUTH_SETUP.md` | Google OAuth セットアップ手順 |
| `docs/guides/TROUBLESHOOTING.md` | トラブルシューティング |
| `infra/modules/oauth-providers/main.tf` | Terraform OAuth プロバイダー定義 |
| `infra/modules/auth/main.tf` | Cognito 設定 |
| `chatbot-app/agentcore/src/agent/mcp/elicitation_bridge.py` | Elicitation Bridge 実装 |
| `chatbot-app/agentcore/src/agent/mcp/mcp_runtime_client.py` | MCP クライアント実装 |
