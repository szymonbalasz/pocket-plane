import { expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { clampRect, type Rect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { fittedMapRect, touchedEdge, uncoveredShare } from "@ui/features/play-shell/map-coverage";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { availableKinds } from "@ui/features/play-shell/registry";
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

const at = (rects: (Rect & { kind: string })[], kind: string) => {
  const r = rects.find((x) => x.kind === kind);
  if (!r) throw new Error(`${kind} not open`);
  return r;
};

test("FR-SHELL-14 player default layout (#162): sheet top-right, Initiative at an edge (below the sheet when it fits), log bottom-left", () => {
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
      expect(init.x + init.w).toBe(viewport.w - 12);
      expect(init.y).toBeGreaterThan(sheet.y + sheet.h);
    }
  }
});

test("#162 player map-first: battlemap uncovered ≥ 65% at 1440×900 and 1280×720 (sheet, log and Initiative open)", () => {
  for (const viewport of [WIDE, LAPTOP]) {
    // The `battlemap` fixture's map (20 × 14 cells at 70 px); the gated Initiative counts (combat).
    const map = fittedMapRect({ w: 1400, h: 980 }, viewport);
    const open = openOnDefaults([], viewport);
    expect(open.length).toBe(3);
    const share = uncoveredShare(map, open, viewport);
    console.info(
      `player default layout at ${viewport.w}×${viewport.h} leaves ${(share * 100).toFixed(1)}% of the battlemap uncovered`,
    );
    expect(share).toBeGreaterThanOrEqual(0.65);
  }
});

test("#162 every player window type opens at the left / right edge (1280×720, 1440×900, 1600×900); clear of the open windows out of combat, and in combat where there is room", () => {
  // Registry-driven. Test-mode windows (fixed walkthrough spots) only need some edge. In combat
  // at 1280×720 sheet, Initiative and log fill both edge columns: a window may overlap there.
  const product = availableKinds(playerWindows, emptyStore());
  for (const viewport of [LAPTOP, WIDE, DESKTOP]) {
    for (const combat of [false, true]) {
      for (const d of playerWindows.defs) {
        if (!combat && d.kind === "cbt.initiative") continue;
        const rects = openOnDefaults([d.kind], viewport, combat);
        const r = at(rects, d.kind);
        const edge = touchedEdge(r, viewport);
        const ok = product.has(d.kind) ? edge === "left" || edge === "right" : edge !== null;
        const where = `${viewport.w}×${viewport.h}${combat ? " in combat" : ""}`;
        expect(ok ? "ok" : `${d.kind} opens mid-map at ${where}: x${r.x} y${r.y}`).toBe("ok");
        if (!product.has(d.kind) || (combat && viewport === LAPTOP)) continue;
        for (const b of rects) {
          if (b.kind === d.kind) continue;
          expect(overlaps(r, b) ? `${d.kind} overlaps ${b.kind} at ${where}` : "ok").toBe("ok");
        }
      }
    }
  }
});

test("#162 player Loot opens at the left edge (shorter, not mid-map)", () => {
  for (const viewport of [LAPTOP, { w: 1280, h: 800 }, WIDE, DESKTOP]) {
    expect(at(openOnDefaults(["loot.log"], viewport, false), "loot.log").x).toBe(12 + 56);
  }
});

test("FR-SHELL-18 player Initiative appearing on Start avoids an open Notifications, at an edge (layout check 7)", () => {
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
    expect(["left", "right"]).toContain(touchedEdge(init, viewport) ?? "none");
    // 1280×720: sheet, log and Notifications fill both edge columns (see above).
    if (viewport === LAPTOP) continue;
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
