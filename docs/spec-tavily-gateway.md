# Tavily Gateway 実装 Spec

**ステータス**: 実装完了  
**関連調査**:
- [`docs/tavily-gateway-investigation.md`](tavily-gateway-investigation.md)
- [`docs/infra-cdk-investigation.md`](infra-cdk-investigation.md)

---

## 決定事項

| # | 項目 | 決定内容 |
|---|---|---|
| D-1 | 実装方式 | **Lambda Gateway**（参照 repo と同構成） |
| D-2 | API キー管理 | **Secrets Manager**（IaC でリソース作成、CLI で値を設定） |
| D-3 | 提供ツール | **tavily_search + tavily_extract**（参照 repo に合わせる） |
| D-4 | スキルシステム | **実装する**（skill_dispatcher / skill_executor） |
| D-5 | 既存ツール | **calculator / weather を削除**（Code Interpreter / Tavily で機能充足） |
| D-6 | IaC ツール | **CDK TypeScript**（参照 repo の gateway-stack に倣う） |
| D-7 | Lambda ランタイム | **Python 3.13 / ARM64**（参照 repo と同じ。本プロジェクト Python 3.14 は Lambda 非対応） |
| D-8 | IaC 配置場所 | **`infra/gateway/`**（プロジェクトルート直下、参照 repo に倣う） |
| D-9 | Gateway 認証 | **AWS IAM（SigV4）**（参照 repo と同じ。Cognito は本プロジェクト未使用のため除外） |

---

## アーキテクチャ

```
【ローカル】
AgentCore Runtime (port 8080)
  └─ Strands Agent
       ├─ skill_dispatcher  ── SKILL.md を読んでスキル情報を返す（L2）
       ├─ skill_executor    ── スキル種別を判定して実行（L3）
       │     └─ MCP Tool? → FilteredMCPClient（SigV4 署名）
       ├─ execute_code      ── AgentCore Code Interpreter
       └─ browse_web        ── AgentCore Browser

【AWS】
AgentCore Gateway（IAM 認証）
  └─ Gateway Target: tavily-search___tavily_search
  └─ Gateway Target: tavily-search___tavily_extract
       └─ Lambda 関数（Python 3.13 / ARM64）
            └─ Secrets Manager（TAVILY_API_KEY）
```

---

## デプロイ手順

```bash
# 1. CDK ブートストラップ（初回のみ）
cd infra/gateway
npx cdk bootstrap

# 2. スタックをデプロイ（IamStack → GatewayStack の順）
npx cdk deploy --all

# 3. Tavily API キーを Secrets Manager に設定
aws secretsmanager put-secret-value \
  --secret-id mini-chat-app/tavily-api-key \
  --secret-string '{"TAVILY_API_KEY": "<YOUR_TAVILY_API_KEY>"}'

# 4. Gateway エンドポイント URL を取得して agentcore/.env.local に設定
aws cloudformation describe-stacks \
  --stack-name MiniChatGatewayStack \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayUrl'].OutputValue" \
  --output text
# → agentcore/.env.local に GATEWAY_ENDPOINT=<取得したURL> を記載
```

---

## 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-04-26 | 初版作成・全決定事項確定・実装詳細記載 |
| 2026-04-26 | 実装完了につき実装テンプレート・計画セクションを削除、決定事項・アーキテクチャ・デプロイ手順のみ残存 |
