import { expect, mock, test } from "bun:test";
import { clampRect } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { fittedDefaultRect, usableArea } from "@ui/features/play-shell/placement";
import { notificationsHistoryWindow as dm } from "./history-window";

// The players panel pulls in the DM session (window.location at import); not needed here.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

// FR-NOTE-31: root cause was each client's override (DM 360×320, player 360×300); both now use
// the shared def's 360×480, which the default rect keeps at 1440×900 and 1280×720.
test("FR-NOTE-31 history geometry: DM def is 360×480, min 280×240, unshrunk by the default fit", () => {
  for (const def of [dm]) {
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

test("FR-NOTE-31 history geometry: opened on the default layout (dm) it is 360×480 inside the work area at 1440×900 and 1280×720", () => {
  for (const viewport of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
  ]) {
    const all = new Set(dmWindows.defs.map((d) => d.kind));
    const ctx = { registry: dmWindows, viewport, available: all };
    const ws = [
      ...reduce(defaultLayout(dmWindows, viewport), { type: "open", kind: "note.history" }, ctx),
    ];
    const w = ws.find((x) => x.kind === "note.history");
    if (!w) throw new Error("note.history not open");
    const r = clampRect(w, viewport);
    expect({ w: r.w, h: r.h }).toEqual({ w: 360, h: 480 });
    const a = usableArea(viewport);
    expect(r.y >= a.top && r.y + r.h <= a.bottom).toBe(true);
  }
});
