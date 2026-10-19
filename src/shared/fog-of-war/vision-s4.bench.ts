// FOG §12 sprint-4 benchmark = the V core exit gate re-run at r 199.8 (FOG §12 "V core
// benchmark"), ms caps only: Normal 999 ft sources, map edges, inward simplification. Scene in
// ./vision-bench-kit, the 48 KiB record gate in ./vision-sizes.test. Targets: one polygon ≤ 10 ms;
// a move with party vision on at 12 sources ≤ 30 ms (the mover's sight + every token sample
// against the party's polygons + memory from the mover's polygons only; the others' sight is
// cached with its containment grids, as the server's vision cache keeps them); the switch (every
// counted source + samples + memory) ≤ 150 ms. Run alone via `bun run bench` (not part of
// `bun test`, BL-32). Best of N after warm-up; numbers logged for the build report.
import { describe, expect, test } from "bun:test";
import {
  type PlayerVision,
  partyVision,
  playerVision,
  pointVisible,
  polygonCells,
  sourcePolygons,
  type VisionSource,
} from "./vision";
import { best, GATE_TIMEOUT, logResults, sprint4Scene } from "./vision-bench-kit";

const results: Record<string, number> = {};

describe("FOG §12 sprint-4 benchmark (V core exit gate at r 199.8)", () => {
  const { players, scene, samples, counted } = sprint4Scene();
  const cells = (polys: readonly number[][]) => {
    const out = new Set<number>();
    for (const p of polys) polygonCells(p, (c, r) => out.add(r * 4096 + c));
    return out.size;
  };

  test(
    "FR-FOG-33 sprint 4: one polygon at r 199.8 + map edges + simplification ≤ 10 ms",
    async () => {
      const src = players[0]?.[1] as VisionSource;
      const ms = await best(
        () => {
          sourcePolygons(scene, src);
        },
        10,
        31,
      );
      const [see] = sourcePolygons(scene, src);
      results["polygon ms"] = ms;
      results["polygon vertices"] = (see?.length ?? 0) / 2;
      expect(ms).toBeLessThanOrEqual(10);
    },
    GATE_TIMEOUT,
  );

  test(
    "FR-FOG-50 / -52 a move with party vision on at 12 sources ≤ 30 ms",
    async () => {
      // The others' sight, cached (containment grids built once, as in the vision cache).
      const others: PlayerVision[] = counted.slice(1).map((srcs) => playerVision(scene, srcs));
      const warmParty = partyVision(others) as PlayerVision;
      for (const pt of samples) pointVisible(warmParty, pt);
      let k = 0;
      const ms = await best(
        () => {
          const moved = (counted[0] as VisionSource[]).map((src) => ({
            ...src,
            x: src.x + (k++ % 2),
          }));
          const mine = playerVision(scene, moved);
          const party = partyVision([mine, ...others]) as PlayerVision;
          let seen = 0;
          for (const pt of samples) if (pointVisible(party, pt)) seen++;
          cells(mine.see);
          results["move samples seen"] = seen;
        },
        30,
        9,
        2,
      );
      results["move (party, 12 sources) ms"] = ms;
      expect(ms).toBeLessThanOrEqual(30);
    },
    GATE_TIMEOUT,
  );

  test(
    "FR-FOG-49 the switch (every counted source + samples + memory) ≤ 150 ms",
    async () => {
      const ms = await best(
        () => {
          const visions = counted.map((srcs) => playerVision(scene, srcs));
          const party = partyVision(visions) as PlayerVision;
          for (const pt of samples) pointVisible(party, pt);
          cells(visions.flatMap((v) => v.see));
        },
        150,
        5,
        1,
      );
      results["switch ms"] = ms;
      expect(ms).toBeLessThanOrEqual(150);
    },
    GATE_TIMEOUT,
  );

  test("FOG §12 sprint-4 benchmark numbers (logged)", () => {
    logResults("FOG §12 sprint-4 benchmark (r 199.8)", results);
    expect(Object.keys(results).length).toBeGreaterThan(0);
  });
});
