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

import Parser from "rss-parser";

// rss-parser item with custom fields
interface RssItem {
  link?: string;
  guid?: string;
  title?: string;
  contentSnippet?: string;
  summary?: string;
  isoDate?: string;
  creator?: string;
  author?: string;
  "content:encoded"?: string;
  [key: string]: unknown;
}

const parser = new Parser<Record<string, unknown>, RssItem>({
  timeout: 10_000,
  customFields: {
    item: [
      ["media:thumbnail", "media:thumbnail"],
      ["content:encoded", "content:encoded"],
    ],
  },
});

interface FeedMapping {
  match: RegExp;
  toFeed: (url: string) => string;
  platform: ResearchResult["platform"];
}

const FEED_URL_MAP: FeedMapping[] = [
  {
    match: /zenn\.dev\/([^/]+)\//,
    toFeed: (url) => {
      const u = new URL(url);
      const user = u.pathname.split("/").filter(Boolean)[0];
      return `https://zenn.dev/${user}/feed`;
    },
    platform: "zenn",
  },
  {
    match: /medium\.com\/@?([^/]+)\//,
    toFeed: (url) => {
      const u = new URL(url);
      const user = u.pathname.split("/").filter(Boolean)[0];
      return `https://medium.com/feed/${user}`;
    },
    platform: "medium",
  },
  {
    match: /note\.com\/([^/]+)\//,
    toFeed: (url) => {
      const u = new URL(url);
      const user = u.pathname.split("/").filter(Boolean)[0];
      return `https://note.com/${user}/rss`;
    },
    platform: "note",
  },
  {
    match: /(?:\.|\/\/)substack\.com/, // matches both *.substack.com and base substack.com
    toFeed: (url) => {
      const u = new URL(url);
      return `${u.origin}/feed`;
    },
    platform: "web",
  },
];

// Strip HTML tags for plain-text content
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Normalize a URL for RSS item matching.
 * Strips query params, fragment, and trailing slash so that tracking params
 * (utm_source, etc.) and minor URL variations don't cause false misses.
 */
function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return raw;
  }
}

export class RssExtractor implements Extractor {
  readonly tier = "rss" as const;

  canHandle(url: string): boolean {
    return FEED_URL_MAP.some(({ match }) => match.test(url));
  }

  async extract(url: string, _opts: ExtractOptions = {}): Promise<ResearchResult> {
    const mapping = FEED_URL_MAP.find(({ match }) => match.test(url));
    if (!mapping) throw new Error(`No RSS mapping for: ${url}`);

    const feedUrl = mapping.toFeed(url);
    const feed = await parser.parseURL(feedUrl);

    // Find the specific item matching the URL.
    // Canonicalize both sides to handle tracking params, fragments, and trailing slashes.
    const canonicalInput = canonicalizeUrl(url);
    const item = feed.items.find(
      (i) =>
        canonicalizeUrl(i.link ?? "") === canonicalInput ||
        canonicalizeUrl(i.guid ?? "") === canonicalInput,
    );

    if (!item) throw new Error(`No matching item found in feed at: ${feedUrl} for URL: ${url}`);

    const rawContent =
      (item["content:encoded"] as string | undefined) ?? item.contentSnippet ?? item.summary ?? "";

    const content = rawContent.startsWith("<") ? stripHtml(rawContent) : rawContent;

    const author = item.creator ?? item.author;
    return {
      url: item.link ?? url,
      title: item.title ?? "Untitled",
      content,
      type: "article",
      platform: mapping.platform,
      ...(author !== undefined && { author }),
      ...(item.isoDate !== undefined && { date: item.isoDate }),
      trust: { score: 0.75, verified: false },
      extractor: "rss",
      extractedAt: new Date().toISOString(),
    };
  }
}
