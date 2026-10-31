// Sprint 15, window memory (BL-146, #381): the DM's protected windows on a round trip through a
// resize, in the harness's world (the same placer and camera as the players' file).
import { expect, mock, test } from "bun:test";
import { REPLAY_SETS, runReplay } from "@ui/features/play-shell/replay";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const INIT = "cbt.initiative";
const initOf = (windows: string | undefined) =>
  windows?.split(" ").find((e) => e.startsWith(`${INIT}:`));

// D1 moved @1600×900 ends only with its own item (FR-SHELL-223: Party Manager's shrink).
for (const name of ["D2", "D3"]) {
  test(`FR-SHELL-220 ${name} moved @1600×900 resize: every window ends where it started`, () => {
    const set = REPLAY_SETS.dm.find((s) => s.name === name);
    if (!set) throw new Error(`no set ${name}`);
    const run = runReplay(dmWindows, set, "moved", { w: 1600, h: 900 }, "resize");
    expect(run.problems).toEqual([]);
  });
}

for (const name of ["D1", "D2", "D3"]) {
  test(`FR-SHELL-220 ${name} moved @1440×900 resize: Initiative back at its spot`, () => {
    const set = REPLAY_SETS.dm.find((s) => s.name === name);
    if (!set) throw new Error(`no set ${name}`);
    const run = runReplay(dmWindows, set, "moved", { w: 1440, h: 900 }, "resize");
    expect(run.problems).toEqual([]);
    const at = (step: string) => initOf(run.steps.find((s) => s.step === step)?.windows);
    // The premise: at 1280×720 it stood somewhere else (its zone).
    expect(at("viewport 1280×720")).not.toEqual(at("load"));
  });
}

test("FR-SHELL-223 D1 moved @1600×900 resize: Party Manager's shrink ends with the trip that caused it", () => {
  const set = REPLAY_SETS.dm.find((s) => s.name === "D1");
  if (!set) throw new Error("no set D1");
  const run = runReplay(dmWindows, set, "moved", { w: 1600, h: 900 }, "resize");
  expect(run.problems).toEqual([]);
  const board = run.steps
    .at(-1)
    ?.windows.split(" ")
    .find((e) => e.startsWith("party.board:"));
  expect(board).toBe("party.board:open:988,328,600×560");
});
