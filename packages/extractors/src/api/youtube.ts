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

export class YouTubeExtractor implements Extractor {
  readonly tier = "api" as const;

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
      // Fetch metadata via oEmbed (no API key required)
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const metaRes = await fetch(oembedUrl, { signal: controller.signal });
      const meta: Record<string, unknown> = metaRes.ok
        ? ((await metaRes.json()) as Record<string, unknown>)
        : {};

      const title = typeof meta["title"] === "string" ? meta["title"] : `YouTube ${videoId}`;
      const author = typeof meta["author_name"] === "string" ? meta["author_name"] : undefined;

      // Fetch transcript via youtube-transcript (lazy import for ESM compat).
      // YoutubeTranscript does not accept an AbortSignal, so we wrap it in a
      // Promise.race using the remaining budget of the caller's timeout.
      let transcriptText = "";
      try {
        const { YoutubeTranscript } = await import("youtube-transcript");
        const remainingMs = Math.max(500, timeout - (Date.now() - startTime));
        const transcriptTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("transcript timeout")), remainingMs),
        );
        const segments = (await Promise.race([
          YoutubeTranscript.fetchTranscript(videoId),
          transcriptTimeout,
        ])) as TranscriptSegment[];
        transcriptText = segments
          .map((s) => s.text)
          .join(" ")
          .trim();
      } catch {
        transcriptText = "[Transcript not available for this video]";
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
        trust: { score: 0.8, verified: false },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
