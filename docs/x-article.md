# リリース記事 — lucifer-research v0.1.0

# （note / Zenn 投稿用・全文コピペ可）

> **注意**: リポジトリを **public** にしてから投稿。
> OGP 画像 `docs/x-ogp-image.svg` → PNG 変換して記事ヘッダーに設定推奨。

---

```
# lucifer-research v0.1.0 リリース — AIエージェント向けマルチプラットフォームコンテンツ抽出パイプライン

光は最も深い闇から生まれる。

lucifer-research は、AIエージェントや研究者が Web 上のコンテンツを安全・確実に取得するための
TypeScript ライブラリ & MCP サーバーです。

YouTube / X / GitHub / Hacker News / Bluesky / Qiita / note / Zenn / Medium …
URL を渡すだけで、構造化データを返します。

🔗 https://github.com/kamisimokagura/lucifer-research


## なぜ作ったか

AIエージェントは「Web からコンテンツを取得する」場面で必ずつまずきます。

- API ごとにレート制限・認証・レスポンス形式がバラバラ
- API が落ちたら終わり、フォールバック機構がない
- 悪意ある URL を踏んだときにプロンプトインジェクションが刺さる

lucifer-research はこれをまとめて解決します。
1 つの関数呼び出しで、複数フォールバック・セキュリティチェック込みの抽出を実現します。


## 何ができるのか

### 基本的な使い方（TypeScript）

```typescript
import { createPipeline } from "@lucifer/core";

const pipeline = createPipeline();

// 単一 URL を抽出
const result = await pipeline.extract("https://github.com/anthropics/anthropic-sdk-python");

console.log(result.title);        // "anthropics/anthropic-sdk-python"
console.log(result.platform);     // "github"
console.log(result.content);      // Markdown 形式の README
console.log(result.engagement);   // { stars: 2100, forks: 312, ... }
console.log(result.trust.score);  // 0.95
```

### ResearchResult — 返ってくるもの


| フィールド         | 型      | 内容                   |
| ------------- | ------ | -------------------- |
| `url`         | string | 正規化済み URL            |
| `title`       | string | コンテンツタイトル            |
| `content`     | string | Markdown 本文          |
| `platform`    | string | プラットフォーム識別子          |
| `engagement`  | object | いいね・スター・再生数・RT・コメント数 |
| `trust`       | object | スコア・警告・インジェクション検出フラグ |
| `extractor`   | string | 使用した抽出器の名前           |
| `extractedAt` | string | 抽出日時（ISO 8601）       |


### 対応プラットフォーム


| プラットフォーム     | 識別子          | エンゲージメント        |
| ------------ | ------------ | --------------- |
| YouTube      | `youtube`    | 再生数・いいね・コメント数   |
| X（旧 Twitter） | `x`          | いいね・RT・返信数      |
| GitHub       | `github`     | スター・フォーク・ウォッチャー |
| Hacker News  | `hackernews` | スコア・コメント数       |
| Bluesky      | `bluesky`    | いいね・RT・返信数      |
| Qiita        | `qiita`      | いいね・ストック数       |
| note         | `note`       | いいね数            |
| Zenn         | `zenn`       | いいね・ブックマーク      |
| Medium       | `medium`     | クラップ数           |
| TikTok       | `tiktok`     | 再生数・いいね・コメント数   |
| 汎用 Web       | `web`        | —               |


### 4 段階フォールバックチェーン

API 呼び出しが失敗しても、自動でフォールバックします。

```
API（公式 / 非公式）
  ↓ 失敗
RSS フィード
  ↓ 失敗
Jina Reader（r.jina.ai）
  ↓ 失敗
Mozilla Readability（ローカル解析）
```

API キーなしでも動作します（レート制限・機能制限あり）。

## Claude Code / Cursor / Windsurf に MCP として組み込む

### 設定（~/.claude/settings.json）

```json
{
  "mcpServers": {
    "lucifer-research": {
      "command": "node",
      "args": ["/path/to/lucifer-research/packages/mcp/dist/index.js"]
    }
  }
}
```

### 提供する MCP ツール

**lucifer_extract** — 単一 URL を抽出

```
lucifer_extract("https://zenn.dev/foo/articles/bar")
→ ResearchResult
```

**lucifer_pipeline** — 最大 20 URL を並列抽出

```
lucifer_pipeline([
  "https://github.com/anthropics/anthropic-sdk-python",
  "https://zenn.dev/foo/articles/bar",
  "https://news.ycombinator.com/item?id=12345"
])
→ ResearchResult[]
```

AIエージェントがリサーチタスクをこなすとき、URL リストを渡すだけで
全プラットフォームの構造化データを一括取得できます。

## セキュリティ設計

AIエージェントが悪意ある URL を踏んでも被害が出ないよう、2 層で防御します。

### 1. SSRF プロテクション（リクエスト前）

以下のアドレスへのリクエストをすべて拒否します。

- ループバック: `127.x.x.x`, `::1`
- プライベート: `10.x`, `172.16–31.x`, `192.168.x`
- リンクローカル: `169.254.x.x`
- クラウドメタデータ: `169.254.169.254`（AWS/GCP/Azure 共通）
- `data:` URI・`file:` URI

HTTPS 限定（HTTP は拒否）。

### 2. プロンプトインジェクション検出（レスポンス後）

取得したコンテンツに悪意あるパターンが含まれていないかを検査し、
`trust.warning` にフラグを立てます。

検出パターン例:

- `ignore previous instructions`
- `disregard all prior`
- `you are now DAN`
- `everything above this`
- `your true self`

72 テストケースすべて通過済み。

AIエージェントは `trust.score` と `trust.warning` を見て、
コンテンツの信頼性を判断できます。

## インストール & クイックスタート

```sh
git clone https://github.com/kamisimokagura/lucifer-research
cd lucifer-research
npm ci
npm run build
```

### API キー（任意）

`.env.example` をコピーして `.env` を作成し、持っているキーを設定します。
**すべて省略可能**（省略時はレート制限・機能制限あり）。

```sh
cp .env.example .env
```

```env
YOUTUBE_API_KEY=...   # YouTube Data API v3（なければ oEmbed のみ）
GITHUB_TOKEN=...      # GitHub PAT（なければ 60 req/hour）
JINA_API_KEY=...      # Jina Reader（なければ 匿名枠）
QIITA_TOKEN=...       # Qiita（なければ 60 req/hour）
```

### テスト実行

```sh
# セキュリティテスト（72 ケース）
node packages/core/test/test-security.mjs

# URL 抽出テスト
node packages/core/test/test-urls.mjs
```

## パッケージ構成

```
lucifer-research/
├── packages/
│   ├── core/          @lucifer/core     — パイプライン・型定義・セキュリティ
│   ├── extractors/    @lucifer/extractors — プラットフォーム別抽出器
│   └── mcp/           @lucifer/mcp      — MCP サーバー
└── turbo.json         Turborepo（並列ビルド）
```

TypeScript ESM モノレポ構成。
Node.js 18 以上、npm 9 以上。

## ロードマップ

- npm publish（`@lucifer/core` & `@lucifer/mcp`）
- Instagram 本番対応（現在 OGP フォールバック）
- ArXiv / Wikipedia / Reddit 抽出器
- キャッシュ層（SQLite / Redis）
- Cloudflare Workers 対応

Issue・PR 歓迎です 🙏
[https://github.com/kamisimokagura/lucifer-research/issues](https://github.com/kamisimokagura/lucifer-research/issues)

## おわりに

lucifer は「明けの明星」— 夜明け前に最も明るく輝く星の名前です。

Web に散らばる情報を、AIエージェントが安全に・確実に・透明に扱えるように。
その一歩として、lucifer-research を世に出します。

光は最も深い闇から生まれる。
lucifer-research — 光の堕天使が、Web の情報を照らします ✦

---

#OSS #TypeScript #MCP #Claude #AIエージェント #AI #研究

```

```

