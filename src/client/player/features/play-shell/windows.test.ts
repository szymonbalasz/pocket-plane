import { expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { freeArea, freeAreas, renderedWindowRects } from "@ui/features/play-shell/free-area";
import { clampRect, type Rect, TOP_BAR_H, workArea } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import {
  fitLauncher,
  fittedBarWidth,
  LAUNCHER_GUTTER,
  launcherMetrics,
} from "@ui/features/play-shell/launcher-fit";
import {
  launcherKinds,
  launcherSequence,
  REFERENCE_VIEWPORTS,
  rectIn,
} from "@ui/features/play-shell/layout-checks";
import { defaultLayout, reduce, restoreLayout } from "@ui/features/play-shell/manager";
import { fittedMapRect, touchedEdge, uncoveredShare } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { availableKinds, defaultSizeAt } from "@ui/features/play-shell/registry";
import { toastKeepOut } from "@ui/features/play-shell/toast-region";
import { coveredArea } from "@ui/features/play-shell/token-boxes";
import {
  contentBox,
  FIT_MIN_CELL_PX,
  fitContent,
  footprintBox,
} from "@ui/features/scenes-map/camera";
import { playerWindows } from "../../windows";

// Registry-driven: later builders append windows without touching these tests.
const TEST_KINDS = ["shell.test", "sync.probes"];
const testMode = { ...emptyStore(), records: { probe: {} } };
const LAPTOP = { w: 1280, h: 720 };
const WIDE = { w: 1440, h: 900 };
const DESKTOP = { w: 1600, h: 900 };
const VIEWPORTS = [LAPTOP, DESKTOP];

test("FR-SHELL-07 player registry loads; every type is a player window", () => {
  expect(playerWindows.client).toBe("player");
  for (const d of playerWindows.defs) expect(d.clients).toContain("player");
  expect(playerWindows.get("camp.players")).toBeUndefined();
});

test("FR-SHELL-20 test mode off → shell.test, sync.probes absent; on → present", () => {
  const off = availableKinds(playerWindows, emptyStore());
  const on = availableKinds(playerWindows, testMode);
  for (const k of TEST_KINDS) {
    expect(off.has(k)).toBe(false);
    expect(on.has(k)).toBe(true);
  }
  // Ungated product windows are available either way.
  for (const d of playerWindows.defs.filter((d) => !d.available)) {
    expect(off.has(d.kind)).toBe(true);
    expect(on.has(d.kind)).toBe(true);
  }
});

test("FR-SHELL-14 player default layout = every default-open window in the registry (gated ones too)", () => {
  const expected = playerWindows.defs
    .filter((d) => d.defaultOpen)
    .map((d) => d.kind)
    .sort();
  const layout = defaultLayout(playerWindows, DESKTOP);
  expect(layout.map((w) => w.kind).sort()).toEqual(expected);
  for (const w of layout) expect(TEST_KINDS).not.toContain(w.kind);
});

test("FR-SHELL-08 every player window's default rect fits the viewport (1280×720, 1600×900)", () => {
  for (const viewport of VIEWPORTS) {
    for (const d of playerWindows.defs) {
      const r = fittedDefaultRect(d, viewport);
      const fits =
        r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= viewport.w && r.y + r.h <= viewport.h;
      expect(fits ? "ok" : `${d.kind} leaves the viewport at ${viewport.w}`).toBe("ok");
    }
  }
});

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The player's default layout, then `kinds` opened in order; `combat` = Initiative shown. */
function openOnDefaults(kinds: string[], viewport: { w: number; h: number }, combat = true) {
  const all = new Set(playerWindows.defs.map((d) => d.kind));
  if (!combat) all.delete("cbt.initiative");
  const ctx = { registry: playerWindows, viewport, available: all };
  let ws = defaultLayout(playerWindows, viewport);
  for (const kind of kinds) ws = [...reduce(ws, { type: "open", kind }, ctx)];
  return ws
    .filter((w) => w.state === "open" && all.has(w.kind))
    .map((w) => ({ kind: w.kind, ...clampRect(w, viewport) }));
}

const at = (rects: readonly (Rect & { kind: string })[], kind: string) => {
  const r = rects.find((x) => x.kind === kind);
  if (!r) throw new Error(`${kind} not open`);
  return r;
};

test("FR-SHELL-14 player default layout (#162): sheet top-right, Initiative at an edge at full size where one is free, log bottom-left", () => {
  for (const viewport of [LAPTOP, WIDE, DESKTOP]) {
    const open = openOnDefaults([], viewport);
    const sheet = at(open, "char.sheet");
    const init = at(open, "cbt.initiative");
    const log = at(open, "dice.log");
    expect(sheet.x + sheet.w).toBe(viewport.w - 12);
    expect(log.x).toBeLessThan(100);
    for (const r of [sheet, log]) expect(overlaps(init, r)).toBe(false);
    if (viewport === LAPTOP) {
      // No 200 px below the sheet at 720: the left edge, above the log.
      expect(init.x).toBe(12 + 56);
    } else {
      // A full-size free slot at either edge beats a shrunk one below the sheet (FR-NOTE-31
      // ruling): the left edge, above the log, 400 high.
      expect(touchedEdge(init, viewport)).toBe("left");
      expect(init.h).toBe(400);
    }
  }
});

test("FR-SHELL-54 player map-first: battlemap uncovered ≥ 55% at 1440×900, ≥ 65% at 1280×720 (sheet, log and Initiative open)", () => {
  for (const [viewport, min] of [
    [WIDE, 0.55],
    [LAPTOP, 0.65],
  ] as const) {
    // The `battlemap` fixture's map (20 × 14 cells at 70 px); the gated Initiative counts (combat).
    const map = fittedMapRect({ w: 1400, h: 980 }, viewport);
    const open = openOnDefaults([], viewport);
    expect(open.length).toBe(3);
    const share = uncoveredShare(map, open, viewport);
    console.info(
      `player default layout at ${viewport.w}×${viewport.h} leaves ${(share * 100).toFixed(1)}% of the battlemap uncovered`,
    );
    expect(share).toBeGreaterThanOrEqual(min);
  }
});

/** `session-sim` Goblin Ambush tokens a player holds (FIX `battlemap`, `goblin-2`, `thorn-battlemap`). */
const VISIBLE_TOKENS = [
  { name: "Mira", col: 2, row: 7, pc: true },
  { name: "Goblin", col: 12, row: 6, pc: false },
  { name: "Goblin 2", col: 12, row: 8, pc: false },
  { name: "Thorn", col: 2, row: 9, pc: true },
].map((t) => ({ ...t, size: "medium" as const }));
const CELL = 70;
const BATTLEMAP = { w: 1400, h: 980 };

test("FR-SHELL-34 default layout leaves tokens uncovered: player, the four visible Goblin Ambush tokens fitted per FR-MAP-44, before and after Initiative appears (1280×720, 1440×900, 1600×900); at the FR-MAP-46 floor only the PCs", () => {
  const grid = { gridCellSize: CELL, gridOffsetX: 0, gridOffsetY: 0 };
  for (const viewport of [LAPTOP, WIDE, DESKTOP]) {
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    const before = new Set([...all].filter((k) => k !== "cbt.initiative"));
    const layout = defaultLayout(playerWindows, viewport);
    // Start: Initiative becomes available and appears (FR-SHELL-18), then the map refits.
    const appeared = reduce(
      layout,
      { type: "appear", kind: "cbt.initiative" },
      { registry: playerWindows, viewport, available: all },
    );
    for (const [when, ws, available] of [
      ["before Start", layout, before],
      ["after Initiative appears", appeared, all],
    ] as const) {
      const rects = renderedWindowRects(ws, playerWindows, available, viewport);
      expect(rects.length).toBe(when === "before Start" ? 2 : 3);
      const free = freeArea(rects, viewport);
      const box = contentBox(VISIBLE_TOKENS, grid, BATTLEMAP);
      const pcs = footprintBox(
        VISIBLE_TOKENS.filter((t) => t.pc),
        grid,
      );
      const cam = fitContent(box, free, BATTLEMAP, workArea(viewport), CELL, pcs);
      expect(cam.scale * CELL).toBeGreaterThanOrEqual(FIT_MIN_CELL_PX - 1e-9);
      // FR-MAP-46 (G2): at the floor, edge monsters may sit under a window; the PCs may not.
      for (const t of VISIBLE_TOKENS.filter((t) => t.pc || !cam.floor)) {
        const c = {
          x: cam.x + (t.col + 0.5) * CELL * cam.scale,
          y: cam.y + (t.row + 0.5) * CELL * cam.scale,
        };
        const at = `${t.name} ${when} at ${viewport.w}×${viewport.h}`;
        const under = rects.find(
          (r) => c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h,
        );
        expect(under ? `${at} under a window` : "ok").toBe("ok");
        const inFree =
          c.x > free.x && c.x < free.x + free.w && c.y > free.y && c.y < free.y + free.h;
        expect(inFree ? "ok" : `${at} outside the free area`).toBe("ok");
      }
    }
  }
});

// ---- sprint 5: placement, wide Game log, default layouts (FR-SHELL-45–54, FR-DICE-38) ----

const MID = { w: 1280, h: 800 };
// Product kinds, gated ones included (Initiative in combat): every kind but the test-mode ones.
const product = new Set(
  playerWindows.defs
    .map((d) => d.kind)
    .filter((k) => !TEST_KINDS.includes(k) && k !== "asset.test"),
);

test("FR-SHELL-45 launcher opens never stack (player, 1280×720 / 1280×800 / 1440×900 / 1600×900, in and out of combat): every non-default product kind opened in registry order lands on no open window and not in the toast corner, auto-minimising first (FR-SHELL-47)", () => {
  const kinds = launcherKinds(playerWindows, product);
  expect(kinds.length).toBeGreaterThan(3);
  for (const viewport of REFERENCE_VIEWPORTS) {
    for (const combat of [false, true]) {
      const available = new Set(product);
      if (!combat) available.delete("cbt.initiative");
      const { steps } = launcherSequence(playerWindows, viewport, kinds, { available });
      for (const s of steps) {
        const where = `${s.kind} at ${viewport.w}×${viewport.h}${combat ? " in combat" : ""}`;
        expect(s.rect ? "open" : `${where} not open`).toBe("open");
        expect(s.hits.length === 0 ? "ok" : `${where} on ${s.hits.join(", ")}`).toBe("ok");
        for (const k of s.parked) {
          expect(playerWindows.get(k)?.defaultOpen ? `${where} parked ${k}` : "ok").toBe("ok");
        }
      }
    }
  }
});

test("FR-SHELL-48 keep-outs (player): the toast corner is hard: auto placement stays out; a feature open stored over it is re-placed, a user open isn't", () => {
  for (const viewport of REFERENCE_VIEWPORTS) {
    expect(keepOuts("player", viewport)).toEqual([
      { id: "toasts", rect: toastKeepOut("player", viewport), kind: "hard" },
    ]);
  }
  const viewport = MID;
  const corner = toastKeepOut("player", viewport);
  const ctx = { registry: playerWindows, viewport, available: new Set(product) };
  let ws = reduce(
    defaultLayout(playerWindows, viewport),
    { type: "open", kind: "note.history" },
    ctx,
  );
  expect(overlaps(rectIn(ws, "note.history"), corner)).toBe(false);
  const over = { x: corner.x, y: corner.y - 100, w: 360, h: 300 };
  ws = reduce(ws, { type: "setRect", kind: "note.history", rect: over }, ctx);
  ws = reduce(ws, { type: "minimise", kind: "note.history" }, ctx);
  const user = reduce(ws, { type: "open", kind: "note.history", by: "user" }, ctx);
  expect(rectIn(user, "note.history")).toEqual(over);
  const feature = reduce(ws, { type: "open", kind: "note.history", by: "feature" }, ctx);
  expect(overlaps(rectIn(feature, "note.history"), corner)).toBe(false);
});

test("FR-SHELL-50 default layouts (player, token-free): exactly §7's table at the four sizes; Initiative from its top-left line", () => {
  const table = [
    [
      LAPTOP,
      { x: 948, y: 60, w: 320, h: 338 },
      { x: 68, y: 484, w: 510, h: 160 },
      { x: 908, y: 410 },
    ],
    [MID, { x: 948, y: 60, w: 320, h: 418 }, { x: 68, y: 564, w: 510, h: 160 }, { x: 908, y: 490 }],
    [
      WIDE,
      { x: 1108, y: 60, w: 320, h: 440 },
      { x: 68, y: 544, w: 850, h: 280 },
      { x: 1068, y: 590 },
    ],
    [
      DESKTOP,
      { x: 1268, y: 60, w: 320, h: 440 },
      { x: 68, y: 544, w: 850, h: 280 },
      { x: 1228, y: 590 },
    ],
  ] as const;
  expect(playerWindows.get("cbt.initiative")?.defaultPosition).toEqual({
    anchor: "top-left",
    dx: 56,
  });
  for (const [viewport, sheet, log, corner] of table) {
    const layout = defaultLayout(playerWindows, viewport);
    expect(rectIn(layout, "char.sheet")).toEqual(sheet);
    expect(rectIn(layout, "dice.log")).toEqual(log);
    expect(rectIn(layout, "cbt.initiative")).toEqual({ x: 68, y: 60, w: 280, h: 400 });
    expect(toastKeepOut("player", viewport)).toEqual({ ...corner, w: 356, h: 238 });
  }
});

test("FR-SHELL-50 at Start with tokens (player): Initiative appears in the left column above the Game log, y by token cover", () => {
  for (const viewport of REFERENCE_VIEWPORTS) {
    const all = new Set(product);
    const layout = defaultLayout(playerWindows, viewport);
    const log = rectIn(layout, "dice.log");
    // A goblin under Initiative's token-free spot.
    const boxes = [{ x: 120, y: 100, w: 60, h: 60 }];
    const ctx = { registry: playerWindows, viewport, available: all, avoid: () => boxes };
    const ws = reduce(layout, { type: "appear", kind: "cbt.initiative" }, ctx);
    const init = rectIn(ws, "cbt.initiative");
    expect(init.x).toBe(68);
    expect(init.y + init.h).toBeLessThanOrEqual(log.y - 12);
    expect(coveredArea(init, boxes)).toBeLessThanOrEqual(
      coveredArea(rectIn(layout, "cbt.initiative"), boxes),
    );
  }
});

test("FR-SHELL-51 fitted default (player): the sheet 320×338 at 1280×720 and 320×418 at 1280×800 in its default column (12 px above the toast corner)", () => {
  for (const [viewport, h] of [
    [LAPTOP, 338],
    [MID, 418],
    [WIDE, 440],
  ] as const) {
    const sheet = rectIn(defaultLayout(playerWindows, viewport), "char.sheet");
    expect(sheet).toMatchObject({ x: viewport.w - 332, h });
    expect(sheet.y + sheet.h).toBeLessThanOrEqual(toastKeepOut("player", viewport).y - 12);
  }
});

test("FR-DICE-38 Game log width (player): 510×160 / 510×160 / 850×280 / 850×280; min 300×160; previous default 340×280", () => {
  const log = playerWindows.get("dice.log");
  if (!log) throw new Error("no dice.log");
  expect(REFERENCE_VIEWPORTS.map((vp) => defaultSizeAt(log, vp))).toEqual([
    { w: 510, h: 160 },
    { w: 510, h: 160 },
    { w: 850, h: 280 },
    { w: 850, h: 280 },
  ]);
  expect(log.minSize).toEqual({ w: 300, h: 160 });
  expect(log.previousDefaults).toEqual([{ w: 340, h: 280 }]);
});

test("FR-SHELL-52 growth cap (player): Initiative with 900 px of content stops 12 px above the Game log", () => {
  for (const viewport of REFERENCE_VIEWPORTS) {
    const layout = defaultLayout(playerWindows, viewport);
    const log = rectIn(layout, "dice.log");
    const measured = new Map([["cbt.initiative:main", 900]]);
    const open = layout.filter((w) => w.kind !== "cbt.initiative");
    const init = layout.filter((w) => w.kind === "cbt.initiative");
    const rects = renderedWindowRects(
      [...open, ...init],
      playerWindows,
      new Set(product),
      viewport,
      measured,
    );
    const r = rects[rects.length - 1] as Rect;
    expect(r.y + r.h).toBe(log.y - 12);
  }
});

test("FR-SHELL-53 previous defaults (player): a stored 340×280 log takes the viewport's default, written with area", () => {
  const raw = JSON.stringify({
    windows: [
      {
        kind: "dice.log",
        instance: "main",
        state: "open",
        x: 68,
        y: 544,
        w: 340,
        h: 280,
        z: 1,
        area: workArea(WIDE),
      },
    ],
  });
  const r = restoreLayout(playerWindows, raw, WIDE);
  expect(r.migrated).toBe(true);
  expect(r.windows[0]).toMatchObject({ x: 68, y: 544, w: 850, h: 280, area: workArea(WIDE) });
});

test("#162 player Loot opens at the left edge (shorter, not mid-map)", () => {
  for (const viewport of [LAPTOP, { w: 1280, h: 800 }, WIDE, DESKTOP]) {
    expect(at(openOnDefaults(["loot.log"], viewport, false), "loot.log").x).toBe(12 + 56);
  }
});

test("FR-SHELL-18 player Initiative appearing on Start avoids an open Notifications (layout check 7)", () => {
  for (const viewport of [LAPTOP, WIDE, DESKTOP]) {
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    const before = new Set([...all].filter((k) => k !== "cbt.initiative"));
    let ws = reduce(
      defaultLayout(playerWindows, viewport),
      { type: "open", kind: "note.history" },
      { registry: playerWindows, viewport, available: before },
    );
    ws = reduce(
      ws,
      { type: "appear", kind: "cbt.initiative" },
      {
        registry: playerWindows,
        viewport,
        available: all,
      },
    );
    const rects = ws
      .filter((w) => w.state === "open")
      .map((w) => ({ kind: w.kind, ...clampRect(w, viewport) }));
    const init = at(rects, "cbt.initiative");
    // Sprint 5: an edge, else beside an edge window (FR-SHELL-46); never on a window.
    for (const r of rects) {
      if (r.kind === init.kind) continue;
      expect(overlaps(init, r) ? `cbt.initiative overlaps ${r.kind} at ${viewport.w}` : "ok").toBe(
        "ok",
      );
    }
  }
});

test("FR-SHELL-08 player default-open product windows don't overlap (1280×720, 1600×900); test windows don't overlap each other", () => {
  const on = availableKinds(playerWindows, testMode);
  const off = availableKinds(playerWindows, emptyStore());
  const testOnly = new Set([...on].filter((k) => !off.has(k)));
  const product = new Set(
    playerWindows.defs.filter((d) => d.defaultOpen && !testOnly.has(d.kind)).map((d) => d.kind),
  );
  const groups = [
    { kinds: product, viewports: VIEWPORTS },
    { kinds: testOnly, viewports: VIEWPORTS },
  ];
  for (const { kinds, viewports } of groups) {
    for (const viewport of viewports) {
      const all = new Set(playerWindows.defs.map((d) => d.kind));
      const ctx = { registry: playerWindows, viewport, available: all };
      let ws = defaultLayout(playerWindows, viewport);
      for (const kind of kinds) ws = [...reduce(ws, { type: "open", kind }, ctx)];
      const rects = [...kinds].map((kind) => {
        const w = ws.find((x) => x.kind === kind);
        if (!w) throw new Error(`${kind} not in the layout`);
        return { kind, ...clampRect(w, viewport) };
      });
      for (const a of rects)
        for (const b of rects) {
          if (a === b) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap ? `${a.kind} overlaps ${b.kind} at ${viewport.w}` : "ok").toBe("ok");
        }
    }
  }
});

// ---- sprint 4: auto placement (FR-SHELL-40, -42) ----

const SPRINT4 = [LAPTOP, { w: 1280, h: 800 }, DESKTOP];
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

test("FR-SHELL-40 placement at 1280×720 / 1280×800 / 1600×900: player Initiative appearing over the goblins goes where it covers less, at an edge, over no window; no tokens → where the default layout put it", () => {
  for (const viewport of SPRINT4) {
    const where = `${viewport.w}×${viewport.h}`;
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    const layout = defaultLayout(playerWindows, viewport);
    const home = at(layout, "cbt.initiative");
    const ctx = { registry: playerWindows, viewport, available: all };
    const appear = { type: "appear", kind: "cbt.initiative" } as const;
    expect(same(at(reduce(layout, appear, ctx), "cbt.initiative"), home)).toBe(true);
    // Zoomed in (120 px cells) on the two goblins, under Initiative; the PCs off-screen left.
    const cell = 120;
    const ox = home.x + 20 - 12 * cell;
    const oy = home.y + 20 - 6 * cell;
    const boxes = VISIBLE_TOKENS.map((t) => ({
      x: ox + t.col * cell,
      y: oy + t.row * cell,
      w: cell,
      h: cell,
    }));
    const ws = reduce(layout, appear, { ...ctx, avoid: () => boxes });
    const init = at(ws, "cbt.initiative");
    expect(coveredArea(init, boxes)).toBeLessThan(coveredArea(home, boxes));
    expect(["left", "right"]).toContain(touchedEdge(init, viewport) ?? `mid-map at ${where}`);
    const others = ws.filter((w) => w.kind !== "cbt.initiative");
    for (const o of renderedWindowRects(others, playerWindows, all, viewport)) {
      expect(overlaps(init, o) ? `Initiative over a window at ${where}` : "ok").toBe("ok");
    }
  }
});

test("FR-SHELL-40 toast keep-out: player Initiative stays off the bottom-right box; Notifications never cover Initiative, the box only as the fallback (1280×720, 1280×800, 1600×900)", () => {
  for (const viewport of SPRINT4) {
    const where = `${viewport.w}×${viewport.h}`;
    const box = toastKeepOut("player", viewport);
    for (const combat of [true, false]) {
      const rects = openOnDefaults(["note.history"], viewport, combat);
      const notes = at(rects, "note.history");
      const others = rects.filter((r) => r.kind !== notes.kind);
      if (combat) {
        const init = at(rects, "cbt.initiative");
        expect(overlaps(init, box) ? `Initiative over the box at ${where}` : "ok").toBe("ok");
        expect(overlaps(notes, init) ? `Notifications over Initiative at ${where}` : "ok").toBe(
          "ok",
        );
      }
      // Free of every window → also clear of the box.
      if (!others.some((r) => overlaps(notes, r))) {
        expect(overlaps(notes, box) ? `Notifications over the box at ${where}` : "ok").toBe("ok");
      }
    }
  }
});

test("FR-SHELL-42 player handout viewer registers restoreOpen: false; nothing else does", () => {
  const off = playerWindows.defs.filter((d) => d.restoreOpen === false).map((d) => d.kind);
  expect(off).toEqual(["party.handout"]);
});

test("FR-SHELL-44 freeAreas: the player 1280×800 default layout yields both the strip above the Game log and the one right of it", () => {
  const viewport = { w: 1280, h: 800 };
  const before = new Set(playerWindows.defs.map((d) => d.kind));
  before.delete("cbt.initiative");
  const layout = defaultLayout(playerWindows, viewport);
  const rects = renderedWindowRects(layout, playerWindows, before, viewport);
  const log = at(layout, "dice.log");
  const sheet = at(layout, "char.sheet");
  const areas = freeAreas(rects, viewport);
  // Above the log: from the rail to the sheet, down to the log's top.
  expect(areas).toContainEqual({ x: 68, y: TOP_BAR_H, w: sheet.x - 68, h: log.y - TOP_BAR_H });
  // Right of the log: from the log's right edge to the sheet, the whole work area high.
  const right = areas.find((a) => a.x === log.x + log.w);
  expect(right).toEqual({
    x: log.x + log.w,
    y: TOP_BAR_H,
    w: sheet.x - (log.x + log.w),
    h: workArea(viewport).h,
  });
  expect(freeArea(rects, viewport)).toEqual(areas[0] as Rect);
});

test("FR-SHELL-43 player launcher, test-mode kinds included, at 1280 / 1440 / 1600 wide: every button inside the viewport with 8 px gutters or in the overflow menu; icon-only before any overflow; open windows stay in the bar", () => {
  const kinds = availableKinds(playerWindows, testMode);
  const entries = playerWindows.defs
    .filter((d) => d.launcher && kinds.has(d.kind))
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  const labels = new Map(entries.map((d) => [d.kind, d.launcher?.label ?? ""]));
  // Label widths as the Launcher's fallback measure (7 px a character, wider than text-xs).
  const m = launcherMetrics(labels, (label) => label.length * 7 + 1);
  for (const w of [1280, 1440, 1600, 900, 600]) {
    for (const open of [[], entries.slice(-2).map((d) => d.kind)]) {
      const items = entries.map((d) => ({
        kind: d.kind,
        order: d.launcher?.order ?? 0,
        state: open.includes(d.kind) ? ("open" as const) : ("closed" as const),
      }));
      const fit = fitLauncher(items, w, m);
      const gutter = (w - fittedBarWidth(fit, m)) / 2;
      expect(gutter >= LAUNCHER_GUTTER ? "ok" : `bar clipped at ${w}`).toBe("ok");
      expect([...fit.bar, ...fit.overflow].sort()).toEqual(items.map((i) => i.kind).sort());
      if (fit.overflow.length > 0) expect(fit.compact).toBe(true);
      for (const k of open)
        expect(fit.overflow.includes(k) && fit.bar.length > open.length).toBe(false);
      if (w >= 1280) expect(fit.overflow).toEqual([]);
    }
  }
});

// ---- W1 walkthrough re-test (2026-10-19): PC centres under auto-placed windows ----

const pcAt = (x: number, y: number) => ({ x: x - 23, y: y - 23, w: 46, h: 46, pc: true });
const pcUnder = (r: Rect, pcs: readonly Rect[]) =>
  pcs.filter((p) => {
    const c = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    return c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h;
  }).length;

test("FR-SHELL-45 (2) sweep (player-1, Town): every launcher window in registry order at 1280×720 / 1440×900 / 1600×900 holds no PC centre", () => {
  const cases = [
    [LAPTOP, [pcAt(410, 312), pcAt(458, 312)]],
    [WIDE, [pcAt(463, 363), pcAt(516, 363)]],
    [DESKTOP, [pcAt(543, 363), pcAt(596, 363)]],
  ] as const;
  for (const [viewport, pcs] of cases) {
    const available = new Set(product);
    available.delete("cbt.initiative"); // Town: no encounter
    const kinds = launcherKinds(playerWindows, product);
    const { steps } = launcherSequence(playerWindows, viewport, kinds, {
      available,
      avoid: () => pcs,
    });
    for (const s of steps) {
      const at = `${s.kind} at ${viewport.w}×${viewport.h}`;
      expect(s.hits.length === 0 ? "ok" : `${at} on ${s.hits.join(", ")}`).toBe("ok");
      expect(
        s.rect && pcUnder(s.rect, pcs) ? `${at} over a PC: ${JSON.stringify(s.rect)}` : "ok",
      ).toBe("ok");
    }
  }
});
