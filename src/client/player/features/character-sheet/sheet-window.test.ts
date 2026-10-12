import { expect, test } from "bun:test";
import { clampRect } from "@ui/features/play-shell/geometry";
import { defaultLayout } from "@ui/features/play-shell/manager";
import { playerWindows } from "../../windows";

test("FR-CHAR-15 player char.sheet: open by default, top-right, 320×440, launcher Sheet; clear of other default windows", () => {
  const d = playerWindows.get("char.sheet");
  expect(d).toMatchObject({
    defaultOpen: true,
    defaultPosition: { anchor: "top-right" },
    defaultSize: { w: 320, h: 440 },
    minSize: { w: 280, h: 320 },
  });
  expect(d?.launcher?.label).toBe("Sheet");
  for (const viewport of [
    { w: 1280, h: 720 },
    { w: 1600, h: 900 },
  ]) {
    const rects = defaultLayout(playerWindows, viewport).map((w) => ({
      kind: w.kind,
      ...clampRect(w, viewport),
    }));
    const sheet = rects.find((r) => r.kind === "char.sheet");
    if (!sheet) throw new Error("char.sheet not in the default layout");
    for (const b of rects) {
      if (b === sheet) continue;
      const overlap =
        sheet.x < b.x + b.w &&
        b.x < sheet.x + sheet.w &&
        sheet.y < b.y + b.h &&
        b.y < sheet.y + sheet.h;
      expect(overlap ? `overlaps ${b.kind} at ${viewport.w}` : "ok").toBe("ok");
    }
  }
});
