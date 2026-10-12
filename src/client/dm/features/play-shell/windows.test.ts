import { expect, mock, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { clampRect, defaultRect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
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
      const r = defaultRect(d.defaultPosition, d.defaultSize, viewport);
      const fits =
        r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= viewport.w && r.y + r.h <= viewport.h;
      expect(fits ? "ok" : `${d.kind} leaves the viewport at ${viewport.w}`).toBe("ok");
    }
  }
});

/**
 * Overlap groups, derived from the registry (orchestrator ruling): default-open product windows
 * among themselves at 1600×900 (gated ones included: they open when they become available),
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
    { name: "product", kinds: product, viewports: [DESKTOP] },
    { name: "test-mode", kinds: testOnly, viewports: VIEWPORTS },
  ];
}

test("FR-SHELL-08 DM default-open product windows don't overlap (1600×900); test windows don't overlap each other", () => {
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
