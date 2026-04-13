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

// --- Instagram API constants ---

const INSTAGRAM_APP_ID = "936619743392459";
/** Hardcoded LSD token. Rotates occasionally; refresh via homepage if GraphQL returns 400. */
const INSTAGRAM_LSD = "AVqbxe3J_YA";
/** Default GraphQL doc_id for shortcode media query. Rotates every 2–4 weeks.
 *  Users can override via InstagramExtractor({ docId: "..." }) when rotation occurs. */
const INSTAGRAM_DEFAULT_DOC_ID = "10015901848480474";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// --- GraphQL response types ---

interface IgCaption {
  node?: { text?: string };
}

interface IgMedia {
  edge_media_to_caption?: { edges?: IgCaption[] };
  owner?: { username?: string; full_name?: string };
  taken_at_timestamp?: number;
  edge_liked_by?: { count?: number };
  edge_media_to_comment?: { count?: number };
  video_view_count?: number | null;
  play_count?: number | null;
}

interface IgGraphQLResponse {
  data?: { xdt_shortcode_media?: IgMedia };
  errors?: unknown[];
}

// --- Meta oEmbed response ---

interface MetaOEmbed {
  author_name?: string;
  author_url?: string;
  media_id?: string;
}

// --- Helpers ---

/** Extract shortcode from /p/, /reel/, or /tv/ Instagram URLs. */
function parseShortcode(url: string): string | null {
  const match = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match?.[2] ?? null;
}

/** Decode common HTML entities found in meta tag content values. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Extract a meta tag content value from raw HTML.
 * Handles both attribute orderings (property-before-content and content-before-property).
 */
function extractMeta(html: string, property: string): string | undefined {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const re of [
    new RegExp(
      `<meta[^>]+property\\s*=\\s*["']${esc}["'][^>]+content\\s*=\\s*["']([^"'<>]+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"'<>]+)["'][^>]+property\\s*=\\s*["']${esc}["']`,
      "i",
    ),
  ]) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return undefined;
}

/**
 * Parse an engagement count string like "12K", "1.5M", or "34,567".
 */
function parseCount(s: string): number | undefined {
  const clean = s.replace(/,/g, "").trim();
  if (/k$/i.test(clean)) return Math.round(parseFloat(clean) * 1_000);
  if (/m$/i.test(clean)) return Math.round(parseFloat(clean) * 1_000_000);
  const n = parseInt(clean, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Parse `og:description` to extract likes, comments count, and caption text.
 * Format: "{N} likes, {M} comments - {username} on {date}: '{caption}'"
 * (outer quotes stripped; numbers may include K/M suffixes)
 */
function parseOgDescription(desc: string): {
  likes: number | undefined;
  comments: number | undefined;
  caption: string | undefined;
  username: string | undefined;
} {
  // Strip wrapping curly quotes or straight quotes if present
  const cleaned = desc.replace(/^["""'']|["""'']$/g, "");

  const engMatch = cleaned.match(/^([\d.,KkMmBb]+)\s+likes?,\s*([\d.,KkMmBb]+)\s+comments?/i);
  const likes = engMatch?.[1] ? parseCount(engMatch[1]) : undefined;
  const comments = engMatch?.[2] ? parseCount(engMatch[2]) : undefined;

  // username is between " - " and " on "
  const usernameMatch = cleaned.match(/ - ([^\s]+) on /);
  const username = usernameMatch?.[1];

  // caption is after the last ": '" (with either quote style)
  const captionMatch = cleaned.match(/:\s*['"'"](.+?)['""']?\s*$/s);
  const caption = captionMatch?.[1]?.trim();

  return { likes, comments, caption, username };
}

// ─────────────────────────────────────────────

/**
 * Extract Instagram posts using a multi-tier strategy.
 *
 * **Tier 1 — Instagram GraphQL (no cookie required)**
 * Uses a public `doc_id` that Instagram's own web client uses.
 * Returns full caption, engagement counts, author, and timestamp.
 * Note: `doc_id` can rotate every 2–4 weeks. Pass `docId` in the
 * constructor options to override without a code change.
 *
 * **Tier 2 — OGP scrape (fallback)**
 * Fetches the post's HTML with the `X-IG-App-ID` header which unlocks
 * richer meta tags including a truncated caption and approximate counts.
 * Caption is truncated by Instagram (~150–200 chars).
 *
 * **Tier 3 — Meta oEmbed (optional)**
 * Requires a Facebook App access token from the user. Returns author
 * metadata but no caption text. Only attempted if `metaToken` is provided.
 */
export class InstagramExtractor implements Extractor {
  readonly tier = "experimental" as const;

  private readonly docId: string;
  private readonly metaToken: string | undefined;

  constructor(opts?: { docId?: string; metaToken?: string }) {
    this.docId = opts?.docId ?? INSTAGRAM_DEFAULT_DOC_ID;
    this.metaToken = opts?.metaToken;
  }

  canHandle(url: string): boolean {
    try {
      const h = new URL(url).hostname.replace(/^(www\.|m\.)/, "");
      return (h === "instagram.com" || h === "instagr.am") && parseShortcode(url) !== null;
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 15_000;
    const shortcode = parseShortcode(url);
    if (!shortcode) throw new Error(`Cannot parse Instagram shortcode from: ${url}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      // Tier 1: GraphQL — full data, no cookie
      let graphqlHint: string | undefined;
      try {
        const graphqlResult = await this._tryGraphQL(url, shortcode, controller.signal);
        if (graphqlResult) return graphqlResult;
      } catch (err) {
        const msg = (err as Error)?.message ?? "";
        if (msg.startsWith("DOC_ID_EXPIRED:")) {
          graphqlHint = msg.replace("DOC_ID_EXPIRED:", "").trim();
        }
      }

      // Tier 2: OGP scrape — truncated caption
      const ogpResult = await this._tryOGP(url, shortcode, controller.signal, graphqlHint);
      if (ogpResult) return ogpResult;

      // Tier 3: Meta oEmbed — author only, requires user token
      if (this.metaToken) {
        const oembedResult = await this._tryMetaOEmbed(url, controller.signal);
        if (oembedResult) return oembedResult;
      }

      throw new Error(
        `All Instagram extraction tiers failed for ${url}. ` +
          `If GraphQL fails consistently, update docId (current: ${this.docId}).`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async _tryGraphQL(
    url: string,
    shortcode: string,
    signal: AbortSignal,
  ): Promise<ResearchResult | null> {
    try {
      const body = new URLSearchParams({
        variables: JSON.stringify({ shortcode }),
        doc_id: this.docId,
        lsd: INSTAGRAM_LSD,
      });

      const res = await fetch("https://www.instagram.com/api/graphql", {
        method: "POST",
        signal,
        headers: {
          "User-Agent": CHROME_UA,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-IG-App-ID": INSTAGRAM_APP_ID,
          "X-FB-LSD": INSTAGRAM_LSD,
          "X-ASBD-ID": "129477",
          "Sec-Fetch-Site": "same-origin",
          Origin: "https://www.instagram.com",
          Referer: `https://www.instagram.com/p/${shortcode}/`,
        },
        body: body.toString(),
      });

      if (!res.ok) {
        if (res.status === 400) {
          // 400 is the most common signal for doc_id rotation
          throw new Error(
            `DOC_ID_EXPIRED: Instagram GraphQL returned HTTP 400 — doc_id may have rotated. ` +
              `Update INSTAGRAM_DEFAULT_DOC_ID (current: ${this.docId}) or pass docId via constructor.`,
          );
        }
        return null;
      }

      const json = (await res.json()) as IgGraphQLResponse;
      if (json.errors?.length) {
        // API-level error array is the other common signal for doc_id rotation
        throw new Error(
          `DOC_ID_EXPIRED: Instagram GraphQL returned errors — doc_id may have rotated. ` +
            `Update INSTAGRAM_DEFAULT_DOC_ID (current: ${this.docId}) or pass docId via constructor.`,
        );
      }
      const media = json.data?.xdt_shortcode_media;
      if (!media) return null;

      const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() ?? "";
      const username = media.owner?.username ?? "unknown";
      const displayName = media.owner?.full_name;
      const author = displayName ?? username;

      let date: string | undefined;
      if (typeof media.taken_at_timestamp === "number") {
        date = new Date(media.taken_at_timestamp * 1000).toISOString();
      }

      const likes = media.edge_liked_by?.count;
      const comments = media.edge_media_to_comment?.count;
      const views =
        typeof media.video_view_count === "number"
          ? media.video_view_count
          : typeof media.play_count === "number"
            ? media.play_count
            : undefined;

      const truncated = caption.length > 60 ? `${caption.slice(0, 60)}...` : caption;

      return {
        url,
        title: `@${username}: ${truncated}`,
        content: caption || `[Instagram post by @${username}]`,
        type: "social",
        platform: "instagram",
        author,
        ...(date !== undefined && { date }),
        engagement: {
          ...(likes !== undefined && { likes }),
          ...(comments !== undefined && { comments }),
          ...(views !== undefined && { views }),
        },
        trust: { score: 0.8, verified: false },
        extractor: "experimental",
        extractedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async _tryOGP(
    url: string,
    shortcode: string,
    signal: AbortSignal,
    graphqlHint?: string,
  ): Promise<ResearchResult | null> {
    try {
      const targetUrl = `https://www.instagram.com/p/${shortcode}/`;
      const res = await fetch(targetUrl, {
        signal,
        headers: {
          "User-Agent": CHROME_UA,
          "X-IG-App-ID": INSTAGRAM_APP_ID,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (!res.ok) return null;

      const html = await res.text();
      const ogDesc = extractMeta(html, "og:description");
      const ogTitle = extractMeta(html, "og:title");
      if (!ogDesc && !ogTitle) return null;

      const { likes, comments, caption, username } = ogDesc ? parseOgDescription(ogDesc) : {};

      // og:title format: "{DisplayName} on Instagram: "{caption_short}""
      let author: string | undefined;
      let titleCaption: string | undefined;
      if (ogTitle) {
        const titleMatch = ogTitle.match(/^(.+?)\s+on\s+Instagram/i);
        if (titleMatch) author = titleMatch[1];
        const capMatch = ogTitle.match(/:\s*["""](.+?)["""]?\s*$/);
        if (capMatch) titleCaption = capMatch[1];
      }

      const finalCaption = caption ?? titleCaption ?? "";
      const finalUsername = username ?? author ?? "unknown";
      const truncated = finalCaption.length > 60 ? `${finalCaption.slice(0, 60)}...` : finalCaption;

      const ogpNote = graphqlHint
        ? `*Caption may be truncated (OGP fallback). GraphQL unavailable: ${graphqlHint}*`
        : `*Caption may be truncated (OGP fallback).*`;

      return {
        url,
        title: `@${finalUsername}: ${truncated}`,
        content: finalCaption
          ? `${finalCaption}\n\n${ogpNote}`
          : `[Instagram post by @${finalUsername}]`,
        type: "social",
        platform: "instagram",
        ...(author !== undefined && { author }),
        engagement: {
          ...(likes !== undefined && { likes }),
          ...(comments !== undefined && { comments }),
        },
        trust: { score: 0.5, verified: false },
        extractor: "readability",
        extractedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async _tryMetaOEmbed(url: string, signal: AbortSignal): Promise<ResearchResult | null> {
    if (!this.metaToken) return null;
    try {
      const oembedUrl =
        `https://graph.facebook.com/v19.0/instagram_oembed` +
        `?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(this.metaToken)}`;

      const res = await fetch(oembedUrl, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as MetaOEmbed;
      const authorName = data.author_name;
      let handle: string | undefined;
      if (data.author_url) {
        const m = data.author_url.match(/@([^/?#]+)/);
        handle = m?.[1];
      }

      const displayAuthor = authorName ?? (handle ? `@${handle}` : "unknown");

      return {
        url,
        title: `@${handle ?? authorName ?? "unknown"}: [Instagram post]`,
        content: `[Instagram post by ${displayAuthor} — caption unavailable via oEmbed]`,
        type: "social",
        platform: "instagram",
        ...(displayAuthor && { author: displayAuthor }),
        trust: { score: 0.7, verified: true },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
