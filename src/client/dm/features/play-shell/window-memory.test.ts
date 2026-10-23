// Sprint 9 (track PM, PM1) on the DM's real windows: BL-87 (FR-SHELL-159, FR-MAP-114), the
// squeezed Game log growing back, and its refit. Pure: the in-memory shell controller at 1440×900.
import { expect, mock, test } from "bun:test";
import { fitRooms, renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { hardRects, keepOuts } from "@ui/features/play-shell/keep-outs";
import { pushBars } from "@ui/features/play-shell/manager";
import { type PlacementToken, pcClear } from "@ui/features/play-shell/placement";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import { fitBounds } from "@ui/features/scenes-map/camera";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const WIDE = { w: 1440, h: 900 };
const all = new Set(dmWindows.defs.map((d) => d.kind));
const rectOf = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** PCs over the band left of Initiative (sim-12: Mira under the free area): opens squeeze. */
function bandPcs(): PlacementToken[] {
  const out: PlacementToken[] = [];
  for (let x = 80; x < 1000; x += 90) {
    for (let y = 70; y < 400; y += 90) out.push({ x, y, w: 40, h: 40, pc: true });
  }
  return out;
}

function shellAt(camera: "fitted" | "moved", tokens: () => readonly PlacementToken[]) {
  const backend = new Map<string, string>();
  const refits: string[] = [];
  const c = createShellController({
    registry: dmWindows,
    storage: createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    })),
    viewport: () => WIDE,
    keepOuts: (v) => keepOuts("dm", v, new Map()),
    avoid: tokens,
    camera: () => camera,
    onRefit: () => void refits.push("window"),
  });
  c.restore("k");
  const log = () => {
    const w = c.store.getState().windows.find((x) => x.kind === "dice.log");
    return w ? rectOf(w) : null;
  };
  const act = (type: "open" | "close", kind: string) => c.dispatch({ type, kind }, all);
  return { c, log, act, refits };
}

const ZONE = { x: 68, y: 584, w: 1150, h: 240 };
const SQUEEZED = { x: 68, y: 664, w: 460, h: 160 };

test("FR-SHELL-159 Game log grows back (BL-87): DM 1440×900, Party Manager then a sheet opened as sim-12 → squeezed to 460×160; the cause closed, or put away for another open → back to 1150×240 in its zone (`returned`)", () => {
  for (const camera of ["fitted", "moved"] as const) {
    // Plain: open → squeezed; close → back.
    const a = shellAt(camera, bandPcs);
    expect(a.log()).toEqual(ZONE);
    a.act("open", "party.board");
    expect(a.log()).toEqual(SQUEEZED);
    expect(a.c.store.getState().placed.get("dice.log:main")).toBe("squeezed");
    a.act("close", "party.board");
    expect(a.log()).toEqual(ZONE);
    a.act("open", "char.sheet");
    expect(a.log()).toEqual(SQUEEZED);
    a.act("close", "char.sheet");
    expect(a.log()).toEqual(ZONE);
    expect(a.c.store.getState().placed.get("dice.log:main")).toBe("returned");
    // sim-12 glitch 5: the cause (Party Manager) is put away for a later open; it never comes
    // back (FR-SHELL-152), so its squeeze ends there. Once the windows in the zone close, the
    // Game log is back in its zone.
    const b = shellAt(camera, bandPcs);
    for (const k of ["party.board", "char.sheet", "cmp.compendium", "stats.board"])
      b.act("open", k);
    expect(b.c.store.getState().windows.find((w) => w.kind === "party.board")?.state).toBe(
      "minimised",
    );
    for (const k of ["stats.board", "cmp.compendium", "char.sheet"]) b.act("close", k);
    expect({ camera, log: b.log() }).toEqual({ camera, log: ZONE });
    expect(b.c.store.getState().memory).toEqual([]);
    // Shell-shrunk with no memory left (e.g. reloaded squeezed): the next `return` grows it back.
    const st = a.c.store.getState();
    a.c.store.setState({
      windows: st.windows.map((w) => (w.kind === "dice.log" ? { ...w, ...SQUEEZED } : w)),
    });
    a.c.dispatch({ type: "return" }, all);
    expect(a.log()).toEqual(ZONE);
    expect(a.c.store.getState().placed.get("dice.log:main")).toBe("grown");
  }
});

test("FR-MAP-114 refit on return: DM 1440×900, a PC under the Game log's zone: squeeze (Party Manager opens) → close → the Game log in its zone, one `window` refit (bounded by the last full fit: never zooms in past it); `moved` → no refit (the zone ladder)", () => {
  for (const camera of ["fitted", "moved"] as const) {
    let tokens: readonly PlacementToken[] = [];
    const s = shellAt(camera, () => tokens);
    // A PC under the zone's right part, clear of the squeezed log and of Party Manager's spot.
    tokens = [...bandPcs(), { x: 1150, y: 700, w: 40, h: 40, pc: true }];
    s.act("open", "party.board");
    expect(s.log()).toEqual(SQUEEZED);
    s.act("close", "party.board");
    if (camera === "fitted") {
      expect(s.log()).toEqual(ZONE);
      expect(s.refits).toEqual(["window"]);
    } else {
      expect(s.refits).toEqual([]);
      expect(pcClear(s.log() as Rect, tokens)).toBe(true);
    }
  }
  // The refit's bound (FR-MAP-94): a `window` refit never draws a cell above the last full fit.
  expect(fitBounds("window", 40, "dm").maxCell).toBe(40);
});

test("FR-MAP-115 remembered windows: a remembered window reopened over PCs asks for no refit and no yield (the camera stays); the fits count it as an obstacle, at its rendered (pushed) rect", () => {
  const tokens = bandPcs();
  let yields = 0;
  const s = shellAt("fitted", () => tokens);
  const c = createShellController({
    registry: dmWindows,
    storage: createLayoutStorage(() => ({ getItem: () => null, setItem() {} })),
    viewport: () => WIDE,
    keepOuts: (v) => keepOuts("dm", v, new Map()),
    avoid: () => tokens,
    camera: () => "fitted",
    lastFullCell: () => 40,
    dryFit: () => ({ cellPx: 40, clear: true }),
    onYield: () => {
      yields += 1;
    },
    onRefit: () => void s.refits.push("window"),
  });
  c.restore("k");
  const over = { x: 100, y: 80, w: 440, h: 420 }; // over the PCs
  c.dispatch({ type: "open", kind: "cmp.compendium" }, all);
  c.dispatch({ type: "setRect", kind: "cmp.compendium", rect: over }, all);
  c.dispatch({ type: "close", kind: "cmp.compendium" }, all);
  c.dispatch({ type: "open", kind: "cmp.compendium" }, all);
  expect(c.store.getState().settleLog).toBe("reopen:cmp.compendium>remembered");
  expect({ yields, refits: s.refits }).toEqual({ yields: 0, refits: [] });
  // The fit's obstacles: the remembered window as rendered, pushed off a shown bar.
  const bar = { x: 64, y: 56, w: 300, h: 100 };
  const regions = keepOuts("dm", WIDE, new Map([["map.toolbar", bar]]));
  const open = c.store.getState().windows.filter((w) => w.state === "open");
  const rects = renderedWindowRects(
    open,
    dmWindows,
    all,
    WIDE,
    new Map(),
    hardRects(regions),
    pushBars(regions),
  );
  const room = fitRooms("dm", rects, regions, WIDE, null).room;
  expect(room.obstacles).toContainEqual({ ...over, y: bar.y + bar.h + 12 });
});

/** PM1 walkthrough M9's inputs: Mira at 570,200, Brakka 486,284, Thorn 528,368 (36-px cells). */
const M9_PCS: PlacementToken[] = [
  { x: 570, y: 200, w: 36, h: 36, pc: true },
  { x: 486, y: 284, w: 36, h: 36, pc: true },
  { x: 528, y: 368, w: 36, h: 36, pc: true },
];

/** The DM page at 1440×900, `moved`, Initiative's content taller than the screen (it grows). */
function m9Page(backend = new Map<string, string>()) {
  const c = createShellController({
    registry: dmWindows,
    storage: createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    })),
    viewport: () => WIDE,
    keepOuts: (v) => keepOuts("dm", v, new Map()),
    avoid: () => M9_PCS,
    camera: () => "moved",
    heights: (id) => (id === "cbt.initiative:main" ? 900 : undefined),
  });
  c.restore("k");
  const log = () => {
    const w = c.store.getState().windows.find((x) => x.kind === "dice.log");
    return w ? rectOf(w) : null;
  };
  return { c, backend, log };
}

// Root cause first (PM1 walkthrough M9): the failing repro, before the fix.
test.failing("FR-SHELL-159 Game log grows back (BL-87, walkthrough M9): DM 1440×900 after Reset, `moved`, Mira at 570,200: Party opened (untouched) squeezes the Game log; Initiative grows into the freed space; Party closed → the Game log back at 1150×240 in its zone; a reload while squeezed stores no squeeze and the close still returns it", () => {
  for (const cause of ["party.board", "stats.board"]) {
    const p = m9Page();
    p.c.dispatch({ type: "reset" }, all);
    expect(p.log()).toEqual(ZONE);
    p.c.dispatch({ type: "open", kind: cause }, all);
    expect({ cause, log: p.log() }).toEqual({ cause, log: SQUEEZED });
    p.c.dispatch({ type: "close", kind: cause }, all);
    expect({ cause, log: p.log() }).toEqual({ cause, log: ZONE });
    // Squeezed, then a reload: the entry holds the zone rect, never the squeeze.
    p.c.dispatch({ type: "open", kind: cause }, all);
    expect(p.log()).toEqual(SQUEEZED);
    const stored = JSON.parse(p.backend.get("k") ?? "{}") as {
      windows: Rect[] & { kind: string }[];
    };
    const entry = stored.windows.find((w) => w.kind === "dice.log");
    expect(entry && rectOf(entry)).toEqual(ZONE);
    const again = m9Page(p.backend);
    expect(again.log()).toEqual(SQUEEZED);
    again.c.dispatch({ type: "close", kind: cause }, all);
    expect({ cause, reloaded: again.log() }).toEqual({ cause, reloaded: ZONE });
  }
  // An entry stored squeezed by an older build, its cause gone: back in the zone at load.
  const old = new Map([
    [
      "k",
      JSON.stringify({
        windows: [
          { kind: "dice.log", instance: "main", state: "open", ...SQUEEZED, z: 1 },
          {
            kind: "cbt.initiative",
            instance: "main",
            state: "open",
            x: 1028,
            y: 60,
            w: 400,
            h: 500,
            z: 2,
          },
        ],
      }),
    ],
  ]);
  expect(m9Page(old).log()).toEqual(ZONE);
});
