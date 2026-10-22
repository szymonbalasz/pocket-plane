// Sprint 8 WF3 repro (WF2 walkthrough notes: the DM cell changed on reload at the same viewport,
// 42 → 48 at 1440×900): Stats + Scenes squeeze the Game log and Initiative in their zones; a
// reload dropped the squeeze (client memory, FR-SHELL-102), re-zoned them at full size and
// displaced Scenes, so the load fit framed another layout. A window stored squeezed in its zone
// now stays so at load, and its zone comes back when the launcher window in it closes.
import { expect, mock, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

test("FR-SHELL-99 FR-SHELL-102 DM reload keeps the layout and the cell (WF2 notes): Stats + Scenes at 1280×720 / 1440×900, Fit, reload → the same windows and cell; closing Scenes then returns the squeezed zones", () => {
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
  ]) {
    const run = runScript(dmWindows, "dm", vp, "ambush", [
      { open: "stats.board" },
      { open: "map.scenes" },
      "fit",
      "reload",
      { close: "map.scenes" },
    ]);
    expect(run.problems).toEqual([]);
    const at = (name: string) => run.steps.find((s) => s.step === name);
    const fit = at("fit");
    const reload = at("reload");
    expect({ vp, windows: reload?.windows, cell: reload?.cell }).toEqual({
      vp,
      windows: fit?.windows,
      cell: fit?.cell,
    });
    // The cause (Scenes) closes: the Game log and Initiative are back at their full zones.
    const closed = at("close map.scenes")?.windows ?? "";
    const zones = runScript(dmWindows, "dm", vp, "ambush", []).steps[0]?.windows ?? "";
    for (const kind of ["dice.log", "cbt.initiative"]) {
      const of = (list: string) => list.split(" ").find((e) => e.startsWith(`${kind}:`));
      expect(of(closed)).toBe(of(zones));
    }
  }
});
