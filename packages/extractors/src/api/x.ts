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

// --- API response types ---

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

/** Twitter oEmbed API response shape */
interface XOEmbedResponse {
  author_name?: string;
  author_url?: string;
  html?: string;
}

// --- Helpers ---

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
 * Extract plain text from a Twitter oEmbed HTML blockquote.
 * The `<p>` inside the blockquote contains the tweet text with inline links.
 */
function extractOEmbedText(html: string): string {
  const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!pMatch?.[1]) return "";
  let text = pMatch[1];
  // Strip HTML tags (links, etc.)
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return text.trim();
}

// ─────────────────────────────────────────────

/**
 * Extract X / Twitter posts using a two-tier strategy.
 *
 * **Tier 1 — FxTwitter API (primary)**
 * `api.fxtwitter.com` is a free, no-auth community proxy returning structured
 * tweet data: full text, engagement counters (views/likes/retweets/replies),
 * author, and timestamp. Note: the *website* fxtwitter.com redirects to x.com,
 * but the *API subdomain* api.fxtwitter.com remains operational.
 *
 * **Tier 2 — Twitter oEmbed (fallback)**
 * `publish.twitter.com/oembed` is an official, no-auth endpoint returning the
 * author and tweet text (embedded in HTML). No engagement data. Used when
 * api.fxtwitter.com is unavailable.
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
      // Tier 1: FxTwitter API — full data, no auth
      const fxResult = await this._tryFxTwitter(tweetId, controller.signal);
      if (fxResult) return fxResult;

      // Tier 2: Twitter oEmbed — author + text only, no engagement data
      const oembedResult = await this._tryOEmbed(url, controller.signal);
      if (oembedResult) return oembedResult;

      throw new Error(`All X extraction tiers failed for ${url} (tweet ID: ${tweetId})`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async _tryFxTwitter(
    tweetId: string,
    signal: AbortSignal,
  ): Promise<ResearchResult | null> {
    try {
      const res = await fetch(`https://api.fxtwitter.com/i/status/${tweetId}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;

      const json = (await res.json()) as FxResponse;
      if (json.code !== 200 || !json.tweet) return null;

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
        url: `https://x.com/${handle}/status/${tweetId}`,
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
    } catch {
      return null;
    }
  }

  private async _tryOEmbed(url: string, signal: AbortSignal): Promise<ResearchResult | null> {
    try {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`;
      const res = await fetch(oembedUrl, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as XOEmbedResponse;
      const text = data.html ? extractOEmbedText(data.html) : "";
      const displayName = data.author_name;

      let handle: string | undefined;
      if (data.author_url) {
        const m = data.author_url.match(/(?:twitter|x)\.com\/([^/?#]+)/);
        handle = m?.[1];
      }

      const truncated = text.length > 60 ? `${text.slice(0, 60)}...` : text;

      return {
        url,
        title: `@${handle ?? displayName ?? "unknown"}: ${truncated}`,
        content: text || `[Tweet by ${displayName ?? "unknown"} — text unavailable via oEmbed]`,
        type: "social",
        platform: "x",
        ...(displayName !== undefined && { author: displayName }),
        trust: { score: 0.6, verified: false },
        extractor: "readability",
        extractedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
