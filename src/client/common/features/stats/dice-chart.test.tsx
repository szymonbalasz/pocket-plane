// FR-STATS-90: the d20 chart's numbers and its window body, both modes and every state.
import { describe, expect, test } from "bun:test";
import type { DmLuckResult, SessionsResult } from "@shared/stats/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { DiceChartBody } from "./DiceChart";
import {
  type ChartView,
  chartModel,
  chartViewOf,
  DEFAULT_CHART_VIEW,
  diceChartViews,
  EVERYONE,
  facesOf,
  resetChartViews,
  setChartView,
} from "./dice-chart";

/** `n` of each face. */
const even = (n: number) => new Array<number>(20).fill(n);
/** Zeros but the given `face: count`. */
const with_ = (counts: Record<number, number>) => {
  const f = even(0);
  for (const [face, n] of Object.entries(counts)) f[Number(face) - 1] = n;
  return f;
};

describe("FR-STATS-90 chart numbers", () => {
  test("FR-STATS-90 facesOf adds up every row for Everyone, one row otherwise", () => {
    const rows = [
      { key: "mira", faces: with_({ 1: 2, 20: 1 }) },
      { key: "thorn", faces: with_({ 20: 3 }) },
    ];
    expect(facesOf(rows, EVERYONE)).toEqual(with_({ 1: 2, 20: 4 }));
    expect(facesOf(rows, "thorn")).toEqual(with_({ 20: 3 }));
    expect(facesOf(rows, "gone")).toEqual(even(0));
  });

  test("FR-STATS-90 percent mode: a fair die's bars all reach the 5% line", () => {
    const m = chartModel(even(50_000), "percent");
    expect(m.total).toBe(1_000_000);
    expect(m.avg).toBe(10.5);
    expect(m.fairText).toBe("5%");
    expect(m.bars.every((b) => b.at === m.fairAt)).toBe(true);
    expect(m.bars[0]?.text).toBe("5.00%");
    expect(m.bars[0]?.detail).toBe("1: 50,000 rolls · 5.00%");
  });

  test("FR-STATS-90 count mode: bars and the fair line use the same scale", () => {
    const m = chartModel(with_({ 20: 3, 7: 1 }), "count");
    expect(m.total).toBe(4);
    expect(m.fairText).toBe("0.2");
    expect(m.ticks.map((t) => t.label)).toEqual(["0", "1", "2", "3"]);
    expect(m.bars[19]?.at).toBe(1);
    expect(m.fairAt).toBeCloseTo(0.2 / 3);
    expect(m.bars[6]?.detail).toBe("7: 1 roll · 25.0%");
  });

  test("FR-STATS-90 the axis has clean ticks: whole numbers, compact from 10,000, percent capped at 100", () => {
    const count = (n: number) => chartModel(with_({ 1: n }), "count").ticks.map((t) => t.label);
    expect(count(1)).toEqual(["0", "1"]);
    expect(count(7)).toEqual(["0", "2", "4", "6", "8"]);
    expect(count(2_400)).toEqual(["0", "1,000", "2,000", "3,000"]);
    expect(count(12_000)).toEqual(["0", "5K", "10K", "15K"]);
    expect(count(1_200_000)).toEqual(["0", "0.5M", "1M", "1.5M"]);
    const whole = chartModel(with_({ 20: 3 }), "percent");
    expect(whole.ticks.at(-1)?.label).toBe("100%");
    expect(whole.ticks.every((t) => t.at >= 0 && t.at <= 1)).toBe(true);
    expect(whole.bars[19]?.at).toBe(1);
  });

  test("FR-STATS-90 only the one highest and the one lowest bar carry a number", () => {
    const f = even(10);
    f[19] = 20;
    f[4] = 2;
    const labelled = chartModel(f, "count")
      .bars.filter((b) => b.labelled)
      .map((b) => b.face);
    expect(labelled).toEqual([5, 20]);
    // Ties name nothing: two highest, many lowest, or all equal.
    expect(chartModel(with_({ 1: 2, 2: 2 }), "count").bars.some((b) => b.labelled)).toBe(false);
    expect(chartModel(even(4), "percent").bars.some((b) => b.labelled)).toBe(false);
  });

  test("FR-STATS-90 neighbouring highest and lowest at nearly one height keep only the highest's number", () => {
    const f = even(100);
    f[9] = 101;
    f[10] = 99;
    expect(
      chartModel(f, "percent")
        .bars.filter((b) => b.labelled)
        .map((b) => b.face),
    ).toEqual([10]);
  });

  test("FR-STATS-90 no dice: nothing to scale, no division by zero", () => {
    const m = chartModel(even(0), "percent");
    expect(m.total).toBe(0);
    expect(m.avg).toBeNull();
    expect(m.bars.every((b) => b.at === 0 && Number.isFinite(b.at))).toBe(true);
    expect(Number.isFinite(m.fairAt)).toBe(true);
  });
});

describe("FR-STATS-90 view state", () => {
  test("FR-STATS-90 per viewer in page memory; a close forgets it (FR-SHELL-200)", () => {
    resetChartViews();
    setChartView("c1.dm", { mode: "count", scope: "campaign", who: "mira" });
    setChartView(null, { mode: "count" });
    const { views } = diceChartViews.getState();
    expect(chartViewOf(views, "c1.dm")).toEqual({
      mode: "count",
      scope: "campaign",
      who: "mira",
    });
    expect(chartViewOf(views, "c1.p1")).toEqual(DEFAULT_CHART_VIEW);
    resetChartViews();
    expect(chartViewOf(diceChartViews.getState().views, "c1.dm")).toEqual(DEFAULT_CHART_VIEW);
  });
});

const row = (key: string, name: string, faces: number[]) => ({
  key,
  name,
  playerId: null,
  rolls: 2,
  d20s: faces.reduce((a, b) => a + b, 0),
  avg: 10,
  nat20: 0,
  nat1: 0,
  faces,
});
const LUCK: DmLuckResult = {
  luck: {
    scope: "campaign",
    rows: [row("mira", "Mira", with_({ 20: 3, 1: 1 })), row("dm-dice", "DM dice", with_({ 7: 4 }))],
  },
};
const SESSIONS: SessionsResult = { sessions: [] };
const ok = <R,>(result: R) => ({ status: "ok" as const, result });
const html = (
  luck: { status: "ok" | "loading" | "error"; result: DmLuckResult | null },
  view: Partial<ChartView> = {},
  live = true,
) =>
  renderToStaticMarkup(
    <DiceChartBody
      list={ok(SESSIONS)}
      luck={luck}
      live={live}
      view={{ ...DEFAULT_CHART_VIEW, ...view }}
      onScope={() => {}}
      onWho={() => {}}
      onMode={() => {}}
      retry={() => {}}
    />,
  );
const barCounts = (out: string) =>
  [...out.matchAll(/data-testid="stats-dice-bar" data-record-id="(\d+)" data-value="(\d+)"/g)].map(
    (m) => [Number(m[1]), Number(m[2])],
  );

describe("FR-STATS-90 window body", () => {
  test("FR-STATS-90 20 bars for Everyone, total and average, the fair note, Count and Percent", () => {
    const out = html(ok(LUCK));
    const bars = barCounts(out);
    expect(bars).toHaveLength(20);
    expect(bars[0]).toEqual([1, 1]);
    expect(bars[6]).toEqual([7, 4]);
    expect(bars[19]).toEqual([20, 3]);
    expect(out).toContain('data-testid="stats-dice-chart"');
    expect(out).toContain('data-testid="stats-dice-fair-line"');
    expect(out).toContain("8 d20s · Avg 11.1");
    expect(out).toContain("Fair die: 5% each.");
    for (const m of ["count", "percent"]) {
      expect(out).toContain(`data-testid="stats-dice-mode-item" data-value="${m}"`);
    }
    expect(html(ok(LUCK), { mode: "count" })).toContain("Fair die: 0.4 each.");
  });

  test("FR-STATS-90 one row picked: only its dice", () => {
    const bars = barCounts(html(ok(LUCK), { who: "mira" }));
    expect(bars[6]).toEqual([7, 0]);
    expect(bars[19]).toEqual([20, 3]);
  });

  test("FR-STATS-90 a pick with no row in this scope reads as Everyone", () => {
    expect(barCounts(html(ok(LUCK), { who: "gone" }))[6]).toEqual([7, 4]);
  });

  test("FR-STATS-90 states: skeleton while loading and pending, no dice, error + Retry, offline muted", () => {
    expect(html({ status: "loading", result: null })).toContain('data-testid="stats-loading"');
    expect(
      html(ok<DmLuckResult>({ luck: { scope: "campaign", pending: true, rows: [] } })),
    ).toContain('data-testid="stats-loading"');
    const none = html(ok<DmLuckResult>({ luck: { scope: "session", rows: [] } }));
    expect(none).toContain("No d20 rolls yet");
    expect(none).not.toContain('data-testid="stats-dice-chart"');
    // A physical several-dice total is a roll with no faces.
    expect(
      html(ok<DmLuckResult>({ luck: { scope: "session", rows: [row("mira", "Mira", even(0))] } })),
    ).toContain("No d20 rolls yet");
    expect(html({ status: "error", result: null })).toContain('data-testid="stats-retry"');
    const offline = html(ok(LUCK), {}, false);
    expect(offline).toContain('data-state="offline"');
    expect(offline).toContain("opacity-60");
  });
});
