// FR-SHELL-115, -116 (sprint 8, WF1): the DM's session-replay cells. Every set × camera × size ×
// path runs the shell's placement and the real pure camera on the `session-sim-11` states, with
// I1–I8 after every step. Cells listed in `replay.failing.json` are known failures, run as
// `test.failing` (FR-SHELL-116: recorded against today's placer in WF1's first commit; each
// later slice flips its own and removes them; `UPDATE_FAILING=1` rewrites the list).
import { expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPROS, replayCells, runReplay } from "@ui/features/play-shell/replay";

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

/**
 * Named exemptions (FR-SHELL-160: a new failing cell only with a reason, orchestrator-approved):
 * cell → reason. Each must be in `replay.failing.json`.
 */
// RS2's two approved cells (D3 fitted @1280×800 resize, D3 fitted @1440×900 push) pass with
// `cmp.rules` in D3 too (SP2 merge): 10 → 8 failing. SP3's merge (`recap.session` in D3): 8 → 10.
const SP3_RESIZE =
  "SP3 (approved, BL-93): `recap.session` joins D3 untouched (S4); the resize down and back re-fits the newest no-launcher windows (1280×800: recap.session 440×492 → 412×360; 1600×900: cmp.rules 440×600 → 440×372), the placer's I7 resize class D1 / D2 / D3 already carry (frame, not the window defs)";
const EXEMPTIONS = new Map<string, string>([
  ["FR-SHELL-115 replay D3 fitted @1280×800 resize", SP3_RESIZE],
  ["FR-SHELL-115 replay D3 fitted @1600×900 resize", SP3_RESIZE],
]);

test("FR-SHELL-160 named exemptions are recorded failing cells (DM)", () => {
  for (const name of EXEMPTIONS.keys()) expect(FAILING.has(name)).toBe(true);
});

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

// FR-SHELL-116's named repro cases (the same cells, under their sim / backlog names).
for (const r of REPROS.dm) {
  const c = cells.find((x) => x.name === r.cell);
  if (!c) throw new Error(`no cell ${r.cell}`);
  (FAILING.has(c.name) ? test.failing : test)(
    `FR-SHELL-116 repro ${r.name}`,
    () => {
      expect(runReplay(dmWindows, c.set, c.camera, c.vp, c.path).problems).toEqual([]);
    },
    15_000,
  );
}
