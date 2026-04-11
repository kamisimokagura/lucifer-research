// Re-export all extractor classes
export { GitHubExtractor } from "./api/github.js";
export { HackerNewsExtractor } from "./api/hackernews.js";
export { BlueskyExtractor } from "./api/bluesky.js";
export { YouTubeExtractor } from "./api/youtube.js";
export { QiitaExtractor } from "./api/qiita.js";
export { JinaExtractor } from "./web/jina.js";
export { RssExtractor } from "./feed/rss.js";
export { ReadabilityExtractor } from "./web/readability.js";

// Local type definitions mirroring @lucifer/core (workspace package not yet built)
export type ExtractorTier = "api" | "rss" | "jina" | "readability" | "browser" | "experimental";

export interface ResearchResult {
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

export interface ExtractOptions {
  timeout?: number;
  maxBytes?: number;
  respectRobots?: boolean;
}

export interface Extractor {
  readonly tier: ExtractorTier;
  canHandle(url: string): boolean;
  extract(url: string, options?: ExtractOptions): Promise<ResearchResult>;
}

import { GitHubExtractor } from "./api/github.js";
import { HackerNewsExtractor } from "./api/hackernews.js";
import { BlueskyExtractor } from "./api/bluesky.js";
import { YouTubeExtractor } from "./api/youtube.js";
import { QiitaExtractor } from "./api/qiita.js";
import { JinaExtractor } from "./web/jina.js";
import { RssExtractor } from "./feed/rss.js";
import { ReadabilityExtractor } from "./web/readability.js";

/**
 * Create and return the default extractor registry ordered by tier priority.
 *
 * Registry keys are stable identifiers used for lookup/override.
 * Callers should iterate `canHandle()` across values to find the right extractor,
 * preferring entries earlier in insertion order (API-tier extractors first).
 */
export function createDefaultRegistry(config?: {
  githubToken?: string;
  jinaApiKey?: string;
  qiitaToken?: string;
}): Map<string, Extractor> {
  const registry = new Map<string, Extractor>();
  // API-tier first (most authoritative, structured data)
  registry.set("github", new GitHubExtractor(config?.githubToken));
  registry.set("hackernews", new HackerNewsExtractor());
  registry.set("bluesky", new BlueskyExtractor());
  registry.set("youtube", new YouTubeExtractor());
  registry.set("qiita", new QiitaExtractor(config?.qiitaToken));
  // Feed-tier (RSS/Atom, no JS rendering needed)
  registry.set("rss", new RssExtractor());
  // Web-tier (Jina reader service, then local Readability fallback)
  registry.set("jina", new JinaExtractor(config?.jinaApiKey));
  registry.set("readability", new ReadabilityExtractor());
  return registry;
}

/**
 * Resolve the best extractor for a given URL from the registry.
 * Returns the first extractor whose `canHandle()` returns true,
 * respecting insertion order (API > RSS > Jina > Readability).
 */
export function resolveExtractor(
  url: string,
  registry: Map<string, Extractor> = createDefaultRegistry(),
): Extractor | undefined {
  for (const extractor of registry.values()) {
    if (extractor.canHandle(url)) return extractor;
  }
  return undefined;
}
