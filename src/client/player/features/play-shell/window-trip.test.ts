// Sprint 15, window memory (BL-146, #381): the protected windows' round trip through a resize, in
// the harness's world: the shell controller, the real pure camera, `session-sim-11` states.
import { expect, test } from "bun:test";
import {
  REPLAY_SETS,
  type ReplayRun,
  runReplay,
  runScript,
  type ScriptStep,
} from "@ui/features/play-shell/replay";

const { playerWindows } = await import("../../windows");

const BIG = { w: 1600, h: 900 };
const SMALL = { w: 1280, h: 800 };
const SHEET = "char.sheet";

/** A step's windows: `kind` → `state:x,y,w×h`, with `:user` for a remembered window. */
const windowsAt = (run: ReplayRun, step: string) => {
  const s = run.steps.findLast((x) => x.step === step);
  if (!s) throw new Error(`no step ${step}`);
  return new Map(
    s.windows.split(" ").map((e) => {
      const at = e.indexOf(":");
      return [e.slice(0, at), e.slice(at + 1)] as const;
    }),
  );
};

/** The PCs panned under the sheet's zone, the sheet reopened: the ladder takes it off its zone. */
const OFF_ZONE: readonly ScriptStep[] = [
  { pan: { x: 1428, y: 200 } },
  { close: SHEET },
  { open: SHEET },
];
const off = (run: ReplayRun) => windowsAt(run, `open ${SHEET}`).get(SHEET);

for (const name of ["P1", "P2", "P3"]) {
  test(`FR-SHELL-220 ${name} moved @1600×900 resize: every window ends where it started`, () => {
    const set = REPLAY_SETS.player.find((s) => s.name === name);
    if (!set) throw new Error(`no set ${name}`);
    const run = runReplay(playerWindows, set, "moved", BIG, "resize");
    expect(run.problems).toEqual([]);
    // The premise: the trip did take the sheet off the spot it started at.
    const start = run.steps.find((s) => s.step === "viewport 1440×900");
    const down = run.steps.find((s) => s.step === "viewport 1280×720");
    const sheetOf = (w: string | undefined) => w?.split(" ").find((e) => e.startsWith(SHEET));
    expect(sheetOf(down?.windows)).not.toEqual(sheetOf(start?.windows));
  });
}

test("FR-SHELL-220 the sheet goes to its zone on the way down and back to its spot on the way up", () => {
  const run = runScript(playerWindows, "player-1", BIG, "ambush", [
    ...OFF_ZONE,
    { viewport: SMALL },
    { viewport: BIG },
  ]);
  const spot = off(run);
  expect(spot).not.toEqual("open:1268,60,320×440");
  expect(windowsAt(run, "viewport 1280×800").get(SHEET)).toBe("open:948,60,320×440");
  expect(windowsAt(run, "viewport 1600×900").get(SHEET)).toBe(spot);
  expect(run.steps.at(-1)?.log).toContain(`viewport:${SHEET}>trip`);
});

test("FR-SHELL-221 a window the user moved during the trip keeps the user's spot (ADR-0064)", () => {
  const rect = { x: 500, y: 200, w: 320, h: 440 };
  const run = runScript(playerWindows, "player-1", BIG, "ambush", [
    ...OFF_ZONE,
    { viewport: SMALL },
    { drag: SHEET, rect },
    { viewport: BIG },
  ]);
  expect(windowsAt(run, "viewport 1600×900").get(SHEET)).toBe("open:500,200,320×440:user");
});

test("FR-SHELL-221 a spot a PC now sits under is not taken back: the zone rule places the window", () => {
  const first = runScript(playerWindows, "player-1", BIG, "ambush", [...OFF_ZONE]);
  const [x, y] = (off(first)?.split(":")[1]?.split(",") ?? []).map(Number);
  const run = runScript(playerWindows, "player-1", BIG, "ambush", [
    ...OFF_ZONE,
    { viewport: SMALL },
    // The PCs under the spot, far from the zone.
    { pan: { x: (x as number) + 100, y: (y as number) + 100 } },
    { viewport: BIG },
  ]);
  expect(windowsAt(run, "viewport 1600×900").get(SHEET)).toBe("open:1268,60,320×440");
});

test("FR-SHELL-226 a reload ends the trip: client memory, nothing stored (0 bytes)", () => {
  const run = runScript(playerWindows, "player-1", BIG, "ambush", [
    ...OFF_ZONE,
    { viewport: SMALL },
    "reload",
    { viewport: BIG },
  ]);
  // Back with a fitted camera at the zone, not at the spot from before the reload.
  expect(off(run)).not.toEqual("open:1268,60,320×440");
  expect(windowsAt(run, "viewport 1600×900").get(SHEET)).toBe("open:1268,60,320×440");
});

test("FR-SHELL-222 P3 fitted @1600×900 resize: Stats waits for its spot instead of taking the Game log's full zone", () => {
  const set = REPLAY_SETS.player.find((s) => s.name === "P3");
  if (!set) throw new Error("no set P3");
  const run = runReplay(playerWindows, set, "fitted", BIG, "resize");
  // Put away by the way down; on the way up 1440×900 has room for it only in the log's full zone.
  const stats = (step: string) => windowsAt(run, step).get("stats.board");
  expect(stats("viewport 1280×720")?.startsWith("minimised:")).toBe(true);
  expect(stats("viewport 1440×900")?.startsWith("minimised:")).toBe(true);
  expect(stats("viewport 1600×900")).toBe("open:360,60,400×412");
  expect(run.problems).toEqual([]);
});

test("FR-SHELL-223 P3 fitted @1600×900 resize: the Game log's squeeze ends with the trip that caused it", () => {
  const set = REPLAY_SETS.player.find((s) => s.name === "P3");
  if (!set) throw new Error("no set P3");
  const run = runReplay(playerWindows, set, "fitted", BIG, "resize");
  const log = (step: string) => windowsAt(run, step).get("dice.log");
  expect(log("load")).toBe("open:68,568,850×320");
  // Squeezed on the way down for Party Manager (the resize's own L2s), full again at 1600×900.
  expect(log("viewport 1440×900")).toBe("open:68,688,460×200");
  expect(log("viewport 1600×900")).toBe("open:68,568,850×320");
});
