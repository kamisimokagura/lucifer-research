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

interface TranscriptSegment {
  text: string;
  duration?: number;
  offset?: number;
}

interface YouTubeApiItem {
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

function parseVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtu.be/<id>
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] ?? null;
    if (
      u.hostname === "www.youtube.com" ||
      u.hostname === "youtube.com" ||
      u.hostname === "m.youtube.com"
    ) {
      // /watch?v=<id>
      const v = u.searchParams.get("v");
      if (v) return v;
      // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
      const match = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([^/?#]+)/);
      if (match) return match[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function toInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export class YouTubeExtractor implements Extractor {
  readonly tier = "api" as const;

  /**
   * @param apiKey Optional YouTube Data API v3 key. When provided (or via
   *   YOUTUBE_API_KEY env var), the extractor fetches view/like/comment counts
   *   and marks results as verified. Without a key, only oEmbed metadata and
   *   transcript are returned (trust score 0.8, unverified).
   */
  constructor(private readonly apiKey?: string) {}

  canHandle(url: string): boolean {
    try {
      const h = new URL(url).hostname.replace("www.", "").replace("m.", "");
      return h === "youtube.com" || h === "youtu.be";
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 15_000;
    const videoId = parseVideoId(url);
    if (!videoId) throw new Error(`Cannot parse YouTube video ID from: ${url}`);

    const controller = new AbortController();
    const startTime = Date.now();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      // Always fetch oEmbed first — no API key required, covers title + author.
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const metaRes = await fetch(oembedUrl, { signal: controller.signal });
      const meta: Record<string, unknown> = metaRes.ok
        ? ((await metaRes.json()) as Record<string, unknown>)
        : {};

      let title = typeof meta["title"] === "string" ? meta["title"] : `YouTube ${videoId}`;
      let author = typeof meta["author_name"] === "string" ? meta["author_name"] : undefined;
      const oembedDescription =
        typeof meta["description"] === "string" && meta["description"].trim()
          ? (meta["description"] as string).trim()
          : undefined;

      // If an API key is available, enrich with statistics + verified snippet.
      const apiKey = this.apiKey ?? process.env["YOUTUBE_API_KEY"];
      let engagement: ResearchResult["engagement"];
      let date: string | undefined;
      const conflicts: string[] = [];
      let trustScore = 0.8;

      if (apiKey) {
        try {
          const apiUrl =
            `https://www.googleapis.com/youtube/v3/videos` +
            `?part=statistics,snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
          const apiRes = await fetch(apiUrl, { signal: controller.signal });
          if (apiRes.ok) {
            const payload = (await apiRes.json()) as { items?: YouTubeApiItem[] };
            const item = payload.items?.[0];
            if (item) {
              if (item.snippet?.title) title = item.snippet.title;
              if (item.snippet?.channelTitle) author = item.snippet.channelTitle;
              if (item.snippet?.publishedAt) date = item.snippet.publishedAt;
              const views = toInt(item.statistics?.viewCount);
              const likes = toInt(item.statistics?.likeCount);
              const comments = toInt(item.statistics?.commentCount);
              if (views !== undefined || likes !== undefined || comments !== undefined) {
                engagement = {
                  ...(views !== undefined && { views }),
                  ...(likes !== undefined && { likes }),
                  ...(comments !== undefined && { comments }),
                };
              }
              // Metadata (title/author/engagement) is authoritative via the Data API,
              // but the body content is still scraped transcript. Per the README
              // Reliability note, `verified=false` signals "content body fell back
              // to best-effort extraction" — which is true here regardless of the
              // API key, since youtube-transcript is a scraper. The positive signal
              // that metadata is API-backed is surfaced via `conflicts` for agents
              // that need to distinguish API metadata from scraped content.
              trustScore = 0.9;
              conflicts.push("metadata-verified-api:content-scraped-transcript");
            }
          }
          // If the API call fails (quota, key revoked, network), fall through
          // with oEmbed-only data rather than surfacing an extraction error.
        } catch (err) {
          // Re-throw when the caller's timeout fires — otherwise we'd silently
          // consume the timeout budget and proceed into transcript fetching,
          // breaking the caller's latency contract.
          if (controller.signal.aborted) throw err;
          // Non-abort failures (quota, key revoked, network) fall through to
          // the oEmbed-only path.
        }
      }

      // Fetch transcript via youtube-transcript (lazy import for ESM compat).
      // YoutubeTranscript does not accept an AbortSignal, so we wrap it in a
      // Promise.race using the remaining budget of the caller's timeout.
      let transcriptText = "";
      let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const { YoutubeTranscript } = await import("youtube-transcript");
        const remainingMs = Math.max(500, timeout - (Date.now() - startTime));
        const transcriptTimeout = new Promise<never>((_, reject) => {
          transcriptTimer = setTimeout(() => reject(new Error("transcript timeout")), remainingMs);
        });
        const segments = (await Promise.race([
          YoutubeTranscript.fetchTranscript(videoId),
          transcriptTimeout,
        ])) as TranscriptSegment[];
        transcriptText = segments
          .map((s) => s.text)
          .join(" ")
          .trim();
      } catch {
        transcriptText = oembedDescription ?? "[Transcript not available for this video]";
      } finally {
        clearTimeout(transcriptTimer);
      }
      // Some videos return an empty transcript (e.g. auto-generated captions with
      // no speech). Fall back to oEmbed description rather than leaving content blank.
      if (!transcriptText.trim()) {
        transcriptText = oembedDescription ?? "[Transcript not available for this video]";
      }

      const content = [
        `# ${title}`,
        author ? `**Channel:** ${author}` : "",
        `**URL:** ${url}`,
        "",
        "## Transcript",
        "",
        transcriptText,
      ]
        .filter((line, i) => i < 4 || line !== "")
        .join("\n\n");

      return {
        url,
        title,
        content,
        type: "video",
        platform: "youtube",
        ...(author !== undefined && { author }),
        ...(date !== undefined && { date }),
        ...(engagement !== undefined && { engagement }),
        trust: {
          score: trustScore,
          verified: false,
          ...(conflicts.length > 0 && { conflicts }),
        },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
