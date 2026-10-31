// Sprint 15 frame (session-sim-17 glitch 1, BL-174; `.verify/sim17/` k02, k03): pressing Attack on
// the DM's stat block must not put the stat block away. The sim's exact rects: DM 1440×900,
// Initiative + Game log in their zones, the stat block where the ladder put it (716,156 300×440),
// the three PCs where k02 draws them.
import { expect, mock, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { DICEX_TRAY_KIND } from "@ui/features/dice-extras/window-kind";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import {
  type Displacement,
  type ManagerContext,
  plan,
  type WindowAction,
  windowId,
} from "@ui/features/play-shell/manager";
import type { PlacementToken } from "@ui/features/play-shell/placement";
import { runScript } from "@ui/features/play-shell/replay";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const VP = { w: 1440, h: 900 };
const STAT = "ent.statblock";
const STAT_ID = windowId(STAT);
const STAT_RECT = { x: 716, y: 156, w: 300, h: 440 };

const win = (
  kind: string,
  rect: Omit<WindowState, "kind" | "instance" | "state" | "z">,
  z: number,
) =>
  ({ kind, instance: "main", state: "open", z, area: { w: 1440, h: 852 }, ...rect }) as WindowState;

/** k02: Initiative and Game log in their zones, the stat block on top. */
const SIM: WindowState[] = [
  win("cbt.initiative", { x: 1028, y: 60, w: 400, h: 500 }, 1),
  win("dice.log", { x: 68, y: 608, w: 1150, h: 280 }, 2),
  win(STAT, STAT_RECT, 3),
];

/** k02: mid-fight the Initiative rows grow it to 536 px (render-only, FR-SHELL-39). */
const HEIGHTS = new Map([[windowId("cbt.initiative"), 536]]);

/** k02's PCs (Mira, Brakka, Thorn), screen px, and two others. */
const TOKENS: PlacementToken[] = [
  { x: 322, y: 320, w: 36, h: 36, pc: true },
  { x: 320, y: 398, w: 40, h: 40, pc: true },
  { x: 560, y: 557, w: 40, h: 40, pc: true },
  { x: 204, y: 365, w: 72, h: 72 },
  { x: 444, y: 300, w: 72, h: 72 },
];

function ctx(
  tokens: readonly PlacementToken[],
  memory: readonly Displacement[] = [],
  inUse: string | null = STAT_ID,
): ManagerContext {
  return {
    registry: dmWindows,
    viewport: VP,
    available: new Set(dmWindows.defs.map((d) => d.kind)),
    avoid: () => tokens,
    keepOuts: () => keepOuts("dm", VP, new Map()),
    memory: () => memory,
    camera: () => "fitted",
    heights: (id) => HEIGHTS.get(id),
    inUse: () => inUse ?? undefined,
  };
}

const open: WindowAction = { type: "open", kind: DICEX_TRAY_KIND };
const get = (ws: readonly WindowState[], kind: string) =>
  ws.find((w) => w.kind === kind) as WindowState;
const overlap = (a: WindowState, b: WindowState) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("FR-SHELL-210 sim-17 k02: Attack on the stat block keeps it open and where it is; the Dice tray takes a spot beside it, PCs clear", () => {
  const p = plan(SIM, open, ctx(TOKENS));
  const stat = get(p.windows as WindowState[], STAT);
  const tray = get(p.windows as WindowState[], DICEX_TRAY_KIND);
  expect(stat.state).toBe("open");
  expect({ x: stat.x, y: stat.y, w: stat.w, h: stat.h }).toEqual(STAT_RECT);
  expect(tray.state).toBe("open");
  expect(overlap(tray, stat)).toBe(false);
  expect(p.pcClear.get(windowId(DICEX_TRAY_KIND))).toBe(true);
  expect([...p.putAway.keys()]).toEqual([]);
});

test("FR-SHELL-210 without an opener the ladder stands: the same open from the launcher puts the stat block away (FR-SHELL-78)", () => {
  const p = plan(SIM, open, ctx(TOKENS, [], null));
  expect(get(p.windows as WindowState[], STAT).state).toBe("minimised");
  expect(p.putAway.get(STAT_ID)).toBe(`open:${DICEX_TRAY_KIND}`);
});

test("FR-SHELL-210 only the Dice tray counts its opener as in use: another window opened from the stat block keeps the ladder", () => {
  const p = plan(SIM, { type: "open", kind: "cmp.compendium" }, ctx(TOKENS));
  expect(get(p.windows as WindowState[], STAT).state).toBe("minimised");
});

test("FR-SHELL-211 another launcher window gives way before the window in use, least recently used first", () => {
  const withOther = [
    // Only Thorn on the map: the band left of the stat block fits the tray once this one goes.
    win("note.history", { x: 68, y: 60, w: 360, h: 480 }, 1),
    ...SIM.map((w) => ({ ...w, z: w.z + 1 })),
  ];
  const p = plan(withOther, open, ctx(TOKENS.filter((t) => t.x === 560)));
  expect(get(p.windows as WindowState[], STAT).state).toBe("open");
  expect(get(p.windows as WindowState[], STAT).x).toBe(STAT_RECT.x);
  expect(get(p.windows as WindowState[], "note.history").state).toBe("minimised");
  expect(p.pcClear.get(windowId(DICEX_TRAY_KIND))).toBe(true);
});

/** PCs across every free column: no spot for even the tray's min size beside the stat block. */
const CROWD: PlacementToken[] = Array.from({ length: 14 }, (_, i) => ({
  x: 70 + i * 48,
  y: 60 + (i % 2) * 40,
  w: 30,
  h: 30,
  pc: true,
})).flatMap((t) => [t, { ...t, y: t.y + 200 }, { ...t, y: t.y + 400 }]);

test("FR-SHELL-212 PCs clear first: with no PC-clear spot beside it the stat block goes as the last resort, and comes back when the tray closes", () => {
  const free = CROWD.filter((t) => t.x + t.w < STAT_RECT.x);
  const opened = plan(SIM, open, ctx(free));
  const after = opened.windows as WindowState[];
  expect(get(after, STAT).state).toBe("minimised");
  expect(opened.putAway.get(STAT_ID)).toBe(`window:${DICEX_TRAY_KIND}`);
  expect(opened.pcClear.get(windowId(DICEX_TRAY_KIND))).toBe(true);
  const closed = plan(
    after,
    { type: "close", kind: DICEX_TRAY_KIND },
    ctx(free, opened.memory, null),
  );
  const stat = get(closed.windows as WindowState[], STAT);
  expect(stat.state).toBe("open");
  expect({ x: stat.x, y: stat.y, w: stat.w, h: stat.h }).toEqual(STAT_RECT);
});

test("FR-SHELL-210 harness: DM ambush @1440×900, stat block then the tray from it: open and unmoved; closing the tray changes nothing", () => {
  const run = runScript(dmWindows, "dm", VP, "ambush", [
    { open: STAT },
    { open: DICEX_TRAY_KIND, from: STAT },
    { close: DICEX_TRAY_KIND },
  ]);
  const entry = (i: number) =>
    run.steps
      .at(i)
      ?.windows.split(" ")
      .find((e) => e.startsWith(`${STAT}:`));
  expect(entry(1)).toMatch(/:open:/);
  expect(entry(2)).toBe(entry(1) as string);
  expect(entry(3)).toBe(entry(1) as string);
  expect(run.problems).toEqual([]);
});
