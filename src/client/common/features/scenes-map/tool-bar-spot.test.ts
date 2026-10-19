// FR-MAP-60: tool bars at their home spot, max width from the top strip's keep-outs, rows by
// group. The DOM side (measure, keep-out report, push call) is walked in e2e/tool-bar-spot.
import { expect, test } from "bun:test";
import { keepOuts, reportKeepOut } from "../play-shell/keep-outs";
import { REFERENCE_VIEWPORTS } from "../play-shell/layout-checks";
import { toastKeepOut } from "../play-shell/toast-region";
import {
  barRect,
  barRows,
  TOOL_BAR_KEEP_OUT,
  TOOL_BAR_MAX_W,
  toolBarMaxWidth,
  toolBarSpot,
} from "./tool-bar-spot";

test("FR-MAP-60 tool bar spot: home spot right of the rail + 8 at y 56, for every size", () => {
  // The rail: `ui-tool-rail` at y 56 (top bar 48 + 8), its 48-px box ending at x 56.
  for (const _vp of REFERENCE_VIEWPORTS) {
    expect(toolBarSpot({ top: 56, right: 56 })).toEqual({ top: 56, left: 64 });
  }
  expect(toolBarSpot({ top: 56.4, right: 55.6 })).toEqual({ top: 56, left: 64 });
});

test("FR-MAP-60 tool bar spot: max width 390 / 390 / 470 / 550 px for the DM (8 px before the top-centre toast box), 560 px for players", () => {
  const spot = { top: 56, left: 64 };
  const dm = REFERENCE_VIEWPORTS.map((vp) => toolBarMaxWidth("dm", spot, vp));
  expect(dm).toEqual([390, 390, 470, 550]);
  REFERENCE_VIEWPORTS.forEach((vp, i) => {
    expect(spot.left + (dm[i] as number) + 8).toBe(toastKeepOut("dm", vp).x);
  });
  for (const vp of REFERENCE_VIEWPORTS) {
    expect(toolBarMaxWidth("player", spot, vp)).toBe(TOOL_BAR_MAX_W);
  }
});

test("FR-MAP-60 tool bar spot: the bar's own report (and any reported keep-out) never narrows it", () => {
  const vp = { w: 1440, h: 900 };
  const spot = { top: 56, left: 64 };
  reportKeepOut(TOOL_BAR_KEEP_OUT, { x: 64, y: 56, w: 470, h: 128 });
  reportKeepOut("other", { x: 300, y: 60, w: 50, h: 50 });
  try {
    expect(keepOuts("dm", vp).length).toBe(3);
    expect(toolBarMaxWidth("dm", spot, vp)).toBe(470);
  } finally {
    reportKeepOut(TOOL_BAR_KEEP_OUT, null);
    reportKeepOut("other", null);
  }
});

test("FR-MAP-60 tool bar spot: rows = distinct group tops (± 2 px); reported rect rounds outward", () => {
  expect(barRows([])).toBe(1);
  expect(barRows([60, 60, 61])).toBe(1);
  expect(barRows([60, 60, 101, 102, 142])).toBe(3);
  expect(barRect([{ x: 64, y: 56, w: 470.4, h: 127.2 }])).toEqual({ x: 64, y: 56, w: 471, h: 128 });
  expect(barRect([])).toBeNull();
});
