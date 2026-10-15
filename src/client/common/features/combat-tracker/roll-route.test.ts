import { describe, expect, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { rollRoutes } from "../character-sheet/roll-routes";
import { routeFor } from "../character-sheet/routing";

function store(
  combatant: Record<string, unknown> | null,
  status = "started",
  round = 1,
): RecordStore {
  return {
    ...emptyStore(),
    records: {
      encounter: { e1: { id: "e1", status, round, playerTurnCombatantId: null } },
      combatant: combatant ? { [combatant.id as string]: combatant } : {},
      entity: {
        mira: {
          id: "mira",
          kind: "character",
          statBlock: { attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2" }] },
        },
      },
    },
  };
}

const mira = {
  id: "cb-mira",
  encounterId: "e1",
  kind: "pc",
  entityId: "mira",
  name: "Mira",
  playerPosition: 1,
  initiative: null,
};

describe("FR-CBT-30 sheet roll routing", () => {
  test("FR-CBT-30 active combatant: Attack → cbt.attack (no public, doubled crit), Initiative → cbt.rollInitiative", async () => {
    const sent: [string, unknown][] = [];
    const send = (n: string, p: unknown) => {
      sent.push([n, p]);
      return Promise.resolve(null);
    };
    const attack = routeFor(rollRoutes, store(mira), "mira", "attack");
    expect(attack?.badge).toBe("In combat");
    expect(attack?.critExpressions).toEqual(["2d6+2"]);
    await attack?.send(send, {
      mode: "advantage",
      manual: [{ diceTotal: 20 }, { diceTotal: 9 }],
      public: true,
    });
    const init = routeFor(rollRoutes, store(mira), "mira", "initiative");
    await init?.send(send, { mode: "normal", manual: [{ diceTotal: 12 }] });
    expect(sent).toEqual([
      [
        "cbt.attack",
        {
          attackerId: "cb-mira",
          mode: "advantage",
          manual: [{ diceTotal: 20 }, { diceTotal: 9 }],
        },
      ],
      [
        "cbt.rollInitiative",
        { combatantIds: ["cb-mira"], mode: "normal", manual: { diceTotal: 12 } },
      ],
    ]);
  });

  test("FR-CBT-30 not in combat (no started encounter, removed, inactive, not in store) → char.roll", () => {
    expect(routeFor(rollRoutes, store(mira, "ended"), "mira", "attack")).toBeNull();
    expect(routeFor(rollRoutes, store({ ...mira, removed: true }), "mira", "attack")).toBeNull();
    expect(routeFor(rollRoutes, store({ ...mira, active: false }), "mira", "attack")).toBeNull();
    expect(routeFor(rollRoutes, store(null), "mira", "attack")).toBeNull();
    expect(routeFor(rollRoutes, store(mira), "thorn", "attack")).toBeNull();
  });

  test("FR-CBT-45 checks and saves are never claimed: char.roll even in combat", () => {
    expect(routeFor(rollRoutes, store(mira), "mira", "check")).toBeNull();
    expect(routeFor(rollRoutes, store(mira), "mira", "save")).toBeNull();
    expect(routeFor(rollRoutes, store(mira), "mira", "initiative")).not.toBeNull();
  });

  test("FR-CBT-46 route answers hidden iff round ≥ 1 and initiative set; Attack never hidden", () => {
    const set = { ...mira, initiative: 15 };
    const hidden = (s: RecordStore, kind: "initiative" | "attack" = "initiative") =>
      routeFor(rollRoutes, s, "mira", kind)?.hidden ?? false;
    expect(hidden(store(set, "started", 0))).toBe(false);
    expect(hidden(store(set, "started", 1))).toBe(true);
    expect(hidden(store(set, "started", 4))).toBe(true);
    expect(hidden(store(mira, "started", 1))).toBe(false);
    expect(hidden(store(set, "started", 1), "attack")).toBe(false);
    // The badge stays while hidden.
    expect(routeFor(rollRoutes, store(set), "mira", "initiative")?.badge).toBe("In combat");
  });
});

describe("FR-CHARX-24 OQ-CBT-47 routes with a row ref", () => {
  const spell = (id: string, o: object) => ({
    id,
    name: id,
    level: 1,
    prepared: true,
    concentration: false,
    ritual: false,
    roll: "attack",
    effect: "damage",
    notes: "",
    ...o,
  });
  function sheetStore(combatant: Record<string, unknown> | null = mira): RecordStore {
    const s = store(combatant);
    return {
      ...s,
      records: {
        ...s.records,
        entity: {
          mira: {
            id: "mira",
            kind: "character",
            statBlock: {
              initBonus: 2,
              abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 10 },
              level: 1,
              spellcasting: { ability: "wis", slots: {} },
              attacks: [
                { id: "a1", name: "Shortsword", toHit: 4, damage: "1d6+2" },
                { id: "a2", name: "Light crossbow", toHit: 4, damage: "1d8+2" },
              ],
            },
          },
        },
        "creature-sheet": {
          mira: {
            id: "mira",
            entityId: "mira",
            spells: [
              spell("bolt", { damage: "4d6", damageType: "radiant" }),
              spell("touch", {}),
              spell("flame", { roll: "save", saveAbility: "dex", damage: "1d8" }),
              spell("cure", { roll: "none", effect: "healing", damage: "1d8+1" }),
            ],
          },
        },
      },
    };
  }
  const sent: [string, unknown][] = [];
  const send = (n: string, p: unknown) => {
    sent.push([n, p]);
    return Promise.resolve(null);
  };

  test("FR-CHARX-24 any attack row: cbt.attack with attackId, crit from that row", async () => {
    sent.length = 0;
    const claim = routeFor(rollRoutes, sheetStore(), "mira", "attack", { attackId: "a2" });
    expect(claim?.critExpressions).toEqual(["2d8+2"]);
    await claim?.send(send, { mode: "normal", manual: [{ diceTotal: 11 }, { diceTotal: 5 }] });
    // No ref (QuickActions' first attack) → no id: the server's first attack.
    await routeFor(rollRoutes, sheetStore(), "mira", "attack")?.send(send, { mode: "advantage" });
    expect(sent).toEqual([
      [
        "cbt.attack",
        {
          attackerId: "cb-mira",
          mode: "normal",
          manual: [{ diceTotal: 11 }, { diceTotal: 5 }],
          attackId: "a2",
        },
      ],
      ["cbt.attack", { attackerId: "cb-mira", mode: "advantage" }],
    ]);
  });

  test("FR-CHARX-24 spellAttack with damage → cbt.attack with spellId; without damage → not claimed", async () => {
    sent.length = 0;
    const claim = routeFor(rollRoutes, sheetStore(), "mira", "spellAttack", { spellId: "bolt" });
    expect(claim?.badge).toBe("In combat");
    expect(claim?.critExpressions).toEqual(["8d6"]);
    await claim?.send(send, { mode: "normal", public: true });
    expect(sent).toEqual([
      ["cbt.attack", { attackerId: "cb-mira", mode: "normal", spellId: "bolt" }],
    ]);
    expect(
      routeFor(rollRoutes, sheetStore(), "mira", "spellAttack", { spellId: "touch" }),
    ).toBeNull();
    expect(
      routeFor(rollRoutes, sheetStore(), "mira", "spellAttack", { spellId: "gone" }),
    ).toBeNull();
    expect(routeFor(rollRoutes, sheetStore(), "mira", "spellAttack")).toBeNull();
  });

  test("FR-CBT-74 skill, check, save and healing are never claimed", () => {
    const s = sheetStore();
    expect(routeFor(rollRoutes, s, "mira", "skill")).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "check")).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "save")).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "spellDamage", { spellId: "cure" })).toBeNull();
  });

  test("FR-CBT-74 in combat: toHit / damage / attack → cbt.attack {rolls: toHit}, cbt.rollDamage, cbt.attack", async () => {
    sent.length = 0;
    const s = sheetStore();
    const ref = { attackId: "a2" };
    const hit = routeFor(rollRoutes, s, "mira", "toHit", ref);
    expect(hit?.critExpressions).toBeUndefined();
    await hit?.send(send, { mode: "advantage", manual: [{ diceTotal: 11 }] });
    const dmg = routeFor(rollRoutes, s, "mira", "damage", ref);
    expect(dmg?.critExpressions).toBeUndefined();
    await dmg?.send(send, { mode: "normal", manual: [{ diceTotal: 5 }], public: true });
    await routeFor(rollRoutes, s, "mira", "attack", ref)?.send(send, { mode: "normal" });
    expect(sent).toEqual([
      [
        "cbt.attack",
        {
          attackerId: "cb-mira",
          mode: "advantage",
          rolls: "toHit",
          manual: [{ diceTotal: 11 }],
          attackId: "a2",
        },
      ],
      ["cbt.rollDamage", { attackerId: "cb-mira", manual: { diceTotal: 5 }, attackId: "a2" }],
      ["cbt.attack", { attackerId: "cb-mira", mode: "normal", attackId: "a2" }],
    ]);
  });

  test("FR-CBT-74 spells: spellToHit only with damage; spellDamage for attack and save spells", async () => {
    sent.length = 0;
    const s = sheetStore();
    const hit = routeFor(rollRoutes, s, "mira", "spellToHit", { spellId: "bolt" });
    await hit?.send(send, { mode: "normal" });
    expect(routeFor(rollRoutes, s, "mira", "spellToHit", { spellId: "touch" })).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "spellToHit", { spellId: "flame" })).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "spellAttack", { spellId: "flame" })).toBeNull();
    await routeFor(rollRoutes, s, "mira", "spellDamage", { spellId: "flame" })?.send(send, {
      mode: "normal",
    });
    expect(routeFor(rollRoutes, s, "mira", "spellDamage", { spellId: "touch" })).toBeNull();
    expect(sent).toEqual([
      ["cbt.attack", { attackerId: "cb-mira", mode: "normal", rolls: "toHit", spellId: "bolt" }],
      ["cbt.rollDamage", { attackerId: "cb-mira", spellId: "flame" }],
    ]);
  });

  test("FR-CBT-74 Damage after a pending natural-20 to-hit card of that row → crit expressions", () => {
    const card = (id: string, seq: number, natural: number, o: object = {}) => ({
      id,
      seq,
      kind: "damage-card",
      state: "pending",
      payload: {
        encounterId: "e1",
        attackerId: "cb-mira",
        attackerName: "Mira",
        attackName: "Light crossbow",
        damageType: "piercing",
        mode: "normal",
        crit: natural === 20,
        toHit: {
          rollId: "r",
          dice: [[natural, true]],
          constant: 4,
          total: natural + 4,
          natural,
          manual: false,
        },
        damage: null,
        attackId: "a2",
        ...o,
      },
    });
    const withCards = (...cards: ReturnType<typeof card>[]) => {
      const s = sheetStore();
      return {
        ...s,
        records: { ...s.records, notification: Object.fromEntries(cards.map((c) => [c.id, c])) },
      };
    };
    const crit = (
      s: RecordStore,
      ref: { attackId?: string; spellId?: string } = { attackId: "a2" },
    ) =>
      routeFor(rollRoutes, s, "mira", ref.spellId ? "spellDamage" : "damage", ref as never)
        ?.critExpressions;
    expect(crit(withCards(card("n1", 1, 20)))).toEqual(["2d8+2"]);
    expect(
      routeFor(rollRoutes, withCards(card("n1", 1, 20)), "mira", "damage", { attackId: "a2" })
        ?.crit,
    ).toBe(true);
    // The latest pending one decides; another row's or a resolved card doesn't count.
    expect(crit(withCards(card("n1", 1, 20), card("n2", 2, 12)))).toBeUndefined();
    expect(crit(withCards(card("n1", 1, 20)), { attackId: "a1" })).toBeUndefined();
    expect(crit(withCards({ ...card("n1", 1, 20), state: "resolved" }))).toBeUndefined();
    expect(
      crit(withCards(card("n1", 1, 20, { attackId: undefined, spellId: "bolt" })), {
        spellId: "bolt",
      }),
    ).toEqual(["8d6"]);
    // No ref = the first attack (a1).
    expect(crit(withCards(card("n1", 1, 20, { attackId: "a1" })), {})).toEqual(["2d6+2"]);
  });

  test("FR-CHAR-24 OQ-CBT-28 a PC hidden from its owner (no combatant in the store): rows stay char.roll", () => {
    const s = sheetStore(null);
    expect(routeFor(rollRoutes, s, "mira", "attack", { attackId: "a2" })).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "spellAttack", { spellId: "bolt" })).toBeNull();
    expect(routeFor(rollRoutes, s, "mira", "initiative")).toBeNull();
    // Not in combat at all → plain char.roll too.
    expect(
      routeFor(rollRoutes, sheetStore({ ...mira, removed: true }), "mira", "attack", {
        attackId: "a1",
      }),
    ).toBeNull();
  });

  test("FR-CHAR-24 FR-CBT-46 an attack row is never hidden; the hidden Initiative answer is unchanged", () => {
    const set = sheetStore({ ...mira, initiative: 15 });
    expect(routeFor(rollRoutes, set, "mira", "attack", { attackId: "a2" })?.hidden).toBeUndefined();
    expect(
      routeFor(rollRoutes, set, "mira", "spellAttack", { spellId: "bolt" })?.hidden,
    ).toBeUndefined();
    expect(routeFor(rollRoutes, set, "mira", "initiative")?.hidden).toBe(true);
  });
});
