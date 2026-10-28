// spell-fx shared core (VFX §6, §8, §13 Unit): catalogue, map effect schema + cap, suggestion,
// hit look choice, hit cue schema, emanation cells, spell row `fx`.
import { describe, expect, test } from "bun:test";
import { CharPutRowIntent, SpellRow } from "@shared/character-sheet/sheet";
import { DAMAGE_TYPES } from "@shared/entities/schemas";
import type { ServerSignalFrame } from "@shared/protocol/frames";
import type { MapRect } from "@shared/scenes-map/geometry";
import { emanationCells } from "./cells";
import {
  HIT_LOOK_KEYS,
  type HitCue,
  HitCue as HitCueSchema,
  hitLooks,
  VFX_HIT_SIGNAL,
} from "./cue";
import { FX_MAX_BYTES, Fx, FxRecord, SpellRowFx } from "./fx";
import { fxPresets, presetOf, suggestPreset } from "./presets";

describe("presets (FR-VFX-01, -02)", () => {
  test("FR-VFX-01 catalogue: unique kebab-case keys, unique lower-case names, defaults fill", () => {
    const keys = fxPresets.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const names = fxPresets.flatMap((p) => p.names);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toBe(n.trim().toLowerCase());
    for (const p of fxPresets) {
      const d = p.params.parse({});
      if (p.radiusFt) expect(p.radiusFt(d) % 5).toBe(0);
    }
  });

  test("FR-VFX-02 built-ins: Spirit Guardians radiant 15 ft (5–60 step 5), Moil 10 ft (5–30)", () => {
    const sg = presetOf("spirit-guardians");
    const moil = presetOf("shadow-of-moil");
    expect(sg?.params.parse({})).toEqual({ variant: "radiant", radiusFt: 15 });
    expect(sg?.radiusFt?.(sg.params.parse({ radiusFt: 60 }))).toBe(60);
    expect(sg?.params.safeParse({ radiusFt: 65 }).success).toBe(false);
    expect(sg?.params.safeParse({ radiusFt: 12 }).success).toBe(false);
    expect(sg?.params.safeParse({ variant: "holy" }).success).toBe(false);
    expect(sg?.reactions).toEqual(["turnInside"]);
    expect(moil?.params.parse({})).toEqual({ radiusFt: 10 });
    expect(moil?.params.safeParse({ radiusFt: 35 }).success).toBe(false);
    expect(moil?.reactions).toEqual(["hitOnAnchor"]);
    expect(presetOf("bless")).toBeNull();
  });

  test("FR-VFX-04 suggestPreset: trimmed, lower-cased name match, else null", () => {
    expect(suggestPreset("Spirit Guardians")?.key).toBe("spirit-guardians");
    expect(suggestPreset("  shadow of MOIL ")?.key).toBe("shadow-of-moil");
    expect(suggestPreset("Spirit Guardian")).toBeNull();
    expect(suggestPreset("")).toBeNull();
  });
});

describe("map effect (FR-VFX-03, -05)", () => {
  test("FR-VFX-03 Fx: catalogue preset, params parsed with defaults; unknown / bad → invalid", () => {
    expect(Fx.parse({ preset: "spirit-guardians", params: {} })).toEqual({
      preset: "spirit-guardians",
      params: { variant: "radiant", radiusFt: 15 },
    });
    expect(Fx.parse({ preset: "shadow-of-moil", params: {}, spellId: "s1" })).toEqual({
      preset: "shadow-of-moil",
      params: { radiusFt: 10 },
      spellId: "s1",
    });
    expect(Fx.safeParse({ preset: "fireball", params: {} }).success).toBe(false);
    expect(Fx.safeParse({ preset: "shadow-of-moil", params: { radiusFt: 7 } }).success).toBe(false);
    expect(Fx.safeParse({ preset: "shadow-of-moil", params: { x: 1 } }).success).toBe(false);
    expect(Fx.safeParse({ preset: "shadow-of-moil", params: {}, extra: 1 }).success).toBe(false);
  });

  test("FR-VFX-03 stored shape: ≤ 200 B, any kebab-case key (a newer server's preset parses)", () => {
    expect(FxRecord.safeParse({ preset: "hunger-of-hadar", params: { a: 1 } }).success).toBe(true);
    expect(FxRecord.safeParse({ preset: "Not Kebab", params: {} }).success).toBe(false);
    const big = {
      preset: "spirit-guardians",
      params: { v: "x".repeat(40) },
      spellId: "y".repeat(64),
    };
    big.params = { ...big.params, w: "x".repeat(40), z: "x".repeat(40) } as typeof big.params;
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(FX_MAX_BYTES);
    expect(FxRecord.safeParse(big).success).toBe(false);
  });

  test("FR-VFX-05 spell rows: old rows parse unchanged; putRow takes a catalogue fx (defaults filled)", () => {
    const old = { id: "s1", name: "Spirit Guardians", level: 3, concentration: true };
    const parsed = SpellRow.parse(old);
    expect("fx" in parsed).toBe(false);
    expect(SpellRow.parse({ ...old, fx: { preset: "future-thing", params: {} } }).fx?.preset).toBe(
      "future-thing",
    );
    const put = CharPutRowIntent.parse({
      creatureId: "c1",
      list: "spells",
      row: { name: "Spirit Guardians", level: 3, fx: { preset: "spirit-guardians", params: {} } },
    });
    expect((put.row as { fx?: unknown }).fx).toEqual({
      preset: "spirit-guardians",
      params: { variant: "radiant", radiusFt: 15 },
    });
    const bad = { name: "X", level: 1, fx: { preset: "fireball", params: {} } };
    expect(CharPutRowIntent.safeParse({ creatureId: "c1", list: "spells", row: bad }).success).toBe(
      false,
    );
    // A row fx carries no spellId (that is the effect's).
    expect(
      SpellRowFx.safeParse({ preset: "shadow-of-moil", params: {}, spellId: "s1" }).success,
    ).toBe(false);
  });
});

const cue = (over: Partial<HitCue> = {}): HitCue => ({
  id: "h1",
  targetTokenId: "t1",
  kind: "damage",
  parts: [{ type: "fire", value: 7 }],
  multiplier: "normal",
  crit: false,
  ...over,
});

describe("hit looks (FR-VFX-18–21)", () => {
  test("FR-VFX-18 look keys: every damage type, healing, untyped, glance", () => {
    for (const t of DAMAGE_TYPES) expect(HIT_LOOK_KEYS).toContain(t);
    expect(HIT_LOOK_KEYS).toContain("healing");
    expect(HIT_LOOK_KEYS).toContain("untyped");
    expect(HIT_LOOK_KEYS).toContain("glance");
    expect(HIT_LOOK_KEYS).toHaveLength(DAMAGE_TYPES.length + 3);
  });

  test("FR-VFX-19 hitLooks: two largest typed parts (summed per type), glance, untyped, healing", () => {
    expect(hitLooks(cue())).toEqual([{ key: "fire", scale: 1 }]);
    const mixed = cue({
      parts: [
        { type: "slashing", value: 5 },
        { type: "fire", value: 3 },
        { type: "radiant", value: 4 },
        { type: "fire", value: 3 },
      ],
    });
    expect(hitLooks(mixed).map((l) => l.key)).toEqual(["fire", "slashing"]);
    expect(hitLooks(cue({ multiplier: "none", parts: [{ type: "fire", value: 0 }] }))).toEqual([
      { key: "glance", scale: 1 },
    ]);
    expect(hitLooks(cue({ parts: [{ type: null, value: 4 }] }))).toEqual([
      { key: "untyped", scale: 1 },
    ]);
    expect(hitLooks(cue({ kind: "heal", parts: [{ type: null, value: 6 }] }))).toEqual([
      { key: "healing", scale: 1 },
    ]);
  });

  test("FR-VFX-19 scales: half × 0.7, double × 1.3, crit × 1.2, stacked", () => {
    expect(hitLooks(cue({ multiplier: "half" }))[0]?.scale).toBe(0.7);
    expect(hitLooks(cue({ multiplier: "double" }))[0]?.scale).toBe(1.3);
    expect(hitLooks(cue({ crit: true }))[0]?.scale).toBe(1.2);
    expect(hitLooks(cue({ crit: true, multiplier: "double" }))[0]?.scale).toBe(1.56);
    expect(hitLooks(cue({ crit: true, multiplier: "half" }))[0]?.scale).toBe(0.84);
  });

  test("FR-VFX-20 nothing applied (every part 0, not immune) → no look", () => {
    expect(hitLooks(cue({ parts: [{ type: "fire", value: 0 }] }))).toEqual([]);
    expect(hitLooks(cue({ parts: [] }))).toEqual([]);
    expect(hitLooks(cue({ kind: "heal", parts: [{ type: null, value: 0 }] }))).toEqual([]);
  });

  test("FR-VFX-21 hit cue schema: ≤ 4 parts, attacker optional, strict", () => {
    const full = cue({
      id: "x".repeat(36),
      targetTokenId: "t".repeat(36),
      attackerTokenId: "a".repeat(36),
      parts: [
        { type: "fire", value: 999 },
        { type: "cold", value: 999 },
        { type: "acid", value: 999 },
        { type: null, value: 999 },
      ],
    });
    expect(HitCueSchema.parse(full)).toEqual(full);
    expect(HitCueSchema.safeParse({ ...full, parts: [...full.parts, full.parts[0]] }).success).toBe(
      false,
    );
    expect(HitCueSchema.safeParse({ ...full, hp: 3 }).success).toBe(false);
    const { attackerTokenId: _a, ...noAttacker } = full;
    expect(HitCueSchema.safeParse(noAttacker).success).toBe(true);
  });

  test("VFX §12 hit cue frame ≤ 320 B per target (orchestrator ruling 2026-10-28; walkthrough S3 measured 307 B)", () => {
    // S3's shape: the DM applies one typed part; three UUID-length ids (108 chars), max values.
    const id = "0d2c1e7a-5b3f-4c2e-9a1d-7e6f5a4b3c2d";
    const frame: ServerSignalFrame = {
      type: "signal",
      name: VFX_HIT_SIGNAL,
      data: cue({
        id,
        targetTokenId: id,
        attackerTokenId: id,
        parts: [{ type: "bludgeoning", value: 999 }],
        multiplier: "double",
        crit: true,
      }),
      from: { role: "dm" },
    };
    expect(new TextEncoder().encode(JSON.stringify(frame)).length).toBeLessThanOrEqual(320);
  });
});

const map = (cols: number, rows: number): MapRect => ({
  gridCellSize: 50,
  gridOffsetX: 0,
  gridOffsetY: 0,
  mapWidth: cols * 50,
  mapHeight: rows * 50,
});

describe("affected cells (FR-VFX-24)", () => {
  test("FR-VFX-24 Medium 15 ft: the 7×7 square minus the token (5/10/5 corners trimmed)", () => {
    const cells = emanationCells({ col: 10, row: 10, side: 1 }, 15, map(30, 30));
    const key = new Set(cells.map((c) => `${c.col},${c.row}`));
    expect(key.has("10,10")).toBe(false);
    expect(key.has("13,10")).toBe(true);
    expect(key.has("14,10")).toBe(false);
    // (dx, dy) = (2, 2) → 15 ft; (3, 2) → 20 ft; (3, 3) → 20 ft.
    expect(key.has("12,12")).toBe(true);
    expect(key.has("13,12")).toBe(false);
    expect(key.has("13,13")).toBe(false);
    // 7 × 7 = 49, minus the token, minus 4 × 3 corner cells beyond 15 ft.
    expect(cells).toHaveLength(49 - 1 - 12);
  });

  test("FR-VFX-24 Large 10 ft: distance from the nearest footprint cell, footprint excluded", () => {
    const cells = emanationCells({ col: 10, row: 10, side: 2 }, 10, map(30, 30));
    const key = new Set(cells.map((c) => `${c.col},${c.row}`));
    for (const c of ["10,10", "11,10", "10,11", "11,11"]) expect(key.has(c)).toBe(false);
    expect(key.has("8,10")).toBe(true);
    expect(key.has("13,11")).toBe(true);
    expect(key.has("14,11")).toBe(false);
    // (dx, dy) = (1, 1) from the corner → 5 ft; (2, 2) → 15 ft (out).
    expect(key.has("9,9")).toBe(true);
    expect(key.has("8,8")).toBe(false);
    // 6 × 6 = 36, minus 4 footprint, minus 4 corners at (2, 2).
    expect(cells).toHaveLength(36 - 4 - 4);
  });

  test("FR-VFX-24 map edge: off-map cells dropped", () => {
    const cells = emanationCells({ col: 0, row: 0, side: 1 }, 10, map(30, 30));
    expect(cells.every((c) => c.col >= 0 && c.row >= 0)).toBe(true);
    // 3 × 3 quadrant minus the token, minus (2, 2) at 15 ft.
    expect(cells).toHaveLength(9 - 1 - 1);
  });
});
