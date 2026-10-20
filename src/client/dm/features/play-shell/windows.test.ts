import { expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptyStore } from "@shared/protocol/store";
import { freeArea, freeAreas, renderedWindowRects } from "@ui/features/play-shell/free-area";
import { clampRect, type Rect, TOP_BAR_H, workArea } from "@ui/features/play-shell/geometry";
import { keepOuts, reportKeepOut } from "@ui/features/play-shell/keep-outs";
import {
  fitLauncher,
  fittedBarWidth,
  LAUNCHER_GUTTER,
  launcherMetrics,
} from "@ui/features/play-shell/launcher-fit";
import {
  bruteBest,
  contractProblems,
  type LayoutStep,
  launcherKinds,
  launcherSequence,
  layoutRun,
  placeFields,
  REFERENCE_VIEWPORTS,
  rectIn,
  rectOf,
} from "@ui/features/play-shell/layout-checks";
import { defaultLayout, reduce, restoreLayout } from "@ui/features/play-shell/manager";
import { fittedMapRect, touchedEdge, uncoveredShare } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect, placeWindow } from "@ui/features/play-shell/placement";
import {
  availableKinds,
  createWindowRegistry,
  defaultSizeAt,
  type WindowDef,
  type WindowRegistry,
} from "@ui/features/play-shell/registry";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import { ambushTokens } from "@ui/features/play-shell/test-cells";
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
        const size = defaultSizeAt(d, viewport);
        expect({ kind: d.kind, ...size }).toEqual({ kind: d.kind, w: r.w, h: r.h });
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

test("#162 DM Encounters, Creatures, Scenes open at the left edge (shorter, not mid-map)", () => {
  // `loot.log` retired (FR-LOOT-21); its body is the Party window's Loot tab.
  for (const viewport of [LAPTOP, { w: 1280, h: 800 }, WIDE, DESKTOP]) {
    for (const kind of ["cbt.encounters", "ent.creatures", "map.scenes"]) {
      const r = openOnDefaults([kind], viewport).find((w) => w.kind === kind);
      expect({ kind, x: r?.x }).toEqual({ kind, x: 12 + 56 });
    }
  }
});

// ---- sprint 5: placement, wide Game log, default layouts (FR-SHELL-45–54, FR-DICE-38) ----

// Product kinds, gated ones included: every kind but the test-mode ones.
const testOnlyKinds = new Set(
  [...availableKinds(dmWindows, testMode)].filter(
    (k) => !availableKinds(dmWindows, emptyStore()).has(k),
  ),
);
const product = new Set(dmWindows.defs.map((d) => d.kind).filter((k) => !testOnlyKinds.has(k)));

test("FR-SHELL-45 launcher opens never stack (DM, 1280×720 / 1280×800 / 1440×900 / 1600×900): every non-default product kind opened in registry order lands on no open window and no hard keep-out, auto-minimising first (FR-SHELL-47)", () => {
  const kinds = launcherKinds(dmWindows, product);
  expect(kinds.length).toBeGreaterThan(5);
  for (const viewport of REFERENCE_VIEWPORTS) {
    const { steps } = launcherSequence(dmWindows, viewport, kinds, { available: product });
    for (const s of steps) {
      const at = `${s.kind} at ${viewport.w}×${viewport.h}`;
      expect(s.rect ? "open" : `${at} not open`).toBe("open");
      expect(s.hits.length === 0 ? "ok" : `${at} on ${s.hits.join(", ")}`).toBe("ok");
      // Protected (default-open) windows are never parked.
      for (const k of s.parked)
        expect(dmWindows.get(k)?.defaultOpen ? `${at} parked ${k}` : "ok").toBe("ok");
    }
  }
});

test("FR-SHELL-45 FR-SHELL-46 FR-SHELL-47 sim-8 sequence (DM, Initiative + Game log): Compendium, Party, Encounters give §7's rects; Compendium and Party never share a rect", () => {
  const seq = ["cmp.compendium", "party.board", "cbt.encounters"];
  const wide = launcherSequence(dmWindows, WIDE, seq);
  const [cmp, party, enc] = wide.steps;
  expect(cmp?.rect).toEqual({ x: 68, y: 60, w: 440, h: 512 }); // minOpenH 400 ≤ the 512 band
  expect(party?.rect).toEqual({ x: 520, y: 60, w: 440, h: 512 }); // inward, beside Compendium
  expect(party?.rect).not.toEqual(cmp?.rect);
  expect(enc?.parked).toEqual(["cmp.compendium"]);
  expect(enc?.rect).toEqual({ x: 68, y: 60, w: 440, h: 512 });
  const laptop = launcherSequence(dmWindows, LAPTOP, seq);
  expect(laptop.steps[0]?.rect).toEqual({ x: 68, y: 60, w: 440, h: 412 });
  expect(laptop.steps[1]?.parked).toEqual(["cmp.compendium"]);
  expect(laptop.steps[2]?.parked).toEqual(["party.board"]);
  for (const s of laptop.steps) expect(s.rect).toEqual({ x: 68, y: 60, w: 440, h: 412 });
});

test("FR-SHELL-47 FR-SHELL-56 screen full (DM): the auto-minimised window is written minimised; a user restore onto its taken spot re-places it, parking the least recently used other window", () => {
  const seq = ["cmp.compendium", "party.board", "cbt.encounters"];
  const { windows } = launcherSequence(dmWindows, WIDE, seq);
  const cmp = windows.find((w) => w.kind === "cmp.compendium");
  expect(cmp?.state).toBe("minimised");
  const ctx = { registry: dmWindows, viewport: WIDE, available: allKinds() };
  const back = reduce(windows, { type: "open", kind: "cmp.compendium" }, ctx);
  // Its stored spot (68, 60) is Encounters' now: re-placed; Party (lowest z) parked for it.
  expect(back.find((w) => w.kind === "cmp.compendium")?.state).toBe("open");
  expect(back.find((w) => w.kind === "cbt.encounters")?.state).toBe("open");
  expect(back.find((w) => w.kind === "party.board")?.state).toBe("minimised");
  const shown = back.filter((w) => w.state === "open");
  const rects = renderedWindowRects(shown, dmWindows, allKinds(), WIDE);
  const mine = rects[shown.findIndex((w) => w.kind === "cmp.compendium")] as Rect;
  rects.forEach((r, i) => {
    if (shown[i]?.kind !== "cmp.compendium") expect(overlaps(mine, r)).toBe(false);
  });
  for (const w of back) {
    if (dmWindows.get(w.kind)?.defaultOpen) expect(w.state).toBe("open");
  }
});

test("FR-SHELL-48 keep-outs (DM): the top-centre toast box only ranks (4); a reported tool bar blocks auto placement but not freeAreas", () => {
  for (const viewport of REFERENCE_VIEWPORTS) {
    const regions = keepOuts("dm", viewport);
    expect(regions).toEqual([{ id: "toasts", rect: toastKeepOut("dm", viewport), kind: "soft" }]);
  }
  // Party beside Compendium at 1440×900 sits partly under the soft box: allowed, nothing clearer.
  const party = launcherSequence(dmWindows, WIDE, ["cmp.compendium", "party.board"]).steps[1];
  expect(party?.rect && overlaps(party.rect, toastKeepOut("dm", WIDE))).toBe(true);
  // The fog bar reported top-left: Scenes opens clear of it; the free areas ignore it.
  const bar = { x: 68, y: 60, w: 520, h: 120 };
  reportKeepOut("map.toolbar", bar);
  try {
    const scenes = launcherSequence(dmWindows, WIDE, ["map.scenes"]).steps[0];
    expect(scenes?.rect && overlaps(scenes.rect, bar)).toBe(false);
    const rects = renderedWindowRects(defaultLayout(dmWindows, WIDE), dmWindows, allKinds(), WIDE);
    expect(freeAreas(rects, WIDE).some((r) => overlaps(r, bar))).toBe(true);
  } finally {
    reportKeepOut("map.toolbar", null);
  }
});

test("FR-SHELL-50 default layouts (DM, token-free): exactly §7's table at 1280×720 / 1280×800 / 1440×900 / 1600×900", () => {
  const table = [
    [
      LAPTOP,
      { x: 868, y: 60, w: 400, h: 500 },
      { x: 68, y: 484, w: 690, h: 160 },
      { x: 462, y: 100 },
    ],
    [MID, { x: 868, y: 60, w: 400, h: 500 }, { x: 68, y: 564, w: 690, h: 160 }, { x: 462, y: 100 }],
    [
      WIDE,
      { x: 1028, y: 60, w: 400, h: 500 },
      { x: 68, y: 584, w: 1150, h: 240 },
      { x: 542, y: 100 },
    ],
    [
      DESKTOP,
      { x: 1188, y: 60, w: 400, h: 500 },
      { x: 68, y: 584, w: 1150, h: 240 },
      { x: 622, y: 100 },
    ],
  ] as const;
  for (const [viewport, init, log, box] of table) {
    const layout = defaultLayout(dmWindows, viewport);
    expect(rectIn(layout, "cbt.initiative")).toEqual(init);
    expect(rectIn(layout, "dice.log")).toEqual(log);
    expect(toastKeepOut("dm", viewport)).toEqual({ ...box, w: 356, h: 238 });
  }
});

test("FR-SHELL-51 fitted default (DM): Initiative 400×500 at every reference size; a size function by viewport class", () => {
  const init = dmWindows.get("cbt.initiative");
  if (!init) throw new Error("no cbt.initiative");
  for (const viewport of REFERENCE_VIEWPORTS) {
    expect(fittedDefaultRect(init, viewport)).toMatchObject({ w: 400, h: 500 });
  }
});

test("FR-DICE-38 Game log width (DM): 690×160 / 690×160 / 1150×240 / 1150×240; min 300×160; previous default 460×240", () => {
  const log = dmWindows.get("dice.log");
  if (!log) throw new Error("no dice.log");
  const sizes = REFERENCE_VIEWPORTS.map((vp) => defaultSizeAt(log, vp));
  expect(sizes).toEqual([
    { w: 690, h: 160 },
    { w: 690, h: 160 },
    { w: 1150, h: 240 },
    { w: 1150, h: 240 },
  ]);
  expect(log.minSize).toEqual({ w: 300, h: 160 });
  expect(log.previousDefaults).toEqual([{ w: 460, h: 240 }]);
  expect(defaultSizeAt(log, { w: 1440, h: 800 })).toEqual({ w: 1150, h: 160 });
});

test("FR-SHELL-52 growth cap (DM): Initiative with 900 px of content renders down to 644 / 724 / 572 / 572", () => {
  const all = allKinds();
  for (const [viewport, bottom] of [
    [LAPTOP, 644],
    [MID, 724],
    [WIDE, 572],
    [DESKTOP, 572],
  ] as const) {
    const layout = defaultLayout(dmWindows, viewport);
    const measured = new Map([["cbt.initiative:main", 900]]);
    const init = layout.filter((w) => w.kind === "cbt.initiative");
    const rects = renderedWindowRects(layout, dmWindows, all, viewport, measured);
    const r = renderedWindowRects(init, dmWindows, all, viewport, measured)[0];
    expect(rects.some((x) => x.y + x.h === bottom)).toBe(true);
    // Alone (no Game log below) it grows to the work area.
    expect(r && r.y + r.h).toBe(viewport.h - 76);
  }
});

test("FR-SHELL-53 previous defaults (DM): a stored 460×240 log → the viewport's default, written with area; a 1280×720 layout at 1440×900 and back; 470×240 kept; second apply = stored", () => {
  const entry = (
    log: { x: number; y: number; w: number; h: number },
    area: { w: number; h: number },
  ) =>
    JSON.stringify({
      windows: [
        {
          kind: "cbt.initiative",
          instance: "main",
          state: "open",
          ...rectIn(defaultLayout(dmWindows, WIDE), "cbt.initiative"),
          z: 1,
          area,
        },
        { kind: "dice.log", instance: "main", state: "open", ...log, z: 2, area },
      ],
    });
  const sprint4 = restoreLayout(
    dmWindows,
    entry({ x: 68, y: 584, w: 460, h: 240 }, workArea(WIDE)),
    WIDE,
  );
  expect(sprint4.migrated).toBe(true);
  const log = sprint4.windows.find((w) => w.kind === "dice.log");
  expect(log).toMatchObject({ x: 68, y: 584, w: 1150, h: 240, area: workArea(WIDE) });
  // Second apply: the stored entry is now the default, nothing to do.
  const again = restoreLayout(dmWindows, JSON.stringify({ windows: sprint4.windows }), WIDE);
  expect(again.migrated).toBeUndefined();
  // Saved at 1280×720 (690×160 at 68,484), opened at 1440×900: over Initiative there → placed.
  const small = restoreLayout(
    dmWindows,
    entry({ x: 68, y: 484, w: 690, h: 160 }, workArea(LAPTOP)),
    WIDE,
  );
  expect(rectIn(small.windows, "dice.log")).toEqual({ x: 68, y: 584, w: 1150, h: 240 });
  const back = restoreLayout(dmWindows, JSON.stringify({ windows: small.windows }), LAPTOP);
  expect(rectIn(back.windows, "dice.log")).toEqual({ x: 68, y: 484, w: 690, h: 160 });
  // Resized by the user (470×240): kept.
  const kept = restoreLayout(
    dmWindows,
    entry({ x: 68, y: 584, w: 470, h: 240 }, workArea(WIDE)),
    WIDE,
  );
  expect(kept.migrated).toBeUndefined();
  expect(rectIn(kept.windows, "dice.log")).toEqual({ x: 68, y: 584, w: 470, h: 240 });
});

test("FR-SHELL-54 DM map-first: battlemap uncovered by the default layout ≥ 55% at 1440×900, ≥ 60% at 1280×720", () => {
  for (const [viewport, min] of [
    [WIDE, 0.55],
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
    expect(["left", "right"]).toContain(touchedEdge(init, viewport) ?? "mid-map");
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

test("FR-SHELL-40 toast keep-out: DM default layout clear of the top-centre box; with no window-free slot, avoiding windows beats the box (Compendium never over Initiative)", () => {
  for (const viewport of SPRINT4) {
    const at = `${viewport.w}×${viewport.h}`;
    const box = toastKeepOut("dm", viewport);
    for (const w of defaultLayout(dmWindows, viewport)) {
      expect(overlaps(w, box) ? `${w.kind} over the toast box at ${at}` : "ok").toBe("ok");
    }
    // 1280 wide: no full-size slot; the left edge reaches into the box, the right one would sit
    // on Initiative → the left edge (toasts are transient, Initiative isn't; G35).
    const rects = openOnDefaults(["cmp.compendium"], viewport);
    const cmp = win(rects, "cmp.compendium");
    const init = win(rects, "cbt.initiative");
    expect(overlaps(cmp, init) ? `compendium over Initiative at ${at}` : "ok").toBe("ok");
    // 1600 wide: the left edge is clear of the box too.
    if (viewport === DESKTOP) {
      expect(overlaps(cmp, box) ? `compendium over the box at ${at}` : "ok").toBe("ok");
    }
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

test('FR-SHELL-08 FR-SHELL-56 user opens keep a clear stored rect (the DM soft box does not count), and re-place one now over another window: the Not-shown badge → Scenes, a notification "Open"', () => {
  const viewport = DESKTOP;
  const ctx = { registry: dmWindows, viewport, available: allKinds() };
  const layout = defaultLayout(dmWindows, viewport);
  const init = win(layout, "cbt.initiative");
  const reopen = (kind: string, spot: Rect) => {
    const ws = reduce(
      reduce(layout, { type: "open", kind }, ctx),
      {
        type: "setRect",
        kind,
        rect: spot,
      },
      ctx,
    );
    // `useOpenWindow()(kind)` dispatches `by: "user"`.
    const closed = reduce(ws, { type: "close", kind }, ctx);
    return {
      stored: win(closed, kind),
      back: win(reduce(closed, { type: "open", kind, by: "user" }, ctx), kind),
    };
  };
  for (const kind of ["map.scenes", "note.history", "char.sheet"]) {
    // Clear (partly under the DM's soft top-centre box): kept.
    const free = reopen(kind, { x: 600, y: 200, w: 300, h: 300 });
    expect(overlaps(free.back, toastKeepOut("dm", viewport))).toBe(true);
    expect(same(free.back, free.stored)).toBe(true);
    // Over Initiative: re-placed, clear of it.
    const covered = reopen(kind, { x: init.x + 10, y: init.y + 10, w: 300, h: 300 });
    expect(same(covered.back, covered.stored)).toBe(false);
    expect(overlaps(covered.back, init)).toBe(false);
  }
});

test("FR-SHELL-42 DM handout viewer and Preferences (FR-SHELL-71) register restoreOpen: false; nothing else does", () => {
  const off = dmWindows.defs.filter((d) => d.restoreOpen === false).map((d) => d.kind);
  expect(off).toEqual(["party.handout", "shell.prefs"]);
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

// ---- W1 walkthrough re-test (2026-10-19): PC centres under auto-placed windows ----

/** A 46-px token box centred on (x, y): the walkthrough's measured PC centres on Town. */
const pcAt = (x: number, y: number) => ({ x: x - 23, y: y - 23, w: 46, h: 46, pc: true });
const pcUnder = (r: Rect, pcs: readonly Rect[]) =>
  pcs.filter((p) => {
    const c = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    return c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h;
  }).length;

test("FR-SHELL-45 (2) W1 repro: DM 1440×900 on Town (Thorn 463,363, Mira 516,363), Reset, Compendium then Party → neither holds a PC centre (shrunk to ≥ min size rather than full size over a PC)", () => {
  const pcs = [pcAt(463, 363), pcAt(516, 363)];
  const { steps } = launcherSequence(dmWindows, WIDE, ["cmp.compendium", "party.board"], {
    avoid: () => pcs,
  });
  for (const s of steps) {
    expect(s.hits).toEqual([]);
    expect(
      s.rect && pcUnder(s.rect, pcs) ? `${s.kind} over a PC: ${JSON.stringify(s.rect)}` : "ok",
    ).toBe("ok");
    const def = dmWindows.get(s.kind);
    expect(s.rect && def && s.rect.w >= def.minSize.w && s.rect.h >= def.minSize.h).toBe(true);
  }
});

test("FR-SHELL-45 (2) sweep (DM, Town): every launcher window in registry order at 1280×720 / 1440×900 / 1600×900 holds no PC (footprint + 4 px) while a clear spot avoiding them exists; screen full only when nothing is clear (FR-SHELL-47)", () => {
  const cases = [
    [LAPTOP, [pcAt(410, 312), pcAt(458, 312)]],
    [WIDE, [pcAt(463, 363), pcAt(516, 363)]],
    [DESKTOP, [pcAt(543, 363), pcAt(596, 363)]],
  ] as const;
  for (const [viewport, pcs] of cases) {
    const kinds = launcherKinds(dmWindows, product);
    const { steps } = launcherSequence(dmWindows, viewport, kinds, {
      available: product,
      avoid: () => pcs,
    });
    for (const s of steps) {
      const at = `${s.kind} at ${viewport.w}×${viewport.h}`;
      expect(s.hits.length === 0 ? "ok" : `${at} on ${s.hits.join(", ")}`).toBe("ok");
      // Ruling #262's "park one more window to keep PCs clear" is retired (WF1 walkthrough
      // finding 2): a PC under the window only when no clear spot avoids it.
      const def = dmWindows.get(s.kind);
      if (!s.rect || !def) continue;
      const scene = { windows: s.others, hard: s.hard, tokens: pcs };
      const got = placeFields(s.rect, def, viewport, scene);
      expect(got[0] === 0 ? "ok" : `${at} not clear`).toBe("ok");
      if (got[1] === 1) expect(bruteBest(def, viewport, scene)[1]).toBe(1);
    }
  }
});

// ---- sprint 6: reopen rule, footprints, token-free spots, contract, golden layouts ----
// (FR-SHELL-56, -58, -61, -62; play-shell §13 sprint 6)

const FULL_CHAIN = [...REFERENCE_VIEWPORTS].reverse(); // 1600×900 → 1440×900 → 1280×800 → 1280×720
const ambush = (vp: { w: number; h: number }, windows: readonly Rect[]) =>
  ambushTokens("dm", vp, windows);

/** In-memory shell controller on `registry` (what the page runs), at `vp`. */
function shellAt(registry: WindowRegistry, vp: { w: number; h: number }) {
  const backend = new Map<string, string>();
  const storage = createLayoutStorage(() => ({
    getItem: (k) => backend.get(k) ?? null,
    setItem: (k, v) => void backend.set(k, v),
  }));
  const c = createShellController({ registry, storage, viewport: () => vp });
  c.restore("k");
  return c;
}

test("FR-SHELL-56 reopen covered vs free spot (DM, protected): Initiative closed, Compendium moved into its spot, Initiative reopened → Initiative at its stored rect (stored), Compendium re-placed clear of it (auto) or auto-minimised", () => {
  for (const viewport of REFERENCE_VIEWPORTS) {
    const at = `${viewport.w}×${viewport.h}`;
    const c = shellAt(dmWindows, viewport);
    const all = allKinds();
    const home = rectIn(c.store.getState().windows, "cbt.initiative");
    c.dispatch({ type: "close", kind: "cbt.initiative" }, all);
    c.dispatch({ type: "open", kind: "cmp.compendium" }, all);
    c.dispatch({ type: "setRect", kind: "cmp.compendium", rect: home }, all);
    c.dispatch({ type: "toggle", kind: "cbt.initiative" }, all); // the launcher button
    const s = c.store.getState();
    expect({ at, init: rectIn(s.windows, "cbt.initiative") }).toEqual({ at, init: home });
    expect(s.placed.get("cbt.initiative:main")).toBe("stored");
    const cmp = s.windows.find((w) => w.kind === "cmp.compendium");
    if (cmp?.state === "open") {
      expect(overlaps(cmp, home) ? `Compendium still over Initiative at ${at}` : "ok").toBe("ok");
      expect(s.placed.get("cmp.compendium:main")).toBe("auto");
    } else {
      expect(cmp?.state).toBe("minimised");
    }
    // A launcher window's own reopen: onto Initiative → `reopened`; then clear → `stored`.
    c.dispatch({ type: "close", kind: "cmp.compendium" }, all);
    c.dispatch({ type: "setRect", kind: "cmp.compendium", rect: home }, all); // stored only
    c.dispatch({ type: "open", kind: "cmp.compendium" }, all);
    expect(c.store.getState().placed.get("cmp.compendium:main")).toBe("reopened");
    c.dispatch({ type: "close", kind: "cmp.compendium" }, all);
    c.dispatch({ type: "open", kind: "cmp.compendium" }, all);
    expect(c.store.getState().placed.get("cmp.compendium:main")).toBe("stored");
  }
});

test("FR-SHELL-58 token-free spot first (DM, sim-9 a01): 1440×900, Initiative + Game log, the Goblin Ambush at its fit → Compendium covers no token while a clear spot over none exists, and no PC footprint", () => {
  const layout = defaultLayout(dmWindows, WIDE);
  const rects = renderedWindowRects(layout, dmWindows, allKinds(), WIDE);
  const tokens = ambush(WIDE, rects);
  const { steps } = launcherSequence(dmWindows, WIDE, ["cmp.compendium"], { avoid: () => tokens });
  const cmp = steps[0]?.rect;
  const def = dmWindows.get("cmp.compendium");
  if (!cmp || !def) throw new Error("Compendium not open");
  const scene = { windows: rects, hard: [], tokens };
  expect(bruteBest(def, WIDE, scene)).toEqual([0, 0, 0, 0]); // such a spot exists here
  expect(placeFields(cmp, def, WIDE, scene)).toEqual([0, 0, 0, 0]);
});

/** FR-SHELL-61 (5): stand-ins for PF's Preferences until PF1 registers the real line (S2, S3). */
const PREFS_STUB = {
  kind: "shell.prefs",
  title: "Preferences",
  clients: ["dm", "player"],
  defaultSize: { w: 360, h: 560 },
  minSize: { w: 320, h: 280 },
  minOpenH: 400,
  defaultPosition: { anchor: "top-right", dx: 12 },
  component: () => null,
} satisfies WindowDef;

/** The DM registry with this sprint's new windows: the real lines once merged, else the stubs. */
const withNewWindows = (): WindowRegistry =>
  dmWindows.get(PREFS_STUB.kind)
    ? dmWindows
    : createWindowRegistry("dm", [...dmWindows.defs, PREFS_STUB]);

/** FR-SHELL-62 (d): the DM's non-default product kinds on `main` when WF1 started, in registry order. */
const GOLDEN_KINDS = [
  "camp.players",
  "ent.creatures",
  "map.scenes",
  "note.history",
  "char.sheet",
  "cbt.encounters",
  "dicex.tray",
  "party.board",
  "cmp.compendium",
  "shell.prefs", // PF1 (FR-SHELL-62 (d): appended with its goldens)
  "charx.companion", // CP4 (S2): appended, goldens regenerated
];

/** Every non-default kind, test-mode ones and the handout viewer included (FR-SHELL-61 (3)). */
const userOpened = (registry: WindowRegistry) =>
  registry.defs.filter((d) => !d.defaultOpen).map((d) => d.kind);

const runs = (registry: WindowRegistry, kinds: readonly string[]) =>
  FULL_CHAIN.flatMap((_, i) =>
    layoutRun(registry, {
      viewports: FULL_CHAIN.slice(i),
      kinds,
      available: new Set(registry.defs.map((d) => d.kind)),
      tokensAt: ambush,
      protectedKind: "cbt.initiative",
    }),
  );

const problemsOf = (steps: readonly LayoutStep[]) =>
  steps
    .filter((s) => s.problems.length > 0)
    .map((s) => `${s.step} ${s.vp.w}×${s.vp.h} ${s.kind}: ${s.problems.join("; ")}`);

test("FR-SHELL-61 every user-opened kind (DM): every non-default kind, launcher or not, test-mode included, opens through openWindow and passes FR-SHELL-62's invariants with Preferences registered; a new kind keeps the contract", () => {
  const registry = withNewWindows();
  const kinds = userOpened(registry);
  expect(kinds).toContain("shell.prefs");
  expect(kinds).toContain("charx.companion"); // no DM launcher (FR-CHARX-59)
  expect(kinds).toContain("party.handout"); // no launcher button
  expect(kinds).toContain("shell.test"); // test mode
  expect(problemsOf(runs(registry, kinds))).toEqual([]);
  for (const kind of kinds.filter((k) => !GOLDEN_KINDS.includes(k))) {
    const def = registry.get(kind);
    if (!def || def.fixedDefault || kind === "party.handout") continue;
    expect({ kind, problems: contractProblems(def) }).toEqual({ kind, problems: [] });
  }
  // The stand-ins at the S3 numbers pass; a 480-wide one doesn't.
  expect(contractProblems(PREFS_STUB)).toEqual([]);
  expect(contractProblems({ ...PREFS_STUB, defaultSize: { w: 480, h: 300 } })).toEqual([
    "width 480 at 1280×720",
    "width 480 at 1280×800",
    "width 480 at 1440×900",
    "width 480 at 1600×900",
  ]);
});

const GOLDEN_FILE = fileURLToPath(new URL("./windows.golden.json", import.meta.url));

test("FR-SHELL-62 golden layouts (DM): four sizes, open / close / reopen / smaller viewport / protected reopen; invariants + brute check, golden rects per kind (UPDATE_GOLDEN=1 rewrites), deterministic", () => {
  const t0 = performance.now();
  const steps = runs(dmWindows, GOLDEN_KINDS);
  expect(problemsOf(steps)).toEqual([]);
  // Same inputs → same rects.
  expect(runs(dmWindows, GOLDEN_KINDS)).toEqual(steps);
  const golden = steps.map((s) => ({
    at: `${s.step} @${s.vp.w}×${s.vp.h} ${s.kind}`,
    rect: s.rect && `${s.rect.x},${s.rect.y},${s.rect.w}×${s.rect.h}`,
    placed: s.placed,
    parked: s.parked.join(","),
  }));
  if (process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`);
  }
  expect(golden).toEqual(JSON.parse(readFileSync(GOLDEN_FILE, "utf8")));
  console.info(
    `FR-SHELL-62 DM: ${steps.length} steps in ${(performance.now() - t0).toFixed(0)} ms`,
  );
});

// ---- WF1 walkthrough (2026-10-20) repros: the probes' exact inputs ----

/** The DM's Goblin Ambush footprints from the walkthrough probes: [name, x, y, side, pc]. */
const walkTokens = (dy: number) =>
  (
    [
      ["Adult", 350, 96, 144, 0],
      ["Ogre", 974, 96, 96, 0],
      ["Mira", 398, 336, 48, 1],
      ["Goblin", 638, 336, 48, 0],
      ["Wolf", 830, 240, 48, 0],
      ["Elite", 878, 432, 48, 0],
      ["Goblin2", 734, 432, 48, 0],
      ["Thorn", 350, 528, 48, 1],
      ["Lurker", 974, 576, 48, 0],
      ["Brakka", 302, 432, 48, 1],
      ["G3", 542, 144, 48, 0],
      ["G4", 590, 144, 48, 0],
      ["Elite2", 638, 144, 48, 0],
      ["Wolf2", 734, 144, 48, 0],
      ["Brute", 830, 144, 48, 0],
    ] as const
  ).map(([, x, y, s, pc]) => ({ x, y: y + dy, w: s, h: s, pc: pc === 1 }));

test("FR-SHELL-47 FR-SHELL-56 walkthrough finding 2 (DM 1280×720): restoring Party with 68–450 × 60–472 clear of windows (over Mira, Brakka, Thorn) is placed there, clear; Compendium is not auto-minimised", () => {
  const def = dmWindows.get("party.board");
  if (!def) throw new Error("no party.board");
  const tokens = walkTokens(-108); // the probe's 1280×720 camera
  const windows = [
    { x: 68, y: 484, w: 690, h: 160, protected: true },
    { x: 868, y: 60, w: 400, h: 544, protected: true },
    { x: 462, y: 72, w: 340, h: 400 }, // Compendium
  ];
  const soft = [toastKeepOut("dm", LAPTOP)];
  const p = placeWindow(def, LAPTOP, { windows, soft, tokens });
  expect(p.clear).toBe(true);
  for (const o of windows) expect(overlaps(p.rect, o)).toBe(false);
  // The same through the manager: Party restored, Compendium stays open.
  const ctx = { registry: dmWindows, viewport: LAPTOP, available: allKinds(), avoid: () => tokens };
  const area = workArea(LAPTOP);
  const at = (kind: string, state: "open" | "minimised", r: Rect, z: number) => ({
    kind,
    instance: "main",
    state,
    ...rectOf(r),
    z,
    area,
  });
  const ws = [
    at("dice.log", "open", windows[0] as Rect, 1),
    at("cbt.initiative", "open", windows[1] as Rect, 2),
    at("cmp.compendium", "open", windows[2] as Rect, 3),
    at("party.board", "minimised", { x: 462, y: 72, w: 340, h: 400 }, 4), // its spot: Compendium's
  ];
  const next = reduce(ws, { type: "open", kind: "party.board" }, ctx);
  expect(next.find((w) => w.kind === "cmp.compendium")?.state).toBe("open");
  const party = win(next, "party.board");
  expect(party.state).toBe("open");
  expect(overlaps(party, windows[2] as Rect)).toBe(false);
});

test("FR-SHELL-45 (2) walkthrough edge-on-PC row (DM 1440×900, F3): Encounters, which must cover PCs, holds them whole: no edge through a PC footprint + 4 px", () => {
  const def = dmWindows.get("cbt.encounters");
  if (!def) throw new Error("no cbt.encounters");
  const tokens = walkTokens(0);
  const windows = [
    { x: 68, y: 636, w: 1150, h: 188, protected: true },
    { x: 1028, y: 204, w: 400, h: 420, protected: true },
    { x: 580, y: 120, w: 340, h: 400 },
  ];
  const soft = [toastKeepOut("dm", WIDE)];
  const scene = { windows, hard: [], tokens };
  const p = placeWindow(def, WIDE, { windows, soft, tokens });
  expect(p.clear).toBe(true);
  expect(bruteBest(def, WIDE, scene)[1]).toBe(1); // no clear spot avoids every PC
  const cut = tokens
    .filter((t) => t.pc)
    .map((t) => ({ x: t.x - 4, y: t.y - 4, w: t.w + 8, h: t.h + 8 }))
    .filter((b) => overlaps(p.rect, b))
    .filter(
      (b) =>
        b.x < p.rect.x ||
        b.y < p.rect.y ||
        b.x + b.w > p.rect.x + p.rect.w ||
        b.y + b.h > p.rect.y + p.rect.h,
    );
  expect(cut).toEqual([]);
});
