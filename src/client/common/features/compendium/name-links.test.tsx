// FR-CMP-84 client part: what a list asks about (party inventory, Loot log item lines), batches
// past the body's limit, plain text without a link. The click: e2e/party-compendium-links.e2e.ts.
import { describe, expect, test } from "bun:test";
import { NAME_LOOKUP_MAX, type NameMatch } from "@shared/compendium/rest";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkedName, linkMap, linkOfKinds, lookupBatches, lookupNames } from "./name-links";

const items = (...names: string[]) => names.map((name) => ({ kind: "item" as const, name }));

describe("FR-CMP-84 list name links", () => {
  test("FR-CMP-84 each name once (as search folds), trimmed, in a stable order", () => {
    const a = lookupNames(items("Torch", "Potion of healing", " potion of Healing ", "torch"));
    const b = lookupNames(items("Potion of healing", "Torch"));
    expect(a.map((n) => n.name.toLowerCase())).toEqual(["potion of healing", "torch"]);
    expect(a).toEqual(b);
  });

  test("FR-CMP-84 a name no entry can have (blank, longer than an entry name) isn't asked", () => {
    expect(lookupNames(items("", "   ", "x".repeat(81), "Rope"))).toEqual(items("Rope"));
  });

  test("FR-CMP-84 more names than one request holds go in batches of NAME_LOOKUP_MAX", () => {
    const names = lookupNames(items(...Array.from({ length: 400 }, (_, i) => `Item ${i}`)));
    const batches = lookupBatches(names);
    expect(batches.map((b) => b.length)).toEqual([NAME_LOOKUP_MAX, NAME_LOOKUP_MAX, 20]);
    expect(batches.flat()).toEqual(names);
    expect(lookupBatches([])).toEqual([]);
  });

  test("FR-CMP-84 a row's name matches its item entry, padded or not; never another kind", () => {
    const potion: NameMatch = { kind: "item", name: "Potion of Healing", entryId: "p" };
    const bless: NameMatch = { kind: "spell", name: "Bless", entryId: "b" };
    const links = linkMap([potion, bless]);
    expect(linkOfKinds(links, ["item"], "potion of healing")).toEqual(potion);
    expect(linkOfKinds(links, ["item"], "Bless")).toBeNull();
  });

  test("FR-CMP-84 with no link (no provider, no match) a name is plain text, no button", () => {
    const html = renderToStaticMarkup(
      <LinkedName kinds={["item"]} name="Torch" rowId="r1" testId="party-item-link" />,
    );
    expect(html).toBe("Torch");
  });
});
