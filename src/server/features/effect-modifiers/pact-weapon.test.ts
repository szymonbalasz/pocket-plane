// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Pact weapons (class-resources FR-CRES-14, -15): an attack row marked `pactWeapon` and the
// `pactWeapon` trigger filter, through the server's roll hook (sheet rolls and stand-in damage
// rolls), matched by the row's name like the `row` filter. Spell rolls never match.
import { describe, expect, test } from "bun:test";
import type { RollEntryPayload } from "@shared/dice-roll-log/schemas";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { entity, gameLogEntry } from "../../db/schema";
import { type RtSetup, rtSetup } from "./trigger-testing";

const pactPart: TriggerRule = {
  on: "roll",
  when: [{ if: "roll", on: { roll: "damage" } }, { if: "pactWeapon" }],
  every: "each",
  then: { do: "part", formula: "1d8" },
};

/** Brakka's rows: a pact Greataxe and a plain Handaxe. */
function withPactRows(t: RtSetup) {
  const row = t.s.db.select().from(entity).where(eq(entity.id, t.brakkaId)).get();
  const stats = row?.statBlock as { attacks: unknown[] };
  t.s.db
    .update(entity)
    .set({
      statBlock: {
        ...stats,
        attacks: [
          {
            id: "atk-greataxe",
            name: "Greataxe",
            toHit: 7,
            damage: "1d12+4",
            damageType: "slashing",
            pactWeapon: true,
          },
          { id: "atk-handaxe", name: "Handaxe", toHit: 7, damage: "1d6+4", damageType: "slashing" },
        ],
      },
    })
    .where(eq(entity.id, t.brakkaId))
    .run();
}

const parts = (t: RtSetup, via: "weapon" | "spell", row: string) =>
  t
    .roll(
      { creature: { characterId: t.brakkaId }, roll: "damage", via, row },
      { expression: "1d12+4", actorName: "Brakka" },
    )
    .roll.mods?.parts.map((p) => p.label) ?? [];

describe("FR-CRES-15 pactWeapon filter", () => {
  test("FR-CRES-15 pactWeapon filter: the pact Greataxe gets the part; Handaxe and a spell row don't", () => {
    const t = rtSetup({ inCombat: false });
    withPactRows(t);
    t.trig({ characterId: t.brakkaId, name: "Smite", rule: pactPart });
    expect(parts(t, "weapon", "Greataxe")).toEqual(["Smite"]);
    expect(parts(t, "weapon", "greataxe ")).toEqual(["Smite"]);
    expect(parts(t, "weapon", "Handaxe")).toEqual([]);
    expect(parts(t, "spell", "Greataxe")).toEqual([]);
  });

  test("FR-CRES-15 char.roll: the sheet's pact row damage gets the part, the other row's doesn't", () => {
    const t = rtSetup({ inCombat: false });
    withPactRows(t);
    t.trig({ characterId: t.brakkaId, name: "Smite", rule: pactPart });
    const labels = (attackId: string) => {
      const r = t.run<{ entryId: string }>(
        "char.roll",
        { characterId: t.brakkaId, kind: "damage", attackId },
        t.p1,
      );
      const e = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, r.entryId)).get();
      return ((e?.payload ?? []) as RollEntryPayload).map((i) => i.mods?.map((m) => m.label) ?? []);
    };
    expect(labels("atk-greataxe")).toEqual([["Smite"]]);
    expect(labels("atk-handaxe")).toEqual([[]]);
  });
});
