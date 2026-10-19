// Timing for the perf gates in `*.bench.ts`, run alone via `bun run bench` (AGENTS §9.4), never in
// `bun test`: parallel suites skew wall-clock budgets (BL-28, BL-32).

export const PATIENCE_MS = 15_000;
/** Test timeout for a timed gate: the N runs plus the patience window, with room under load. */
export const GATE_TIMEOUT = 60_000;

/**
 * Lowest of `runs` measurements after `warm` discarded ones. Best of N, not the median: load only
 * adds time, so the minimum is the load-tolerant cost estimate. While it is still over `budget`,
 * keep measuring, one per 200 ms (few, spread out), for up to PATIENCE_MS: a burst of load longer
 * than the N runs then passes, a real regression still fails.
 */
export async function bestOf(
  measure: () => number,
  budget: number,
  runs = 15,
  warm = 3,
): Promise<number> {
  for (let i = 0; i < warm; i++) measure();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) min = Math.min(min, measure());
  const deadline = performance.now() + PATIENCE_MS;
  while (min > budget && performance.now() < deadline) {
    await Bun.sleep(200);
    min = Math.min(min, measure());
  }
  return min;
}

/** Fastest ms of one call to `fn` (see `bestOf`). */
export function best(fn: () => void, budget: number, runs = 15, warm = 3): Promise<number> {
  return bestOf(
    () => {
      const t0 = performance.now();
      fn();
      return performance.now() - t0;
    },
    budget,
    runs,
    warm,
  );
}

/** A measurement for `bestOf`: the p95 ms of one batch of `n` calls, `fn(i)` for i = 0 … n − 1. */
export function p95(fn: (i: number) => void, n: number): () => number {
  return () => {
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      fn(i);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(n * 0.95)] as number;
  };
}

/** Logs a benchmark's numbers for the build report. */
export function logResults(title: string, results: Record<string, number>): void {
  console.log(
    `${title}:\n${Object.entries(results)
      .map(([k, v]) => `  ${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`)
      .join("\n")}`,
  );
}
