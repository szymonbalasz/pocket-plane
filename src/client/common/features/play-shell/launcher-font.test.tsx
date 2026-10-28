// FR-THEME-07, BL-136 (FR-THEME-05): the launcher fits its labels at one theme-independent width,
// the wider of Simple Dark's font (measured) and Gilt & Stone's label face (a table off the
// committed font), so FR-SHELL-43's fit is the same bar under both themes. No DOM here: the
// launcher is rendered statically and `getComputedStyle` / the canvas are stubs (the stubbed theme
// font is wider per glyph).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import {
  fitLabelWidth,
  forgetLabelWidths,
  Launcher,
  labelWidth,
  launcherFont,
  remeasureLabelWidths,
} from "./Launcher";
import {
  fitLauncher,
  GILT_LABEL_ADVANCE,
  GILT_LABEL_UPEM,
  giltLabelWidth,
  LAUNCHER_GUTTER,
  LAUNCHER_MIN_ZONE,
  launcherMetrics,
} from "./launcher-fit";
import { createWindowRegistry, defineWindow } from "./registry";
import { ShellProvider } from "./ShellContext";
import {
  ALEGREYA_ADVANCE,
  ALEGREYA_UPEM,
  alegreyaWeight,
  giltTextWidth,
  launcherRoom,
  runExtra,
} from "./topbar-room";

const BODY = "ui-sans-serif, system-ui, sans-serif";
/** Simple Dark's label font: what the launcher measures under every theme. */
const FIXED = `500 12px ${BODY}`;
const THEMED = `700 12px "Alegreya Sans", ${BODY}`;
/** Glyph advance per font, px: the stubbed theme font runs wider. */
const ADVANCE: Record<string, number> = { [FIXED]: 7, [THEMED]: 9 };

/** The font a stub element computes to: its classes, under the stubbed theme or not. */
let themed = false;
/** `<html>`'s `--font-sans` (Tailwind's, the same under every theme). */
let sansVar = BODY;
const measured: { font: string; text: string }[] = [];

const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, window: g.window, getComputedStyle: g.getComputedStyle };
beforeAll(() => {
  const ctx = {
    font: "",
    measureText(text: string) {
      measured.push({ font: ctx.font, text });
      return { width: text.length * (ADVANCE[ctx.font] ?? 100) };
    },
  };
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  g.document = {
    title: "",
    hidden: false,
    body: { className: "" },
    documentElement: { root: true },
    createElement: () => ({ getContext: () => ctx }),
    querySelector: () => null,
  };
  g.getComputedStyle = (el: { className: string; root?: true }) => {
    if (el.root) {
      return { getPropertyValue: (n: string) => (n === "--font-sans" ? ` ${sansVar}` : "") };
    }
    const label = /\btext-xs\b/.test(el.className) && /\bfont-medium\b/.test(el.className);
    const size = label ? "12px" : "14px";
    return themed
      ? { fontWeight: "700", fontSize: size, fontFamily: `"Alegreya Sans", ${BODY}` }
      : { fontWeight: label ? "500" : "400", fontSize: size, fontFamily: BODY };
  };
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});
beforeEach(() => {
  themed = false;
  sansVar = BODY;
  measured.length = 0;
  forgetLabelWidths();
});

const defs = ["Initiative", "Game log", "Party Manager", "Handouts", "Compendium", "Scenes"].map(
  (label, i) =>
    defineWindow({
      kind: `cmp.w${i}`,
      title: label,
      clients: ["dm"],
      defaultSize: { w: 300, h: 300 },
      minSize: { w: 200, h: 200 },
      defaultPosition: { anchor: "top-left", dx: 56 },
      launcher: { icon: () => null, label, order: i },
      component: () => null,
    }),
);
const registry = createWindowRegistry("dm", defs);

/** The launcher's markup at viewport width `w` (and its top-bar zone `room`, FR-KIT-14). */
function launcherHtml(w = 1280, room?: number): string {
  const store = {
    ...emptyStore(),
    you: { campaignId: "c1", role: "dm", playerId: null },
  } as unknown as RecordStore;
  const sync = createStore<SyncState>()(
    () => ({ state: "live", store, notLiveSince: null, everLive: true }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <ShellProvider registry={registry}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Launcher
            defs={defs}
            windows={[]}
            viewport={{ w, h: 720 }}
            room={room}
            dispatch={() => {}}
          />
        </TooltipProvider>
      </ShellProvider>
    </SyncContext.Provider>,
  );
}

/** `data-compact="false"` buttons in the markup: the labelled ones. */
const labelled = (html: string) =>
  (html.match(/data-testid="ui-launcher-button"[^>]*?data-compact="false"/g) ?? []).length;

describe("FR-KIT-14 launcher fits its zone", () => {
  test("FR-KIT-14 FR-SHELL-43 the fit width is the top bar's centre zone, not the viewport: a narrow zone drops labels, then moves buttons into ⋯", () => {
    const overflow = (html: string) =>
      Number(/data-testid="ui-launcher-overflow" data-count="(\d+)"/.exec(html)?.[1] ?? -1);
    // The whole viewport (no zone measured yet): every label.
    const wide = launcherHtml(1600);
    expect(labelled(wide)).toBe(defs.length);
    expect(overflow(wide)).toBe(0);
    // The same viewport, a 300-px zone: icon-only buttons, then the menu.
    const narrow = launcherHtml(1600, 300);
    expect(narrow).toContain('data-testid="ui-launcher" data-compact="true"');
    expect(labelled(narrow)).toBeLessThan(defs.length);
    expect(launcherHtml(1600, 80)).not.toContain('data-testid="ui-launcher-button"');
    expect(overflow(launcherHtml(1600, 80))).toBe(defs.length);
  });
});

/** The committed font's advances for U+0020–U+007E: its WOFF2 tables (head, hhea, cmap, hmtx). */
function fontAdvances(file: string): { upem: number; adv: number[] } {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // WOFF2's known-table order (its spec's table 3), as far as the GSUB entry.
  const tags = [
    ...["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm"],
    ...["glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern"],
    ...["LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB"],
  ];
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = dv.getUint8(p++);
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error("bad UIntBase128");
  };
  const dir: { tag: string; len: number }[] = [];
  for (let i = dv.getUint16(12); i > 0; i--) {
    const flags = dv.getUint8(p++);
    let tag = tags[flags & 0x3f] ?? "";
    if ((flags & 0x3f) === 63) {
      tag = String.fromCharCode(...buf.subarray(p, p + 4));
      p += 4;
    }
    const v = flags >> 6;
    const orig = base128();
    const transformed = tag === "glyf" || tag === "loca" ? v === 0 : v !== 0;
    if (transformed && tag === "hmtx") throw new Error("transformed hmtx");
    dir.push({ tag, len: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + dv.getUint32(20)));
  const t = new Map<string, Buffer>();
  let off = 0;
  for (const d of dir) {
    t.set(d.tag, data.subarray(off, off + d.len));
    off += d.len;
  }
  const table = (tag: string) => t.get(tag) as Buffer;
  const cmap = table("cmap");
  const glyph = new Map<number, number>();
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const sub = cmap.readUInt32BE(8 + i * 8);
    const win = cmap.readUInt16BE(4 + i * 8) === 3 && cmap.readUInt16BE(6 + i * 8) === 1;
    if (!win || cmap.readUInt16BE(sub) !== 4) continue;
    const seg2 = cmap.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + seg2 + 2;
    const deltas = starts + seg2;
    const ranges = deltas + seg2;
    for (let s = 0; s < seg2 / 2; s++) {
      const start = cmap.readUInt16BE(starts + s * 2);
      const delta = cmap.readInt16BE(deltas + s * 2);
      const ro = cmap.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= Math.min(cmap.readUInt16BE(ends + s * 2), 126); c++) {
        const g0 = ro === 0 ? c : cmap.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2);
        glyph.set(c, ro !== 0 && g0 === 0 ? 0 : (g0 + delta) & 0xffff);
      }
    }
  }
  const metrics = table("hhea").readUInt16BE(34);
  const adv: number[] = [];
  for (let c = 32; c <= 126; c++) {
    adv.push(table("hmtx").readUInt16BE(4 * Math.min(glyph.get(c) ?? 0, metrics - 1)));
  }
  return { upem: table("head").readUInt16BE(18), adv };
}

describe("FR-THEME-07 BL-136 launcher labels fit at one theme-independent width", () => {
  test("FR-THEME-05 FR-THEME-07 BL-136 the measured font is Simple Dark's label font under every theme: `500 12px` + `<html>`'s `--font-sans`", () => {
    expect(launcherFont()).toBe(FIXED);
    themed = true; // a theme's button font is never read
    expect(launcherFont()).toBe(FIXED);
    sansVar = "";
    expect(launcherFont()).toBe(`500 12px ${BODY}`); // no variable: Tailwind's stack
  });

  test("BL-136 the Gilt label table is the committed font's (IM Fell English SC 400, U+0020–U+007E)", () => {
    const file = fileURLToPath(
      new URL("../../themes/fonts/im-fell-english-sc-400.latin.woff2", import.meta.url),
    );
    const font = fontAdvances(file);
    expect(GILT_LABEL_UPEM).toBe(font.upem);
    expect([...GILT_LABEL_ADVANCE]).toEqual(font.adv);
  });

  test("BL-136 a label's fit width is the wider of Simple Dark's measure and Gilt's face; outside the table a character counts as the widest", () => {
    const units = [..."Creatures"].reduce(
      (n, c) => n + (GILT_LABEL_ADVANCE[c.charCodeAt(0) - 32] ?? 0),
      0,
    );
    expect(giltLabelWidth("Creatures")).toBe(Math.ceil((units * 12) / 2048) + 1);
    expect(fitLabelWidth("Creatures", FIXED)).toBe(
      Math.max(9 * 7 + 1, giltLabelWidth("Creatures")),
    );
    ADVANCE[FIXED] = 20; // a wide system font: its measure wins
    forgetLabelWidths();
    try {
      expect(fitLabelWidth("Creatures", FIXED)).toBe(9 * 20 + 1);
    } finally {
      ADVANCE[FIXED] = 7;
    }
    const widest = Math.max(...GILT_LABEL_ADVANCE);
    expect(giltLabelWidth("é")).toBe(Math.ceil((widest * 12) / 2048) + 1);
  });

  test("FR-THEME-05 FR-SHELL-43 BL-136 K7's threshold: at every zone width the bar labels the same buttons under Simple Dark and Gilt & Stone (was: the theme's font measured, a label kept in one only)", () => {
    const m = launcherMetrics(new Map(defs.map((d) => [d.kind, d.launcher?.label ?? ""])), (l) =>
      fitLabelWidth(l, FIXED),
    );
    const items = defs.map((d, i) => ({ kind: d.kind, order: i, state: "closed" as const }));
    const all = 10 + defs.reduce((s, d) => s + m.full(d.kind) + 4, 0) + 40 + 2 * LAUNCHER_GUTTER;
    for (const room of [all, all - 1, all - 40, all - 120]) {
      themed = false;
      const plain = launcherHtml(1600, room);
      themed = true;
      forgetLabelWidths();
      expect(launcherHtml(1600, room)).toBe(plain);
      expect(labelled(plain)).toBe(fitLauncher(items, room, m).labelled.length);
    }
    expect(labelled(launcherHtml(1600, all))).toBe(defs.length);
    expect(labelled(launcherHtml(1600, all - 1))).toBeLessThan(defs.length);
  });

  test("FR-THEME-07 the button's font is the label's: labels carry no size of their own", () => {
    const markup = launcherHtml();
    const label = markup.match(/<span>Initiative<\/span>/);
    expect(label).not.toBeNull();
  });

  test("FR-THEME-07 labels are measured once per font string; a web font load measures again", () => {
    expect(labelWidth("Initiative", FIXED)).toBe(10 * 7 + 1);
    expect(labelWidth("Initiative", FIXED)).toBe(71);
    expect(measured).toEqual([{ font: FIXED, text: "Initiative" }]);
    forgetLabelWidths(); // a web font loaded: same string, new glyphs → measured again
    labelWidth("Initiative", FIXED);
    expect(measured).toHaveLength(2);
  });

  test("FR-THEME-07 FR-SHELL-43 a web font load re-fits only when a label's width changed (a window's title face loading late leaves the bar alone)", () => {
    labelWidth("Initiative", FIXED);
    labelWidth("Game log", FIXED);
    measured.length = 0;
    // A face the labels don't use finished loading: the same widths → no re-fit.
    expect(remeasureLabelWidths()).toBe(false);
    expect(measured.map((m) => m.text)).toEqual(["Initiative", "Game log"]);
    expect(labelWidth("Initiative", FIXED)).toBe(71);
    // The labels' own face arrived: new glyph widths → re-fit, the new widths kept.
    ADVANCE[FIXED] = 8;
    try {
      expect(remeasureLabelWidths()).toBe(true);
      expect(labelWidth("Initiative", FIXED)).toBe(81);
      expect(remeasureLabelWidths()).toBe(false);
    } finally {
      ADVANCE[FIXED] = 7;
    }
  });
});

describe("FR-THEME-05 FR-KIT-14 BL-136 the launcher's room is the same under both themes", () => {
  test("BL-136 the Gilt body tables are the committed fonts' (Alegreya Sans 400, 500, 700, U+0020–U+007E)", () => {
    for (const w of [400, 500, 700] as const) {
      const file = fileURLToPath(
        new URL(`../../themes/fonts/alegreya-sans-${w}.latin.woff2`, import.meta.url),
      );
      const font = fontAdvances(file);
      expect(ALEGREYA_UPEM).toBe(font.upem);
      expect([...ALEGREYA_ADVANCE[w]]).toEqual(font.adv);
    }
    // CSS font matching among 400, 500, 700.
    expect([300, 400, 450, 500, 600, 700, 900].map(alegreyaWeight)).toEqual([
      400, 400, 500, 500, 700, 700, 700,
    ]);
  });

  test("BL-136 a run's Gilt width: the title face is IM Fell (synthetic bold from 600), the rest Alegreya Sans", () => {
    const units = [..."Ab"].reduce(
      (n, c) => n + (GILT_LABEL_ADVANCE[c.charCodeAt(0) - 32] ?? 0),
      0,
    );
    expect(giltTextWidth("Ab", "title", 400, 18)).toBeCloseTo((units * 18) / 2048 + 1);
    expect(giltTextWidth("Ab", "title", 600, 18)).toBeCloseTo((units * 18) / 2048 + 2 * 0.75 + 1);
    const body = [..."Ab"].reduce(
      (n, c) => n + (ALEGREYA_ADVANCE[500][c.charCodeAt(0) - 32] ?? 0),
      0,
    );
    expect(giltTextWidth("Ab", "body", 500, 13)).toBeCloseTo((body * 13) / 1000 + 1);
  });

  test("FR-THEME-05 FR-KIT-14 BL-136 the same room drawn under Simple Dark and Gilt & Stone: each run at its widest; never wider than the zone drawn", () => {
    // Player 1's bar at 1440: campaign name (title face, 600 18px), "· playing as Player 1"
    // (body, 12px), "Live" (body, 13px), the chip's name (body, 14px, max 160).
    const texts = [
      { text: "The Sunken Crown", px: 18, weight: 600, face: "title" as const, side: "left" },
      { text: "· playing as Player 1", px: 12, weight: 400, face: "body" as const, side: "left" },
      { text: "Live", px: 13, weight: 400, face: "body" as const, side: "right" },
      { text: "Player 1", px: 14, weight: 400, face: "body" as const, side: "right", cap: 160 },
    ];
    // Gilt draws each run a little narrower than our estimate (kerning); Simple Dark's per-glyph
    // width runs 6–9 px.
    for (const sd of [6, 7.5, 9]) {
      const bar = 1416;
      const draw = (theme: "plain" | "gilt") => {
        const runs = texts.map((t) => {
          const plain = t.text.length * sd;
          const gilt = giltTextWidth(t.text, t.face, t.weight, t.px) - 0.7;
          return { ...t, plain, current: theme === "plain" ? plain : gilt };
        });
        const drawn = (side: string) =>
          runs
            .filter((r) => r.side === side)
            .reduce((s, r) => s + Math.min(r.cap ?? Number.POSITIVE_INFINITY, r.current), 0);
        const left = 20 + drawn("left");
        const right = 120 + drawn("right");
        const centre = bar - left - right;
        const room = launcherRoom({
          centre,
          left,
          leftCap: bar * 0.3,
          leftTruncated: false,
          leftRuns: runs.filter((r) => r.side === "left"),
          rightRuns: runs.filter((r) => r.side === "right"),
        });
        expect(room).toBeLessThanOrEqual(centre);
        return room;
      };
      expect(draw("gilt")).toBe(draw("plain"));
    }
  });

  test("FR-KIT-14 BL-136 a title at its 30 % cap in either theme counts at the cap; a run in a capped box counts within its cap", () => {
    const run = (current: number, plain: number) => ({
      text: "M".repeat(30), // Gilt: about 531 px
      px: 18,
      weight: 600,
      face: "title" as const,
      current,
      plain,
    });
    // Simple Dark draws it at 400 (no cut); Gilt needs more than the 420 cap.
    const plain = launcherRoom({
      centre: 600,
      left: 400,
      leftCap: 420,
      leftTruncated: false,
      leftRuns: [run(400, 400)],
      rightRuns: [],
    });
    const gilt = launcherRoom({
      centre: 580,
      left: 420,
      leftCap: 420,
      leftTruncated: true,
      leftRuns: [run(430, 400)],
      rightRuns: [],
    });
    expect(plain).toBe(580);
    expect(gilt).toBe(580);
    expect(
      runExtra({
        text: "Name",
        px: 14,
        weight: 400,
        face: "body",
        current: 150,
        plain: 170,
        cap: 160,
      }),
    ).toBe(10);
    // Never below the "⋯" trigger's zone.
    expect(
      launcherRoom({
        centre: 90,
        left: 100,
        leftCap: 300,
        leftTruncated: false,
        leftRuns: [run(100, 300)],
        rightRuns: [],
      }),
    ).toBe(LAUNCHER_MIN_ZONE);
  });

  test("FR-THEME-05 BL-136 gilt.css re-fonts the top bar only as `topBarRuns` assumes: the title zone in --font-title, `topbar-sub` and the chip in --font-body, no size, weight or spacing", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../../themes/gilt.css", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const found: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = (m[1] ?? "").replace(/\s+/g, " ").trim();
      if (!/topbar|ui-prefs-open|sync-connection|presence|identity/.test(sel)) continue;
      for (const d of (m[2] ?? "").matchAll(
        /(font[\w-]*|letter-spacing|word-spacing|text-transform)\s*:\s*([^;]+)/g,
      )) {
        const target = /ui-topbar-left|topbar-title|topbar-sub|ui-prefs-open/.exec(sel)?.[0] ?? sel;
        found.push(`${target} ${d[1]}: ${d[2]?.trim()}`);
      }
    }
    expect(found.sort()).toEqual([
      "topbar-sub font-family: var(--font-body)",
      "topbar-title font-family: var(--font-title)",
      "ui-prefs-open font-family: var(--font-body)",
      "ui-topbar-left font-family: var(--font-title)",
    ]);
  });
});
