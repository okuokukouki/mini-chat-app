---
name: tavily-search
description: AI-powered web search and content extraction
---

# tavily-search スキル

Web 検索とコンテンツ抽出を提供するスキル。最新情報の調査や特定 URL のコンテンツ取得に使用する。

## 使用可能なツール

### tavily_search

AI が精選した Web 検索を実行する。

**パラメータ:**
- `query` (必須): 検索クエリ
- `search_depth` (省略可): `basic`（標準）または `advanced`（詳細） — デフォルト: `basic`
- `topic` (省略可): `general`、`news`、`research` — デフォルト: `general`

**使用例:**
- 最新ニュースを調べる → `topic: "news"`, `search_depth: "basic"`
- 技術的な詳細調査 → `topic: "research"`, `search_depth: "advanced"`

### tavily_extract

指定した URL からコンテンツを抽出する。

**パラメータ:**
- `urls` (必須): カンマ区切りの URL リスト
- `extract_depth` (省略可): `basic` または `advanced` — デフォルト: `basic`

**使用例:**
- 特定の記事の内容を取得する → `urls: "https://example.com/article"`

## 使い分けガイド

| 状況 | 推奨ツール |
|------|-----------|
| 最新情報を調べたい | tavily_search |
| 特定の URL の内容を読みたい | tavily_extract |
| 複数のページを比較したい | tavily_extract（カンマ区切りで複数 URL） |
