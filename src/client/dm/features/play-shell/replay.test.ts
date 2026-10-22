// FR-SHELL-115, -116 (sprint 8, WF1): the DM's session-replay cells. Every set × camera × size ×
// path runs the shell's placement and the real pure camera on the `session-sim-11` states, with
// I1–I8 after every step. Cells listed in `replay.failing.json` are known failures, run as
// `test.failing` (FR-SHELL-116: recorded against today's placer in WF1's first commit; each
// later slice flips its own and removes them; `UPDATE_FAILING=1` rewrites the list).
import { expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replayCells, runReplay } from "@ui/features/play-shell/replay";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const FILE = fileURLToPath(new URL("./replay.failing.json", import.meta.url));
const FAILING = new Set<string>(JSON.parse(readFileSync(FILE, "utf8")) as string[]);

const cells = replayCells(dmWindows);
if (process.env.UPDATE_FAILING === "1") {
  const failing = cells
    .filter((c) => runReplay(dmWindows, c.set, c.camera, c.vp, c.path).problems.length > 0)
    .map((c) => c.name);
  writeFileSync(FILE, `${JSON.stringify(failing, null, 2)}\n`);
  FAILING.clear();
  for (const n of failing) FAILING.add(n);
}

for (const c of cells) {
  (FAILING.has(c.name) ? test.failing : test)(
    c.name,
    () => {
      const run = runReplay(dmWindows, c.set, c.camera, c.vp, c.path);
      expect(run.problems).toEqual([]);
      // I8: the same inputs give the same steps.
      expect(runReplay(dmWindows, c.set, c.camera, c.vp, c.path).steps).toEqual(run.steps);
    },
    15_000,
  );
}
