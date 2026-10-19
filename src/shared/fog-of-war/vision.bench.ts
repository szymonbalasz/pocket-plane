// FOG §12 V0 benchmark = the V0 exit gate (FOG §12 "Target" table), ms caps only; scenes in
// ./vision-bench-kit, the 48 KiB record gate in ./vision-sizes.test. Run alone via `bun run bench`
// (not part of `bun test`, BL-32). Best of N after warm-up; numbers logged for the build report.
import { describe, expect, test } from "bun:test";
import {
  playerVision,
  prepareOccluders,
  prepareScene,
  sightPolygon,
  type VisionSource,
} from "./vision";
import {
  best,
  buildScene,
  exploredCells,
  GATE_TIMEOUT,
  logResults,
  samples,
  V0_KINDS,
  visibleCount,
} from "./vision-bench-kit";

const results: Record<string, number> = {};

describe("FOG §12 V0 benchmark (exit gate)", () => {
  for (const [kind, polyMs, moveMs, fullMs] of V0_KINDS) {
    const s = buildScene(kind);

    test(
      `FOG §12 ${kind}: one sight polygon ≤ ${polyMs} ms`,
      async () => {
        const prep = prepareOccluders(s.walls);
        const src = s.players[0]?.[0] as VisionSource;
        const r = kind === "typical" ? 12 : 24;
        const ms = await best(
          () => {
            sightPolygon(src, r, prep);
          },
          polyMs,
          31,
        );
        const poly = sightPolygon(src, r, prep) as number[];
        results[`${kind} polygon ms`] = ms;
        results[`${kind} polygon vertices`] = poly.length / 2;
        // Logged only, no gate.
        results[`${kind} prepare ms`] = await best(() => {
          prepareScene(s.walls, s.darkness);
        }, Number.POSITIVE_INFINITY);
        expect(ms).toBeLessThanOrEqual(polyMs);
      },
      GATE_TIMEOUT,
    );

    test(
      `FOG §12 ${kind}: a move (mover's polygons + sample tests + explored cells) ≤ ${moveMs} ms`,
      async () => {
        const ms = await best(() => {
          const scene = prepareScene(s.walls, s.darkness);
          const pts = samples(s);
          const v = playerVision(scene, s.players[0] as VisionSource[]);
          visibleCount(v, pts);
          exploredCells(v);
        }, moveMs);
        results[`${kind} move ms`] = ms;
        expect(ms).toBeLessThanOrEqual(moveMs);
      },
      GATE_TIMEOUT,
    );

    test(
      `FOG §12 ${kind}: full-scene re-derive (static once, then per player) ≤ ${fullMs} ms`,
      async () => {
        const ms = await best(
          () => {
            const scene = prepareScene(s.walls, s.darkness);
            const pts = samples(s);
            for (const srcs of s.players) {
              const v = playerVision(scene, srcs);
              visibleCount(v, pts);
              exploredCells(v);
            }
          },
          fullMs,
          9,
        );
        results[`${kind} full re-derive ms`] = ms;
        expect(ms).toBeLessThanOrEqual(fullMs);
      },
      GATE_TIMEOUT,
    );
  }

  test("FOG §12 benchmark numbers (logged)", () => {
    logResults("FOG §12 V0 benchmark", results);
    expect(Object.keys(results).length).toBeGreaterThan(0);
  });
});
