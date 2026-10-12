import { expect, mock, test } from "bun:test";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

test("FR-CHAR-15 DM char.sheet: closed by default, launcher Sheets, 320×440 (min 280×320)", () => {
  const d = dmWindows.get("char.sheet");
  expect(d).toBeDefined();
  expect(d?.defaultOpen).toBeFalsy();
  expect(d?.launcher?.label).toBe("Sheets");
  expect(d?.defaultSize).toEqual({ w: 320, h: 440 });
  expect(d?.minSize).toEqual({ w: 280, h: 320 });
  expect(d?.defaultPosition.anchor).toBe("bottom-right");
});
