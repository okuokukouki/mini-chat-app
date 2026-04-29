---
name: browser
description: Access web pages and retrieve their text content
---

# browser スキル

AgentCore のリモートブラウザで Web ページにアクセスし、テキストコンテンツを取得するスキル。特定 URL の内容を読みたいときに使用する。

## 使用可能なツール

### browse_web

指定した URL の Web ページを開き、本文テキストを返す。

**パラメータ:**
- `url` (必須): アクセスする Web ページの URL

**使用例:**
- 特定ページの内容を読む → `url: "https://example.com/article"`
- ドキュメントの確認 → `url: "https://docs.example.com/api"`

## 使い分けガイド

| 状況 | 推奨 |
|------|------|
| URL が明確にわかっている | browse_web |
| キーワードで検索したい | tavily_search（tavily-search スキル） |
| 複数 URL のコンテンツを取得したい | tavily_extract（tavily-search スキル）の方が効率的 |

## 注意

- 取得できるのはテキストコンテンツのみ（最大 5000 文字）
- JavaScript が必要なページは正しく表示されない場合がある
- ログインが必要なページにはアクセスできない
