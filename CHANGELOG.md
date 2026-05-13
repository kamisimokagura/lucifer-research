# Changelog

All notable changes to lucifer-research are documented here.

## [0.2.0] — 2026-05-14

### New: BrowserExtractor (Playwright)

Full browser-based extraction as a final-fallback tier for JS-heavy pages and paywalled content.

- **4-strategy context hierarchy** — session file → Chrome profile → isolated context, with a new **Strategy 0 (CDP)**: attach to an already-running Chrome instance via `CHROME_CDP_URL` (DevTools Protocol).
- **Session persistence** — after a successful Chrome-profile extraction, cookies are saved to `~/.lucifer/sessions/<domain>.json` (0o600, domain-filtered). Future requests reuse the session file even while Chrome is open.
- **Interactive login** — login wall detected → opens a headed browser and waits for the user to authenticate (TTY only; skipped in MCP/CI).
- **SSRF protection** — `context.route()` blocks all sub-resource requests to private/loopback/cloud-metadata addresses; inherits to popups and new pages.
- **`BROWSER_HEADED=1`** — makes the browser window visible for visual debugging / demo use.
- **`BROWSER_KEEP_OPEN=<ms>`** — keeps the window open after extraction (max 60 s; headed mode only).
- **`BROWSER_SAVE_CDP_SESSION=1`** — opt-in flag to persist authenticated cookies from a CDP session to disk.

### New: Hybrid extraction for SNS platforms

X/Twitter, TikTok, and Instagram now run BrowserExtractor **in parallel** with the primary API extractor. Results are merged: API metadata (engagement / author / date) + richer browser content wins. Conflicts are annotated in `trust.conflicts`.

### X/Twitter — 4-tier fallback

`FxTwitter` → `vxTwitter` → **Syndication API** → **oEmbed** — maximises tweet content retrieval without auth.

### YouTube — oEmbed description fallback

When the transcript API returns empty, the channel / video description from oEmbed is used as content. Transcript timer leak fixed.

### Security improvements (Codex 4-round review)

- `100.64.0.0/10` (RFC 6598 CGNAT / Alibaba Cloud metadata) added to `PRIVATE_IP_PATTERNS`
- `assertSafeUrl()` exported from `@lucifer/core`; called at the entry of `BrowserExtractor.extract()` as defence-in-depth on direct calls
- Atomic session file writes: `pid+uuid` temp file → `rename()` (no partial reads on crash)
- MCP timeout clamped to `[1_000, 120_000]` ms — prevents `NaN`/`Infinity` resource exhaustion
- CDP URL validation: scheme (http/https/ws/wss only), credentials rejected, full `127.0.0.0/8` + `::1` range
- Session filename sanitized to `[a-z0-9.-]` (IDNA/punycode edge cases)
- `@mozilla/readability` upgraded `0.5` → `0.6.0`

---

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
