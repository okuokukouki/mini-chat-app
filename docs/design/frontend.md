# フロントエンド詳細設計

**最終更新**: 2026-04-29（Entra ID 認証追加）  
**対象ディレクトリ**: `frontend/src/`  
**関連ドキュメント**: [`architecture.md`](architecture.md)

---

## ファイル構成

```
frontend/src/
└── app/
    ├── page.tsx          # チャット画面（唯一のページ）
    ├── page.module.css   # チャット UI のスタイル
    ├── layout.tsx        # Next.js レイアウト（ルート）
    └── globals.css       # グローバルスタイル
```

本プロジェクトはページが 1 つだけのシンプルな Single Page Application。

---

## コンポーネント構造

```mermaid
graph TD
    ChatPage["ChatPage\n(page.tsx のデフォルトエクスポート)"]

    subgraph State["useState で管理する状態"]
        S1["messages: Message[]"]
        S2["input: string"]
        S3["isLoading: boolean"]
        S4["sessionId: string\n(ページロード時に固定)"]
        S5["account: AccountInfo | null\n(Entra ID ログイン済みアカウント)"]
        S6["msalReady: boolean\n(MSAL 初期化完了フラグ)"]
    end

    subgraph Ref["useRef で管理するオブジェクト"]
        R1["chatRef\n(スクロール制御用 div)"]
        R2["oauthPopupRef\n(OAuth ポップアップ Window)"]
        R3["msalRef\n(PublicClientApplication)"]
    end

    subgraph UI["描画要素"]
        U1["header\n(タイトル + ログインボタン / アカウント名)"]
        U2["div.chat\n(メッセージ一覧)"]
        U3["div.inputArea\n(テキスト入力 + 送信ボタン)"]
    end

    ChatPage --> State
    ChatPage --> Ref
    ChatPage --> UI
```

---

## 型定義

```typescript
interface Message {
  role: 'user' | 'ai';
  content: string;
}
```

---

## 状態管理

| 状態 | 型 | 初期値 | 説明 |
|---|---|---|---|
| `messages` | `Message[]` | `[]` | 画面に表示するメッセージ履歴 |
| `input` | `string` | `""` | テキスト入力フィールドの現在値 |
| `isLoading` | `boolean` | `false` | SSE ストリーミング中かどうか |
| `sessionId` | `string` | `crypto.randomUUID()` | バックエンドとの会話セッション識別子 |
| `account` | `AccountInfo \| null` | `null` | Entra ID でログイン済みのアカウント情報 |
| `msalReady` | `boolean` | `false` | MSAL の `initialize()` 完了フラグ |

`sessionId` は `useState` の初期化関数で 1 度だけ生成され、ページ再読み込みまで固定される。  
これによりページ内での会話履歴がバックエンドで保持される。

---

## API 呼び出し仕様

### エンドポイント

```
POST {NEXT_PUBLIC_AGENTCORE_ENDPOINT}/invocations
```

環境変数の優先順位:
1. `NEXT_PUBLIC_AGENTCORE_ENDPOINT`
2. `http://localhost:8080`（フォールバック）

### リクエスト

```json
{
  "prompt": "ユーザーが入力したメッセージ",
  "session_id": "uuid-v4"
}
```

ヘッダー:
```
Content-Type: application/json
Authorization: Bearer <Entra ID ID トークン>
```

### レスポンス（SSE）

レスポンスは Server-Sent Events（SSE）形式。各行は `data: <JSON文字列>` の形式。

**テキストトークン（通常回答）**:
```
data: "こんにちは"
data: "！"
data: "何かお手伝いできますか？"
```

**OAuth URL イベント**:
```
data: {"type":"oauth_url","url":"https://accounts.google.com/o/oauth2/..."}
```

**OAuth 完了イベント**:
```
data: {"type":"oauth_complete"}
```

---

## SSE パース処理

```mermaid
flowchart TD
    A["fetch → ReadableStream"] --> B["getReader()"]
    B --> C["read() でチャンク取得"]
    C --> D["TextDecoder でデコード"]
    D --> E["バッファに追記"]
    E --> F["'\\n' で分割"]
    F --> G{"data: で始まる行?"}
    G -->|"No"| C
    G -->|"Yes"| H["handleSseEvent(line.slice(6))"]
    H --> I{"JSON.parse 成功?"}
    I -->|"失敗"| C
    I -->|"成功"| J{"型判定"}
    J -->|"string"| K["appendToLastAiMessage(text)"]
    J -->|"type=oauth_url"| L["window.open(url)\nポップアップ表示"]
    J -->|"type=oauth_complete"| M["popup.close()\n完了メッセージ表示"]
    K --> C
    L --> C
    M --> C
```

**バッファリングの理由**: SSE の 1 イベントが複数の TCP チャンクに分割されて届く場合があるため、  
`\n` で区切れた行のみ処理し、途中の行はバッファに残す。

---

## OAuth ポップアップ処理

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant Popup as ポップアップ (window.open)
    participant RT as AgentCore Runtime

    FE->>FE: oauth_url SSE イベント受信
    FE->>Popup: window.open(url, 'oauth_popup', 'width=500,height=600')
    Note over Popup: ユーザーが Google 同意画面で承認
    Popup->>RT: GET /oauth-complete?session_id=...
    RT-->>FE: data: {"type":"oauth_complete"} (SSE)
    FE->>Popup: popup.close()
    FE->>FE: 「再送信してください」メッセージ表示
```

- `oauthPopupRef` で `Window` オブジェクトへの参照を保持し、完了時に `close()` を呼ぶ
- ポップアップのサイズ: 幅 500px・高さ 600px（Google 同意画面の標準サイズ）

---

## 画面レイアウト

```
┌─────────────────────────────────┐
│        Mini Chat App            │  ← header
├─────────────────────────────────┤
│                                 │
│  [user]  こんにちは              │
│                                 │
│  [ai]    こんにちは！            │  ← div.chat（スクロール可能）
│          何かお手伝いできますか？ │
│                      ▊          │  ← .streaming クラスで点滅
│                                 │
├─────────────────────────────────┤
│  [テキスト入力フィールド] [送信]  │  ← div.inputArea
└─────────────────────────────────┘
```

- `useEffect` でメッセージ更新のたびに `chatRef.current.scrollTop = scrollHeight` を実行してスクロール
- `isLoading` 中は入力フィールドと送信ボタンを `disabled` にする
- ストリーミング中の最後の AI バブルには `.streaming` クラスを付与（CSS でアニメーション）

---

## Entra ID 認証フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant FE as フロントエンド
    participant Entra as Entra ID
    participant RT as AgentCore Runtime

    FE->>Entra: msalInstance.initialize()
    FE->>FE: getAllAccounts() で既存セッション復元

    User->>FE: 「Entra ID でログイン」ボタン押下
    FE->>Entra: loginPopup({ scopes: ['openid','profile','email'] })
    Entra-->>FE: AuthenticationResult（idToken 含む）
    FE->>FE: setAccount(result.account)

    User->>FE: チャット送信
    FE->>Entra: acquireTokenSilent({ account })
    Entra-->>FE: idToken（JWT）
    FE->>RT: POST /invocations\nAuthorization: Bearer <idToken>
    RT-->>FE: SSE ストリーム
```

- MSAL インスタンスは `useRef` で保持（再レンダリングで再生成しない）
- `acquireTokenSilent` 失敗時（`InteractionRequiredAuthError`）は自動で `loginPopup` にフォールバック

---

## 環境変数

| 変数名 | 用途 | `.env.local` | `.env.production` |
|---|---|---|---|
| `NEXT_PUBLIC_AGENTCORE_ENDPOINT` | Runtime エンドポイント URL | クラウド Runtime URL | クラウド Runtime URL |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID` | Entra ID アプリのクライアント ID | `4f499ada-...` | `4f499ada-...` |
| `NEXT_PUBLIC_ENTRA_TENANT_ID` | Entra ID テナント ID | `32b23daa-...` | `32b23daa-...` |

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-29 | 初版作成 |
| 2026-04-29 | Entra ID（MSAL）認証追加。Cognito 変数を Entra ID 変数に置き換え |
