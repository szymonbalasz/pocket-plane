// Sprint 7 (track FU, FU1) registry-driven layout tests, DM: the size table (FR-SHELL-85), useful
// sizes on the real registry (FR-SHELL-79), Reset layout (FR-SHELL-80) and the sim-10 replays
// with the (e) invariants (FR-SHELL-87 (e), (f)). Pure: no DOM.
import { expect, mock, test } from "bun:test";
import { renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import {
  type LayoutStep,
  layoutRun,
  rectIn,
  sizeTableProblems,
} from "@ui/features/play-shell/layout-checks";
import {
  defaultLayout,
  type ManagerContext,
  reduce,
  type Windows,
} from "@ui/features/play-shell/manager";
import { pcClear } from "@ui/features/play-shell/placement";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { BANDS, PENDING_ROWS, SIZE_TABLE, TEST_KINDS } from "@ui/features/play-shell/size-table";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import { sim10Tokens } from "@ui/features/play-shell/test-cells";

// The players panel pulls in the DM session (localStorage at import); no DOM in bun test.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const LAPTOP = { w: 1280, h: 720 };
const WIDE = { w: 1440, h: 900 };
const all = () => new Set(dmWindows.defs.map((d) => d.kind));
const rendered = (ws: Parameters<typeof renderedWindowRects>[0], vp: { w: number; h: number }) =>
  renderedWindowRects(
    ws.filter((w) => w.state === "open"),
    dmWindows,
    all(),
    vp,
  );
/** sim-10's Goblin Ambush (DM view) at the Fit for the token-free default layout at `vp`. */
const fitted = (vp: { w: number; h: number }) =>
  sim10Tokens("dm", vp, rendered(defaultLayout(dmWindows, vp), vp));

test("FR-SHELL-85 FR-SHELL-100 size table (DM, shape only): every registered kind's default, useful (DM band 412 / 492 / 512 / 512; the ★ kinds' sprint-8 useful sizes), min size and criterion at the four sizes = §7's table; pending rows skipped until registered", () => {
  expect(
    sizeTableProblems(dmWindows, SIZE_TABLE.dm, BANDS.dm, TEST_KINDS, PENDING_ROWS.dm),
  ).toEqual([]);
});

test("FR-SHELL-79 useful size before shrinking (DM): note.history at 1280×720 opens 412 high (its minOpenH 480, band-capped), not below", () => {
  const ctx: ManagerContext = { registry: dmWindows, viewport: LAPTOP, available: all() };
  const ws = reduce(defaultLayout(dmWindows, LAPTOP), { type: "open", kind: "note.history" }, ctx);
  expect(rectIn(ws, "note.history").h).toBe(412);
});

test("FR-SHELL-80 reset keeps the zones (DM 1440×900): with sim-10's tokens drawn, Reset layout → Initiative 1028, 60, Game log 68, 584 (token-free), one Fit requested", () => {
  const tokens = fitted(WIDE);
  const storage = createLayoutStorage(() => ({ getItem: () => null, setItem: () => {} }));
  let fits = 0;
  const c = createShellController({
    registry: dmWindows,
    storage,
    viewport: () => WIDE,
    avoid: () => tokens,
    onReset: () => {
      fits += 1;
    },
  });
  c.restore("k");
  c.dispatch({ type: "open", kind: "cmp.compendium" }, all());
  c.dispatch({ type: "reset" }, all());
  const ws = c.store.getState().windows;
  expect(rectIn(ws, "cbt.initiative")).toMatchObject({ x: 1028, y: 60 });
  expect(rectIn(ws, "dice.log")).toMatchObject({ x: 68, y: 584 });
  expect(ws).toEqual(defaultLayout(dmWindows, WIDE));
  expect(fits).toBe(1);
});

const problemsOf = (steps: readonly LayoutStep[]) =>
  steps
    .filter((s) => s.problems.length > 0)
    .map((s) => `${s.step} ${s.vp.w}×${s.vp.h} ${s.kind}: ${s.problems.join("; ")}`);

test("FR-SHELL-87 sim-10 replays (DM b02, b03): 1440×900 Compendium, Party, Encounters; close; 1280×720 reopen; back to 1440×900, close, reopen → no PC under any window auto-placed at 1440×900 (the (e) checks at 1280×720); auto-minimised per FR-SHELL-78; Encounters ≥ 440×412", () => {
  const steps = layoutRun(dmWindows, {
    viewports: [WIDE, LAPTOP, WIDE],
    kinds: ["cmp.compendium", "party.board", "cbt.encounters"],
    available: all(),
    tokensAt: (vp, windows) => sim10Tokens("dm", vp, windows),
    protectedKind: "cbt.initiative",
  });
  expect(problemsOf(steps)).toEqual([]);
  const placed = steps.filter((s) => s.rect && (s.placed === "auto" || s.placed === "reopened"));
  expect(placed.length).toBeGreaterThan(0);
  // The camera layoutRun fits for each viewport: the token-free default layout's.
  const at = (s: LayoutStep) => `${s.step} ${s.vp.w}×${s.vp.h} ${s.kind} ${JSON.stringify(s.rect)}`;
  // 1440×900: every auto-placed window PC-clear. 1280×720: the fitted ambush fills the whole band
  // left of Initiative, so no 440×400 spot is PC-free even with every launcher window gone; the
  // (e) checks above then allow auto-minimising only for a full screen, and the least PC area.
  const wide = placed.filter((s) => s.vp.w === WIDE.w);
  expect(wide.length).toBeGreaterThan(0);
  for (const s of wide) {
    const clear = pcClear(s.rect as Rect, fitted(s.vp));
    expect({ at: at(s), clear }).toEqual({ at: at(s), clear: true });
  }
  // b03: Encounters opened 360×320 over Mira, Thorn and Brakka at 1440×900.
  for (const s of steps.filter((x) => x.kind === "cbt.encounters" && x.rect && x.vp.w === WIDE.w)) {
    const r = s.rect as Rect;
    expect({ at: at(s), ok: r.w >= 440 && r.h >= 412 }).toEqual({ at: at(s), ok: true });
  }
});

test("FR-SHELL-87 sim-10 replay (DM Scenes + Fog): Scenes at the top-left, the Fog bar pushes it right of the bar (FR-SHELL-55); the bar gone, it returns (FR-SHELL-81)", () => {
  const storage = createLayoutStorage(() => ({ getItem: () => null, setItem: () => {} }));
  const c = createShellController({ registry: dmWindows, storage, viewport: () => WIDE });
  c.restore("k");
  c.dispatch({ type: "open", kind: "map.scenes" }, all());
  const home = { x: 68, y: 60, w: 260, h: 440 };
  c.dispatch({ type: "setRect", kind: "map.scenes", rect: home }, all());
  const fogBar = { x: 62, y: 56, w: 472, h: 92 };
  c.dispatch({ type: "push", rect: fogBar }, all());
  const ws = c.store.getState().windows;
  expect(rectIn(ws, "map.scenes")).toMatchObject({ x: 546, y: 60 });
  expect(c.store.getState().placed.get("map.scenes:main")).toBe("pushed");
  c.dispatch({ type: "return" }, all());
  expect(rectIn(c.store.getState().windows, "map.scenes")).toEqual(home);
  expect(c.store.getState().placed.get("map.scenes:main")).toBe("returned");
});

test("FR-SHELL-87 (e) every sim-10 auto placement at the four sizes: launcher kinds in registry order on sim-10's ambush pass the look-ahead, useful-size, FR-SHELL-78 and brute checks", () => {
  const kinds = dmWindows.defs
    .filter((d) => !d.defaultOpen && d.launcher && !TEST_KINDS.has(d.kind))
    .map((d) => d.kind);
  for (const vp of [LAPTOP, { w: 1280, h: 800 }, WIDE, { w: 1600, h: 900 }]) {
    const steps = layoutRun(dmWindows, {
      viewports: [vp],
      kinds,
      available: all(),
      tokensAt: (v, windows) => sim10Tokens("dm", v, windows),
      protectedKind: "cbt.initiative",
    });
    expect(problemsOf(steps)).toEqual([]);
  }
  // The fitted ambush keeps every PC clear of the default layout (the input the replays start on).
  for (const vp of [LAPTOP, WIDE]) {
    const rects = rendered(defaultLayout(dmWindows, vp), vp);
    const tokens = fitted(vp);
    for (const r of rects) expect(pcClear(r, tokens)).toBe(true);
  }
});

test("FR-SHELL-77 DM 1280×720 PCs are player characters, min-size auto-minimise (sim-10 b02, b03; walkthrough U1, #319): Compendium 442,60 346×400; Party 442,60 346×400 auto-minimising Compendium; Encounters 442,60 368×320 auto-minimising Party; every one clear of every PC footprint (Mira, Thorn, Brakka)", () => {
  const tokens = fitted(LAPTOP);
  expect(tokens.filter((t) => t.pc).length).toBe(3);
  const log: string[] = [];
  const ctx: ManagerContext = {
    registry: dmWindows,
    viewport: LAPTOP,
    available: all(),
    avoid: () => tokens,
    onAutoMinimise: (id, forKind) => log.push(`${id.split(":")[0]}>${forKind}`),
  };
  let ws: Windows = defaultLayout(dmWindows, LAPTOP);
  const got: Record<string, string> = {};
  for (const kind of ["cmp.compendium", "party.board", "cbt.encounters"]) {
    ws = reduce(ws, { type: "open", kind }, ctx);
    const r = rectIn(ws, kind);
    got[kind] = `${r.x},${r.y} ${r.w}×${r.h}`;
    expect({ kind, pcClear: pcClear(r, tokens) }).toEqual({ kind, pcClear: true });
  }
  // No 440-wide spot is PC-free even on an empty map (U1's report): the min-size step (d) /
  // look-ahead (d') auto-minimises the previous window for a PC-clear spot below useful size.
  expect(got).toEqual({
    "cmp.compendium": "442,60 346×400",
    "party.board": "442,60 346×400",
    "cbt.encounters": "442,60 368×320",
  });
  expect(log).toEqual(["cmp.compendium>party.board", "party.board>cbt.encounters"]);
});
