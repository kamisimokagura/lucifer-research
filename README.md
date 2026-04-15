# lucifer-research

Multi-platform content extraction pipeline for AI research agents.

Extracts structured `ResearchResult` objects (title, Markdown body, engagement stats, trust score)
from URLs across 10+ platforms using a tiered fallback chain:
**API → RSS → Jina Reader → Readability**

```
┌─────────────────────────────────────────────────────┐
│  ResearchPipeline                                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐│
│  │  Router  │→ │Extractor │→ │  ResearchResult    ││
│  └──────────┘  │ (tiered) │  │  · title           ││
│                └──────────┘  │  · content (MD)    ││
│                              │  · platform        ││
│                              │  · engagement      ││
│                              │  · trust.score     ││
│                              └────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Supported Platforms

| Platform      | Primary extractor         | Engagement                     |
| ------------- | ------------------------- | ------------------------------ |
| YouTube       | oEmbed + RSS              | views, likes                   |
| X (Twitter)   | FxTwitter API             | views, likes, reposts, replies |
| HackerNews    | Algolia API               | points, comments               |
| GitHub        | REST API                  | stars, forks, watchers         |
| Bluesky       | AT Protocol               | likes, reposts, replies        |
| Qiita         | v2 API                    | likes, stocks                  |
| TikTok        | oEmbed                    | —                              |
| Instagram     | GraphQL + OGP fallback    | likes, comments                |
| Zenn / note   | RSS feed                  | —                              |
| Medium        | RSS → Jina fallback       | —                              |
| Web (generic) | Jina Reader / Readability | —                              |

## Quick Start

### As an MCP server (Claude Code / Cursor / Windsurf)

Build once, then add to your MCP config:

```sh
git clone https://github.com/kamisimokagura/lucifer-research
cd lucifer-research
npm ci
npm run build
```

**Claude Code** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "lucifer-research": {
      "command": "node",
      "args": ["/path/to/lucifer-research/packages/mcp/dist/index.js"],
      "env": {
        "YOUTUBE_API_KEY": "...",
        "GITHUB_TOKEN": "...",
        "JINA_API_KEY": "..."
      }
    }
  }
}
```

This exposes two tools to Claude:

- **`lucifer_extract`** — extract a single URL
- **`lucifer_pipeline`** — extract up to 20 URLs in parallel

### As a TypeScript library

```ts
import { ResearchPipeline } from "@lucifer/core";
import { createDefaultRegistry } from "@lucifer/extractors";

const registry = createDefaultRegistry({
  githubToken: process.env.GITHUB_TOKEN,
  youtubeApiKey: process.env.YOUTUBE_API_KEY,
  jinaApiKey: process.env.JINA_API_KEY,
});

const pipeline = new ResearchPipeline();
for (const [key, extractor] of registry) {
  pipeline.register(key, extractor);
}

const result = await pipeline.extract("https://github.com/anthropics/claude-code", {
  timeout: 15_000,
  fallback: true,
});

console.log(result.title); // "anthropics/claude-code"
console.log(result.platform); // "github"
console.log(result.engagement); // { stars: ..., forks: ... }
console.log(result.trust.score); // 0.9
```

## Configuration

All settings are optional. The pipeline works without any API keys (rate-limited/degraded).

| Environment variable | Used by           | Effect                               |
| -------------------- | ----------------- | ------------------------------------ |
| `YOUTUBE_API_KEY`    | YouTube extractor | Full metadata; without = oEmbed only |
| `GITHUB_TOKEN`       | GitHub extractor  | Higher rate limit (5000 req/h vs 60) |
| `JINA_API_KEY`       | Jina Reader       | Higher rate limit for web fallback   |
| `QIITA_TOKEN`        | Qiita extractor   | Higher rate limit                    |

Copy `.env.example` to `.env` and fill in the keys you have.

## Packages

| Package               | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `@lucifer/core`       | `ResearchPipeline`, `Router`, `SecurityGate`, types                      |
| `@lucifer/extractors` | Per-platform extractors + `createDefaultRegistry()`                      |
| `@lucifer/mcp`        | MCP server wrapping the pipeline (`lucifer_extract`, `lucifer_pipeline`) |

## Security

- **SSRF protection** — blocks private IPs, link-local ranges, metadata endpoints
- **Prompt injection detection** — flags `ResearchResult.trust` when extracted content contains injection patterns
- **URL validation** — HTTPS only, hostname allowlist per extractor tier

See `packages/core/src/security.ts` for implementation.

## Development

```sh
npm ci
npm run build    # turbo: build all packages
npm run test     # turbo: vitest + integration tests
npm run lint     # eslint
```

**Integration test scripts** (require network):

```sh
node test-security.mjs      # 72 security pattern tests
node test-urls.mjs          # YouTube + X + HackerNews + GitHub + Qiita
node test-urls-r2.mjs       # Round 2 — extended platform coverage
node test-urls-r3.mjs       # Round 3 — Bluesky, TikTok, RSS (Zenn/Medium/note)
node test-stress.mjs        # Concurrent stress test (×1/×5/×20 parallel)
```

## License

MIT © 2026 kamisimokagura
