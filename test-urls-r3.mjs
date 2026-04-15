// lucifer-research URL テスト Round 3
// Bluesky × 3, TikTok × 3, Zenn × 2, Medium × 2, note × 2
// Expected extractor is tracked so fallbacks don't silently mask primary failures.
import { ResearchPipeline } from "./packages/core/dist/pipeline.js";
import { createDefaultRegistry } from "./packages/extractors/dist/index.js";

const TEST_CASES = [
  // --- Bluesky (AT Protocol, public API) ---
  // expectedExtractor: "api" when AT Protocol works, "jina" for fallback
  // Both are acceptable; we track which path was actually taken.
  {
    url: "https://bsky.app/profile/bsky.app/post/3jxqyd7q6m22i",
    preferredExtractor: "api",
    expectedPlatform: "bluesky",
  },
  {
    url: "https://bsky.app/profile/jay.bsky.team/post/3k4qda3omye27",
    preferredExtractor: "api",
    expectedPlatform: "bluesky",
  },
  {
    url: "https://bsky.app/profile/pfrazee.com/post/3kgqqsyfabs2k",
    preferredExtractor: "api",
    expectedPlatform: "bluesky",
  },

  // --- TikTok (oEmbed API, bot-protected) ---
  // Direct video URLs: oEmbed API 403 + Jina Cloudflare block → expect all-fail.
  // Shortlinks (vm.tiktok.com) are excluded: they redirect to the explore page, not a
  // specific video, so expected platform is ambiguous (tiktok if oEmbed wins, web if
  // Jina wins) and any single expectedPlatform produces false results.
  {
    url: "https://www.tiktok.com/@openai/video/7490613990703827246",
    preferredExtractor: "api",
    expectedPlatform: "tiktok",
  },
  {
    url: "https://www.tiktok.com/@nasa/video/7374665893823636782",
    preferredExtractor: "api",
    expectedPlatform: "tiktok",
  },

  // --- Zenn real articles (RSS primary, Jina fallback) ---
  // Use real article slugs known to exist
  {
    url: "https://zenn.dev/zenn/articles/zenn-cli-guide",
    preferredExtractor: "rss",
    expectedPlatform: "zenn",
  },
  {
    url: "https://zenn.dev/microsoft/articles/dotnet-9-ga",
    preferredExtractor: "rss",
    expectedPlatform: "zenn",
  },

  // --- Medium (RSS primary, Jina fallback) ---
  {
    url: "https://medium.com/@buildermindset/the-ai-coding-assistant-showdown-2026-claude-code-vs-cursor-vs-copilot-x-7b9a1de25684",
    preferredExtractor: "rss",
    expectedPlatform: "medium",
  },
  {
    url: "https://medium.com/anthropic/claude-as-co-creator-f4e2dfbb2c75",
    preferredExtractor: "rss",
    expectedPlatform: "medium",
  },

  // --- note.com (RSS primary, Jina fallback) ---
  {
    url: "https://note.com/masahirochaen/n/ncc0e3dc4a9ae",
    preferredExtractor: "rss",
    expectedPlatform: "note",
  },
  {
    url: "https://note.com/taziku_co/n/na5d00960e012",
    preferredExtractor: "rss",
    expectedPlatform: "note",
  },
];

const registry = createDefaultRegistry();
const pipeline = new ResearchPipeline();
for (const [key, extractor] of registry) {
  pipeline.register(key, extractor);
}

const results = [];
console.log("=".repeat(70));
console.log("Round 3: Bluesky / TikTok / RSS platforms");
console.log("=".repeat(70));

for (const { url, preferredExtractor, expectedPlatform } of TEST_CASES) {
  const start = Date.now();
  try {
    const r = await pipeline.extract(url, { timeout: 20000, fallback: true });
    const ms = Date.now() - start;

    const platformOk = r.platform === expectedPlatform;
    const isPrimary = r.extractor === preferredExtractor;
    const ok = !r.error && platformOk;
    const isFallback = ok && !isPrimary;

    results.push({
      url,
      ok,
      isPrimary,
      isFallback,
      ms,
      extractor: r.extractor,
      platform: r.platform,
    });

    const icon = !ok ? "❌" : isPrimary ? "✅" : "⚠️ ";
    const tierNote = isFallback ? ` [fallback: ${r.extractor}]` : "";
    const platformNote = !platformOk
      ? ` [platform: got ${r.platform}, expected ${expectedPlatform}]`
      : "";
    const preview = r.content.slice(0, 120).replace(/\n/g, " ");

    console.log(`\n${icon} [${ms}ms] ${r.platform} | ${r.extractor}${tierNote}${platformNote}`);
    console.log(`   URL: ${url.slice(0, 70)}`);
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    } else {
      console.log(`   Title: ${r.title?.slice(0, 80)}`);
      if (r.author) console.log(`   Author: ${r.author}`);
      if (r.engagement) console.log(`   Engagement: ${JSON.stringify(r.engagement)}`);
      if (preview) console.log(`   Content: ${preview}`);
    }
  } catch (e) {
    const ms = Date.now() - start;
    results.push({
      url,
      ok: false,
      isPrimary: false,
      isFallback: false,
      ms,
      extractor: "?",
      platform: "?",
    });
    console.log(`\n❌ [${ms}ms] THREW: ${url.slice(0, 70)}`);
    console.log(`   ${e.message}`);
  }
}

// Summary
console.log("\n" + "=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
const primary = results.filter((r) => r.ok && r.isPrimary).length;
const fallback = results.filter((r) => r.ok && r.isFallback).length;
const fail = results.filter((r) => !r.ok).length;
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
console.log(`✅ ${primary} primary  ⚠️  ${fallback} fallback  ❌ ${fail} failed  avg ${avgMs}ms`);
console.log("\nDetails:");
for (const r of results) {
  const icon = !r.ok ? "❌" : r.isPrimary ? "✅" : "⚠️";
  const tier = r.isPrimary ? "primary" : r.isFallback ? "fallback" : "fail";
  console.log(
    `  ${icon} [${r.ms}ms] ${r.platform}/${r.extractor} (${tier}) — ${r.url.slice(0, 65)}`,
  );
}
