// FR-THEME-07: the launcher measures its labels in the computed font of a rendered launcher button,
// not a fixed `500 12px <body font>`, so FR-SHELL-43's fit holds when a theme changes the font.
// No DOM here: the launcher is rendered statically, its button found in the markup, and
// `getComputedStyle` / the canvas are stubs (a stubbed theme font is wider per glyph).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { forgetLabelWidths, Launcher, labelWidth, launcherFont } from "./Launcher";
import { fitLauncher, LAUNCHER_GUTTER, launcherMetrics } from "./launcher-fit";
import { createWindowRegistry, defineWindow } from "./registry";
import { ShellProvider } from "./ShellContext";

const BODY = "ui-sans-serif, system-ui, sans-serif";
/** The old code's font for every label, whatever the theme. */
const FIXED = `500 12px ${BODY}`;
const THEMED = `700 12px "Alegreya Sans", ${BODY}`;
/** Glyph advance per font, px: the stubbed theme font runs wider. */
const ADVANCE: Record<string, number> = { [FIXED]: 7, [THEMED]: 9 };

/** The font a stub element computes to: its classes, under the stubbed theme or not. */
let themed = false;
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
    createElement: () => ({ getContext: () => ctx }),
    querySelector: () => null,
  };
  g.getComputedStyle = (el: { className: string }) => {
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

/** The launcher's markup at viewport width `w`. */
function launcherHtml(w = 1280): string {
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
          <Launcher defs={defs} windows={[]} viewport={{ w, h: 720 }} dispatch={() => {}} />
        </TooltipProvider>
      </ShellProvider>
    </SyncContext.Provider>,
  );
}

/** A `ParentNode` over the markup: finds a button by its `data-testid`, with its classes. */
function navOf(markup: string): ParentNode {
  return {
    querySelector(sel: string) {
      const id = sel.match(/data-testid="([^"]+)"/)?.[1];
      const tag = markup.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0];
      return tag ? { className: tag.match(/class="([^"]*)"/)?.[1] ?? "" } : null;
    },
  } as unknown as ParentNode;
}

describe("FR-THEME-07 launcher measures computed font", () => {
  test("FR-THEME-07 reads weight, size and family off a rendered launcher button", () => {
    const nav = navOf(launcherHtml());
    expect(launcherFont(nav)).toBe(FIXED); // Default: today's label font, so Default fits as before
    themed = true;
    expect(launcherFont(nav)).toBe(THEMED);
    expect(launcherFont(null)).toBeNull();
  });

  test("FR-THEME-07 icon-only bar: the ⋯ button gives the same font", () => {
    const markup = launcherHtml(60); // too narrow for any button: the ⋯ menu holds them all
    expect(markup).not.toContain('data-testid="ui-launcher-button"');
    themed = true;
    expect(launcherFont(navOf(markup))).toBe(THEMED);
  });

  test("FR-THEME-07 the button's font is the label's: labels carry no size of their own", () => {
    const markup = launcherHtml();
    const label = markup.match(/<span>Initiative<\/span>/);
    expect(label).not.toBeNull();
  });

  test("FR-THEME-07 labels are measured in the computed font, once per font string", () => {
    themed = true;
    const font = launcherFont(navOf(launcherHtml())) as string;
    measured.length = 0;
    expect(labelWidth("Initiative", font)).toBe(10 * 9 + 1);
    expect(labelWidth("Initiative", font)).toBe(91);
    expect(measured).toEqual([{ font: THEMED, text: "Initiative" }]);
    expect(labelWidth("Initiative", FIXED)).toBe(10 * 7 + 1);
    expect(measured.map((m) => m.font)).toEqual([THEMED, FIXED]);
    forgetLabelWidths(); // a web font loaded: same string, new glyphs → measured again
    labelWidth("Initiative", font);
    expect(measured).toHaveLength(3);
  });

  test("FR-THEME-07 the fit follows the font: a wider theme font drops a label the fixed font kept", () => {
    const labels = new Map(defs.map((d) => [d.kind, d.launcher?.label ?? ""]));
    const items = defs.map((d, i) => ({ kind: d.kind, order: i, state: "closed" as const }));
    const width = (font: string) =>
      launcherMetrics(labels, (l) => labelWidth(l, font)).full(defs[0]?.kind ?? "");
    // Room for every label in the fixed font, not in the themed one.
    const m = (font: string) => launcherMetrics(labels, (l) => labelWidth(l, font));
    const total = (font: string) =>
      10 + defs.reduce((s, d) => s + m(font).full(d.kind) + 4, 0) + 40 + 2 * LAUNCHER_GUTTER;
    expect(width(THEMED)).toBeGreaterThan(width(FIXED));
    const vpW = total(FIXED);
    expect(fitLauncher(items, vpW, m(FIXED)).labelled).toHaveLength(defs.length);
    themed = true;
    const font = launcherFont(navOf(launcherHtml(vpW))) as string;
    expect(fitLauncher(items, vpW, m(font)).labelled.length).toBeLessThan(defs.length);
  });
});
