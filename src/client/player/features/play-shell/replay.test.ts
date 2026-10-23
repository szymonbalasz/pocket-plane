// FR-SHELL-115, -116 (sprint 8, WF1): the players' session-replay cells. Every set × camera × size ×
// path runs the shell's placement and the real pure camera on the `session-sim-11` states, with
// I1–I8 after every step. Cells listed in `replay.failing.json` are known failures, run as
// `test.failing` (FR-SHELL-116: recorded against today's placer in WF1's first commit; each
// later slice flips its own and removes them; `UPDATE_FAILING=1` rewrites the list).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPROS, replayCells, runReplay } from "@ui/features/play-shell/replay";

const { playerWindows } = await import("../../windows");

const FILE = fileURLToPath(new URL("./replay.failing.json", import.meta.url));
const FAILING = new Set<string>(JSON.parse(readFileSync(FILE, "utf8")) as string[]);

const cells = replayCells(playerWindows);
if (process.env.UPDATE_FAILING === "1") {
  const failing = cells
    .filter((c) => runReplay(playerWindows, c.set, c.camera, c.vp, c.path).problems.length > 0)
    .map((c) => c.name);
  writeFileSync(FILE, `${JSON.stringify(failing, null, 2)}\n`);
  FAILING.clear();
  for (const n of failing) FAILING.add(n);
}

/**
 * Named exemptions (FR-SHELL-160: a new failing cell only with a reason, orchestrator-approved):
 * cell → reason. Each must be in `replay.failing.json`.
 */
const EXEMPTIONS = new Map([
  [
    "FR-SHELL-115 replay P2 moved @1280×720 memory",
    "PM1 (approved): inherits the shared open phase's I2 (Compendium / Party Manager on the toast keep-out), as every other P2 moved @1280×720 cell; its memory steps (I9–I13) pass",
  ],
  [
    "FR-SHELL-115 replay P1 fitted @1600×900 resize",
    "RS2 (approved, BL-93): `hold.stronghold` joins P1 untouched (S4); the resize back leaves it at its band height 400×472 → 400×400 (the placer's I7 resize class, 10 player cells; frame). The same change flips P1 fitted @1280×720 push, @1280×800 resize and @1440×900 resize to passing. SP2 (approved, BL-93): with `cmp.rules` in P1 too the same cell still fails the same way (cmp.rules 440×472 → 440×360); P1 failing cells unchanged by SP2's merge",
  ],
  [
    "FR-SHELL-115 replay P1 fitted @1280×800 resize",
    "SP3 (pending approval): `recap.session` joins P1 untouched (S4) beside `hold.stronghold` and `cmp.rules`; the resize back leaves it at 440×492 → 440×360 (the placer's I7 resize class, as P1 fitted @1600×900 and P2 / P3's resize cells; frame). It re-fails the cell RS2's merge had flipped to passing",
  ],
]);

test("FR-SHELL-160 named exemptions are recorded failing cells", () => {
  for (const name of EXEMPTIONS.keys()) expect(FAILING.has(name)).toBe(true);
});

for (const c of cells) {
  (FAILING.has(c.name) ? test.failing : test)(
    c.name,
    () => {
      const run = runReplay(playerWindows, c.set, c.camera, c.vp, c.path);
      expect(run.problems).toEqual([]);
      // I8: the same inputs give the same steps.
      expect(runReplay(playerWindows, c.set, c.camera, c.vp, c.path).steps).toEqual(run.steps);
    },
    15_000,
  );
}

// FR-SHELL-116's named repro cases (the same cells, under their sim / backlog names).
for (const r of REPROS.player) {
  const c = cells.find((x) => x.name === r.cell);
  if (!c) throw new Error(`no cell ${r.cell}`);
  (FAILING.has(c.name) ? test.failing : test)(
    `FR-SHELL-116 repro ${r.name}`,
    () => {
      expect(runReplay(playerWindows, c.set, c.camera, c.vp, c.path).problems).toEqual([]);
    },
    15_000,
  );
}
