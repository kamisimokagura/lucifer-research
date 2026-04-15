// lucifer-research URL テスト (Round 1)
import { ResearchPipeline } from "./packages/core/dist/pipeline.js";
import { createDefaultRegistry } from "./packages/extractors/dist/index.js";

const urls = [
  // YouTube
  "https://youtu.be/MxuaW7oXxqI?si=YMNyEL2C85J69PZ6",
  "https://youtu.be/6I0C_cXVxuo?si=TNDt0aakfwJo__Ax",
  "https://youtu.be/0VNDdfC3Or8?si=k__I-bprpr0pdasB",
  // X (Twitter)
  "https://x.com/kawai_design/status/2043804167643287763",
  "https://x.com/deronin_/status/2043616710788333727",
  "https://x.com/rohit4verse/status/2043361324558844290",
  "https://x.com/7_eito_7/status/2043929642361655398",
  "https://x.com/tetumemo/status/2043988679148855704",
  "https://x.com/yoshio_nocode/status/2043973560402923847",
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
    const r = await pipeline.extract(url, { timeout: 10000 });
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
