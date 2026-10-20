// DM `charx.companion` def (FR-CHARX-59, FR-SHELL-61 (5)): same geometry, no launcher (opened from
// a companion's Initiative row / line or Party).
import { expect, test } from "bun:test";
import { dmCompanionWindow } from "./companion-window";

test("FR-CHARX-59 window (DM): charx.companion top-left dx 56, 320×360 min 280×240, closed by default, no launcher", () => {
  expect(dmCompanionWindow).toMatchObject({
    kind: "charx.companion",
    title: "Companion",
    clients: ["dm"],
    defaultSize: { w: 320, h: 360 },
    minSize: { w: 280, h: 240 },
    defaultPosition: { anchor: "top-left", dx: 56 },
    defaultOpen: false,
  });
  expect(dmCompanionWindow.launcher).toBeUndefined();
});
