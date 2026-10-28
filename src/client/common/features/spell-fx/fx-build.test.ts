// spell-fx build (VFX §13 Unit): renderers per preset, the hit looks (every key, inside 1.6 ×
// the footprint, 0.4–1.4 s), the Still frame, levels and the budget, the level store and the
// tier drop, aura anchors and covers, drag following and lag, turn and hit reactions, cells, the
// Layers switch and the four Konva layers.
import { describe, expect, spyOn, test } from "bun:test";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { DAMAGE_TYPES } from "@shared/entities/schemas";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { HIT_LOOK_KEYS, type HitCue } from "@shared/spell-fx/cue";
import { fxPresets, presetOf } from "@shared/spell-fx/presets";
import { canvasLayers } from "../scenes-map/canvas-layers";
import { layerSlots, layerToggles, stageLayers } from "../scenes-map/layers";
import { type AuraSpec, aurasOf, insideAura } from "./anchors";
import { STILL_T } from "./aura-types";
import { pruneCells, toggleCells, useFxCells } from "./cells-store";
import { type DrawnBox, FxEngine, type FxView, PARTICLE_BUDGET } from "./engine";
import { hitLooks } from "./hit-looks";
import { VFX_LAYER_SWITCH } from "./layers";
import { createFxLoop, FrameMeter } from "./loop";
import { createVfxPrefs, effectiveLevel, lowerTier, VFX_PREFS_KEY } from "./prefs";
import { seededRandom } from "./prng";
import { turnStrikes } from "./reactions";
import { auraRenderers, rendererOf } from "./renderers";
import { recordingCtx } from "./test-ctx";

const CELL = 50;

const token = (over: Partial<TokenView> & { id: string }): TokenView =>
  ({
    campaignId: "c1",
    sceneId: "s1",
    seq: 1,
    name: over.id,
    imageAssetId: null,
    size: "medium",
    col: 5,
    row: 5,
    ownerPlayerId: null,
    hidden: false,
    shape: "round",
    creatureType: null,
    characterId: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as TokenView;

const effect = (over: Record<string, unknown>) => ({
  campaignId: "c1",
  seq: 1,
  kind: "concentration",
  label: "Spirit Guardians",
  condition: null,
  level: null,
  targetCombatantId: null,
  targetCharacterId: null,
  endedAt: null,
  fx: { preset: "spirit-guardians", params: { variant: "radiant", radiusFt: 15 }, spellId: "s1" },
  ...over,
});

function storeOf(role: "dm" | "player", records: Record<string, unknown[]>): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records,
  } as never);
}

const MIRA = token({ id: "t-mira", characterId: "mira", ownerPlayerId: "p1" });
const THORN = token({ id: "t-thorn", characterId: "thorn", ownerPlayerId: "p2", col: 5, row: 8 });
const GOBLIN = token({ id: "t-gob", col: 7, row: 5 });

const viewOf = (
  tokens: TokenView[],
  moved: Record<string, { x: number; y: number }> = {},
): FxView => ({
  cell: CELL,
  position(id): DrawnBox | null {
    const t = tokens.find((x) => x.id === id);
    if (!t) return null;
    const p = moved[id] ?? { x: t.col * CELL, y: t.row * CELL };
    return { x: p.x, y: p.y, size: CELL };
  },
});

const sgSpec = (over: Partial<AuraSpec> = {}): AuraSpec => {
  const preset = presetOf("spirit-guardians");
  if (!preset) throw new Error("no preset");
  return {
    key: "e1:t-mira",
    effectId: "e1",
    tokenId: "t-mira",
    preset,
    params: { variant: "radiant", radiusFt: 15 },
    radiusFt: 15,
    hidden: false,
    cover: "half",
    side: "party",
    ...over,
  };
};

const moilSpec = (over: Partial<AuraSpec> = {}): AuraSpec => {
  const preset = presetOf("shadow-of-moil");
  if (!preset) throw new Error("no preset");
  return {
    key: "e2:t-thorn",
    effectId: "e2",
    tokenId: "t-thorn",
    preset,
    params: { radiusFt: 10 },
    radiusFt: 10,
    hidden: false,
    cover: "eyes",
    side: "party",
    ...over,
  };
};

const cue = (over: Partial<HitCue> = {}): HitCue => ({
  id: "h1",
  targetTokenId: "t-gob",
  attackerTokenId: "t-mira",
  kind: "damage",
  parts: [{ type: "fire", value: 7 }],
  multiplier: "normal",
  crit: false,
  ...over,
});

function engineAt(t = 0, tokens = [MIRA, THORN, GOBLIN], moved = {}) {
  const clock = { t };
  const e = new FxEngine(() => clock.t);
  e.setView(viewOf(tokens, moved));
  return { e, clock };
}

describe("renderers and looks (FR-VFX-01, -18)", () => {
  test("FR-VFX-01 catalogue: every preset key has a renderer, renderer keys unique", () => {
    for (const p of fxPresets) expect(rendererOf(p.key)?.preset).toBe(p.key);
    const keys = auraRenderers.map((r) => r.preset);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("FR-VFX-18 every damage type has a look (+ healing, untyped, glance), each 0.4–1.4 s", () => {
    for (const t of DAMAGE_TYPES) expect(hitLooks[t]?.key).toBe(t);
    for (const k of HIT_LOOK_KEYS) {
      const l = hitLooks[k];
      expect(l?.duration).toBeGreaterThanOrEqual(0.4);
      expect(l?.duration).toBeLessThanOrEqual(1.4);
    }
  });

  test("FR-VFX-18 each look draws within 1.6 × the footprint at the largest scale (crit × double)", () => {
    for (const k of HIT_LOOK_KEYS) {
      const l = hitLooks[k];
      if (!l) throw new Error(k);
      const rec = recordingCtx(false);
      for (let t = 0; t <= l.duration; t += l.duration / 12) {
        l.draw(rec.ctx, {
          x: 500,
          y: 500,
          size: CELL,
          angle: 0.7,
          scale: 1.56,
          random: seededRandom(`h:${k}`),
          t,
        });
      }
      // Within the 1.6 × footprint box around the centre: ≤ 0.8 × side from it.
      expect(rec.reach(500, 500)).toBeLessThanOrEqual(CELL * 0.8 + 1e-6);
    }
  });
});

describe("Still frame and levels (FR-VFX-14, -26, -29)", () => {
  test("FR-VFX-14 Still frame: same seed → same draw calls on every load, whatever the clock", () => {
    const draw = (seed: string, now: number) => {
      const { e, clock } = engineAt(now);
      e.setLevel("still");
      e.sync([sgSpec({ effectId: seed }), moilSpec()]);
      clock.t = now + 3;
      e.step(now + 3);
      const rec = recordingCtx();
      e.drawUnder(rec.ctx);
      e.drawOver(rec.ctx);
      return rec.calls.join("\n");
    };
    const a = draw("e1", 0);
    expect(a.length).toBeGreaterThan(0);
    expect(draw("e1", 1234.5)).toBe(a);
    expect(draw("e9", 0)).not.toBe(a);
  });

  test("FR-VFX-14 Full: renderer randomness is seeded by the effect id (two loads, one picture)", () => {
    const draw = () => {
      const { e, clock } = engineAt(10);
      e.sync([sgSpec()]);
      e.step(10);
      clock.t = 10.5;
      e.step(10.5);
      const rec = recordingCtx();
      e.drawOver(rec.ctx);
      return rec.calls.join("\n");
    };
    expect(draw()).toBe(draw());
  });

  test("FR-VFX-26 Reduced: ≤ 45 % of each preset's particles; Off draws nothing and drops cues", () => {
    for (const r of auraRenderers) {
      const params = presetOf(r.preset)?.params.parse({}) ?? {};
      const inst = r.create("e1", params);
      expect(inst.particles("reduced")).toBeLessThanOrEqual(inst.particles("full") * 0.45);
    }
    const { e } = engineAt();
    e.sync([sgSpec(), moilSpec()]);
    e.setLevel("off");
    const rec = recordingCtx();
    e.drawUnder(rec.ctx);
    e.drawOver(rec.ctx);
    expect(rec.calls).toEqual([]);
    expect(e.playCue(cue())).toBe(false);
    expect(e.snapshot().level).toBe("off");
  });

  test("FR-VFX-26 Still: no ambient motion (not animating), a hit look still plays once", () => {
    const { e, clock } = engineAt(0);
    e.setLevel("still");
    e.sync([sgSpec()]);
    e.step(0);
    expect(e.animating()).toBe(false);
    expect(e.playCue(cue())).toBe(true);
    expect(e.animating()).toBe(true);
    clock.t = 2;
    e.step(2);
    expect(e.animating()).toBe(false);
    expect(e.snapshot().looks).toEqual([]);
  });

  test("FR-VFX-29 budget: ≤ 400 live particles; past it, the oldest looks end early", () => {
    const { e } = engineAt();
    e.sync([sgSpec(), moilSpec()]);
    for (let i = 0; i < 40; i++)
      e.playCue(cue({ id: `h${i}`, parts: [{ type: "fire", value: 5 }] }));
    expect(e.particles()).toBeLessThanOrEqual(PARTICLE_BUDGET);
    const ids = e.snapshot().looks.map((l) => l.cueId);
    expect(ids).toContain("h39");
    expect(ids).not.toContain("h0");
  });
});

describe("level store and tier drop (FR-VFX-25, -27)", () => {
  const backend = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };

  test("FR-VFX-25 level store: default Full, reduced motion → Still, invalid → default, pick persists", () => {
    const b = backend();
    expect(createVfxPrefs({ storage: () => b, reducedMotion: () => false }).read().level).toBe(
      "full",
    );
    expect(createVfxPrefs({ storage: () => b, reducedMotion: () => true }).read().level).toBe(
      "still",
    );
    b.m.set(VFX_PREFS_KEY, '{"level":"loud"}');
    expect(createVfxPrefs({ storage: () => b, reducedMotion: () => false }).read().level).toBe(
      "full",
    );
    b.m.set(VFX_PREFS_KEY, "not json");
    expect(createVfxPrefs({ storage: () => b, reducedMotion: () => false }).read().level).toBe(
      "full",
    );
    const p = createVfxPrefs({ storage: () => b, reducedMotion: () => false });
    p.write("off");
    expect(b.m.get(VFX_PREFS_KEY)).toBe('{"level":"off"}');
    // A reload reads it back.
    expect(createVfxPrefs({ storage: () => b, reducedMotion: () => false }).read().level).toBe(
      "off",
    );
  });

  test("FR-VFX-25 storage blocked → the pick is kept in memory for the page", () => {
    const p = createVfxPrefs({
      storage: () => {
        throw new Error("blocked");
      },
      reducedMotion: () => false,
    });
    expect(p.read().level).toBe("full");
    p.write("reduced");
    expect(p.read().level).toBe("reduced");
  });

  test("FR-VFX-27 tier drop: a median > 33 ms over 2 s drops one tier, Full → Reduced → Still, never Off", () => {
    expect(lowerTier("full")).toBe("reduced");
    expect(lowerTier("reduced")).toBe("still");
    expect(lowerTier("still")).toBe("still");
    expect(lowerTier("off")).toBe("off");
    expect(effectiveLevel("full", "reduced")).toBe("reduced");
    expect(effectiveLevel("off", "reduced")).toBe("off");
    const meter = new FrameMeter();
    for (let t = 0; t < 1900; t += 50) meter.push(t, 40);
    expect(meter.slow(1900)).toBe(false);
    meter.push(2000, 40);
    expect(meter.slow(2000)).toBe(true);
    // The window restarts after a judgement.
    expect(meter.slow(2050)).toBe(false);
    const fast = new FrameMeter();
    for (let t = 0; t <= 3000; t += 50) fast.push(t, 5);
    expect(fast.slow(3000)).toBe(false);
    const p = createVfxPrefs({ storage: () => undefined, reducedMotion: () => false });
    p.lower();
    expect(p.level()).toBe("reduced");
    expect(p.lowered()).toBe("reduced");
    p.lower();
    p.lower();
    expect(p.level()).toBe("still");
  });

  test("FR-VFX-27 the loop: 30 fps cap, runs only while animating, slow frames call onSlow", () => {
    const frames: ((ts: number) => void)[] = [];
    let slow = 0;
    let animating = true;
    let drawn = 0;
    const loop = createFxLoop({
      raf: (fn) => frames.push(fn),
      caf: () => {},
      hidden: () => false,
      step: () => {},
      draw: () => {
        drawn++;
        return 50;
      },
      animating: () => animating,
      onFrame: () => {},
      onSlow: () => slow++,
    });
    loop.wake();
    let ts = 0;
    for (let i = 0; i < 200 && frames.length > 0; i++) {
      const fn = frames.shift() as (ts: number) => void;
      fn(ts);
      ts += 16.7;
    }
    // 200 rAFs at 60 Hz ≈ 3.3 s → ≈ 100 FX frames at 30 fps.
    expect(drawn).toBeGreaterThan(80);
    expect(drawn).toBeLessThan(120);
    expect(slow).toBe(1);
    animating = false;
    const fn = frames.shift();
    fn?.(ts + 40);
    expect(loop.running()).toBe(false);
  });
});

describe("anchors and covers (FR-VFX-11, -12, -17)", () => {
  const records = (role: "dm" | "player") =>
    storeOf(role, {
      [EFFECT_TYPE]: [
        effect({ id: "e1", targetCharacterId: "mira" }),
        effect({
          id: "e2",
          seq: 2,
          targetCharacterId: "thorn",
          fx: { preset: "shadow-of-moil", params: { radiusFt: 10 } },
        }),
        effect({ id: "e3", seq: 3, targetCombatantId: "cb-gob" }),
        effect({ id: "e4", seq: 4, targetCharacterId: "mira", fx: null }),
        effect({ id: "e5", seq: 5, targetCharacterId: "mira", endedAt: "x" }),
        effect({
          id: "e6",
          seq: 6,
          targetCharacterId: "mira",
          fx: { preset: "hunger-of-hadar", params: {} },
        }),
      ],
      [COMBATANT_TYPE]: [{ id: "cb-gob", tokenId: "t-gob", kind: "monster" }],
    });

  test("FR-VFX-11 an aura per active fx effect at each target token; ended / no fx / no token → none", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const mira2 = token({ id: "t-mira2", characterId: "mira", ownerPlayerId: "p1", col: 1 });
    const specs = aurasOf(records("dm"), [MIRA, mira2, THORN, GOBLIN], {
      client: "dm",
      myPlayerId: null,
    });
    expect(specs.map((s) => s.key)).toEqual(["e1:t-mira", "e1:t-mira2", "e2:t-thorn", "e3:t-gob"]);
    expect(specs[0]?.radiusFt).toBe(15);
    expect(specs[3]?.side).toBe("monster");
    // VFX §11: the unknown preset warns once per key.
    aurasOf(records("dm"), [MIRA], { client: "dm", myPlayerId: null });
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("hunger-of-hadar"))).toHaveLength(1);
    warn.mockRestore();
    expect(
      aurasOf(records("dm"), [THORN], { client: "dm", myPlayerId: null }).map((s) => s.key),
    ).toEqual(["e2:t-thorn"]);
  });

  test("FR-VFX-12 hidden token: DM draws at the hidden-token opacity, players never", () => {
    const hidden = { ...MIRA, hidden: true };
    const dm = aurasOf(records("dm"), [hidden], { client: "dm", myPlayerId: null });
    expect(dm[0]?.hidden).toBe(true);
    expect(aurasOf(records("player"), [hidden], { client: "player", myPlayerId: "p1" })).toEqual(
      [],
    );
  });

  test("FR-VFX-17 Moil cover: eyes only for players who don't own it; half for the DM and the owner", () => {
    const of = (client: "dm" | "player", me: string | null) =>
      aurasOf(records(client), [THORN], { client, myPlayerId: me })[0]?.cover;
    expect(of("dm", null)).toBe("half");
    expect(of("player", "p2")).toBe("half");
    expect(of("player", "p1")).toBe("eyes");
  });

  test("FR-VFX-12 the aura follows the drawn position (drag previews) with the preset's lag", () => {
    const moved: Record<string, { x: number; y: number }> = {};
    const { e, clock } = engineAt(0, [MIRA], moved);
    e.sync([sgSpec()]);
    e.step(0);
    const centre = () => {
      const rec = recordingCtx();
      e.drawUnder(rec.ctx);
      const arc = rec.calls.find((c) => c.startsWith("arc("));
      return arc?.slice(4).split(",").slice(0, 2).map(Number);
    };
    expect(centre()).toEqual([275, 275]);
    moved["t-mira"] = { x: 450, y: 250 };
    clock.t = 0.03;
    e.step(0.03);
    const mid = centre() as number[];
    expect(mid[0]).toBeGreaterThan(275);
    expect(mid[0]).toBeLessThan(475);
    for (let t = 0.06; t < 2; t += 0.03) e.step(t);
    expect(centre()?.[0]).toBeCloseTo(475, 0);
    // Still: no lag, drawn at the token itself.
    e.setLevel("still");
    moved["t-mira"] = { x: 50, y: 50 };
    expect(centre()).toEqual([75, 75]);
  });
});

describe("reactions (FR-VFX-15, -16, -19–22)", () => {
  test("FR-VFX-15 turn reaction: the other side's token inside the radius is struck; outside / same side not", () => {
    const view = viewOf([MIRA, THORN, GOBLIN, token({ id: "t-far", col: 20, row: 5 })]);
    const sg = sgSpec();
    const monster = { id: "cb-gob", kind: "monster", tokenId: "t-gob" } as never;
    expect(turnStrikes([sg], monster, GOBLIN, (id) => view.position(id), CELL)).toEqual([
      { key: "e1:t-mira", tokenId: "t-gob" },
    ]);
    const far = token({ id: "t-far", col: 20, row: 5 });
    expect(
      turnStrikes(
        [sg],
        { id: "x", kind: "monster", tokenId: "t-far" } as never,
        far,
        (id) => view.position(id),
        CELL,
      ),
    ).toEqual([]);
    const pc = { id: "cb-thorn", kind: "pc", tokenId: "t-thorn" } as never;
    expect(turnStrikes([sg], pc, THORN, (id) => view.position(id), CELL)).toEqual([]);
    // A monster's aura strikes PCs and owned tokens.
    const cultist = sgSpec({ key: "e3:t-gob", tokenId: "t-gob", side: "monster" });
    const farPc = token({ id: "t-far", characterId: "bram", ownerPlayerId: "p3", col: 20, row: 5 });
    expect(
      turnStrikes(
        [cultist],
        { id: "cb-far", kind: "pc", tokenId: "t-far" } as never,
        farPc,
        (id) => view.position(id),
        CELL,
      ),
    ).toEqual([]);
    expect(turnStrikes([cultist], monster, GOBLIN, (id) => view.position(id), CELL)).toEqual([]);
    const miraPc = { id: "cb-mira", kind: "pc", tokenId: "t-mira" } as never;
    expect(turnStrikes([cultist], miraPc, MIRA, (id) => view.position(id), CELL)).toEqual([
      { key: "e3:t-gob", tokenId: "t-mira" },
    ]);
    // Moil has no turn reaction.
    expect(
      turnStrikes(
        [moilSpec({ tokenId: "t-mira" })],
        monster,
        GOBLIN,
        (id) => view.position(id),
        CELL,
      ),
    ).toEqual([]);
  });

  test("FR-VFX-15 inside: centre distance ≤ radius + half the target's side", () => {
    const a = { x: 0, y: 0, size: CELL };
    // 15 ft from a Medium token: the edge is 3 cells + half a cell from its centre.
    expect(insideAura(a, 15, { x: 4 * CELL, y: 0, size: CELL }, CELL)).toBe(true);
    expect(insideAura(a, 15, { x: 5 * CELL, y: 0, size: CELL }, CELL)).toBe(false);
  });

  test("FR-VFX-16 hit reaction: a hit on Moil's anchor naming an attacker lashes toward it; no attacker → no lash", () => {
    const { e, clock } = engineAt();
    e.sync([moilSpec()]);
    e.step(0);
    e.playCue(cue({ targetTokenId: "t-thorn", attackerTokenId: "t-gob" }));
    clock.t = 0.45;
    e.step(0.45);
    const rec = recordingCtx();
    e.drawOver(rec.ctx);
    // The tendrils end at the attacker's centre (375, 275).
    expect(rec.calls.some((c) => c.startsWith("lineTo(375.000,275.000"))).toBe(true);
    const { e: e2, clock: c2 } = engineAt();
    e2.sync([moilSpec()]);
    e2.step(0);
    e2.playCue(cue({ targetTokenId: "t-thorn", attackerTokenId: undefined }));
    c2.t = 0.45;
    e2.step(0.45);
    const rec2 = recordingCtx();
    e2.drawOver(rec2.ctx);
    expect(rec2.calls.some((c) => c.startsWith("lineTo(375.000,275.000"))).toBe(false);
  });

  test("FR-VFX-19 / -20 / -22 cues: looks by type on the drawn target; nothing applied or no token → dropped", () => {
    const { e } = engineAt();
    expect(
      e.playCue(
        cue({
          parts: [
            { type: "fire", value: 4 },
            { type: "cold", value: 9 },
          ],
        }),
      ),
    ).toBe(true);
    expect(e.snapshot().looks.map((l) => l.look)).toEqual(["cold", "fire"]);
    expect(e.lastHit).toBe("h1:fire");
    expect(e.playCue(cue({ id: "h2", parts: [{ type: "fire", value: 0 }] }))).toBe(false);
    expect(e.playCue(cue({ id: "h3", targetTokenId: "t-elsewhere" }))).toBe(false);
    // A strike / lash never targets a token this canvas doesn't draw.
    e.strike("nope", "t-gob");
    expect(e.snapshot().looks).toHaveLength(2);
  });
});

describe("cells, Layers switch, Konva layers (FR-VFX-23, -28, -13)", () => {
  test("FR-VFX-23 Show / Hide affected cells: per (effect, token), cleared when the aura ends or the scene changes", () => {
    pruneCells("s1", new Set());
    toggleCells("e1:t-mira");
    toggleCells("e2:t-thorn");
    expect(useFxCells.getState().shown).toEqual({ "e1:t-mira": true, "e2:t-thorn": true });
    toggleCells("e2:t-thorn");
    expect(useFxCells.getState().shown).toEqual({ "e1:t-mira": true });
    toggleCells("e2:t-thorn");
    pruneCells("s1", new Set(["e1:t-mira"]));
    expect(useFxCells.getState().shown).toEqual({ "e1:t-mira": true });
    pruneCells("s2", new Set(["e1:t-mira"]));
    expect(useFxCells.getState().shown).toEqual({});
  });

  test("FR-VFX-28 DM Layers switch Effects (`vfx`, hide): off drops the over pass on the DM only", () => {
    expect(layerToggles(canvasLayers)).toContainEqual(VFX_LAYER_SWITCH);
    expect(VFX_LAYER_SWITCH).toEqual({ key: "vfx", label: "Effects", layer: "objects" });
    const ids = (client: "dm" | "player", off = {}) =>
      layerSlots(canvasLayers, client, off).flatMap((s) => s.layers.map((l) => l.id));
    expect(ids("dm")).toContain("vfx-over");
    expect(ids("dm", { vfx: true })).not.toContain("vfx-over");
    expect(ids("player", { vfx: true })).toContain("vfx-over");
  });

  test("FR-VFX-13 both passes on `objects`: still ≤ 4 Konva layers (VFX §12 gate)", () => {
    for (const client of ["dm", "player"] as const) {
      const layers = stageLayers(layerSlots(canvasLayers, client));
      expect(layers.length).toBeLessThanOrEqual(4);
      const objects = layers.find((l) => l.key === "objects");
      const ids = objects?.slots.flatMap((s) => s.layers.map((l) => l.id)) ?? [];
      expect(ids.indexOf("vfx-under")).toBeLessThan(ids.indexOf("tokens"));
      expect(ids.indexOf("vfx-over")).toBeGreaterThan(ids.indexOf("tokens"));
      expect(ids.indexOf("vfx-over")).toBeLessThan(ids.indexOf("labels"));
    }
  });

  test("FR-VFX-14 the Still time is fixed", () => {
    expect(STILL_T).toBeGreaterThan(0);
  });
});
