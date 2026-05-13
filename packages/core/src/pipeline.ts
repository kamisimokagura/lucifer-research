import type { ResearchResult, Extractor, ExtractOptions, ResearchConfig } from "./types.js";
import { assertSafeUrl, sanitizeContent } from "./security.js";
import { selectRoute } from "./router.js";
import type { RouteInfo } from "./router.js";

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

    // Hybrid mode: run primary extractor + BrowserExtractor concurrently.
    // Chrome window opens visually (when BROWSER_HEADED=1) while API data is fetched.
    // Merge: primary metadata (engagement/author/date) + richer content from either source.
    if (route.hybrid) {
      return this._hybridExtract(rawUrl, route, opts);
    }

    const fallbackOrder = [...new Set([route.extractorKey, "jina", "readability", "browser"])];

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

  /**
   * Run primary extractor and BrowserExtractor in parallel, then merge.
   * Primary wins for metadata (engagement/author/date/trust); richer content wins.
   */
  private async _hybridExtract(
    rawUrl: string,
    route: RouteInfo,
    opts: PipelineOptions,
  ): Promise<ResearchResult> {
    const primaryExtractor = this.extractors.get(route.extractorKey);
    const browserExtractor = this.extractors.get("browser");

    const [primarySettled, browserSettled] = await Promise.allSettled([
      primaryExtractor?.canHandle(rawUrl)
        ? primaryExtractor.extract(rawUrl, opts)
        : Promise.reject(new Error("primary extractor unavailable")),
      browserExtractor?.canHandle(rawUrl)
        ? browserExtractor.extract(rawUrl, opts)
        : Promise.reject(new Error("browser extractor unavailable")),
    ]);

    const primary = primarySettled.status === "fulfilled" ? primarySettled.value : null;
    const browser = browserSettled.status === "fulfilled" ? browserSettled.value : null;

    if (primary && browser) {
      const browserWins = browser.content.length > primary.content.length;
      const content = browserWins ? browser.content : primary.content;
      // When browser content wins, mark trust as conflicted so downstream
      // consumers know the body is browser-scraped despite API metadata.
      const trust = browserWins
        ? {
            ...primary.trust,
            verified: false,
            conflicts: [...(primary.trust.conflicts ?? []), "metadata-primary:content-browser"],
          }
        : primary.trust;
      return {
        ...primary,
        content: sanitizeContent(content),
        extractor: "hybrid",
        trust,
      };
    }

    if (primary) return { ...primary, content: sanitizeContent(primary.content) };
    if (browser) return { ...browser, content: sanitizeContent(browser.content) };

    // Both failed — try Jina/Readability as last resort (skipped when fallback: false)
    if (opts.fallback !== false) {
      for (const key of ["jina", "readability"] as const) {
        const extractor = this.extractors.get(key);
        if (!extractor || !extractor.canHandle(rawUrl)) continue;
        try {
          const result = await extractor.extract(rawUrl, opts);
          result.content = sanitizeContent(result.content);
          return result;
        } catch {
          // try next
        }
      }
    }

    return {
      url: rawUrl,
      title: "Extraction failed",
      content: "",
      type: "other",
      platform: "web",
      trust: { score: 0, verified: false },
      extractor: "hybrid",
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
