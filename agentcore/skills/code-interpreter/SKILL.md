---
name: code-interpreter
description: Execute Python/JavaScript/TypeScript code in a secure sandbox
---

# code-interpreter スキル

AgentCore のサンドボックス環境でコードを実行するスキル。計算・データ処理・ファイル操作など、コードで解決できるタスクに使用する。

## 使用可能なツール

### execute_code

指定した言語のコードをサンドボックスで実行し、出力を返す。

**パラメータ:**
- `code` (必須): 実行するコード
- `language` (省略可): 実行言語 — `python`（デフォルト）、`javascript`、`typescript`

**使用例:**
- 数値計算 → `language: "python"`, `code: "print(2 ** 10)"`
- データ変換 → Python でリスト操作やファイル読み書き
- JavaScript 処理 → `language: "javascript"`

## 使い分けガイド

| 状況 | 備考 |
|------|------|
| 数値計算・統計処理 | Python の math / statistics ライブラリが使用可能 |
| JSON / CSV 操作 | Python の json / csv ライブラリが使用可能 |
| アルゴリズムの検証 | 任意のコードを実行できる |

## 注意

- サンドボックス外への接続やファイルシステムへの永続保存はできない
- 実行ごとに独立した環境ではなく、セッション内で状態を保持する場合がある
