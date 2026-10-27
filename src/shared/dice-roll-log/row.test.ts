// Kit-parity Game log row (FR-KIT-42, -44, -46): the pure row parts per kind.
import { describe, expect, test } from "bun:test";
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
      { rollId: "r1", label: "Flame Tongue", total: 32, outcome: "damage" },
    ]);
  });

  test("FR-KIT-42 row action text: cbt.attack and cbt.hp → the line without the actor", () => {
    const attack = {
      kind: "cbt.attack",
      actorName: "Goblin",
      payload: {
        targetName: "Mira",
        attackName: "Scimitar",
        damageType: "slashing",
        toHit: { dice: 12, constant: 4, total: 16, natural: 12 },
        hit: true,
        damage: 6,
        multiplier: "normal",
        crit: false,
        manual: { toHit: true, damage: false },
      },
    };
    const a = rowAction(attack);
    expect(a.actor).toBe("Goblin");
    expect(a.text).toStartWith("attacks Mira: 12 + 4 = 16");
    expect(a.text).not.toContain("physical"); // a chip after the boxes
    expect(rowBadges(formatEntry(attack).segments)).toEqual(["physical"]);
    expect(rowResults(attack)).toEqual([]);

    const hp = {
      kind: "cbt.hp",
      actorName: "DM",
      payload: { targetName: "Mira", kind: "damage", amount: 5 },
    };
    expect(rowAction(hp)).toEqual({ actor: "DM", text: "Mira takes 5 damage" });
    const sourced = {
      ...hp,
      actorName: "Sela",
      payload: { targetName: "Mira", kind: "heal", amount: 8, sourced: true },
    };
    expect(rowAction(sourced)).toEqual({ actor: "Sela", text: "→ Mira, heal 8" });
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
      { rollId: "r1", label: "Longbow attack", total: 29, outcome: "crit" },
      { rollId: "r2", label: "Longbow damage", total: 16, outcome: "damage" },
    ]);
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
