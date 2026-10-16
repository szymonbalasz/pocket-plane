// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// `rule-trigger` visibility (FR-MOD-47; R0): the record type is defined, not registered (R4
// registers it lazy); here it runs in a test registry. DM full (no server-only `presetRefs`);
// the owner player their characters' rows with campaign preset ids redacted; other players and
// definition triggers nothing; live changes follow the same matrix.
import { describe, expect, test } from "bun:test";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { ruleTrigger, ruleTriggerSeqNext } from "../../db/schema";
import { RecordRegistry, type Viewer } from "../../ws/records";
import { modSetup } from "./testing";
import {
  campaignTriggers,
  ruleTriggerRecordType,
  ruleTriggerVisibility,
  toRuleTriggerRecord,
} from "./trigger-records";

const AT = "2026-01-01T00:00:00.000Z";

function setup() {
  const t = modSetup();
  const cid = t.h.campaignId;
  // A campaign mark (Hex-like) and Mira's own toggle preset.
  const mark = t.put(t.from("bless", { name: "Hex" }));
  const own = t.put(t.from("rage", { characterId: t.miraId }));
  const rule = (requires: string, marked: string): TriggerRule => ({
    on: "hit",
    requires: { preset: requires },
    when: [
      { if: "via", via: "weapon" },
      { if: "targetMarked", preset: marked },
    ],
    every: "turn",
    then: { do: "damage", formula: "1d6", type: "necrotic" },
  });
  let n = 0;
  const insert = (v: Partial<typeof ruleTrigger.$inferInsert>) => {
    const id = `trg-${++n}`;
    t.s.db
      .insert(ruleTrigger)
      .values({
        id,
        campaignId: cid,
        seq: ruleTriggerSeqNext,
        name: "Hexblade",
        public: true,
        rule: rule(own, mark),
        updatedAt: AT,
        ...v,
      })
      .run();
    return id;
  };
  const mira = insert({ characterId: t.miraId, ownerPlayerId: t.h.p1.id });
  const thorn = insert({
    characterId: t.thornId,
    ownerPlayerId: t.h.p2.id,
    name: "Sneak Attack",
    rule: rule("rage", "hunters-mark"),
  });
  const wolf = insert({ definitionId: t.h.wolfId, name: "Martial Advantage", public: false });
  const reg = new RecordRegistry();
  reg.register(ruleTriggerRecordType);
  const viewer = (role: "dm" | "player", playerId: string | null): Viewer => ({
    connId: playerId ?? "dm",
    campaignId: cid,
    role,
    playerId,
  });
  const dm = viewer("dm", null);
  const p1 = viewer("player", t.h.p1.id);
  const p2 = viewer("player", t.h.p2.id);
  const snap = (v: Viewer) =>
    (reg.snapshot({ db: t.s.db, presence: { list: () => [] } }, v)[RULE_TRIGGER_TYPE] ?? []) as {
      id: string;
      rule: unknown;
    }[];
  const record = (id: string) =>
    toRuleTriggerRecord(
      t.s.db,
      t.s.db
        .select()
        .from(ruleTrigger)
        .where(eq(ruleTrigger.id, id))
        .get() as typeof ruleTrigger.$inferSelect,
    );
  return { t, cid, mark, own, mira, thorn, wolf, reg, dm, p1, p2, snap, record };
}

describe("FR-MOD-47 rule-trigger visibility (R0, registered lazy in R4)", () => {
  test("FR-MOD-47 DM: every row, wire without server-only presetRefs", () => {
    const x = setup();
    const rows = x.snap(x.dm);
    expect(rows.map((r) => r.id)).toEqual([x.mira, x.thorn, x.wolf]);
    expect(JSON.stringify(rows)).not.toContain("presetRefs");
    expect(rows[0]?.rule).toEqual(x.record(x.mira).rule);
  });

  test("FR-MOD-47 owner players: own characters' rows only; campaign preset ids → {name}; own preset ids and built-ins kept", () => {
    const x = setup();
    const p1 = x.snap(x.p1);
    expect(p1.map((r) => r.id)).toEqual([x.mira]);
    const text = JSON.stringify(p1);
    expect(text).not.toContain(x.mark);
    expect(text).not.toContain("presetRefs");
    expect(p1[0]?.rule).toMatchObject({
      requires: { preset: x.own },
      when: [{ if: "via" }, { if: "targetMarked", name: "Hex" }],
    });
    const p2 = x.snap(x.p2);
    expect(p2.map((r) => r.id)).toEqual([x.thorn]);
    expect(p2[0]?.rule).toMatchObject({
      requires: { preset: "rage" },
      when: [{ if: "via" }, { if: "targetMarked", preset: "hunters-mark" }],
    });
    // Leak strings (MOD §13): definition triggers and the other player's rows never.
    for (const rows of [p1, p2]) {
      expect(JSON.stringify(rows)).not.toContain("Martial Advantage");
    }
    expect(JSON.stringify(p1)).not.toContain("Sneak Attack");
    expect(JSON.stringify(p2)).not.toContain("Hexblade");
  });

  test("FR-MOD-47 live changes: owner upsert / delete; others and definition rows: nothing", () => {
    const x = setup();
    const after = x.record(x.mira);
    const create = { type: RULE_TRIGGER_TYPE, id: x.mira, before: null, after };
    expect(x.reg.filterChange(create, x.dm)).toMatchObject({ op: "upsert" });
    const toOwner = x.reg.filterChange(create, x.p1);
    expect(toOwner).toMatchObject({ op: "upsert" });
    expect(JSON.stringify(toOwner)).not.toContain(x.mark);
    expect(x.reg.filterChange(create, x.p2)).toBeNull();
    const del = { type: RULE_TRIGGER_TYPE, id: x.mira, before: after, after: null };
    expect(x.reg.filterChange(del, x.p1)).toEqual({
      type: RULE_TRIGGER_TYPE,
      id: x.mira,
      op: "delete",
    });
    const wolf = x.record(x.wolf);
    for (const v of [x.p1, x.p2]) {
      expect(
        x.reg.filterChange({ type: RULE_TRIGGER_TYPE, id: x.wolf, before: null, after: wolf }, v),
      ).toBeNull();
    }
    // Owner change (FR-MOD-47 copy kept by the definition-changed hook line, R4): old owner
    // deletes, new owner upserts.
    const moved = { ...after, ownerPlayerId: x.t.h.p2.id };
    const change = { type: RULE_TRIGGER_TYPE, id: x.mira, before: after, after: moved };
    expect(x.reg.filterChange(change, x.p1)).toMatchObject({ op: "delete" });
    expect(x.reg.filterChange(change, x.p2)).toMatchObject({ op: "upsert" });
  });

  test("FR-MOD-47 the visibility fn reads record + viewer only; a deleted campaign preset redacts fail-closed", () => {
    const x = setup();
    expect(ruleTriggerVisibility(x.record(x.wolf), x.p1)).toBe("hidden");
    expect(ruleTriggerVisibility(x.record(x.mira), x.p1)).toBe("redacted");
    x.t.run("mod.deletePreset", { presetId: x.mark });
    const [row] = campaignTriggers(x.t.s.db, x.cid);
    expect(row?.presetRefs).toEqual({ [x.own]: { own: true } });
    const p1 = JSON.stringify(x.snap(x.p1));
    expect(p1).not.toContain(x.mark);
    expect(p1).toContain("Missing preset");
  });
});
