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

const VIEWPORTS = [
  { w: 1280, h: 720 },
  { w: 1600, h: 900 },
];

/** Default-open windows + test-mode windows (on in test mode, off without it). */
function packedKinds(): Set<string> {
  const on = availableKinds(dmWindows, testMode);
  const off = availableKinds(dmWindows, emptyStore());
  const out = new Set<string>();
  for (const kind of on) {
    if (dmWindows.get(kind)?.defaultOpen || !off.has(kind)) out.add(kind);
  }
  return out;
}

test("FR-SHELL-08 every other DM window's default rect fits the viewport (1280×720, 1600×900)", () => {
  const packed = packedKinds();
  const others = dmWindows.defs.filter((d) => !packed.has(d.kind));
  for (const viewport of VIEWPORTS) {
    for (const d of others) {
      const r = defaultRect(d.defaultPosition, d.defaultSize, viewport);
      const fits =
        r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= viewport.w && r.y + r.h <= viewport.h;
      expect(fits ? "ok" : `${d.kind} leaves the viewport at ${viewport.w}`).toBe("ok");
    }
  }
});

/**
 * Overlap groups, derived from the registry: default-open product windows (available without
 * test mode) among themselves, and test-mode windows (available only in test mode) among
 * themselves. A test window may cover a product window; walkthroughs move it if needed.
 */
function overlapGroups(): Set<string>[] {
  const on = availableKinds(dmWindows, testMode);
  const off = availableKinds(dmWindows, emptyStore());
  const product = new Set([...off].filter((k) => dmWindows.get(k)?.defaultOpen));
  const testOnly = new Set([...on].filter((k) => !off.has(k)));
  return [product, testOnly];
}

test("FR-SHELL-08 DM default-open product windows don't overlap; test windows don't overlap each other (1280×720, 1600×900)", () => {
  for (const viewport of VIEWPORTS) {
    const ctx = { registry: dmWindows, viewport, available: availableKinds(dmWindows, testMode) };
    let ws = defaultLayout(dmWindows, viewport);
    for (const kind of availableKinds(dmWindows, testMode)) {
      ws = [...reduce(ws, { type: "open", kind }, ctx)];
    }
    const rectOf = new Map(ws.map((w) => [w.kind, clampRect(w, viewport)]));
    for (const group of overlapGroups()) {
      const rects = [...group].map((kind) => {
        const r = rectOf.get(kind);
        if (!r) throw new Error(`${kind} not in the layout`);
        return { kind, ...r };
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
});
