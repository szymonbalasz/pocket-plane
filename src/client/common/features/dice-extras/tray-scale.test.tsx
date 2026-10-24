// T1 (sprint 10, DM #343; FR-DICEX-96): the tray's dice scale with the window, × 1 at the useful
// size (360 × 300, today's dice) up to × 1.4 at the default (504 × 420). The pure scale and still
// size, the layout budget with the grown notation row (Roll visible), and a static render of the
// scaled cells and chips.
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
  scaledPx,
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
const areaOf = (w: number, h: number, scale: number): AreaBox => ({
  w: body(w, h).w - 6,
  h: trayLayout(body(w, h).h, composeParts(scale)).dice,
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
  test("FR-DICEX-96 tray dice scale: × 1.4 at the default 504 × 420, × 1 at the useful 360 × 300 and below, in between by the tighter side", () => {
    expect(TRAY_USEFUL).toEqual({ w: 360, h: 300 });
    expect(TRAY_SCALE_MAX).toBe(1.4);
    expect(trayScale({ w: 504, h: 420 })).toBe(1.4);
    // Band-capped at 1280×720 (DM band 412): the height decides.
    expect(trayScale({ w: 504, h: 412 })).toBe(1.37);
    expect(trayScale({ w: 432, h: 360 })).toBe(1.2);
    expect(trayScale({ w: 504, h: 300 })).toBe(1);
    // Never smaller than today, never past × 1.4.
    expect(trayScale({ w: 360, h: 300 })).toBe(1);
    expect(trayScale({ w: 300, h: 240 })).toBe(1);
    expect(trayScale({ w: 900, h: 800 })).toBe(1.4);
    expect(trayScale(null)).toBe(1);
    expect(trayScale({ w: 0, h: 0 })).toBe(1);
    // The cells: 40 → 56, 28 → 39; chips `md` 36 → 50.
    expect([scaledPx(40, 1.4), scaledPx(28, 1.4), scaledPx(36, 1.4)]).toEqual([56, 39, 50]);
  });

  test("FR-DICEX-96 tray dice scale at default: 3 dice + constant and 12 d6 one by one at 56 px with Roll in the window; the useful size is today's 40-px layout", () => {
    // Roll visible: the fixed parts (notation row grown to 39 px) leave ≥ two rows of 56.
    const big = areaOf(504, 420, 1.4);
    expect(big.h).toBeGreaterThanOrEqual(2 * 56 + 4);
    const banded = areaOf(504, 412, 1.37);
    expect(banded.h).toBeGreaterThanOrEqual(2 * 55 + 4);
    expect(stillSize({ cells: 4, groupedCells: 4, byCount: false }, big, 1.4)).toEqual({
      cell: 40,
      grouped: false,
      scroll: false,
    });
    // OQ-DICEX-36: ≤ 12 one by one, two rows in the default tray (7 per row at 56 px).
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, big, 1.4)).toEqual({
      cell: 40,
      grouped: false,
      scroll: false,
    });
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, banded, 1.37).cell).toBe(40);
    // Useful size: × 1, the FR-DICEX-53 / -54 layout unchanged.
    const useful = areaOf(360, 300, 1);
    expect(trayLayout(body(360, 300).h, composeParts(1)).dice).toBe(101);
    expect(stillSize({ cells: 12, groupedCells: 1, byCount: false }, useful, 1)).toEqual({
      cell: 40,
      grouped: false,
      scroll: false,
    });
    // Still steps down to 28 (39 px) or "×N" by room at × 1.4 rather than overflow.
    const tight = { w: 472, h: 60 };
    expect(stillSize({ cells: 8, groupedCells: 1, byCount: false }, tight, 1.4)).toEqual({
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
          area={areaOf(504, 420, scale)}
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
