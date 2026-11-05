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

  test("FR-DICE-22 FR-MIR-06 a token no player sees: a seen Visible or Transparent mirror un-forces the switch; a Shadow, a Hidden, a fogged or a held-back mirror doesn't", () => {
    const fogged = [tok("t1", { fogged: true })];
    const mir = (over: Partial<NonNullable<RollBarGuardInput["mirrors"]>[number]> = {}) => ({
      tokenId: "t1",
      mode: "visible" as const,
      suppressed: false,
      fogged: false,
      ...over,
    });
    const g = (mirrors: RollBarGuardInput["mirrors"]) =>
      rollBarGuarded(base({ ref: { tokenId: "t1" }, tokens: fogged, mirrors }));
    expect(g([])).toBe(true);
    expect(g([mir()])).toBe(false);
    expect(g([mir({ mode: "transparent" })])).toBe(false);
    // #442: a mirror no player has sight to doesn't count, Transparent too.
    expect(g([mir({ mode: "transparent", fogged: true })])).toBe(true);
    expect(g([mir({ fogged: true })])).toBe(true);
    expect(g([mir({ mode: "shadow" })])).toBe(true);
    expect(g([mir({ mode: "hidden" })])).toBe(true);
    expect(g([mir({ mode: "transparent", suppressed: true })])).toBe(true);
    // Another token's mirror doesn't count; the definition roll reads its tokens too.
    expect(g([mir({ tokenId: "t9" })])).toBe(true);
    expect(
      rollBarGuarded(base({ ref: { entityId: "gob" }, tokens: fogged, mirrors: [mir()] })),
    ).toBe(false);
    // In a fight: the bound combatant's `hidden` copies its fogged token's (FR-FOG-14); the
    // token decides. Out of the fight (`active` off) still hides it.
    const bound = [fighter("c1", { tokenId: "t1", name: "Goblin", hidden: true })];
    const c = (over: Partial<RollBarGuardInput>) =>
      rollBarGuarded(
        base({ ref: { combatantId: "c1" }, tokens: fogged, combatants: bound, ...over }),
      );
    expect(c({})).toBe(true);
    expect(c({ mirrors: [mir()] })).toBe(false);
    expect(c({ mirrors: [mir({ mode: "shadow" })] })).toBe(true);
    expect(
      c({ mirrors: [mir()], combatants: [{ ...(bound[0] as CombatantRecord), active: false }] }),
    ).toBe(true);
  });

  test("FR-DICE-22 the definitions it needs: the token's, the combatant's entity, the ref's", () => {
    const input = base({});
    expect(rollBarGuardIds({ ...input, ref: { tokenId: "t1" } })).toEqual(["gob"]);
    expect(rollBarGuardIds({ ...input, ref: { combatantId: "c1" } })).toEqual(["gob"]);
    expect(rollBarGuardIds({ ...input, ref: { entityId: "mira" } })).toEqual(["mira"]);
    expect(rollBarGuardIds({ ...input, ref: undefined })).toEqual([]);
  });
});
