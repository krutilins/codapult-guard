import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const baseline = process.env.GUARD_BENCH_BASELINE;
assert(
  baseline,
  'Set GUARD_BENCH_BASELINE to the pre-change build directory (dist and benchmark script).',
);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const rows = [];
for (const language of ['typescript', 'python']) {
  for (let round = 0; round < 4; round++) {
    for (const build of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const script = join(
        build === 'before' ? resolve(baseline) : resolve('.'),
        'scripts/guard-benchmark.mjs',
      );
      const data = JSON.parse(
        execFileSync(process.execPath, [script], {
          encoding: 'utf8',
          timeout: 180_000,
          env: {
            ...process.env,
            GUARD_BENCH_FILES: '1000',
            GUARD_BENCH_RUNS: '8',
            GUARD_BENCH_LANGUAGE: language,
          },
        }),
      );
      const row = {
        language,
        build,
        round: round + 1,
        ...data,
        warmMedianMs: median(data.timings.slice(1).map((item) => item.durationMs)),
      };
      rows.push(row);
      console.log(
        JSON.stringify({
          language,
          build,
          round: row.round,
          coldMs: row.coldMs,
          warmMedianMs: row.warmMedianMs,
        }),
      );
    }
  }
}
const summaries = ['typescript', 'python'].map((language) => {
  const stats = Object.fromEntries(
    ['before', 'after'].map((build) => {
      const values = rows.filter((row) => row.language === language && row.build === build);
      return [
        build,
        {
          coldMs: median(values.map((row) => row.coldMs)),
          warmMs: median(values.map((row) => row.warmMedianMs)),
        },
      ];
    }),
  );
  return {
    language,
    ...stats,
    coldChangePercent: (stats.after.coldMs / stats.before.coldMs - 1) * 100,
    warmChangePercent: (stats.after.warmMs / stats.before.warmMs - 1) * 100,
  };
});
if (process.env.GUARD_BENCH_RESULTS)
  writeFileSync(
    process.env.GUARD_BENCH_RESULTS,
    JSON.stringify({ rows, summaries }, null, 2) + '\n',
  );
console.log(JSON.stringify({ summaries }, null, 2));
const ts = summaries[0];
assert(
  ts.coldChangePercent <= 5 && ts.warmChangePercent <= 5,
  'TypeScript regression exceeds 5%; investigate before completion.',
);
assert(summaries[1].after.coldMs < ts.after.coldMs, 'Python cold discovery exceeds TypeScript.');
