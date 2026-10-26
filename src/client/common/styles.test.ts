// Theme-system T0 colour cleanup (ADR-0069, FR-THEME-19): no raw Tailwind palette class in the
// client, and every class the cleanup swapped resolves to exactly the colour it had before. The
// check compiles `styles.css` with Tailwind's own compiler and resolves each declaration's
// `var()` chain, so a token that drifts from the replaced colour fails here, not in a screenshot.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { compile } from "tailwindcss";

const ROOT = join(import.meta.dir, "../../..");
const CLIENT = join(ROOT, "src/client");
const TW = join(ROOT, "node_modules/tailwindcss");

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY =
  "bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|outline|divide|from|via|to|decoration|placeholder|caret|accent|shadow";
/** A raw palette colour class (group 1), any variant prefix (`hover:`, `dark:`), opacity (`/60`). */
const RAW = new RegExp(
  `(?:^|[^\\w-])((?:${UTILITY})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:/\\d+)?)(?![\\w-])`,
  "gm",
);
const raw = (text: string) => [...text.matchAll(RAW)].map((m) => ({ cls: m[1], at: m.index }));

/** Files that may still use a raw palette class, with the reason. */
const ALLOWED: Record<string, string> = {
  "src/client/common/features/character-sheet/MainTab.tsx":
    "CS (build/charx-print-sheet) owns its cleanup this sprint (seams)",
  "src/client/common/features/character-sheet/SummaryCard.tsx":
    "CS (build/charx-print-sheet) owns its cleanup this sprint (seams)",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(tsx?|html)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("FR-THEME-19 no raw palette classes", () => {
  test("FR-THEME-19 the pattern catches what the cleanup removed", () => {
    const hits = raw("bg-black/60 dark:text-amber-400 text-white ring-black/60 bg-emerald-500");
    expect(hits.map((h) => h.cls)).toEqual([
      "bg-black/60",
      "text-amber-400",
      "text-white",
      "ring-black/60",
      "bg-emerald-500",
    ]);
    expect(raw("bg-hp-down text-swatch-ink data-white-x player-sky")).toEqual([]);
  });

  test("FR-THEME-19 src/client uses semantic tokens only (allow-list with reasons)", () => {
    const found: string[] = [];
    for (const file of sources(CLIENT)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (ALLOWED[rel]) continue;
      const text = readFileSync(file, "utf8");
      for (const { cls, at } of raw(text)) {
        found.push(`${rel}:${text.slice(0, at).split("\n").length} ${cls}`);
      }
    }
    expect(found).toEqual([]);
  });
});

// ---- computed colour per changed element ----

async function compiler() {
  const css = readFileSync(join(ROOT, "src/client/common/styles.css"), "utf8");
  return compile(css, {
    // styles.css's own folder: its relative `@import` (themes/fonts.css) resolves from there.
    base: join(ROOT, "src/client/common"),
    loadStylesheet: async (id: string, base: string) => {
      const path =
        id === "tailwindcss"
          ? join(TW, "index.css")
          : id.startsWith("tailwindcss/")
            ? join(TW, id.slice("tailwindcss/".length))
            : join(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
}

/**
 * The colour declarations one utility class generates, `var()`s resolved, as the browser sees
 * them: under `<html class="dark">` (both index.html files) and with `color-mix` support (the
 * `@supports` branch wins over Tailwind's fallback).
 */
async function resolved(cls: string): Promise<Record<string, string>> {
  const out = (await compiler()).build([cls]);
  const start = out.indexOf("@layer utilities");
  let end = out.indexOf("{", start) + 1;
  for (let depth = 1; depth > 0; end++) depth += out[end] === "{" ? 1 : out[end] === "}" ? -1 : 0;
  // The `@supports (color: color-mix(…))` condition is not a declaration.
  const block = out.slice(start, end).replace(/@supports[^{]*{/g, "{");
  const vars = new Map<string, string>();
  for (const m of (out.slice(0, start) + out.slice(end)).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name && value) vars.set(name, value.trim());
  }
  const expand = (v: string, depth = 0): string =>
    depth > 10
      ? v
      : v.replace(/var\((--[\w-]+)\)/g, (_, n: string) =>
          expand(vars.get(n) ?? `<${n}?>`, depth + 1),
        );
  const decls: Record<string, string> = {};
  for (const m of block.matchAll(
    /(?<![\w-])((?:background-)?color|--tw-ring-color):\s*([^;]+);/g,
  )) {
    const [, prop, value] = m;
    if (prop && value) decls[prop] = expand(value.trim()); // later (the @supports branch) wins
  }
  if (Object.keys(decls).length === 0) throw new Error(`${cls}: no colour declaration`);
  return decls;
}

/** Each swapped element: file, the new class string (must be in the file), old → new classes. */
const SWAPS: { el: string; file: string; marker: string; pairs: [string, string][] }[] = [
  {
    el: "Button destructive label",
    file: "src/client/common/components/ui/button.tsx",
    marker: "bg-destructive text-destructive-foreground",
    pairs: [["text-white", "text-destructive-foreground"]],
  },
  {
    el: "DialogContent overlay",
    file: "src/client/common/components/ui/overlays.tsx",
    marker: "bg-overlay/60",
    pairs: [["bg-black/60", "bg-overlay/60"]],
  },
  {
    el: "ColorPicker swatch check",
    file: "src/client/common/features/campaign-management/ColorPicker.tsx",
    marker: "text-swatch-ink",
    pairs: [["text-black", "text-swatch-ink"]],
  },
  {
    el: "trigger editor confirm label (mod-trig-editor-confirm)",
    file: "src/client/common/features/effect-modifiers/trigger-editor.tsx",
    marker: "text-xs text-caution",
    pairs: [["text-amber-500", "text-caution"]],
  },
  {
    el: "identity chip dot ring (ui-prefs-chip-dot)",
    file: "src/client/common/features/play-shell/IdentityChip.tsx",
    marker: "ring-1 ring-swatch-ink/60",
    pairs: [["ring-black/60", "ring-swatch-ink/60"]],
  },
  {
    el: "palette overlay (ui-palette)",
    file: "src/client/common/features/play-shell/palette/Palette.tsx",
    marker: "bg-overlay/40",
    pairs: [["bg-black/40", "bg-overlay/40"]],
  },
  {
    el: "shortcuts sheet overlay (ui-shortcuts)",
    file: "src/client/common/features/play-shell/palette/ShortcutsSheet.tsx",
    marker: "bg-overlay/40",
    pairs: [["bg-black/40", "bg-overlay/40"]],
  },
  {
    el: "facility state chip: building",
    file: "src/client/common/features/strongholds/FacilitiesTab.tsx",
    marker: "bg-caution/15 text-caution-foreground",
    pairs: [
      ["bg-amber-500/15", "bg-caution/15"],
      // `dark:text-amber-400` won over `text-amber-700` (html.dark is always set).
      ["dark:text-amber-400", "text-caution-foreground"],
    ],
  },
  {
    el: "facility state chip: built",
    file: "src/client/common/features/strongholds/FacilitiesTab.tsx",
    marker: "bg-positive/15 text-positive-foreground",
    pairs: [
      ["bg-emerald-500/15", "bg-positive/15"],
      ["dark:text-emerald-400", "text-positive-foreground"],
    ],
  },
  {
    el: "DM initiative row temp HP (cbtx-init-row-temp)",
    file: "src/client/dm/features/combat-extras/row.tsx",
    marker: "shrink-0 text-hp-temp",
    pairs: [["text-sky-400", "text-hp-temp"]],
  },
  {
    el: "attack popup defense hint (mod-popup-part-defense)",
    file: "src/client/dm/features/combat-tracker/attack-popup.tsx",
    marker: '"text-caution-foreground"',
    pairs: [["dark:text-amber-400", "text-caution-foreground"]],
  },
  {
    el: "share dialog online dot",
    file: "src/client/dm/features/party-board/ShareDialog.tsx",
    marker: "rounded-full bg-positive",
    pairs: [["bg-emerald-500", "bg-positive"]],
  },
  {
    el: "player initiative row temp HP (cbtx-init-row-temp)",
    file: "src/client/player/features/combat-tracker/initiative-window.tsx",
    marker: "shrink-0 text-hp-temp",
    pairs: [["text-sky-400", "text-hp-temp"]],
  },
  {
    el: "dialog overlay (Dialog parts; the present popup since K0, party-present-popup)",
    file: "src/client/common/components/ui/overlays.tsx",
    marker: "bg-overlay/60",
    pairs: [["bg-black/60", "bg-overlay/60"]],
  },
];

describe("FR-THEME-19 swapped classes keep their computed colour", () => {
  for (const s of SWAPS) {
    test(`FR-THEME-19 ${s.el}`, async () => {
      expect(readFileSync(join(ROOT, s.file), "utf8")).toContain(s.marker);
      for (const [before, after] of s.pairs) {
        expect({ after, decls: await resolved(after) }).toEqual({
          after,
          decls: await resolved(before),
        });
      }
    });
  }

  test("FR-THEME-19 the check tells colours and opacities apart", async () => {
    expect(await resolved("text-caution")).not.toEqual(await resolved("text-amber-400"));
    expect(await resolved("bg-overlay/40")).not.toEqual(await resolved("bg-black/60"));
    expect((await resolved("bg-overlay/40"))["background-color"]).toBe(
      "color-mix(in oklab, #000 40%, transparent)",
    );
  });

  test("FR-THEME-19 text on hp.down stays white (CS uses it for the sheet's Down badge)", async () => {
    expect(await resolved("text-hp-down-foreground")).toEqual(await resolved("text-white"));
  });
});
