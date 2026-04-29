# シーケンス図 — スキルディスパッチフロー（L1 → L2 → L3）

**最終更新**: 2026-04-29  
**対象コンポーネント**: `skill/skill_registry.py` / `skill/skill_tools.py`

---

## 概要

Strands Agent がスキルを「発見 → 理解 → 実行」する 3 段階の流れ（段階的開示）。  
スキルをすべてシステムプロンプトに含めるとトークンコストが増大するため、  
必要なスキルだけを段階的にロードすることでプロンプトサイズを最小化する。

---

## L1（カタログ）→ L2（使い方取得）→ L3（実行）の全体フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant FE as Next.js
    participant RT as AgentCore Runtime
    participant Agent as Strands Agent
    participant LLM as Claude (Bedrock)
    participant SD as skill_dispatcher
    participant SE as skill_executor
    participant Reg as SkillRegistry
    participant GW as AgentCore Gateway
    participant Lambda as Lambda (Tavily)

    User->>FE: "AI について Tavily で検索して"
    FE->>RT: POST /invocations

    Note over Agent,LLM: 【L1 フェーズ】\nシステムプロンプトにスキルカタログが埋め込まれている
    Agent->>LLM: プロンプト送信\n（system: "利用可能なスキル:\n- tavily-search: Web検索...\n- gmail: Gmail読み取り..." ）

    LLM->>Agent: （tavily-search が必要と判断）\ntool_call: skill_dispatcher\n( skill_name="tavily-search" )

    Note over SD,Reg: 【L2 フェーズ】\nSKILL.md を読んで使い方とツール一覧を返す
    Agent->>SD: skill_dispatcher("tavily-search")
    SD->>Reg: load_instructions("tavily-search")
    Reg-->>SD: SKILL.md 本文（使い方・Usage Guidelines）
    SD->>Reg: get_tools("tavily-search")
    Reg-->>SD: ツール関数リスト
    SD-->>Agent: {\n  "instructions": "# Tavily Search...",\n  "available_tools": ["tavily_search", "tavily_extract"]\n}
    Agent-->>LLM: tool_result（L2 スキル情報）

    LLM->>Agent: （使い方を理解した上でツール選択）\ntool_call: skill_executor\n( skill_name="tavily-search"\n  tool_name="tavily_search"\n  tool_input='{"query":"AI","max_results":5}' )

    Note over SE,Lambda: 【L3 フェーズ】\nスキルタイプを判定して実際のツールを実行
    Agent->>SE: skill_executor("tavily-search", "tavily_search", '{"query":"AI"}')
    SE->>Reg: get_type("tavily-search")
    Reg-->>SE: "gateway"
    SE->>SE: GATEWAY_ENDPOINT 確認（設定済み）
    SE->>GW: FilteredMCPClient.call_tool\n( "tavily-search___tavily_search"\n  { query: "AI", max_results: 5 } )\n※ SigV4 署名付きリクエスト
    GW->>Lambda: InvokeFunction
    Lambda-->>GW: { results: [...] }
    GW-->>SE: 検索結果 JSON
    SE-->>Agent: 検索結果
    Agent-->>LLM: tool_result（検索結果）

    LLM-->>Agent: テキスト回答をストリーム
    Agent-->>RT: トークン
    RT-->>FE: SSE
    FE->>User: 回答表示
```

---

## スキルタイプ別の L3 実行経路

```mermaid
flowchart TD
    A["skill_executor 呼び出し"] --> B["SkillRegistry.get_type(skill_name)"]

    B --> C{{"スキルタイプ"}}

    C -->|"mcp_runtime\n（gmail）"| D["MCPRuntimeClient\n→ AgentCore Identity\n→ Gmail API"]

    C -->|"local\n（execute_code / browse_web）"| E["SkillRegistry.get_tools()\nでツール関数を検索"]
    E --> F["tool_fn(**params)\n関数を直接呼び出し"]

    C -->|"gateway\n（tavily-search）"| G{"GATEWAY_ENDPOINT\n設定済み?"}
    G -->|"Yes"| H["FilteredMCPClient\nSigV4 署名\n→ AgentCore Gateway\n→ Lambda"]
    G -->|"No"| I["エラーメッセージを返す\n（GATEWAY_ENDPOINT 未設定）"]
```

---

## SKILL.md のフォーマット（参考）

スキルの動作は `agentcore/skills/<スキル名>/SKILL.md` で定義する。

```markdown
---
name: tavily-search          # スキル名（L1 カタログのキー）
description: Search and extract content from the web using Tavily  # L1 で表示する 1 行説明
type: gateway                # local / gateway / mcp_runtime
---

# Tavily Search               ← ここから L2 の instructions（SKILL.md 本文）

## Available Tools
- tavily_search(query, max_results=5)
- tavily_extract(urls)

## Usage Guidelines
- Web 検索には tavily_search を使う
...
```

| frontmatter フィールド | L で使われるタイミング |
|---|---|
| `description` | L1（スキルカタログに含まれる） |
| `type` | L3（skill_executor の実行経路判定） |
| `scopes` | L3（MCPRuntimeClient の OAuth スコープ設定） |
| SKILL.md 本文 | L2（skill_dispatcher が返す instructions） |

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-29 | 初版作成 |
