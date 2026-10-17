// ENT §13 Unit (S4): the glyph set (FR-ENT-28), `tokenArtOf`, the Art menu state and the licence
// check (FR-ENT-29): one ATTRIBUTION.md row per glyph, path strings only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREATURE_TYPES } from "@shared/entities/schemas";
import { artBackdropOf } from "../../scenes-map/shape";
import { CREATURE_COLORS } from "../../scenes-map/theme";
import { artMenuState, GLYPH_SHARE, glyphRect, tokenArtOf } from "../art";
import { TOKEN_ART_CREDITS, TOKEN_ART_LICENCE } from "./credits";
import { CREATURE_ART } from "./index";

const attribution = readFileSync(join(import.meta.dir, "ATTRIBUTION.md"), "utf8");
const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("FR-ENT-28 art per creature type", () => {
  test("exactly one glyph per CREATURE_TYPES entry, each a non-empty path + viewBox", () => {
    expect(Object.keys(CREATURE_ART).sort()).toEqual([...CREATURE_TYPES].sort());
    for (const t of CREATURE_TYPES) {
      const g = CREATURE_ART[t];
      expect(g.path.length).toBeGreaterThan(100);
      expect(g.path).toMatch(/^M[-0-9.,\s]/);
      expect(g.viewBox).toBe("0 0 512 512");
    }
  });

  test("glyphs are distinct", () => {
    expect(new Set(CREATURE_TYPES.map((t) => CREATURE_ART[t].path)).size).toBe(14);
  });

  test("tokenArtOf: image when imageAssetId is set, else the type, else initials", () => {
    expect(tokenArtOf({ imageAssetId: "a1", creatureType: "giant" })).toBe("image");
    expect(tokenArtOf({ imageAssetId: "a1", creatureType: null })).toBe("image");
    expect(tokenArtOf({ imageAssetId: null, creatureType: "humanoid" })).toBe("humanoid");
    expect(tokenArtOf({ imageAssetId: null, creatureType: "initials" })).toBe("initials");
    expect(tokenArtOf({ imageAssetId: null, creatureType: null })).toBe("initials");
  });

  test("backdrop follows the shape: disc, rounded square, bare; glyph ≈ 65 % centred", () => {
    expect(artBackdropOf("round")).toBe("circle");
    expect(artBackdropOf("square")).toBe("rounded-square");
    expect(artBackdropOf("none")).toBeNull();
    expect(GLYPH_SHARE).toBe(0.65);
    expect(glyphRect(70)).toEqual({ x: 12.25, y: 12.25, size: 45.5 });
  });

  test("one colour token per type; white glyph ≥ 4.5 : 1 on each (visual-direction values)", () => {
    expect(Object.keys(CREATURE_COLORS).sort()).toEqual([...CREATURE_TYPES].sort());
    for (const t of CREATURE_TYPES) {
      const ratio = 1.05 / (luminance(CREATURE_COLORS[t]) + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(4.99 - 0.01);
    }
  });

  test("Art menu: the token's choice is checked; null checks neither; no definition type → disabled", () => {
    expect(artMenuState({ creatureType: "humanoid" }, "humanoid")).toEqual({
      checked: "type",
      definitionType: "humanoid",
    });
    expect(artMenuState({ creatureType: "initials" }, "humanoid").checked).toBe("initials");
    expect(artMenuState({ creatureType: null }, null)).toEqual({
      checked: null,
      definitionType: null,
    });
  });
});

describe("FR-ENT-29 licence", () => {
  const rows = attribution
    .split("\n")
    .filter((l) => /^\| [a-z]+ \|/.test(l) && !l.startsWith("| Type"))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );

  test("ATTRIBUTION.md: one row per glyph with icon, author, licence, url (= credits.ts)", () => {
    expect(rows.map((r) => r[0]).sort()).toEqual([...CREATURE_TYPES].sort());
    for (const [type, icon, author, licence, url] of rows) {
      const c = TOKEN_ART_CREDITS[type as keyof typeof TOKEN_ART_CREDITS];
      expect(c).toBeDefined();
      expect({ icon, author, licence, url }).toEqual({
        icon: c.icon,
        author: c.author,
        licence: TOKEN_ART_LICENCE,
        url: c.url,
      });
      expect(["Lorc", "Delapouite"]).toContain(author ?? "");
      expect(url).toStartWith("https://game-icons.net/");
    }
    expect(attribution).toContain("CC BY 3.0");
    expect(attribution).toContain("game-icons.net");
  });

  test("the glyph module holds path strings only: no markup, no href, no url", () => {
    for (const t of CREATURE_TYPES) {
      const g = CREATURE_ART[t];
      for (const v of [g.path, g.viewBox]) {
        expect(typeof v).toBe("string");
        expect(v).toMatch(/^[-0-9.,\sA-Za-z]+$/);
        expect(v).not.toContain("<");
        expect(v.toLowerCase()).not.toContain("href");
      }
    }
    // Every string literal in the file (outside comments) is a path, a viewBox or the import.
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = [...code.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(literals.length).toBe(14 * 2 + 1);
    for (const v of literals.filter((l) => l !== "@shared/entities/schemas")) {
      expect(v).toMatch(/^[-0-9.,\sA-Za-z]+$/);
    }
    expect(code).not.toContain("`");
    expect(code.toLowerCase()).not.toContain("href");
    expect(code).not.toContain("http");
  });
});
