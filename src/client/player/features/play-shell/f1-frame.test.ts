// Sprint 11 F1 repro (session-sim-14 glitch 4, d10 / d11, `.verify/20261024-061849-session-sim-14/`),
// player: out of a fight at 1280×720 with Recap + Stats open, opening Rules put both away though
// Rules + Stats fit (BL-109). The harness world (`runScript`): the shell controller, the real pure
// camera, `session-sim-11` states.
import { expect, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

const { playerWindows } = await import("../../windows");

const VP = { w: 1280, h: 720 };
/** `kind:state:x,y,w×h` of a step's windows. */
const entry = (windows: string | undefined, kind: string) =>
  (windows ?? "").split(" ").find((e) => e.startsWith(`${kind}:`)) ?? "";
const at = (run: ReturnType<typeof runScript>, step: string) =>
  run.steps.find((s) => s.step === step)?.windows;

test("FR-SHELL-97 FR-SHELL-102 BL-109 player 1280×720 out of a fight, PCs panned right (d10), Recap + Stats open: opening Rules puts away one window (Recap, least recently used) and moves Stats aside at its size (L3r), Rules at its useful width; closing Rules brings Stats back; reopening Rules puts nothing away", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    "end",
    { pan: { x: 790, y: 560 } },
    { open: "recap.session" },
    { open: "stats.board" },
    { open: "cmp.rules" },
    { close: "cmp.rules" },
    { open: "cmp.rules" },
    "reload",
  ]);
  // I1–I6 (I4: put away only when needed, LRU first; I5: Stats moved by L3r only, at its size).
  expect(run.problems).toEqual([]);
  // d10: Recap 400 wide (L3s), Stats beside it.
  const both = at(run, "open stats.board");
  expect(entry(both, "recap.session")).toBe("recap.session:open:68,60,400×412");
  expect(entry(both, "stats.board")).toBe("stats.board:open:480,60,400×360");
  // Before the fix: Recap and Stats both `minimised`, Rules 440 × 412 alone (d11's first step).
  const rules = at(run, "open cmp.rules");
  expect(entry(rules, "recap.session")).toBe("recap.session:minimised:68,60,400×412");
  expect(entry(rules, "cmp.rules")).toBe("cmp.rules:open:68,60,420×412");
  expect(entry(rules, "stats.board")).toBe("stats.board:open:492,60,400×360");
  expect(run.steps.find((s) => s.step === "open cmp.rules")?.log).toContain("open:stats.board>L3r");
  // Rules closed: Stats back at its rect (FR-SHELL-102); Recap stays put away (FR-SHELL-152).
  expect(entry(at(run, "close cmp.rules"), "stats.board")).toBe("stats.board:open:480,60,400×360");
  // Reopened: the same pair, nothing put away.
  const again = run.steps.filter((s) => s.step === "open cmp.rules").at(-1)?.windows;
  expect(entry(again, "stats.board")).toBe("stats.board:open:492,60,400×360");
  expect(entry(again, "cmp.rules")).toBe("cmp.rules:open:68,60,420×412");
  // Stored as shown (like an L3s shrink): the reload keeps the pair.
  const reload = at(run, "reload");
  expect(entry(reload, "stats.board")).toBe("stats.board:open:492,60,400×360");
  expect(entry(reload, "cmp.rules")).toBe("cmp.rules:open:68,60,420×412");
});

test("FR-SHELL-97 BL-109 the same with a fitted camera: Rules + Stats stay open together, one window put away", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    "end",
    { open: "recap.session" },
    { open: "stats.board" },
    { open: "cmp.rules" },
  ]);
  expect(run.problems).toEqual([]);
  const rules = at(run, "open cmp.rules") ?? "";
  expect(entry(rules, "cmp.rules")).toContain(":open:");
  expect(entry(rules, "stats.board")).toContain(":open:");
  expect(rules.split(" ").filter((e) => e.includes(":minimised:"))).toEqual([
    entry(rules, "recap.session"),
  ]);
});
