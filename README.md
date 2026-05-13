# lucifer-research

> Multi-platform content extraction engine for AI research agents

[![Version](https://img.shields.io/github/v/release/kamisimokagura/family-ai-workspace-config?label=version)](https://github.com/kamisimokagura/family-ai-workspace-config/releases)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

Extracts structured `ResearchResult` objects from 12+ platforms via a tiered fallback chain: **API → Jina Reader → Readability → Browser (Playwright)**. Works as an **MCP server** for Claude Code and any MCP-compatible AI tool — no API keys required to start.

## Why lucifer-research?

Most extraction tools either require paid API keys, break on JS-heavy sites, or return unstructured HTML. lucifer-research does three things differently:

1. **Zero-config start.** Every platform has a free, no-key path. Add opt-in keys only for the platforms you need.
2. **Browser as final fallback.** Playwright handles JS-heavy pages, SPAs, and login-walled content — with your existing Chrome sessions.
3. **Honest trust scoring.** Results carry `trust.score` and `trust.verified`. When we fall back to scraping, we say so.

## Quick Start

### MCP Server (Claude Code / Cursor / Windsurf)

```bash
git clone https://github.com/kamisimokagura/family-ai-workspace-config
cd lucifer-research && npm ci && npm run build
```

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

Want Chrome session access? Add one line:

```json
"env": {
  "CHROME_USER_DATA_DIR": "C:\\Users\\YourName\\AppData\\Local\\Google\\Chrome\\User Data"
}
```

### TypeScript Library

```ts
import { ResearchPipeline } from "@lucifer/core";
import { createDefaultRegistry } from "@lucifer/extractors";

const pipeline = new ResearchPipeline();
for (const [key, ext] of createDefaultRegistry()) pipeline.register(key, ext);

const result = await pipeline.extract("https://github.com/anthropics/claude-code");
console.log(result.title, result.platform, result.trust.score);
```

## Architecture

```
User (Claude / your app)
    |
    v
[MCP]  lucifer_extract / lucifer_pipeline
    |
    v
[ResearchPipeline]
    |
    v
[Router]  URL → extractor selection
    |
    +-- [API extractors]     YouTube · GitHub · HackerNews · Bluesky · Qiita
    |                        X/Twitter (4-tier) · TikTok · Instagram
    |
    +-- [Jina Reader]        JS-heavy pages, opt-in cleaner extraction
    |
    +-- [Readability]        local extraction, no external calls
    |
    +-- [BrowserExtractor]   Playwright — 4-strategy context:
    |                        CDP → session file → Chrome profile → isolated
    |
    v
ResearchResult
    · title · content (Markdown) · platform · engagement
    · trust.score · trust.verified · trust.conflicts
```

## MCP Tools

| Tool                  | Description                             |
| --------------------- | --------------------------------------- |
| `lucifer_extract`     | Extract a single URL                    |
| `lucifer_pipeline`    | Extract up to 20 URLs in parallel       |

## Platforms

| Platform      | Free path                                                  | With key                                    |
| ------------- | ---------------------------------------------------------- | ------------------------------------------- |
| YouTube       | oEmbed + transcript; description fallback                  | View / like / comment counts                |
| GitHub        | Public REST API (60 req/h)                                 | 5,000 req/h + higher trust                  |
| HackerNews    | Algolia public API                                         | —                                           |
| Bluesky       | AT Protocol public endpoints                               | —                                           |
| Qiita         | Public v2 API                                              | Higher rate limit                           |
| X (Twitter)   | FxTwitter → vxTwitter → Syndication API → oEmbed (4-tier) | Chrome profile / CDP for full content       |
| TikTok        | oEmbed + BrowserExtractor hybrid                           | —                                           |
| Instagram     | GraphQL + OGP + BrowserExtractor hybrid                   | Meta oEmbed token                           |
| Zenn / note   | RSS feeds                                                  | —                                           |
| Medium        | Jina Reader                                                | Jina API key (higher throughput)            |
| Web (generic) | Readability → BrowserExtractor                             | Jina Reader (cleaner)                       |

### Reliability note

X, TikTok, and Instagram don't have free stable public APIs. Extractors can break without notice — that's the nature of scraping, not a bug. When fallback occurs, `trust.verified = false` is set so agents can tell structured data from scraped content.

## BrowserExtractor

Playwright-based final fallback. Reuses your existing Chrome login sessions via a **4-strategy hierarchy**:

| # | Strategy | Requires |
|---|----------|----------|
| 0 | CDP — attach to running Chrome | `CHROME_CDP_URL=http://localhost:9222` |
| 1 | Session file (auto-saved) | Previous extraction with Strategy 2/0 |
| 2 | Chrome profile | `CHROME_USER_DATA_DIR` |
| 3 | Isolated context (no cookies) | fallback, always available |

**Start Chrome in CDP mode:**

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Key env vars:**

| Var | Effect |
|-----|--------|
| `CHROME_USER_DATA_DIR` | Path to Chrome user data dir (Strategy 2) |
| `CHROME_CDP_URL` | CDP endpoint e.g. `http://localhost:9222` (Strategy 0) |
| `BROWSER_HEADED=1` | Show the browser window on screen |
| `BROWSER_KEEP_OPEN=<ms>` | Keep window open N ms after extraction (max 60 s) |
| `BROWSER_SAVE_CDP_SESSION=1` | Persist CDP session cookies to disk (opt-in) |

## Configuration

All env vars are optional. Copy `.env.example` to `.env`.

| Env var                | Used by           | Effect                                       |
| ---------------------- | ----------------- | -------------------------------------------- |
| `YOUTUBE_API_KEY`      | YouTube           | Adds view / like / comment counts            |
| `GITHUB_TOKEN`         | GitHub            | 5,000 req/h (vs 60)                          |
| `JINA_API_KEY`         | Jina Reader       | Higher throughput                            |
| `QIITA_TOKEN`          | Qiita             | Higher rate limit                            |
| `INSTAGRAM_META_TOKEN` | Instagram         | Meta oEmbed tier                             |
| `CHROME_USER_DATA_DIR` | BrowserExtractor  | Chrome profile path                          |
| `CHROME_CDP_URL`       | BrowserExtractor  | DevTools Protocol URL                        |

## Trust Levels

| Level | Meaning |
| ----- | ------- |
| `verified: true` | API-sourced data with engagement counts |
| `verified: false` | Scraped or browser-extracted content |
| `conflicts` set | API metadata + browser content differ |

## Security

4-layer defense:

1. **DNS SSRF protection** — blocks `127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `100.64.0.0/10` (CGNAT), IPv6 ULA/link-local, DNS rebinding patterns
2. **Prompt injection detection** — flags `trust` when extracted content contains override patterns
3. **Session files** — `~/.lucifer/sessions/` at `0700/0600`; domain-filtered, atomic writes (pid+uuid temp → rename)
4. **CDP validation** — scheme allowlist, no credentials in URL, full `127.0.0.0/8` + `::1` loopback only

## Development

```bash
npm ci
npm run build   # turbo: all packages
npm run test    # vitest + integration tests
npm run lint    # eslint
```

**Integration scripts** (require network):

```bash
node test-security.mjs    # 72 SSRF + injection patterns
node test-urls.mjs        # YouTube + X + HackerNews + GitHub + Qiita
node test-urls-r2.mjs     # Extended platform coverage
node test-urls-r3.mjs     # Bluesky, TikTok, RSS (Zenn/Medium/note)
node test-stress.mjs      # Concurrent ×1/×5/×20 parallel
```

### Project Structure

```
lucifer-research/
+-- packages/
|   +-- core/        # ResearchPipeline, Router, SecurityGate, types
|   +-- extractors/  # Per-platform extractors + BrowserExtractor
|   +-- mcp/         # MCP server (lucifer_extract, lucifer_pipeline)
+-- turbo.json
```

## Changelog

### v0.2.0 (2026-05-14)

- **BrowserExtractor** — Playwright-based final fallback with 4-strategy context hierarchy
- **Strategy 0: CDP** — attach to a running Chrome via DevTools Protocol (`CHROME_CDP_URL`)
- **`BROWSER_HEADED=1`** / **`BROWSER_KEEP_OPEN=<ms>`** env vars
- **Hybrid SNS extraction** — X/Twitter, TikTok, Instagram run API + Browser in parallel and merge results
- **X/Twitter 4-tier fallback** — FxTwitter → vxTwitter → Syndication API → oEmbed (no auth)
- **YouTube** — oEmbed description fallback when transcript is empty; timer leak fixed
- **Security** — Codex 4-round review (0 remaining issues); SSRF CGNAT range; atomic session writes; CDP URL validation

### v0.1.0 (2026-04-15)

- Initial release — 12+ platforms, tiered fallback chain, MCP server, SSRF + prompt injection protection

## License

[MIT](LICENSE) © 2026 kamisimokagura
