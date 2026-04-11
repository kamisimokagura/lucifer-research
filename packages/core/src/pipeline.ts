import type { ResearchResult, Extractor, ExtractOptions, ResearchConfig } from "./types.js";
import { assertSafeUrl, sanitizeContent } from "./security.js";
import { selectRoute } from "./router.js";

export interface PipelineOptions extends ExtractOptions {
  /** Fall back to next tier on failure (default: true) */
  fallback?: boolean;
}

export class ResearchPipeline {
  private readonly extractors = new Map<string, Extractor>();

  constructor(private readonly config: ResearchConfig = {}) {}

  /** Register an extractor under a key (e.g. "github", "jina") */
  register(key: string, extractor: Extractor): this {
    this.extractors.set(key, extractor);
    return this;
  }

  /** Extract and sanitize a single URL */
  async extract(rawUrl: string, opts: PipelineOptions = {}): Promise<ResearchResult> {
    const { fallback = true } = opts;

    // Full SSRF guard: text-based check + DNS resolution
    await assertSafeUrl(rawUrl);

    const route = selectRoute(rawUrl);
    const fallbackOrder = [...new Set([route.extractorKey, "jina", "readability"])];

    for (const key of fallback ? fallbackOrder : [route.extractorKey]) {
      const extractor = this.extractors.get(key);
      // Skip extractors that explicitly don't handle this URL (e.g. Jina skips GitHub/YouTube)
      if (!extractor || !extractor.canHandle(rawUrl)) continue;

      try {
        const result = await extractor.extract(rawUrl, opts);
        result.content = sanitizeContent(result.content);
        return result;
      } catch (err) {
        if (!fallback) throw err;
        // try next in chain
      }
    }

    // All extractors failed — return error result
    return {
      url: rawUrl,
      title: "Extraction failed",
      content: "",
      type: "other",
      platform: "web",
      trust: { score: 0, verified: false },
      extractor: "jina",
      extractedAt: new Date().toISOString(),
      error: "All extractors failed for this URL",
    };
  }

  /** Extract multiple URLs with concurrency control */
  async extractAll(urls: string[], opts: PipelineOptions = {}): Promise<ResearchResult[]> {
    const concurrency = Math.max(1, this.config.concurrency ?? 5);
    const results: ResearchResult[] = [];

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const settled = await Promise.allSettled(batch.map((url) => this.extract(url, opts)));
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j]!;
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          // Return an error result so callers can correlate failures back to the input list
          results.push({
            url: batch[j]!,
            title: "Extraction failed",
            content: "",
            type: "other",
            platform: "web",
            trust: { score: 0, verified: false },
            extractor: "jina",
            extractedAt: new Date().toISOString(),
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      }
    }

    return results;
  }
}
