// Stats tier B in-process (STATS §13.1, sprint 8): the outcome lines' `fell` flag (FR-CBT-152),
// End → the fight summary (FR-CBT-153, FR-STATS-33, FR-NOTE-68), over combat-tracker's ambush
// (Mira, Thorn; Goblin, Goblin 2 visible; Wolf, Elite hidden).
import { describe, expect, test } from "bun:test";
import { AttackLogPayload, attackLogKind, HpLogPayload } from "@shared/combat-tracker/log-kinds";
import { CBT_INTENTS, DamageCardPayload, partRollIdsOf } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import {
  FIGHT_SUMMARY_TEXT,
  STATS_FIGHT_SUMMARY_KIND,
  StatsFightSummaryPayload,
} from "@shared/stats/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification } from "../../db/schema";
import { combatRuleHooksOf } from "../combat-tracker/rule-hooks";
import { statsSetup } from "./testing";

type T = ReturnType<typeof statsSetup>;

/** The outcome line of an `hp_change` row. */
function lineOf(t: T, hpChangeId: string) {
  const row = t.s.db.select().from(hpChange).where(eq(hpChange.id, hpChangeId)).get();
  return t.s.db
    .select()
    .from(gameLogEntry)
    .where(eq(gameLogEntry.id, row?.entryId as string))
    .get();
}
const fellOf = (t: T, hpChangeId: string) =>
  (lineOf(t, hpChangeId)?.payload as { fell?: string } | undefined)?.fell;

const summaries = (t: T) =>
  t.s.db.select().from(notification).where(eq(notification.kind, STATS_FIGHT_SUMMARY_KIND)).all();

describe("FR-CBT-152 fell on the line", () => {
  test("FR-CBT-152 fell on the line: monster kill, PC down, companion down, already at 0 none, heal none", () => {
    const t = statsSetup();
    expect(fellOf(t, t.hp("Goblin", "damage", 3, { from: "Thorn" }))).toBeUndefined();
    expect(fellOf(t, t.hp("Goblin", "damage", 9, { from: "Thorn" }))).toBe("kill");
    // Already at 0: no second flag.
    expect(fellOf(t, t.hp("Goblin", "damage", 5, { from: "Thorn" }))).toBeUndefined();
    // A PC dropped by a monster, whoever the attacker (OQ-STATS-20 A).
    expect(fellOf(t, t.hp("Mira", "damage", 40, { from: "Goblin 2" }))).toBe("down");
    expect(fellOf(t, t.hp("Mira", "heal", 5))).toBeUndefined();
    // A companion going to 0 is a down, not a kill.
    t.run(CBT_INTENTS.setCompanion, {
      combatantId: t.id("Goblin 2"),
      owner: { characterId: t.miraId },
    });
    expect(fellOf(t, t.hp("Goblin 2", "damage", 30))).toBe("down");
    // The DM's direct damage, no From: still flagged.
    expect(fellOf(t, t.hp("Wolf", "damage", 30, { public: false }))).toBe("kill");
  });

  test("FR-CBT-152 fell on the line: multi-target card, per line", () => {
    const t = statsSetup();
    const { cardId } = t.run<{ cardId: string }>(CBT_INTENTS.attack, {
      attackerId: t.id("Thorn"),
      manual: [{ diceTotal: 15 }, { diceTotal: 3 }],
    });
    const card = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    const p = DamageCardPayload.parse(card?.payload);
    // Goblin at 7 HP falls; Wolf (11) does not.
    const { hpChangeIds } = t.run<{ hpChangeIds: string[] }>(CBT_INTENTS.applyCard, {
      cardId,
      toHitTotal: p.toHit?.total,
      damageTotal: 8,
      damageRollId: p.damage?.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [
        { targetId: t.id("Goblin"), hit: true, multiplier: "normal" },
        { targetId: t.id("Wolf"), hit: true, multiplier: "normal" },
      ],
      public: true,
    });
    expect(hpChangeIds.map((id) => fellOf(t, id))).toEqual(["kill", undefined]);
    // Undo strikes the line; the flag stays (stats skip undone lines).
    t.undo(hpChangeIds[1] as string);
    const struck = lineOf(t, hpChangeIds[0] as string);
    expect(struck?.undone).toBe(true);
    expect((struck?.payload as { fell?: string } | undefined)?.fell).toBe("kill");
  });

  test("FR-CBT-152 old rows parse: lines without fell parse; the line text is unchanged", () => {
    const base = {
      targetName: "Goblin 1",
      attackName: "Longsword",
      damageType: "slashing",
      toHit: null,
      hit: true,
      damage: 9,
      multiplier: "normal",
      crit: false,
    } as const;
    const old = AttackLogPayload.parse(base);
    const flagged = AttackLogPayload.parse({ ...base, fell: "kill" });
    expect(old.fell).toBeUndefined();
    const text = (x: AttackLogPayload) =>
      lineText(attackLogKind.formatLine({ actorName: "Thorn", payload: x, dmPayload: null }));
    expect(text(flagged)).toBe(text(old));
    expect(HpLogPayload.parse({ targetName: "Mira", kind: "damage", amount: 3 }).fell).toBe(
      undefined,
    );
    expect(() => AttackLogPayload.parse({ ...base, fell: "dead" })).toThrow();
  });
});

describe("FR-CBT-153 End → fight summary", () => {
  test("FR-CBT-153 FR-STATS-33 FR-NOTE-68 End notifies the summary: a public fact → audience all; info row, player-safe payload", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    const rows = summaries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ audience: "all", state: "info", text: FIGHT_SUMMARY_TEXT });
    expect(StatsFightSummaryPayload.parse(rows[0]?.payload)).toEqual({ encounterId: t.enc.id });
    expect(Object.keys(rows[0]?.payload as object)).toEqual(["encounterId"]);
  });

  test("FR-STATS-33 audience dm: only DM-only facts count (a hidden side, an undone public one)", () => {
    const t = statsSetup();
    t.hp("Thorn", "damage", 4, { from: "Elite Goblin Warrior" });
    t.undo(t.hp("Goblin", "damage", 3, { from: "Thorn" }));
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    expect(summaries(t).map((r) => r.audience)).toEqual(["dm"]);
  });

  test("FR-STATS-33 nothing counted → no summary", () => {
    const t = statsSetup();
    t.undo(t.hp("Goblin", "damage", 3, { from: "Thorn" }));
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    expect(summaries(t)).toHaveLength(0);
  });

  test("FR-CBT-153 order: EncounterEnded, then the CBTX hooks' events, then the summary; a throwing hook rolls End back", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const hooks = combatRuleHooksOf(t.s);
    const names = (hooks as unknown as { list: { name: string }[] }).list.map((h) => h.name);
    expect(names.at(-1)).toBe("stats.fight-summary");
    const types: string[] = [];
    t.s.bus.subscribe("test-order", (d) => {
      types.push(d.event.type);
    });
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    expect(types[0]).toBe("EncounterEnded");
    expect(types).toContain("NotificationCreated");
    expect(summaries(t)).toHaveLength(1);

    // A second fight whose End throws after the summary hook: nothing of End is kept.
    const t2 = statsSetup();
    t2.hp("Goblin", "damage", 3, { from: "Thorn" });
    combatRuleHooksOf(t2.s).register("test.throws", {
      ended() {
        throw new Error("boom");
      },
    });
    expect(() => t2.run(CBT_INTENTS.end, { encounterId: t2.enc.id })).toThrow();
    expect(summaries(t2)).toHaveLength(0);
    expect(t2.fight().fight?.status).toBe("started");
  });
});
