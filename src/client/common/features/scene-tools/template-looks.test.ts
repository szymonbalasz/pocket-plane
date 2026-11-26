// Template looks, client (SCN FR-SCN-68–71, -73; VFX FR-VFX-45; #466): every registry look draws
// only inside its clip (outline + map), the same pattern for the same seed, a fixed frame at Still;
// Reduced thins, Ground and Hatch never move; the FX engine runs the loop for animated looks and
// shares FR-VFX-29's budget among them.
import { describe, expect, test } from "bun:test";
import { TEMPLATE_LOOKS } from "@shared/scene-tools/schemas";
import { FxEngine, PARTICLE_BUDGET } from "../spell-fx/engine";
import { recordingCtx } from "../spell-fx/test-ctx";
import {
  type DrawLookInput,
  drawTemplateLook,
  edgeDistance,
  LOOK_PARTICLES_MAX,
  LOOK_REDUCED_SHARE,
  lookCount,
  lookDef,
  lookTint,
  outlineBox,
  TEMPLATE_LOOK_DEFS,
} from "./template-looks";

const CELL = 50;
const circle = { kind: "circle" as const, x: 500, y: 350, r: 4 * CELL };
const cube = {
  kind: "poly" as const,
  points: [200, 500, 300, 500, 300, 600, 200, 600],
};

const input = (key: string, extra: Partial<DrawLookInput> = {}): DrawLookInput => ({
  def: lookDef(key) as NonNullable<ReturnType<typeof lookDef>>,
  outline: circle,
  map: { x: 0, y: 0, w: 1000, h: 700 },
  origin: { x: 500, y: 350 },
  cell: CELL,
  cells: 50,
  tint: "#7d8590",
  seed: "tpl-1",
  level: "full",
  t: 3.2,
  ...extra,
});

const draws = (c: string) => /^(fill|stroke|fillRect)\(/.test(c);

describe("FR-SCN-69 every look draws", () => {
  test("FR-SCN-69 the registry holds the seven looks, each with a colour and examples", () => {
    expect(TEMPLATE_LOOK_DEFS.map((d) => d.key)).toEqual([...TEMPLATE_LOOKS]);
    for (const d of TEMPLATE_LOOK_DEFS) {
      expect(d.tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(d.examples.length).toBeGreaterThan(0);
      expect(d.label.length).toBeGreaterThan(0);
    }
    expect(TEMPLATE_LOOK_DEFS.filter((d) => !d.animated).map((d) => d.key)).toEqual([
      "ground",
      "hatch",
    ]);
  });

  for (const key of TEMPLATE_LOOKS) {
    test(`FR-SCN-68 ${key}: clipped to the map and the outline before anything is drawn, state restored`, () => {
      for (const outline of [circle, cube]) {
        for (const level of ["full", "reduced", "still"] as const) {
          const r = recordingCtx();
          drawTemplateLook(r.ctx, input(key, { outline, level }));
          const calls = r.calls;
          const firstDraw = calls.findIndex(draws);
          expect(firstDraw).toBeGreaterThan(-1);
          const clips = calls.slice(0, firstDraw).filter((c) => c === "clip()").length;
          expect(clips).toBe(2);
          expect(calls[0]).toBe("save()");
          expect(calls.at(-1)).toBe("restore()");
        }
      }
    });
  }

  test("FR-SCN-69 subtle: no stroke or fill colour above the alpha cap", () => {
    for (const key of TEMPLATE_LOOKS) {
      const r = recordingCtx();
      drawTemplateLook(r.ctx, input(key));
      for (const c of r.calls) {
        const m = /^(fillStyle|strokeStyle)=rgba\(\d+,\d+,\d+,([\d.]+)\)$/.exec(c);
        if (m) expect(Number(m[2])).toBeLessThanOrEqual(0.45);
      }
    }
  });

  test("FR-SCN-68 seeded: the same seed and time draw the same; another seed differs", () => {
    const a = recordingCtx();
    const b = recordingCtx();
    const c = recordingCtx();
    drawTemplateLook(a.ctx, input("mist"));
    drawTemplateLook(b.ctx, input("mist"));
    drawTemplateLook(c.ctx, input("mist", { seed: "tpl-2" }));
    expect(b.calls).toEqual(a.calls);
    expect(c.calls).not.toEqual(a.calls);
  });

  test("FR-SCN-70 Still and the still looks: one fixed frame whatever the clock", () => {
    for (const key of TEMPLATE_LOOKS) {
      const a = recordingCtx();
      const b = recordingCtx();
      drawTemplateLook(a.ctx, input(key, { level: "still", t: 1 }));
      drawTemplateLook(b.ctx, input(key, { level: "still", t: 99 }));
      expect(b.calls).toEqual(a.calls);
    }
    for (const key of ["ground", "hatch"]) {
      const a = recordingCtx();
      const b = recordingCtx();
      drawTemplateLook(a.ctx, input(key, { t: 1 }));
      drawTemplateLook(b.ctx, input(key, { t: 40 }));
      expect(b.calls).toEqual(a.calls);
    }
    const a = recordingCtx();
    const b = recordingCtx();
    drawTemplateLook(a.ctx, input("motes", { t: 1 }));
    drawTemplateLook(b.ctx, input("motes", { t: 4 }));
    expect(b.calls).not.toEqual(a.calls);
  });

  test("FR-SCN-73 an unknown look key draws nothing; the tint falls back to the look's colour", () => {
    expect(lookDef("flames")).toBeNull();
    expect(lookDef(null)).toBeNull();
    expect(lookTint("mist", null)).toBe("#9aa3ad");
    expect(lookTint("mist", "#123456")).toBe("#123456");
    expect(lookTint(null, "#123456")).toBe("#123456");
    expect(lookTint(null, null)).toBeNull();
  });

  test("FR-SCN-68 edge fade: the box and distance to the outline", () => {
    expect(outlineBox(circle)).toEqual({ x: 300, y: 150, w: 400, h: 400 });
    expect(outlineBox(cube)).toEqual({ x: 200, y: 500, w: 100, h: 100 });
    expect(edgeDistance(circle, 500, 350)).toBe(200);
    expect(edgeDistance(cube, 250, 550)).toBe(50);
    expect(edgeDistance(cube, 205, 550)).toBe(5);
  });
});

describe("FR-SCN-70 levels", () => {
  test("FR-SCN-70 Reduced ≤ 45 % of Full; Still and the still looks keep Full's count", () => {
    for (const d of TEMPLATE_LOOK_DEFS) {
      for (const cells of [1, 4, 12, 50, 400]) {
        const full = lookCount(d, cells, "full");
        expect(full).toBeLessThanOrEqual(LOOK_PARTICLES_MAX);
        expect(lookCount(d, cells, "still")).toBe(full);
        const reduced = lookCount(d, cells, "reduced");
        if (d.animated && full > 2) {
          expect(reduced).toBeLessThanOrEqual(Math.ceil(full * LOOK_REDUCED_SHARE));
        }
        if (!d.animated) expect(reduced).toBe(full);
      }
    }
  });

  test("FR-SCN-71 fewer particles for a small area", () => {
    const mist = lookDef("mist") as NonNullable<ReturnType<typeof lookDef>>;
    expect(lookCount(mist, 4, "full")).toBeLessThan(lookCount(mist, 50, "full"));
  });
});

describe("FR-SCN-71 budget (VFX FR-VFX-45)", () => {
  const box = { x: 0, y: 0, size: 100 };
  test("FR-SCN-71 20 Mist templates draw ≤ 400 particles in all; none stops", () => {
    const engine = new FxEngine(() => 0);
    const mist = lookDef("mist") as NonNullable<ReturnType<typeof lookDef>>;
    const per = lookCount(mist, 50, "full");
    engine.setTemplateLooks(
      "scn-templates",
      Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, box, animated: true, particles: per })),
    );
    const share = engine.templateLookShare();
    expect(share).toBeLessThan(1);
    const drawn = 20 * lookCount(mist, 50, "full", share);
    expect(drawn).toBeLessThanOrEqual(PARTICLE_BUDGET);
    expect(lookCount(mist, 50, "full", share)).toBeGreaterThan(0);
    expect(lookCount(mist, 50, "reduced", share)).toBeLessThanOrEqual(
      lookCount(mist, 50, "full", share),
    );
  });

  test("FR-SCN-70 an animated look keeps the loop going at Full / Reduced, not at Still or Off; a still one never", () => {
    const engine = new FxEngine(() => 0);
    let wakes = 0;
    engine.onWake(() => {
      wakes++;
    });
    engine.setTemplateLooks("scn-templates", [{ id: "g", box, animated: false, particles: 10 }]);
    expect(engine.animating()).toBe(false);
    engine.setTemplateLooks("scn-templates", [
      { id: "g", box, animated: false, particles: 10 },
      { id: "m", box, animated: true, particles: 30 },
    ]);
    expect(wakes).toBeGreaterThan(0);
    expect(engine.animating()).toBe(true);
    expect(engine.animating(() => false)).toBe(false);
    engine.setLevel("reduced");
    expect(engine.animating()).toBe(true);
    engine.setLevel("still");
    expect(engine.animating()).toBe(false);
    engine.setLevel("off");
    expect(engine.animating()).toBe(false);
    engine.setLevel("full");
    engine.setTemplateLooks("scn-templates", []);
    expect(engine.animating()).toBe(false);
    expect(engine.templateLookShare()).toBe(1);
  });
});
