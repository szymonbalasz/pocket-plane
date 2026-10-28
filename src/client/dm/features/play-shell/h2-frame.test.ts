// Sprint 10 H2 repros (session-sim-13, `.verify/20261023-193558-session-sim-13/`), DM: the Party
// Manager's width at 1440×900 (BL-104), Party Manager + Stronghold putting each other away
// (BL-99) and the Fit with a remembered window over the map centre (BL-100). The harness world
// (`runScript`): the shell controller, the real pure camera, `session-sim-11` states.
import { expect, mock, test } from "bun:test";
import { runScript } from "@ui/features/play-shell/replay";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const VP = { w: 1440, h: 900 };
/** `kind:state:x,y,w×h` of a step's windows. */
const entry = (windows: string | undefined, kind: string) =>
  (windows ?? "").split(" ").find((e) => e.startsWith(`${kind}:`)) ?? "";
const size = (windows: string | undefined, kind: string) => {
  const m = /,(\d+)×(\d+)/.exec(entry(windows, kind));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

test("FR-SHELL-156 BL-104 the DM's Party Manager opens at its size row's width where the map keeps an all-tokens fit (sim-13: 456 / 340 px)", () => {
  // Escort, fitted: PCs left of the free area, monsters across it (sim-13 a02). At 1600×900 the
  // default width, at the band's height (536): L1, not a token-avoiding L2 cut.
  const run = runScript(dmWindows, "dm", { w: 1600, h: 900 }, "escort", [
    { open: "party.board" },
    "fit",
  ]);
  expect(run.problems).toEqual([]);
  expect(size(run.steps.at(-1)?.windows, "party.board")).toEqual({ w: 600, h: 536 });
  expect(run.steps.at(-1)?.fit).toBe("all");
});

// K5 (kit-parity K5 report): with the work area to vh − 12 the ladder's useful-size spot at
// 1440×900 (442,196) left Fit only the 48-px PCs-only view, so BL-107's rule kept the target size
// (600 × 536) and Fit gave `pcs`. BL-134 (sprint 14 F1): the useful-size search takes only spots
// where Fit keeps every token (576,196: `all` at 25 px).
test("FR-SHELL-156 BL-107 BL-134 escort at 1440×900: the Party Manager at its useful size, Fit `all`", () => {
  const run = runScript(dmWindows, "dm", VP, "escort", [{ open: "party.board" }, "fit"]);
  expect(run.problems).toEqual([]);
  expect(size(run.steps.at(-1)?.windows, "party.board")).toEqual({ w: 440, h: 400 });
  expect(run.steps.at(-1)?.fit).toBe("all");
});

test("FR-SHELL-97 FR-SHELL-102 BL-99 Party Manager and the Stronghold window stay open together at 1440×900 where they fit at their useful sizes; the Party Manager grows back when the Stronghold closes", () => {
  // The PCs panned clear of the free area (right of the Game log, under Initiative): 948 px left
  // of Initiative hold 440 + 480, not 600 + 480 (sim-13 glitch 3: one put the other away).
  const run = runScript(dmWindows, "dm", VP, "escort", [
    { pan: { x: 1325, y: 700 } },
    { open: "party.board" },
    { open: "hold.stronghold" },
    { close: "hold.stronghold" },
  ]);
  expect(run.problems).toEqual([]);
  const both = run.steps.find((s) => s.step === "open hold.stronghold")?.windows;
  expect(entry(both, "party.board")).toContain(":open:");
  expect(entry(both, "hold.stronghold")).toContain(":open:");
  expect(size(both, "party.board")?.w).toBeGreaterThanOrEqual(440);
  expect(size(both, "hold.stronghold")?.w).toBeGreaterThanOrEqual(400);
  // The squeeze ends with its cause (FR-SHELL-102): 600 wide again.
  const after = run.steps.at(-1)?.windows;
  expect(entry(after, "party.board")).toBe("party.board:open:68,60,600×536");
});

test("FR-MAP-115 BL-100 a remembered window over the map centre: reload and Fit frame the map around the other windows (`all`), never the 48-px PCs-only view", () => {
  // sim-13 b02 / b04: Compendium dragged onto the party and resized 480×440, then a reload.
  const run = runScript(dmWindows, "dm", VP, "escort", [
    { open: "cmp.compendium" },
    { drag: "cmp.compendium", rect: { x: 400, y: 250, w: 480, h: 440 }, resized: true },
    "reload",
    "fit",
  ]);
  expect(run.problems).toEqual([]);
  const first = run.steps[0];
  for (const name of ["reload", "fit"]) {
    const s = run.steps.find((x) => x.step === name);
    // The map as framed around Initiative + the Game log (the load fit before the Compendium).
    expect({ name, fit: s?.fit, cell: s?.cell }).toEqual({ name, fit: "all", cell: first?.cell });
  }
});

test("FR-MAP-115 BL-100 a remembered window at the edge stays an obstacle: reload and Fit frame the map around it like any window", () => {
  const run = runScript(dmWindows, "dm", VP, "escort", [
    { open: "cmp.compendium" },
    { drag: "cmp.compendium", rect: { x: 68, y: 60, w: 360, h: 400 }, resized: true },
    "reload",
    "fit",
  ]);
  expect(run.problems).toEqual([]);
  // 45 px framed around Initiative + the Game log (K5); 31 px with the Compendium left as well.
  expect(run.steps.map((s) => [s.step, s.fit, s.cell])).toEqual([
    ["load", "all", 45],
    ["open cmp.compendium", "all", 45],
    ["drag cmp.compendium", "all", 45],
    ["reload", "all", 31],
    ["fit", "all", 31],
  ]);
});

test("FR-SHELL-102 FR-MAP-113 H2 FAIL 5 resize round trip: DM 1280×720 Ambush, no fight, Initiative open, Party Manager placed 346 wide → 1440×900 → 1280×720: at 1440 the map keeps an all-tokens fit (Party Manager at a size that leaves it room, not 600 × 512 and the 48-px PCs-only floor); back at 1280 the layout and the camera as before the trip", () => {
  // Walkthrough H2 step 5 (`.verify/20261024-h2/`): before the fix 1440 drew Party Manager
  // 600 × 512 at 68,60 with the map `pcs` at 48 px, and 1280 kept 600 × 412 and the floor.
  const run = runScript(dmWindows, "dm", { w: 1280, h: 720 }, "ambush", [
    "end",
    { open: "party.board" },
    { viewport: VP },
    { viewport: { w: 1280, h: 720 } },
    { viewport: VP },
    { viewport: { w: 1280, h: 720 } },
  ]);
  expect(run.problems).toEqual([]);
  const at = (i: number) => run.steps[i];
  const opened = at(2);
  expect(entry(opened?.windows, "party.board")).toBe("party.board:open:442,60,346×400");
  expect([opened?.fit, opened?.cell]).toEqual(["all", 34]);
  for (const i of [3, 5]) {
    const wide = at(i);
    expect(wide?.fit).toBe("all");
    expect(size(wide?.windows, "party.board")).toEqual({ w: 440, h: 400 });
  }
  for (const i of [4, 6]) {
    // I7: the layout and the camera as before the trip.
    expect({ windows: at(i)?.windows, fit: at(i)?.fit, cell: at(i)?.cell }).toEqual({
      windows: opened?.windows,
      fit: "all",
      cell: 34,
    });
  }
});

test("FR-SHELL-45 FR-SHELL-78 BL-38 H3 re-test step 5: DM 1280×720 crowded (Encounters, Scenes, Rules, Stats over Initiative + the Game log) → open windows never overlap; the others are put away (minimised, LRU), keeping their last rect", () => {
  // H3 re-tests (`fix-h3-toasts` `.verify/20261024-h3r*/`, step 5) read Encounters, Rules and
  // Stats "stacked at 480,60": a put-away window stays mounted, invisible, at its last rect
  // (FR-SHELL-36); only `data-state="open"` windows are on screen.
  const kinds = ["cbt.encounters", "map.scenes", "cmp.rules", "stats.board"];
  for (const state of ["ambush", "escort"] as const) {
    const run = runScript(
      dmWindows,
      "dm",
      { w: 1280, h: 720 },
      state,
      kinds.map((open) => ({ open })),
    );
    // I2 (no overlap between untouched windows) and I4 (put-aways LRU, only when needed).
    expect(run.problems).toEqual([]);
    for (const [i, kind] of kinds.entries()) {
      const windows = run.steps.find((s) => s.step === `open ${kind}`)?.windows ?? "";
      const open = windows
        .split(" ")
        .filter((e) => e.includes(":open:"))
        .map((e) => {
          const [, , rect] = e.split(":");
          const [x, y, wh] = (rect ?? "").split(",");
          const [w, h] = (wh ?? "").split("×");
          return { e, x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
        });
      for (const a of open) {
        for (const b of open) {
          if (a === b) continue;
          const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect({ state, kind, pair: [a.e, b.e], hit }).toEqual({
            state,
            kind,
            pair: [a.e, b.e],
            hit: false,
          });
        }
      }
      // The window just opened is on screen; every earlier one of the set is put away.
      expect(entry(windows, kind)).toContain(":open:");
      for (const earlier of kinds.slice(0, i)) {
        expect({ state, earlier, entry: entry(windows, earlier) }).toMatchObject({
          entry: expect.stringContaining(":minimised:"),
        });
      }
    }
  }
});
