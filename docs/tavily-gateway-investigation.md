# 参照リポジトリにおける Tavily ツールの実装調査

**調査対象**: https://github.com/aws-samples/sample-strands-agent-with-agentcore  
**調査日**: 2026-04-26

---

## 結論（サマリー）

参照リポジトリにおける Tavily は **Lambda ターゲット型の AgentCore Gateway ツール** として実装されている。`@tool` のローカル実装ではなく、以下のフローで動作する。

```
Strands Agent
  → skill_executor（MCP ツール判定）
  → FilteredMCPClient（Bearer JWT 認証）
  → AgentCore Gateway
  → Lambda 関数（tavily/lambda_function.py）
  → Tavily REST API（https://api.tavily.com）
```

---

## 1. スキル定義（SKILL.md）

`chatbot-app/agentcore/skills/tavily-search/SKILL.md`

```yaml
---
name: tavily-search
description: AI-powered web search and content extraction
---
```

SKILL.md は以下の 2 つのツールを定義する。

| ツール名 | 説明 | 主なパラメータ |
|---|---|---|
| `tavily_search` | AI 精選の Web 検索 | `query`, `search_depth`（basic/advanced）, `topic`（general/news/research） |
| `tavily_extract` | URL からコンテンツ抽出 | `urls`（カンマ区切り）, `extract_depth`（basic/advanced） |

---

## 2. Lambda 関数の実装

`agent-blueprint/agentcore-gateway-stack/lambda-functions/tavily/lambda_function.py`

### ツール名のルーティング

Lambda はコンテキストからツール名を取得し、処理を分岐する。

```python
tool_name = context.client_context.custom.get('bedrockAgentCoreToolName', '')
if '___' in tool_name:
    tool_name = tool_name.split('___')[-1]  # "tavily-search___tavily_search" → "tavily_search"
```

Gateway がツール名を `<スキル名>___<ツール名>` 形式で Lambda に渡す仕組み。

### API キー管理（3 段階フォールバック）

```python
# 優先度: ユーザー指定 → Secrets Manager → 環境変数
1. params の __user_api_keys.tavily_api_key
2. Secrets Manager（TAVILY_API_KEY_SECRET_NAME 環境変数で指定）
3. 環境変数 TAVILY_API_KEY（ローカルテスト用）
```

### tavily_search の実装骨格

```python
response = requests.post(
    "https://api.tavily.com/search",
    json={
        "api_key": api_key,
        "query": query,
        "search_depth": search_depth,  # "basic" or "advanced"
        "topic": topic,                 # "general", "news", "research"
        "max_results": 5,
        "include_images": False,
        "include_raw_content": False
    },
    timeout=30
)
```

### レスポンス形式（MCP 準拠）

```python
# 成功
{"statusCode": 200, "body": {"content": [{"type": "text", "text": "..."}]}}

# エラー
{"statusCode": 400, "body": {"error": "..."}}
```

---

## 3. Gateway 側の MCP クライアント

`chatbot-app/agentcore/src/agent/gateway/mcp_client.py`

### FilteredMCPClient の役割

エージェント側（Python）から Gateway の MCP エンドポイントに接続するクライアント。

```python
class BearerAuth(httpx.Auth):
    """JWT トークンを Authorization ヘッダーに付与"""
    def __call__(self, request):
        request.headers["Authorization"] = f"Bearer {self.token}"
        return request
```

### ツール名の簡略化

Gateway は `<スキル名>___<ツール名>` 形式でツールを公開するが、クライアント側で短縮名にマッピングする。

```python
# Gateway の完全名 → エージェントが呼ぶ短縮名
"tavily-search___tavily_search"  →  "tavily_search"
"tavily-search___tavily_extract" →  "tavily_extract"
```

### ツール呼び出しフロー

```python
# Claude がツールを呼ぶ
skill_executor("tavily-search", "tavily_search", {"query": "..."})
  → FilteredMCPClient.call_tool_sync()   # 360 秒タイムアウト
  → Gateway（Bearer JWT 認証）
  → Lambda 実行
  → MCP レスポンス返却
```

---

## 4. スキルシステムとの統合

### skill_tools.py の判定ロジック

`skill_executor` はツール種別を判定して実行方式を切り替える。

```
skill_executor 呼び出し
  ├─ MCP Tool?    → FilteredMCPClient.call_tool_sync() （Tavily はここ）
  ├─ Local Tool?  → 関数を直接呼び出し
  └─ Script?      → シェルで実行
```

### エージェントへのツール登録

`src/agent/tool_filter.py` が 4 種類のツール源を統合管理する。

```python
# 4 種類のツール源
Local Tools    → @tool デコレータで定義した Python 関数
Builtin Tools  → code_interpreter, browser 等（bedrock-agentcore SDK）
Gateway Tools  → FilteredMCPClient 経由（Tavily, Wikipedia 等）← Tavily はここ
MCP Runtime    → OAuth 連携ツール（Gmail, GitHub 等）
```

---

## 5. 本プロジェクトとの差分

| 項目 | 参照リポジトリ | 本プロジェクト（現状） |
|---|---|---|
| Tavily の接続方式 | Gateway → Lambda → Tavily API | 未実装 |
| API キー管理 | Secrets Manager | — |
| ツール登録 | FilteredMCPClient（MCP 経由） | — |
| スキル定義 | SKILL.md + `@skill` デコレータ | — |

---

## 6. 本プロジェクトで再現する場合の必要要素

Lambda ターゲット型で実装する場合：

1. **Lambda 関数** — `lambda_function.py` を AWS にデプロイ
2. **Secrets Manager** — Tavily API キーを登録
3. **AgentCore Gateway** — Lambda を MCP エンドポイントとして登録
4. **FilteredMCPClient** — エージェント側の MCP クライアント実装
5. **SKILL.md** — `agentcore/skills/tavily-search/SKILL.md` に配置

> ローカル開発のみで Tavily を試す場合は、`@tool` + `tavily-python` パッケージによるローカルツール実装が最も手軽（Gateway 不要）。
