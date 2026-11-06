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
      "feat:rage",
      "feature:rage",
      "item:longsword",
      "item:rage",
      "item:rope",
      "option:rage",
      "spell:bless",
      "spell:longsword",
    ]);
  });

  test("FR-CMPX-36 a feature row's source is asked as a race and a background", () => {
    const features = [
      { name: "Warforged Resilience", source: "Warforged" },
      { name: "Hex Warrior", source: "" },
    ] as never[];
    const asked = namesToLookUp({ spells: [], features, items: [] }, []).map(
      (n) => `${n.kind}:${n.name}`,
    );
    expect(asked).toContain("race:Warforged");
    expect(asked).toContain("background:Warforged");
    expect(asked.filter((a) => a.startsWith("race:") || a.startsWith("background:"))).toHaveLength(
      2,
    );
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

  test("FR-CMPX-36 a feature row links to a class feature, else a feat, else a class option", () => {
    const feature: NameMatch = { kind: "feature", name: "Fighting Style", entryId: "f" };
    const option: NameMatch = { kind: "option", name: "Fighting Style", entryId: "o" };
    const feat: NameMatch = { kind: "feat", name: "Crossbow Expert", entryId: "x" };
    expect(linkOf(linkMap([option, feature]), "features", "Fighting Style")).toEqual(feature);
    expect(linkOf(linkMap([feat]), "features", "Crossbow Expert")).toEqual(feat);
    expect(linkOf(linkMap([option]), "features", "Fighting Style")).toEqual(option);
    expect(linkOf(linkMap([feat]), "spells", "Crossbow Expert")).toBeNull();
    const item: NameMatch = { kind: "item", name: "Starmetal Blaster", entryId: "i" };
    expect(linkOf(linkMap([item]), "features", "Starmetal Blaster")).toEqual(item);
  });

  test("FR-CMPX-36 a feature row no name matches links by its source: race first, then background", () => {
    const race: NameMatch = { kind: "race", name: "Warforged", entryId: "r" };
    const bg: NameMatch = { kind: "background", name: "Sailor", entryId: "b" };
    const own: NameMatch = { kind: "feature", name: "Pact Magic", entryId: "f" };
    const links = linkMap([race, bg, own]);
    expect(linkOf(links, "features", "Sentry's Rest", "Warforged")).toEqual(race);
    expect(linkOf(links, "features", "Ship's Passage", "Sailor")).toEqual(bg);
    expect(linkOf(links, "features", "Pact Magic", "Warforged")).toEqual(own);
    expect(linkOf(links, "features", "Hex Warrior", "Hexblade 1")).toBeNull();
    expect(linkOf(links, "items", "Rope", "Warforged")).toBeNull();
  });

  test("FR-CMP-77 with no link a name is plain text, no button", () => {
    const html = renderToStaticMarkup(<CompendiumName list="spells" name="Hedge Whisper" />);
    expect(html).toBe("Hedge Whisper");
  });
});
