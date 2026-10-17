// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// S4-5 (FR-MOD-57; rulings B3, B4, B5) end to end on the server: a landed public character
// trigger carries its roll on the outcome line for everyone; a monster trigger (public or not)
// and a non-public character trigger keep theirs in `dmPayload`; the DM's value edit hides the
// dice from players; the roll line's offered die is `offered: true`. Leak scan per player,
// snapshot (= reconnect) and live.
import { describe, expect, test } from "bun:test";
import type { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import { type LineSegment, lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, ruleTrigger } from "../../db/schema";
import { playerViewer, sourceOf } from "../../ws/testing/convergence";
import { applyCard } from "../combat-tracker/hp";
import { type RtSetup, rtSetup } from "./trigger-testing";

const dice = (segs: readonly LineSegment[]) => segs.flatMap((s) => (s.die ? [s.die] : []));

function raging() {
  const t = rtSetup();
  t.nextTo("Brakka", 1);
  t.rage(true);
  return t;
}

const furyOf = (t: RtSetup, cardId: string) =>
  t.card(cardId).damage?.triggers?.find((x) => x.triggerId === t.furyId);

/** The outcome line of an hp_change: the row, and the line as the DM and as players read it. */
function line(t: RtSetup, hpChangeId: string) {
  const row = t.s.db.select().from(hpChange).where(eq(hpChange.id, hpChangeId)).get();
  const e = t.s.db
    .select()
    .from(gameLogEntry)
    .where(eq(gameLogEntry.id, row?.entryId as string))
    .get();
  if (!e) throw new Error("no line");
  const of = (dm: boolean) =>
    formatEntry({
      kind: e.kind,
      actorName: e.actorName,
      payload: e.payload,
      dmPayload: dm ? e.dmPayload : null,
    }).segments;
  return {
    entry: e,
    payload: e.payload as AttackLogPayload,
    dmPayload: e.dmPayload as AttackLogDmPayload,
    dm: of(true),
    players: of(false),
  };
}

describe("FR-MOD-57 Divine Fury line in the combat log", () => {
  test("FR-MOD-57 outcome line part carries expression 1d6+2 + dice; text '+ N radiant (Divine Fury)'; one d6 die segment from payload (players) and dmPayload (DM)", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const offer = furyOf(t, cardId);
    const v = offer?.value as number;
    const { hpChangeIds } = t.applyTo(cardId, [
      { name: "Goblin", triggers: [{ triggerId: t.furyId }] },
    ]);
    const l = line(t, hpChangeIds[0] as string);
    const roll = { expression: "1d6+2", dice: [v - 2] };
    expect(l.payload.parts).toEqual([{ label: "Divine Fury", value: v, type: "radiant", ...roll }]);
    expect(l.dmPayload.parts?.[0]).toMatchObject(roll);
    const die = { faces: 6, value: v - 2, kept: true, label: "Divine Fury" };
    expect(lineText(l.players)).toContain(
      `14 slashing damage + ${v} radiant (Divine Fury) (1d6+2: ${v - 2} + 2)`,
    );
    expect(dice(l.players)).toEqual([die]);
    // The DM's line: the weapon's dice (D5) then the same Divine Fury die.
    expect(dice(l.dm).at(-1)).toEqual(die);
    expect(dice(l.dm).filter((d) => d.label === "Divine Fury")).toHaveLength(1);
  });

  test("FR-MOD-57 the damage roll line's offered die: offered: true, label 'Divine Fury (on a hit)', for players and the DM", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const offer = furyOf(t, cardId);
    const e = t.s.db
      .select()
      .from(gameLogEntry)
      .all()
      .find((x) => x.kind === "roll" && (x.rollIds as string[]).includes(offer?.rollId as string));
    if (!e) throw new Error("no roll line");
    for (const dmPayload of [null, e.dmPayload]) {
      const segs = formatEntry({
        kind: "roll",
        actorName: "Brakka",
        payload: e.payload,
        dmPayload,
      }).segments;
      const offered = dice(segs).filter((d) => d.offered);
      expect(offered).toEqual([
        {
          faces: 6,
          value: (offer?.value as number) - 2,
          kept: true,
          offered: true,
          label: "Divine Fury (on a hit)",
        },
      ]);
      expect(dice(segs).some((d) => d.kept === false)).toBe(false);
    }
  });

  test("FR-MOD-57 DM value edit: players the DM's value only (no expression / dice); the DM's line '(DM set; rolled N)' with the dice", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const v = furyOf(t, cardId)?.value as number;
    const edit = v === 7 ? 8 : 7;
    const { hpChangeIds } = t.applyTo(cardId, [
      { name: "Goblin", triggers: [{ triggerId: t.furyId, value: edit }] },
    ]);
    const l = line(t, hpChangeIds[0] as string);
    expect(l.payload.parts).toEqual([{ label: "Divine Fury", value: edit, type: "radiant" }]);
    expect(dice(l.players)).toEqual([]);
    expect(lineText(l.dm)).toContain(
      `+ ${edit} radiant (Divine Fury) (DM set; rolled ${v}) (1d6+2: ${v - 2} + 2)`,
    );
  });

  test("FR-MOD-57 a non-public character trigger: payload part without expression / dice; the DM's line has the die", () => {
    const t = raging();
    t.s.db.update(ruleTrigger).set({ public: false }).where(eq(ruleTrigger.id, t.furyId)).run();
    const { cardId } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const v = furyOf(t, cardId)?.value as number;
    const { hpChangeIds } = t.applyTo(cardId, [
      { name: "Goblin", triggers: [{ triggerId: t.furyId }] },
    ]);
    const l = line(t, hpChangeIds[0] as string);
    expect(l.payload.parts).toEqual([{ label: null, value: v, type: "radiant" }]);
    expect(dice(l.players)).toEqual([]);
    expect(lineText(l.players)).toContain(`+ ${v} radiant (DM)`);
    expect(dice(l.dm).filter((d) => d.label === "Divine Fury")).toEqual([
      { faces: 6, value: v - 2, kept: true, label: "Divine Fury" },
    ]);
  });

  test("FR-MOD-57 Martial Advantage (monster) marked public: players '+ N Martial Advantage' with no expression / dice / die segment; the DM sees its dice; leak scan per player, snapshot and live", () => {
    const t = rtSetup();
    t.run("map.setTokenHidden", { tokenId: t.tokens.elite, hidden: false });
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
    t.s.db.update(ruleTrigger).set({ public: true }).where(eq(ruleTrigger.id, ma)).run();
    t.nextTo("Elite Goblin Warrior", 1);
    const elite = t.attack("Elite Goblin Warrior", { damage: 5 }).cardId;
    const offer = t.card(elite).damage?.triggers?.find((x) => x.triggerId === ma);
    const v = offer?.value as number;
    const p = t.card(elite);
    // The DM's card made public (FR-CBT-24): the line reaches players.
    const { hpChangeIds } = t.run<{ hpChangeIds: string[] }>(applyCard.name, {
      cardId: elite,
      toHitTotal: p.toHit?.total,
      damageTotal: p.damage?.total,
      public: true,
      targets: [
        { targetId: t.id("Thorn"), hit: true, multiplier: "normal", triggers: [{ triggerId: ma }] },
      ],
    });
    const l = line(t, hpChangeIds[0] as string);
    expect(l.entry.public).toBe(true);
    expect(l.payload.parts).toEqual([{ label: "Martial Advantage", value: v, type: null }]);
    expect(lineText(l.players)).toContain(`+ ${v} Martial Advantage`);
    expect(dice(l.players)).toEqual([]);
    expect(l.dmPayload.parts?.[0]?.expression).toBe("2d6");
    expect(dice(l.dm).filter((d) => d.label === "Martial Advantage")).toHaveLength(2);

    const src = sourceOf(t.s);
    const changes = t.events.flatMap((e) => e.event.changes);
    for (const playerId of [t.h.p1.id, t.h.p2.id]) {
      const viewer = playerViewer(t.h.campaignId, playerId);
      const snapshot = t.s.records.snapshot(src, viewer);
      const live = changes.map((c) => t.s.records.filterChange(c, viewer)).filter(Boolean);
      const json = JSON.stringify([snapshot, live]);
      // The line reaches players, without its dice or roll id.
      expect(json).toContain(`"label":"Martial Advantage","value":${v}`);
      expect(json).not.toContain(offer?.rollId as string);
      expect(json).not.toContain('"expression":"2d6"');
      expect(json).not.toContain("dmPayload");
    }
  });
});
