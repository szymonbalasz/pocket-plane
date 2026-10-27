// Sprint 7 FU3 (scenes-map §13): Player 1's reveal refit with the companion card open, from
// `session-sim-10` b07, with the window rects read off the walkthrough's screenshot.
import { expect, test } from "bun:test";
import { fitObstacles, freeAreas } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import {
  AMBUSH_GRID,
  AMBUSH_MAP,
  type AmbushToken,
  SIM10_AMBUSH_PLAYER,
} from "@ui/features/play-shell/test-cells";
import {
  allClear,
  type Box,
  cameraOn,
  createRevealRefit,
  fitFor,
  fitScene,
  footprintBox,
  REVEAL_REFIT_MS,
  revealRefit,
  type Timers,
  visibleArea,
} from "@ui/features/scenes-map/camera";
import { labelHitAt } from "@ui/features/scenes-map/label-hit";

/** Player 1's Goblin Ambush after Start "Escort to the Ford" (see the DM's fit-followups test). */
const ESCORT: readonly AmbushToken[] = SIM10_AMBUSH_PLAYER.filter(
  (t) => t.name !== "Fire Elemental" && t.name !== "Fire Elemental 2",
).map((t) =>
  t.name === "Fire Elemental 3"
    ? { name: t.name, col: t.col, row: t.row, size: t.size, pc: false }
    : t,
);
/** Reveal all brings these two into sight (b07). */
const REVEALED = ["Wolf 2", "Plain Brute"];

const VP = { w: 1280, h: 800 };
/** b07 (1280×800): Initiative, the companion card (Owlbear), the sheet, the Game log. */
const WINDOWS: readonly Rect[] = [
  { x: 68, y: 60, w: 280, h: 404 },
  { x: 360, y: 60, w: 280, h: 308 },
  { x: 948, y: 60, w: 324, h: 404 },
  { x: 68, y: 564, w: 510, h: 160 },
];
/** b07's camera: 48 px cells, the Dragon's footprint at (607, 148). */
const B07_CAM = { x: 415, y: 100, scale: 48 / 70 };

const boxOf = (t: AmbushToken) => footprintBox([t], AMBUSH_GRID) as Box;

function fakeTimers() {
  let now = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  const timers: Timers = {
    set(fn, ms) {
      next += 1;
      due.set(next, { at: now + ms, fn });
      return next;
    },
    clear: (h) => void due.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...due.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      due.delete(id);
      t.fn();
    }
  };
  return { timers, advance };
}

test("FR-MAP-89 reveal refit with the card open: b07 (1280×800, sheet + companion card): paw double-click → the card opens, still fitted → Reveal all brings Wolf 2 and Plain Brute into sight under the sheet → one refit, none under any window; reload with both restored → the load fit frames clear of both", () => {
  const obstacles = fitObstacles("player", WINDOWS, keepOuts("player", VP, new Map()), VP, null);
  const area = visibleArea(VP);
  // (1) A press on the Owlbear's paw (its label row, above the name pill) is a token press: the
  // reveal refit is cancelled and re-armed at the release, the camera stays fitted.
  const owlbear = ESCORT.find((t) => t.name === "Owlbear") as AmbushToken;
  const fp = boxOf(owlbear);
  const s = B07_CAM.scale;
  const paw = { x: B07_CAM.x + (fp.x + fp.w / 2 - 8) * s, y: B07_CAM.y + (fp.y + fp.h - 30) * s };
  const name = { x: B07_CAM.x + (fp.x + fp.w / 2) * s, y: B07_CAM.y + (fp.y + fp.h + 4) * s };
  const items = [
    { tokenId: "owlbear", rect: { x: paw.x - 2, y: paw.y - 2, w: 16, h: 16 } },
    { tokenId: "owlbear", rect: { x: name.x - 30, y: name.y - 8, w: 60, h: 14 } },
  ];
  expect(labelHitAt(items, { x: paw.x + 4, y: paw.y + 4 })).toBe("owlbear");
  // The name pill's lower half lies below the footprint: before, that press counted as a pan.
  expect(name.y).toBeGreaterThan(B07_CAM.y + (fp.y + fp.h) * s);
  expect(labelHitAt(items, name)).toBe("owlbear");
  expect(labelHitAt(items, { x: 5, y: 5 })).toBeNull();
  let mode = cameraOn("fitted", "open").mode;
  const clock = fakeTimers();
  let refits = 0;
  const reveal = createRevealRefit(() => {
    const next = cameraOn(mode, "reveal");
    mode = next.mode;
    if (next.fit) refits += 1;
  }, clock.timers);
  reveal.press(); // the double-click's presses on the paw: not a gesture
  reveal.release();
  reveal.press();
  reveal.release();
  expect(mode).toBe("fitted");
  // Reveal all: the two new tokens lie under the sheet at b07's camera.
  const before = new Set(ESCORT.filter((t) => !REVEALED.includes(t.name)).map((t) => t.name));
  const drawn = ESCORT.map((t) => ({ id: t.name, box: boxOf(t) }));
  for (const t of ESCORT.filter((t) => REVEALED.includes(t.name))) {
    expect(allClear(B07_CAM, [boxOf(t)], [WINDOWS[2] as Rect], area)).toBe(false);
  }
  expect(revealRefit(before, drawn, B07_CAM, obstacles, area, mode)).toBe(true);
  reveal.reveal();
  clock.advance(REVEAL_REFIT_MS);
  expect(refits).toBe(1);
  // The refit (and the load fit after a reload, the same windows restored): none under any window.
  const roomNow = {
    areas: freeAreas(obstacles, VP),
    obstacles,
    windowsOnly: freeAreas(WINDOWS, VP),
  };
  // Sprint 8 (FR-MAP-95): the players' one fit path; PCs keep 4 px from windows (FR-MAP-93).
  const inputs = {
    client: "player" as const,
    tokens: ESCORT,
    grid: AMBUSH_GRID,
    map: AMBUSH_MAP,
    view: VP,
    room: roomNow,
    stripRoom: roomNow,
  };
  const fit = fitFor("reveal", inputs, 48);
  expect(fitFor("load", inputs, null)).toMatchObject({ x: fit.x, y: fit.y, scale: fit.scale });
  const under = ESCORT.filter((t) => !allClear(fit, [boxOf(t)], obstacles, area)).map(
    (t) => t.name,
  );
  // Every token clear only with a PC flush against a window (24 px): the PCs keep 4 px
  // (FR-MAP-93, a hard rule since walkthrough WF3 F9), the least token area stays hidden. K5:
  // the work area to vh − 12 (the toast corner 52 px lower) leaves room for every token.
  const pcs = ESCORT.filter((t) => t.pc).map(boxOf);
  expect(
    allClear(
      fit,
      pcs.map((b) => ({ ...b, pc: true })),
      obstacles,
      area,
      4,
    ),
  ).toBe(true);
  expect(under).toEqual([]);
  expect(mode).toBe("fitted");
  // A fit run before the restored windows rendered (the old load fit): tokens under the sheet.
  const early = fitScene(ESCORT, AMBUSH_GRID, AMBUSH_MAP, VP, {
    areas: freeAreas([], VP),
    obstacles: [],
    windowsOnly: freeAreas([], VP),
  });
  expect(ESCORT.some((t) => !allClear(early, [boxOf(t)], WINDOWS, area))).toBe(true);
});
