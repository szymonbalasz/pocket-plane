// FR-SHELL-140–143 (CB3) on the DM registry: `party.summary` "Party status" registered as a
// launcher window right after Party, loads closed, its size-table row and harness sets filled, it
// opens inside the viewport at the four sizes, and the launcher still fits at 1280×720.
import { expect, mock, test } from "bun:test";
import {
  launcherFitAt1280,
  summaryOpenRects,
  summaryRegistration,
} from "@ui/features/party-board/summary-checks";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";

/** One size at the four reference sizes (size-table shape). */
const all = (w: number, h: number) =>
  [
    { w, h },
    { w, h },
    { w, h },
    { w, h },
  ] as const;

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows: registry } = await import("../../windows");

test("FR-SHELL-140 party status registered (DM): launcher after Party, loads closed, 280 wide, grows to content, min 240 × 120; size-table row and set D3 filled; opens inside the viewport at the four sizes", () => {
  expect(summaryRegistration(registry)).toEqual({
    title: "Party status",
    label: "Party status",
    afterParty: "party.summary",
    defaultOpen: false,
    // FR-SHELL-142: a reload restores it if it was open.
    restoreOpen: true,
    defaultSize: { w: 280, h: 260 },
    minSize: { w: 240, h: 120 },
    usefulSize: { w: 280, h: 236 },
    growToContent: true,
    activity: false,
    sizeRow: {
      default: all(280, 260),
      useful: all(280, 236),
      min: { w: 240, h: 120 },
      criterion:
        "every PC row of a 6-PC party whole (name, HP, temp, AC uncut); companions may scroll",
    },
    pending: false,
    sets: ["D3"],
  });
  for (const { vp, rect } of summaryOpenRects(registry)) {
    const [w, h] = vp.split("×").map(Number) as [number, number];
    expect({
      vp,
      inside: rect.x >= 0 && rect.y >= TOP_BAR_H && rect.x + rect.w <= w && rect.y + rect.h <= h,
    }).toEqual({ vp, inside: true });
    expect(rect.w).toBe(280);
    expect(rect.h).toBeGreaterThanOrEqual(120);
  }
});

test("FR-SHELL-140 launcher fits (DM): with Party status every launcher entry stays in the bar at 1280×720 (FR-SHELL-43)", () => {
  const fit = launcherFitAt1280(registry);
  expect(fit.overflow).toEqual([]);
  expect(fit.bar).toContain("party.summary");
});
