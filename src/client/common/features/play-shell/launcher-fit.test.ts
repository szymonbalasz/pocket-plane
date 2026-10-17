import { describe, expect, test } from "bun:test";
import {
  fitLauncher,
  fittedBarWidth,
  LAUNCHER_GUTTER,
  type LauncherItem,
  type LauncherMetrics,
} from "./launcher-fit";

const m: LauncherMetrics = { full: () => 100, compact: 40, menu: 40, gap: 4, pad: 10 };
const items = (n: number, open: number[] = [], minimised: number[] = []): LauncherItem[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: `k.n${i}`,
    order: i * 10,
    state: open.includes(i) ? "open" : minimised.includes(i) ? "minimised" : "closed",
  }));
const inside = (w: number, vpW: number) => (vpW - w) / 2 >= LAUNCHER_GUTTER;

describe("launcher fit (FR-SHELL-43)", () => {
  test("FR-SHELL-43 labels while they fit; then icon only; then the overflow menu", () => {
    // 10 buttons: full = 10 + 1000 + 40 + 40 = 1090; compact = 10 + 400 + 40 + 40 = 490.
    const ten = items(10);
    expect(fitLauncher(ten, 1106, m)).toEqual({
      compact: false,
      bar: ten.map((i) => i.kind),
      overflow: [],
    });
    const icons = fitLauncher(ten, 1105, m);
    expect(icons).toEqual({ compact: true, bar: ten.map((i) => i.kind), overflow: [] });
    expect(fitLauncher(ten, 506, m).overflow).toEqual([]);
    const tight = fitLauncher(ten, 505, m);
    expect(tight.compact).toBe(true);
    expect(tight.overflow).toEqual(["k.n9"]); // highest order first
    for (const vpW of [1600, 1106, 1105, 700, 505, 300, 120]) {
      const fit = fitLauncher(ten, vpW, m);
      expect(inside(fittedBarWidth(fit, m), vpW) || fit.bar.length === 0).toBe(true);
      expect([...fit.bar, ...fit.overflow].sort()).toEqual(ten.map((i) => i.kind).sort());
    }
  });

  test("FR-SHELL-43 closed windows leave the bar before open or minimised ones, highest order first", () => {
    const list = items(10, [9, 7], [8]);
    // Room for 5 buttons: 10 + 5 × 44 + 40 = 270 → 286 wide.
    const fit = fitLauncher(list, 286, m);
    expect(fit.bar).toEqual(["k.n0", "k.n1", "k.n7", "k.n8", "k.n9"]);
    expect(fit.overflow).toEqual(["k.n2", "k.n3", "k.n4", "k.n5", "k.n6"]);
    // Narrower still: the open / minimised ones go last, highest order first.
    expect(fitLauncher(list, 198, m).bar).toEqual(["k.n7", "k.n8", "k.n9"]);
    expect(fitLauncher(list, 154, m).bar).toEqual(["k.n7", "k.n8"]);
  });

  test("FR-SHELL-43 recomputed per width: wider again → labels back, menu empty", () => {
    const list = items(12);
    expect(fitLauncher(list, 400, m).overflow.length).toBeGreaterThan(0);
    const wide = fitLauncher(list, 1600, m);
    expect(wide).toEqual({ compact: false, bar: list.map((i) => i.kind), overflow: [] });
  });
});
