// Walkthrough F1 step 5 (sprint 14, FR-SHELL-102, -103, -104): DM Escort, Reset + Fit at
// 1440×900 → 1280×720 → open Party Manager (442,60 346 × 436) → back to 1440×900 (68,60 440 × 400,
// memory `grown:1280×720`) → the Fog bar (64,56 470 × 118) pushes it to 574,60 → the bar goes: it
// returns to 68,60 440 × 400 (was: stayed pushed, the push kept the `grown:` memory, so the bar
// had nothing to return; main too). Back at 1280×720 it is at 442,60 346 × 436 again (I7).
import { expect, mock, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

test("FR-SHELL-102 FR-SHELL-103 FR-SHELL-104 walkthrough F1 5: a Party Manager grown on the way up returns when the Fog bar goes, and to its 1280×720 rect on the way down", () => {
  const run = runScript(dmWindows, "dm", { w: 1440, h: 900 }, "escort", [
    "fit",
    { viewport: { w: 1280, h: 720 } },
    { open: "party.board" },
    { viewport: { w: 1440, h: 900 } },
    { toolbar: { x: 64, y: 56, w: 470, h: 118 } },
    { toolbar: null },
    { viewport: { w: 1280, h: 720 } },
  ]);
  const pm = (i: number) =>
    run.steps
      .at(i)
      ?.windows.split(" ")
      .find((e) => e.startsWith("party.board:"));
  expect(pm(3)).toBe("party.board:open:442,60,346×436");
  expect(pm(4)).toBe("party.board:open:68,60,440×400");
  expect(pm(5)).toBe("party.board:open:574,60,450×400");
  expect(pm(6)).toBe("party.board:open:68,60,440×400");
  expect(run.steps[6]?.log).toBe("return:party.board>returned");
  expect(pm(7)).toBe("party.board:open:442,60,346×436");
  expect(run.problems).toEqual([]);
});
