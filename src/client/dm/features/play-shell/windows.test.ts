import { expect, mock, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { clampRect, type Rect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { availableKinds } from "@ui/features/play-shell/registry";

// The players panel pulls in the DM session (localStorage, window.location at import); no DOM
// in bun test, and the shell only needs the window definition here.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const testMode = { ...emptyStore(), records: { probe: {} } };

test("FR-SHELL-07 DM registry loads; every type is a DM window", () => {
  expect(dmWindows.client).toBe("dm");
  for (const d of dmWindows.defs) expect(d.clients).toContain("dm");
});

test("FR-SHELL-21 DM registers camp.players, open by default, top-right", () => {
  const players = dmWindows.get("camp.players");
  expect(players?.defaultOpen).toBe(true);
  expect(players?.defaultPosition.anchor).toBe("top-right");
  expect(players?.launcher?.label).toBe("Players");
});

const LAPTOP = { w: 1280, h: 720 };
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

test("FR-SHELL-14 DM default layout: Scenes left, Players + Initiative right column, log bottom", () => {
  for (const viewport of VIEWPORTS) {
    const at = (kind: string) => {
      const r = openOnDefaults([], viewport).find((w) => w.kind === kind);
      if (!r) throw new Error(`${kind} not open by default`);
      return r;
    };
    const scenes = at("map.scenes");
    const players = at("camp.players");
    const init = at("cbt.initiative");
    const log = at("dice.log");
    expect(scenes.x).toBeLessThan(100);
    expect(players.x + players.w).toBe(viewport.w - 12);
    expect(init.x).toBe(players.x);
    expect(init.y).toBeGreaterThan(players.y + players.h);
    expect(init.w).toBeGreaterThanOrEqual(400); // glitch 3: AC / HP labels fit
    expect(log.y + log.h).toBe(viewport.h - 12 - 64);
  }
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
  ];
  for (const viewport of VIEWPORTS) {
    for (const kinds of cases) {
      const rects = openOnDefaults(kinds, viewport);
      for (const kind of kinds) {
        const a = rects.find((r) => r.kind === kind);
        if (!a) throw new Error(`${kind} not open`);
        for (const b of rects) {
          // Both at once don't fit 1280 px between Scenes and the right column: there they
          // only stay off the right column (Initiative's "Roll monsters", Players).
          const cramped = kinds.length > 1 && viewport === LAPTOP;
          const guard = cramped
            ? RIGHT_COLUMN.has(b.kind)
            : defaults.has(b.kind) || kinds.includes(b.kind);
          if (b.kind === kind || !guard) continue;
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
