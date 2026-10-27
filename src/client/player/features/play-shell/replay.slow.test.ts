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
// H2 (sprint 10, BL-93): a window back at its pre-cause rect stays as it was (I7), the L1 band
// height (BL-104) and L3s (BL-99) pass P1 fitted @1600×900 / @1280×800 resize again (RS2's and
// SP3's exemptions retired): 37 → 31 failing; H2 FAIL 5 (`grown:` returns, the resize fit check):
// 31 → 30 (P3 fitted @1280×800 resize).
// K5 (the work area to vh − 12, the toast corner 52 px lower): every P1–P3 moved @1280×720 cell
// passes, PM1's P2 moved @1280×720 memory exemption with them; 29 → 12 failing.
const EXEMPTIONS = new Map<string, string>();

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
