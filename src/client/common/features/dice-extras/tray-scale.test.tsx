// T1 (sprint 10, DM #343; FR-DICEX-96, orchestrator ruling): the tray's dice scale with the
// window: × 1 at the min (300 × 240, today's dice), × 1.2 at the useful size (360 × 300, 48-px
// cells), × 1.4 at the default (504 × 420); the notation row stays 28 px up to useful. The pure
// scales and still size, the layout budget (Roll visible), and a static render of the scaled
// cells and chips.
import { afterEach, describe, expect, test } from "bun:test";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { DieShape } from "./DieShape";
import { FlatDie } from "./FlatDie";
import { diceExtras, type TrayRequest } from "./store";
import { type AreaBox, stillSize, type TrayGroup, TrayPreview } from "./TrayPreview";
import { TRAY_PART_PX, trayLayout } from "./TrayWindow";
import {
  chipsOf,
  constantOfTerms,
  notationScale,
  scaledPx,
  TRAY_DEFAULT,
  TRAY_MIN,
  TRAY_SCALE_MAX,
  TRAY_USEFUL,
  termsOf,
  trayScale,
} from "./tray-logic";

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
const { header, palette, expression, bar } = TRAY_PART_PX;
/** Compose's fixed parts with the notation row at `scale` (28-px inputs at × 1). */
const composeParts = (scale: number) => [header, palette, scaledPx(expression, scale), bar];
/** The dice area of a `w` × `h` tray in compose, its notation row at `notationScale`. */
const areaOf = (w: number, h: number): AreaBox => ({
  w: body(w, h).w - 6,
  h: trayLayout(body(w, h).h, composeParts(notationScale({ w, h }))).dice,
});
const group = (expression: string): TrayGroup => {
  const t = termsOf(expression) ?? [];
  return { chips: chipsOf(t), constant: constantOfTerms(t) };
};
const FREE: TrayRequest = { kind: "free", expression: "", mode: "normal", category: "other" };
const dieTags = (html: string) =>
  html.match(/<(button|span)[^>]*data-testid="dicex-tray-die"[^>]*>/g) ?? [];
const canvasTag = (html: string) =>
  html.match(/<canvas[^>]*data-testid="dicex-tray-preview"[^>]*>/)?.[0] ?? "";

afterEach(() => diceExtras.clear());

describe("FR-DICEX-96 tray dice scale", () => {
  test("FR-DICEX-96 tray dice scale: × 1 at the min 300 × 240, × 1.2 at the useful 360 × 300, × 1.4 at the default 504 × 420, linear between by the tighter side; notation row compact up to useful", () => {
    expect([TRAY_MIN, TRAY_USEFUL, TRAY_DEFAULT]).toEqual([
      { w: 300, h: 240 },
      { w: 360, h: 300 },
      { w: 504, h: 420 },
    ]);
    expect(TRAY_SCALE_MAX).toBe(1.4);
    expect(trayScale({ w: 504, h: 420 })).toBe(1.4);
    expect(trayScale({ w: 360, h: 300 })).toBe(1.2);
    expect(trayScale({ w: 300, h: 240 })).toBe(1);
    // Smooth between the steps; the tighter axis decides.
    expect(trayScale({ w: 432, h: 360 })).toBe(1.3);
    expect(trayScale({ w: 330, h: 270 })).toBe(1.1);
    expect(trayScale({ w: 504, h: 412 })).toBe(1.39);
    expect(trayScale({ w: 504, h: 300 })).toBe(1.2);
    expect(trayScale({ w: 360, h: 420 })).toBe(1.2);
    // Never past × 1.4, never below today's dice.
    expect(trayScale({ w: 900, h: 800 })).toBe(1.4);
    expect(trayScale({ w: 280, h: 200 })).toBe(1);
    expect(trayScale(null)).toBe(1);
    expect(trayScale({ w: 0, h: 0 })).toBe(1);
    // The notation row: × 1 up to the useful size, × 1.4 at the default.
    expect(notationScale({ w: 360, h: 300 })).toBe(1);
    expect(notationScale({ w: 300, h: 240 })).toBe(1);
    expect(notationScale({ w: 432, h: 360 })).toBe(1.2);
    expect(notationScale({ w: 504, h: 420 })).toBe(1.4);
    // Cells: 40 → 48 at useful, 56 at the default (28 → 34 / 39); chips `md` 36 → 43 / 50.
    expect([scaledPx(40, 1.2), scaledPx(28, 1.2), scaledPx(36, 1.2)]).toEqual([48, 34, 43]);
    expect([scaledPx(40, 1.4), scaledPx(28, 1.4), scaledPx(36, 1.4)]).toEqual([56, 39, 50]);
  });

  test("FR-DICEX-96 tray dice scale at useful and default: a typical stage (up to 5 dice + adv, constant) one by one at ≥ 48 px with notation and Roll in the window", () => {
    // Useful 360 × 300: the compact notation row (28 px) leaves 101 px: two rows of 48.
    const useful = areaOf(360, 300);
    expect(useful).toEqual({ w: 328, h: 101 });
    expect(useful.h).toBeGreaterThanOrEqual(2 * 48 + 4);
    // 5 dice + adv (the d20 pair) + a constant = 8 cells; 12 cells (two rows of 6) still fit.
    for (const cells of [4, 8, 12]) {
      expect(
        stillSize({ cells, groupedCells: 1, byCount: false }, useful, 1.2),
        `${cells}`,
      ).toEqual({
        cell: 40,
        grouped: false,
        scroll: false,
      });
    }
    // Default 504 × 420: notation row 39 px; 12 d6 one by one in two rows of 56 (OQ-DICEX-36).
    const big = areaOf(504, 420);
    expect(big.h).toBeGreaterThanOrEqual(2 * 56 + 4);
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, big, 1.4)).toEqual({
      cell: 40,
      grouped: false,
      scroll: false,
    });
    const banded = areaOf(504, 412);
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, banded, 1.39).cell).toBe(40);
    // Min 300 × 240: × 1, the FR-DICEX-53 / -54 layout unchanged (41 px, one row of 40).
    expect(areaOf(300, 240).h).toBe(41);
    expect(trayScale({ w: 300, h: 240 })).toBe(1);
    // More dice than room: still steps down (28 × scale) or "×N" rather than overflow.
    expect(stillSize({ cells: 14, groupedCells: 1, byCount: false }, useful, 1.2)).toEqual({
      cell: 28,
      grouped: false,
      scroll: false,
    });
  });

  test("FR-DICEX-96 tray dice scale: cells, chips and their numbers drawn at the scale (data-px), today's classes at × 1", () => {
    const at = (scale: number) =>
      render(
        <TrayPreview
          request={FREE}
          groups={[group("2d6+1d8+1")]}
          mode="normal"
          onRemove={() => {}}
          area={areaOf(504, 420)}
          scale={scale}
        />,
      );
    const big = at(1.4);
    expect(canvasTag(big)).toContain('data-cell="40"');
    expect(canvasTag(big)).toContain('data-px="56"');
    expect(dieTags(big)).toHaveLength(3);
    for (const d of dieTags(big)) expect(d).toContain("height:56px;min-width:56px");
    // Fallback chips (no 3D chunk in a static render): `md` 36 → 50 px, the number 46 → 64 %.
    expect(big).toContain('width="50"');
    expect(big).not.toContain('width="36"');
    // The constant "+1" grows with the dice: 14 → 20 px.
    expect(big).toMatch(/font-size:20px[^>]*>\+1</);

    const today = at(1);
    expect(canvasTag(today)).toContain('data-px="40"');
    for (const d of dieTags(today)) {
      expect(d).toContain("h-10 min-w-10");
      expect(d).not.toContain("style=");
    }
    expect(today).toContain('width="36"');
  });

  test("FR-DICEX-96 tray dice scale: result dice and round chips scale too", () => {
    const die = {
      key: "e1:0",
      entryId: "e1",
      faces: 20,
      value: 17,
      face: "17",
      shape: "d20" as const,
      kept: true,
      flat: true,
      sign: 1 as const,
    };
    const html = render(<FlatDie die={die} look={STYLE_LOOK.ivory} scale={1.4} />);
    expect(html).toContain('width="50"');
    const round = render(<DieShape faces={3} value={2} size="md" scale={1.4} />);
    expect(round).toContain("height:50px;min-width:50px;font-size:20px;line-height:46px");
    const plain = render(<DieShape faces={3} value={2} size="md" />);
    expect(plain).not.toContain("min-width:");
  });
});
