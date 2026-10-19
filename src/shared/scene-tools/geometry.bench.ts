// SCN §12 benchmark: the blocking check against 2,000 segments, p95 ≤ 1 ms per move. Run alone via
// `bun run bench`; correctness stays in ./geometry.test.ts.
import { describe, expect, test } from "bun:test";
import { bestOf, GATE_TIMEOUT, p95 } from "../bench-kit";
import { blockingSegments } from "./geometry";
import type { Wall } from "./schemas";

const at = (col: number, row: number) => ({ col, row });

describe("FR-SCN-10 blocking", () => {
  test(
    "SCN §12 benchmark: 2,000 segments, p95 ≤ 1 ms per move",
    async () => {
      const walls: Wall[] = Array.from({ length: 2000 }, (_, i) => [
        i + 1,
        (i * 7) % 200,
        (i * 13) % 140,
        ((i * 7) % 200) + 1,
        ((i * 13) % 140) + 2,
      ]);
      // Best batch of 200 moves (bench-kit `bestOf`).
      const ms = await bestOf(
        p95((i) => {
          blockingSegments(at(i % 200, 3), at((i * 3) % 200, 130), 1, walls, []);
        }, 200),
        1,
        5,
        1,
      );
      expect(ms).toBeLessThan(1);
    },
    GATE_TIMEOUT,
  );
});
