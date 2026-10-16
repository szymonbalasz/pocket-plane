// MOD tier 3 (FR-MOD-12, -41 seam): a character preset spends a sheet feature use through CHARX's
// `spendFeatureUse` in the toggle's transaction; none left → `conflict`, DM `force` → no spend;
// off never refunds; a broken link toggles without uses; `refundFeatureUse` gives one back;
// the sheet change reaches the owner and the DM only; a crash is all or nothing.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { presetUses } from "@shared/effect-modifiers/rules";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { armCrashHook } from "../../commands/crash";
import { creatureSheet } from "../../db/schema";
import type { Viewer } from "../../ws/records";
import { refundFeatureUse, spendFeatureUse } from "../character-sheet/resources";
import { toSheetRecord } from "../character-sheet/sheet-rows";
import { modSetup } from "./testing";

/** Test-only: the CHARX seam called from a command, as R4's apply / undo hook lines will. */
const seam = defineCommand({
  name: "test.featureUse",
  input: z.object({ op: z.enum(["spend", "refund"]), characterId: z.string(), rowId: z.string() }),
  execute: ({ op, characterId, rowId }, env) =>
    op === "spend"
      ? spendFeatureUse(env, characterId, rowId)
      : refundFeatureUse(env, characterId, rowId),
});

function setup() {
  const t = modSetup();
  t.s.commands.register(seam);
  const sheet = (id = t.thornId) => {
    const row = t.s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, id)).get();
    return row ? toSheetRecord(row) : null;
  };
  const feature = (row: Record<string, unknown>, id = t.thornId) =>
    t.run<{ rowId: string }>(CHARX_INTENTS.putRow, { creatureId: id, list: "features", row }).rowId;
  const used = (rowId: string) => sheet()?.features.find((f) => f.id === rowId)?.used;
  const rageFeature = feature({ name: "Rage", usesMax: 3, reset: "long" });
  const rage = t.put(
    t.from("rage", { characterId: t.thornId, originKey: "rage", usesFeatureId: rageFeature }),
    t.p2,
  );
  const viewer = (playerId: string | null): Viewer => ({
    connId: `c-${playerId ?? "dm"}`,
    campaignId: t.h.dm.campaignId as string,
    role: playerId ? "player" : "dm",
    playerId,
  });
  return { ...t, sheet, feature, used, rageFeature, rage, viewer };
}

describe("FR-MOD-12 uses", () => {
  test("FR-MOD-12 Brakka's Rage uses 3 → 2 → 1 → 0 → conflict 'No Rage uses left'; DM force → on, no spend; off never refunds", () => {
    const t = setup();
    expect(t.preset(t.rage)).toMatchObject({ usesFeatureId: t.rageFeature, originKey: "rage" });
    for (const after of [1, 2, 3]) {
      expect(t.toggle(t.thornId, t.rage, true, t.p2).effectId).not.toBeNull();
      expect(t.used(t.rageFeature)).toBe(after);
      t.toggle(t.thornId, t.rage, false, t.p2);
      expect(t.used(t.rageFeature)).toBe(after);
    }
    const n = t.events.length;
    const e = t.err(() => t.toggle(t.thornId, t.rage, true, t.p2));
    expect([e.code, e.message]).toEqual(["conflict", "No Rage uses left"]);
    expect(t.err(() => t.toggle(t.thornId, t.rage, true)).code).toBe("conflict");
    expect(t.events.length).toBe(n);
    expect(t.preset(t.rage).activeEffectId).toBeNull();
    expect(t.active().filter((x) => x.label === "Rage")).toEqual([]);
    // Players can't force; the DM turns it on without spending.
    expect(t.err(() => t.toggle(t.thornId, t.rage, true, t.p2, true)).code).toBe("forbidden");
    expect(t.toggle(t.thornId, t.rage, true, t.h.dm, true).effectId).not.toBeNull();
    expect(t.used(t.rageFeature)).toBe(3);
    expect(t.events.slice(n).map((x) => x.event.changes.map((c) => c.type))).toEqual([
      ["effect", "effect-preset"],
    ]);
  });

  test("FR-MOD-12 the spend rides on EffectToggled (effect, effect-preset, creature-sheet), one log row; the sheet's Reset gives the uses back", () => {
    const t = setup();
    const n = t.events.length;
    const logs = t.logTypes().length;
    t.toggle(t.thornId, t.rage, true, t.p2);
    expect(t.typesSince(n)).toEqual(["EffectToggled"]);
    expect(t.logTypes().slice(logs)).toEqual(["EffectToggled"]);
    const changes = t.events[n]?.event.changes ?? [];
    expect(changes.map((c) => c.type)).toEqual(["effect", "effect-preset", CREATURE_SHEET_TYPE]);
    expect(presetUses(t.preset(t.rage), t.sheet()?.features)).toEqual({
      state: "ok",
      featureId: t.rageFeature,
      name: "Rage",
      left: 2,
      max: 3,
    });
    // FR-MOD-12: uses reset only by the Features tab's Reset (CHARX `char.useResource`).
    t.run(
      CHARX_INTENTS.useResource,
      { characterId: t.thornId, resource: { feature: t.rageFeature }, reset: true },
      t.p2,
    );
    expect(t.used(t.rageFeature)).toBe(0);
  });

  test("FR-MOD-12 locked sheet: the owner still toggles and spends", () => {
    const t = setup();
    t.run(CHARX_INTENTS.setLock, { characterId: t.thornId, locked: true });
    t.toggle(t.thornId, t.rage, true, t.p2);
    expect(t.used(t.rageFeature)).toBe(1);
  });

  test("FR-MOD-12 broken link: row deleted or usesMax cleared → toggles without uses; presetUses 'broken'", () => {
    const t = setup();
    const row = t.sheet()?.features.find((f) => f.id === t.rageFeature);
    t.run(CHARX_INTENTS.putRow, {
      creatureId: t.thornId,
      list: "features",
      row: { id: t.rageFeature, name: row?.name, source: row?.source, text: row?.text },
    });
    expect(presetUses(t.preset(t.rage), t.sheet()?.features)).toEqual({ state: "broken" });
    const n = t.events.length;
    t.toggle(t.thornId, t.rage, true, t.p2);
    expect(t.events[n]?.event.changes.map((c) => c.type)).toEqual(["effect", "effect-preset"]);
    t.toggle(t.thornId, t.rage, false, t.p2);
    t.run(CHARX_INTENTS.deleteRow, {
      creatureId: t.thornId,
      list: "features",
      rowId: t.rageFeature,
    });
    expect(presetUses(t.preset(t.rage), t.sheet()?.features)).toEqual({ state: "broken" });
    expect(t.toggle(t.thornId, t.rage, true, t.p2).effectId).not.toBeNull();
    // The link is kept (soft): an edit that doesn't name it doesn't fail.
    t.put({ ...t.from("rage", { characterId: t.thornId }), id: t.rage }, t.p2);
    expect(t.preset(t.rage).usesFeatureId).toBe(t.rageFeature);
  });

  test("FR-MOD-12 preset form: the link must be a feature row with uses of that character; kept on replace, null clears; campaign presets → invalid", () => {
    const t = setup();
    const lore = t.feature({ name: "Lore" });
    const miraRow = t.feature({ name: "Second Wind", usesMax: 1 }, t.miraId);
    const thorn = (o: object) => t.from("bless", { characterId: t.thornId, ...o });
    for (const id of [lore, miraRow, "nope"]) {
      const e = t.err(() => t.put(thorn({ usesFeatureId: id }), t.p2));
      expect([e.code, e.message]).toEqual(["invalid", "Pick a feature with uses"]);
    }
    expect(t.err(() => t.put(t.from("bless", { usesFeatureId: t.rageFeature }))).code).toBe(
      "invalid",
    );
    const id = t.put(thorn({ usesFeatureId: t.rageFeature }), t.p2);
    expect(t.preset(id).usesFeatureId).toBe(t.rageFeature);
    t.put({ ...thorn({}), id }, t.p2);
    expect(t.preset(id).usesFeatureId).toBe(t.rageFeature);
    t.put({ ...thorn({ usesFeatureId: null }), id }, t.p2);
    expect(t.preset(id).usesFeatureId).toBeNull();
    // A blank create has no link; owner forbidden on a locked sheet as for any preset edit.
    expect(t.preset(t.put(thorn({}), t.p2)).usesFeatureId).toBeNull();
    t.run(CHARX_INTENTS.setLock, { characterId: t.thornId, locked: true });
    expect(t.err(() => t.put({ ...thorn({ usesFeatureId: null }), id }, t.p2)).code).toBe(
      "forbidden",
    );
  });

  test("FR-MOD-12 visibility: the sheet change reaches Thorn's owner and the DM, not player-1; no other player gets the preset", () => {
    const t = setup();
    const n = t.events.length;
    t.toggle(t.thornId, t.rage, true, t.p2);
    const changes = t.events.slice(n).flatMap((x) => x.event.changes);
    const wire = (v: Viewer) =>
      changes.map((c) => t.s.records.filterChange(c, v)).filter((c) => c !== null);
    const types = (v: Viewer) => wire(v).map((c) => c?.type);
    expect(types(t.viewer(null))).toEqual(["effect", "effect-preset", CREATURE_SHEET_TYPE]);
    expect(types(t.viewer(t.h.p2.id))).toEqual(["effect", "effect-preset", CREATURE_SHEET_TYPE]);
    expect(types(t.viewer(t.h.p1.id))).not.toContain(CREATURE_SHEET_TYPE);
    expect(types(t.viewer(t.h.p1.id))).not.toContain("effect-preset");
    expect(JSON.stringify(wire(t.viewer(t.h.p1.id)))).not.toContain(t.rageFeature);
  });

  test("FR-MOD-30 crash: hard kill before commit → no effect, no spend; after commit → both", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    try {
      armCrashHook({ point: "before-commit", target: MOD_INTENTS.toggle }, kill);
      expect(() => t.toggle(t.thornId, t.rage, true, t.p2)).toThrow();
      expect(t.preset(t.rage).activeEffectId).toBeNull();
      expect(t.used(t.rageFeature)).toBe(0);
      armCrashHook({ point: "after-commit", target: MOD_INTENTS.toggle }, kill);
      expect(() => t.toggle(t.thornId, t.rage, true, t.p2)).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    expect(t.preset(t.rage).activeEffectId).not.toBeNull();
    expect(t.used(t.rageFeature)).toBe(1);
  });
});

describe("FR-MOD-41 CHARX feature-use seam", () => {
  test("FR-MOD-41 refundFeatureUse gives one use back, clamped at 0; spendFeatureUse reports missing / none-left and writes nothing then; neither emits", () => {
    const t = setup();
    const call = <R>(op: "spend" | "refund", rowId = t.rageFeature) =>
      t.run<R>(seam.name, { op, characterId: t.thornId, rowId });
    const n = t.events.length;
    expect(call<{ ok: boolean; after: number }>("spend")).toMatchObject({ ok: true, after: 1 });
    call("spend");
    call("spend");
    expect(call("spend")).toEqual({ ok: false, reason: "none-left", name: "Rage", max: 3 });
    expect(call("spend", "nope")).toEqual({ ok: false, reason: "missing" });
    expect(t.used(t.rageFeature)).toBe(3);
    const back = call<{ type: string } | null>("refund");
    expect(back?.type).toBe(CREATURE_SHEET_TYPE);
    expect(t.used(t.rageFeature)).toBe(2);
    call("refund");
    call("refund");
    expect(t.used(t.rageFeature)).toBe(0);
    expect(call("refund")).toBeNull();
    expect(call("refund", "nope")).toBeNull();
    expect(t.used(t.rageFeature)).toBe(0);
    expect(t.events.length).toBe(n);
  });
});
