// Theme token blocks in styles.css (theme-system FR-THEME-06, -08, -09, -16, -17, -18): every
// theme token defined for both themes and nothing else in a theme block, meaning tokens only in
// the shared block, gilt's contrast pairs, player colours on both window surfaces, and the
// bundled fonts (files, licences, attribution, size, named only by gilt).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  colorProblem,
  contrastRatio,
  MIN_CONTRAST,
  PLAYER_COLOR_KEYS,
  PLAYER_COLORS,
  surfaceContrast,
  WINDOW_SURFACES,
} from "@shared/campaign-management/colors";

const COMMON = join(import.meta.dir, "..");
const ROOT = join(COMMON, "../../..");
const CSS = readFileSync(join(COMMON, "styles.css"), "utf8");

/** Top-level rules of styles.css (selector → custom properties), comments dropped. */
function blocks(css: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? "").trim().replace(/\s+/g, " ");
    const props = new Map<string, string>();
    for (const d of (m[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (d[1] && d[2]) props.set(d[1], d[2].trim().replace(/\s+/g, " "));
    }
    out.set(sel, props);
  }
  return out;
}

const B = blocks(CSS);
const DEFAULT = B.get(':root, [data-theme="default"]')!;
const GILT_SELECTOR = '[data-theme="gilt"] body, body [data-theme="gilt"]';
const GILT = B.get(GILT_SELECTOR)!;
const MEANING = B.get(":root")!;

/** shadcn tokens + the theme tokens of theme-system §8 (+ the three other corner pieces). */
const SHADCN = [
  "--radius",
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--ring",
];
const THEME = [
  "--frame-rule",
  "--frame-rule-strong",
  "--frame-shadow",
  "--frame-corner",
  "--frame-corner-tr",
  "--frame-corner-bl",
  "--frame-corner-br",
  "--panel-grain",
  "--gem",
  "--gem-deep",
  "--gem-hi",
  "--gold",
  "--parchment",
  "--parchment-ink",
  "--font-title",
  "--font-label",
  "--font-num",
  "--font-body",
];
/** Themeable, but Gilt & Stone keeps Default's value (styles.css says why). */
const KEPT = [
  "--destructive",
  "--destructive-foreground",
  "--overlay",
  "--caution",
  "--caution-foreground",
  "--positive",
  "--positive-foreground",
  "--success",
  "--warning",
];
/** FR-THEME-09 meaning tokens (visual-direction hp.*, visibility.hidden, player.*). */
const MEANING_TOKENS = [
  "--hp-full",
  "--hp-bloodied",
  "--hp-down",
  "--visibility-hidden",
  "--hp-temp",
  "--hp-down-foreground",
  "--swatch-ink",
  ...PLAYER_COLOR_KEYS.map((k) => `--player-${k}`),
];

describe("FR-THEME-08 token completeness", () => {
  test("FR-THEME-08 token completeness: every theme token defined for both themes", () => {
    expect([DEFAULT, GILT, MEANING].every(Boolean)).toBe(true);
    expect([...DEFAULT.keys()].sort()).toEqual([...SHADCN, ...THEME, ...KEPT].sort());
    expect([...GILT.keys()].sort()).toEqual([...SHADCN, ...THEME].sort());
  });

  test("FR-THEME-08 token completeness: gilt values from the kit page's :root", () => {
    const kit = readFileSync(join(ROOT, "docs/design/art/kit/gilt-stone.html"), "utf8");
    const kitRoot = blocks(kit.slice(kit.indexOf(":root {"), kit.indexOf("/* Alternative")));
    const k = kitRoot.get(":root")!;
    const pairs: [string, string][] = [
      ["--background", "--ground"],
      ["--card", "--panel"],
      ["--popover", "--panel-hi"],
      ["--muted", "--panel-hi"],
      ["--foreground", "--cream"],
      ["--muted-foreground", "--muted"],
      ["--primary", "--gold"],
      ["--gold", "--gold"],
      ["--frame-rule", "--gold-deep"],
      ["--frame-rule-strong", "--gold-mid"],
      ["--gem", "--gem"],
      ["--gem-deep", "--gem-deep"],
      ["--gem-hi", "--gem-hi"],
      ["--parchment", "--parch"],
      ["--parchment-ink", "--ink"],
      ["--panel-grain", "--grain"],
      ["--frame-corner", "--cn-tl"],
      ["--frame-corner-tr", "--cn-tr"],
      ["--frame-corner-bl", "--cn-bl"],
      ["--frame-corner-br", "--cn-br"],
      ["--font-title", "--f-title"],
      ["--font-label", "--f-label"],
      ["--font-num", "--f-num"],
      ["--font-body", "--f-body"],
    ];
    for (const [ours, theirs] of pairs) {
      const norm = (v?: string) => v?.replaceAll('"', "'").toLowerCase();
      expect({ ours, v: norm(GILT.get(ours)) }).toEqual({ ours, v: norm(k.get(theirs)) });
    }
  });

  test("FR-THEME-08 Default theme tokens reproduce today's look: they only point at existing tokens or are off", () => {
    for (const t of THEME) {
      const v = DEFAULT.get(t) ?? "";
      expect({
        t,
        ok: /^var\(--[\w-]+\)$/.test(v) || v === "none" || t === "--frame-shadow",
      }).toEqual({
        t,
        ok: true,
      });
    }
    // The window's `shadow-lg` today; the body font is Tailwind's sans stack, as before.
    expect(DEFAULT.get("--frame-shadow")).toBe(
      "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    );
    expect(DEFAULT.get("--font-body")).toBe("var(--font-sans)");
    expect(CSS).toMatch(/ body \{[^}]*font-family: var\(--font-body\);/);
  });
});

describe("FR-THEME-09 meaning tokens are not themed", () => {
  test("FR-THEME-09 meaning tokens: defined once on :root, in no theme block", () => {
    expect([...MEANING.keys()].sort()).toEqual([...MEANING_TOKENS].sort());
    for (const t of MEANING_TOKENS) {
      expect({ t, d: DEFAULT.has(t), g: GILT.has(t) }).toEqual({ t, d: false, g: false });
    }
    // Only the two theme blocks (and the preview font guard) use data-theme.
    const themed = [...B.keys()].filter((s) => s.includes("data-theme"));
    expect(themed.sort()).toEqual(
      [
        ':root, [data-theme="default"]',
        GILT_SELECTOR,
        ':root:not([data-theme="gilt"]) [data-theme="gilt"]',
      ].sort(),
    );
  });
});

describe("OQ-THEME-09 map canvas not themed", () => {
  test("OQ-THEME-09 map canvas not themed: <html>, where the canvas reads its colours, keeps Default's tokens", () => {
    // A gilt rule matches <body> or an element inside it, never <html> alone.
    expect(GILT_SELECTOR.split(", ").every((sel) => /(^| )body( |$)/.test(sel))).toBe(true);
    const canvasReads = readFileSync(join(COMMON, "features/scenes-map/theme.ts"), "utf8");
    expect(canvasReads).toContain("getComputedStyle(document.documentElement)");
  });
});

describe("FR-THEME-06 font sizes and geometry", () => {
  test("FR-THEME-06 font sizes: no theme block sets a size, spacing or line-height token", () => {
    for (const block of [DEFAULT, GILT]) {
      for (const t of block.keys()) expect(t).not.toMatch(/^--(text|spacing|leading|tracking)/);
    }
    // Theme rules declare custom properties only.
    const decls = [
      ...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\[data-theme[^{]*\{([^}]*)\}/g),
    ]
      .flatMap((m) => [...(m[1] ?? "").matchAll(/(?:^|;)\s*([a-z][\w-]*)\s*:/g)])
      .map((d) => d[1]);
    expect(decls).toEqual([]);
  });
});

// ---- contrast ----

/** `#rrggbb` or `oklch(L C H)` (L as 0–1 or %), opaque only → `#rrggbb`. */
function toHex(v: string): string {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (v === "#fff") return "#ffffff";
  const m = /^oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)\)$/.exec(v);
  if (!m) throw new Error(`not an opaque colour: ${v}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const [a, b] = [C * Math.cos(h), C * Math.sin(h)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${lin
    .map((c) => Math.round(Math.min(1, Math.max(0, enc(c))) * 255))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A token's colour under gilt (its own value, else Default's), `var()`s resolved. */
function gilt(t: string): string {
  const v = GILT.get(t) ?? DEFAULT.get(t);
  if (!v) throw new Error(`${t} undefined`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref?.[1] ? gilt(ref[1]) : toHex(v);
}

describe("FR-THEME-17 contrast", () => {
  test("FR-THEME-17 contrast: the colour check reads oklch as the browser does", () => {
    expect(toHex("oklch(0.205 0 0)")).toBe("#171717");
    expect(toHex("oklch(0.704 0.191 22.216)")).toBe("#ff6467");
  });

  test("FR-THEME-17 contrast (gilt): body text ≥ 7 : 1, labels / numbers / gold ≥ 4.5 : 1, focus ring ≥ 3 : 1", () => {
    const pairs: [string, string, number][] = [
      ["--foreground", "--background", 7],
      ["--foreground", "--card", 7],
      ["--card-foreground", "--card", 7],
      ["--popover-foreground", "--popover", 7],
      ["--parchment-ink", "--parchment", 7],
      ["--muted-foreground", "--card", 4.5],
      ["--muted-foreground", "--muted", 4.5],
      ["--primary", "--card", 4.5],
      ["--gold", "--card", 4.5],
      ["--primary-foreground", "--primary", 4.5],
      ["--secondary-foreground", "--secondary", 4.5],
      ["--accent-foreground", "--accent", 4.5],
      ["--destructive", "--card", 4.5],
      ["--ring", "--card", 3],
      ["--ring", "--background", 3],
      ["--ring", "--popover", 3],
    ];
    const low = pairs
      .map(([fg, bg, min]) => ({ fg, bg, min, r: contrastRatio(gilt(fg), gilt(bg)) }))
      .filter((p) => p.r < p.min)
      .map((p) => `${p.fg} on ${p.bg}: ${p.r.toFixed(2)} < ${p.min}`);
    expect(low).toEqual([]);
  });
});

describe("FR-THEME-18 player colours on both surfaces", () => {
  test("FR-THEME-18 player colours on both surfaces: FR-CAMP-31's surfaces are each theme's --card", () => {
    expect<Record<string, string>>(WINDOW_SURFACES).toEqual({
      default: toHex(DEFAULT.get("--card")!),
      gilt: toHex(GILT.get("--card")!),
    });
  });

  test("FR-THEME-18 player colours on both surfaces: every palette colour passes on both; the check takes the lower contrast", () => {
    for (const k of PLAYER_COLOR_KEYS) {
      const hex = PLAYER_COLORS[k];
      for (const s of Object.values(WINDOW_SURFACES)) {
        expect({ k, s, ok: contrastRatio(hex, s) >= MIN_CONTRAST }).toEqual({ k, s, ok: true });
      }
      expect(colorProblem(hex)).toBeNull();
    }
    // A dark colour reads worse on gilt's darker surface: the check uses the lower ratio.
    const dark = "#3d6ec9";
    const ratios = Object.values(WINDOW_SURFACES).map((s) => contrastRatio(dark, s));
    expect(surfaceContrast(dark)).toBe(Math.min(...ratios));
    expect(colorProblem(dark)).toBe("too-dark");
  });
});

// ---- FR-THEME-16 fonts ----

const THEMES = join(COMMON, "themes");
const FONTS = join(THEMES, "fonts");
const FONT_CSS = readFileSync(join(THEMES, "fonts.css"), "utf8");
const FACES = [...FONT_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = m[1] ?? "";
  const get = (p: string) => new RegExp(`${p}:\\s*([^;]+);`).exec(body)?.[1]?.trim();
  return {
    family: get("font-family")?.replaceAll('"', ""),
    style: get("font-style"),
    weight: get("font-weight"),
    display: get("font-display"),
    src: /url\("\.\/fonts\/([^"]+)"\) format\("woff2"\)/.exec(body)?.[1],
    range: get("unicode-range")?.replace(/\s+/g, " "),
  };
});
const FAMILIES = ["IM Fell English SC", "EB Garamond", "Alegreya Sans"];
const LICENCE: Record<string, string> = {
  "IM Fell English SC": "OFL-im-fell-english-sc.txt",
  "EB Garamond": "OFL-eb-garamond.txt",
  "Alegreya Sans": "OFL-alegreya-sans.txt",
};

describe("FR-THEME-16 fonts", () => {
  test("FR-THEME-16 fonts: the faces of the Old book pairing, Latin subset, swap, each file committed", () => {
    expect(
      FACES.map((f) => `${f.family} ${f.weight}${f.style === "italic" ? " italic" : ""}`),
    ).toEqual([
      "IM Fell English SC 400",
      "EB Garamond 500 700",
      "Alegreya Sans 400",
      "Alegreya Sans 400 italic",
      "Alegreya Sans 500",
      "Alegreya Sans 700",
    ]);
    const latin =
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
    for (const f of FACES) {
      expect({ f: f.src, display: f.display, range: f.range }).toEqual({
        f: f.src,
        display: "swap",
        range: latin,
      });
      const bytes = readFileSync(join(FONTS, f.src!));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
    const woff2 = readdirSync(FONTS).filter((n) => n.endsWith(".woff2"));
    expect(woff2.sort()).toEqual(FACES.map((f) => f.src!).sort());
    // Spec §12: about 250 KB in total.
    const total = woff2.reduce((n, f) => n + statSync(join(FONTS, f)).size, 0);
    expect(total).toBeLessThan(260_000);
  });

  test("FR-THEME-16 fonts: OFL licence beside each font, an attribution entry per file (ADR-0018 style)", () => {
    const attribution = readFileSync(join(FONTS, "ATTRIBUTION.md"), "utf8");
    for (const fam of FAMILIES) {
      const licence = readFileSync(join(FONTS, LICENCE[fam]!), "utf8");
      expect(licence).toMatch(/^Copyright/);
      expect(licence).toContain("SIL Open Font License, Version 1.1");
      expect(attribution).toContain(fam);
      expect(attribution).toContain(LICENCE[fam]!);
    }
    for (const f of FACES) {
      const file = f.src!;
      const named =
        attribution.includes(file) || attribution.includes("alegreya-sans-*.latin.woff2");
      expect({ file, named }).toEqual({ file, named: true });
    }
  });

  test("FR-THEME-16 fonts: only the gilt block names them, with a fallback stack; a preview elsewhere uses the fallbacks", () => {
    for (const t of ["--font-title", "--font-label", "--font-num", "--font-body"]) {
      const v = GILT.get(t) ?? "";
      expect(FAMILIES.some((f) => v.startsWith(`"${f}"`))).toBe(true);
      expect(v).toMatch(/, (serif|sans-serif)$/);
    }
    const guard = B.get(':root:not([data-theme="gilt"]) [data-theme="gilt"]')!;
    for (const [t, v] of guard) {
      expect({ t, web: FAMILIES.some((f) => v.includes(f)) }).toEqual({ t, web: false });
    }
    // No other client file names a theme font family (it would download it under Default).
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.(tsx?|css|html)$/.test(e.name) && !/\.test\./.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const naming = files(join(ROOT, "src/client"))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return FAMILIES.some((fam) => text.includes(fam));
      })
      .map((f) => relative(ROOT, f).replaceAll("\\", "/"));
    expect(naming.sort()).toEqual([
      "src/client/common/styles.css",
      "src/client/common/themes/fonts.css",
    ]);
    const outsideGilt = CSS.replace(/\[data-theme="gilt"\] body,[^{]*\{[^}]*\}/, "").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(FAMILIES.filter((f) => outsideGilt.includes(f))).toEqual([]);
  });
});
