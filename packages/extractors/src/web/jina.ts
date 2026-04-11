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

const JINA_PREFIX = "https://r.jina.ai/";

// Platforms that have dedicated API extractors — skip Jina for these.
// NOTE: github.com is intentionally excluded here so that GitHub sub-pages
// (issues, PRs, commits, etc.) that GitHubExtractor throws on can fall back to Jina.
const API_NATIVE_HOSTNAMES = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "bsky.app",
  "staging.bsky.app",
  "qiita.com",
  "news.ycombinator.com",
  "hn.algolia.com",
  "x.com",
  "twitter.com",
]);

const PLATFORM_MAP: Record<string, ResearchResult["platform"]> = {
  "zenn.dev": "zenn",
  "medium.com": "medium",
  "note.com": "note",
  "reddit.com": "reddit",
  "www.reddit.com": "reddit",
};

function detectPlatform(hostname: string): ResearchResult["platform"] {
  return PLATFORM_MAP[hostname] ?? "web";
}

export class JinaExtractor implements Extractor {
  readonly tier = "jina" as const;

  constructor(private readonly apiKey?: string) {}

  // Jina can handle any HTTPS URL not covered by a dedicated API extractor
  canHandle(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return url.startsWith("https://") && !API_NATIVE_HOSTNAMES.has(hostname);
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const jinaUrl = `${JINA_PREFIX}${encodeURIComponent(url)}`;
      const headers: Record<string, string> = {
        Accept: "text/markdown",
        "X-Return-Format": "markdown",
        "X-No-Cache": "true",
      };
      const apiKey = this.apiKey ?? process.env["JINA_API_KEY"];
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(jinaUrl, { signal: controller.signal, headers });
      if (!res.ok) throw new Error(`Jina Reader error: ${res.status} for ${url}`);

      const markdown = await res.text();

      // Extract title from first H1 line
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      const title = titleMatch?.[1]?.trim() ?? new URL(url).hostname;

      const hostname = new URL(url).hostname.replace("www.", "");
      const platform = detectPlatform(hostname);

      return {
        url,
        title,
        content: markdown,
        type: "article",
        platform,
        trust: { score: 0.7, verified: false },
        extractor: "jina",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
