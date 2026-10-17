// FR-MOD-59 (sprint 4, [14]): feature uses below zero from MOD's paths. (a) `mod.toggle` at 0 left
// → `conflict` unless `overspend: true` (owner or DM) → one use spent (−1 / 3), effect on; at the
// floor (−9) `conflict` "Rage is at −9 / 3 — reset it first"; DM `force` still spends nothing.
// (b) A forced `feature` trigger part spends the use below zero (at the floor `conflict` even
// with Force). (c) Undo refunds exactly the use its apply spent (−1 → 0). The sheet change rides
// on the causing event to the owner and the DM only; a crash is all or nothing.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { creatureSheet, ruleTrigger, triggerUse } from "../../db/schema";
import type { Actor } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { getSheet, toSheetRecord } from "../character-sheet/sheet-rows";
import { modSetup } from "./testing";
import { rtSetup } from "./trigger-testing";

/** Thorn (player-2) with "Rage" 3 uses and the built-in Rage preset linked to it, all spent. */
function toggleSetup() {
  const t = modSetup();
  const sheet = () => {
    const row = t.s.db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, t.thornId))
      .get();
    return row ? toSheetRecord(row) : null;
  };
  const rageRow = t.run<{ rowId: string }>(CHARX_INTENTS.putRow, {
    creatureId: t.thornId,
    list: "features",
    row: { name: "Rage", usesMax: 3, reset: "long" },
  }).rowId;
  const rage = t.put(
    t.from("rage", { characterId: t.thornId, originKey: "rage", usesFeatureId: rageRow }),
    t.p2,
  );
  const used = () => sheet()?.features.find((f) => f.id === rageRow)?.used;
  const use = (op: object) =>
    t.run(CHARX_INTENTS.useResource, {
      characterId: t.thornId,
      resource: { feature: rageRow },
      ...op,
    });
  use({ delta: 3 });
  const toggle = (on: boolean, o: { overspend?: true; force?: true; actor?: Actor } = {}) =>
    t.run<{ effectId: string | null }>(
      "mod.toggle",
      {
        characterId: t.thornId,
        presetId: rage,
        on,
        ...(o.overspend ? { overspend: o.overspend } : {}),
        ...(o.force ? { force: o.force } : {}),
      },
      o.actor ?? t.p2,
    );
  const viewer = (playerId: string | null): Viewer => ({
    connId: `c-${playerId ?? "dm"}`,
    campaignId: t.h.dm.campaignId as string,
    role: playerId ? "player" : "dm",
    playerId,
  });
  return { ...t, rageRow, rage, used, use, toggle, viewer };
}

describe("FR-MOD-59 overspend + undo restores negative uses", () => {
  test("FR-MOD-59 overspend + undo restores negative uses: Rage at 0 left → toggle conflict; overspend → −1 / 3, effect on; at −9 overspend → conflict", () => {
    const t = toggleSetup();
    expect(t.used()).toBe(3);
    const n = t.events.length;
    const e = t.err(() => t.toggle(true));
    expect([e.code, e.message]).toEqual(["conflict", "No Rage uses left"]);
    expect(t.events.length).toBe(n);
    // The owner confirms: one use spent below zero, Rage on, the spend on EffectToggled.
    expect(t.toggle(true, { overspend: true }).effectId).not.toBeNull();
    expect(t.used()).toBe(4);
    expect(t.typesSince(n)).toEqual(["EffectToggled"]);
    expect(t.events[n]?.event.changes.map((c) => c.type)).toContain(CREATURE_SHEET_TYPE);
    expect(t.active().filter((x) => x.label === "Rage")).toHaveLength(1);
    // Off never refunds; the DM overspends too (−2 / 3).
    t.toggle(false);
    expect(t.used()).toBe(4);
    t.toggle(true, { overspend: true, actor: t.h.dm });
    expect(t.used()).toBe(5);
    t.toggle(false);
    // DM force still means on without spending.
    t.toggle(true, { force: true, actor: t.h.dm });
    expect(t.used()).toBe(5);
    t.toggle(false);
    // Another player may not toggle (ownership), overspend or not.
    expect(t.err(() => t.toggle(true, { overspend: true, actor: t.p1 })).code).toBe("forbidden");
    // Down to the floor: −9 / 3 (used 12); then `conflict`, nothing written.
    t.use({ delta: 7 });
    expect(t.used()).toBe(12);
    const m = t.events.length;
    const floor = t.err(() => t.toggle(true, { overspend: true }));
    expect([floor.code, floor.message]).toEqual(["conflict", "Rage is at −9 / 3 — reset it first"]);
    expect(t.events.length).toBe(m);
    expect(t.preset(t.rage).activeEffectId).toBeNull();
    // Overspend with uses left spends normally (Reset → 3 / 3, then 2 / 3).
    t.use({ reset: true });
    t.toggle(true, { overspend: true });
    expect(t.used()).toBe(1);
  });

  test("FR-MOD-59 the overspent sheet change reaches Thorn's owner and the DM, not player-1", () => {
    const t = toggleSetup();
    const n = t.events.length;
    t.toggle(true, { overspend: true });
    const changes = t.events.slice(n).flatMap((x) => x.event.changes);
    const types = (v: Viewer) =>
      changes.map((c) => t.s.records.filterChange(c, v)?.type).filter((c) => c !== undefined);
    expect(types(t.viewer(null))).toContain(CREATURE_SHEET_TYPE);
    expect(types(t.viewer(t.h.p2.id))).toContain(CREATURE_SHEET_TYPE);
    expect(types(t.viewer(t.h.p1.id))).not.toContain(CREATURE_SHEET_TYPE);
    const p1Wire = changes.map((c) => t.s.records.filterChange(c, t.viewer(t.h.p1.id)));
    expect(JSON.stringify(p1Wire)).not.toContain(t.rageRow);
  });

  test("FR-MOD-59 crash: mod.toggle with overspend killed before commit → no effect, no spend; after commit → both", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = toggleSetup();
    try {
      armCrashHook({ point: "before-commit", target: "mod.toggle" }, kill);
      expect(() => t.toggle(true, { overspend: true })).toThrow();
      expect(t.preset(t.rage).activeEffectId).toBeNull();
      expect(t.used()).toBe(3);
      armCrashHook({ point: "after-commit", target: "mod.toggle" }, kill);
      expect(() => t.toggle(true, { overspend: true })).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    expect(t.preset(t.rage).activeEffectId).not.toBeNull();
    expect(t.used()).toBe(4);
  });
});

describe("FR-MOD-59 forced feature part", () => {
  /** Brakka raging on her turn; Divine Fury spends a Rage use (`every.feature`). */
  function setup() {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    t.rage(true);
    const rule = t.s.db.select().from(ruleTrigger).where(eq(ruleTrigger.id, t.furyId)).get()
      ?.rule as TriggerRule;
    t.s.db
      .update(ruleTrigger)
      .set({ rule: { ...rule, every: { feature: t.rageRowId } } })
      .where(eq(ruleTrigger.id, t.furyId))
      .run();
    const used = () =>
      getSheet(t.s.db as never, t.brakkaId)?.features.find((f) => f.id === t.rageRowId)?.used;
    const spend = (delta: number) =>
      t.run(CHARX_INTENTS.useResource, {
        characterId: t.brakkaId,
        resource: { feature: t.rageRowId },
        delta,
      });
    const fury = (force?: true) => [{ triggerId: t.furyId, ...(force ? { force } : {}) }];
    return { ...t, used, spend, fury };
  }

  test("FR-MOD-59 a feature trigger forced at 0 → −1; undo → 0 (exact refund); at −9 conflict even with Force", () => {
    const t = setup();
    // Rolled while a use was left (offered), then spent to 0 / 3 before the apply.
    const { cardId } = t.attack("Brakka");
    t.spend(3);
    const e = t.err(() => t.applyTo(cardId, [{ name: "Goblin", triggers: t.fury() }]));
    expect([e.code, e.message]).toEqual(["conflict", "Divine Fury: no Rage uses left"]);
    expect(e.issues?.[0]?.path).toEqual(["triggers", t.furyId]);
    expect(t.used()).toBe(3);
    // Force spends it: −1 / 3; the use row records forced + the feature it spent.
    const n = t.events.length;
    t.applyTo(cardId, [{ name: "Goblin", triggers: t.fury(true) }]);
    expect(t.used()).toBe(4);
    const row = t.usesOf(t.furyId).find((u) => u.state === "used");
    expect(row).toMatchObject({ forced: true, featureId: t.rageRowId });
    const applied = t.events.slice(n).find((x) => x.event.type === "AttackApplied");
    const sheet = applied?.event.changes.find((c) => c.type === CREATURE_SHEET_TYPE);
    expect(sheet).toBeDefined();
    // The owner (player-1) and the DM get the sheet change; player-2 doesn't.
    const v = (playerId: string | null): Viewer => ({
      connId: "c",
      campaignId: t.h.dm.campaignId as string,
      role: playerId ? "player" : "dm",
      playerId,
    });
    if (!sheet) throw new Error("no sheet change");
    expect(t.s.records.filterChange(sheet, v(null))).not.toBeNull();
    expect(t.s.records.filterChange(sheet, v(t.h.p1.id))).not.toBeNull();
    expect(t.s.records.filterChange(sheet, v(t.h.p2.id))).toBeNull();
    // Undo refunds exactly that use (−1 → 0), the part is offered again.
    t.undo();
    expect(t.used()).toBe(3);
    expect(t.usesOf(t.furyId).map((u) => [u.state, u.featureId])).toEqual([["offered", null]]);

    // At the floor (−9 / 3): Force conflicts too; nothing written.
    t.spend(9);
    expect(t.used()).toBe(12);
    const floor = t.err(() => t.applyTo(cardId, [{ name: "Goblin", triggers: t.fury(true) }]));
    expect([floor.code, floor.message]).toEqual([
      "conflict",
      "Divine Fury: Rage is at −9 / 3 — reset it first",
    ]);
    expect(floor.issues?.[0]?.path).toEqual(["triggers", t.furyId]);
    expect(t.used()).toBe(12);
    expect(t.s.db.select().from(triggerUse).where(eq(triggerUse.state, "used")).all()).toHaveLength(
      0,
    );
  });

  test("FR-MOD-59 a feature trigger with a use left spends normally; two forced applies go to −2, undoing one gives back one", () => {
    const t = setup();
    const a = t.attack("Brakka").cardId;
    t.applyTo(a, [{ name: "Goblin", triggers: t.fury() }]);
    expect(t.used()).toBe(1);
    t.undo();
    expect(t.used()).toBe(0);
    t.spend(3);
    t.applyTo(a, [{ name: "Goblin", triggers: t.fury(true) }]);
    expect(t.used()).toBe(4);
    t.undo();
    expect(t.used()).toBe(3);
  });
});
