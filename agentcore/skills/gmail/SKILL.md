---
name: gmail
description: Gmail の受信トレイの読み取り・検索ができるスキル
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
  指定した ID のメール本文を取得する

## Usage Guidelines

- メールを検索するときは search_emails を使う
- メール本文が必要な場合は read_email で ID を指定して取得する
- 個人情報を含む出力は要約して表示すること
