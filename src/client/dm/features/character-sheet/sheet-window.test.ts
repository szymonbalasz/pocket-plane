import { expect, mock, test } from "bun:test";
import { defaultSizeAt } from "@ui/features/play-shell/registry";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

test("FR-CHAR-15 DM char.sheet: closed by default, launcher Sheets, top-right, 320×440 (680×560 from 1680 px wide; min 280×320)", () => {
  const d = dmWindows.get("char.sheet");
  expect(d).toBeDefined();
  expect(d?.defaultOpen).toBeFalsy();
  expect(d?.launcher?.label).toBe("Sheets");
  if (!d) return;
  expect(defaultSizeAt(d, { w: 1600, h: 900 })).toEqual({ w: 320, h: 440 });
  expect(defaultSizeAt(d, { w: 1920, h: 1080 })).toEqual({ w: 680, h: 560 });
  expect(d.minSize).toEqual({ w: 280, h: 320 });
  expect(d.defaultPosition.anchor).toBe("top-right"); // right edge, beside Initiative (§24)
});
