// Sprint 15 (#385, ADR-0073) `char.roll` staged parts (FR-CHARX-128), purpose on sheet entries
// (FR-CHARX-129) and the edited mark (FR-CHARX-130): the tray's parts are rolled in place of the
// row's expressions; label, category, subject and mods stay the row's; absent parts = today.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { RollEntryPayload } from "@shared/dice-roll-log/schemas";
import { CharacterRolled } from "@shared/events/character-sheet";
import { eq } from "drizzle-orm";
import { gameLogEntry, roll } from "../../db/schema";
import { modSetup } from "../effect-modifiers/testing";

type Rolled = { rollIds: string[]; entryId: string };

function setup() {
  const t = modSetup();
  const put = (creatureId: string, list: string, row: object, actor = t.h.dm) =>
    t.run<{ rowId: string }>(CHARX_INTENTS.putRow, { creatureId, list, row }, actor).rowId;
  // Thorn's Flame Tongue: 2d6+5 slashing + 2d6 fire (FR-CHARX-55 parts).
  const flame = put(t.thornId, "attacks", {
    name: "Flame Tongue",
    toHit: 5,
    damage: "2d6+5",
    damageType: "slashing",
    extraDamage: [{ damage: "2d6", type: "fire" }],
  });
  t.run(CHARX_INTENTS.edit, {
    creatureId: t.miraId,
    set: { spellcasting: { ability: "wis", slots: { "1": 2 } } },
  });
  const bolt = put(t.miraId, "spells", {
    name: "Guiding Bolt",
    level: 1,
    roll: "attack",
    damage: "4d6",
    damageType: "radiant",
  });
  const cure = put(t.miraId, "spells", {
    name: "Cure Wounds",
    level: 1,
    roll: "none",
    effect: "healing",
    damage: "1d8+1",
  });
  const charRoll = (input: object, actor = t.p1) => t.run<Rolled>("char.roll", input, actor);
  const items = (entryId: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, entryId)).get()
      ?.payload as RollEntryPayload;
  const line = (entryId: string) => {
    const e = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, entryId)).get();
    return lineText(
      formatEntry({
        kind: e?.kind as string,
        actorName: e?.actorName as string,
        payload: e?.payload,
      }).segments,
    );
  };
  const rollRows = (ids: readonly string[]) =>
    ids.map((id) => t.s.db.select().from(roll).where(eq(roll.id, id)).get()?.expression);
  return { ...t, flame, bolt, cure, charRoll, items, line, rollRows };
}

describe("FR-CHARX-128 staged parts", () => {
  test("FR-CHARX-128 staged parts: Guiding Bolt 5d6 radiant → one roll of 5d6, label unchanged", () => {
    const t = setup();
    const plain = t.charRoll({ characterId: t.miraId, kind: "spellDamage", spellId: t.bolt });
    const staged = t.charRoll({
      characterId: t.miraId,
      kind: "spellDamage",
      spellId: t.bolt,
      parts: [{ expression: "5d6", type: "radiant" }],
    });
    expect(t.rollRows(plain.rollIds)).toEqual(["4d6"]);
    expect(t.rollRows(staged.rollIds)).toEqual(["5d6"]);
    const [was] = t.items(plain.entryId);
    const [item] = t.items(staged.entryId);
    expect(item?.label).toBe(was?.label as string);
    expect(item?.label).toBe("Guiding Bolt damage (radiant)");
    expect(item?.dice).toHaveLength(5);
    expect(t.line(staged.entryId)).toMatch(/^Mira — Guiding Bolt damage \(radiant\) edited: /); // FR-DICE-95
  });

  test("FR-CHARX-128 staged parts: healing spells take parts (upcast Cure Wounds); to-hit swaps its d20 expression", () => {
    const t = setup();
    const cure = t.charRoll({
      characterId: t.miraId,
      kind: "spellDamage",
      spellId: t.cure,
      parts: [{ expression: "2d8+1" }],
    });
    expect(t.rollRows(cure.rollIds)).toEqual(["2d8+1"]);
    expect(t.items(cure.entryId)[0]?.label).toBe("Cure Wounds healing");
    const hit = t.charRoll({
      characterId: t.miraId,
      kind: "toHit",
      parts: [{ expression: "1d20+6" }],
    });
    expect(t.rollRows(hit.rollIds)).toEqual(["1d20+6"]);
    expect(t.items(hit.entryId)[0]?.label).toBe("Shortsword attack");
  });

  test("FR-CHARX-128 staged parts limits: 2 parts on toHit, no d20, 21 dice, untyped extra, other kinds → invalid", () => {
    const t = setup();
    const before = t.count("game_log_entry");
    const bad = (input: object) => {
      const e = t.err(() => t.charRoll({ characterId: t.miraId, ...input }));
      return [e.code, e.issues?.[0]?.message];
    };
    expect(bad({ kind: "toHit", parts: [{ expression: "1d20" }, { expression: "1d20" }] })).toEqual(
      ["invalid", "An attack has one part"],
    );
    expect(bad({ kind: "toHit", parts: [{ expression: "2d6+4" }] })).toEqual([
      "invalid",
      "An attack needs one d20",
    ]);
    expect(bad({ kind: "toHit", parts: [{ expression: "1d20+4", type: "fire" }] })).toEqual([
      "invalid",
      "An attack has no damage type",
    ]);
    expect(
      bad({
        kind: "damage",
        parts: [{ expression: "11d6" }, { expression: "10d6", type: "fire" }],
      }),
    ).toEqual(["invalid", "At most 20 damage dice"]);
    expect(bad({ kind: "damage", parts: [{ expression: "1d6" }, { expression: "1d6" }] })).toEqual([
      "invalid",
      "Pick a type for each extra part",
    ]);
    expect(
      bad({
        kind: "damage",
        parts: [
          { expression: "1d6" },
          { expression: "1d6", type: "fire" },
          { expression: "1d6", type: "cold" },
          { expression: "1d6", type: "acid" },
        ],
      })[0],
    ).toBe("invalid");
    expect(bad({ kind: "damage", parts: [{ expression: "1d" }] })[0]).toBe("invalid");
    expect(bad({ kind: "damage", parts: [{ expression: "51d6" }] })[0]).toBe("invalid");
    expect(bad({ kind: "skill", skill: "perception", parts: [{ expression: "1d20" }] })).toEqual([
      "invalid",
      "No parts for skill",
    ]);
    expect(bad({ kind: "attack", parts: [{ expression: "1d20" }] })).toEqual([
      "invalid",
      "No parts for attack",
    ]);
    expect(t.count("game_log_entry")).toBe(before);
  });

  test("FR-CHARX-128 mods on the staged base: Rage on 2d6+5+1d6 slashing + 2d6 fire → +2 on the base, none on the extra", () => {
    const t = setup();
    const rage = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.toggle(t.thornId, rage, true, t.p2);
    const r = t.charRoll(
      {
        characterId: t.thornId,
        kind: "damage",
        attackId: t.flame,
        parts: [
          { expression: "2d6+5+1d6", type: "slashing" },
          { expression: "2d6", type: "fire" },
        ],
      },
      t.p2,
    );
    const [base, fire] = t.items(r.entryId);
    expect(t.rollRows([base?.rollId as string, fire?.rollId as string])).toEqual([
      "2d6+5+1d6",
      "2d6",
    ]);
    expect(base?.mods?.map((m) => [m.label, m.value])).toEqual([["Rage", 2]]);
    expect(fire?.mods).toBeUndefined();
    expect([base?.part, fire?.part]).toEqual([
      { type: "slashing", extra: false },
      { type: "fire", extra: true },
    ]);
    expect(t.line(r.entryId)).toMatch(
      /^Thorn — Flame Tongue damage edited: 2d6\+5\+1d6 \(.+\) \+ 2 Rage slashing \+ 2d6 \(.+\) fire = \d+$/,
    );
  });

  test("FR-CHARX-128 staged parts: a new third part is an extra part, a removed one is left out; manual counts follow the parts", () => {
    const t = setup();
    const three = t.charRoll(
      {
        characterId: t.thornId,
        kind: "damage",
        attackId: t.flame,
        parts: [
          { expression: "2d6+5", type: "slashing" },
          { expression: "2d6", type: "fire" },
          { expression: "1d8", type: "radiant" },
        ],
        manual: [{ diceTotal: 7 }, { diceTotal: 6 }, { diceTotal: 4 }],
      },
      t.p2,
    );
    expect(t.items(three.entryId).map((i) => [i.expression, i.part, i.edited ?? null])).toEqual([
      ["2d6+5", { type: "slashing", extra: false }, null],
      ["2d6", { type: "fire", extra: true }, null],
      ["1d8", { type: "radiant", extra: true }, true],
    ]);
    const one = t.charRoll(
      {
        characterId: t.thornId,
        kind: "damage",
        attackId: t.flame,
        parts: [{ expression: "2d6+5", type: "slashing" }],
      },
      t.p2,
    );
    expect(t.items(one.entryId)).toHaveLength(1);
    const e = t.err(() =>
      t.charRoll(
        {
          characterId: t.thornId,
          kind: "damage",
          attackId: t.flame,
          parts: [{ expression: "2d6+5", type: "slashing" }],
          manual: [{ diceTotal: 7 }, { diceTotal: 6 }],
        },
        t.p2,
      ),
    );
    expect(e.code).toBe("invalid");
  });
});

describe("FR-CHARX-129 purpose on sheet entries", () => {
  test("FR-CHARX-129 purpose on sheet entries: to-hit attack, damage + part on single-part rows; checks plain", () => {
    const t = setup();
    const hit = t.charRoll({ characterId: t.thornId, kind: "toHit" }, t.p2);
    const dmg = t.charRoll({ characterId: t.thornId, kind: "damage" }, t.p2);
    const cure = t.charRoll({ characterId: t.miraId, kind: "spellDamage", spellId: t.cure });
    const skill = t.charRoll({ characterId: t.miraId, kind: "skill", skill: "perception" });
    expect(t.items(hit.entryId).map((i) => [i.purpose, i.part ?? null])).toEqual([
      ["attack", null],
    ]);
    expect(t.items(dmg.entryId).map((i) => [i.purpose, i.part])).toEqual([
      ["damage", { type: "piercing", extra: false }],
    ]);
    // Healing: purpose damage, no part (the line keeps its heal outcome).
    expect(t.items(cure.entryId).map((i) => [i.purpose, i.part ?? null])).toEqual([
      ["damage", null],
    ]);
    expect(t.items(skill.entryId).map((i) => i.purpose ?? null)).toEqual([null]);
    // The line reads as before: a single base part is one run.
    expect(t.line(dmg.entryId)).toMatch(/^Thorn — Dagger damage \(piercing\): \d \+ 3 = \d+$/);
  });

  test("FR-CHARX-129 old attack kind still reads: kind attack accepted, to-hit + damage tagged, CharacterRolled.kind attack", () => {
    const t = setup();
    const r = t.charRoll({ characterId: t.thornId, kind: "attack" }, t.p2);
    expect(t.items(r.entryId).map((i) => i.purpose)).toEqual(["attack", "damage"]);
    const ev = t.events.findLast((e) => e.event.type === CharacterRolled.type);
    expect((ev?.event.payload as { kind?: string } | undefined)?.kind).toBe("attack");
    expect(t.line(r.entryId)).toMatch(
      /^Thorn — Dagger attack: \d+ \+ 5 = \d+.*; Dagger damage \(piercing\): \d \+ 3 = \d+$/,
    );
  });
});

describe("FR-CHARX-130 edited mark", () => {
  test("FR-CHARX-130 edited mark: upcast → edited; unchanged parts → none", () => {
    const t = setup();
    const same = t.charRoll(
      {
        characterId: t.thornId,
        kind: "damage",
        attackId: t.flame,
        parts: [
          { expression: "2d6+5", type: "slashing" },
          { expression: "2d6", type: "fire" },
        ],
      },
      t.p2,
    );
    expect(t.items(same.entryId).some((i) => i.edited)).toBe(false);
    const hit = t.charRoll(
      { characterId: t.thornId, kind: "toHit", parts: [{ expression: "1d20+5" }] },
      t.p2,
    );
    expect(t.items(hit.entryId)[0]?.edited).toBeUndefined();
    const up = t.charRoll({
      characterId: t.miraId,
      kind: "spellDamage",
      spellId: t.bolt,
      parts: [{ expression: "5d6", type: "radiant" }],
    });
    expect(t.items(up.entryId)[0]?.edited).toBe(true);
    const plain = t.charRoll({ characterId: t.miraId, kind: "spellDamage", spellId: t.bolt });
    expect(t.items(plain.entryId)[0]?.edited).toBeUndefined();
  });
});
