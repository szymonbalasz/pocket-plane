// FR-CHARX-58 (sprint 4, [14]; OQ-CHARX-27 #245): feature uses go below zero down to −9 through
// `char.useResource` (pips past 0 → `used` up to `usesMax + 9`, then no change and no event);
// slots and hit dice still clamp at max; lowering `usesMax` keeps the overspend (clamped to the
// new `usesMax + 9`); Reset → full. `spendFeatureUse` / `refundFeatureUse` (MOD's seam): refuse at
// 0 left unless `overspend`, `floor` at −9, refund from below zero. Visibility: the overspent
// sheet reaches the owner and the DM only.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { creatureSheet } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { refundFeatureUse, spendFeatureUse } from "./resources";
import { toSheetRecord } from "./sheet-rows";

const I = CHARX_INTENTS;

/** Test-only: MOD's seam called from a command (the toggle / apply hook call it in theirs). */
const seam = defineCommand({
  name: "test.featureUse",
  input: z.object({
    op: z.enum(["spend", "refund"]),
    characterId: z.string(),
    rowId: z.string(),
    overspend: z.boolean().optional(),
  }),
  execute: ({ op, characterId, rowId, overspend }, env) =>
    op === "spend"
      ? spendFeatureUse(env, characterId, rowId, { overspend })
      : refundFeatureUse(env, characterId, rowId),
});

function setup() {
  const { s } = diceServices("uses-negative");
  const t = seedDice(s);
  s.commands.register(seam);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  const run = <R = Record<string, unknown>>(name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor }) as R;
  const fail = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const sheet = () => {
    const row = s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, t.miraId)).get();
    return row ? toSheetRecord(row) : null;
  };
  const rage = run<{ rowId: string }>(I.putRow, {
    creatureId: t.miraId,
    list: "features",
    row: { name: "Rage", usesMax: 3, reset: "long" },
  }).rowId;
  const used = () => sheet()?.features.find((f) => f.id === rage)?.used;
  const use = (op: object, actor: Actor = t.p1Actor) =>
    run<{ before: number; after: number }>(
      I.useResource,
      { characterId: t.miraId, resource: { feature: rage }, ...op },
      actor,
    );
  events.length = 0;
  return { s, t, events, run, fail, sheet, rage, used, use };
}

describe("FR-CHARX-58 negative uses", () => {
  test("FR-CHARX-58 negative uses: pips past 0 → −1 … −9, then no-op; slots and hit dice still clamp at max; lowering usesMax keeps −1; Reset → full", () => {
    const t = setup();
    expect(t.use({ delta: 3 })).toEqual({ before: 0, after: 3 });
    // Past zero: one more each (owner and DM both apply), down to −9 (used 12).
    expect(t.use({ delta: 1 })).toEqual({ before: 3, after: 4 });
    expect(t.use({ delta: 1 }, t.t.dm)).toEqual({ before: 4, after: 5 });
    expect(t.use({ delta: 9 })).toEqual({ before: 5, after: 12 });
    const n = t.events.length;
    // At the floor: no change, no event.
    expect(t.use({ delta: 1 })).toEqual({ before: 12, after: 12 });
    expect(t.events.length).toBe(n);
    // Restoring from below zero, one at a time.
    expect(t.use({ delta: -1 })).toEqual({ before: 12, after: 11 });
    // The event log carries the overspend as before / after.
    expect(t.events.map((e) => e.event.payload)).toEqual([
      { characterId: t.t.miraId, resource: { feature: t.rage }, before: 0, after: 3 },
      { characterId: t.t.miraId, resource: { feature: t.rage }, before: 3, after: 4 },
      { characterId: t.t.miraId, resource: { feature: t.rage }, before: 4, after: 5 },
      { characterId: t.t.miraId, resource: { feature: t.rage }, before: 5, after: 12 },
      { characterId: t.t.miraId, resource: { feature: t.rage }, before: 12, after: 11 },
    ]);

    // Slots and hit dice keep 0 … max.
    t.run(I.edit, {
      creatureId: t.t.miraId,
      set: {
        spellcasting: { ability: "wis", slots: { "1": 2 } },
        classes: [{ name: "Fighter", level: 1, hitDie: "d10" }],
      },
    });
    const res = (resource: object, delta: number) =>
      t.run<{ after: number }>(
        I.useResource,
        { characterId: t.t.miraId, resource, delta },
        t.t.p1Actor,
      ).after;
    expect(res({ slot: 1 }, 9)).toBe(2);
    expect(res({ hitDie: "d10" }, 9)).toBe(1);

    // Lowering usesMax keeps the overspend: 3 used of 3 → 2 uses = −1 / 2 left.
    t.use({ reset: true });
    t.use({ delta: 3 });
    const put = (usesMax: number) =>
      t.run(I.putRow, {
        creatureId: t.t.miraId,
        list: "features",
        row: { id: t.rage, name: "Rage", usesMax, reset: "long" },
      });
    put(2);
    expect(t.used()).toBe(3);
    // … clamped to the new usesMax + 9: 12 used of 3 → 1 use = at most 10 used (−9 / 1).
    put(3);
    t.use({ delta: 9 });
    expect(t.used()).toBe(12);
    put(1);
    expect(t.used()).toBe(10);

    // Reset → full (0 used).
    expect(t.use({ reset: true })).toEqual({ before: 10, after: 0 });
    expect(t.sheet()?.features.find((f) => f.id === t.rage)).toMatchObject({ usesMax: 1, used: 0 });
  });

  test("FR-CHARX-58 spendFeatureUse refuses at 0 left unless overspend, stops at the floor; refundFeatureUse gives one back from below zero; neither emits", () => {
    const t = setup();
    const call = <R>(op: "spend" | "refund", overspend?: boolean) =>
      t.run<R>(seam.name, { op, characterId: t.t.miraId, rowId: t.rage, overspend });
    t.use({ delta: 3 });
    const n = t.events.length;
    expect(call("spend")).toEqual({
      ok: false,
      reason: "none-left",
      name: "Rage",
      max: 3,
      left: 0,
    });
    expect(t.used()).toBe(3);
    expect(call<{ ok: boolean; before: number; after: number }>("spend", true)).toMatchObject({
      ok: true,
      before: 3,
      after: 4,
    });
    for (let i = 0; i < 8; i++) call("spend", true);
    expect(t.used()).toBe(12);
    expect(call("spend", true)).toEqual({
      ok: false,
      reason: "floor",
      name: "Rage",
      max: 3,
      left: -9,
    });
    expect(t.used()).toBe(12);
    // Refund from below zero: −9 → −8 … −1 → 0.
    expect(call<{ type: string } | null>("refund")?.type).toBe(CREATURE_SHEET_TYPE);
    expect(t.used()).toBe(11);
    for (let i = 0; i < 8; i++) call("refund");
    expect(t.used()).toBe(3);
    expect(t.events.length).toBe(n);
  });

  test("FR-CHARX-58 an overspent sheet reaches the owner and the DM only", () => {
    const t = setup();
    t.use({ delta: 4 });
    const change = t.events.at(-1)?.event.changes.find((c) => c.type === CREATURE_SHEET_TYPE);
    if (!change) throw new Error("no sheet change");
    const viewer = (playerId: string | null): Viewer => ({
      connId: `c-${playerId ?? "dm"}`,
      campaignId: t.t.dm.campaignId as string,
      role: playerId ? "player" : "dm",
      playerId,
    });
    const usedFor = (v: Viewer) => {
      const c = t.s.records.filterChange(change, v);
      return c?.op === "upsert"
        ? (c.data as { features: { id: string; used: number }[] }).features.find(
            (f) => f.id === t.rage,
          )?.used
        : null;
    };
    expect(usedFor(viewer(null))).toBe(4);
    expect(usedFor(viewer(t.t.p1.id))).toBe(4);
    expect(t.s.records.filterChange(change, viewer(t.t.p2.id))).toBeNull();
  });
});
