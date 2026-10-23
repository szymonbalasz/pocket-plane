// Sprint 10 H2 repros (session-sim-13, `.verify/20261023-193558-session-sim-13/`), players: two
// launcher windows at 1280×720 where they fit at their useful sizes (BL-99). The harness world
// (`runScript`): the shell controller, the real pure camera, `session-sim-11` states.
import { expect, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

const { playerWindows } = await import("../../windows");

const LAPTOP = { w: 1280, h: 720 };
/** `kind:state:x,y,w×h` of a step's windows. */
const entry = (windows: string | undefined, kind: string) =>
  (windows ?? "").split(" ").find((e) => e.startsWith(`${kind}:`)) ?? "";

test("FR-SHELL-97 FR-SHELL-102 BL-99 players at 1280×720 out of a fight keep Recap and Stats open together where both fit at their useful sizes (sim-13 glitch 3: one put the other away); Recap grows back when Stats closes", () => {
  // Out of a fight (no Initiative): 828 px between the rail and the toast corner hold 400 + 400,
  // not 440 + 400; the PCs panned below the free band, right of the Game log.
  const run = runScript(playerWindows, "player-1", LAPTOP, "ambush", [
    "end",
    { pan: { x: 740, y: 570 } },
    { open: "recap.session" },
    { open: "stats.board" },
    { close: "stats.board" },
  ]);
  expect(run.problems).toEqual([]);
  const both = run.steps.find((s) => s.step === "open stats.board");
  expect(entry(both?.windows, "recap.session")).toBe("recap.session:open:68,60,400×412");
  expect(entry(both?.windows, "stats.board")).toContain(":open:");
  expect(both?.log).toBe("open:recap.session>squeezed;open:stats.board>L3s");
  expect(entry(run.steps.at(-1)?.windows, "recap.session")).toBe(
    "recap.session:open:68,60,440×412",
  );
});
