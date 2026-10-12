import { describe, expect, test } from "bun:test";
import { stepTurn } from "@shared/combat-tracker/rules";
import {
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import type { Actor } from "../../events/types";
import { rollInitiative, setInitiative, setRemoved } from "./initiative";
import { startCommand } from "./lifecycle";
import { readEncounter } from "./rows";
import { combatSetup } from "./testing";
import { nextTurn, prevTurn } from "./turns";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  t.run("dice.setCategoryPublic", { category: "initiative", public: true });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const enc0 = () => readEncounter(t.s.db, enc.id);
  const turn = (dir: "next" | "prev", actor?: Actor) => {
    const e = enc0();
    return t.run(
      dir === "next" ? nextTurn.name : prevTurn.name,
      { encounterId: e.id, expectedRound: e.round, expectedTurnId: e.turnCombatantId },
      actor,
    );
  };
  const set = (name: string, value: number) =>
    t.run(setInitiative.name, { combatantId: id(name), value });
  /** CBT §13 combat-1 order. */
  const standard = () => {
    for (const [n, v] of [
      ["Wolf", 18],
      ["Mira", 15],
      ["Goblin", 12],
      ["Goblin 2", 12],
      ["Thorn", 10],
      ["Elite Goblin Warrior", 8],
    ] as const) {
      set(n, v);
    }
  };
  return { ...t, enc, id, enc0, turn, set, standard };
}

const lastEntries = (t: ReturnType<typeof started>) =>
  (t.events.at(-1)?.event.changes ?? [])
    .filter((c) => c.type === GAME_LOG_ENTRY_TYPE)
    .map((c) => c.after as GameLogEntryRecord);

describe("FR-CBT-11 FR-CBT-12 initiative", () => {
  test("FR-CBT-11 Roll monsters: one roll + entry each; hidden → not public; ranks", () => {
    const t = started();
    const monsters = ["Goblin", "Goblin 2", "Wolf", "Elite Goblin Warrior"].map(t.id);
    const r = t.run<{ rollIds: string[] }>(rollInitiative.name, { combatantIds: monsters });
    expect(r.rollIds).toHaveLength(4);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("InitiativeRolled");
    const entries = lastEntries(t);
    expect(entries.map((e) => [e.actorName, e.public, e.encounterId])).toEqual([
      ["Goblin", true, t.enc.id],
      ["Goblin 2", true, t.enc.id],
      ["Wolf", false, t.enc.id],
      ["Elite Goblin Warrior", false, t.enc.id],
    ]);
    const by = t.byName(t.enc.id);
    expect(by.Goblin?.initiative).toBeGreaterThanOrEqual(3);
    expect(by.Goblin?.initRollId).toBe(r.rollIds[0] as string);
    // Monsters with initiative rank above the PCs without.
    const rolled = Object.values(by).filter((c) => c.initiative !== null);
    expect(Math.max(...rolled.map((c) => c.position))).toBe(4);
    // Players see only the visible monsters' new ranks.
    const v = t.h.viewer("player", t.h.p1.id);
    const wire = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v)).filter(Boolean);
    expect(wire.some((w) => w?.id === by.Wolf?.id)).toBe(false);
    expect(JSON.stringify(wire)).not.toContain("Elite");
  });

  test("FR-CBT-11 player: own PC once, public line; others forbidden; hidden not_found", () => {
    const t = started();
    const r = t.run<{ rollIds: string[] }>(
      rollInitiative.name,
      { combatantIds: [t.id("Mira")], mode: "advantage" },
      t.p1,
    );
    expect(r.rollIds).toHaveLength(1);
    expect(lastEntries(t)[0]).toMatchObject({ public: true, rollerRole: "player" });
    const code = (input: unknown) => t.err(() => t.run(rollInitiative.name, input, t.p1)).code;
    expect(code({ combatantIds: [t.id("Mira")] })).toBe("conflict");
    expect(code({ combatantIds: [t.id("Thorn")] })).toBe("forbidden");
    expect(code({ combatantIds: [t.id("Goblin")] })).toBe("forbidden");
    expect(code({ combatantIds: [t.id("Wolf")] })).toBe("not_found");
    expect(code({ combatantIds: [t.id("Thorn")], public: true })).toBe("forbidden");
    expect(code({ combatantIds: [t.id("Thorn"), t.id("Mira")] })).toBe("forbidden");
    expect(code({ combatantIds: ["nope"] })).toBe("not_found");
    expect(
      t.err(() => t.run(setInitiative.name, { combatantId: t.id("Thorn"), value: 3 }, t.p2)).code,
    ).toBe("forbidden");
  });

  test("FR-CBT-11 manual: exact total; needs exactly one combatant; DM may overwrite", () => {
    const t = started();
    t.run(rollInitiative.name, { combatantIds: [t.id("Mira")], manual: { diceTotal: 13 } });
    expect(t.byName(t.enc.id).Mira?.initiative).toBe(15);
    t.run(rollInitiative.name, { combatantIds: [t.id("Mira")], manual: { diceTotal: 1 } });
    expect(t.byName(t.enc.id).Mira?.initiative).toBe(3);
    const e = t.err(() =>
      t.run(rollInitiative.name, {
        combatantIds: [t.id("Mira"), t.id("Thorn")],
        manual: { diceTotal: 3 },
      }),
    );
    expect(e.code).toBe("invalid");
  });

  test("FR-CBT-12 set initiative: range, no roll, ranks rewritten", () => {
    const t = started();
    t.standard();
    const by = t.byName(t.enc.id);
    expect(
      Object.values(by)
        .sort((a, b) => a.position - b.position)
        .map((c) => [c.name, c.playerPosition]),
    ).toEqual([
      ["Wolf", null],
      ["Mira", 1],
      ["Goblin", 2],
      ["Goblin 2", 3],
      ["Thorn", 4],
      ["Elite Goblin Warrior", null],
    ]);
    expect(by.Wolf?.initRollId).toBeNull();
    expect(t.events.at(-1)?.event.type).toBe("InitiativeSet");
    for (const value of [-11, 51, 1.5]) {
      expect(
        t.err(() => t.run(setInitiative.name, { combatantId: t.id("Mira"), value })).code,
      ).toBe("invalid");
    }
  });
});

describe("FR-CBT-14 FR-CBT-31 FR-CBT-15 turns and removal", () => {
  test("FR-CBT-14 round 0 needs every initiative; then round 1 first; wrap; prev", () => {
    const t = started();
    t.set("Wolf", 18);
    expect(t.err(() => t.turn("next")).message).toBe("5 without initiative");
    t.standard();
    t.turn("next");
    expect(t.enc0()).toMatchObject({ round: 1, turnCombatantId: t.id("Wolf") });
    // FR-CBT-31: Wolf is hidden → no player marker.
    expect(t.enc0().playerTurnCombatantId).toBeNull();
    expect(t.events.at(-1)?.event.payload).toEqual({
      round: 1,
      turnCombatantId: t.id("Wolf"),
      direction: "next",
    });
    expect(t.err(() => t.turn("prev")).code).toBe("conflict");
    t.turn("next");
    expect(t.enc0()).toMatchObject({ turnCombatantId: t.id("Mira") });
    expect(t.enc0().playerTurnCombatantId).toBe(t.id("Mira"));
    for (let i = 0; i < 4; i++) t.turn("next");
    expect(t.enc0()).toMatchObject({ round: 1, turnCombatantId: t.id("Elite Goblin Warrior") });
    t.turn("next");
    expect(t.enc0()).toMatchObject({ round: 2, turnCombatantId: t.id("Wolf") });
    t.turn("prev");
    expect(t.enc0()).toMatchObject({ round: 1, turnCombatantId: t.id("Elite Goblin Warrior") });
  });

  test("FR-CBT-14 expected guard: stale round / turn → conflict (double Next)", () => {
    const t = started();
    t.standard();
    const stale = { encounterId: t.enc.id, expectedRound: 0, expectedTurnId: null };
    t.run(nextTurn.name, stale);
    expect(t.err(() => t.run(nextTurn.name, stale)).code).toBe("conflict");
    expect(t.err(() => t.turn("next", t.p1)).code).toBe("forbidden");
  });

  test("FR-CBT-14 skips removed and monsters at 0 HP; PCs at 0 keep turns", () => {
    const rows = [
      {
        id: "a",
        position: 1,
        kind: "monster" as const,
        removed: false,
        hpCurrent: 0,
        initiative: 9,
      },
      { id: "b", position: 2, kind: "pc" as const, removed: true, hpCurrent: null, initiative: 8 },
      { id: "c", position: 3, kind: "pc" as const, removed: false, hpCurrent: null, initiative: 7 },
      {
        id: "d",
        position: 4,
        kind: "monster" as const,
        removed: false,
        hpCurrent: 3,
        initiative: 6,
      },
    ];
    expect(stepTurn(rows, 0, null, "next")).toEqual({ ok: true, round: 1, turnCombatantId: "c" });
    expect(stepTurn(rows, 1, "c", "next")).toEqual({ ok: true, round: 1, turnCombatantId: "d" });
    expect(stepTurn(rows, 1, "d", "next")).toEqual({ ok: true, round: 2, turnCombatantId: "c" });
    expect(stepTurn(rows, 2, "c", "prev")).toEqual({ ok: true, round: 1, turnCombatantId: "d" });
    // Removed combatants need no initiative for round 1.
    const noInit = rows.map((r) => (r.id === "b" ? { ...r, initiative: null } : r));
    expect(stepTurn(noInit, 0, null, "next").ok).toBe(true);
  });

  test("FR-CBT-14 initiative change keeps the turn on the same combatant", () => {
    const t = started();
    t.standard();
    t.turn("next");
    t.turn("next");
    t.set("Mira", 1);
    expect(t.enc0().turnCombatantId).toBe(t.id("Mira"));
    t.turn("next");
    expect(t.enc0()).toMatchObject({ round: 2, turnCombatantId: t.id("Wolf") });
  });

  test("FR-CBT-15 FR-CBT-31 remove: player delete, ranks + turn copy; restore", () => {
    const t = started();
    t.standard();
    t.turn("next");
    t.turn("next"); // Mira's turn
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: true });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("CombatantRemoved");
    expect(t.enc0().playerTurnCombatantId).toBeNull();
    const v = t.h.viewer("player", t.h.p2.id);
    const wire = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v));
    expect(wire).toContainEqual({ type: COMBATANT_TYPE, id: t.id("Mira"), op: "delete" });
    expect(wire.some((w) => w?.type === ENCOUNTER_TYPE)).toBe(true);
    expect(t.byName(t.enc.id).Goblin?.playerPosition).toBe(1);
    t.turn("next");
    expect(t.enc0().turnCombatantId).toBe(t.id("Goblin"));
    // Removed: player can't see it; restore brings it back.
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: false });
    expect(t.events.at(-1)?.event.type).toBe("CombatantRestored");
    expect(t.byName(t.enc.id).Mira?.playerPosition).toBe(1);
    // Unchanged → no event.
    const n = t.events.length;
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: false });
    expect(t.events.length).toBe(n);
  });

  test("FR-CBT-31 reveal of the turn combatant sets the player turn copy (token hook)", () => {
    const t = started();
    t.standard();
    t.turn("next");
    expect(t.enc0().playerTurnCombatantId).toBeNull();
    t.run("map.setTokenHidden", { tokenId: t.tokens.wolf, hidden: false });
    const e: EncounterRecord = t.enc0();
    expect(e.playerTurnCombatantId).toBe(t.id("Wolf"));
    const ev = t.events.at(-1)?.event;
    expect(ev?.changes.some((c) => c.type === ENCOUNTER_TYPE)).toBe(true);
  });
});
