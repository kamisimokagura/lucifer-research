import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { assertSafeUrl } from "@lucifer/core";

type ExtractorTier = "api" | "rss" | "jina" | "readability" | "browser" | "experimental";

interface ResearchResult {
  url: string;
  title: string;
  content: string;
  type: "article" | "social" | "github" | "video" | "feed" | "other";
  platform:
    | "github" | "youtube" | "hackernews" | "bluesky" | "qiita" | "reddit"
    | "mastodon" | "threads" | "telegram" | "x" | "instagram" | "tiktok"
    | "zenn" | "medium" | "note" | "web";
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

type PlaywrightStorageState = Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>;

interface ContextBundle {
  context: import("playwright").BrowserContext;
  close(): Promise<void>;
  strategy: 0 | 1 | 2 | 3;
}

// X/Twitter: login wall detected via isLoginWallTitle() / isLoginWallUrl().
// Strategy 2 (Chrome profile) succeeds when the user is logged in to X in Chrome.
// Without credentials, the title check catches "Sign Up | X" and falls back to the API extractor.
const EXCLUDED_HOSTNAMES = new Set<string>();

// URL patterns that indicate a login wall redirect
const LOGIN_URL_PATTERNS = [
  /\/login/i,
  /\/signin/i,
  /\/sign-in/i,
  /\/auth\//i,
  /\/account\/login/i,
  /accounts\.google\.com/i,
  /login\.microsoftonline/i,
  /login\.live\.com/i,
];

// SSRF protection patterns — mirrors core/security.ts PRIVATE_IP_PATTERNS et al.
const PRIVATE_IP_RE = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // IPv4 link-local (AWS/Azure metadata)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // RFC 6598 CGNAT / Alibaba Cloud metadata (100.64.0.0/10)
  /^::1$/, // IPv6 loopback
  /^::ffff:127\./i, // IPv4-mapped loopback
  /^::ffff:10\./i, // IPv4-mapped RFC1918 10.x
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // IPv4-mapped RFC1918 172.16-31
  /^::ffff:192\.168\./i, // IPv4-mapped RFC1918 192.168
  /^::ffff:169\.254\./i, // IPv4-mapped link-local/metadata
  /^::ffff:100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./i, // IPv4-mapped CGNAT (100.64.0.0/10)
  /^f[cd][0-9a-f]{2}:/i, // IPv6 ULA (fc00::/7)
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local
];
const LOOPBACK_NAMES = new Set(["localhost", "0.0.0.0", "ip6-localhost", "ip6-loopback"]);
const REBINDING_IP_RE = [
  /\b127\.\d+\.\d+\.\d+\b/,
  /\b10\.\d+\.\d+\.\d+\b/,
  /\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\b/,
  /\b192\.168\.\d+\.\d+\b/,
  /\b169\.254\.\d+\.\d+\b/,
  /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/, // CGNAT embedded in hostname
];
const REBINDING_SERVICES = new Set(["nip.io", "sslip.io", "xip.io", "localtest.me", "vcap.me"]);

function isLoginWallUrl(url: string): boolean {
  return LOGIN_URL_PATTERNS.some((p) => p.test(url));
}

/** SPA sites (e.g. LinkedIn) may change the document title without navigating. */
function isLoginWallTitle(title: string): boolean {
  const t = title.toLowerCase();
  return t.includes("sign up") || t.includes("sign in") || t.includes("log in") || t.includes("login");
}

/** Returns true if the URL's hostname resolves to a private/loopback address. */
function isPrivateUrl(urlStr: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(urlStr).hostname;
  } catch {
    return true; // malformed URL — block
  }
  // Normalize trailing-dot ("localhost." → "localhost") and IPv6 brackets ("[::1]" → "::1")
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);

  const hostLower = hostname.toLowerCase();
  if (LOOPBACK_NAMES.has(hostLower)) return true;
  for (const p of PRIVATE_IP_RE) if (p.test(hostname)) return true;
  for (const p of REBINDING_IP_RE) if (p.test(hostname)) return true;
  for (const service of REBINDING_SERVICES) {
    if (hostLower === service || hostLower.endsWith(`.${service}`)) return true;
  }
  return false;
}

/**
 * Install context-level SSRF block on all network requests.
 * Using context.route (not page.route) ensures popups and new pages created within
 * the context also inherit the block without extra setup.
 *
 * Limitation: only hostname text patterns are checked here (DNS resolution of browser
 * sub-requests is impractical at request time). When called via ResearchPipeline,
 * assertSafeUrl() already ran DNS resolution on the top-level URL before this extractor
 * is invoked, so the primary navigation target is validated. Direct calls to extract()
 * outside the pipeline do not have that guarantee.
 */
async function installSsrfRoute(
  context: import("playwright").BrowserContext,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const reqUrl = route.request().url();
    // Skip non-HTTP resources (data:, blob:, about:, extensions, service workers, etc.)
    if (!reqUrl.startsWith("http://") && !reqUrl.startsWith("https://")) {
      await route.continue();
      return;
    }
    if (isPrivateUrl(reqUrl)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

/**
 * BrowserExtractor — Playwright-based final fallback.
 *
 * Context creation uses a three-strategy hybrid to work even when Chrome is running:
 *
 *   Strategy 1 (session file): ~/.lucifer/sessions/<domain>.json exists
 *     → chromium.launch() + storageState  (no profile lock, Chrome can be open)
 *
 *   Strategy 2 (Chrome profile): CHROME_USER_DATA_DIR set, no session file
 *     → launchPersistentContext(userDataDir)  (reuses full login sessions)
 *     → falls back to Strategy 3 if the profile is locked (Chrome is running)
 *
 *   Strategy 3 (isolated context): no session, no profile or profile locked
 *     → chromium.launch() + newContext()  (no cookies, but page still loads)
 *
 * When a login wall is detected, switches to headed mode and waits for the user to
 * log in interactively, then saves context.storageState() as a session file so future
 * runs use Strategy 1 without touching the Chrome profile at all.
 *
 * Non-interactive environments (MCP, CI, piped stdin) skip headed mode entirely.
 * X/Twitter is always excluded (login wall is structurally unbypassable without credentials).
 * SSRF protection: all sub-resource requests to private/loopback addresses are blocked.
 */
export class BrowserExtractor implements Extractor {
  readonly tier = "browser" as const;

  private readonly userDataDir: string | undefined;
  private readonly sessionDir: string;

  constructor(options?: { userDataDir?: string; sessionDir?: string }) {
    this.userDataDir = options?.userDataDir ?? process.env["CHROME_USER_DATA_DIR"];
    this.sessionDir = options?.sessionDir ?? defaultSessionDir();
  }

  canHandle(url: string): boolean {
    try {
      const { hostname, protocol } = new URL(url);
      if (protocol !== "https:" || EXCLUDED_HOSTNAMES.has(hostname)) return false;
      // Allow if Chrome profile is configured (Strategy 2) or a saved session exists (Strategy 1).
      // Strategy 3 (isolated context) is not used without at least one of these — it would
      // launch headless Chromium for every URL with no cookies, degrading performance for no gain.
      return !!process.env["CHROME_CDP_URL"] || !!this.userDataDir || existsSync(this._sessionPath(url));
    } catch {
      return false;
    }
  }

  async extract(url: string, opts: ExtractOptions = {}): Promise<ResearchResult> {
    const timeout = opts.timeout ?? 30_000;
    // DNS SSRF guard — covers direct extract() calls that bypass ResearchPipeline.
    await assertSafeUrl(url);
    // BROWSER_HEADED=1 → show the browser window on screen.
    // Intended for local visual debugging / demo use only — do NOT set on unattended servers
    // as it exposes authenticated pages on-screen. Works in both TTY and MCP contexts.
    const headless = process.env["BROWSER_HEADED"] !== "1";
    process.stderr.write(`[BrowserExtractor] extract() called: ${url} | userDataDir: ${this.userDataDir ? "set" : "unset"} | headless: ${headless} | isTTY: ${!!process.stdin.isTTY}\n`);
    const { chromium } = await import("playwright");

    // First attempt: browser (uses session file or Chrome profile)
    const headlessResult = await this._tryHeadless(url, chromium, timeout, headless);
    if (headlessResult) return headlessResult;

    // Login wall detected — prompt user for manual login (interactive only)
    await this._promptUserLogin(url, chromium, timeout);

    // Second attempt after login (session file was saved by _promptUserLogin)
    const retryResult = await this._tryHeadless(url, chromium, timeout, headless);
    if (retryResult) return retryResult;

    throw new Error(`BrowserExtractor: failed to extract content from ${url} after login`);
  }

  private _sessionPath(url: string): string {
    const { hostname } = new URL(url);
    const domain = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    // Sanitize: RFC hostnames use [a-z0-9.-] only; this guards against IDNA/punycode
    // edge cases and ensures the result is a valid filename on all platforms.
    const safeName = domain.replace(/[^a-z0-9.-]/g, "_");
    return path.join(this.sessionDir, `${safeName}.json`);
  }

  private async _loadSession(url: string): Promise<PlaywrightStorageState | null> {
    try {
      const data = await readFile(this._sessionPath(url), "utf8");
      return JSON.parse(data) as PlaywrightStorageState;
    } catch {
      return null;
    }
  }

  private async _saveSession(
    url: string,
    context: import("playwright").BrowserContext,
  ): Promise<void> {
    try {
      const { hostname } = new URL(url);
      const domain = hostname.replace(/^www\./, "");

      const fullState = await context.storageState();

      // Filter to the target domain only — avoids leaking other authenticated sessions
      // that may exist in the Chrome profile (Strategy 2 context).
      const filtered: PlaywrightStorageState = {
        cookies: fullState.cookies.filter((c) => {
          const d = c.domain.replace(/^\./, "");
          return d === domain || d.endsWith(`.${domain}`);
        }),
        origins: fullState.origins.filter((o) => {
          try {
            const h = new URL(o.origin).hostname;
            return h === domain || h.endsWith(`.${domain}`);
          } catch {
            return false;
          }
        }),
      };

      // 0o700 dir + 0o600 file: session files contain bearer-equivalent cookies.
      // Atomic write via temp-then-rename: prevents a partial file from being read
      // if the process is interrupted mid-write, and avoids following symlinks on rename.
      await mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
      await chmod(this.sessionDir, 0o700).catch(() => {});
      const sessionFile = this._sessionPath(url);
      // Use a unique temp name (pid + uuid) to avoid races when the same domain
      // is extracted concurrently — each writer gets its own temp slot.
      const tmpFile = `${sessionFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmpFile, JSON.stringify(filtered, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(tmpFile, 0o600).catch((e) => {
        process.stderr.write(`[BrowserExtractor] chmod failed on session temp file: ${e}\n`);
      });
      await rename(tmpFile, sessionFile);
      process.stderr.write(`[BrowserExtractor] Session saved: ${sessionFile}\n`);
    } catch (err) {
      process.stderr.write(`[BrowserExtractor] Failed to save session: ${err}\n`);
    }
  }

  /**
   * Create a browser context using the best available strategy (see class doc).
   * Returns a ContextBundle whose close() handles the correct teardown path for each strategy.
   */
  private async _createContext(
    url: string,
    chromium: import("playwright").BrowserType,
    headless: boolean,
  ): Promise<ContextBundle> {
    // Strategy 0: CDP — attach to an already-running Chrome via DevTools Protocol.
    // Requires Chrome started with --remote-debugging-port=<port> and CHROME_CDP_URL set.
    // This is the only strategy that can access real login sessions on Windows (DPAPI cookies).
    const cdpUrl = process.env["CHROME_CDP_URL"];
    if (cdpUrl) {
      // Security: CDP gives full browser control — validate strictly before connecting.
      // Only loopback targets are allowed; credentials in URL and non-http(s)/ws(s) schemes are rejected.
      const cdpHttpBase = cdpUrl.startsWith("ws") ? cdpUrl.replace(/^ws(s?)/, "http$1") : cdpUrl;
      let cdpLoopback = false;
      try {
        const parsed = new URL(cdpHttpBase);
        const okScheme = ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol);
        if (!okScheme) {
          process.stderr.write(`[BrowserExtractor] CHROME_CDP_URL rejected: scheme must be http/https/ws/wss\n`);
        } else if (parsed.username || parsed.password) {
          process.stderr.write(`[BrowserExtractor] CHROME_CDP_URL rejected: credentials in URL not allowed\n`);
        } else {
          let h = parsed.hostname.toLowerCase();
          // Strip IPv6 brackets if present (new URL() returns "[::1]" for IPv6 in some environments)
          if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
          // Allow the full 127.0.0.0/8 loopback range and IPv6 loopback, plus named aliases.
          cdpLoopback =
            LOOPBACK_NAMES.has(h) ||
            h === "::1" ||
            /^127\./.test(h) ||
            /^::ffff:127\./i.test(h);
          if (!cdpLoopback) {
            process.stderr.write(`[BrowserExtractor] CHROME_CDP_URL rejected: must point to loopback, got "${parsed.hostname}"\n`);
          }
        }
      } catch {
        process.stderr.write(`[BrowserExtractor] CHROME_CDP_URL rejected: malformed URL\n`);
      }

      if (cdpLoopback) {
        try {
          // Health check only for http(s) base URLs; ws:// endpoints skip the pre-check
          // (connectOverCDP itself will fail fast if Chrome isn't listening).
          if (!cdpUrl.startsWith("ws")) {
            await fetch(`${cdpHttpBase.replace(/\/$/, "")}/json/version`, { signal: AbortSignal.timeout(500) });
          }
          process.stderr.write(`[BrowserExtractor] Strategy 0: CDP connect (loopback confirmed)\n`);
          const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5_000 });
          const existingContexts = browser.contexts();
          const context = existingContexts[0] ?? await browser.newContext();
          process.stderr.write(`[BrowserExtractor] Strategy 0: connected (${existingContexts.length} context(s))\n`);
          // close() on a CDP-connected browser only disconnects; it does NOT kill Chrome
          return { context, close: async () => { await browser.close().catch(() => {}); }, strategy: 0 };
        } catch (err) {
          process.stderr.write(`[BrowserExtractor] Strategy 0 unavailable: ${(err as Error).message ?? err}\n`);
        }
      }
    }

    // Strategy 1: session file — works even when Chrome is running
    const storageState = await this._loadSession(url);
    if (storageState !== null) {
      process.stderr.write(`[BrowserExtractor] Strategy 1: loading session file for ${new URL(url).hostname}\n`);
      const browser = await chromium.launch({ headless });
      try {
        const context = await browser.newContext({ storageState });
        return { context, close: async () => { await browser.close().catch(() => {}); }, strategy: 1 };
      } catch {
        // Corrupt/incompatible session file — discard and fall through to Strategy 2/3
        await browser.close().catch(() => {});
        process.stderr.write(`[BrowserExtractor] Strategy 1 failed (corrupt session) — trying Strategy 2/3\n`);
      }
    }

    // Strategy 2: persistent Chrome profile
    if (this.userDataDir) {
      process.stderr.write(`[BrowserExtractor] Strategy 2: trying Chrome profile (${this.userDataDir})\n`);
      try {
        // When headed, use the installed Chrome binary so Windows DPAPI-encrypted
        // cookies are accessible. Chrome does not support headless reliably in
        // launchPersistentContext, so fall back to Playwright's Chromium in headless mode.
        const launchOpts = headless
          ? { headless: true as const }
          : { headless: false as const, channel: "chrome" as const };
        const context = await chromium.launchPersistentContext(this.userDataDir, launchOpts);
        process.stderr.write(`[BrowserExtractor] Strategy 2: Chrome profile opened successfully (${headless ? "chromium/headless" : "chrome/headed"})\n`);
        return { context, close: async () => { await context.close().catch(() => {}); }, strategy: 2 };
      } catch (err) {
        const msgLower = String((err as Error).message ?? "").toLowerCase();
        // Detect Chrome profile lock errors. Normalize to lowercase to avoid
        // missing mixed-case variants; match specific phrases to avoid treating
        // unrelated errors (e.g. "lockfile" in another context) as lock errors.
        const isLocked =
          msgLower.includes("singletonlock") ||
          msgLower.includes("could not lock user data directory") ||
          msgLower.includes("user data directory is already in use") ||
          msgLower.includes("profile is already in use") ||
          (msgLower.includes("lock") && msgLower.includes("profile")) ||
          (msgLower.includes("lock") && msgLower.includes("user data"));
        if (!isLocked) throw err;
        process.stderr.write(
          `[BrowserExtractor] Chrome profile locked — using isolated context (Chrome is running)\n`,
        );
      }
    }

    // Strategy 3: isolated empty context (no cookies)
    process.stderr.write(`[BrowserExtractor] Strategy 3: isolated context (no credentials)\n`);
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    return { context, close: async () => { await browser.close().catch(() => {}); }, strategy: 3 };
  }

  private async _tryHeadless(
    url: string,
    chromium: import("playwright").BrowserType,
    timeout: number,
    headless = true,
  ): Promise<ResearchResult | null> {
    let bundle: ContextBundle | undefined;
    let page: import("playwright").Page | undefined;
    try {
      bundle = await this._createContext(url, chromium, headless);
      await installSsrfRoute(bundle.context);
      page = await bundle.context.newPage();

      await page.goto(url, { timeout, waitUntil: "domcontentloaded" });

      // Give JS-triggered redirects time to fire (e.g. LinkedIn's post-load login redirect).
      // Bounded at 3s — best-effort stabilization, not a correctness guarantee.
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

      // Re-check login wall after potential JS redirect
      if (isLoginWallUrl(page.url())) return null;

      const title = await page.title();
      if (isLoginWallTitle(title)) {
        process.stderr.write(`[BrowserExtractor] Login wall detected via title: "${title}"\n`);
        return null;
      }
      let bodyText: string;
      try {
        bodyText = await page.evaluate(() => {
          const el =
            document.querySelector("main") ??
            document.querySelector("article") ??
            document.body;
          return (el as HTMLElement | null)?.innerText ?? "";
        });
      } catch (evalErr) {
        // "Execution context was destroyed" means the page navigated away during evaluate
        // (e.g. a delayed JS login redirect). Treat as login wall — return null so
        // _promptUserLogin() can handle it, or the pipeline falls back to the next extractor.
        const msg = String(evalErr);
        const isNavigationRace =
          msg.includes("Execution context was destroyed") ||
          msg.includes("Cannot find context with specified id") ||
          (msg.includes("navigation") && !msg.includes("Target closed"));
        if (isNavigationRace) {
          process.stderr.write(`[BrowserExtractor] page.evaluate navigation race at ${page.url()}\n`);
          return null;
        }
        throw evalErr;
      }

      if (!bodyText.trim()) return null;

      // Strategy 2: save session so future requests can use Strategy 1 while Chrome profile is locked.
      // Strategy 0 (CDP): saving live authenticated cookies to disk is a security trade-off;
      // only do it when BROWSER_SAVE_CDP_SESSION=1 is explicitly set.
      if (bundle.strategy === 2 || (bundle.strategy === 0 && process.env["BROWSER_SAVE_CDP_SESSION"] === "1")) {
        await this._saveSession(url, bundle.context);
      }

      const { hostname } = new URL(url);
      const domain = hostname.replace(/^www\./, "");

      // BROWSER_KEEP_OPEN=<ms> keeps the window open after extraction for visual inspection.
      // Only meaningful when BROWSER_HEADED=1; ignored in headless mode.
      const keepOpenMs = !headless
        ? Math.min(parseInt(process.env["BROWSER_KEEP_OPEN"] ?? "0", 10) || 0, 60_000)
        : 0;
      if (keepOpenMs > 0) {
        process.stderr.write(`[BrowserExtractor] Keeping browser open for ${keepOpenMs}ms (BROWSER_KEEP_OPEN)\n`);
        await new Promise<void>((resolve) => setTimeout(resolve, keepOpenMs));
      }

      return {
        url,
        title: title || domain,
        content: bodyText.slice(0, 50_000),
        type: "article",
        platform: "web",
        trust: { score: 0.6, verified: false },
        extractor: "browser",
        extractedAt: new Date().toISOString(),
      };
    } catch (err) {
      process.stderr.write(`[BrowserExtractor] headless extraction failed: ${err instanceof Error ? err.message : String(err)}\n`);
      return null;
    } finally {
      // For CDP (Strategy 0): explicitly close the tab we opened and unroute SSRF rules
      // before disconnecting, to avoid leaving orphan tabs and affecting other live contexts.
      if (bundle?.strategy === 0) {
        await page?.close().catch(() => {});
        await bundle.context.unroute("**/*").catch(() => {});
      }
      await bundle?.close();
    }
  }

  private async _promptUserLogin(
    url: string,
    chromium: import("playwright").BrowserType,
    timeout: number,
  ): Promise<void> {
    const { hostname } = new URL(url);

    // Non-interactive environments (MCP, CI, piped stdin) cannot show a browser prompt.
    // Skip silently — the second headless attempt will also fail and the caller throws,
    // falling through to the pipeline error result.
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `[BrowserExtractor] Non-interactive environment — skipping headed login for ${hostname}\n`,
      );
      return;
    }

    process.stderr.write(
      `[BrowserExtractor] Login required for ${hostname}.\n` +
        `Opening browser — please log in, then press Enter to continue.\n`,
    );

    let bundle: ContextBundle | undefined;
    try {
      bundle = await this._createContext(url, chromium, false);
      await installSsrfRoute(bundle.context);
      const page = await bundle.context.newPage();
      await page.goto(url, { timeout });

      // Wait for user to press Enter, with a 5-minute hard timeout to avoid
      // hanging forever in semi-interactive or forgotten-open-browser scenarios.
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin });
        const timer = setTimeout(() => {
          rl.close();
          resolve();
        }, 5 * 60 * 1000);
        rl.once("line", () => {
          clearTimeout(timer);
          rl.close();
          resolve();
        });
      });

      // Save storageState so next _tryHeadless() uses Strategy 1 (no profile lock needed).
      await this._saveSession(url, bundle.context);
      process.stderr.write(`[BrowserExtractor] Login complete — session saved.\n`);
    } finally {
      await bundle?.close();
    }
  }
}

/** Resolve the default session directory path. */
export function defaultSessionDir(): string {
  return path.join(homedir(), ".lucifer", "sessions");
}
