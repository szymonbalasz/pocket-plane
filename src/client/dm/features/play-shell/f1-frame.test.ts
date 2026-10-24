// Sprint 11 F1 repros (session-sim-14, `.verify/20261024-061849-session-sim-14/`), DM: Fit with the
// untouched Party Manager open mid-map (BL-107, d04) and the Party Manager over the enemy line
// (BL-113). The harness world (`runScript`): the shell controller, the real pure camera,
// `session-sim-11` states.
import { expect, mock, test } from "bun:test";
import {
  fitLauncher,
  fittedBarWidth,
  LAUNCHER_GUTTER,
  launcherMetrics,
} from "@ui/features/play-shell/launcher-fit";
import { runScript } from "@ui/features/play-shell/replay";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const VP = { w: 1440, h: 900 };
/** `kind:state:x,y,w×h` of a step's windows. */
const entry = (windows: string | undefined, kind: string) =>
  (windows ?? "").split(" ").find((e) => e.startsWith(`${kind}:`)) ?? "";

test("FR-MAP-115 FR-SHELL-97 BL-107 DM 1440×900 Goblin Ambush, Initiative + Game log in their zones: the untouched Party Manager opened, then Fit, a reload and Fit again keep an all-tokens view (sim-14 d04: 600 × 512 at 424,60 → the 48-px PCs-only view)", () => {
  for (const state of ["ambush", "escort"] as const) {
    const run = runScript(dmWindows, "dm", VP, state, [
      { open: "party.board" },
      "fit",
      "reload",
      "fit",
    ]);
    // I1–I6 after every step: the Party Manager PC-clear, ≥ useful, over no other window.
    expect(run.problems).toEqual([]);
    // Before the fix: `party.board:open:424,60,600×512`, then `pcs` at 48 px.
    const opened = run.steps.find((s) => s.step === "open party.board");
    expect(entry(opened?.windows, "party.board")).toBe("party.board:open:576,172,440×400");
    for (const name of ["fit", "reload"]) {
      for (const s of run.steps.filter((x) => x.step === name)) {
        expect({ state, name, fit: s.fit }).toEqual({ state, name, fit: "all" });
        expect(s.cell).toBeGreaterThanOrEqual(24);
        // The layout as opened: a Fit or a reload moves no window.
        expect(s.windows).toBe(opened?.windows ?? "");
      }
    }
  }
});

test("FR-SHELL-97 FR-SHELL-103 BL-107 the cap holds: an untouched launcher window placed at its useful size for the map's fit doesn't grow back on a later return (I7: a tool-bar push and return change nothing) or a resize back to the size it was placed at", () => {
  const run = runScript(dmWindows, "dm", VP, "ambush", [
    { open: "party.board" },
    { viewport: { w: 1280, h: 800 } },
    { viewport: VP },
    "end",
  ]);
  expect(run.problems).toEqual([]);
  const opened = entry(
    run.steps.find((s) => s.step === "open party.board")?.windows,
    "party.board",
  );
  expect(entry(run.steps.at(-2)?.windows, "party.board")).toBe(opened);
  expect(entry(run.steps.at(-1)?.windows, "party.board")).toBe(opened);
});

test("FR-SHELL-43 BL-113 the DM launcher at 1440×900 in test mode (every entry, Probes + Test included): the labels that fit stay, the lowest orders first, never icon-only throughout; the bar inside the gutters, nothing in the menu", () => {
  const entries = dmWindows.defs
    .filter((d) => d.launcher)
    .sort((a, b) => (a.launcher?.order ?? 0) - (b.launcher?.order ?? 0));
  const labels = new Map(entries.map((d) => [d.kind, d.launcher?.label ?? ""]));
  const items = entries.map((d) => ({
    kind: d.kind,
    order: d.launcher?.order ?? 0,
    state: "closed" as const,
  }));
  // `Launcher.tsx`'s measure without a canvas: 7 px a character (+ 1).
  const m = launcherMetrics(labels, (l) => l.length * 7 + 1);
  for (const w of [1440, 1600]) {
    const fit = fitLauncher(items, w, m);
    expect(fit.overflow).toEqual([]);
    expect((w - fittedBarWidth(fit, m)) / 2).toBeGreaterThanOrEqual(LAUNCHER_GUTTER);
    // Labels from the left: a prefix of the bar.
    expect(fit.labelled).toEqual(fit.bar.slice(0, fit.labelled.length));
  }
  // sim-14: 17 buttons, every one icon-only before the fix; now 10 keep their labels.
  const at1440 = fitLauncher(items, 1440, m);
  expect(entries.length).toBeGreaterThanOrEqual(17);
  expect(at1440.labelled.length).toBeGreaterThanOrEqual(8);
});

test("FR-SHELL-103 FR-MAP-115 BL-107 walkthrough F1 1c: DM 1280×720 Ambush, Initiative open, the untouched Party Manager placed wider than useful (367,72 489 × 400, Fit `pcs`, the accepted 1280 class) → 1440×900: it takes its fit-keeping size, so the resize refit, Fit and a reload frame every token; back at 1280×720 it returns", () => {
  const W = { w: 1280, h: 720 };
  const run = runScript(dmWindows, "dm", W, "ambush", [
    // The PCs where the walkthrough's camera had them: the Party Manager placed 489 wide.
    { pan: { x: 300, y: 200 } },
    { open: "party.board" },
    "fit",
    { viewport: VP },
    "fit",
    { viewport: W },
    { viewport: VP },
    "reload",
    "fit",
  ]);
  expect(run.problems).toEqual([]);
  const opened = entry(
    run.steps.find((s) => s.step === "open party.board")?.windows,
    "party.board",
  );
  expect(opened).toBe("party.board:open:367,72,489×400");
  expect(run.steps.find((s) => s.step === "fit")?.fit).toBe("pcs");
  // Before the fix: 367,72 489 × 400 kept at 1440×900, `pcs` at 48 px on every step.
  for (const [i, s] of run.steps.entries()) {
    if (s.vp.w !== VP.w) continue;
    expect({ i, step: s.step, fit: s.fit }).toEqual({ i, step: s.step, fit: "all" });
    expect(entry(s.windows, "party.board")).toBe("party.board:open:68,60,440×400");
  }
  // I7: back at 1280×720 the Party Manager as placed there.
  const back = run.steps.find((s, i) => i > 4 && s.vp.w === W.w);
  expect(entry(back?.windows, "party.board")).toBe(opened);
});
