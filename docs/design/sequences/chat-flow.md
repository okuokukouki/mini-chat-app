# シーケンス図 — チャットフロー（通常会話）

**最終更新**: 2026-04-29  
**対象ユースケース**: UC-1（テキストチャット）・UC-2（Web 検索 / Tavily）

---

## 概要

ユーザーがメッセージを送信してから回答が表示されるまでの流れ。  
スキルが不要な場合と、Tavily スキル（Gateway 経由）が必要な場合の 2 パターンを示す。

---

## シーケンス図

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant FE as Next.js
    participant RT as AgentCore Runtime
    participant Agent as Strands Agent
    participant LLM as Claude (Bedrock)
    participant SD as skill_dispatcher
    participant SE as skill_executor
    participant GW as AgentCore Gateway
    participant Lambda as Lambda (Tavily)
    participant TV as Tavily API

    User->>FE: メッセージ入力・Enter / 送信ボタン
    FE->>FE: messages に user バブル追加
    FE->>FE: messages に空の ai バブル追加
    FE->>RT: POST /invocations\nBody: { prompt, session_id }\nHeader: Bearer JWT（本番のみ）

    RT->>RT: セッションから Agent 取得\n（なければ create_agent() で新規生成）
    RT->>RT: asyncio.Queue + ElicitationBridge 作成
    RT->>Agent: stream_async(prompt) をタスクとして起動

    Agent->>LLM: 推論リクエスト\n（L1 スキルカタログをシステムプロンプトに含む）

    alt スキル不要（直接回答できる場合）
        LLM-->>Agent: テキストトークンをストリーム
        loop 各トークン
            Agent-->>RT: { "data": "トークン文字列" }
            RT-->>FE: data: "トークン文字列"\n（SSE）
            FE->>FE: appendToLastAiMessage(token)
        end

    else Tavily スキルが必要な場合
        LLM->>Agent: tool_call: skill_dispatcher\n( skill_name="tavily-search" )
        Agent->>SD: skill_dispatcher("tavily-search")
        SD-->>Agent: { instructions: "...", available_tools: [...] }
        Agent-->>LLM: L2 スキル情報（SKILL.md 内容 + ツール一覧）

        LLM->>Agent: tool_call: skill_executor\n( skill_name="tavily-search"\n  tool_name="tavily_search"\n  tool_input='{"query":"..."}' )
        Agent->>SE: skill_executor(...)
        SE->>SE: registry.get_type("tavily-search") → "gateway"
        SE->>GW: FilteredMCPClient.call_tool\n("tavily-search___tavily_search", {query})\nSigV4 署名
        GW->>Lambda: InvokeFunction
        Lambda->>TV: 検索 API 呼び出し
        TV-->>Lambda: 検索結果 JSON
        Lambda-->>GW: 結果
        GW-->>SE: 結果
        SE-->>Agent: 検索結果
        Agent-->>LLM: tool_result（検索結果）

        LLM-->>Agent: テキストトークンをストリーム（検索結果をもとに回答）
        loop 各トークン
            Agent-->>RT: { "data": "トークン文字列" }
            RT-->>FE: data: "トークン文字列"\n（SSE）
            FE->>FE: appendToLastAiMessage(token)
        end
    end

    Note over RT: pump_agent タスク完了 → Queue に None を投入
    RT-->>FE: SSE ストリーム終了（接続クローズ）
    FE->>FE: isLoading = false
    FE->>User: 回答表示完了
```

---

## ポイント解説

### セッション管理

- `session_id` はフロントエンドが `crypto.randomUUID()` で生成し、ページ存続中は固定
- Runtime はセッション対応の Agent をインメモリ dict で管理する
- 同じ `session_id` でリクエストするたびに同一 Agent が使われ、会話履歴が維持される

### SSE バッファリング

- フロントエンドは TCP チャンクを `buffer` に積み上げ、`\n` で区切れた行のみ処理する
- これにより 1 つの SSE イベントが複数チャンクに分割されても正しく処理できる

### L1 → L2 → L3 の段階的開示

- L1: システムプロンプトに `get_catalog()` の結果が埋め込まれており、LLM は常に全スキルを把握している
- L2: 必要なスキルを `skill_dispatcher` で呼び出し、使い方（SKILL.md 本文）を取得
- L3: `skill_executor` で実際のツールを実行する

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-29 | 初版作成 |
