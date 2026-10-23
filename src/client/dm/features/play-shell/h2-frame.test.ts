// Sprint 10 H2 repros (session-sim-13, `.verify/20261023-193558-session-sim-13/`), DM: the Party
// Manager's width at 1440×900 (BL-104), Party Manager + Stronghold putting each other away
// (BL-99) and the Fit with a remembered window over the map centre (BL-100). The harness world
// (`runScript`): the shell controller, the real pure camera, `session-sim-11` states.
import { expect, mock, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const VP = { w: 1440, h: 900 };
/** `kind:state:x,y,w×h` of a step's windows. */
const entry = (windows: string | undefined, kind: string) =>
  (windows ?? "").split(" ").find((e) => e.startsWith(`${kind}:`)) ?? "";
const size = (windows: string | undefined, kind: string) => {
  const m = /,(\d+)×(\d+)/.exec(entry(windows, kind));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

test("FR-SHELL-156 BL-104 the DM's Party Manager opens at its size row's width at 1440×900 (sim-13: 456 / 340 px)", () => {
  // Escort, fitted: PCs left of the free area, monsters across it (sim-13 a02).
  const run = runScript(dmWindows, "dm", VP, "escort", [{ open: "party.board" }]);
  expect(run.problems).toEqual([]);
  // The default width, at the band's height (512 at 1440×900): L1, not a token-avoiding L2 cut.
  expect(size(run.steps.at(-1)?.windows, "party.board")).toEqual({ w: 600, h: 512 });
});

test("FR-SHELL-97 FR-SHELL-102 BL-99 Party Manager and the Stronghold window stay open together at 1440×900 where they fit at their useful sizes; the Party Manager grows back when the Stronghold closes", () => {
  // The PCs panned clear of the free area (right of the Game log, under Initiative): 948 px left
  // of Initiative hold 440 + 480, not 600 + 480 (sim-13 glitch 3: one put the other away).
  const run = runScript(dmWindows, "dm", VP, "escort", [
    { pan: { x: 1325, y: 700 } },
    { open: "party.board" },
    { open: "hold.stronghold" },
    { close: "hold.stronghold" },
  ]);
  expect(run.problems).toEqual([]);
  const both = run.steps.find((s) => s.step === "open hold.stronghold")?.windows;
  expect(entry(both, "party.board")).toContain(":open:");
  expect(entry(both, "hold.stronghold")).toContain(":open:");
  expect(size(both, "party.board")?.w).toBeGreaterThanOrEqual(440);
  expect(size(both, "hold.stronghold")?.w).toBeGreaterThanOrEqual(400);
  // The squeeze ends with its cause (FR-SHELL-102): 600 wide again.
  const after = run.steps.at(-1)?.windows;
  expect(entry(after, "party.board")).toBe("party.board:open:68,60,600×512");
});
