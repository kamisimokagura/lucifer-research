# lucifer-research v0.1.0 — X 発表スレッド

> **注意**: リポジトリを public にしてから投稿すること。
> GitHubリリース: https://github.com/kamisimokagura/lucifer-research/releases/tag/v0.1.0

---

## スレッド構成（5 posts）

画像は `docs/x-ogp-image.svg` を PNG に変換して Post 1 に添付。

---

### Post 1 — アナウンス（メインフック）

```
🌟 lucifer-research v0.1.0 リリースしました！

AIエージェント・研究者向けのマルチプラットフォームコンテンツ抽出パイプライン。

YouTube / X / GitHub / HN / Bluesky / Qiita / note / Zenn / Medium…
URLひとつで構造化データを取得できます ✦

🔗 https://github.com/kamisimokagura/lucifer-research

#OSS #TypeScript #MCP #Claude
```

> 文字数: ~140 / 画像添付推奨（OGP画像）

---

### Post 2 — 何ができる？（技術詳細）

```
📦 何ができる？

`extract(url)` → ResearchResult を返す型付きオブジェクト

• title, content (Markdown)
• platform 判定（youtube / x / github / bluesky…）
• engagement（いいね・スター・再生数・RT・コメント数）
• trust score（プロンプトインジェクション検出時に警告付加）

APIが失敗しても自動フォールバック 🔄
API → RSS → Jina Reader → Readability
```

> 文字数: ~175

---

### Post 3 — MCP 統合（Claude Code ユーザー向け）

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

> 文字数: ~190（コードブロック含む）

---

### Post 4 — セキュリティ（信頼性アピール）

```
🔒 セキュリティ重視の設計

• SSRF プロテクション
  （127.x / 10.x / 172.16-31.x / 192.168.x / リンクローカル / クラウドメタデータ）

• プロンプトインジェクション検出（72テスト全通過）
  "ignore previous instructions" 等のパターンを検出 → trust.warning 付加

• HTTPS 限定・data URI 拒否

AIエージェントが悪意あるURLを踏んでも安全に。
trust.score と trust.warning で透明性を確保。
```

> 文字数: ~200

---

### Post 5 — CTA（締め）

````
⭐ スターとフィードバックをお待ちしています！

```sh
git clone https://github.com/kamisimokagura/lucifer-research
npm ci && npm run build
````

Issue・PR 歓迎 🙏

光は最も深い闇から生まれる。
lucifer-research — 光の堕天使が、Webの情報を照らします ✦

#AI #OSS #研究 #TypeScript #AIエージェント

```

> 文字数: ~155

---

## 短縮版（単発ポスト・スレッドにしない場合）

```

🌟 lucifer-research v0.1.0 リリース！

AIエージェント向けマルチプラットフォームコンテンツ抽出パイプライン。

YouTube・X・GitHub・Bluesky・Qiita・note・HN…
URLひとつで構造化データ（title / content / engagement / trust）を取得。

MCP server として Claude Code に統合できます。
SSRF保護・プロンプトインジェクション検出付き。

🔗 https://github.com/kamisimokagura/lucifer-research

#OSS #TypeScript #MCP #Claude #AIエージェント

```

> 文字数: ~220

---

## ハッシュタグ候補

- `#OSS` `#TypeScript` `#MCP` `#Claude` `#ClaudeCode`
- `#AIエージェント` `#AI` `#研究` `#情報収集`
- `#Bluesky` `#Qiita` (各プラットフォームユーザーへのリーチ)

## 投稿チェックリスト

- [ ] lucifer-research リポジトリを **public** に変更
- [ ] `docs/x-ogp-image.svg` を PNG に変換（推奨: 1200×480）
- [ ] GitHub リリース v0.1.0 が公開されているか確認
- [ ] README の MCP config パスが正確か確認
- [ ] スレッド投稿後に Kagura Search の紹介スレッドにも言及（相互 OSS）
```
