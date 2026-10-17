import { expect, mock, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { freeArea, renderedWindowRects } from "@ui/features/play-shell/free-area";
import { clampRect, type Rect, TOP_BAR_H, workArea } from "@ui/features/play-shell/geometry";
import {
  fitLauncher,
  fittedBarWidth,
  LAUNCHER_GUTTER,
  launcherMetrics,
} from "@ui/features/play-shell/launcher-fit";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { fittedMapRect, touchedEdge, uncoveredShare } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { availableKinds } from "@ui/features/play-shell/registry";
import { toastKeepOut } from "@ui/features/play-shell/toast-region";
import { coveredArea } from "@ui/features/play-shell/token-boxes";
import {
  contentBox,
  FIT_MIN_CELL_PX,
  fitContent,
  footprintBox,
} from "@ui/features/scenes-map/camera";

// The players panel pulls in the DM session (localStorage, window.location at import); no DOM
// in bun test, and the shell only needs the window definition here.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const testMode = { ...emptyStore(), records: { probe: {} } };

test("FR-SHELL-07 DM registry loads; every type is a DM window", () => {
  expect(dmWindows.client).toBe("dm");
  for (const d of dmWindows.defs) expect(d.clients).toContain("dm");
});

test("FR-SHELL-21 DM registers camp.players; map-first (#162): closed by default, opens bottom-right", () => {
  const players = dmWindows.get("camp.players");
  expect(players?.defaultOpen).toBeFalsy();
  expect(players?.defaultPosition.anchor).toBe("bottom-right");
  expect(players?.launcher?.label).toBe("Players");
});

/** The `battlemap` fixture's map (20 × 14 cells at 70 px), the session-sim battle scene. */
const BATTLEMAP = { w: 1400, h: 980 };

const LAPTOP = { w: 1280, h: 720 };
const WIDE = { w: 1440, h: 900 };
const DESKTOP = { w: 1600, h: 900 };
const VIEWPORTS = [LAPTOP, DESKTOP];

test("FR-SHELL-08 every DM window's default rect fits the viewport (1280×720, 1600×900)", () => {
  for (const viewport of VIEWPORTS) {
    for (const d of dmWindows.defs) {
      const r = fittedDefaultRect(d, viewport);
      const fits =
        r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= viewport.w && r.y + r.h <= viewport.h;
      expect(fits ? "ok" : `${d.kind} leaves the viewport at ${viewport.w}`).toBe("ok");
      // Fitting only trims what the viewport can't hold.
      if (viewport === DESKTOP && d.kind !== "cbt.initiative") {
        expect({ kind: d.kind, ...d.defaultSize }).toEqual({ kind: d.kind, w: r.w, h: r.h });
      }
    }
  }
});

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Opens `kinds` in order on the default layout; returns every open window's rendered rect. */
function openOnDefaults(kinds: string[], viewport: { w: number; h: number }) {
  const all = new Set(dmWindows.defs.map((d) => d.kind));
  const ctx = { registry: dmWindows, viewport, available: all };
  let ws = defaultLayout(dmWindows, viewport);
  for (const kind of kinds) ws = [...reduce(ws, { type: "open", kind }, ctx)];
  return ws
    .filter((w) => w.state === "open")
    .map((w) => ({ kind: w.kind, ...clampRect(w, viewport) }));
}

test("FR-SHELL-14 DM default layout, map-first (#162): Initiative top-right, log bottom-left; Scenes and Players closed", () => {
  for (const viewport of VIEWPORTS) {
    const open = openOnDefaults([], viewport);
    expect(open.map((w) => w.kind).sort()).toEqual(["cbt.initiative", "dice.log"]);
    const at = (kind: string) => {
      const r = open.find((w) => w.kind === kind);
      if (!r) throw new Error(`${kind} not open by default`);
      return r;
    };
    const init = at("cbt.initiative");
    const log = at("dice.log");
    expect(init.x + init.w).toBe(viewport.w - 12);
    expect(init.y).toBe(TOP_BAR_H + 12);
    expect(init.w).toBeGreaterThanOrEqual(400); // glitch 3: AC / HP labels fit
    expect(log.x).toBe(12 + 56); // left edge, clear of the tool rail
    expect(log.y + log.h).toBe(viewport.h - 12 - 64);
  }
});

test("#162 DM Loot, Encounters, Creatures, Scenes open at the left edge (shorter, not mid-map)", () => {
  for (const viewport of [LAPTOP, { w: 1280, h: 800 }, WIDE, DESKTOP]) {
    for (const kind of ["loot.log", "cbt.encounters", "ent.creatures", "map.scenes"]) {
      const r = openOnDefaults([kind], viewport).find((w) => w.kind === kind);
      expect({ kind, x: r?.x }).toEqual({ kind, x: 12 + 56 });
    }
  }
});

test("#162 every DM window type opens at the left / right edge on the default layout, clear of it (1280×720, 1440×900, 1600×900)", () => {
  // Registry-driven. Test-mode windows (fixed walkthrough spots) only need some edge.
  const product = availableKinds(dmWindows, emptyStore());
  for (const viewport of [LAPTOP, WIDE, DESKTOP]) {
    for (const d of dmWindows.defs) {
      const rects = openOnDefaults([d.kind], viewport);
      const r = rects.find((w) => w.kind === d.kind);
      if (!r) throw new Error(`${d.kind} not open`);
      const edge = touchedEdge(r, viewport);
      const ok = product.has(d.kind) ? edge === "left" || edge === "right" : edge !== null;
      const at = `${viewport.w}×${viewport.h}`;
      expect(ok ? "ok" : `${d.kind} opens mid-map at ${at}: x${r.x} y${r.y}`).toBe("ok");
      if (!product.has(d.kind)) continue;
      // `minOpenH` (FR-NOTE-31 ruling): no full-size free slot → that height, on top of others.
      if (d.minOpenH !== undefined && r.h >= d.minOpenH) continue;
      for (const b of rects) {
        if (b.kind === d.kind) continue;
        expect(overlaps(r, b) ? `${d.kind} overlaps ${b.kind} at ${at}` : "ok").toBe("ok");
      }
    }
  }
});

test("#162 DM map-first: battlemap uncovered by the default layout ≥ 70% at 1440×900, ≥ 60% at 1280×720", () => {
  for (const [viewport, min] of [
    [WIDE, 0.7],
    [LAPTOP, 0.6],
  ] as const) {
    const map = fittedMapRect(BATTLEMAP, viewport);
    const share = uncoveredShare(map, openOnDefaults([], viewport), viewport);
    console.info(
      `DM default layout at ${viewport.w}×${viewport.h} leaves ${(share * 100).toFixed(1)}% of the battlemap uncovered`,
    );
    expect(share).toBeGreaterThanOrEqual(min);
  }
});

/** `session-sim` Goblin Ambush tokens (FIX `battlemap`, `goblin-2`, `thorn-battlemap`), all 1×1. */
const GOBLIN_AMBUSH = [
  { name: "Mira", col: 2, row: 7, pc: true },
  { name: "Goblin", col: 12, row: 6, pc: false },
  { name: "Wolf (hidden)", col: 14, row: 4, pc: false },
  { name: "Elite (hidden)", col: 15, row: 8, pc: false },
  { name: "Goblin 2", col: 12, row: 8, pc: false },
  { name: "Thorn", col: 2, row: 9, pc: true },
].map((t) => ({ ...t, size: "medium" as const }));
const CELL = 70;

/** The Goblin Ambush fitted per FR-MAP-44 / -46 into the DM default layout's free area. */
function fitAmbush(viewport: { w: number; h: number }) {
  const grid = { gridCellSize: CELL, gridOffsetX: 0, gridOffsetY: 0 };
  const all = new Set(dmWindows.defs.map((d) => d.kind));
  const layout = defaultLayout(dmWindows, viewport);
  expect(layout.some((w) => w.kind === "cbt.initiative" && w.state === "open")).toBe(true);
  const rects = renderedWindowRects(layout, dmWindows, all, viewport);
  const free = freeArea(rects, viewport);
  const box = contentBox(GOBLIN_AMBUSH, grid, BATTLEMAP);
  const pcs = footprintBox(
    GOBLIN_AMBUSH.filter((t) => t.pc),
    grid,
  );
  return { rects, free, cam: fitContent(box, free, BATTLEMAP, workArea(viewport), CELL, pcs) };
}

test("FR-SHELL-34 default layout leaves tokens uncovered: DM (Initiative open), all six Goblin Ambush tokens fitted per FR-MAP-44 (1280×720, 1440×900, 1600×900); at the FR-MAP-46 floor only the PCs", () => {
  for (const viewport of [LAPTOP, WIDE, DESKTOP]) {
    const { rects, free, cam } = fitAmbush(viewport);
    // FR-MAP-46 (G2): at the floor, edge monsters may sit under a window; the PCs may not.
    for (const t of GOBLIN_AMBUSH.filter((t) => t.pc || !cam.floor)) {
      const c = {
        x: cam.x + (t.col + 0.5) * CELL * cam.scale,
        y: cam.y + (t.row + 0.5) * CELL * cam.scale,
      };
      const at = `${t.name} at ${viewport.w}×${viewport.h}`;
      const under = rects.find((r) => c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h);
      expect(under ? `${at} under a window` : "ok").toBe("ok");
      const inFree = c.x > free.x && c.x < free.x + free.w && c.y > free.y && c.y < free.y + free.h;
      expect(inFree ? "ok" : `${at} outside the free area`).toBe("ok");
    }
    expect(cam.scale * CELL).toBeGreaterThanOrEqual(FIT_MIN_CELL_PX - 1e-9);
  }
});

test("FR-MAP-46 fit floor 48 px at 1280×720: session-sim Goblin Ambush in the DM free area with Initiative open → 48 px cell, floor", () => {
  const { cam } = fitAmbush(LAPTOP);
  expect(cam.floor).toBe(true);
  expect(Math.round(cam.scale * CELL)).toBe(FIT_MIN_CELL_PX);
});

/**
 * DM Initiative body height for header + `rows` rows, from its classes: window border 2,
 * title 32, padding 24; header = name 20 + gap 6 + buttons 32, wrapped to two lines at round 0
 * (+ 4 + 32); gap 8; column header 19; rows 40 each (py-0.5 + name / stats lines), gap 2.
 */
const initiativeHeightFor = (rows: number) =>
  2 + 32 + 24 + (20 + 6 + 32 + 4 + 32) + 8 + 19 + rows * 40 + (rows - 1) * 2;

test("FR-SHELL-32 DM Initiative default shows header + 6 rows at 1440×900; fits the work area at 1280×720", () => {
  const init = openOnDefaults([], WIDE).find((w) => w.kind === "cbt.initiative");
  expect(init?.h).toBe(500);
  expect(init?.h ?? 0).toBeGreaterThanOrEqual(initiativeHeightFor(6));
  const small = openOnDefaults([], LAPTOP).find((w) => w.kind === "cbt.initiative");
  if (!small) throw new Error("cbt.initiative not open");
  expect(small.y + small.h).toBeLessThanOrEqual(LAPTOP.h - 64); // above the launcher; rows scroll
});

const RIGHT_COLUMN = new Set(["camp.players", "cbt.initiative"]);

test("FR-SHELL-08 DM launcher windows open clear of the default-open ones (glitch 1)", () => {
  const defaults = new Set(dmWindows.defs.filter((d) => d.defaultOpen).map((d) => d.kind));
  const cases = [
    ["ent.creatures"],
    ["cbt.encounters"],
    ["note.history"],
    ["char.sheet"],
    ["ent.creatures", "cbt.encounters"],
    ["cbt.encounters", "ent.creatures"],
    ["map.scenes"],
    ["camp.players"],
    ["loot.log"],
    ["map.scenes", "cbt.encounters"],
  ];
  for (const viewport of VIEWPORTS) {
    for (const kinds of cases) {
      const rects = openOnDefaults(kinds, viewport);
      for (const kind of kinds) {
        const a = rects.find((r) => r.kind === kind);
        if (!a) throw new Error(`${kind} not open`);
        for (const b of rects) {
          // Two at once don't fit 1280 px between Scenes and the right column, and since
          // FR-SHELL-32 (Initiative 500 high) the right column has no 320 px slot left for
          // Encounters at 1600×900 either: then they only stay off the right column
          // (Initiative's "Roll monsters", Players) and cascade at the left edge.
          const cramped = kinds.length > 1;
          const guard = cramped
            ? RIGHT_COLUMN.has(b.kind)
            : defaults.has(b.kind) || kinds.includes(b.kind);
          if (b.kind === kind || !guard) continue;
          // `minOpenH` (FR-NOTE-31 ruling): opens at that height on top when nothing is free.
          if ((dmWindows.get(kind)?.minOpenH ?? Infinity) <= a.h) continue;
          const msg = `${kinds.join("+")}: ${kind} overlaps ${b.kind} at ${viewport.w}`;
          expect(overlaps(a, b) ? msg : "ok").toBe("ok");
        }
      }
    }
  }
});

/**
 * Overlap groups, derived from the registry (orchestrator ruling): default-open product windows
 * among themselves at both viewports (gated ones included: they open when they become available),
 * and test-mode windows (available only in test mode) among themselves at both viewports. A
 * test window may cover a product window; walkthroughs move it if needed.
 */
function overlapGroups(): { name: string; kinds: Set<string>; viewports: typeof VIEWPORTS }[] {
  const on = availableKinds(dmWindows, testMode);
  const off = availableKinds(dmWindows, emptyStore());
  const testOnly = new Set([...on].filter((k) => !off.has(k)));
  const product = new Set(
    dmWindows.defs.filter((d) => d.defaultOpen && !testOnly.has(d.kind)).map((d) => d.kind),
  );
  return [
    { name: "product", kinds: product, viewports: VIEWPORTS },
    { name: "test-mode", kinds: testOnly, viewports: VIEWPORTS },
  ];
}

test("FR-SHELL-08 DM default-open product windows don't overlap (1280×720, 1600×900); test windows don't overlap each other", () => {
  for (const { kinds, viewports } of overlapGroups()) {
    for (const viewport of viewports) {
      const all = new Set(dmWindows.defs.map((d) => d.kind));
      const ctx = { registry: dmWindows, viewport, available: all };
      let ws = defaultLayout(dmWindows, viewport);
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

test("FR-SHELL-20 test mode off → shell.test, sync.probes absent; on → present", () => {
  const off = availableKinds(dmWindows, emptyStore());
  expect(off.has("shell.test")).toBe(false);
  expect(off.has("sync.probes")).toBe(false);
  expect(off.has("camp.players")).toBe(true);
  const on = availableKinds(dmWindows, testMode);
  expect(on.has("shell.test")).toBe(true);
  expect(on.has("sync.probes")).toBe(true);
  // Ungated product windows are available either way.
  for (const d of dmWindows.defs.filter((d) => !d.available)) {
    expect(off.has(d.kind)).toBe(true);
    expect(on.has(d.kind)).toBe(true);
  }
});

test("FR-SHELL-14 DM default layout = every default-open window in the registry (gated ones too)", () => {
  const expected = dmWindows.defs
    .filter((d) => d.defaultOpen)
    .map((d) => d.kind)
    .sort();
  for (const viewport of VIEWPORTS) {
    const layout = defaultLayout(dmWindows, viewport);
    expect(layout.map((w) => w.kind).sort()).toEqual(expected);
  }
});

// ---- sprint 4: auto placement (FR-SHELL-40–42) ----

const MID = { w: 1280, h: 800 };
const SPRINT4 = [LAPTOP, MID, DESKTOP];
const allKinds = () => new Set(dmWindows.defs.map((d) => d.kind));
const win = (ws: readonly { kind: string }[], kind: string) => {
  const w = ws.find((x) => x.kind === kind);
  if (!w) throw new Error(`${kind} not in the layout`);
  return w as Rect & { kind: string; state: string };
};
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Goblin Ambush token boxes at a moved camera: `cell` px, the Goblin's cell at `at`. */
function ambushBoxes(at: { x: number; y: number }, cell: number, tokens = GOBLIN_AMBUSH) {
  const ox = at.x - 12 * cell;
  const oy = at.y - 6 * cell;
  return tokens.map((t) => ({ x: ox + t.col * cell, y: oy + t.row * cell, w: cell, h: cell }));
}

test("FR-SHELL-40 placement at 1280×720 / 1280×800 / 1600×900: DM Initiative opened at Start clears the monsters under its default top-right rect; no tokens → default rect; first load unchanged", () => {
  const def = dmWindows.get("cbt.initiative");
  if (!def) throw new Error("no cbt.initiative");
  for (const viewport of SPRINT4) {
    const at = `${viewport.w}×${viewport.h}`;
    // First load: no tokens drawn → the default layout keeps Initiative's fitted default rect.
    const layout = defaultLayout(dmWindows, viewport);
    const home = win(layout, "cbt.initiative");
    expect(same(home, fittedDefaultRect(def, viewport)) ? "ok" : `moved at ${at}`).toBe("ok");
    const plain = { registry: dmWindows, viewport, available: allKinds() };
    // Idle on load / End: minimised. Start: combat opens it by itself.
    const idle = reduce(layout, { type: "minimise", kind: "cbt.initiative" }, plain);
    const start = { type: "open", kind: "cbt.initiative", by: "feature" } as const;
    expect(same(win(reduce(idle, start, plain), "cbt.initiative"), home)).toBe(true);
    // The camera zoomed in (120 px cells) on the monsters, under the whole right column; the
    // PCs are off-screen left.
    const boxes = ambushBoxes({ x: home.x - 40, y: home.y + 2 * 120 }, 120);
    const monsters = boxes.filter((_, i) => !GOBLIN_AMBUSH[i]?.pc);
    expect(monsters.every((b) => overlaps(b, home))).toBe(true);
    const ws = reduce(idle, start, { ...plain, avoid: () => boxes });
    const init = win(ws, "cbt.initiative");
    expect(coveredArea(init, boxes)).toBeLessThan(coveredArea(home, boxes));
    expect(touchedEdge(init, viewport)).toBe("left");
    const others = ws.filter((w) => w.kind !== "cbt.initiative");
    for (const o of renderedWindowRects(others, dmWindows, allKinds(), viewport)) {
      expect(overlaps(init, o) ? `Initiative over a window at ${at}` : "ok").toBe("ok");
    }
    // Ties (tokens under no candidate) → the default column.
    const midMap = [{ x: viewport.w / 2, y: viewport.h / 2, w: 10, h: 10 }];
    const tie = reduce(idle, start, { ...plain, avoid: () => midMap });
    expect(same(win(tie, "cbt.initiative"), home)).toBe(true);
  }
});

test("FR-SHELL-40 toast keep-out: DM windows opened at 1280×720 / 1280×800 / 1600×900 stay off the top-centre box while a clear candidate exists; default layout clear of it", () => {
  for (const viewport of SPRINT4) {
    const box = toastKeepOut("dm", viewport);
    for (const w of defaultLayout(dmWindows, viewport)) {
      expect(overlaps(w, box) ? `${w.kind} over the toast box at ${viewport.w}` : "ok").toBe("ok");
    }
    // The Compendium (440 wide) at the left edge would reach the box at 1280 wide.
    const cmp = win(openOnDefaults(["cmp.compendium"], viewport), "cmp.compendium");
    expect(overlaps(cmp, box) ? `compendium over the toast box at ${viewport.w}` : "ok").toBe("ok");
  }
});

test("FR-SHELL-41 DM: Compendium dragged onto Initiative's stored rect; Start restores Initiative into a free slot, written with its area; a user open keeps the stored rect", () => {
  for (const viewport of SPRINT4) {
    const ctx = { registry: dmWindows, viewport, available: allKinds() };
    let ws = reduce(
      defaultLayout(dmWindows, viewport),
      { type: "minimise", kind: "cbt.initiative" },
      ctx,
    );
    ws = reduce(ws, { type: "open", kind: "cmp.compendium" }, ctx);
    const home = win(ws, "cbt.initiative");
    ws = reduce(
      ws,
      { type: "setRect", kind: "cmp.compendium", rect: { ...home, w: 440, h: 400 } },
      ctx,
    );
    const cmp = win(ws, "cmp.compendium");
    const started = reduce(ws, { type: "open", kind: "cbt.initiative", by: "feature" }, ctx);
    const init = started.find((w) => w.kind === "cbt.initiative");
    expect(init?.state).toBe("open");
    expect(
      init && overlaps(init, cmp) ? `over the Compendium at ${viewport.w}×${viewport.h}` : "ok",
    ).toBe("ok");
    expect(init?.area).toEqual(workArea(viewport));
    for (const by of [undefined, "user"] as const) {
      const user = win(
        reduce(ws, { type: "open", kind: "cbt.initiative", by }, ctx),
        "cbt.initiative",
      );
      expect(same(user, home)).toBe(true);
    }
  }
});

test('FR-SHELL-08 user opens keep the stored rect: the Not-shown badge → Scenes, a notification "Open" over another window', () => {
  const viewport = DESKTOP;
  const ctx = { registry: dmWindows, viewport, available: allKinds() };
  const layout = defaultLayout(dmWindows, viewport);
  const init = win(layout, "cbt.initiative");
  for (const kind of ["map.scenes", "note.history", "char.sheet"]) {
    let ws = reduce(layout, { type: "open", kind }, ctx);
    const spot = { x: init.x + 10, y: init.y + 10, w: 300, h: 300 };
    ws = reduce(ws, { type: "setRect", kind, rect: spot }, ctx);
    const stored = win(reduce(ws, { type: "close", kind }, ctx), kind);
    // `useOpenWindow()(kind)` dispatches `by: "user"`.
    const back = win(
      reduce(reduce(ws, { type: "close", kind }, ctx), { type: "open", kind, by: "user" }, ctx),
      kind,
    );
    expect(same(back, stored)).toBe(true);
    expect(overlaps(back, init)).toBe(true);
  }
});

test("FR-SHELL-42 DM handout viewer registers restoreOpen: false; nothing else does", () => {
  const off = dmWindows.defs.filter((d) => d.restoreOpen === false).map((d) => d.kind);
  expect(off).toEqual(["party.handout"]);
});

test("FR-SHELL-43 dm launcher, test-mode kinds included, at 1280 / 1440 / 1600 wide: every button inside the viewport with 8 px gutters or in the overflow menu; icon-only before any overflow; open windows stay in the bar", () => {
  const kinds = availableKinds(dmWindows, testMode);
  const entries = dmWindows.defs
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
