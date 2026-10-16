// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// FR-MOD-44 turn-start reminders (`combatRuleHooks` line, notification kind `mod-trigger`) and the
// MOD §13 leak scan for rule triggers: player snapshots, `sync.load` acks and live changes never
// carry monster triggers, another player's triggers, trigger bookkeeping or DM-only notes.
import { describe, expect, test } from "bun:test";
import { MOD_TRIGGER_KIND } from "@shared/effect-modifiers/reminders";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { asc, eq } from "drizzle-orm";
import { notification, ruleTrigger } from "../../db/schema";
import type { Viewer } from "../../ws/records";
import { playerViewer, sourceOf } from "../../ws/testing/convergence";
import { type RtSetup, rtSetup } from "./trigger-testing";

const regeneration: TriggerRule = {
  on: "turnStart",
  when: [],
  every: "each",
  then: {
    do: "remind",
    text: "regain {value} HP unless it took acid or fire damage",
    value: "10",
  },
};

const reminders = (t: RtSetup) =>
  t.s.db
    .select()
    .from(notification)
    .where(eq(notification.kind, MOD_TRIGGER_KIND))
    .orderBy(asc(notification.seq))
    .all();

describe("FR-MOD-44 turn-start reminders", () => {
  test("FR-MOD-44 first turn (R7): 'Start round 1' (Next from round 0) → the Wolf's reminder to the DM; none on Prev; again on its next turn", () => {
    const t = rtSetup({ round1: false });
    t.trig({ definitionId: t.h.wolfId, name: "Regeneration", rule: regeneration });
    t.step("next");
    expect(t.turnName()).toBe("Wolf");
    expect(
      reminders(t).map((n) => [n.audience, n.audiencePlayerId, n.state, n.text, n.payload]),
    ).toEqual([
      [
        "dm",
        null,
        "info",
        "Wolf: Regeneration — regain 10 HP unless it took acid or fire damage",
        {
          triggerName: "Regeneration",
          creatureName: "Wolf",
          encounterId: t.enc.id,
          text: "regain 10 HP unless it took acid or fire damage",
        },
      ],
    ]);
    t.step("next");
    t.step("prev");
    expect(t.turnName()).toBe("Wolf");
    expect(reminders(t)).toHaveLength(1);
    t.nextTo("Wolf", 2);
    expect(reminders(t)).toHaveLength(2);
    const created = t.events.filter((e) => e.event.type === "NotificationCreated");
    expect(created.length).toBeGreaterThanOrEqual(2);
  });

  test("FR-MOD-44 a PC's reminder goes to its owner; requires off → none; disabled → none", () => {
    const t = rtSetup();
    const id = t.trig({
      characterId: t.brakkaId,
      name: "Rage reminder",
      rule: {
        ...regeneration,
        requires: { preset: t.ragePresetId },
        then: { do: "remind", text: "rage ends unless you attacked" },
      },
    });
    t.nextTo("Brakka", 1);
    expect(reminders(t)).toEqual([]);
    t.rage(true);
    t.nextTo("Brakka", 2);
    expect(reminders(t).map((n) => [n.audience, n.audiencePlayerId, n.text])).toEqual([
      ["player", t.h.p1.id, "Brakka: Rage reminder — rage ends unless you attacked"],
    ]);
    t.s.db.update(ruleTrigger).set({ enabled: false }).where(eq(ruleTrigger.id, id)).run();
    t.nextTo("Brakka", 3);
    expect(reminders(t)).toHaveLength(1);
  });
});

describe("MOD §13 leak scan (rule triggers)", () => {
  test("FR-MOD-47 leak scan per player: snapshots, sync.load acks and live changes", () => {
    const t = rtSetup();
    const thornTrig = t.trig({
      characterId: t.thornId,
      name: "Sneak Attack",
      rule: {
        on: "hit",
        when: [{ if: "via", via: "weapon" }],
        every: "turn",
        then: { do: "damage", formula: "1d6", type: null },
      },
    });
    const ma = t.trig({
      definitionId: t.eliteId,
      name: "Martial Advantage",
      rule: {
        on: "hit",
        when: [{ if: "ask", note: "an ally within 5 ft of the target" }],
        every: "turn",
        then: { do: "damage", formula: "2d6", type: null },
      },
    });
    t.trig({ definitionId: t.h.wolfId, name: "Regeneration", rule: regeneration });
    // Play: Brakka raging hits with Divine Fury; the Elite's Martial Advantage lands on her.
    t.nextTo("Brakka", 1);
    t.rage(true);
    const fury = t.attack("Brakka", { actor: t.p1 }).cardId;
    t.applyTo(fury, [{ name: "Goblin", triggers: [{ triggerId: t.furyId }] }]);
    // An over-cap Brakka trigger leaves a DM-only note on her next roll line.
    t.trig({
      characterId: t.brakkaId,
      name: "Overload",
      rule: {
        on: "hit",
        when: [],
        every: "each",
        then: { do: "damage", formula: "1d6", type: null },
      },
    });
    t.s.db
      .update(ruleTrigger)
      .set({
        rule: {
          on: "hit",
          when: [],
          every: "each",
          then: { do: "damage", formula: "(level * 4)d6 + (level * 2)d8", type: null },
        },
      })
      .where(eq(ruleTrigger.name, "Overload"))
      .run();
    t.attack("Brakka", { actor: t.p1 });
    t.nextTo("Elite Goblin Warrior", 1);
    const elite = t.attack("Elite Goblin Warrior", { damage: 5 }).cardId;
    expect(t.offers(elite)).toEqual([ma]);
    t.applyTo(elite, [{ name: "Brakka", triggers: [{ triggerId: ma, value: 9 }] }]);
    t.nextTo("Wolf", 2);

    const src = sourceOf(t.s);
    const viewers: Viewer[] = [
      playerViewer(t.h.campaignId, t.h.p1.id),
      playerViewer(t.h.campaignId, t.h.p2.id),
    ];
    const changes = t.events.flatMap((e) => e.event.changes);
    const forbidden = [
      "Martial Advantage",
      "Regeneration",
      "ownerCombatantId",
      '"window"',
      "triggerParts",
      "dmPayload",
      "skipped",
      ma,
    ];
    for (const v of viewers) {
      const snapshot = t.s.records.snapshot(src, v);
      expect(snapshot[RULE_TRIGGER_TYPE]).toBeUndefined();
      const ack = t.s.records.load(src, v, RULE_TRIGGER_TYPE);
      const live = changes.map((c) => t.s.records.filterChange(c, v)).filter(Boolean);
      const json = JSON.stringify([snapshot, ack, live]);
      for (const s of forbidden) expect(json).not.toContain(s);
      const other = v.playerId === t.h.p1.id ? thornTrig : t.furyId;
      expect(
        JSON.stringify([ack, live.filter((w) => w?.type === RULE_TRIGGER_TYPE)]),
      ).not.toContain(other);
    }
    // The DM sees all of it.
    const dm: Viewer = { connId: "dm", campaignId: t.h.campaignId, role: "dm", playerId: null };
    const dmJson = JSON.stringify([
      t.s.records.load(src, dm, RULE_TRIGGER_TYPE),
      changes.map((c) => t.s.records.filterChange(c, dm)),
    ]);
    for (const s of ["Martial Advantage", "Regeneration", "triggerParts", "skipped"]) {
      expect(dmJson).toContain(s);
    }
  });
});
