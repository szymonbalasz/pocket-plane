// Sprint 15, window memory (BL-146, #381): the placer's round-trip memory on a DM-shaped registry,
// pure, through `settle` (the replay cells run the same on the real windows).
import { expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { workArea } from "./geometry";
import { keepOuts } from "./keep-outs";
import { type Displacement, defaultLayout, type ManagerContext, persistable } from "./manager";
import { settle } from "./placer";
import { createWindowRegistry, type WindowDef } from "./registry";

const Body = () => null;
const def = (kind: string, over: Partial<WindowDef> = {}): WindowDef => ({
  kind,
  title: kind,
  clients: ["dm"],
  defaultSize: { w: 440, h: 560 },
  minSize: { w: 320, h: 360 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: Body, label: kind, order: 1 },
  component: Body,
  ...over,
});
const dm = createWindowRegistry("dm", [
  def("t.log", {
    defaultOpen: true,
    defaultSize: { w: 690, h: 200 },
    minSize: { w: 300, h: 160 },
    usefulSize: { w: 460, h: 200 },
    defaultPosition: { anchor: "bottom-left", dx: 56 },
  }),
  def("t.init", {
    defaultOpen: true,
    defaultSize: { w: 400, h: 500 },
    minSize: { w: 320, h: 240 },
    usefulSize: { w: 400, h: 380 },
    defaultPosition: { anchor: "top-right" },
  }),
  def("t.a"),
]);
const all = new Set(dm.defs.map((d) => d.kind));
const BIG = { w: 1440, h: 900 };
const SMALL = { w: 1280, h: 720 };
const SPOT = { x: 500, y: 60, w: 400, h: 500 };
const ctx = (
  viewport: ManagerContext["viewport"],
  settledViewport: ManagerContext["viewport"],
  memory: readonly Displacement[] = [],
): ManagerContext => ({
  registry: dm,
  viewport,
  available: all,
  camera: () => "moved",
  keepOuts: () => keepOuts("dm", viewport, new Map()),
  settledViewport,
  memory: () => memory,
});
const init = (ws: readonly WindowState[]) => ws.find((w) => w.kind === "t.init") as WindowState;
const rect = (w: WindowState) => ({ x: w.x, y: w.y, w: w.w, h: w.h });
const at = (ws: readonly WindowState[], r: typeof SPOT) =>
  ws.map((w) => (w.kind === "t.init" ? { ...w, ...r, area: workArea(BIG) } : w));

const offZone = () => at(defaultLayout(dm, BIG), SPOT);

test("FR-SHELL-220 the way down remembers the spot, the way up takes it back and ends the trip", () => {
  const down = settle(offZone(), { type: "viewport" }, ctx(SMALL, BIG));
  const zone = rect(init(defaultLayout(dm, SMALL)));
  expect(rect(init(down.windows))).toEqual(zone);
  const trip = down.memory.find((d) => d.kind === "t.init");
  expect(trip?.cause).toBe("zone:1440×900");
  expect(trip?.rect).toEqual(SPOT);
  const up = settle(down.windows, { type: "viewport" }, ctx(BIG, SMALL, down.memory));
  expect(rect(init(up.windows))).toEqual(SPOT);
  expect(up.placed.get("t.init:main")).toBe("returned");
  expect(up.memory.some((d) => d.kind === "t.init")).toBe(false);
});

test("FR-SHELL-220 a window at its zone keeps no trip: the zone rule is all it needs", () => {
  const down = settle(defaultLayout(dm, BIG), { type: "viewport" }, ctx(SMALL, BIG));
  expect(down.memory.some((d) => d.kind === "t.init")).toBe(false);
});

test("FR-SHELL-221 a size still smaller than the one it left does not end the trip", () => {
  const down = settle(offZone(), { type: "viewport" }, ctx(SMALL, BIG));
  const mid = { w: 1400, h: 800 };
  const up = settle(down.windows, { type: "viewport" }, ctx(mid, SMALL, down.memory));
  expect(rect(init(up.windows))).toEqual(rect(init(defaultLayout(dm, mid))));
  expect(up.memory.find((d) => d.kind === "t.init")?.cause).toBe("zone:1440×900");
});

test("FR-SHELL-221 a spot no longer clear of a protected window is not taken back", () => {
  const down = settle(offZone(), { type: "viewport" }, ctx(SMALL, BIG));
  const trip = down.memory.find((d) => d.kind === "t.init") as Displacement;
  // The Game log's zone runs across a spot this low.
  const low = { ...SPOT, y: 500 };
  const up = settle(down.windows, { type: "viewport" }, ctx(BIG, SMALL, [{ ...trip, rect: low }]));
  expect(rect(init(up.windows))).not.toEqual(low);
});

test("FR-SHELL-221 a squeeze during the trip waits on it: its end leaves the trip going", () => {
  const down = settle(offZone(), { type: "viewport" }, ctx(SMALL, BIG));
  const trip = down.memory.find((d) => d.kind === "t.init") as Displacement;
  const squeezed = init(down.windows);
  const memory: Displacement[] = [
    {
      kind: "t.init",
      instance: "main",
      rect: rect(squeezed),
      cause: "window:t.a",
      at: rect(squeezed),
      under: trip,
    },
  ];
  // t.a isn't open: the cause ended. The zone comes back and the spot is still owed for the way up.
  const back = settle(down.windows, { type: "return" }, ctx(SMALL, SMALL, memory));
  expect(back.memory.find((d) => d.kind === "t.init")?.cause).toBe("zone:1440×900");
  const up = settle(back.windows, { type: "viewport" }, ctx(BIG, SMALL, back.memory));
  expect(rect(init(up.windows))).toEqual(SPOT);
});

test("FR-SHELL-226 what a layout entry stores during a trip is the rect it shows: no spot, 0 bytes", () => {
  const down = settle(offZone(), { type: "viewport" }, ctx(SMALL, BIG));
  expect(rect(init(persistable(down.windows, down.memory)))).toEqual(rect(init(down.windows)));
});
