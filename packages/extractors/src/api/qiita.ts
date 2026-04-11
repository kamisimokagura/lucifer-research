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

const QIITA_API = "https://qiita.com/api/v2";

interface QiitaItem {
  id: string;
  title: string;
  body: string;
  url: string;
  user: { id: string; name: string };
  created_at: string;
  likes_count: number;
  comments_count: number;
  page_views_count?: number;
  tags: Array<{ name: string }>;
}

export class QiitaExtractor implements Extractor {
  readonly tier = "api" as const;

  constructor(private readonly token?: string) {}

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname === "qiita.com";
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      // Parse item ID from URL: qiita.com/username/items/ITEMID
      const match = url.match(/\/items\/([a-zA-Z0-9]+)/);
      if (!match?.[1]) throw new Error(`Cannot parse Qiita item ID from: ${url}`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = this.token ?? process.env["QIITA_TOKEN"];
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${QIITA_API}/items/${match[1]}`, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Qiita API error: ${res.status}`);

      const item = (await res.json()) as QiitaItem;
      const tagNames = item.tags.map((t) => t.name).join(", ");

      // body is Markdown — use it directly without HTML stripping
      const content = [
        `# ${item.title}`,
        `**Author:** ${item.user.name} (@${item.user.id})`,
        tagNames ? `**Tags:** ${tagNames}` : "",
        "",
        item.body,
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        url: item.url,
        title: item.title,
        content,
        type: "article",
        platform: "qiita",
        author: item.user.name,
        date: item.created_at,
        engagement: {
          likes: item.likes_count,
          comments: item.comments_count,
          ...(item.page_views_count !== undefined && { views: item.page_views_count }),
        },
        trust: { score: 0.8, verified: false },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
