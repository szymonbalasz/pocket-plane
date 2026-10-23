// Walkthrough X1 (sprint 9 PM2, FR-SHELL-102, -104) on the DM registry at 1440×900: a remembered
// Compendium at 80,70 480 × 440, an untouched Stats stored open at 68,60 320 × 412; reload; the
// Fog bar (62,56 472 × 154) puts Stats away (`toolbar:map.toolbar`: PCs leave it no PC-clear spot
// ≥ useful, as on the walkthrough's Goblin Ambush); the bar closes → Stats comes back open, its
// old rect blocked by the remembered Compendium, so placed by the ladder (nothing put away); its
// memory cleared. The Compendium never moves (FR-SHELL-149).
import { expect, mock, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { type KeepOut, keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, restoreLayout } from "@ui/features/play-shell/manager";
import type { PlacementToken } from "@ui/features/play-shell/placement";
import { settle } from "@ui/features/play-shell/placer";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

test("FR-SHELL-102 a tool-bar put-away returns when the bar goes (DM, walkthrough X1): Stats put away by the Fog bar, its old rect under a remembered Compendium, comes back open by the ladder; memory cleared; nothing else moves", () => {
  const vp = { w: 1440, h: 900 };
  const base = defaultLayout(dmWindows, vp).filter(
    (w) => w.kind !== "cmp.compendium" && w.kind !== "stats.board",
  );
  const top = Math.max(0, ...base.map((w) => w.z));
  const cmp: WindowState = {
    kind: "cmp.compendium",
    instance: "main",
    state: "open",
    x: 80,
    y: 70,
    w: 480,
    h: 440,
    z: top + 1,
    userSpot: true,
    userSize: true,
  };
  const stats: WindowState = {
    kind: "stats.board",
    instance: "main",
    state: "open",
    x: 68,
    y: 60,
    w: 320,
    h: 412,
    z: top + 2,
  };
  // PCs every 90 px over the map: no PC-clear spot of Stats' useful size anywhere.
  const pcs: PlacementToken[] = [];
  for (let x = 70; x < vp.w; x += 90)
    for (let y = 60; y < vp.h; y += 90) pcs.push({ x, y, w: 40, h: 40, pc: true });
  const bar = { x: 62, y: 56, w: 472, h: 154 };
  const withBar: KeepOut[] = [
    ...keepOuts("dm", vp),
    { id: "map.toolbar", kind: "hard", rect: bar },
  ];
  const ctx = (regions: readonly KeepOut[], memory: readonly unknown[] = []) => ({
    registry: dmWindows,
    viewport: vp,
    available: new Set(dmWindows.defs.map((d) => d.kind)),
    avoid: () => pcs,
    keepOuts: () => regions,
    memory: () => memory as never,
  });
  const loaded = restoreLayout(
    dmWindows,
    JSON.stringify({ windows: [...base, cmp, stats] }),
    vp,
    [],
    keepOuts("dm", vp),
  ).windows;
  const win = (ws: readonly WindowState[], kind: string) =>
    ws.find((w) => w.kind === kind) as WindowState;
  expect(win(loaded, "stats.board")).toMatchObject({ state: "open", x: 68, y: 60 });

  const pushed = settle(loaded, { type: "push", rect: bar }, ctx(withBar));
  expect(win(pushed.windows, "stats.board").state).toBe("minimised");
  expect(pushed.putAway.get("stats.board:main")).toBe("toolbar:map.toolbar");

  const back = settle(pushed.windows, { type: "return" }, ctx(keepOuts("dm", vp), pushed.memory));
  const s = win(back.windows, "stats.board");
  expect(s.state).toBe("open");
  expect(back.memory.filter((d) => d.kind === "stats.board")).toEqual([]);
  expect(win(back.windows, "cmp.compendium")).toEqual(win(loaded, "cmp.compendium"));
  // Nothing put away for it; the protected windows where they were.
  for (const w of back.windows) {
    if (w.kind === "stats.board") continue;
    expect({ kind: w.kind, state: w.state }).toEqual({
      kind: w.kind,
      state: win(pushed.windows, w.kind).state,
    });
  }
});
