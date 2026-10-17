// CHARX sprint 4 (S4-1a, FR-CHARX-54, -55): magic weapon rows on the sheet. `char.putRow`
// validates `bonus` / `extraDamage`; `char.roll` rolls to-hit + bonus, the base part + bonus
// (mods attach here) and one typed roll per extra part, all in one entry with one line run.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { RollEntryPayload } from "@shared/dice-roll-log/schemas";
import type { Attack } from "@shared/entities/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { entity, gameLogEntry, roll } from "../../db/schema";
import { type ModSetup, modSetup } from "../effect-modifiers/testing";

const FLAME = {
  name: "Flame Tongue greatsword",
  toHit: 7,
  damage: "2d6+4",
  damageType: "slashing",
  bonus: 1,
  extraDamage: [{ damage: "2d6", type: "fire" }],
};

function setup() {
  const t = modSetup();
  const putAttack = (row: object, actor = t.h.dm) =>
    t.run<{ rowId: string }>(
      CHARX_INTENTS.putRow,
      { creatureId: t.thornId, list: "attacks", row },
      actor,
    ).rowId;
  const attacks = () => {
    const row = t.s.db.select().from(entity).where(eq(entity.id, t.thornId)).get();
    return (row?.statBlock as { attacks?: Attack[] } | undefined)?.attacks ?? [];
  };
  const fail = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  return { ...t, putAttack, attacks, fail };
}

const entry = (t: ModSetup, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();
const lines = (t: ModSetup, id: string) => {
  const e = entry(t, id);
  const at = { kind: e?.kind as string, actorName: e?.actorName as string, payload: e?.payload };
  return {
    dm: lineText(formatEntry({ ...at, dmPayload: e?.dmPayload }).segments),
    player: lineText(formatEntry(at).segments),
  };
};

describe("FR-CHARX-54 weapon rows through char.putRow", () => {
  test("FR-CHARX-54 weapon row schema: owner stores bonus + typed parts; bad parts → invalid, nothing written", () => {
    const t = setup();
    const id = t.putAttack(FLAME, t.p2);
    expect(t.attacks().find((a) => a.id === id)).toEqual({ id, ...FLAME });
    const before = JSON.stringify(t.attacks());
    const bad = [
      { ...FLAME, bonus: 4 },
      { ...FLAME, extraDamage: [{ damage: "7d6", type: "fire" }] },
      { ...FLAME, extraDamage: [{ damage: "2d6" }] },
      { ...FLAME, extraDamage: [{ damage: "2d20", type: "fire" }] },
      {
        ...FLAME,
        extraDamage: [
          { damage: "1d4", type: "fire" },
          { damage: "1d4", type: "cold" },
          { damage: "1d4", type: "acid" },
        ],
      },
    ];
    for (const row of bad) expect(t.fail(() => t.putAttack(row, t.p2)).code).toBe("invalid");
    expect(JSON.stringify(t.attacks())).toBe(before);
    // Clearing the fields: a row without them behaves as before.
    t.putAttack({ id, name: FLAME.name, toHit: 7, damage: "2d6+4", damageType: "slashing" }, t.p2);
    expect(t.attacks().find((a) => a.id === id)).toEqual({
      id,
      name: FLAME.name,
      toHit: 7,
      damage: "2d6+4",
      damageType: "slashing",
    });
  });
});

describe("FR-CHARX-55 char.roll with weapon parts", () => {
  const rolls = (t: ModSetup) =>
    t.s.db
      .select()
      .from(roll)
      .orderBy(asc(sql`rowid`))
      .all()
      .map((r) => [r.expression, r.category, r.label]);

  test("FR-CHARX-55 +1 to hit and damage: 1d20+8; 2d6+5 slashing + 2d6 fire as two rolls in one entry", () => {
    const t = setup();
    const attackId = t.putAttack(FLAME);
    t.s.db.delete(roll).run();
    const r = t.run<{ rollIds: string[]; entryId: string }>(
      "char.roll",
      { characterId: t.thornId, kind: "attack", attackId },
      t.p2,
    );
    expect(rolls(t)).toEqual([
      ["1d20+8", "attack", "Flame Tongue greatsword attack"],
      ["2d6+5", "damage", "Flame Tongue greatsword damage (slashing)"],
      ["2d6", "damage", "Flame Tongue greatsword damage (fire)"],
    ]);
    const e = entry(t, r.entryId);
    expect([e?.category, e?.public, r.rollIds.length]).toEqual(["attack", true, 3]);
    const items = e?.payload as RollEntryPayload;
    expect(items.map((i) => i.part ?? null)).toEqual([
      null,
      { type: "slashing", extra: false },
      { type: "fire", extra: true },
    ]);
    // CharacterRolled carries every roll of the entry.
    const ev = t.events.filter((x) => x.event.type === "CharacterRolled").at(-1)?.event.payload;
    expect(ev).toMatchObject({ kind: "attack", attackId, rollIds: r.rollIds });
    const [hit, base, fire] = items;
    expect(lines(t, r.entryId).player).toBe(
      `Thorn — Flame Tongue greatsword attack: ${hit?.dice[0]?.value} + 8 = ${hit?.total}; ` +
        `Flame Tongue greatsword damage: 2d6+5 (${base?.dice.map((d) => d.value).join(" + ")}) ` +
        `slashing + 2d6 (${fire?.dice.map((d) => d.value).join(" + ")}) fire = ` +
        `${(base?.total ?? 0) + (fire?.total ?? 0)}`,
    );
  });

  test("FR-CHARX-55 Damage: Rage attaches to the base part only; physical entries per part in part order", () => {
    const t = setup();
    const attackId = t.putAttack(FLAME);
    const presetId = t.put(t.from("rage", { characterId: t.thornId }), t.p2);
    t.toggle(t.thornId, presetId, true, t.p2);
    const r = t.run<{ rollIds: string[]; entryId: string }>(
      "char.roll",
      {
        characterId: t.thornId,
        kind: "damage",
        attackId,
        manual: [
          { diceTotal: 8, dice: [3, 5] },
          { diceTotal: 8, dice: [2, 6] },
        ],
      },
      t.p2,
    );
    const items = entry(t, r.entryId)?.payload as RollEntryPayload;
    expect(items.map((i) => [i.expression, i.total, i.mods?.map((m) => m.label) ?? null])).toEqual([
      ["2d6+5", 15, ["Rage"]],
      ["2d6", 8, null],
    ]);
    expect(lines(t, r.entryId).player).toBe(
      "Thorn — Flame Tongue greatsword damage: 2d6+5 (3 + 5) + 2 Rage slashing + 2d6 (2 + 6) " +
        "fire = 23 (physical)",
    );
    // Manual count: Damage 1 + n, checked against the row.
    const one = t.fail(() =>
      t.run(
        "char.roll",
        { characterId: t.thornId, kind: "damage", attackId, manual: [{ diceTotal: 8 }] },
        t.p2,
      ),
    );
    expect([one.code, one.issues?.[0]?.message]).toEqual([
      "invalid",
      "Enter 2 physical rolls for damage",
    ]);
    // The physical dice must fit each part's own expression.
    const wrong = t.fail(() =>
      t.run(
        "char.roll",
        {
          characterId: t.thornId,
          kind: "damage",
          attackId,
          manual: [
            { diceTotal: 8, dice: [3, 5] },
            { diceTotal: 20, dice: [2, 6, 12] },
          ],
        },
        t.p2,
      ),
    );
    expect(wrong.code).toBe("invalid");
  });

  test("FR-CHARX-55 rows without the fields roll as before (no part on the entry)", () => {
    const t = setup();
    const attackId = t.putAttack({
      name: "Greataxe",
      toHit: 5,
      damage: "1d12+3",
      damageType: "slashing",
    });
    const plus = t.putAttack({ name: "Longsword +2", toHit: 5, damage: "1d8+3", bonus: 2 });
    t.s.db.delete(roll).run();
    const a = t.run<{ entryId: string }>(
      "char.roll",
      { characterId: t.thornId, kind: "attack", attackId },
      t.p2,
    );
    t.run("char.roll", { characterId: t.thornId, kind: "attack", attackId: plus }, t.p2);
    expect(rolls(t).map(([e]) => e)).toEqual(["1d20+5", "1d12+3", "1d20+7", "1d8+5"]);
    const items = entry(t, a.entryId)?.payload as RollEntryPayload;
    expect(items.some((i) => "part" in i)).toBe(false);
    expect(lines(t, a.entryId).player).toMatch(
      /^Thorn — Greataxe attack: \d+ \+ 5 = \d+.*; Greataxe damage \(slashing\): \d+ \+ 3 = \d+$/,
    );
  });
});
