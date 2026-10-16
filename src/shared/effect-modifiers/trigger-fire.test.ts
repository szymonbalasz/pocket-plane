// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Pure firing rules (FR-MOD-35–37, -42): owner values, windows, origin match, hard filters and
// the popup's settle facts.
import { describe, expect, test } from "bun:test";
import type { StatBlock } from "@shared/entities/schemas";
import { formulaValue } from "./formula";
import {
  type FireFacts,
  formulaOwnerOf,
  ownerFiltersPass,
  presetKeysMatch,
  requiresMet,
  settleFacts,
  targetMarkedBy,
  windowKey,
} from "./trigger-fire";
import { TRIGGER_PRESETS } from "./trigger-presets";
import type { TriggerRule } from "./triggers";

const brakka = {
  size: "medium",
  ac: 14,
  hpMax: 55,
  initBonus: 1,
  speed: 30,
  attacks: [],
  abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 12, cha: 10 },
  level: 5,
  className: "Barbarian",
  classes: [{ name: "Barbarian", level: 5, hitDie: "d12" }],
} as unknown as StatBlock;
const thorn = { ...brakka, classes: undefined, className: "Rogue", level: 5 } as StatBlock;
const elite = {
  size: "small",
  ac: 16,
  hpMax: 15,
  initBonus: 2,
  speed: 30,
  attacks: [],
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 8, cha: 8 },
  cr: "1/2",
} as unknown as StatBlock;

const facts = (o: Partial<FireFacts> = {}): FireFacts => ({
  subject: { creature: { characterId: "c" }, roll: "damage", via: "weapon", card: true },
  ownTurn: true,
  mode: "normal",
  ...o,
});
const sneak = TRIGGER_PRESETS.find((p) => p.key === "sneak-attack")?.rule as TriggerRule;

describe("FR-MOD-35 owner context", () => {
  test("FR-MOD-35 character: level, level(<class>) (classes, else className), prof, ability mods; definition: cr rounded down, prof by CR, level 0", () => {
    expect(formulaOwnerOf(brakka)).toEqual({
      level: 5,
      classes: [{ name: "Barbarian", level: 5 }],
      prof: 3,
      abilities: { str: 4, dex: 1, con: 3, int: -1, wis: 1, cha: 0 },
    });
    expect(formulaOwnerOf(thorn).classes).toEqual([{ name: "Rogue", level: 5 }]);
    expect(formulaOwnerOf(elite)).toMatchObject({ level: 0, cr: 0, prof: 2 });
    const v = (f: string, s: StatBlock) => {
      const r = formulaValue(f, formulaOwnerOf(s));
      return r.ok ? r.value.expression : r.error.message;
    };
    expect(v("1d6 + floor(level(barbarian) / 2)", brakka)).toBe("1d6+2");
    expect(v("(ceil(level(rogue) / 2))d6", thorn)).toBe("3d6");
    expect(v("2d6 + str + prof", elite)).toBe("2d6+4");
  });
});

describe("FR-MOD-42 windows", () => {
  test("FR-MOD-42 key per every: turn / each t:<round>:<turn>, round r:<round>, encounter e, feature f", () => {
    const now = { round: 2, turnCombatantId: "brakka" };
    expect(windowKey("turn", now)).toBe("t:2:brakka");
    expect(windowKey("each", now)).toBe("t:2:brakka");
    expect(windowKey("round", now)).toBe("r:2");
    expect(windowKey("encounter", now)).toBe("e");
    expect(windowKey({ feature: "row" }, now)).toBe("f");
    expect(windowKey("turn", { round: 0, turnCombatantId: null })).toBe("t:0:-");
  });
});

describe("FR-MOD-36 origin match", () => {
  test("FR-MOD-36 requires preset id ↔ built-in rage both ways; unrelated key no match", () => {
    const originOf = (k: string) => (k === "p-rage" ? "rage" : null);
    expect(presetKeysMatch("p-rage", "rage", originOf)).toBe(true);
    expect(presetKeysMatch("rage", "p-rage", originOf)).toBe(true);
    expect(presetKeysMatch("bless", "p-rage", originOf)).toBe(false);
    expect(requiresMet({ requires: { preset: "p-rage" } }, ["bless", "rage"], originOf)).toBe(true);
    expect(requiresMet({ requires: { preset: "rage" } }, [null, "bless"], originOf)).toBe(false);
    expect(requiresMet({}, [], originOf)).toBe(true);
  });
});

describe("FR-MOD-37 filters and settle facts", () => {
  test("FR-MOD-37 hard owner-side filters: via, row, ownTurn, crit, hard mode; soft / target-side never gate", () => {
    const rule = (when: TriggerRule["when"]) => ({ when });
    expect(ownerFiltersPass(rule([{ if: "via", via: "weapon" }]), facts())).toBe(true);
    expect(ownerFiltersPass(rule([{ if: "via", via: "spell" }]), facts())).toBe(false);
    expect(ownerFiltersPass(rule([{ if: "ownTurn" }]), facts({ ownTurn: false }))).toBe(false);
    expect(ownerFiltersPass(rule([{ if: "crit" }]), facts())).toBe(false);
    const row = rule([{ if: "row", names: ["Greataxe"] }]);
    expect(ownerFiltersPass(row, facts())).toBe(false);
    const s = facts().subject;
    expect(ownerFiltersPass(row, facts({ subject: { ...s, row: " greataxe" } }))).toBe(true);
    expect(ownerFiltersPass(sneak, facts({ mode: "disadvantage" }))).toBe(false);
    expect(ownerFiltersPass(sneak, facts({ mode: "normal" }))).toBe(true);
    expect(
      ownerFiltersPass(rule([{ if: "targetHurt" }, { if: "targetMarked", preset: "x" }]), facts()),
    ).toBe(true);
  });

  test("FR-MOD-37 settle facts: soft tick table (adv ticked, normal unticked, ask only unticked); marked / hurt / ask", () => {
    expect(settleFacts(sneak, facts({ mode: "advantage" }))).toEqual({
      ask: "finesse or ranged; or an ally within 5 ft",
    });
    expect(settleFacts(sneak, facts({ mode: "normal" }))).toMatchObject({ untick: true });
    const ask: TriggerRule["when"] = [{ if: "ask", note: "an ally within 5 ft of the target" }];
    expect(settleFacts({ when: ask }, facts())).toEqual({
      ask: "an ally within 5 ft of the target",
      untick: true,
    });
    expect(
      settleFacts(
        { when: [{ if: "targetMarked", preset: "hunters-mark" }, { if: "targetHurt" }] },
        facts(),
      ),
    ).toEqual({ marked: "hunters-mark", hurt: true });
    expect(settleFacts({ when: [] }, facts())).toEqual({});
  });
});

describe("FR-MOD-05 / -39 marks: target-side `marked`", () => {
  const fx = (o: Partial<Parameters<typeof targetMarkedBy>[0][number]>) => ({
    targetCombatantId: null,
    targetCharacterId: null,
    sourceCombatantId: "k-thorn",
    presetKey: "hunters-mark",
    endedAt: null,
    ...o,
  });
  const goblin = { combatantId: "k-gob" };
  test("FR-MOD-05 the mark holds on the creature it is on, from the attacker, while active", () => {
    const effects = [fx({ targetCombatantId: "k-gob" })];
    expect(targetMarkedBy(effects, goblin, "hunters-mark", "k-thorn")).toBe(true);
    expect(targetMarkedBy(effects, { combatantId: "k-gob2" }, "hunters-mark", "k-thorn")).toBe(
      false,
    );
    // Another's mark, another key, an ended effect: no.
    expect(targetMarkedBy(effects, goblin, "hunters-mark", "k-mira")).toBe(false);
    expect(targetMarkedBy(effects, goblin, "pre-favored", "k-thorn")).toBe(false);
    expect(
      targetMarkedBy(
        [fx({ targetCombatantId: "k-gob", endedAt: "t" })],
        goblin,
        "hunters-mark",
        "k-thorn",
      ),
    ).toBe(false);
  });
  test("FR-MOD-05 a PC target's effects sit on its character; a campaign mark by its id", () => {
    const effects = [fx({ targetCharacterId: "c-mira", presetKey: "pre-favored" })];
    const mira = { combatantId: "k-mira", characterId: "c-mira" };
    expect(targetMarkedBy(effects, mira, "pre-favored", "k-thorn")).toBe(true);
    expect(targetMarkedBy(effects, { combatantId: "k-mira" }, "pre-favored", "k-thorn")).toBe(
      false,
    );
  });
});
