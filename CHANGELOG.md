# Changelog

All notable changes to lucifer-research are documented here.

## [0.1.0] — 2026-04-15

Initial release.

### Platforms

- **YouTube** — oEmbed + RSS; full metadata with `YOUTUBE_API_KEY`
- **X (Twitter)** — FxTwitter API (no auth required); views/likes/reposts/replies
- **HackerNews** — Algolia API; points + comment count
- **GitHub** — REST API; stars/forks/watchers, README as content
- **Bluesky** — AT Protocol (`public.api.bsky.app`); likes/reposts/replies
- **Qiita** — v2 API; likes + stocks count
- **TikTok** — oEmbed API
- **Instagram** — GraphQL (Tier 1) → OGP meta (Tier 2) → Meta oEmbed (Tier 3)
- **Zenn / note / Medium** — RSS feed → Jina Reader fallback
- **Web (generic)** — Jina Reader → Readability

### Core

- `ResearchPipeline` — tiered extraction with concurrency control (default: 5 parallel)
- `Router` — URL → extractor routing by hostname
- `SecurityGate` — SSRF protection, prompt injection detection, URL validation
- `ResearchResult` — typed output: title, Markdown content, platform, engagement, trust score

### MCP server (`@lucifer/mcp`)

- `lucifer_extract` — single URL extraction
- `lucifer_pipeline` — batch extraction (up to 20 URLs, results in input order)

### Security

- SSRF: blocks `127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`,
  `fc00::/7`, `fd00::/8`, `::1`, IPv4-mapped ranges, cloud metadata endpoints
- Prompt injection: detects `ignore previous instructions`, `system prompt`,
  `act as`, `you are now`, `disregard`, `override`, and related patterns
- URL validation: HTTPS-only, rejects data URIs and non-HTTPS schemes
