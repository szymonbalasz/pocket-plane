// spell-fx §14 (compendium): Add to sheet fills a spell row's map effect through FR-VFX-04.
import { describe, expect, test } from "bun:test";
import { SpellRow } from "@shared/character-sheet/sheet";
import { sheetRowOf } from "../compendium/add-to-sheet";
import type { EntryRow } from "../compendium/entries";

const spell = (name: string) =>
  ({
    kind: "spell",
    name,
    facets: { level: 3, concentration: true, ritual: false },
  }) as unknown as EntryRow;

const rowOf = (name: string) => {
  const r = sheetRowOf({ tx: undefined as never }, spell(name));
  if (r.list !== "spells") throw new Error("not a spell row");
  return SpellRow.parse({ id: "s1", ...r.rows[0] });
};

describe("compendium Add to sheet (FR-VFX-04)", () => {
  test("FR-VFX-04 a spell the catalogue knows gets its map effect with defaults; others none", () => {
    expect(rowOf("Spirit Guardians").fx).toEqual({
      preset: "spirit-guardians",
      params: { variant: "radiant", radiusFt: 15 },
    });
    expect(rowOf("Shadow of Moil").fx).toEqual({
      preset: "shadow-of-moil",
      params: { radiusFt: 10 },
    });
    expect("fx" in rowOf("Fireball")).toBe(false);
  });
});
