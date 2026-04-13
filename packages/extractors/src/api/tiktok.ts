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

/** TikTok oEmbed API response shape */
interface TikTokOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  provider_name?: string;
}

const TIKTOK_HOSTS = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "m.tiktok.com",
]);

/**
 * Extract TikTok video metadata via the official TikTok oEmbed API.
 *
 * The oEmbed endpoint is publicly available, requires no authentication,
 * and returns the video caption (as `title`) and author information.
 * API: https://www.tiktok.com/oembed?url={videoUrl}
 */
export class TikTokExtractor implements Extractor {
  readonly tier = "api" as const;

  canHandle(url: string): boolean {
    try {
      return TIKTOK_HOSTS.has(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const res = await fetch(oembedUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`TikTok oEmbed returned HTTP ${res.status} for: ${url}`);

      const data = (await res.json()) as TikTokOEmbed;
      const caption = data.title ?? "";
      const authorName = data.author_name;

      // Extract @username from author_url (https://www.tiktok.com/@username)
      let handle: string | undefined;
      if (data.author_url) {
        const match = data.author_url.match(/@([^/?#]+)/);
        handle = match?.[1];
      }

      const displayAuthor = authorName ?? (handle ? `@${handle}` : undefined);
      const truncated = caption.length > 60 ? `${caption.slice(0, 60)}...` : caption;
      const title = displayAuthor ? `${displayAuthor}: ${truncated}` : truncated;

      return {
        url,
        title,
        content: caption,
        type: "social",
        platform: "tiktok",
        ...(displayAuthor !== undefined && { author: displayAuthor }),
        trust: { score: 0.8, verified: false },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
