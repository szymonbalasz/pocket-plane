// FR-PARTY-11 / FR-PARTY-14 layout (seams S8) on the player registry: fit at 1280×720 / 1600×900;
// open clear of the open windows on the default layout: an edge first, else beside an edge window
// (FR-SHELL-45, -46); screen full → the least recently used launcher window is auto-minimised
// (FR-SHELL-47).
import { expect, test } from "bun:test";
import { clampRect, type Rect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { touchedEdge } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";

import { playerWindows } from "../../windows";

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function openOnDefaults(kinds: string[], viewport: { w: number; h: number }) {
  const ctx = {
    registry: playerWindows,
    viewport,
    available: new Set(playerWindows.defs.map((d) => d.kind)),
  };
  let ws = defaultLayout(playerWindows, viewport);
  for (const kind of kinds) ws = [...reduce(ws, { type: "open", kind }, ctx)];
  return ws
    .filter((w) => w.state === "open")
    .map((w) => ({ kind: w.kind, ...clampRect(w, viewport) }));
}

const SIZES = [
  { w: 1280, h: 720 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];

test("FR-PARTY-11 FR-PARTY-14 Player party windows fit 1280×720 and keep their size at 1600×900", () => {
  for (const kind of ["party.board", "party.handout"]) {
    const d = playerWindows.get(kind);
    if (!d) throw new Error(`${kind} not registered`);
    for (const vp of [
      { w: 1280, h: 720 },
      { w: 1600, h: 900 },
    ]) {
      const r = fittedDefaultRect(d, vp);
      expect(r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= vp.w && r.y + r.h <= vp.h).toBe(true);
    }
    expect(fittedDefaultRect(d, { w: 1600, h: 900 })).toMatchObject(d.defaultSize);
  }
});

test("FR-PARTY-11 Player board opens clear of the sheet, the log and Initiative (an edge, else beside an edge window)", () => {
  for (const vp of SIZES) {
    const rects = openOnDefaults(["party.board"], vp);
    const r = rects.find((w) => w.kind === "party.board") as Rect & { kind: string };
    const hit = rects.filter((b) => b.kind !== "party.board" && overlaps(r, b)).map((b) => b.kind);
    expect([vp.w, hit]).toEqual([vp.w, []]);
    expect(touchedEdge(r, vp)).not.toBeNull();
    expect(r.h).toBeGreaterThanOrEqual(360);
  }
});

test("FR-PARTY-14 Player viewer opens clear of every open window (the board auto-minimised if the screen is full)", () => {
  for (const vp of SIZES) {
    const rects = openOnDefaults(["party.board", "party.handout"], vp);
    const r = rects.find((w) => w.kind === "party.handout") as Rect & { kind: string };
    const hit = rects
      .filter((b) => b.kind !== "party.handout" && overlaps(r, b))
      .map((b) => b.kind);
    expect([vp.w, hit]).toEqual([vp.w, []]);
    expect(r.h).toBeGreaterThanOrEqual(320); // min size: the last resort at 1280×720
    expect(r.w).toBeGreaterThanOrEqual(360);
  }
});
