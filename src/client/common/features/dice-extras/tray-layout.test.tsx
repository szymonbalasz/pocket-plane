// The tray at small sizes (FR-DICEX-53, -54; DICEX §12 tray budget): the pure layout and still
// size over the frame's real box (ShellWindow: 1 px border, 32 px title bar, `p-3` body), and a
// static render that checks the classes draw the heights the layout assumes.
import { afterEach, describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { diceExtras, type TrayRequest } from "./store";
import { type AreaBox, CELL_GAP, stillSize, type TrayGroup, TrayPreview } from "./TrayPreview";
import { DICE_AREA_PAD, TRAY_GAP, TRAY_PART_PX, TrayWindow, trayLayout } from "./TrayWindow";
import { trayExtras } from "./tray-extras";
import { chipsOf, constantOfTerms, PALETTE, termsOf } from "./tray-logic";

function render(node: React.ReactNode) {
  const you = { campaignId: "c1", role: "player", playerId: "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records: {} },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** The window body's content box for a window of `w` × `h` (ShellWindow's frame). */
const body = (w: number, h: number) => ({ w: w - 2 - 24, h: h - 2 - 32 - 24 });
const SIZES = [
  [360, 300],
  [320, 260],
  [300, 240],
] as const;
const { header, palette, expression, bar } = TRAY_PART_PX;
/** Fixed parts per state (palette + expression row only in compose / result). */
const PARTS = {
  compose: [header, palette, expression, bar],
  result: [header, palette, expression, bar],
  adjust: [header, bar],
  rolling: [header, bar],
} as const;
/** The dice area's content box: the layout's height, the body's width less `pr-1.5`. */
const areaOf = (w: number, h: number, parts: readonly number[]): AreaBox => ({
  w: body(w, h).w - 6,
  h: trayLayout(body(w, h).h, parts).dice,
});

const group = (expression: string): TrayGroup => {
  const t = termsOf(expression) ?? [];
  return { chips: chipsOf(t), constant: constantOfTerms(t) };
};
const FREE: TrayRequest = { kind: "free", expression: "", mode: "normal", category: "other" };
const preview = (groups: TrayGroup[], area: AreaBox | null, request = FREE) =>
  render(
    <TrayPreview request={request} groups={groups} mode="normal" onRemove={() => {}} area={area} />,
  );
const canvasTag = (html: string) =>
  html.match(/<canvas[^>]*data-testid="dicex-tray-preview"[^>]*>/)?.[0] ?? "";
const dieTags = (html: string) =>
  html.match(/<(button|span)[^>]*data-testid="dicex-tray-die"[^>]*>/g) ?? [];
/** Cells of `n` one-cell dice plus a constant. */
const cells = (n: number, constant = false) => n + (constant ? 1 : 0);

const registered = [...trayExtras];
afterEach(() => {
  diceExtras.clear();
  trayExtras.splice(0, trayExtras.length, ...registered);
});

describe("FR-DICEX-53 tray Roll visible at min", () => {
  test("FR-DICEX-53 tray Roll visible at min: the fixed parts leave ≥ one 28-px row (40 pinned) in every state and size", () => {
    for (const [w, h] of SIZES) {
      for (const [state, parts] of Object.entries(PARTS)) {
        const { dice } = trayLayout(body(w, h).h, parts);
        // The bottom bar fits: fixed parts + gaps + the dice area ≤ the body.
        const used = parts.reduce((n, p) => n + p, 0) + parts.length * TRAY_GAP + DICE_AREA_PAD;
        expect(used + dice).toBe(body(w, h).h);
        expect(dice, `${state} at ${w}×${h}`).toBeGreaterThanOrEqual(28);
        // The build's measured heights pin the 40-px row (rulings-b #14).
        expect(dice, `${state} at ${w}×${h}`).toBeGreaterThanOrEqual(40);
      }
    }
    // At min, compose: 182 px body → 41 px of dice.
    expect(trayLayout(body(300, 240).h, PARTS.compose).dice).toBe(41);
    // The palette stays one row at 300: seven buttons ≥ 32 px with 4-px gaps.
    expect(PALETTE).toHaveLength(7);
    expect((body(300, 240).w - 6 * 4) / 7).toBeGreaterThanOrEqual(32);
  });

  test("FR-DICEX-53 tray Roll visible at min: 3 dice + constant, 12, 20 (grouped), adjust (MOD), rolling, result never scroll the area", () => {
    for (const [w, h] of SIZES) {
      const compose = areaOf(w, h, PARTS.compose);
      const three = stillSize({ cells: cells(3, true), groupedCells: 3, byCount: false }, compose);
      expect(three).toEqual({ cell: 40, grouped: false, scroll: false });
      const twelve = stillSize({ cells: 12, groupedCells: 1, byCount: false }, compose);
      expect(twelve.scroll).toBe(false);
      const twenty = stillSize({ cells: 20, groupedCells: 1, byCount: true }, compose);
      expect(twenty).toEqual({ cell: 40, grouped: false, scroll: false });
      // adjust: "1d20+5" + MOD "+1d4" (text ≈ two cells + one die).
      const adjust = stillSize(
        { cells: cells(1, true) + 3, groupedCells: 5, byCount: false },
        areaOf(w, h, PARTS.adjust),
      );
      expect(adjust.scroll).toBe(false);
      for (const s of ["rolling", "result"] as const) {
        const a = areaOf(w, h, PARTS[s]);
        expect(stillSize({ cells: 4, groupedCells: 3, byCount: false }, a).scroll).toBe(false);
      }
    }
    // 12 d6 in the default tray: two rows of 40 (OQ-DICEX-36); at min they group "×12".
    expect(
      stillSize({ cells: 12, groupedCells: 1, byCount: false }, areaOf(360, 300, PARTS.compose)),
    ).toEqual({
      cell: 40,
      grouped: false,
      scroll: false,
    });
    expect(
      stillSize({ cells: 12, groupedCells: 1, byCount: false }, areaOf(300, 240, PARTS.compose)),
    ).toEqual({
      cell: 40,
      grouped: true,
      scroll: false,
    });
  });

  test("FR-DICEX-53 tray Roll visible at min: the classes draw the heights the layout assumes", () => {
    diceExtras.stage({ kind: "free", expression: "2d6+1d8+1", mode: "normal", category: "other" });
    const html = render(<TrayWindow />);
    const tag = (re: RegExp) => html.match(re)?.[0] ?? "";
    // The body is one column that never grows past the window (no `min-h-fit`).
    const section = tag(/<section[^>]*data-testid="dicex-tray"[^>]*>/);
    expect(section).toContain("h-full min-h-0 flex-col gap-1");
    expect(TRAY_GAP).toBe(4);
    // Fixed parts: header h-6 (24), palette h-7 (28) in one row of seven, expression h-7 (28),
    // bar border-t + pt-1 + h-7 (33); all `shrink-0`.
    const part = (name: string) => tag(new RegExp(`<[a-z]+[^>]*data-tray-part="${name}"[^>]*>`));
    expect(part("header")).toMatch(/h-6 shrink-0/);
    expect(TRAY_PART_PX.header).toBe(24);
    expect(html).toContain('data-testid="dicex-settings-open"');
    expect(tag(/<button[^>]*data-testid="dicex-settings-open"[^>]*>/)).toContain("size-6");
    expect(part("palette")).toMatch(/grid shrink-0 grid-cols-7/);
    expect(tag(/<button[^>]*data-testid="dicex-tray-palette"[^>]*>/)).toContain("h-7");
    expect(part("expression")).toContain("shrink-0");
    expect(tag(/<input[^>]*data-testid="dicex-tray-expression"[^>]*>/)).toContain("h-7");
    expect(part("bar")).toMatch(/shrink-0 .*border-t pt-1/);
    expect(TRAY_PART_PX.bar as number).toBe(1 + 4 + 28);
    expect(tag(/<button[^>]*data-testid="dicex-tray-roll"[^>]*>/)).toContain("h-7");
    // The mode toggle: 26-px items in a 1-px border = 28.
    expect(tag(/<button[^>]*data-testid="dicex-tray-mode-option"[^>]*>/)).toContain("h-[26px]");
    // The one flexible part: the dice area, padded for tags, scrolling on its own.
    const area = tag(/<div[^>]*data-testid="dicex-tray-area"[^>]*>/);
    expect(area).toMatch(/min-h-0 flex-1/);
    expect(area).toContain("overflow-y-auto");
    expect(area).toContain("py-1.5");
    expect(DICE_AREA_PAD).toBe(12);
    // Order: header, palette, dice area, expression row, bottom bar.
    const at = (s: string) => html.indexOf(s);
    expect(at('data-tray-part="header"')).toBeLessThan(at('data-tray-part="palette"'));
    expect(at('data-tray-part="palette"')).toBeLessThan(at('data-testid="dicex-tray-area"'));
    expect(at('data-testid="dicex-tray-area"')).toBeLessThan(at('data-tray-part="expression"'));
    expect(at('data-tray-part="expression"')).toBeLessThan(at('data-tray-part="bar"'));
  });
});

describe("FR-DICEX-54 tray dice area fits", () => {
  const MIN = areaOf(300, 240, PARTS.compose); // 268 × 41
  const DEFAULT = areaOf(360, 300, PARTS.compose);

  test("FR-DICEX-54 tray dice area fits: stillSize 40 → 28 → grouped '×N' → scroll", () => {
    expect(CELL_GAP).toBe(4);
    // 40 while every die fits.
    expect(stillSize({ cells: 6, groupedCells: 1, byCount: false }, MIN)).toEqual({
      cell: 40,
      grouped: false,
      scroll: false,
    });
    // 8 dice: no row of 40 holds them at min (6 per row), one row of 28 does (8 per row).
    expect(stillSize({ cells: 8, groupedCells: 1, byCount: false }, MIN)).toEqual({
      cell: 28,
      grouped: false,
      scroll: false,
    });
    // 12 d6 at min: 28 doesn't fit (two rows = 60) → grouped by room, ×12 at 40.
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, MIN)).toEqual({
      cell: 40,
      grouped: true,
      scroll: false,
    });
    // Grouped needs 28: 7 terms + d100's second part = 8 cells.
    expect(stillSize({ cells: 14, groupedCells: 8, byCount: false }, MIN)).toEqual({
      cell: 28,
      grouped: true,
      scroll: false,
    });
    // > 12 dice group by count (not forced by room); many terms → the area scrolls.
    expect(stillSize({ cells: 30, groupedCells: 24, byCount: true }, MIN)).toEqual({
      cell: 28,
      grouped: false,
      scroll: true,
    });
    expect(stillSize({ cells: 30, groupedCells: 24, byCount: false }, MIN)).toEqual({
      cell: 28,
      grouped: true,
      scroll: true,
    });
    // The default tray holds 12 one by one in two rows of 40.
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, DEFAULT).cell).toBe(40);
  });

  test("FR-DICEX-54 tray dice area fits: data-cell / data-grouped / data-scroll and the cell size drawn", () => {
    // Not measured yet (server render): 40, as built.
    const unmeasured = canvasTag(preview([group("2d6+1d8+1")], null));
    expect(unmeasured).toContain('data-cell="40"');
    expect(unmeasured).not.toContain("data-grouped");
    expect(unmeasured).not.toContain("data-scroll");

    // 8 d6 at min → 28-px cells; fallback chips step `md` → `sm` (18 px).
    const eight = preview([group("8d6")], MIN);
    expect(canvasTag(eight)).toContain('data-cell="28"');
    expect(dieTags(eight)).toHaveLength(8);
    for (const d of dieTags(eight)) expect(d).toContain("h-7 min-w-7");
    expect(eight).toContain('width="18"');
    expect(eight).not.toContain('width="36"');

    // 12 d6 at min → one die "×12", data-grouped (forced by room).
    const twelve = preview([group("12d6")], MIN);
    expect(canvasTag(twelve)).toContain('data-grouped="true"');
    expect(dieTags(twelve)).toHaveLength(1);
    expect(dieTags(twelve)[0]).toContain('data-group="12"');
    // …while the default tray shows twelve dice.
    const roomy = preview([group("12d6")], DEFAULT);
    expect(dieTags(roomy)).toHaveLength(12);
    expect(canvasTag(roomy)).toContain('data-cell="40"');
    expect(canvasTag(roomy)).not.toContain("data-grouped");

    // Many terms: grouped still too many → the area scrolls on its own.
    const all = "1d4+1d6+1d8+1d10+1d12+1d20+1d100";
    const many = canvasTag(preview([group(all), group(all), group(all)], MIN));
    expect(many).toContain('data-scroll="true"');
    expect(many).toContain('data-cell="28"');
    // 21 dice group by count, so not "forced by room".
    expect(many).not.toContain("data-grouped");
  });
});
