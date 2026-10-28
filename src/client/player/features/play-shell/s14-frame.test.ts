// Sprint 14 F1 repros (session-sim-16, `.verify/20261026-234022-session-sim-16/`), player. The
// harness world (`runScript`): the shell controller, the real pure camera, `session-sim-11` states.
import { expect, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

const { playerWindows } = await import("../../windows");

/** `kind:state:x,y,w×h` of a step's windows. */
const entry = (windows: string | undefined, kind: string) =>
  (windows ?? "").split(" ").find((e) => e.startsWith(`${kind}:`)) ?? "";
const at = (run: ReturnType<typeof runScript>, step: string) =>
  run.steps.find((s) => s.step === step)?.windows;

test("FR-SHELL-95 FR-SHELL-56 BL-129 player 1280×720 mid-fight, the sheet remembered at 648,60 600×598: the Party Manager opened (last resort, over Initiative) comes back open at its rect after a reload; nothing else moves or resizes (sim-16 r20 / r21: minimised, Initiative grew 400 → 412)", () => {
  const run = runScript(playerWindows, "player-1", { w: 1280, h: 720 }, "ambush", [
    { drag: "char.sheet", rect: { x: 648, y: 60, w: 600, h: 598 }, resized: true },
    { open: "party.board" },
    "reload",
    "reload",
  ]);
  const opened = at(run, "open party.board");
  const pm = entry(opened, "party.board");
  expect(pm).toMatch(/^party\.board:open:/);
  for (const s of run.steps.filter((x) => x.step === "reload")) {
    // Before the fix: `party.board:minimised:…` (the zones' load pass put it away for Initiative).
    expect(s.windows).toBe(opened as string);
    expect(s.log).not.toContain("put-away");
  }
  // The open's last resort is the only overlap (FR-SHELL-47); a reload adds none.
  const problems = (step: string) => run.steps.find((s) => s.step === step)?.problems ?? [];
  for (const p of problems("reload")) expect(problems("open party.board")).toContain(p);
});
