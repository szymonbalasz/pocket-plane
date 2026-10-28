// FR-DICE-22 (sprint 14 F3): the roll bar's forced-off public switch, from the server's roll guard
// rule (FR-DICE-13, `@shared/dice-roll-log/roll-guard`) over the DM's store.
import { describe, expect, test } from "bun:test";
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import type { TokenView } from "@shared/scenes-map/schemas";
import { type RollBarGuardInput, rollBarGuarded, rollBarGuardIds } from "./roll-guard";

const tok = (id: string, over: Partial<TokenView & { fogged: true }> = {}) =>
  ({
    id,
    sceneId: "s1",
    name: "Goblin",
    definitionId: "gob",
    ownerPlayerId: null,
    characterId: null,
    hidden: false,
    ...over,
  }) as TokenView & { fogged?: true };

const fighter = (id: string, over: Partial<CombatantRecord> = {}) =>
  ({
    id,
    encounterId: "e1",
    entityId: "gob",
    kind: "monster",
    name: "Goblin 3",
    ownerPlayerId: null,
    tokenId: null,
    hidden: false,
    active: true,
    ownerHidden: false,
    ...over,
  }) as CombatantRecord;

const base = (over: Partial<RollBarGuardInput>): RollBarGuardInput => ({
  ref: undefined,
  tokens: [tok("t1")],
  combatants: [fighter("c1")],
  encounters: [{ id: "e1", status: "started" }],
  scenes: [
    { id: "s1", active: true },
    { id: "s2", active: false },
  ],
  definitions: new Map([
    ["gob", { name: "Goblin", kind: "monster" as const }],
    ["mira", { name: "Mira", kind: "character" as const }],
  ]),
  ...over,
});

describe("FR-DICE-22 roll bar guard", () => {
  test("FR-DICE-22 FR-DICE-13 the public switch is forced off for a hidden or renamed monster token on the shown scene; not for a visible or numbered one, a character or the DM", () => {
    const g = (over: Partial<RollBarGuardInput>) => rollBarGuarded(base(over));
    expect(g({ ref: { tokenId: "t1" } })).toBe(false);
    expect(g({ ref: { tokenId: "t1" }, tokens: [tok("t1", { name: "Goblin 2" })] })).toBe(false);
    expect(g({ ref: { tokenId: "t1" }, tokens: [tok("t1", { hidden: true })] })).toBe(true);
    // Fogged for every player (the DM's `fogged`); an owned token's fog is its static copy.
    expect(g({ ref: { tokenId: "t1" }, tokens: [tok("t1", { fogged: true })] })).toBe(true);
    expect(
      g({ ref: { tokenId: "t1" }, tokens: [tok("t1", { fogged: true, ownerPlayerId: "p1" })] }),
    ).toBe(false);
    // Renamed ("Big Bob" isn't "Goblin" numbered).
    expect(g({ ref: { tokenId: "t1" }, tokens: [tok("t1", { name: "Big Bob" })] })).toBe(true);
    // #371: hidden on a scene players aren't shown doesn't count.
    expect(
      g({ ref: { tokenId: "t1" }, tokens: [tok("t1", { hidden: true, sceneId: "s2" })] }),
    ).toBe(false);
    expect(g({ ref: { entityId: "mira" } })).toBe(false);
    expect(g({ ref: undefined })).toBe(false);
  });

  test("FR-DICE-22 FR-DICE-34 a token-less combatant: hidden or renamed → forced off; a definition not loaded yet → not (the server still guards)", () => {
    const g = (over: Partial<RollBarGuardInput>) => rollBarGuarded(base(over));
    expect(g({ ref: { combatantId: "c1" } })).toBe(false);
    expect(g({ ref: { combatantId: "c1" }, combatants: [fighter("c1", { hidden: true })] })).toBe(
      true,
    );
    expect(
      g({ ref: { combatantId: "c1" }, combatants: [fighter("c1", { name: "Snaggle" })] }),
    ).toBe(true);
    expect(g({ ref: { combatantId: "c1" }, definitions: new Map() })).toBe(false);
  });

  test("FR-DICE-22 the definitions it needs: the token's, the combatant's entity, the ref's", () => {
    const input = base({});
    expect(rollBarGuardIds({ ...input, ref: { tokenId: "t1" } })).toEqual(["gob"]);
    expect(rollBarGuardIds({ ...input, ref: { combatantId: "c1" } })).toEqual(["gob"]);
    expect(rollBarGuardIds({ ...input, ref: { entityId: "mira" } })).toEqual(["mira"]);
    expect(rollBarGuardIds({ ...input, ref: undefined })).toEqual([]);
  });
});
