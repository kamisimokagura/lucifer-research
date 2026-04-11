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

const HN_API = "https://hacker-news.firebaseio.com/v0";

interface HNItem {
  id: number;
  type: string;
  title?: string;
  text?: string;
  url?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  kids?: number[];
}

export class HackerNewsExtractor implements Extractor {
  readonly tier = "api" as const;

  canHandle(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return h === "news.ycombinator.com" || h === "hn.algolia.com";
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 8_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const parsed = new URL(url);
      const itemId = parsed.searchParams.get("id");

      if (!itemId) {
        throw new Error("HN URL missing item id parameter");
      }

      const res = await fetch(`${HN_API}/item/${itemId}.json`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HN API error: ${res.status}`);

      const item = (await res.json()) as HNItem;

      // Fetch top comments for context — sequential to avoid hammering Firebase
      const topKids = (item.kids ?? []).slice(0, 5);
      const commentTexts: string[] = [];
      for (const kid of topKids) {
        try {
          const cr = await fetch(`${HN_API}/item/${kid}.json`, {
            signal: controller.signal,
          });
          if (cr.ok) {
            const c = (await cr.json()) as HNItem;
            if (c.text) {
              const stripped = c.text.replace(/<[^>]+>/g, "").trim();
              if (stripped) commentTexts.push(`> **${c.by ?? "unknown"}:** ${stripped}`);
            }
          }
        } catch {
          // Skip individual comment failures
        }
      }

      const content = [
        item.title ? `# ${item.title}` : `# HN item ${itemId}`,
        item.url ? `**Link:** ${item.url}` : "",
        item.text ? item.text.replace(/<[^>]+>/g, "").trim() : "",
        commentTexts.length > 0 ? "## Top Comments\n\n" + commentTexts.join("\n\n") : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        url,
        title: item.title ?? `HN item ${itemId}`,
        content,
        type: "social",
        platform: "hackernews",
        ...(item.by !== undefined && { author: item.by }),
        ...(item.time !== undefined && { date: new Date(item.time * 1000).toISOString() }),
        engagement: {
          ...(item.score !== undefined && { likes: item.score }),
          ...(item.descendants !== undefined && { comments: item.descendants }),
        },
        trust: { score: 0.85, verified: false },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
