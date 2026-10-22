import { expect, test } from "bun:test";
import { clampRect } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { fittedDefaultRect, usableArea } from "@ui/features/play-shell/placement";
import { notificationsHistoryWindow as player } from "./history-window";

const { playerWindows } = await import("../../windows");

// FR-NOTE-31: root cause was each client's override (DM 360×320, player 360×300); both now use
// the shared def's 360×480, which the default rect keeps at 1440×900 and 1280×720.
test("FR-NOTE-31 history geometry: player def is 360×480, min 280×240, unshrunk by the default fit", () => {
  for (const def of [player]) {
    expect(def.defaultSize).toEqual({ w: 360, h: 480 });
    expect(def.minSize).toEqual({ w: 280, h: 240 });
    for (const vp of [
      { w: 1440, h: 900 },
      { w: 1280, h: 720 },
    ]) {
      const r = fittedDefaultRect(def, vp);
      expect({ w: r.w, h: r.h }).toEqual({ w: 360, h: 480 });
    }
  }
});

// Sprint 5 (FR-NOTE-31 as amended, FR-SHELL-45): 480 high where a clear slot allows, else the
// tallest clear slot, never over the Game log: 412 at 1280×720; with Initiative open (combat)
// beside it. Sprint 8 (FR-SHELL-97 L1, -98): at 1440×900 the full 480 fits 4 px above the
// 280-high log, before shrinking to the 472-high band.
test("FR-NOTE-31 history geometry: opened on the default layout (player) it is 360 wide, 480 where a clear slot allows, else the tallest clear slot (412 at 1280×720), inside the work area", () => {
  for (const [viewport, h, combat] of [
    [{ w: 1440, h: 900 }, 480, true],
    [{ w: 1440, h: 900 }, 480, false],
    [{ w: 1280, h: 720 }, 412, true],
  ] as const) {
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    if (!combat) all.delete("cbt.initiative");
    const ctx = { registry: playerWindows, viewport, available: all };
    const ws = [
      ...reduce(
        defaultLayout(playerWindows, viewport),
        { type: "open", kind: "note.history" },
        ctx,
      ),
    ];
    const w = ws.find((x) => x.kind === "note.history");
    if (!w) throw new Error("note.history not open");
    const r = clampRect(w, viewport);
    expect({ w: r.w, h: r.h }).toEqual({ w: 360, h });
    const a = usableArea(viewport);
    expect(r.y >= a.top && r.y + r.h <= a.bottom).toBe(true);
  }
});
