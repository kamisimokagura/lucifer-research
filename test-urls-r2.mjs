// lucifer-research URL テスト Round 2 (HN × 5, GitHub × 5, Qiita × 5)
import { ResearchPipeline } from "./packages/core/dist/pipeline.js";
import { createDefaultRegistry } from "./packages/extractors/dist/index.js";

const urls = [
  // HackerNews
  "https://news.ycombinator.com/item?id=47760529",
  "https://news.ycombinator.com/item?id=47760764",
  "https://news.ycombinator.com/item?id=47762864",
  "https://news.ycombinator.com/item?id=47762641",
  "https://news.ycombinator.com/item?id=47755629",
  // GitHub
  "https://github.com/caramaschiHG/awesome-ai-agents-2026",
  "https://github.com/joylarkin/Awesome-AI-Market-Maps",
  "https://github.com/eudk/awesome-ai-tools",
  "https://github.com/alvinreal/awesome-opensource-ai",
  "https://github.com/appcypher/ai-trending",
  // Qiita
  "https://qiita.com/kai_kou/items/32b242950d643480284f",
  "https://qiita.com/syunichisato51/items/e5d828b1f65e104ffa13",
  "https://qiita.com/ratorin/items/caa9c1db0c16690d8120",
  "https://qiita.com/nogataka/items/5e64037cc452c5d497fa",
  "https://qiita.com/hidao/items/82add91c4197ff866384",
];

const registry = createDefaultRegistry();
const pipeline = new ResearchPipeline();
for (const [key, extractor] of registry) {
  pipeline.register(key, extractor);
}

const results = [];
for (const url of urls) {
  const start = Date.now();
  try {
    const r = await pipeline.extract(url, { timeout: 15000 });
    const ms = Date.now() - start;
    results.push({ url, ok: !r.error, ms, ...r });
    const preview = r.content.slice(0, 300).replace(/\n/g, " ");
    console.log(`\n✅ [${ms}ms] ${r.platform} | ${r.extractor}`);
    console.log(`   Title: ${r.title}`);
    if (r.author) console.log(`   Author: ${r.author}`);
    if (r.engagement) console.log(`   Engagement: ${JSON.stringify(r.engagement)}`);
    console.log(`   Content: ${preview}`);
  } catch (e) {
    const ms = Date.now() - start;
    results.push({ url, ok: false, ms, error: e.message });
    console.log(`\n❌ [${ms}ms] FAILED: ${url}`);
    console.log(`   ${e.message}`);
  }
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("SUMMARY");
console.log("=".repeat(60));
const ok = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
console.log(`✅ ${ok}/${results.length} success  ❌ ${fail} failed  avg ${avgMs}ms`);
console.log("\nDetails:");
for (const r of results) {
  const status = r.ok ? "✅" : "❌";
  const platform = r.platform || "?";
  const extractor = r.extractor || "?";
  console.log(`  ${status} [${r.ms}ms] ${platform}/${extractor} — ${r.url}`);
}
