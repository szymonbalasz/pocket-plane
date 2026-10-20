import { expect, test } from "bun:test";
import { fitObstacles, freeAreas } from "./free-area";
import { hardRects, keepOuts, keepOutsAttr, reportedKeepOuts, reportKeepOut } from "./keep-outs";
import { summaryStrip, toastKeepOut } from "./toast-region";

const vp = { w: 1440, h: 900 };
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("FR-SHELL-48 keep-outs: the toast box always (players hard, the DM soft); reported chrome hard while shown", () => {
  expect(keepOuts("player", vp)).toEqual([
    { id: "toasts", rect: toastKeepOut("player", vp), kind: "hard" },
  ]);
  expect(keepOuts("dm", vp)).toEqual([
    { id: "toasts", rect: toastKeepOut("dm", vp), kind: "soft" },
  ]);
  const bar = { x: 68, y: 60, w: 520, h: 120 };
  reportKeepOut("map.toolbar", bar);
  try {
    const before = reportedKeepOuts();
    reportKeepOut("map.toolbar", { ...bar }); // same rect: no change
    expect(reportedKeepOuts()).toBe(before);
    expect(keepOuts("dm", vp)[1]).toEqual({ id: "map.toolbar", rect: bar, kind: "hard" });
    expect(hardRects(keepOuts("dm", vp))).toEqual([bar]);
    expect(keepOutsAttr(keepOuts("dm", vp))).toBe(
      "toasts:542,100,356,238;map.toolbar:68,60,520,120",
    );
  } finally {
    reportKeepOut("map.toolbar", null);
  }
  expect(keepOuts("dm", vp).length).toBe(1);
});

test("FR-SHELL-48 the fit's toast obstacle (players' box, the DM's summary strip, FR-MAP-80) is excluded from freeAreas; a reported tool bar isn't", () => {
  for (const client of ["dm", "player"] as const) {
    const box = client === "dm" ? summaryStrip(vp) : toastKeepOut(client, vp);
    const bar = { x: 68, y: 60, w: 520, h: 120 };
    const regions = [
      ...keepOuts(client, vp),
      { id: "map.toolbar", rect: bar, kind: "hard" as const },
    ];
    const areas = freeAreas(fitObstacles(client, [], regions, vp, null), vp);
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) expect(overlaps(a, box)).toBe(false);
    expect(areas.some((a) => overlaps(a, bar))).toBe(true);
  }
});
