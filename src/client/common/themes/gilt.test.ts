// Gilt & Stone's stylesheet (theme-system FR-THEME-05, -09 – -15, -17, -19; ADR-0069), read as
// text: every rule keyed on gilt, no geometry on a part, meaning tokens untouched, each FR's parts
// present, and every text colour it sets contrast-tested. The computed look in a browser is
// `e2e/theme-geometry.e2e.ts`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "@shared/campaign-management/colors";

const THEMES = import.meta.dir;
const GILT_CSS = readFileSync(join(THEMES, "gilt.css"), "utf8");
const STYLES = readFileSync(join(THEMES, "../styles.css"), "utf8");
const SCOPE = ':root[data-theme="gilt"]';

interface Rule {
  selectors: string[];
  decls: [string, string][];
  /** Enclosing at-rules, outermost first, e.g. `@layer base`. */
  at: string[];
}

/** Splits at top-level commas (not inside `:is(…)` / `:not(…)`). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Style rules of a stylesheet with their at-rule context (`@keyframes` bodies skipped). */
function parse(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let i = 0;
  const walk = (at: string[]): void => {
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const close = text.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1;
        return;
      }
      if (open === -1) return;
      const prelude = text.slice(i, open).trim().replace(/\s+/g, " ");
      i = open + 1;
      if (prelude.startsWith("@keyframes")) {
        let depth = 1;
        while (depth > 0 && i < text.length) {
          if (text[i] === "{") depth++;
          if (text[i] === "}") depth--;
          i++;
        }
        continue;
      }
      if (prelude.startsWith("@")) {
        walk([...at, prelude]);
        continue;
      }
      const end = text.indexOf("}", i);
      const body = text.slice(i, end);
      i = end + 1;
      const decls = splitDecls(body);
      rules.push({ selectors: splitTop(prelude), decls, at });
    }
  };
  walk([]);
  return rules;
}

function splitDecls(body: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let cur = "";
  const push = () => {
    const c = cur.indexOf(":");
    if (c > 0)
      out.push([
        cur.slice(0, c).trim(),
        cur
          .slice(c + 1)
          .trim()
          .replace(/\s+/g, " "),
      ]);
    cur = "";
  };
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) push();
    else cur += ch;
  }
  if (cur.trim()) push();
  return out;
}

const RULES = parse(GILT_CSS);
const PSEUDO = /::(before|after|placeholder|-webkit-scrollbar[\w-]*)$/;
const all = (fn: (sel: string, r: Rule) => boolean) =>
  RULES.flatMap((r) => r.selectors.filter((s) => fn(s, r)));
const declsOf = (pred: (sel: string) => boolean) =>
  RULES.filter((r) => r.selectors.some(pred)).flatMap((r) => r.decls);

/**
 * Box-model and type metrics a part must never get (FR-THEME-05, -06). Glyph choices (family,
 * small caps via `text-transform`) may change text widths only, which FR-THEME-06 allows.
 */
const GEOMETRY =
  /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|padding.*|margin.*|border|border-(top|right|bottom|left)|border(-[a-z]+)?-width|border-(block|inline).*|inset.*|top|right|bottom|left|font|font-size|line-height|letter-spacing|word-spacing|text-indent|display|flex.*|grid.*|gap|row-gap|column-gap|box-sizing|zoom|white-space|overflow.*|aspect-ratio|float|order|align-.*|justify-.*|place-.*|vertical-align|font-weight|font-stretch)$/;

describe("FR-THEME-19 Default unchanged", () => {
  test("FR-THEME-19 Default unchanged: every gilt.css rule is keyed on <html data-theme=gilt>, so none can match under Default or in a preview", () => {
    const loose = all((s) => !s.startsWith(SCOPE) || /^:root\[data-theme="gilt"\][^\s:]/.test(s));
    expect(loose).toEqual([]);
    expect(RULES.length).toBeGreaterThan(80);
    // Only the at-rules this file uses: the colour layer and reduced motion.
    const ats = new Set(RULES.flatMap((r) => r.at));
    expect([...ats].sort()).toEqual(["@layer base", "@media (prefers-reduced-motion: reduce)"]);
    // Imported once, after the fonts and Tailwind (so its `@layer base` joins Tailwind's).
    const imports = [...STYLES.matchAll(/^@import "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["tailwindcss", "./themes/fonts.css", "./themes/gilt.css"]);
  });
});

describe("FR-THEME-05 geometry invariance", () => {
  test("FR-THEME-05 geometry invariance: no part gets a size, spacing, border width, font metric or display; only pseudo-elements are placed", () => {
    const moved = RULES.flatMap((r) =>
      r.selectors
        .filter((s) => !PSEUDO.test(s))
        .flatMap((s) =>
          r.decls
            .filter(([p, v]) => GEOMETRY.test(p) || (p === "position" && v !== "relative"))
            .map(([p, v]) => `${s} { ${p}: ${v} }`),
        ),
    );
    expect(moved).toEqual([]);
    // A drawn pseudo-element (with `content`) is out of the flow.
    const drawn = RULES.filter(
      (r) => r.decls.some(([p]) => p === "content") && r.selectors.every((s) => PSEUDO.test(s)),
    );
    expect(drawn.length).toBeGreaterThan(5);
    for (const r of drawn) {
      expect({ s: r.selectors[0], pos: new Map(r.decls).get("position") }).toEqual({
        s: r.selectors[0],
        pos: "absolute",
      });
    }
  });
});

describe("FR-THEME-09 meaning colours untouched", () => {
  test("FR-THEME-09 meaning colours untouched: gilt.css redefines no meaning token, styles no canvas, and sets colours in the base layer where utilities win", () => {
    const meaning = /^--(hp-|player-|visibility-|creature-|swatch-ink)/;
    expect(RULES.flatMap((r) => r.decls.filter(([p]) => meaning.test(p)))).toEqual([]);
    expect(all((s) => /\bcanvas\b/.test(s))).toEqual([]);
    // Unlayered `color` only on parts that never carry a meaning colour.
    const unlayered = RULES.filter((r) => r.at.length === 0)
      .filter((r) => r.decls.some(([p]) => p === "color"))
      .flatMap((r) => r.selectors);
    for (const s of unlayered) {
      expect({
        s,
        ok: /sheet-box|sheet-ability|sheet-shield|sheet-roll|charx-tabs|tabs-trigger|placeholder/.test(
          s,
        ),
      }).toEqual({ s, ok: true });
    }
  });
});

describe("FR-THEME-10 – -15 parts", () => {
  const sel = (needle: string) => (s: string) => s.includes(needle);
  const has = (needle: string, prop: string, value: RegExp) =>
    declsOf(sel(needle)).some(([p, v]) => p === prop && value.test(v));

  test("FR-THEME-10 window frame: double rule (frame shadow), four corner pieces, grain, title face, gem close, stone minimise, brighter rule when focused", () => {
    expect(has('[data-testid="ui-window"]', "box-shadow", /var\(--frame-shadow\)/)).toBe(true);
    const corners = declsOf((s) => s.endsWith('[data-testid="ui-window"]::after'))
      .map(([, v]) => v)
      .join(" ");
    for (const c of [
      "--frame-corner)",
      "--frame-corner-tr",
      "--frame-corner-bl",
      "--frame-corner-br",
    ])
      expect(corners).toContain(c);
    expect(has('[data-testid="ui-window"]', "background-image", /--panel-grain/)).toBe(true);
    expect(has('[data-testid="ui-window-title"]', "font-family", /--font-title/)).toBe(true);
    expect(
      has('[data-testid="ui-window-close"]', "background-image", /radial-gradient.*--gem-hi/),
    ).toBe(true);
    expect(has('[data-testid="ui-window-close"]', "border-radius", /50%/)).toBe(true);
    expect(has('[data-testid="ui-window-minimise"]', "background-image", /linear-gradient/)).toBe(
      true,
    );
    expect(
      has(
        '[data-testid="ui-window"][data-focused="true"]::before',
        "box-shadow",
        /--frame-rule-strong/,
      ),
    ).toBe(true);
  });

  test("FR-THEME-11 controls: every listed component has a Gilt rule", () => {
    const slots = [
      "button",
      "tabs-list",
      "tabs-trigger",
      "checkbox",
      "checkbox-indicator",
      "switch",
      "switch-thumb",
      "input",
      "select-trigger",
      "select-content",
      "slider-track",
      "slider-thumb",
      "toggle-group",
      "toggle-group-item",
      "badge",
      "alert",
      "skeleton",
      "progress",
      "progress-indicator",
      "table-head",
      "table-row",
      "card",
      "collapsible-trigger",
      "dialog-content",
      "popover-content",
      "dropdown-menu-content",
    ];
    const missing = slots.filter((s) => all(sel(`[data-slot="${s}"]`)).length === 0);
    expect(missing).toEqual([]);
    // Button states: hover, pressed, on, disabled; the active tab's gem underline + diamond.
    for (const state of [":hover", ":active", '[aria-pressed="true"]', ":disabled"]) {
      expect(
        all((s) => s.includes('[data-slot="button"]') && s.includes(state)).length,
      ).toBeGreaterThan(0);
    }
    expect(has('[data-state="active"]::after', "background", /--gem/)).toBe(true);
    expect(has('[data-state="active"]::before', "transform", /rotate\(45deg\)/)).toBe(true);
  });

  test("FR-THEME-12 scroll tooltip: parchment, rolled ends, ink in the number face, unrolls from the centre in 260 ms, still under reduced motion", () => {
    const tip = '[data-slot="tooltip-content"]';
    expect(has(tip, "background-color", /var\(--parchment\)/)).toBe(true);
    expect(has(tip, "color", /var\(--parchment-ink\)/)).toBe(true);
    expect(has(tip, "font-family", /var\(--font-num\)/)).toBe(true);
    expect(has(tip, "animation", /^gs-unroll 260ms/)).toBe(true);
    expect(GILT_CSS).toMatch(
      /@keyframes gs-unroll \{\s*from \{\s*clip-path: inset\(-24px 46% -24px 46%\)/,
    );
    expect(all((s) => s.endsWith(`${tip}::before`) || s.endsWith(`${tip}::after`)).length).toBe(4);
    const still = RULES.filter((r) => r.at.includes("@media (prefers-reduced-motion: reduce)"));
    expect(
      still.some((r) => r.selectors.some(sel(tip)) && new Map(r.decls).get("animation") === "none"),
    ).toBe(true);
  });

  test("FR-THEME-13 toasts: notification cards, the damage-card popup and sonner framed like a small window, no corner pieces", () => {
    for (const t of [
      '[data-testid="note-toast"]',
      '[data-testid="cbt-popup"]',
      "[data-sonner-toast]",
    ]) {
      expect(has(t, "box-shadow", /inset 0 0 0 1px var\(--frame-rule\)/)).toBe(true);
      expect(has(t, "background-image", /--frame-corner/)).toBe(false);
    }
  });

  test("FR-THEME-14 scrollbars: thin gold thumb on a dark track everywhere, WebKit fallback", () => {
    const base = RULES.filter(
      (r) => r.at.includes("@layer base") && r.selectors.includes(`${SCOPE} *`),
    );
    expect(base.flatMap((r) => r.decls)).toEqual([
      ["scrollbar-width", "thin"],
      ["scrollbar-color", "var(--frame-rule-strong) var(--gs-track)"],
    ]);
    expect(all((s) => s.endsWith("::-webkit-scrollbar-thumb")).length).toBe(1);
  });

  test("FR-THEME-15 numbers: the number face with lining, tabular figures on boxes, tables, rows and results", () => {
    const num = RULES.find((r) => r.selectors.includes(`${SCOPE} .tabular-nums`));
    expect(new Map(num?.decls)).toEqual(
      new Map([
        ["font-family", "var(--font-num)"],
        ["font-variant-numeric", "lining-nums tabular-nums"],
      ]),
    );
    for (const part of ['[data-slot="table-cell"]', "cbt-init-row-init", "strong[data-landing]"])
      expect(num?.selectors.some(sel(part))).toBe(true);
    expect(
      has('[data-slot="sheet-roll"]', "font-variant-numeric", /lining-nums tabular-nums/),
    ).toBe(true);
  });
});

// ---- FR-THEME-17 contrast ----

/** Custom properties of a rule body, by selector. */
function props(css: string, selector: string): Map<string, string> {
  const r = parse(css).find((x) => x.selectors.join(", ") === selector);
  return new Map((r?.decls ?? []).filter(([p]) => p.startsWith("--")));
}
const PALETTE = props(GILT_CSS, `${SCOPE} body`);
const TOKENS = props(STYLES, '[data-theme="gilt"] body, body [data-theme="gilt"]');
const DEFAULT_TOKENS = props(STYLES, ':root, [data-theme="default"]');

/** A token's gilt colour (palette, then gilt tokens, then Default's), `var()` resolved. */
function hex(t: string): string {
  const v = PALETTE.get(t) ?? TOKENS.get(t) ?? DEFAULT_TOKENS.get(t);
  if (!v) throw new Error(`${t} undefined`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref?.[1]) return hex(ref[1]);
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${t}: not a hex colour: ${v}`);
  return v.toLowerCase();
}

describe("FR-THEME-17 contrast", () => {
  test("FR-THEME-17 contrast: every text colour gilt.css sets is a token (so this test sees it)", () => {
    const text = /^(color|--([\w-]+-)?foreground)$/;
    const literal = RULES.flatMap((r) =>
      r.decls
        .filter(([p, v]) => text.test(p) && !/^var\(--[\w-]+\)$/.test(v))
        .map(([p, v]) => `${p}: ${v}`),
    );
    expect(literal).toEqual([]);
  });

  test("FR-THEME-17 contrast (gilt.css): body text ≥ 7 : 1, labels / numbers / gold ≥ 4.5 : 1 on their surfaces, the gold focus ring ≥ 3 : 1 on every surface", () => {
    const pairs: [string, string, number][] = [
      // Body text and numbers on the dark surfaces this file adds.
      ["--foreground", "--gs-field", 7],
      ["--foreground", "--gs-box", 7],
      ["--foreground", "--gs-panel-lo", 7],
      ["--foreground", "--gs-menu", 7],
      ["--foreground", "--gs-chip", 7],
      ["--foreground", "--gs-roll", 7],
      ["--foreground", "--gs-wash-turn", 7],
      ["--muted-foreground", "--gs-box", 4.5],
      ["--muted-foreground", "--gs-panel-lo", 4.5],
      ["--muted-foreground", "--gs-menu", 4.5],
      // Gold labels on stone, boxes, menus, the log result.
      ["--gold", "--gs-stone", 4.5],
      ["--gold", "--gs-stone-hi", 4.5],
      ["--gold", "--gs-min-stone", 4.5],
      ["--gold", "--gs-box", 4.5],
      ["--gold", "--gs-menu", 4.5],
      ["--gold", "--gs-result", 4.5],
      ["--gold", "--gs-tool-stone", 4.5],
      ["--gs-tab", "--card", 4.5],
      ["--gs-tool", "--gs-tool-stone", 4.5],
      ["--gs-label-hover", "--gs-stone-hi", 4.5],
      ["--gs-label-on", "--gs-on-hi", 4.5],
      ["--gs-label-on", "--gs-on", 4.5],
      ["--gs-label-bright", "--gs-on-hi", 4.5],
      ["--gs-label-bright", "--gs-highlight", 4.5],
      ["--gs-label-glow", "--gs-tool-on", 4.5],
      ["--gs-label-glow", "--gs-roll-hi", 4.5],
      ["--gs-primary-ink", "--gs-primary-hi", 4.5],
      ["--gs-danger-ink", "--gs-danger-hi", 4.5],
      ["--foreground", "--gs-row-hover", 4.5],
      // The gem's × (an icon: 3 : 1).
      ["--gs-gem-ink", "--gem", 3],
      // The scroll tooltip's inks on parchment, its light and dark ends included.
      ["--parchment-ink", "--parchment", 7],
      ["--parchment-ink", "--gs-parch-hi", 7],
      ["--parchment-ink", "--gs-parch-lo", 4.5],
      ["--gs-ink-faint", "--parchment", 4.5],
      ["--gs-ink-accent", "--parchment", 4.5],
      ["--gs-ink-positive", "--parchment", 4.5],
      ["--gs-ink-caution", "--parchment", 4.5],
      ["--gs-ink-danger", "--parchment", 4.5],
    ];
    const surfaces = [
      "--background",
      "--card",
      "--popover",
      "--secondary",
      "--accent",
      "--gs-menu",
      "--gs-field",
      "--gs-box",
      "--gs-panel-lo",
      "--gs-stone",
      "--gs-stone-hi",
      "--gs-min-stone",
      "--gs-tool-stone",
      "--gs-on-hi",
      "--gs-primary-hi",
      "--gs-danger-hi",
      "--gs-chip",
      "--gs-roll-hi",
    ];
    for (const s of surfaces) pairs.push(["--gold", s, 3]);
    const low = pairs
      .map(([fg, bg, min]) => ({ fg, bg, min, r: contrastRatio(hex(fg), hex(bg)) }))
      .filter((p) => p.r < p.min)
      .map((p) => `${p.fg} on ${p.bg}: ${p.r.toFixed(2)} < ${p.min}`);
    expect(low).toEqual([]);
    // The focus ring is the gold outline on every focusable part.
    const ring = RULES.find((r) => r.selectors.includes(`${SCOPE} :focus-visible`));
    expect(new Map(ring?.decls).get("outline")).toBe("2px solid var(--gold)");
  });
});
