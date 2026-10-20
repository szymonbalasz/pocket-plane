// Sprint 7 (track FU, FU1) registry-driven layout tests, player: the size table (FR-SHELL-85),
// useful sizes on the real registry (FR-SHELL-79), Reset layout (FR-SHELL-80), pushed windows
// returning (FR-SHELL-81) and the sim-10 replays with the (e) invariants (FR-SHELL-87). Pure.
import { expect, test } from "bun:test";
import { renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import {
  type LayoutStep,
  layoutRun,
  rectIn,
  sizeTableProblems,
} from "@ui/features/play-shell/layout-checks";
import { defaultLayout, type ManagerContext, reduce } from "@ui/features/play-shell/manager";
import { pcBoxes, pcClear } from "@ui/features/play-shell/placement";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { BANDS, SIZE_TABLE, TEST_KINDS } from "@ui/features/play-shell/size-table";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import { SIM10_AMBUSH_PLAYER, sim10Tokens } from "@ui/features/play-shell/test-cells";
import { playerWindows } from "../../windows";

const MID = { w: 1280, h: 800 };
const WIDE = { w: 1440, h: 900 };
const all = () => new Set(playerWindows.defs.map((d) => d.kind));
const rendered = (ws: Parameters<typeof renderedWindowRects>[0], vp: { w: number; h: number }) =>
  renderedWindowRects(
    ws.filter((w) => w.state === "open"),
    playerWindows,
    all(),
    vp,
  );
/** sim-10's Goblin Ambush (player view) at the Fit for `ws` (FR-MAP-59). */
const fittedFor = (ws: Parameters<typeof renderedWindowRects>[0], vp: { w: number; h: number }) =>
  sim10Tokens("player", vp, rendered(ws, vp));

function shell(vp: { w: number; h: number }, tokens: () => ReturnType<typeof sim10Tokens>) {
  const storage = createLayoutStorage(() => ({ getItem: () => null, setItem: () => {} }));
  const fits = { n: 0 };
  const c = createShellController({
    registry: playerWindows,
    storage,
    viewport: () => vp,
    avoid: tokens,
    onReset: () => {
      fits.n += 1;
    },
  });
  c.restore("k");
  return { c, fits, ws: () => c.store.getState().windows };
}

test("FR-SHELL-85 size table (player): every registered kind's default, useful (player band 412 / 492 / 472 / 472) and min size at the four sizes = §7's sprint-7 table", () => {
  expect(sizeTableProblems(playerWindows, SIZE_TABLE.player, BANDS.player, TEST_KINDS)).toEqual([]);
});

test("FR-SHELL-79 useful size before shrinking (player): note.history at 1440×900 opens 472 high (the player band); the companion card at 1280×800 with Compendium open auto-minimises it and opens 320×360 (sim-10 a03: 280×308)", () => {
  const ctx = (vp: { w: number; h: number }): ManagerContext => ({
    registry: playerWindows,
    viewport: vp,
    available: all(),
  });
  const notes = reduce(
    defaultLayout(playerWindows, WIDE),
    { type: "open", kind: "note.history" },
    ctx(WIDE),
  );
  expect(rectIn(notes, "note.history").h).toBe(472);
  let ws = reduce(
    defaultLayout(playerWindows, MID),
    { type: "open", kind: "cmp.compendium" },
    ctx(MID),
  );
  ws = reduce(ws, { type: "open", kind: "charx.companion" }, ctx(MID));
  expect(ws.find((w) => w.kind === "cmp.compendium")?.state).toBe("minimised");
  expect(rectIn(ws, "charx.companion")).toMatchObject({ w: 320, h: 360 });
});

test("FR-SHELL-80 reset keeps the zones (player 1280×800, c05): with sim-10's tokens drawn, Reset layout → sheet 948, 60, 320×418, Initiative 68, 60, 280×400, Game log as §7; one Fit requested", () => {
  const tokens = fittedFor(defaultLayout(playerWindows, MID), MID);
  const { c, fits, ws } = shell(MID, () => tokens);
  c.dispatch({ type: "open", kind: "cmp.compendium" }, all());
  c.dispatch({ type: "reset" }, all());
  expect(rectIn(ws(), "char.sheet")).toEqual({ x: 948, y: 60, w: 320, h: 418 });
  expect(rectIn(ws(), "cbt.initiative")).toEqual({ x: 68, y: 60, w: 280, h: 400 });
  expect(rectIn(ws(), "dice.log")).toEqual(rectIn(defaultLayout(playerWindows, MID), "dice.log"));
  expect(ws().some((w) => w.kind === "cmp.compendium")).toBe(false);
  expect(fits.n).toBe(1);
});

test("FR-SHELL-87 sim-10 replay r06 (player 1280×800): Reset layout, then the Fit, then Compendium, then the companion card → neither over Mira or Thorn; the card PC-clear", () => {
  let tokens = sim10Tokens("player", MID, []);
  const { c, ws } = shell(MID, () => tokens);
  c.dispatch({ type: "reset" }, all());
  tokens = fittedFor(ws(), MID); // FR-SHELL-80: the post-reset camera (FR-MAP-59's Fit)
  const pcs = (names: string[]) =>
    pcBoxes(
      tokens.filter((_, i) => names.includes((SIM10_AMBUSH_PLAYER[i] as { name: string }).name)),
    );
  const miraThorn = pcs(["Mira", "Thorn"]);
  const hits = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const kind of ["cmp.compendium", "charx.companion"]) {
    c.dispatch({ type: "open", kind }, all());
    const r = rectIn(ws(), kind);
    expect({ kind, over: miraThorn.some((p) => hits(r, p)) }).toEqual({ kind, over: false });
  }
  // At this camera the owned tokens (pets and summons count as PCs) leave no PC-free 320×360
  // spot even with Compendium gone, so the look-ahead fails and the card shrinks PC-free (step
  // (d)) rather than auto-minimise Compendium and cover a PC.
  expect(pcClear(rectIn(ws(), "charx.companion"), tokens)).toBe(true);
  expect(ws().find((w) => w.kind === "cmp.compendium")?.state).toBe("open");
});

test("FR-SHELL-81 pushed windows return (player, sim-10 c05): the AoE panel pushes Initiative to x 330; the panel closes → back at 68, 60, `returned`; a dragged window stays where dragged", () => {
  const { c, ws } = shell(MID, () => []);
  c.dispatch({ type: "reset" }, all());
  const home = rectIn(ws(), "cbt.initiative");
  const aoe = { x: 62, y: 56, w: 256, h: 300 };
  c.dispatch({ type: "push", rect: aoe }, all());
  expect(rectIn(ws(), "cbt.initiative").x).toBe(330);
  c.dispatch({ type: "return" }, all());
  expect(rectIn(ws(), "cbt.initiative")).toEqual(home);
  expect(c.store.getState().placed.get("cbt.initiative:main")).toBe("returned");
  // Again, the pushed window dragged a little: it stays (the user's move wins).
  c.dispatch({ type: "push", rect: aoe }, all());
  const pushed = rectIn(ws(), "cbt.initiative");
  const dragged = { ...pushed, x: pushed.x + 24 };
  c.dispatch({ type: "setRect", kind: "cbt.initiative", rect: dragged }, all());
  c.dispatch({ type: "return" }, all());
  expect(rectIn(ws(), "cbt.initiative")).toEqual(dragged);
});

const problemsOf = (steps: readonly LayoutStep[]) =>
  steps
    .filter((s) => s.problems.length > 0)
    .map((s) => `${s.step} ${s.vp.w}×${s.vp.h} ${s.kind}: ${s.problems.join("; ")}`);

test("FR-SHELL-87 (e) every sim-10 auto placement at the four sizes (player): launcher kinds in registry order on sim-10's ambush pass the look-ahead, useful-size, FR-SHELL-78 and brute checks", () => {
  const kinds = playerWindows.defs
    .filter((d) => !d.defaultOpen && d.launcher && !TEST_KINDS.has(d.kind))
    .map((d) => d.kind);
  for (const vp of [{ w: 1280, h: 720 }, MID, WIDE, { w: 1600, h: 900 }]) {
    const steps = layoutRun(playerWindows, {
      viewports: [vp],
      kinds,
      available: all(),
      tokensAt: (v, windows) => sim10Tokens("player", v, windows),
      protectedKind: "char.sheet",
    });
    expect(problemsOf(steps)).toEqual([]);
  }
  // The fitted ambush keeps every PC clear of the default layout.
  const tokens = fittedFor(defaultLayout(playerWindows, MID), MID);
  for (const r of rendered(defaultLayout(playerWindows, MID), MID)) {
    expect(pcClear(r, tokens)).toBe(true);
  }
});
