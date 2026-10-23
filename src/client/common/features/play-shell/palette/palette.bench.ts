// FR-SHELL-198 perf gate: the palette's local search (shared matcher over title + keywords,
// ranking, caps) ≤ 5 ms p95 per keystroke over 5,000 local rows (spec probe: 3.9 ms worst; 1.9 ms
// at 1,100). Rows are prepared once per store change (not timed per keystroke; logged). Run alone
// via `bun run bench`; the ranking rules stay in ./palette.test.ts.
import { describe, expect, test } from "bun:test";
import { bestOf, GATE_TIMEOUT, logResults, p95 } from "@shared/bench-kit";
import { localEntries, rankLocal } from "./rank";
import { testCtx } from "./test-env";
import type { PaletteItem, SearchProvider } from "./types";

const WORDS = [
  "goblin",
  "warrior",
  "ancient",
  "red",
  "dragon",
  "potion",
  "healing",
  "shield",
  "fire",
  "bolt",
  "owlbear",
  "mira",
  "thorn",
  "initiative",
  "cover",
  "grapple",
  "opportunity",
  "attack",
  "wolf",
  "elite",
  "bandit",
  "captain",
  "ogre",
  "cleric",
];

/** `n` synthetic rows: two- to three-word names, keywords from the same SRD-ish vocabulary. */
function rows(n: number): PaletteItem[] {
  return Array.from({ length: n }, (_, i) => {
    const w = (k: number) => WORDS[(i * 7 + k * 13) % WORDS.length] as string;
    return {
      id: `r${i}`,
      title: i % 3 ? `${w(1)} ${w(2)}` : `${w(1)} ${w(2)} ${w(3)}`,
      keywords: [w(4), w(5), `${i}`],
      run: () => {},
    };
  });
}

/** Every prefix of each query: one search per keystroke. */
const KEYSTROKES = ["goblin warrior", "init", "> reset", "@mira", "drag", "ow", "cover"].flatMap(
  (q) => Array.from({ length: q.length }, (_, i) => q.slice(0, i + 1)),
);

function world(n: number) {
  const items = rows(n);
  const provider: SearchProvider = {
    id: "bench",
    group: "Creatures",
    clients: ["dm"],
    items: () => items,
  };
  const ctx = testCtx();
  const t0 = performance.now();
  const entries = localEntries([], [provider], ctx);
  return { entries, prepMs: performance.now() - t0 };
}

describe("FR-SHELL-198 palette search", () => {
  test(
    "FR-SHELL-198 local search ≤ 5 ms p95 per keystroke over 5,000 local rows",
    async () => {
      const big = world(5000);
      const small = world(1100);
      const per = (e: typeof big.entries) =>
        p95((i) => rankLocal(e, KEYSTROKES[i % KEYSTROKES.length] as string), KEYSTROKES.length);
      const p95Big = await bestOf(per(big.entries), 5, 5, 2);
      const p95Small = await bestOf(per(small.entries), 5, 5, 2);
      logResults("FR-SHELL-198 palette local search (ms)", {
        "p95 per keystroke, 5,000 rows": p95Big,
        "p95 per keystroke, 1,100 rows": p95Small,
        "prepare 5,000 rows (once per store change)": big.prepMs,
      });
      expect(p95Big).toBeLessThanOrEqual(5);
    },
    GATE_TIMEOUT,
  );
});
