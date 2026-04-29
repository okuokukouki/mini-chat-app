# シーケンス図 — Gmail OAuth フロー（3LO OAuth）

**最終更新**: 2026-04-29  
**対象ユースケース**: UC-5（Gmail 読み取り）

---

## 概要

Gmail スキルを初めて使う際の OAuth 認可フロー（3-Legged OAuth）。  
初回は Google の同意画面が表示され、ユーザーが承認する必要がある。  
2 回目以降は AgentCore Identity の Token Vault（DynamoDB）にキャッシュされたトークンが使われる。

---

## 初回認証フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant FE as Next.js
    participant Popup as OAuth ポップアップ
    participant RT as AgentCore Runtime
    participant Agent as Strands Agent
    participant LLM as Claude (Bedrock)
    participant SE as skill_executor
    participant MRC as MCPRuntimeClient
    participant EB as ElicitationBridge
    participant ACI as AgentCore Identity
    participant DDB as DynamoDB (Token Vault)
    participant Google as Google OAuth 2.0
    participant Gmail as Gmail API

    User->>FE: "Gmail の受信トレイを見せて"
    FE->>RT: POST /invocations\n{ prompt, session_id }\nBearer JWT

    RT->>RT: asyncio.Queue + ElicitationBridge 作成
    RT->>Agent: stream_async(prompt)
    Agent->>LLM: 推論（L1 カタログを含む）
    LLM->>Agent: skill_dispatcher("gmail")
    Agent-->>LLM: SKILL.md（L2）
    LLM->>Agent: skill_executor("gmail", "list_emails", "{}")
    Agent->>SE: skill_executor(...)
    SE->>SE: registry.get_type("gmail") → "mcp_runtime"
    SE->>MRC: MCPRuntimeClient 作成\n(provider_name="gmail", scopes=["gmail.readonly"])

    MRC->>ACI: MCP リクエスト\nAuthorization: Bearer {COGNITO_JWT}\nMCP-OAuth2-Callback-URL: {callback_url}
    ACI->>DDB: Token 照会（user_id + provider）
    DDB-->>ACI: キャッシュ miss（初回）
    ACI-->>MRC: OAuth 認可 URL を返却

    MRC->>EB: handle_elicitation(oauth_url) を呼び出し
    EB->>RT: Event Queue に { type: "oauth_url", url: "..." } を投入
    RT-->>FE: data: {"type":"oauth_url","url":"https://accounts.google.com/..."}\n（SSE）
    FE->>FE: window.open(url, 'oauth_popup', 'width=500,height=600')
    FE->>FE: ai バブルに「認証画面が開きました...」を追記

    Note over Popup,Google: ユーザーが Google 同意画面で Gmail への\nアクセスを承認する
    User->>Popup: 「許可」をクリック
    Google->>RT: GET /oauth-complete\n?session_id=xxx\n&session_uri=yyy\n&user_token=zzz

    RT->>ACI: IdentityClient.complete_resource_token_auth\n(session_uri, user_token)
    ACI->>DDB: アクセストークンを保存\n(user_id + "gmail" をキーに)
    DDB-->>ACI: 保存完了
    ACI-->>RT: 完了
    RT->>EB: emit_oauth_complete()
    EB->>RT: Event Queue に { type: "oauth_complete" } を投入
    RT-->>FE: data: {"type":"oauth_complete"}\n（SSE）
    FE->>Popup: popup.close()
    FE->>FE: ai バブルに「認証が完了しました...」を追記
    FE->>User: 「再送信してください」の案内を表示
```

---

## 2 回目以降（キャッシュ hit）

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant FE as Next.js
    participant RT as AgentCore Runtime
    participant SE as skill_executor
    participant MRC as MCPRuntimeClient
    participant ACI as AgentCore Identity
    participant DDB as DynamoDB (Token Vault)
    participant Gmail as Gmail API

    User->>FE: "Gmail の受信トレイを見せて"（再送信）
    FE->>RT: POST /invocations

    Note over RT,MRC: skill_executor → MCPRuntimeClient まで同様

    MRC->>ACI: MCP リクエスト\nAuthorization: Bearer JWT\nCallback URL: ...
    ACI->>DDB: Token 照会
    DDB-->>ACI: キャッシュ hit → アクセストークン返却
    ACI->>Gmail: Gmail API 呼び出し\n(list emails)
    Gmail-->>ACI: メール一覧 JSON
    ACI-->>MRC: 結果
    MRC-->>SE: 結果
    SE-->>RT: メールデータ
    RT-->>FE: SSE テキストトークン
    FE->>User: メール一覧を表示
```

---

## ポイント解説

### ElicitationBridge の役割

`ElicitationBridge` は OAuth フロー中に処理を「中断」して SSE に OAuth URL を流し込むためのブリッジ。  
`asyncio.Queue` を介して `invoke` ジェネレータと通信するため、Agent の実行を止めずにイベントを注入できる。

### in_memory モード（ローカル開発）

`ELICITATION_MODE=in_memory` の場合は AgentCore Identity を呼び出さず、即座に完了扱いとなる。  
実際の Gmail OAuth フローは AWS デプロイ後にのみ動作する。

### RemovalPolicy.RETAIN（MiniChatIdentityStack）

AgentCore Identity リソースを削除すると callback UUID が変わり、  
Google Cloud Console に登録したリダイレクト URI が無効になる。  
このため `RemovalPolicy.RETAIN` を設定して削除を禁止している。

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-29 | 初版作成 |
