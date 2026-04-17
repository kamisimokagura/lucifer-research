# X スレッド投稿文 — lucifer-research v0.1.0

> リポジトリを **public** にしてから投稿。画像（docs/x-ogp-image.svg → PNG）を Post 1 に添付推奨。

---

## Post 1 / 5

```
🌟 lucifer-research v0.1.0 リリースしました！

AIエージェント・研究者向けマルチプラットフォームコンテンツ抽出パイプライン。

YouTube / X / GitHub / HN / Bluesky / Qiita / note / Zenn / Medium…
URLひとつで構造化データを取得できます ✦

🔗 https://github.com/kamisimokagura/lucifer-research

#OSS #TypeScript #MCP #Claude
```

---

## Post 2 / 5

```
📦 何ができる？

extract(url) → ResearchResult を返す型付きオブジェクト

・title, content (Markdown)
・platform 判定（youtube / x / github / bluesky…）
・engagement（いいね・スター・再生数・RT・コメント数）
・trust score（プロンプトインジェクション検出時に警告付加）

APIが失敗しても自動フォールバック 🔄
API → RSS → Jina Reader → Readability
```

---

## Post 3 / 5

```
🔌 MCP server として Claude Code / Cursor / Windsurf に統合できます

~/.claude/settings.json に追加するだけ：

{
  "lucifer-research": {
    "command": "node",
    "args": ["/path/to/mcp/dist/index.js"]
  }
}

提供ツール:
  lucifer_extract  — 単一URL抽出
  lucifer_pipeline — 最大20URLを並列実行

APIキーなしでも動作します（レート制限下）
```

---

## Post 4 / 5

```
🔒 セキュリティ重視の設計

・SSRF プロテクション
  （127.x / 10.x / 172.16–31.x / 192.168.x / クラウドメタデータ）

・プロンプトインジェクション検出（72テスト全通過）
  "ignore previous instructions" 等を検出 → trust.warning 付加

・HTTPS 限定・data URI 拒否

AIエージェントが悪意あるURLを踏んでも安全に。
trust.score と trust.warning で透明性を確保。
```

---

## Post 5 / 5

```
⭐ スターとフィードバックをお待ちしています！

git clone https://github.com/kamisimokagura/lucifer-research
npm ci && npm run build

Issue・PR 歓迎 🙏

光は最も深い闇から生まれる。
lucifer-research — 光の堕天使が、Webの情報を照らします ✦

#AI #OSS #研究 #TypeScript #AIエージェント
```

