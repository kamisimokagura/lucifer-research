// lucifer-research 並列・大量ストレステスト
// Round 1+2 の全URLを同時並列実行し、レースコンディション・タイムアウト・メモリリークを検出
import { ResearchPipeline } from "./packages/core/dist/pipeline.js";
import { createDefaultRegistry } from "./packages/extractors/dist/index.js";

const TEST_CASES = [
  // YouTube (R1) — expect youtube/api
  {
    url: "https://youtu.be/MxuaW7oXxqI?si=YMNyEL2C85J69PZ6",
    expectedExtractor: "api",
    expectedPlatform: "youtube",
  },
  {
    url: "https://youtu.be/6I0C_cXVxuo?si=TNDt0aakfwJo__Ax",
    expectedExtractor: "api",
    expectedPlatform: "youtube",
  },
  {
    url: "https://youtu.be/0VNDdfC3Or8?si=k__I-bprpr0pdasB",
    expectedExtractor: "api",
    expectedPlatform: "youtube",
  },
  // X (R1) — expect x/api
  {
    url: "https://x.com/kawai_design/status/2043804167643287763",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://x.com/deronin_/status/2043616710788333727",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://x.com/rohit4verse/status/2043361324558844290",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://x.com/7_eito_7/status/2043929642361655398",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://x.com/tetumemo/status/2043988679148855704",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://x.com/yoshio_nocode/status/2043973560402923847",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  // HackerNews (R2) — expect hackernews/api
  {
    url: "https://news.ycombinator.com/item?id=47760529",
    expectedExtractor: "api",
    expectedPlatform: "hackernews",
  },
  {
    url: "https://news.ycombinator.com/item?id=47760764",
    expectedExtractor: "api",
    expectedPlatform: "hackernews",
  },
  {
    url: "https://news.ycombinator.com/item?id=47762864",
    expectedExtractor: "api",
    expectedPlatform: "hackernews",
  },
  {
    url: "https://news.ycombinator.com/item?id=47762641",
    expectedExtractor: "api",
    expectedPlatform: "hackernews",
  },
  {
    url: "https://news.ycombinator.com/item?id=47755629",
    expectedExtractor: "api",
    expectedPlatform: "hackernews",
  },
  // GitHub (R2) — expect github/api
  {
    url: "https://github.com/caramaschiHG/awesome-ai-agents-2026",
    expectedExtractor: "api",
    expectedPlatform: "github",
  },
  {
    url: "https://github.com/eudk/awesome-ai-tools",
    expectedExtractor: "api",
    expectedPlatform: "github",
  },
  {
    url: "https://github.com/alvinreal/awesome-opensource-ai",
    expectedExtractor: "api",
    expectedPlatform: "github",
  },
  // Qiita (R2) — expect qiita/api
  {
    url: "https://qiita.com/kai_kou/items/32b242950d643480284f",
    expectedExtractor: "api",
    expectedPlatform: "qiita",
  },
  {
    url: "https://qiita.com/nogataka/items/5e64037cc452c5d497fa",
    expectedExtractor: "api",
    expectedPlatform: "qiita",
  },
  {
    url: "https://qiita.com/hidao/items/82add91c4197ff866384",
    expectedExtractor: "api",
    expectedPlatform: "qiita",
  },
];

async function runConcurrentBatch(cases, concurrency, label) {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`${label}: ${cases.length} URLs × concurrency ${concurrency}`);
  console.log(`${"─".repeat(70)}`);

  const registry = createDefaultRegistry();
  const pipeline = new ResearchPipeline();
  for (const [key, extractor] of registry) {
    pipeline.register(key, extractor);
  }

  const batchStart = Date.now();
  const queue = [...cases];
  const completed = [];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { url, expectedExtractor, expectedPlatform } = item;
      const start = Date.now();
      try {
        const r = await pipeline.extract(url, { timeout: 15000, fallback: true });
        const ms = Date.now() - start;

        // Count as regression if primary tier silently fell back to a different extractor
        const extractorMatch = r.extractor === expectedExtractor;
        const platformMatch = r.platform === expectedPlatform;
        const ok = !r.error && extractorMatch && platformMatch;
        const fallback = !r.error && (!extractorMatch || !platformMatch);

        completed.push({
          url,
          ok,
          fallback,
          ms,
          extractor: r.extractor,
          platform: r.platform,
          expectedExtractor,
          expectedPlatform,
        });

        const icon = r.error ? "❌" : fallback ? "⚠️" : "✅";
        const detail = fallback
          ? ` [FALLBACK: got ${r.platform}/${r.extractor}, expected ${expectedPlatform}/${expectedExtractor}]`
          : "";
        console.log(
          `  ${icon} [${ms}ms] ${r.platform}/${r.extractor} ${url.slice(0, 50)}${detail}`,
        );
      } catch (e) {
        const ms = Date.now() - start;
        completed.push({
          url,
          ok: false,
          fallback: false,
          ms,
          extractor: "?",
          platform: "?",
          expectedExtractor,
          expectedPlatform,
        });
        console.log(`  ❌ [${ms}ms] THROW ${url.slice(0, 50)} — ${e.message.slice(0, 60)}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, cases.length) }, () => worker());
  await Promise.all(workers);

  const totalMs = Date.now() - batchStart;
  const ok = completed.filter((r) => r.ok).length;
  const fallback = completed.filter((r) => r.fallback).length;
  const fail = completed.filter((r) => !r.ok && !r.fallback).length;
  const avgMs = Math.round(completed.reduce((s, r) => s + r.ms, 0) / completed.length);

  console.log(
    `\nResult: ✅ ${ok}/${completed.length} primary ok  ⚠️ ${fallback} fallback  ❌ ${fail} fail  avg ${avgMs}ms  wall ${totalMs}ms`,
  );
  return completed;
}

// ─── Test 1: Sequential baseline ───────────────────────────────────────────
const seq = await runConcurrentBatch(TEST_CASES, 1, "Test 1: Sequential (baseline)");

// ─── Test 2: Moderate concurrency (5 parallel) ────────────────────────────
const par5 = await runConcurrentBatch(TEST_CASES, 5, "Test 2: Concurrent ×5");

// ─── Test 3: Max concurrency (all at once) ─────────────────────────────────
const parAll = await runConcurrentBatch(TEST_CASES, TEST_CASES.length, "Test 3: All at once");

// ─── Test 4: Duplicate URLs — idempotency ──────────────────────────────────
const dupCases = [
  {
    url: "https://x.com/kawai_design/status/2043804167643287763",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://x.com/kawai_design/status/2043804167643287763",
    expectedExtractor: "api",
    expectedPlatform: "x",
  },
  {
    url: "https://qiita.com/nogataka/items/5e64037cc452c5d497fa",
    expectedExtractor: "api",
    expectedPlatform: "qiita",
  },
  {
    url: "https://qiita.com/nogataka/items/5e64037cc452c5d497fa",
    expectedExtractor: "api",
    expectedPlatform: "qiita",
  },
  {
    url: "https://github.com/eudk/awesome-ai-tools",
    expectedExtractor: "api",
    expectedPlatform: "github",
  },
  {
    url: "https://github.com/eudk/awesome-ai-tools",
    expectedExtractor: "api",
    expectedPlatform: "github",
  },
];
const dup = await runConcurrentBatch(dupCases, 6, "Test 4: Duplicate URLs (idempotency)");

// ─── Final Report ──────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(70));
console.log("STRESS TEST REPORT");
console.log("=".repeat(70));

for (const [label, results] of [
  ["Sequential", seq],
  ["Concurrent×5", par5],
  ["All-at-once", parAll],
  ["Duplicate", dup],
]) {
  const ok = results.filter((r) => r.ok).length;
  const fallback = results.filter((r) => r.fallback).length;
  const fail = results.filter((r) => !r.ok && !r.fallback).length;
  const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  const maxMs = Math.max(...results.map((r) => r.ms));
  console.log(
    `  ${label}: ✅${ok}/${results.length} primary  ⚠️${fallback} fallback  ❌${fail} fail  avg=${avgMs}ms  max=${maxMs}ms`,
  );
}

// Regression check: ok in sequential but degraded (fallback or hard fail) under ×5 load
const seqPrimaryOk = new Set(seq.filter((r) => r.ok).map((r) => r.url));
const concurrencyRegressions = par5.filter((r) => !r.ok && seqPrimaryOk.has(r.url));
if (concurrencyRegressions.length > 0) {
  console.log("\n⚠️  Concurrency regressions (primary ok sequentially, degraded under ×5 load):");
  for (const r of concurrencyRegressions) {
    console.log(`     ${r.url}`);
    console.log(
      `       expected: ${r.expectedPlatform}/${r.expectedExtractor}  got: ${r.platform}/${r.extractor}`,
    );
  }
} else {
  console.log("\n✅ No concurrency regressions detected (primary extractors stable under ×5 load)");
}
