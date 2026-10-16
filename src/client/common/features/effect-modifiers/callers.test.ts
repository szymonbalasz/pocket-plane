// FR-MOD-18 / -27 (R2): roll callers pass the control's `manualParts` on their intent and the
// combat route marks card rolls for the preview (`claim.card`).
import { describe, expect, test } from "bun:test";
import type { ManualPart } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { rollRoutes } from "../character-sheet/roll-routes";
import { charRollPayload, routeFor } from "../character-sheet/routing";
import { manualPartsOf } from "../dice-roll-log/roll-control";

const bless: ManualPart = { key: "e:fx-bless", entry: { diceTotal: 3 } };
const fury: ManualPart = { key: "t:trg-df", entry: { diceTotal: 4 } };

function store(notes: Record<string, unknown> = {}): RecordStore {
  return {
    ...emptyStore(),
    records: {
      encounter: { e1: { id: "e1", status: "started", round: 1, playerTurnCombatantId: null } },
      combatant: {
        "cb-brakka": {
          id: "cb-brakka",
          encounterId: "e1",
          kind: "pc",
          entityId: "brakka",
          name: "Brakka",
          initiative: null,
        },
      },
      entity: {
        brakka: {
          id: "brakka",
          kind: "character",
          statBlock: { attacks: [{ id: "a1", name: "Greataxe", toHit: 7, damage: "1d12+4" }] },
        },
      },
      notification: notes,
    },
  };
}

describe("FR-MOD-18 callers pass manualParts", () => {
  test("FR-MOD-18 char.roll: one list per manual entry", () => {
    const input = {
      mode: "normal" as const,
      manual: [{ diceTotal: 15 }, { diceTotal: 8 }],
      manualParts: [[bless], []],
    };
    expect(charRollPayload("mira", "attack", input)).toEqual({
      characterId: "mira",
      kind: "attack",
      mode: "normal",
      manual: input.manual,
      manualParts: [[bless], []],
    });
  });

  test("FR-MOD-18 combat route: cbt.attack gets the lists, cbt.rollDamage / rollInitiative the first", async () => {
    const sent: [string, unknown][] = [];
    const send = (n: string, p: unknown) => {
      sent.push([n, p]);
      return Promise.resolve(null);
    };
    const s = store();
    const ref = { attackId: "a1" };
    await routeFor(rollRoutes, s, "brakka", "attack", ref)?.send(send, {
      mode: "normal",
      manual: [{ diceTotal: 15 }, { diceTotal: 8 }],
      manualParts: [[], [fury]],
    });
    await routeFor(rollRoutes, s, "brakka", "damage", ref)?.send(send, {
      mode: "normal",
      manual: [{ diceTotal: 8 }],
      manualParts: [[fury]],
    });
    await routeFor(rollRoutes, s, "brakka", "initiative")?.send(send, {
      mode: "normal",
      manual: [{ diceTotal: 12 }],
      manualParts: [[]],
    });
    expect(sent.map(([n, p]) => [n, (p as { manualParts?: unknown }).manualParts])).toEqual([
      ["cbt.attack", [[], [fury]]],
      ["cbt.rollDamage", [fury]],
      ["cbt.rollInitiative", []],
    ]);
  });

  test("FR-MOD-27 combat claims mark card rolls; Damage reads the pending card's to-hit mode", () => {
    const pending = {
      n1: {
        id: "n1",
        kind: "damage-card",
        state: "pending",
        seq: 1,
        payload: {
          encounterId: "e1",
          attackerId: "cb-brakka",
          attackerName: "Brakka",
          attackId: "a1",
          attackName: "Greataxe",
          mode: "advantage",
          crit: false,
          damageType: "slashing",
          toHit: {
            rollId: "r",
            dice: [
              [12, true],
              [3, false],
            ],
            constant: 7,
            total: 19,
            natural: 12,
            manual: false,
          },
          damage: null,
        },
      },
    };
    const ref = { attackId: "a1" };
    expect(routeFor(rollRoutes, store(), "brakka", "attack", ref)?.card).toEqual({});
    const dmg = routeFor(rollRoutes, store(pending), "brakka", "damage", ref);
    expect(dmg?.card).toEqual({ toHitMode: "advantage" });
    expect(routeFor(rollRoutes, store(), "brakka", "initiative")?.card).toBeUndefined();
  });

  test("FR-MOD-18 manualPartsOf: a single-roll intent's list, or nothing", () => {
    expect(manualPartsOf({ mode: "normal", manualParts: [[bless]] })).toEqual({
      manualParts: [bless],
    });
    expect(manualPartsOf({ mode: "normal" })).toEqual({});
  });
});
