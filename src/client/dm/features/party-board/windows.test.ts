// FR-PARTY-11 / FR-PARTY-14 layout (seams S8) on the DM registry: fit at 1280×720 / 1600×900;
// open at an edge on the default layout, clear of the default-open windows (or, with no
// full-size slot, at `minOpenH` on top, FR-NOTE-31 ruling).
import { expect, mock, test } from "bun:test";
import {
  lootLogTraces,
  openPartyTabRuns,
  RETIRED_LOOT_KIND,
  restoreWithLootLog,
  STORED_BOARD,
} from "@ui/features/party-board/loot-tab-checks";
import { clampRect, type Rect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { touchedEdge } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function openOnDefaults(kinds: string[], viewport: { w: number; h: number }) {
  const ctx = {
    registry: dmWindows,
    viewport,
    available: new Set(dmWindows.defs.map((d) => d.kind)),
  };
  let ws = defaultLayout(dmWindows, viewport);
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

test("FR-PARTY-11 FR-PARTY-14 DM party windows fit 1280×720 and keep their size at 1600×900", () => {
  for (const kind of ["party.board", "party.handout"]) {
    const d = dmWindows.get(kind);
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

test("FR-PARTY-11 DM board opens at the left edge, clear of Initiative and the log (or minOpenH on top at an edge)", () => {
  for (const vp of SIZES) {
    const rects = openOnDefaults(["party.board"], vp);
    const r = rects.find((w) => w.kind === "party.board") as Rect & { kind: string };
    const hit = rects.filter((b) => b.kind !== "party.board" && overlaps(r, b)).map((b) => b.kind);
    // A full-size or shorter (≥ min) free slot at the left edge; else `minOpenH` on top at the
    // edge covering the least (1280×720).
    if (hit.length > 0) {
      expect([vp.w, r.h, ["left", "right"].includes(touchedEdge(r, vp) ?? "")]).toEqual([
        vp.w,
        400,
        true,
      ]);
    } else {
      expect([vp.w, touchedEdge(r, vp)]).toEqual([vp.w, "left"]);
      expect(r.h).toBeGreaterThanOrEqual(360);
    }
  }
});

test("FR-PARTY-14 DM viewer opens at an edge; on top at minOpenH where no full-size slot is free", () => {
  for (const vp of SIZES) {
    const rects = openOnDefaults(["party.board", "party.handout"], vp);
    const r = rects.find((w) => w.kind === "party.handout") as Rect & { kind: string };
    expect(touchedEdge(r, vp)).not.toBeNull();
    expect(r.h).toBeGreaterThanOrEqual(400);
    expect(r.w).toBeGreaterThanOrEqual(360);
  }
});

// ---- sprint 5: Loot tab (FR-PARTY-30, FR-LOOT-21) ----

test("FR-LOOT-21 no loot.log window (DM): no window kind, no launcher entry; a stored layout with it parses, the kind dropped, the board keeps its geometry", () => {
  expect(lootLogTraces(dmWindows)).toEqual({ kind: false, launcher: false, available: false });
  const r = restoreWithLootLog(dmWindows);
  expect(r.warning).toBeUndefined();
  expect(r.stored).toBe(true);
  expect(r.board).toMatchObject({ state: "open", ...STORED_BOARD });
  expect(r.written).toContain("party.board");
  expect(r.written).not.toContain(RETIRED_LOOT_KIND);
});

test("FR-PARTY-30 open on a tab (DM): closed / minimised / open board → open, in front, tab Loot, by feature", () => {
  const stored = JSON.stringify({ tab: "loot" });
  const call = [{ kind: "party.board", by: "feature" }];
  expect(openPartyTabRuns(dmWindows, { campaignId: "c1", role: "dm", playerId: null })).toEqual([
    { before: "closed", calls: call, state: "open", onTop: true, tab: "loot", stored },
    { before: "minimised", calls: call, state: "open", onTop: true, tab: "loot", stored },
    { before: "open", calls: call, state: "open", onTop: true, tab: "loot", stored },
  ]);
});
