// VFX §12 gate (OQ-VFX-04 A): the DM at 1280×720 with 30 tokens, both auras (Spirit Guardians,
// Shadow of Moil) at Full and one hit look every second; FX frames at 30 fps over 6 s. Measures the
// FX share of a frame (engine step + both passes) on a no-op 2D context: median ≤ 4 ms. The layer
// count gate (`stage.getLayers().length ≤ 4`) holds by the registry. The token redraw an FX frame
// also triggers (the `objects` layer) is browser-only: the walkthrough reads `vfx-over` `frameMs`.
// Run alone via `bun run bench`.
import { describe, expect, test } from "bun:test";
import { bestOf, GATE_TIMEOUT, logResults } from "@shared/bench-kit";
import { DAMAGE_TYPES } from "@shared/entities/schemas";
import { presetOf } from "@shared/spell-fx/presets";
import { canvasLayers } from "../scenes-map/canvas-layers";
import { layerSlots, stageLayers } from "../scenes-map/layers";
import type { AuraSpec } from "./anchors";
import { type DrawnBox, FxEngine } from "./engine";

const CELL = 64;
/** 1280 × 720 ≈ 20 × 11 cells: 30 tokens on a 6 × 5 lattice, the two casters in the middle. */
const TOKENS: DrawnBox[] = Array.from({ length: 30 }, (_, i) => ({
  x: (2 + (i % 6) * 3) * CELL,
  y: (1 + Math.floor(i / 6) * 2) * CELL,
  size: CELL,
}));

/** A 2D context whose every method is a no-op (the FX code's own cost). */
function noopCtx(): CanvasRenderingContext2D {
  const noop = () => {};
  const ctx: Record<string, unknown> = {};
  for (const k of [
    "beginPath",
    "closePath",
    "moveTo",
    "lineTo",
    "arc",
    "rect",
    "fill",
    "stroke",
    "fillRect",
    "drawImage",
    "quadraticCurveTo",
    "save",
    "restore",
  ]) {
    ctx[k] = noop;
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

function spec(key: string, preset: string, tokenIndex: number): AuraSpec {
  const p = presetOf(preset);
  if (!p) throw new Error(preset);
  const params = p.params.parse({});
  return {
    key,
    effectId: key,
    tokenId: `t${tokenIndex}`,
    preset: p,
    params,
    radiusFt: p.radiusFt?.(params) ?? null,
    hidden: false,
    cover: "half",
    side: "party",
  };
}

/** One 6-s run at 30 fps; returns the median FX frame ms. */
function run(): number {
  const clock = { t: 0 };
  const e = new FxEngine(() => clock.t);
  e.setView({
    cell: CELL,
    position: (id) => TOKENS[Number(id.slice(1))] ?? null,
  });
  e.sync([spec("sg", "spirit-guardians", 14), spec("moil", "shadow-of-moil", 15)]);
  const ctx = noopCtx();
  const times: number[] = [];
  let nextLook = 0;
  for (let f = 0; f < 180; f++) {
    clock.t = f / 30;
    if (clock.t >= nextLook) {
      const type = DAMAGE_TYPES[f % DAMAGE_TYPES.length] ?? "fire";
      e.playCue({
        id: `h${f}`,
        targetTokenId: `t${f % 30}`,
        attackerTokenId: "t15",
        kind: "damage",
        parts: [{ type, value: 7 }],
        multiplier: "normal",
        crit: false,
      });
      nextLook += 1;
    }
    const t0 = performance.now();
    e.step(clock.t);
    e.drawUnder(ctx);
    e.drawOver(ctx);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1] as number;
}

describe("VFX §12 gate", () => {
  test(
    "OQ-VFX-04 A: 30 tokens, both auras at Full, one hit look per second: FX frame median ≤ 4 ms; ≤ 4 Konva layers",
    async () => {
      for (const client of ["dm", "player"] as const) {
        expect(stageLayers(layerSlots(canvasLayers, client)).length).toBeLessThanOrEqual(4);
      }
      const ms = await bestOf(run, 4, 5, 1);
      logResults("VFX §12 FX frame (engine step + both passes, no-op context)", {
        "median ms": ms,
      });
      expect(ms).toBeLessThanOrEqual(4);
    },
    GATE_TIMEOUT,
  );
});
