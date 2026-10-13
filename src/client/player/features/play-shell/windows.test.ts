import { expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { clampRect, type Rect, TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { fittedDefaultRect } from "@ui/features/play-shell/placement";
import { availableKinds } from "@ui/features/play-shell/registry";
import { playerWindows } from "../../windows";

// Registry-driven: later builders append windows without touching these tests.
const TEST_KINDS = ["shell.test", "sync.probes"];
const testMode = { ...emptyStore(), records: { probe: {} } };
const LAPTOP = { w: 1280, h: 720 };
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

test("FR-SHELL-14 player default layout: sheet + initiative right column, log bottom-left", () => {
  for (const viewport of VIEWPORTS) {
    const ws = defaultLayout(playerWindows, viewport);
    const at = (kind: string) => {
      const w = ws.find((x) => x.kind === kind);
      if (!w) throw new Error(`${kind} not open by default`);
      return clampRect(w, viewport);
    };
    const sheet = at("char.sheet");
    const init = at("cbt.initiative");
    const log = at("dice.log");
    expect(sheet.x + sheet.w).toBe(viewport.w - 12);
    expect(init.x + init.w).toBeLessThan(sheet.x);
    // Clear of the map's left half, where the party's tokens usually are (glitch 2).
    expect(init.x).toBeGreaterThan(viewport.w / 2);
    expect(log.x).toBeLessThan(100);
  }
});

test("FR-SHELL-08 player Notifications opens clear of the sheet and initiative (glitch 2)", () => {
  for (const viewport of VIEWPORTS) {
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    const ctx = { registry: playerWindows, viewport, available: all };
    const ws = reduce(
      defaultLayout(playerWindows, viewport),
      { type: "open", kind: "note.history" },
      ctx,
    );
    const rects = ws.map((w) => ({ kind: w.kind, ...clampRect(w, viewport) }));
    const note = rects.find((r) => r.kind === "note.history");
    if (!note) throw new Error("note.history not open");
    for (const r of rects) {
      if (r.kind === note.kind) continue;
      expect(overlaps(note, r) ? `note.history overlaps ${r.kind} at ${viewport.w}` : "ok").toBe(
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
