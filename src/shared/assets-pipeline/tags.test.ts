// ASSET §13.1 unit (shared): FR-ASSET-39 tag rules, FR-ASSET-40 built-ins, FR-ASSET-48 context tags.
import { describe, expect, test } from "bun:test";
import {
  IMAGE_CONTEXT_TAG,
  IMAGE_TAGS,
  ImageContext,
  ImageTag,
  ImageTags,
  isBuiltInTag,
  RenameTagIntent,
  SetTagsIntent,
  tagKey,
} from "./tags";

const ok = (v: unknown) => ImageTag.parse(v);
const bad = (v: unknown) => ImageTag.safeParse(v).success;

describe("image tags (FR-ASSET-39)", () => {
  test("FR-ASSET-39 tag rules: control chars removed, spaces collapsed, 24 / 25 chars, 8 / 9 tags, !!! invalid, fold-equal duplicates → one", () => {
    expect(ok("  Act\u0000 2\u0007  ")).toBe("Act 2");
    expect(ok("Big   bad  lair")).toBe("Big bad lair");
    // Control characters go first (FR-ASSET-39 order): a tab joins its neighbours.
    expect(ok("a\tb")).toBe("ab");
    expect(ok("x".repeat(24))).toBe("x".repeat(24));
    expect(bad("x".repeat(25))).toBe(false);
    // Code points, not UTF-16 units.
    expect(ok("𝒜".repeat(24))).toBe("𝒜".repeat(24));
    for (const v of ["", "   ", "\u0000", "!!!", "--", 1, null])
      expect([v, bad(v)]).toEqual([v, false]);

    const eight = Array.from({ length: 8 }, (_, i) => `t${i}`);
    expect(ImageTags.parse(eight)).toEqual(eight);
    expect(ImageTags.safeParse([...eight, "t8"]).success).toBe(false);
    // Deduplicated by fold, first spelling kept, order as given; 9 that fold to 8 pass.
    expect(ImageTags.parse(["tokens", "Maps", "TOKENS", "maps!", "Act 2"])).toEqual([
      "tokens",
      "Maps",
      "Act 2",
    ]);
    expect(ImageTags.parse([...eight, "T0"])).toEqual(eight);
    expect(tagKey("Hunter's  Lair")).toBe(tagKey("hunters lair"));

    expect(SetTagsIntent.safeParse({ assetId: "a", tags: ["x"], extra: 1 }).success).toBe(false);
    expect(RenameTagIntent.parse({ from: " dungeon ", to: "Crypt" })).toEqual({
      from: "dungeon",
      to: "Crypt",
    });
  });

  test("FR-ASSET-40 built-ins: six, chip order; fold identity; FR-ASSET-48 every context's tag", () => {
    expect(IMAGE_TAGS).toEqual(["Tokens", "Portraits", "Maps", "Handouts", "Props", "Items"]);
    expect(["tokens", "MAPS", "Items", "items "].map(isBuiltInTag)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["Token", "Dungeon", "Other"].map(isBuiltInTag)).toEqual([false, false, false]);
    expect(ImageContext.options.map((c) => [c, IMAGE_CONTEXT_TAG[c]])).toEqual([
      ["token", "Tokens"],
      ["portrait", "Portraits"],
      ["map", "Maps"],
      ["prop", "Props"],
      ["handout", "Handouts"],
      ["compendium-item", "Items"],
      ["compendium", null],
    ]);
  });
});
