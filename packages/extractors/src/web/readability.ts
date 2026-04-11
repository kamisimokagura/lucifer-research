// Local type definitions mirroring @lucifer/core (workspace package not yet built)
type ExtractorTier = "api" | "rss" | "jina" | "readability" | "browser" | "experimental";

interface ResearchResult {
  url: string;
  title: string;
  content: string;
  type: "article" | "social" | "github" | "video" | "feed" | "other";
  platform:
    | "github"
    | "youtube"
    | "hackernews"
    | "bluesky"
    | "qiita"
    | "reddit"
    | "mastodon"
    | "threads"
    | "telegram"
    | "x"
    | "instagram"
    | "tiktok"
    | "zenn"
    | "medium"
    | "note"
    | "web";
  author?: string;
  date?: string;
  engagement?: { views?: number; likes?: number; reposts?: number; comments?: number };
  trust: { score: number; verified: boolean; conflicts?: string[] };
  extractor: ExtractorTier;
  extractedAt: string;
  error?: string;
}

interface ExtractOptions {
  timeout?: number;
  maxBytes?: number;
  respectRobots?: boolean;
}

interface Extractor {
  readonly tier: ExtractorTier;
  canHandle(url: string): boolean;
  extract(url: string, options?: ExtractOptions): Promise<ResearchResult>;
}

import { lookup as dnsLookup } from "node:dns/promises";

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const td = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Private IP / loopback patterns — mirrors security.ts to validate all resolved addresses
const SSRF_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // IPv4 link-local (AWS/Azure metadata)
  /^::1$/,
  /^::ffff:127\./i, // IPv4-mapped loopback
  /^::ffff:10\./i, // IPv4-mapped RFC1918 10.x
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // IPv4-mapped RFC1918 172.16-31
  /^::ffff:192\.168\./i, // IPv4-mapped RFC1918 192.168
  /^::ffff:169\.254\./i, // IPv4-mapped link-local/metadata
  /^f[cd][0-9a-f]{2}:/i, // IPv6 ULA (fc00::/7 covers both fc and fd prefixes per RFC 4193)
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local
];
const LOOPBACK_NAMES = new Set(["localhost", "0.0.0.0", "ip6-localhost", "ip6-loopback"]);

function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets if present, then strip trailing dot (DNS FQDN form)
  // so that "localhost." or "ip6-localhost." bypass is not possible.
  let h = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (LOOPBACK_NAMES.has(h.toLowerCase())) return true;
  return SSRF_PATTERNS.some((p) => p.test(h));
}

/**
 * Resolve all A/AAAA records for hostname and throw if any resolves to a private address.
 * Checking all answers prevents a multi-homed host with one public and one private record
 * from bypassing the check when the OS resolver picks the private address at connect time.
 */
async function blockPrivateDnsResolution(hostname: string): Promise<void> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    return; // DNS failure → let the fetch fail naturally
  }
  for (const { address } of addresses) {
    if (LOOPBACK_NAMES.has(address) || SSRF_PATTERNS.some((p) => p.test(address))) {
      throw new Error(`SSRF blocked (${hostname} resolved to private IP ${address})`);
    }
  }
}

/**
 * Fetch with manual redirect following so each hop is SSRF-validated (text + DNS).
 * The initial URL is checked before the first fetch — not only redirect targets.
 */
async function safeFetch(url: string, init: RequestInit, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:") throw new Error(`Non-HTTPS URL blocked: ${current}`);
    if (isPrivateHost(parsed.hostname)) throw new Error(`SSRF blocked: ${parsed.hostname}`);
    await blockPrivateDnsResolution(parsed.hostname);

    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    current = new URL(location, current).href;
  }
  throw new Error(`Too many redirects for ${url}`);
}

export class ReadabilityExtractor implements Extractor {
  readonly tier = "readability" as const;

  canHandle(url: string): boolean {
    return url.startsWith("https://");
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 10_000;
    const maxBytes = opts.maxBytes ?? 1_048_576; // 1 MB default
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await safeFetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "lucifer-research/0.1.0 (compatible; research bot)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

      // Stream body to enforce maxBytes before buffering, so large responses
      // don't allocate memory beyond the limit (res.text() would buffer everything first).
      let html: string;
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const space = maxBytes - received;
            chunks.push(space < value.byteLength ? value.slice(0, space) : value);
            received += Math.min(value.byteLength, space);
            if (received >= maxBytes) break;
          }
        } finally {
          reader.cancel().catch(() => {});
        }
        html = new TextDecoder().decode(Buffer.concat(chunks));
      } else {
        const raw = await res.text();
        html = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
      }

      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article) throw new Error(`Readability could not extract article from: ${url}`);

      const content = td.turndown(article.content);

      return {
        url,
        title: article.title,
        content,
        type: "article",
        platform: "web",
        ...(article.byline != null && { author: article.byline }),
        ...(article.publishedTime != null && { date: article.publishedTime }),
        trust: { score: 0.65, verified: false },
        extractor: "readability",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
