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

interface GitHubRepoResponse {
  stargazers_count?: number;
  description?: string;
  language?: string;
  [key: string]: unknown;
}

interface GitHubReadmeResponse {
  content?: string;
  encoding?: string;
  [key: string]: unknown;
}

export class GitHubExtractor implements Extractor {
  readonly tier = "api" as const;

  constructor(private readonly token?: string) {}

  canHandle(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return h === "github.com" || h === "gist.github.com" || h === "raw.githubusercontent.com";
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const parsed = new URL(url);
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "lucifer-research/0.1.0",
      };
      const token = this.token ?? process.env["GITHUB_TOKEN"];
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Handle raw.githubusercontent.com directly
      if (parsed.hostname === "raw.githubusercontent.com") {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": headers["User-Agent"]! },
        });
        if (!res.ok) throw new Error(`GitHub raw fetch failed: ${res.status}`);
        const content = await res.text();
        const pathParts = parsed.pathname.replace(/^\//, "").split("/");
        const [owner, repo, , ...fileParts] = pathParts;
        return {
          url,
          title: `${owner}/${repo}/${fileParts.join("/")}`,
          content,
          type: "github",
          platform: "github",
          ...(owner !== undefined && { author: owner }),
          trust: { score: 0.9, verified: true },
          extractor: "api",
          extractedAt: new Date().toISOString(),
        };
      }

      // Handle gist.github.com
      if (parsed.hostname === "gist.github.com") {
        // Path: /user/gist-id[/revision] — gist ID is always index 1, not the last segment
        const gistId = parsed.pathname.split("/").filter(Boolean)[1];
        if (!gistId) throw new Error("Cannot parse gist ID from URL");

        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
          signal: controller.signal,
          headers,
        });
        if (!res.ok) throw new Error(`GitHub Gist API error: ${res.status}`);
        const gist = (await res.json()) as Record<string, unknown>;
        const files = gist["files"] as
          | Record<
              string,
              {
                filename?: string;
                content?: string;
                language?: string;
                truncated?: boolean;
                raw_url?: string;
              }
            >
          | undefined;
        const fileEntries = Object.values(files ?? {});
        const combinedContent = (
          await Promise.all(
            fileEntries.map(async (f) => {
              let content = f.content ?? "";
              if (f.truncated && f.raw_url) {
                const rawRes = await fetch(f.raw_url, {
                  signal: controller.signal,
                  headers: { "User-Agent": headers["User-Agent"]! },
                });
                if (rawRes.ok) content = await rawRes.text();
              }
              return `### ${f.filename ?? "file"}\n\n\`\`\`${f.language ?? ""}\n${content}\n\`\`\``;
            }),
          )
        ).join("\n\n");
        const owner = (gist["owner"] as Record<string, unknown> | undefined)?.["login"] as
          | string
          | undefined;
        const description = typeof gist["description"] === "string" ? gist["description"] : "";

        return {
          url,
          title: description || `Gist ${gistId}`,
          content: combinedContent,
          type: "github",
          platform: "github",
          ...(owner !== undefined && { author: owner }),
          trust: { score: 0.9, verified: true },
          extractor: "api",
          extractedAt: new Date().toISOString(),
        };
      }

      // Parse github.com path: /owner/repo[/blob/<ref>/<path>]
      // NOTE: ref may contain "/" (e.g. "feature/my-branch"), so we never
      // destructure it as a single segment. Instead we pass everything after
      // /blob/ directly to raw.githubusercontent.com which resolves it correctly.
      const parts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);
      const [owner, repo, treeOrBlob] = parts;

      if (!owner || !repo) {
        throw new Error("Cannot parse GitHub URL: missing owner/repo");
      }

      const blobIdx = parts.indexOf("blob");
      const rawIdx = parts.indexOf("raw");
      // A file URL uses either /blob/<ref>/<path> or /raw/<ref>/<path>
      const fileIdx = treeOrBlob === "blob" ? blobIdx : treeOrBlob === "raw" ? rawIdx : -1;
      const isFile = fileIdx !== -1 && parts.length > fileIdx + 2;

      // Only the repository root (/owner/repo) falls through to README extraction.
      // Sub-pages such as /issues, /pull, /commit, /releases, /tree etc. are not
      // handled here — throw so the pipeline falls back to readability/jina instead
      // of returning unrelated repository content.
      if (!isFile && parts.length > 2) {
        throw new Error(`GitHub sub-page not supported for API extraction: ${url}`);
      }

      if (isFile) {
        // Everything after /blob/ or /raw/ → "ref/path/to/file".
        // Use the contents API with right-to-left ref/path splitting so that the
        // longest (most-specific) ref is tried first. This correctly handles branch
        // names containing "/" (e.g. "feature/docs") without the ambiguity of
        // raw.githubusercontent.com, which resolves left-to-right and can silently
        // return a file from a shorter ref that happens to exist.
        const refAndPath = parts.slice(fileIdx + 1).join("/");
        const segments = refAndPath.split("/");
        let content = "";
        let resolved = false;
        for (let i = segments.length - 1; i >= 1; i--) {
          const ref = segments.slice(0, i).join("/");
          const filePath = segments.slice(i).join("/");
          if (!filePath) continue;
          const apiRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
            { signal: controller.signal, headers },
          );
          if (apiRes.ok) {
            const data = (await apiRes.json()) as {
              content?: string;
              encoding?: string;
              download_url?: string;
            };
            if (data.content && data.encoding === "base64") {
              content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
              resolved = true;
              break;
            } else if (data.download_url) {
              // File > 1 MB: GitHub omits content and points to raw download URL
              const rawRes = await fetch(data.download_url, {
                signal: controller.signal,
                headers: { "User-Agent": headers["User-Agent"]! },
              });
              if (rawRes.ok) {
                content = await rawRes.text();
                resolved = true;
                break;
              }
            }
          }
        }
        if (!resolved) throw new Error(`GitHub file fetch failed: ${url}`);

        return {
          url,
          title: `${owner}/${repo}/${refAndPath}`,
          content,
          type: "github",
          platform: "github",
          author: owner,
          trust: { score: 0.9, verified: true },
          extractor: "api",
          extractedAt: new Date().toISOString(),
        };
      }

      // Fetch repo info + README in parallel
      const [repoRes, readmeRes] = await Promise.allSettled([
        fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          signal: controller.signal,
          headers,
        }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
          signal: controller.signal,
          headers,
        }),
      ]);

      if (repoRes.status !== "fulfilled" || !repoRes.value.ok) {
        const status = repoRes.status === "fulfilled" ? repoRes.value.status : "fetch failed";
        throw new Error(`GitHub repo API error: ${status} for ${owner}/${repo}`);
      }
      const repoData = (await repoRes.value.json()) as GitHubRepoResponse;

      let readmeContent = "";
      if (readmeRes.status === "fulfilled" && readmeRes.value.ok) {
        const readmeData = (await readmeRes.value.json()) as GitHubReadmeResponse;
        if (readmeData.content && readmeData.encoding === "base64") {
          readmeContent = Buffer.from(readmeData.content, "base64").toString("utf8");
        }
      }

      const stars =
        typeof repoData.stargazers_count === "number" ? repoData.stargazers_count : undefined;
      const description = typeof repoData.description === "string" ? repoData.description : "";
      const language = typeof repoData.language === "string" ? repoData.language : "";

      const content = [
        `# ${owner}/${repo}`,
        description,
        language ? `**Language:** ${language}` : "",
        stars !== undefined ? `**Stars:** ${stars.toLocaleString()}` : "",
        "",
        readmeContent,
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        url,
        title: `${owner}/${repo}`,
        content,
        type: "github",
        platform: "github",
        author: owner,
        engagement: { ...(stars !== undefined && { likes: stars }) },
        trust: { score: 0.95, verified: true },
        extractor: "api",
        extractedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
