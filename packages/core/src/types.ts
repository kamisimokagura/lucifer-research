export type TrustLevel = "verified" | "unverified" | "conflicted";

export type ContentType =
  | "article"
  | "social"
  | "github"
  | "video"
  | "feed"
  | "other";

export type ExtractorTier =
  | "api"
  | "rss"
  | "jina"
  | "readability"
  | "browser"
  | "experimental";

export type Platform =
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

export interface Engagement {
  views?: number;
  likes?: number;
  reposts?: number;
  comments?: number;
}

export interface TrustInfo {
  score: number; // 0–1
  verified: boolean;
  conflicts?: string[];
}

export interface ResearchResult {
  url: string;
  title: string;
  content: string; // cleaned Markdown
  type: ContentType;
  platform: Platform;
  author?: string;
  date?: string;
  engagement?: Engagement;
  trust: TrustInfo;
  extractor: ExtractorTier;
  extractedAt: string; // ISO-8601
  error?: string;
}

export interface Extractor {
  readonly tier: ExtractorTier;
  canHandle(url: string): boolean;
  extract(url: string, options?: ExtractOptions): Promise<ResearchResult>;
}

export interface ExtractOptions {
  timeout?: number; // ms, default 10000
  maxBytes?: number; // default 1_048_576 (1 MB)
  respectRobots?: boolean; // default true
}

export interface ResearchConfig {
  jinaApiKey?: string;
  githubToken?: string;
  youtubeApiKey?: string;
  blueskyIdentifier?: string;
  blueskyPassword?: string;
  qiitaToken?: string;
  /** Max parallel extractions (default: 5) */
  concurrency?: number;
}
