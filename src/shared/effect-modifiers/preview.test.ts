// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// FR-MOD-27 roll-control preview (pure, over a store): preview mode, bonus-die and trigger
// groups, Tooltip text; FR-MOD-18 group keys match the server's (`bonusDieGroups`).
import { describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import {
  diceOfExpression,
  type PreviewTrigger,
  previewMode,
  previewText,
  rollPreview,
  sheetRollSubjects,
} from "./preview";
import type { Modifier, RollSubject } from "./schemas";

const bless: Modifier = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 };
const bane: Modifier = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: -1 };
const rageDmg: Modifier = { kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 };
const rageAdv: Modifier = {
  kind: "mode",
  on: { roll: "check", abilities: ["str"] },
  mode: "advantage",
};
const disChecks: Modifier = { kind: "mode", on: { roll: "check" }, mode: "disadvantage" };
const hm: Modifier = { kind: "dice", on: { roll: "damage", via: "weapon" }, dice: "1d6", sign: 1 };

interface Fx {
  id: string;
  label: string;
  modifiers: Modifier[];
  on?: { characterId: string } | { combatantId: string };
  presetKey?: string | null;
  endedAt?: string | null;
}

function store(o: {
  effects?: Fx[];
  presets?: Record<string, unknown>[];
  triggers?: PreviewTrigger[];
  turn?: string | null;
  combat?: boolean;
}): RecordStore {
  const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
  const effects = (o.effects ?? []).map((e) => ({
    id: e.id,
    kind: "custom",
    label: e.label,
    modifiers: e.modifiers,
    presetKey: e.presetKey ?? null,
    endedAt: e.endedAt ?? null,
    targetCharacterId: e.on && "characterId" in e.on ? e.on.characterId : "brakka",
    targetCombatantId: e.on && "combatantId" in e.on ? e.on.combatantId : null,
  }));
  return {
    you: null,
    seq: 0,
    records: {
      effect: byId(effects),
      "effect-preset": byId((o.presets ?? []) as { id: string }[]),
      encounter:
        o.combat === false
          ? {}
          : {
              enc: {
                id: "enc",
                status: "started",
                round: 1,
                turnCombatantId: o.turn === undefined ? "c-brakka" : o.turn,
                playerTurnCombatantId: null,
              },
            },
      combatant: {
        "c-brakka": {
          id: "c-brakka",
          encounterId: "enc",
          kind: "pc",
          entityId: "brakka",
          active: true,
          removed: false,
        },
        "c-goblin": {
          id: "c-goblin",
          encounterId: "enc",
          kind: "monster",
          entityId: "def-goblin",
          active: true,
          removed: false,
        },
      },
      entity: {
        brakka: {
          id: "brakka",
          kind: "character",
          statBlock: {
            level: 5,
            className: "Barbarian",
            classes: [{ name: "Barbarian", level: 5 }],
            abilities: { str: 18, dex: 12, con: 14, int: 8, wis: 10, cha: 10 },
          },
        },
      },
    },
  };
}

const brakka = { characterId: "brakka" };
const attack: RollSubject = { creature: brakka, roll: "attack", via: "weapon" };
const cardDamage: RollSubject = {
  creature: { combatantId: "c-brakka" },
  roll: "damage",
  via: "weapon",
  card: true,
};

const divineFury = (o: Partial<PreviewTrigger> = {}): PreviewTrigger => ({
  id: "trg-df",
  seq: 1,
  characterId: "brakka",
  definitionId: null,
  name: "Divine Fury",
  enabled: true,
  rule: {
    on: "hit",
    requires: { preset: "pre-rage" },
    when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
    every: "turn",
    then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
  },
  ...o,
});
const ragePreset = { id: "pre-rage", activeEffectId: "fx-rage", originKey: "rage" };
const rageFx: Fx = { id: "fx-rage", label: "Rage", modifiers: [rageDmg] };

describe("FR-MOD-15 sheet roll subjects (as char.roll derives them)", () => {
  test("FR-MOD-15 attack → [attack, damage] via weapon with the row; card adds card + to-hit mode", () => {
    const base = { characterId: "brakka", kind: "attack", categories: ["attack", "damage"] };
    expect(sheetRollSubjects({ ...base, row: "Greataxe" })).toEqual([
      { creature: brakka, roll: "attack", via: "weapon", row: "Greataxe" },
      { creature: brakka, roll: "damage", via: "weapon", row: "Greataxe" },
    ]);
    expect(sheetRollSubjects({ ...base, card: { toHitMode: "advantage" } })[1]).toEqual({
      creature: brakka,
      roll: "damage",
      via: "weapon",
      card: true,
      toHitMode: "advantage",
    });
    expect(
      sheetRollSubjects({ characterId: "brakka", kind: "spellDamage", categories: ["damage"] }),
    ).toEqual([{ creature: brakka, roll: "damage", via: "spell" }]);
  });

  test("FR-MOD-15 save / check / skill / initiative; healing none", () => {
    const s = (categories: string[], o: object = {}) =>
      sheetRollSubjects({ characterId: "brakka", kind: "x", categories, ...o });
    expect(s(["saving-throw"], { ability: "con" })).toEqual([
      { creature: brakka, roll: "save", ability: "con" },
    ]);
    expect(s(["skill-check"], { skill: "athletics" })).toEqual([
      { creature: brakka, roll: "check", ability: "str" },
    ]);
    expect(s(["initiative"])).toEqual([{ creature: brakka, roll: "initiative" }]);
    expect(s(["healing"])).toEqual([null]);
  });
});

describe("FR-MOD-27 preview mode", () => {
  test("FR-MOD-27 preview mode: Rage adv on Athletics; adv + dis → normal; roller combines", () => {
    const athletics: RollSubject = { creature: brakka, roll: "check", ability: "str" };
    const s = store({ effects: [{ id: "fx-r", label: "Rage", modifiers: [rageAdv] }] });
    expect(previewMode(s, athletics)).toBe("advantage");
    expect(previewMode(s, athletics, "disadvantage")).toBe("normal");
    expect(previewMode(s, { ...athletics, ability: "dex" })).toBe("normal");
    const both = store({
      effects: [
        { id: "fx-r", label: "Rage", modifiers: [rageAdv] },
        { id: "fx-b", label: "Curse", modifiers: [disChecks] },
      ],
    });
    expect(previewMode(both, athletics)).toBe("normal");
    expect(previewMode(both, athletics, "advantage")).toBe("normal");
  });

  test("FR-MOD-27 preview mode: ended effects and other creatures don't count", () => {
    const athletics: RollSubject = { creature: brakka, roll: "check", ability: "str" };
    const s = store({
      effects: [
        { id: "fx-1", label: "Rage", modifiers: [rageAdv], endedAt: "2026-01-01" },
        { id: "fx-2", label: "Rage", modifiers: [rageAdv], on: { characterId: "thorn" } },
      ],
    });
    expect(previewMode(s, athletics)).toBe("normal");
  });

  test("FR-MOD-27 a PC combatant's subject is its character (FR-MOD-15)", () => {
    const s = store({ effects: [{ id: "fx-b", label: "Bless", modifiers: [bless] }] });
    const p = rollPreview(s, { ...attack, creature: { combatantId: "c-brakka" } });
    expect(p.groups.map((g) => g.key)).toEqual(["e:fx-b"]);
  });
});

describe("FR-MOD-18 bonus-die groups", () => {
  test("FR-MOD-18 one labelled group per bonus die, keys as the server's bonusDieGroups", () => {
    const s = store({
      effects: [
        { id: "fx-b", label: "Bless", modifiers: [bless] },
        { id: "fx-n", label: "Bane", modifiers: [bane] },
        { id: "fx-2", label: "Double", modifiers: [bless, bless] },
      ],
    });
    const p = rollPreview(s, attack);
    expect(p.groups).toEqual([
      {
        key: "e:fx-b",
        label: "Bless",
        expression: "1d4",
        dice: [{ count: 1, faces: 4, sign: 1 }],
        sign: 1,
      },
      {
        key: "e:fx-n",
        label: "Bane",
        expression: "1d4",
        dice: [{ count: 1, faces: 4, sign: 1 }],
        sign: -1,
      },
      expect.objectContaining({ key: "e:fx-2.0" }),
      expect.objectContaining({ key: "e:fx-2.1" }),
    ]);
    expect(previewText(p.parts)).toBe("Bless +1d4 · Bane −1d4 · Double +1d4 · Double +1d4");
  });

  test("FR-MOD-18 crit damage doubles the bonus dice; flat parts listed, no group", () => {
    const s = store({ effects: [{ id: "fx-h", label: "Mark", modifiers: [hm, rageDmg] }] });
    const dmg: RollSubject = { creature: brakka, roll: "damage", via: "weapon" };
    expect(rollPreview(s, dmg).groups.map((g) => g.expression)).toEqual(["1d6"]);
    const crit = rollPreview(s, { ...dmg, crit: true });
    expect(crit.groups.map((g) => g.expression)).toEqual(["2d6"]);
    expect(previewText(crit.parts)).toBe("Mark +2d6 · Mark +2");
  });

  test("FR-MOD-27 no parts → no text", () => {
    expect(previewText(rollPreview(store({}), attack).parts)).toBeNull();
  });
});

describe("FR-MOD-27 trigger groups (T)", () => {
  test("FR-MOD-27 Divine Fury: a t: group on a card's damage while raging on her turn", () => {
    const s = store({ effects: [rageFx], presets: [ragePreset] });
    const p = rollPreview(s, cardDamage, [divineFury()]);
    expect(p.groups).toEqual([
      {
        key: "t:trg-df",
        label: "Divine Fury",
        expression: "1d6+2",
        dice: [{ count: 1, faces: 6, sign: 1 }],
        sign: 1,
        onHit: true,
      },
    ]);
    expect(previewText(p.parts)).toBe("Rage +2 · Divine Fury 1d6+2 (on a hit)");
  });

  test("FR-MOD-27 trigger groups need card damage, requires, own turn, enabled, owner", () => {
    const s = store({ effects: [rageFx], presets: [ragePreset] });
    const keys = (st: RecordStore, subj: RollSubject, t: PreviewTrigger) =>
      rollPreview(st, subj, [t]).groups.map((g) => g.key);
    expect(keys(s, { ...cardDamage, card: undefined }, divineFury())).toEqual([]);
    expect(keys(s, { ...cardDamage, via: "spell" }, divineFury())).toEqual([]);
    expect(keys(store({ presets: [ragePreset] }), cardDamage, divineFury())).toEqual([]);
    expect(
      keys(store({ effects: [rageFx], presets: [ragePreset], turn: "c-goblin" }), cardDamage, {
        ...divineFury(),
      }),
    ).toEqual([]);
    expect(keys(s, cardDamage, divineFury({ enabled: false }))).toEqual([]);
    expect(keys(s, cardDamage, divineFury({ characterId: "thorn" }))).toEqual([]);
  });

  test("FR-MOD-36 origin match: the DM's built-in rage fires a trigger requiring her preset", () => {
    const s = store({
      effects: [{ id: "fx-dm", label: "Rage", modifiers: [rageDmg], presetKey: "rage" }],
      presets: [{ id: "pre-rage", activeEffectId: null, originKey: "rage" }],
    });
    expect(rollPreview(s, cardDamage, [divineFury()]).groups).toHaveLength(1);
    // A trigger requiring built-in `rage` fires on her toggled preset (originKey rage).
    const t = divineFury({ rule: { ...divineFury().rule, requires: { preset: "rage" } } });
    const toggled = store({ effects: [rageFx], presets: [ragePreset] });
    expect(rollPreview(toggled, cardDamage, [t]).groups).toHaveLength(1);
  });

  test("FR-MOD-27 a player's {name} requires may hold; crit doubles unless crit-filtered", () => {
    const named = divineFury({ rule: { ...divineFury().rule, requires: { name: "Frenzy" } } });
    const s = store({});
    const crit = rollPreview(s, { ...cardDamage, crit: true }, [named]);
    expect(crit.groups.map((g) => g.expression)).toEqual(["2d6+2"]);
    const brutal: PreviewTrigger = {
      ...divineFury(),
      id: "trg-bc",
      rule: {
        on: "hit",
        when: [{ if: "crit" }],
        every: "each",
        then: { do: "damage", formula: "1d12", type: null },
      },
    };
    expect(rollPreview(s, { ...cardDamage, crit: true }, [brutal]).groups[0]?.expression).toBe(
      "1d12",
    );
  });

  test("FR-MOD-27 hard mode filters read the card's to-hit mode; soft / ask may hold", () => {
    const sneak: PreviewTrigger = {
      ...divineFury(),
      id: "trg-sa",
      name: "Sneak Attack",
      rule: {
        on: "hit",
        when: [
          { if: "via", via: "weapon" },
          { if: "mode", modes: ["normal", "advantage"] },
          { if: "mode", modes: ["advantage"], soft: true },
          { if: "ask", note: "finesse or ranged" },
        ],
        every: "turn",
        then: { do: "damage", formula: "(ceil(level(barbarian) / 2))d6", type: null },
      },
    };
    const s = store({});
    expect(rollPreview(s, cardDamage, [sneak]).groups[0]?.expression).toBe("3d6");
    expect(rollPreview(s, { ...cardDamage, toHitMode: "disadvantage" }, [sneak]).groups).toEqual(
      [],
    );
  });

  test("FR-MOD-43 roll triggers: a part (server-rolled: no group) and a mode hint; windows only in combat", () => {
    const part: PreviewTrigger = {
      ...divineFury(),
      id: "trg-p",
      name: "Sacred Weapon",
      rule: {
        on: "roll",
        when: [{ if: "roll", on: { roll: "attack", via: "weapon" } }],
        every: "each",
        then: { do: "part", formula: "1d4 + 1" },
      },
    };
    const mode: PreviewTrigger = {
      ...part,
      id: "trg-m",
      name: "Focus",
      rule: { ...part.rule, then: { do: "mode", mode: "advantage" } },
    };
    const s = store({});
    const p = rollPreview(s, attack, [part, mode]);
    expect(p.groups).toEqual([]);
    expect(previewText(p.parts)).toBe("Sacred Weapon +1d4+1");
    expect(previewMode(s, attack, "normal", [part, mode])).toBe("advantage");
    const perTurn = { ...part, rule: { ...part.rule, every: "turn" as const } };
    expect(rollPreview(store({ combat: false }), attack, [perTurn]).parts).toEqual([]);
    expect(rollPreview(store({ combat: false }), attack, [part]).parts).toHaveLength(1);
    const feature = { ...part, rule: { ...part.rule, every: { feature: "f1" } } };
    expect(rollPreview(s, attack, [feature]).parts).toEqual([]);
  });

  test("FR-MOD-27 a part with mixed dice lists every term", () => {
    expect(diceOfExpression("2d6+1d8+3")).toEqual([
      { count: 2, faces: 6, sign: 1 },
      { count: 1, faces: 8, sign: 1 },
    ]);
    expect(diceOfExpression("2-1d4")).toEqual([{ count: 1, faces: 4, sign: -1 }]);
  });
});
