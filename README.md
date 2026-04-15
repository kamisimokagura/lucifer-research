# lucifer-research

Multi-platform research extraction pipeline — TypeScript ESM monorepo.

Extracts structured content from URLs across platforms:

| Platform      | Extractor                 |
| ------------- | ------------------------- |
| YouTube       | oEmbed + RSS              |
| X (Twitter)   | FxTwitter / nitter        |
| HackerNews    | Algolia API               |
| GitHub        | REST API                  |
| Qiita         | v2 API                    |
| Bluesky       | AT Protocol               |
| TikTok        | oEmbed                    |
| Instagram     | GraphQL + OGP             |
| RSS / Atom    | feed-parser               |
| Web (generic) | Jina Reader / Readability |

## Packages

- **`@lucifer/core`** — `ResearchPipeline`, `Router`, security utilities
- **`@lucifer/extractors`** — per-platform extractors implementing `Extractor` interface
- **`@lucifer/mcp`** — MCP server wrapping the pipeline

## Setup

```sh
npm ci
npm run build
```

## Tests

```sh
# unit / security tests
node test-security.mjs

# integration tests (requires network)
node test-urls.mjs
node test-urls-r2.mjs
```

## Status

Work in progress — not yet released. API may change.
