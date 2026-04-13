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

/** FxTwitter API response shape (only fields we consume) */
interface FxTweet {
  id?: string;
  text?: string;
  created_at?: number | string;
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
  author?: { name?: string; screen_name?: string };
}

interface FxResponse {
  code?: number;
  tweet?: FxTweet;
}

/** Extract numeric tweet ID from twitter.com / x.com status URLs. */
function parseTweetId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^(www\.|mobile\.)/, "");
    if (h !== "twitter.com" && h !== "x.com") return null;
    const match = u.pathname.match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract X / Twitter posts via the FxTwitter public API.
 *
 * FxTwitter is a free, no-auth community proxy that returns structured
 * tweet data including full text and engagement counters.
 * API: https://api.fxtwitter.com/i/status/{tweetId}
 */
export class XExtractor implements Extractor {
  readonly tier = "api" as const;

  canHandle(url: string): boolean {
    return parseTweetId(url) !== null;
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 10_000;
    const tweetId = parseTweetId(url);
    if (!tweetId) throw new Error(`Cannot parse tweet ID from: ${url}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const apiUrl = `https://api.fxtwitter.com/i/status/${tweetId}`;
      const res = await fetch(apiUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (!res.ok)
        throw new Error(`FxTwitter API returned HTTP ${res.status} for tweet ${tweetId}`);

      const json = (await res.json()) as FxResponse;
      if (json.code !== 200 || !json.tweet) {
        throw new Error(`FxTwitter API error (code=${json.code ?? "?"}) for tweet ${tweetId}`);
      }

      const tweet = json.tweet;
      const handle = tweet.author?.screen_name ?? "unknown";
      const displayName = tweet.author?.name;
      const text = tweet.text ?? "";
      const truncated = text.length > 60 ? `${text.slice(0, 60)}...` : text;

      let date: string | undefined;
      if (typeof tweet.created_at === "number") {
        date = new Date(tweet.created_at * 1000).toISOString();
      } else if (typeof tweet.created_at === "string") {
        date = tweet.created_at;
      }

      const engagement = {
        ...(tweet.views !== undefined && { views: tweet.views }),
        ...(tweet.likes !== undefined && { likes: tweet.likes }),
        ...(tweet.retweets !== undefined && { reposts: tweet.retweets }),
        ...(tweet.replies !== undefined && { comments: tweet.replies }),
      };

      return {
        url,
        title: `@${handle}: ${truncated}`,
        content: text,
        type: "social",
        platform: "x",
        ...(displayName !== undefined && { author: displayName }),
        ...(date !== undefined && { date }),
        engagement,
        trust: { score: 0.8, verified: false },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
