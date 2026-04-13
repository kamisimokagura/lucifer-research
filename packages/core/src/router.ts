import type { ExtractorTier, Platform } from "./types.js";

interface RouteInfo {
  tier: ExtractorTier;
  platform: Platform;
  extractorKey: string;
}

/** Map of domain → route info */
const DOMAIN_ROUTES: Record<string, RouteInfo> = {
  // --- Tier 1: Official APIs ---
  "github.com": { tier: "api", platform: "github", extractorKey: "github" },
  "gist.github.com": { tier: "api", platform: "github", extractorKey: "github" },
  "raw.githubusercontent.com": { tier: "api", platform: "github", extractorKey: "github" },

  "youtube.com": { tier: "api", platform: "youtube", extractorKey: "youtube" },
  "youtu.be": { tier: "api", platform: "youtube", extractorKey: "youtube" },
  "m.youtube.com": { tier: "api", platform: "youtube", extractorKey: "youtube" },

  "news.ycombinator.com": { tier: "api", platform: "hackernews", extractorKey: "hackernews" },
  "hn.algolia.com": { tier: "api", platform: "hackernews", extractorKey: "hackernews" },

  "bsky.app": { tier: "api", platform: "bluesky", extractorKey: "bluesky" },
  "staging.bsky.app": { tier: "api", platform: "bluesky", extractorKey: "bluesky" },

  "qiita.com": { tier: "api", platform: "qiita", extractorKey: "qiita" },

  // --- Tier 2: RSS / Atom feeds ---
  "zenn.dev": { tier: "rss", platform: "zenn", extractorKey: "rss" },
  "medium.com": { tier: "rss", platform: "medium", extractorKey: "rss" },
  "note.com": { tier: "rss", platform: "note", extractorKey: "rss" },
  // substack.com base site; *.substack.com subdomains handled by suffix check below
  "substack.com": { tier: "rss", platform: "web", extractorKey: "rss" },

  // --- Social platforms ---
  "twitter.com": { tier: "api", platform: "x", extractorKey: "x" },
  "x.com": { tier: "api", platform: "x", extractorKey: "x" },
  "mobile.twitter.com": { tier: "api", platform: "x", extractorKey: "x" },
  "mobile.x.com": { tier: "api", platform: "x", extractorKey: "x" },

  "tiktok.com": { tier: "api", platform: "tiktok", extractorKey: "tiktok" },
  "vm.tiktok.com": { tier: "api", platform: "tiktok", extractorKey: "tiktok" },
  "vt.tiktok.com": { tier: "api", platform: "tiktok", extractorKey: "tiktok" },
  "m.tiktok.com": { tier: "api", platform: "tiktok", extractorKey: "tiktok" },

  // Instagram uses an unofficial GraphQL endpoint + OGP fallback (no cookie required).
  // See InstagramExtractor for doc_id rotation strategy.
  // Note: selectRoute() strips www. but not m., so mobile subdomains are listed explicitly.
  "instagram.com": { tier: "experimental", platform: "instagram", extractorKey: "instagram" },
  "m.instagram.com": { tier: "experimental", platform: "instagram", extractorKey: "instagram" },
};

/** Domains known to require JS rendering (T5 browser) */
const JS_HEAVY_DOMAINS = new Set(["linkedin.com", "www.linkedin.com"]);

/**
 * Determine the best extractor route for a URL.
 */
export function selectRoute(rawUrl: string): RouteInfo {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { tier: "jina", platform: "web", extractorKey: "jina" };
  }

  const direct = DOMAIN_ROUTES[hostname] ?? DOMAIN_ROUTES[`www.${hostname}`];
  if (direct) return direct;

  // Suffix-based routing for wildcard subdomains (e.g. writer.substack.com)
  if (hostname.endsWith(".substack.com")) {
    return { tier: "rss", platform: "web", extractorKey: "rss" };
  }

  if (JS_HEAVY_DOMAINS.has(hostname) || JS_HEAVY_DOMAINS.has(`www.${hostname}`)) {
    return { tier: "browser", platform: "web", extractorKey: "browser" };
  }

  // Default: try Jina Reader for general web
  return { tier: "jina", platform: "web", extractorKey: "jina" };
}

export type { RouteInfo };
