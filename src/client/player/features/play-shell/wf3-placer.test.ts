// Sprint 8 WF3 walkthrough repros (play-shell FR-SHELL-97, -108; walkthrough F9 and the WF2
// walkthrough's notes): the ladder puts away the least recently used launcher window at L3 when
// that makes room (or lets the map yield) before going below useful, and the map yields to a
// window opened over the PCs before it lands below useful over them.
import { expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, type ManagerContext, plan, useful } from "@ui/features/play-shell/manager";
import type { PlacementToken } from "@ui/features/play-shell/placement";
import { runScript } from "@ui/features/play-shell/replay";
import { TEST_KINDS } from "@ui/features/play-shell/size-table";

const { playerWindows } = await import("../../windows");

const VP = { w: 1280, h: 800 };
const available = new Set(playerWindows.defs.map((d) => d.kind).filter((k) => !TEST_KINDS.has(k)));
const sizeOf = (kind: string) => {
  const def = playerWindows.get(kind);
  if (!def) throw new Error(`no ${kind}`);
  return useful(def, VP, playerWindows);
};

test("FR-SHELL-97 FR-SHELL-108 walkthrough F9: Stats displaced at L4 (584,380 320×344), the Owlbear card opens → Stats is put away (L3), then the card at ≥ useful or the map yields; never both below useful", () => {
  // B @1280×800 after Start Escort: Initiative, sheet, Game log in their zones; Stats displaced
  // below useful; the camera at 46 px (Mira 580,330, Thorn 534,514, Brakka 488,422).
  const base = defaultLayout(playerWindows, VP, [], keepOuts("player", VP, new Map())).filter(
    (w) => w.state === "open",
  );
  const z = Math.max(...base.map((w) => w.z)) + 1;
  const stats: WindowState = {
    kind: "stats.board",
    instance: "main",
    state: "open",
    x: 584,
    y: 380,
    w: 320,
    h: 344,
    z,
  };
  const pcs: PlacementToken[] = [
    { x: 580, y: 330, w: 46, h: 46, pc: true },
    { x: 534, y: 514, w: 46, h: 46, pc: true },
    { x: 488, y: 422, w: 46, h: 46, pc: true },
  ];
  const ctx: ManagerContext = {
    registry: playerWindows,
    viewport: VP,
    available,
    keepOuts: () => keepOuts("player", VP, new Map()),
    avoid: () => pcs,
    camera: () => "fitted",
    lastFullCell: () => 46,
    // The canvas's dry fit: the map can make room at 40 px with every PC clear.
    dryFit: () => ({ cellPx: 40, clear: true }),
  };
  const p = plan([...base, stats], { type: "open", kind: "charx.companion" }, ctx);
  const card = p.windows.find((w) => w.kind === "charx.companion") as WindowState;
  const after = p.windows.find((w) => w.kind === "stats.board") as WindowState;
  const u = sizeOf("charx.companion");
  expect(card.state).toBe("open");
  expect(card.w >= u.w && card.h >= u.h).toBe(true);
  // Stats (the least recently used launcher window) went at L3 instead of both going below useful.
  expect(after.state).toBe("minimised");
  expect(p.log.some((l) => l.startsWith("open:charx.companion>L4"))).toBe(false);
  expect(p.log.some((l) => /open:charx\.companion>L(1|2|2b)$/.test(l))).toBe(true);
});

test("FR-SHELL-97 FR-SHELL-108 WF2 notes: B @1280×800 opens Party alone (no window to put away) → the map yields; Party at ≥ its useful size, PC-clear (was 340×400 at L5 over Mira 63 %)", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [{ open: "party.board" }]);
  expect(run.problems).toEqual([]);
  const step = run.steps.at(-1);
  expect(step?.log).toBe("open:party.board>L2b");
  const party = step?.windows.split(" ").find((w) => w.startsWith("party.board:open:"));
  const [, , , , size] = (party ?? "").split(/[:,]/);
  const [w, h] = (size ?? "").split("×").map(Number);
  const u = sizeOf("party.board");
  expect((w ?? 0) >= u.w && (h ?? 0) >= u.h).toBe(true);
  // The yield keeps ≥ 75 % of the last full fit's cell.
  expect(step?.cell ?? 0).toBeGreaterThanOrEqual(0.75 * (run.steps[0]?.cell ?? 0));
});

test("FR-SHELL-97 walkthrough F9 order: Stats, then the card, then Party → each at ≥ its useful size; earlier ones put away or the map yields (I1–I5 hold)", () => {
  for (const script of [
    ["end", { open: "stats.board" }, "start", { open: "charx.companion" }],
    [{ open: "stats.board" }, { open: "charx.companion" }, { open: "party.board" }],
    [{ open: "charx.companion" }, { open: "stats.board" }, { open: "party.board" }],
  ] as const) {
    const run = runScript(playerWindows, "player-1", VP, "ambush", script);
    expect(run.problems).toEqual([]);
    for (const step of run.steps) {
      for (const entry of step.windows.split(" ").filter((e) => e.includes(":open:"))) {
        const [kind, , , , size] = entry.split(/[:,]/);
        const def = playerWindows.get(kind ?? "");
        if (!def || def.defaultOpen) continue;
        const [w, h] = (size ?? "").split("×").map(Number);
        const u = sizeOf(kind ?? "");
        expect(`${step.step}: ${kind} ${w}×${h}`).toBe(
          (w ?? 0) >= u.w && (h ?? 0) >= u.h ? `${step.step}: ${kind} ${w}×${h}` : "below useful",
        );
      }
    }
  }
});
