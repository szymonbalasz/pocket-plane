// R7 combat parts (FR-MOD-40, -47, -48) end to end on the server: the card's text names its
// offered parts; the outcome line lands them after the weapon damage, for the DM and players
// (label iff the trigger is public, "(DM)" else), with the DM's "(DM set; rolled …)" / "(DM
// ruled)"; a part's own multiplier; no campaign preset id on a player's card.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, ruleTrigger } from "../../db/schema";
import { playerViewer, sourceOf } from "../../ws/testing/convergence";
import { type RtSetup, rtSetup } from "./trigger-testing";

function raging() {
  const t = rtSetup();
  t.nextTo("Brakka", 1);
  t.rage(true);
  return t;
}

const furyValue = (t: RtSetup, cardId: string) =>
  t.card(cardId).damage?.triggers?.find((x) => x.triggerId === t.furyId)?.value as number;

/** The outcome line of an hp_change as the DM and as players read it. */
function lines(t: RtSetup, hpChangeId: string) {
  const row = t.s.db.select().from(hpChange).where(eq(hpChange.id, hpChangeId)).get();
  const e = t.s.db
    .select()
    .from(gameLogEntry)
    .where(eq(gameLogEntry.id, row?.entryId as string))
    .get();
  if (!e) throw new Error("no line");
  const of = (dm: boolean) =>
    lineText(
      formatEntry({
        kind: e.kind,
        actorName: e.actorName,
        payload: e.payload,
        dmPayload: dm ? e.dmPayload : null,
      }).segments,
    );
  return { dm: of(true), players: of(false) };
}

describe("FR-MOD-48 card text", () => {
  test("FR-MOD-48 card text names the offered part after the damage ('(+ 6 radiant Divine Fury on a hit)'); none → as before", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const v = furyValue(t, cardId);
    expect(t.note(cardId)?.text).toBe(
      `Brakka: 22 to hit, 14 slashing (+ ${v} radiant Divine Fury on a hit)`,
    );
    // Same turn, charge used → no offer, plain text.
    t.applyTo(cardId, [{ name: "Goblin", triggers: [{ triggerId: t.furyId }] }]);
    const second = t.attack("Brakka", { toHit: 15, damage: 8 }).cardId;
    expect(t.note(second)?.text).toBe("Brakka: 22 to hit, 14 slashing");
  });

  test("FR-MOD-48 split flow: a to-hit-only card gets the offer in its text once Damage is rolled", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { toHit: 15, rolls: "toHit" });
    expect(t.note(cardId)?.text).toBe("Brakka: 22 to hit (Greataxe)");
    t.rollDamage("Brakka", 8);
    const v = furyValue(t, cardId);
    expect(t.note(cardId)?.text).toBe(
      `Brakka: 22 to hit, 14 slashing (+ ${v} radiant Divine Fury on a hit)`,
    );
  });
});

describe("FR-MOD-48 outcome lines", () => {
  test("FR-MOD-48 DM and players: '… 14 slashing damage + N radiant (Divine Fury)'; the part's own multiplier", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const v = furyValue(t, cardId);
    const { hpChangeIds } = t.applyTo(cardId, [
      { name: "Goblin", multiplier: "half", triggers: [{ triggerId: t.furyId }] },
    ]);
    const half = Math.floor(v / 2);
    const l = lines(t, hpChangeIds[0] as string);
    // Physical weapon dice: the line's one "physical" badge stays at the end (FR-CBT-73).
    expect(l.players).toBe(
      `Brakka attacks Goblin: 15 + 7 = 22 — hit! 7 slashing damage (half) + ${half} radiant (Divine Fury) (half) (physical)`,
    );
    expect(l.dm).toContain(`+ ${half} radiant (Divine Fury) (half)`);
    expect(l.dm).not.toContain("DM set");
  });

  test("FR-MOD-40 / -47 value edit: DM '(DM set; rolled N)', players the value only; a non-public trigger reads '(DM)' for players", () => {
    const t = raging();
    t.s.db.update(ruleTrigger).set({ public: false }).where(eq(ruleTrigger.id, t.furyId)).run();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const v = furyValue(t, cardId);
    const edit = v === 9 ? 8 : 9;
    const { hpChangeIds } = t.applyTo(cardId, [
      { name: "Goblin", triggers: [{ triggerId: t.furyId, value: edit }] },
    ]);
    const l = lines(t, hpChangeIds[0] as string);
    expect(l.players).toContain(`14 slashing damage + ${edit} radiant (DM)`);
    expect(l.players).not.toContain("Divine Fury");
    expect(l.players).not.toContain("DM set");
    expect(l.dm).toContain(`+ ${edit} radiant (Divine Fury) (DM set; rolled ${v})`);
  });

  test("FR-MOD-40 a forced charge: DM line '(DM ruled)'; players see the part only", () => {
    const t = raging();
    const a = t.attack("Brakka").cardId;
    const b = t.attack("Brakka").cardId;
    t.applyTo(a, [{ name: "Goblin", triggers: [{ triggerId: t.furyId }] }]);
    const { hpChangeIds } = t.applyTo(b, [
      { name: "Goblin 2", triggers: [{ triggerId: t.furyId, force: true }] },
    ]);
    const l = lines(t, hpChangeIds[0] as string);
    expect(l.dm).toContain("(Divine Fury) (DM ruled)");
    expect(l.players).toContain("(Divine Fury)");
    expect(l.players).not.toContain("DM ruled");
  });
});

describe("MOD §13 leak scan (R7 combat parts)", () => {
  test("FR-MOD-47 per player, snapshot (= reconnect) and live: no campaign preset id on Thorn's card; a non-public part's name never; values public", () => {
    const t = rtSetup();
    const mark = t.put({
      characterId: null,
      name: "Favored Foe",
      modifiers: [],
      durationRounds: 10,
      concentration: true,
      note: "",
    });
    const ff = t.trig({
      characterId: t.thornId,
      name: "Favored Foe",
      rule: {
        on: "hit",
        when: [{ if: "targetMarked", preset: mark }],
        every: "turn",
        then: { do: "damage", formula: "1d4", type: null },
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
    t.apply({
      targets: [{ combatantId: t.id("Goblin") }],
      preset: { presetId: mark },
      sourceCombatantId: t.id("Thorn"),
    });
    t.nextTo("Thorn", 1);
    const thorn = t.attack("Thorn", { damage: 3, actor: t.p2 }).cardId;
    expect(t.note(thorn)?.audiencePlayerId).toBe(t.h.p2.id);
    t.applyTo(thorn, [{ name: "Goblin", triggers: [{ triggerId: ff }] }]);
    t.nextTo("Elite Goblin Warrior", 1);
    const elite = t.attack("Elite Goblin Warrior", { damage: 5 }).cardId;
    const { hpChangeIds } = t.applyTo(elite, [
      { name: "Thorn", triggers: [{ triggerId: ma, value: 9 }] },
    ]);
    expect(lines(t, hpChangeIds[0] as string).players).toContain("+ 9 (DM)");

    const src = sourceOf(t.s);
    const changes = t.events.flatMap((e) => e.event.changes);
    for (const playerId of [t.h.p1.id, t.h.p2.id]) {
      const v = playerViewer(t.h.campaignId, playerId);
      const snapshot = t.s.records.snapshot(src, v);
      const live = changes.map((c) => t.s.records.filterChange(c, v)).filter(Boolean);
      const json = JSON.stringify([snapshot, live]);
      for (const s of [mark, "Martial Advantage", "an ally within 5 ft", "rolled", "set"]) {
        expect(json).not.toContain(s === "set" ? '"set":true' : s);
      }
    }
    // Thorn's player reads the card (its offer, the mark by name) in snapshot and live.
    const p2 = JSON.stringify(t.s.records.snapshot(src, playerViewer(t.h.campaignId, t.h.p2.id)));
    expect(p2).toContain('"marked":"Favored Foe"');
  });
});
