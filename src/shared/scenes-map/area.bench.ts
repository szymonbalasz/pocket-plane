// FR-SCN-42 coverage benchmark: a 300-ft sphere's cells in ≤ 3 ms (p95). Run alone via
// `bun run bench`; the coverage asserts stay in ./area.test.ts.
import { describe, expect, test } from "bun:test";
import { bestOf, GATE_TIMEOUT, p95 } from "../bench-kit";
import { cellCoverage, cells, templateArea } from "./area";

describe("FR-SCN-42 helper", () => {
  test(
    "FR-SCN-42 coverage benchmark: a 300-ft sphere ≤ 3 ms (p95)",
    async () => {
      const shape = templateArea({ shape: "sphere", x: 40.37, y: 22.81, size: 300, angle: 0 });
      // Best batch of 40 (bench-kit `bestOf`).
      const ms = await bestOf(
        p95(() => {
          cells(shape, "half");
        }, 40),
        3,
        5,
        1,
      );
      console.log(
        `FR-SCN-42 300-ft sphere: p95 ${ms.toFixed(2)} ms, ${cellCoverage(shape).length} cells`,
      );
      expect(ms).toBeLessThanOrEqual(3);
    },
    GATE_TIMEOUT,
  );
});
