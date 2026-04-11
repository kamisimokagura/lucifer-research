/**
 * Security layer for lucifer-research.
 * Handles SSRF prevention, URL validation, content sanitization,
 * and prompt-injection detection.
 */

import { lookup as dnsLookup } from "node:dns/promises";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // IPv4 link-local (AWS/Azure metadata)
  /^::1$/,
  /^::ffff:127\./i, // IPv4-mapped loopback
  /^::ffff:10\./i, // IPv4-mapped RFC1918 10.x
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // IPv4-mapped RFC1918 172.16-31
  /^::ffff:192\.168\./i, // IPv4-mapped RFC1918 192.168
  /^::ffff:169\.254\./i, // IPv4-mapped link-local/metadata
  /^f[cd][0-9a-f]{2}:/i, // IPv6 ULA (fc00::/7 covers both fc and fd prefixes per RFC 4193)
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local
];

const LOOPBACK_NAMES = new Set(["localhost", "0.0.0.0", "ip6-localhost", "ip6-loopback"]);

// Block DNS rebinding: private IP addresses embedded in hostname (e.g. 127.0.0.1.nip.io)
const REBINDING_IP_PATTERNS = [
  /\b127\.\d+\.\d+\.\d+\b/,
  /\b10\.\d+\.\d+\.\d+\b/,
  /\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+\b/,
  /\b192\.168\.\d+\.\d+\b/,
  /\b169\.254\.\d+\.\d+\b/,
];

// Block well-known DNS rebinding services regardless of subdomain
const REBINDING_SERVICES = new Set(["nip.io", "sslip.io", "xip.io", "localtest.me", "vcap.me"]);

const INJECTION_PATTERNS = [
  /ignore (all |previous |prior )?(instructions?|prompts?|rules?)/i,
  /system prompt/i,
  /jailbreak/i,
  /\[INST\]/,
  /<\|system\|>/,
  /you are now/i,
  /forget everything/i,
  /disregard (all |your )?previous/i,
];

const MAX_CONTENT_BYTES = 1_048_576; // 1 MB

export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Validate and sanitize a URL before fetching.
 * Throws SecurityError for SSRF targets or non-HTTPS schemes.
 */
export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SecurityError(`Invalid URL: ${raw}`, "INVALID_URL");
  }

  if (url.protocol !== "https:") {
    throw new SecurityError(
      `Only HTTPS URLs are allowed, got: ${url.protocol}`,
      "INSECURE_PROTOCOL",
    );
  }

  // Normalize hostname:
  // 1. Strip trailing dot ("localhost." → "localhost")
  // 2. Strip IPv6 brackets ("[::1]" → "::1") — Node URL parser preserves brackets
  let hostname = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  // Block loopback name aliases (covers "localhost.", "ip6-localhost", etc.)
  if (LOOPBACK_NAMES.has(hostname.toLowerCase())) {
    throw new SecurityError(`SSRF blocked: ${hostname}`, "SSRF_BLOCKED");
  }

  // Block private IP ranges (IPv4, IPv6 ULA, link-local, IPv4-mapped loopback)
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new SecurityError(`SSRF blocked: ${hostname}`, "SSRF_BLOCKED");
    }
  }

  // Block DNS rebinding: private IP embedded in hostname (e.g. 127.0.0.1.nip.io)
  const hostLower = hostname.toLowerCase();
  for (const pattern of REBINDING_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new SecurityError(`SSRF blocked (rebinding): ${hostname}`, "SSRF_BLOCKED");
    }
  }

  // Block well-known rebinding service domains
  for (const service of REBINDING_SERVICES) {
    if (hostLower === service || hostLower.endsWith(`.${service}`)) {
      throw new SecurityError(`SSRF blocked (rebinding service): ${hostname}`, "SSRF_BLOCKED");
    }
  }

  return url;
}

/**
 * Resolve hostname via DNS and throw if the result is a private/loopback address.
 * Defends against SSRF via domains that resolve to internal IPs (e.g. attacker.com → 127.0.0.1).
 * If DNS lookup fails we let the request proceed — the fetch will fail naturally.
 */
async function blockPrivateDnsResolution(hostname: string): Promise<void> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    return;
  }
  for (const { address } of addresses) {
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(address)) {
        throw new SecurityError(
          `SSRF blocked (${hostname} resolved to private IP ${address})`,
          "SSRF_BLOCKED",
        );
      }
    }
    if (LOOPBACK_NAMES.has(address)) {
      throw new SecurityError(
        `SSRF blocked (${hostname} resolved to loopback ${address})`,
        "SSRF_BLOCKED",
      );
    }
  }
}

/**
 * Full SSRF guard: text-based hostname check + DNS resolution check.
 * Use this in pipeline entry points that don't go through safeFetch directly.
 * Throws SecurityError for any private/loopback target.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  const url = validateUrl(raw);
  await blockPrivateDnsResolution(url.hostname);
  return url;
}

/**
 * SSRF-safe fetch wrapper.
 * Validates each URL (text-based + DNS resolution) before connecting.
 * Uses redirect:"manual" so every redirect target is checked before following.
 * Throws SecurityError if any URL resolves to a private/loopback address.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  let hops = 0;

  while (hops <= maxRedirects) {
    // Text-based SSRF check first (fast), then DNS resolution check
    const validated = validateUrl(current);
    await blockPrivateDnsResolution(validated.hostname);

    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    // Resolve relative Location against current URL; validate on next iteration
    current = new URL(location, current).href;
    hops++;
  }

  throw new SecurityError(`Too many redirects for ${url}`, "TOO_MANY_REDIRECTS");
}

/**
 * Enforce content size limit.
 */
export function enforceContentSize(content: string): string {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_CONTENT_BYTES) {
    // Truncate at UTF-8 byte boundary (not JS char index)
    const truncated = Buffer.from(content, "utf8").subarray(0, MAX_CONTENT_BYTES).toString("utf8");
    return truncated + "\n\n[content truncated]";
  }
  return content;
}

/**
 * Scan extracted content for prompt-injection patterns.
 * Returns detected patterns (empty = clean).
 */
export function detectInjection(content: string): string[] {
  const found: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      found.push(pattern.source);
    }
  }
  return found;
}

/**
 * Sanitize extracted content: enforce size + flag injections.
 * Does NOT remove injections (preserve for transparency), but
 * wraps flagged text in a warning comment.
 */
export function sanitizeContent(raw: string): string {
  const sized = enforceContentSize(raw);
  const injections = detectInjection(sized);
  if (injections.length > 0) {
    return (
      `<!-- WARNING: Possible prompt-injection detected (${injections.length} pattern(s)) -->\n` +
      sized
    );
  }
  return sized;
}
