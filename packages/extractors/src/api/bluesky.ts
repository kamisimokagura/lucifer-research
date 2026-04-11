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

// @atproto/api types used inline to avoid import-time resolution issues
interface AtpAgent {
  resolveHandle(params: { handle: string }): Promise<{ data: { did: string } }>;
  getPostThread(params: { uri: string; depth: number }): Promise<{ data: { thread: unknown } }>;
}

// Lazy-loaded to allow tree-shaking and avoid top-level await issues
async function createAgent(service: string): Promise<AtpAgent> {
  const { BskyAgent } = await import("@atproto/api");
  return new BskyAgent({ service }) as unknown as AtpAgent;
}

export class BlueskyExtractor implements Extractor {
  readonly tier = "api" as const;

  canHandle(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return h === "bsky.app" || h === "staging.bsky.app";
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 10_000;

    // Parse bsky.app/profile/{handle}/post/{rkey}
    const match = url.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!match) throw new Error(`Cannot parse Bluesky URL: ${url}`);

    const [, handle, rkey] = match;
    if (!handle || !rkey) throw new Error(`Missing handle or rkey in Bluesky URL: ${url}`);

    // BskyAgent does not expose AbortSignal; enforce timeout via Promise.race
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Bluesky extraction timed out after ${timeout}ms`)),
        timeout,
      ),
    );

    return Promise.race([this._doExtract(url, handle, rkey), timeoutPromise]);
  }

  private async _doExtract(url: string, handle: string, rkey: string): Promise<ResearchResult> {
    const apiHost =
      new URL(url).hostname === "staging.bsky.app"
        ? "https://staging.bsky.app"
        : "https://public.api.bsky.app";
    const agent = await createAgent(apiHost);
    // Profile segment may be a DID (did:plc:...) or a handle (alice.bsky.social).
    // DIDs can be used directly; handles must be resolved to a DID first.
    const did = handle.startsWith("did:")
      ? handle
      : (await agent.resolveHandle({ handle })).data.did;
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;

    const { data } = await agent.getPostThread({ uri, depth: 1 });
    const thread = data.thread as Record<string, unknown>;
    const post = thread["post"] as Record<string, unknown> | undefined;

    if (!post) throw new Error("Post not found in thread response");

    const record = post["record"] as Record<string, unknown> | undefined;
    const text = typeof record?.["text"] === "string" ? record["text"] : "";
    const author = post["author"] as Record<string, unknown> | undefined;
    const likeCount = typeof post["likeCount"] === "number" ? post["likeCount"] : undefined;
    const repostCount = typeof post["repostCount"] === "number" ? post["repostCount"] : undefined;
    const replyCount = typeof post["replyCount"] === "number" ? post["replyCount"] : undefined;
    const indexedAt = typeof post["indexedAt"] === "string" ? post["indexedAt"] : undefined;
    const displayName =
      typeof author?.["displayName"] === "string" ? author["displayName"] : handle;
    const authorHandle = typeof author?.["handle"] === "string" ? author["handle"] : handle;

    const truncated = text.length > 60 ? `${text.slice(0, 60)}...` : text;

    return {
      url,
      title: `@${authorHandle}: ${truncated}`,
      content: text,
      type: "social",
      platform: "bluesky",
      author: displayName,
      ...(indexedAt !== undefined && { date: indexedAt }),
      engagement: {
        ...(likeCount !== undefined && { likes: likeCount }),
        ...(repostCount !== undefined && { reposts: repostCount }),
        ...(replyCount !== undefined && { comments: replyCount }),
      },
      trust: { score: 0.85, verified: false },
      extractor: "api",
      extractedAt: new Date().toISOString(),
    };
  }
}
