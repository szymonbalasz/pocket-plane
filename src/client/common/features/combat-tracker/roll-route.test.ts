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
