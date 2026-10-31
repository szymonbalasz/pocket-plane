// FR-CMP-77 client part: which names a sheet asks about, what each row links to, plain text when
// there is no link. The click: e2e/sheet-compendium-links.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { NameMatch } from "@shared/compendium/rest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompendiumName, linkMap, linkOf, namesToLookUp } from "./compendium-links";

const rows = (...names: string[]) => names.map((name) => ({ name })) as never[];
const sheet = (spells: string[], features: string[], items: string[]) => ({
  spells: rows(...spells),
  features: rows(...features),
  items: rows(...items),
});

describe("FR-CMP-77 sheet name links", () => {
  test("FR-CMP-77 a sheet asks once per kind and name; an attack asks as an item and a spell", () => {
    const asked = namesToLookUp(sheet(["Bless", "bless"], ["Rage"], ["Rope"]), [
      { name: "Longsword" },
    ]);
    expect(asked.map((n) => `${n.kind}:${n.name.toLowerCase()}`).sort()).toEqual([
      "feature:rage",
      "item:longsword",
      "item:rope",
      "spell:bless",
      "spell:longsword",
    ]);
  });

  test("FR-CMP-77 the order doesn't depend on the rows' order (one request key)", () => {
    const a = namesToLookUp(sheet(["Bless", "Light"], [], []), []);
    const b = namesToLookUp(sheet(["Light", "Bless"], [], []), []);
    expect(a).toEqual(b);
  });

  test("FR-CMP-77 an attack links to the item first, then the spell; other lists only to their kind", () => {
    const item: NameMatch = { kind: "item", name: "Shocking Grasp", entryId: "i" };
    const spell: NameMatch = { kind: "spell", name: "shocking grasp", entryId: "s" };
    expect(linkOf(linkMap([spell, item]), "attacks", "Shocking Grasp")).toEqual(item);
    expect(linkOf(linkMap([spell]), "attacks", "Shocking Grasp")).toEqual(spell);
    expect(linkOf(linkMap([spell]), "items", "Shocking Grasp")).toBeNull();
    expect(linkOf(linkMap([item]), "spells", "Shocking Grasp")).toBeNull();
    expect(linkOf(linkMap([spell]), "spells", "Shocking  grasp")).toEqual(spell);
  });

  test("FR-CMP-77 with no link a name is plain text, no button", () => {
    const html = renderToStaticMarkup(<CompendiumName list="spells" name="Hedge Whisper" />);
    expect(html).toBe("Hedge Whisper");
  });
});
