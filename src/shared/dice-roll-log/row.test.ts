// Kit-parity Game log row (FR-KIT-42, -44, -46): the pure row parts per kind.
import { describe, expect, test } from "bun:test";
import { lineText } from "./kind-types";
import { formatEntry } from "./line";
import { copyText, resultOutcome, rowAction, rowBadges, rowResults } from "./row";
import type { RollCategory, RollPayloadItem } from "./schemas";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+4",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 12, kept: true }],
  constant: 4,
  total: 16,
  natural: 12,
  label: null,
  ...p,
});
const roll = (items: RollPayloadItem[], category: RollCategory = "other", undone = false) => ({
  kind: "roll",
  actorName: "Mira",
  payload: items,
  category,
  undone,
});
/** A Goblin's `cbt.attack` outcome line on Mira (hit, 6 slashing; a physical to-hit). */
const p0 = {
  targetName: "Mira",
  attackName: "Scimitar",
  damageType: "slashing",
  toHit: { dice: 12, constant: 4, total: 16, natural: 12 },
  hit: true,
  damage: 6,
  multiplier: "normal",
  crit: false,
  manual: { toHit: true, damage: false },
};
const ATTACK = { kind: "cbt.attack", actorName: "Goblin", payload: p0 };

describe("FR-KIT-42 row action text", () => {
  test("FR-KIT-42 row action text: roll → its labels joined with ' + ', else the expression", () => {
    expect(rowAction(roll([item({ label: "Perception" })]))).toEqual({
      actor: "Mira",
      text: "Perception",
    });
    expect(rowAction(roll([item()])).text).toBe("1d20+4");
    expect(
      rowAction(
        roll([
          item({ label: "Longbow attack", mode: "advantage" }),
          item({ rollId: "r2", label: "Longbow damage" }),
        ]),
      ).text,
    ).toBe("Longbow attack + Longbow damage");
  });

  test("FR-KIT-42 row action text: a weapon's part run reads as its name once", () => {
    const parts = [
      item({ label: "Flame Tongue (slashing)", part: { type: "slashing", extra: false } }),
      item({ rollId: "r2", label: "Flame Tongue (fire)", part: { type: "fire", extra: true } }),
    ];
    expect(rowAction(roll(parts)).text).toBe("Flame Tongue");
    expect(rowResults(roll(parts))).toEqual([
      { key: "r1", rollId: "r1", label: "Flame Tongue", total: 32, outcome: "damage" },
    ]);
  });

  test("FR-KIT-42 row action text (K8): cbt.attack → 'Scimitar attack vs Mira', no maths; the to-hit and damage are boxes", () => {
    const a = rowAction(ATTACK);
    expect(a).toEqual({ actor: "Goblin", text: "Scimitar attack vs Mira" });
    expect(rowBadges(formatEntry(ATTACK).segments)).toEqual(["physical"]);
    expect(rowResults(ATTACK)).toEqual([
      { key: "hit", rollId: null, label: "To hit", total: 16, outcome: "plain", hit: true },
      { key: "damage", rollId: null, label: "Damage", total: 6, outcome: "damage" },
    ]);
    // The maths stays the full line's (Tooltip, copy).
    expect(lineText(formatEntry(ATTACK).segments)).toStartWith("Goblin attacks Mira: 12 + 4 = 16");
  });

  test("FR-KIT-42 row action text (K8): cbt.hp → 'Mira takes damage' / 'Mira heals' with the amount boxed; a sourced line 'heals Mira'", () => {
    const hp = {
      kind: "cbt.hp",
      actorName: "DM",
      payload: { targetName: "Mira", kind: "damage", amount: 5 },
    };
    expect(rowAction(hp)).toEqual({ actor: "DM", text: "Mira takes damage" });
    expect(rowResults(hp)).toEqual([
      { key: "amount", rollId: null, label: "Damage", total: 5, outcome: "damage" },
    ]);
    const heal = { ...hp, payload: { targetName: "Mira", kind: "heal", amount: 4 } };
    expect(rowAction(heal).text).toBe("Mira heals");
    expect(rowResults(heal)[0]?.outcome).toBe("heal");
    const sourced = {
      ...hp,
      actorName: "Sela",
      payload: { targetName: "Mira", kind: "heal", amount: 8, sourced: true },
    };
    expect(rowAction(sourced)).toEqual({ actor: "Sela", text: "heals Mira" });
    expect(rowResults(sourced)[0]).toMatchObject({ total: 8, outcome: "heal" });
    const overkill = {
      ...hp,
      actorName: "Goblin",
      payload: {
        targetName: "Mira",
        kind: "damage",
        amount: 30,
        sourced: true,
        callout: "overkill",
      },
    };
    expect(rowAction(overkill).text).toBe("damages Mira — Overkill!");
  });

  test("FR-KIT-42 row action text: gem.* — an award keeps its whole line, a spend drops the actor", () => {
    const award = {
      kind: "gem.award",
      actorName: "Mira",
      payload: { characterId: "c1", gem: "inspiration", count: 1, held: 2 },
    };
    expect(rowAction(award)).toEqual({
      actor: "Mira",
      text: "DM awards Mira an Inspiration gem (2 held)",
    });
    const spend = {
      kind: "gem.spend",
      actorName: "Mira",
      payload: {
        characterId: "c1",
        gem: "inspiration",
        count: 1,
        target: { kind: "entry", id: "e1", label: "Perception", from: 4 },
      },
    };
    const s = rowAction(spend);
    expect(s.actor).toBe("Mira");
    expect(s.text).toBe("spends an Inspiration gem — rerolls Perception (4)");
  });

  test("FR-KIT-42 row action text: a line without an actor (a player's side change) names none; unknown kinds read 'Unsupported entry'", () => {
    const side = {
      kind: "cbt.side",
      actorName: "DM",
      payload: { targetName: "Wolf", side: "ally" },
    };
    expect(rowAction(side)).toEqual({ actor: null, text: "Wolf is now an ally" });
    expect(rowAction({ ...side, dmPayload: { secret: false } })).toEqual({
      actor: "DM",
      text: "Wolf is now an ally",
    });
    expect(rowAction({ kind: "nope", actorName: "X", payload: {} })).toEqual({
      actor: null,
      text: "Unsupported entry",
    });
    expect(rowAction({ kind: "roll", actorName: "X", payload: "junk" }).actor).toBeNull();
  });

  test("FR-KIT-42 row action text: an undone line's badge is a chip, not action text", () => {
    const e = roll([item({ label: "Perception", manual: true })], "skill-check", true);
    expect(rowAction(e).text).toBe("Perception");
    expect(rowBadges(formatEntry(e).segments)).toEqual(["physical", "undone"]);
  });
});

describe("FR-KIT-44 outcome", () => {
  test("FR-KIT-44 outcome: natural 20 crit, natural 1 fumble, damage, heal, else plain", () => {
    expect(resultOutcome({ natural: 20 }, "attack")).toBe("crit");
    expect(resultOutcome({ natural: 1 }, "saving-throw")).toBe("fumble");
    expect(resultOutcome({ natural: 12 }, "attack")).toBe("plain");
    expect(resultOutcome({ natural: null }, "damage")).toBe("damage");
    expect(resultOutcome({ natural: null, part: { type: "fire", extra: true } }, "other")).toBe(
      "damage",
    );
    expect(resultOutcome({ natural: null }, "healing")).toBe("heal");
    expect(resultOutcome({ natural: null })).toBe("plain");
    // FR-DICE-29: a natural on initiative has no rule meaning (no marker, no outcome).
    expect(resultOutcome({ natural: 20 }, "initiative")).toBe("plain");
    expect(resultOutcome({ natural: 1 }, "initiative")).toBe("plain");
  });

  test("FR-KIT-44 outcome: one result per run, with its roll id and total", () => {
    const e = roll(
      [
        item({ label: "Longbow attack", natural: 20, total: 29 }),
        item({
          rollId: "r2",
          label: "Longbow damage",
          natural: null,
          total: 16,
          part: { type: "piercing", extra: false },
        }),
      ],
      "attack",
    );
    expect(rowResults(e)).toEqual([
      { key: "r1", rollId: "r1", label: "Longbow attack", total: 29, outcome: "crit" },
      { key: "r2", rollId: "r2", label: "Longbow damage", total: 16, outcome: "damage" },
    ]);
  });

  test("FR-KIT-44 outcome (K8): an attack + damage roll's damage run is `damage` (no part, no category of its own), even a natural 1 / 20 on it; the to-hit keeps its own", () => {
    const hit = item({ label: "Light crossbow attack", natural: 14, total: 18 });
    const dmg = item({
      rollId: "r2",
      expression: "1d8+2",
      label: "Light crossbow damage (piercing)",
      dice: [{ faces: 8, value: 5, kept: true }],
      constant: 2,
      total: 7,
      natural: null,
    });
    expect(rowResults(roll([hit, dmg], "attack")).map((r) => r.outcome)).toEqual([
      "plain",
      "damage",
    ]);
    // A homebrew d20 damage roll is still the damage.
    const d20 = { ...dmg, expression: "1d20", natural: 20, total: 20 };
    expect(rowResults(roll([hit, d20], "attack"))[1]?.outcome).toBe("damage");
    // Not an attack entry: unchanged (two checks stay plain).
    expect(rowResults(roll([hit, dmg], "other")).map((r) => r.outcome)).toEqual(["plain", "plain"]);
    expect(resultOutcome({ natural: 20 }, "attack", true)).toBe("damage");
  });

  test("FR-KIT-44 outcome (K8): cbt.attack boxes: a crit hit `crit`, a miss dim (`fumble`) with no damage box, an Apply hit line no damage box; a damage-only line only the damage", () => {
    const p = ATTACK.payload;
    const outcomes = (payload: Record<string, unknown>) =>
      rowResults({ ...ATTACK, payload: { ...p, ...payload } }).map((r) => [r.key, r.outcome]);
    expect(outcomes({ crit: true, toHit: { ...p.toHit, natural: 20, total: 24 } })).toEqual([
      ["hit", "crit"],
      ["damage", "damage"],
    ]);
    expect(outcomes({ hit: false, damage: 0 })).toEqual([["hit", "fumble"]]);
    // A natural 20 the DM ruled a miss: a miss.
    expect(outcomes({ hit: false, crit: true, damage: 0 })).toEqual([["hit", "fumble"]]);
    expect(outcomes({ awaitingDamage: true, damage: 0 })).toEqual([["hit", "plain"]]);
    expect(outcomes({ toHit: null })).toEqual([["damage", "damage"]]);
    expect(outcomes({ toHit: null, hit: false, damage: 0 })).toEqual([]);
    const missText = rowAction({
      ...ATTACK,
      payload: { ...p, toHit: null, hit: false, damage: 0 },
    });
    expect(missText.text).toBe("Scimitar attack vs Mira — miss");
  });

  test("FR-KIT-44 BL-141 outcome: a cbt.attack to-hit that hit (not a crit) is marked `hit` (the kit's green box); a crit, a miss and damage boxes aren't", () => {
    const p = ATTACK.payload;
    const hits = (payload: Record<string, unknown>) =>
      rowResults({ ...ATTACK, payload: { ...p, ...payload } }).map((r) => [r.key, r.hit ?? false]);
    expect(hits({})).toEqual([
      ["hit", true],
      ["damage", false],
    ]);
    expect(hits({ awaitingDamage: true, damage: 0 })).toEqual([["hit", true]]);
    expect(hits({ crit: true, toHit: { ...p.toHit, natural: 20, total: 24 } })[0]).toEqual([
      "hit",
      false,
    ]);
    expect(hits({ hit: false, damage: 0 })).toEqual([["hit", false]]);
    // A plain roll's boxes never carry it.
    expect(rowResults({ ...ATTACK, payload: { ...p } })[0]?.outcome).toBe("plain");
  });

  test("FR-KIT-42 row action text (K8): a companion's line names no attack for players ('attacks Mira'); the DM reads it from dmPayload", () => {
    const { attackName: _n, ...rest } = ATTACK.payload;
    const player = { ...ATTACK, payload: rest };
    expect(rowAction(player).text).toBe("attacks Mira");
    const dm = {
      ...player,
      dmPayload: {
        targetAc: 15,
        attackName: "Bite",
        hitComputed: true,
        toHitRolled: 16,
        damageRolled: 6,
        damageTotal: 6,
        applied: 6,
        overkill: 0,
        overrides: { toHit: false, hit: false, damage: false },
      },
    };
    expect(rowAction(dm).text).toBe("Bite attack vs Mira");
    expect(rowAction({ ...ATTACK, payload: { ...p0, callout: "overkill" } }).text).toBe(
      "Scimitar attack vs Mira — Overkill!",
    );
  });
});

describe("FR-KIT-46 copy", () => {
  test("FR-KIT-46 copy: a line's copied text is today's (struck dice and badges as plain words)", () => {
    const { segments } = formatEntry(
      roll(
        [
          item({
            expression: "2d20kh1+5",
            mode: "advantage",
            label: "Athletics",
            dice: [
              { faces: 20, value: 13, kept: true },
              { faces: 20, value: 4, kept: false },
            ],
            constant: 5,
            total: 18,
            natural: 13,
            manual: true,
          }),
        ],
        "skill-check",
      ),
    );
    expect(copyText(segments)).toBe("Mira — Athletics (adv): 13 4 + 5 = 18 physical");
  });
});

describe("BL-162 the row names the actor once", () => {
  const goblin = (items: RollPayloadItem[]) => ({ ...roll(items), actorName: "Goblin" });
  const blade = item({ label: "Goblin — Hooked Blade attack" });

  test("BL-162 'Goblin · Hooked Blade attack': the actor, then the label without the name", () => {
    expect(rowAction(goblin([blade]))).toEqual({ actor: "Goblin", text: "Hooked Blade attack" });
  });

  test("BL-162 a result's name (the '+N' Tooltip) and the row's other labels keep their text", () => {
    expect(rowResults(goblin([blade]))[0]?.label).toBe("Hooked Blade attack");
    expect(rowAction(goblin([item({ label: "Goblin Boss — Bite" })])).text).toBe(
      "Goblin Boss — Bite",
    );
    expect(rowResults(goblin([item()]))[0]?.label).toBe("1d20+4");
  });

  test("BL-162 a reroll's gem line reads the target without the spender's name", () => {
    const spend = {
      kind: "gem.spend",
      actorName: "Mira",
      payload: {
        characterId: "c1",
        gem: "inspiration",
        count: 1,
        target: { kind: "entry", id: "e1", label: "Mira — Longbow attack", from: 4 },
      },
    };
    expect(rowAction(spend).text).toBe("spends an Inspiration gem — rerolls Longbow attack (4)");
    const { target } = spend.payload;
    const other = {
      ...spend,
      payload: { ...spend.payload, target: { ...target, label: "Wolf — Bite" } },
    };
    expect(rowAction(other).text).toBe("spends an Inspiration gem — rerolls Wolf — Bite (4)");
  });
});
