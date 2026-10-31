// FR-STATS-90: the d20 chart window's view state and its numbers, no React. The ack's rows hold each
// character's face counts (FR-STATS-89); this picks whose, works out the bars and an axis. The view
// lives in page memory like the Stats window's (`view.ts`) and resets when the window closes.
import { D20_FACES } from "@shared/stats/schemas";
import { createStore } from "zustand";
import type { StatsView } from "./view";

export const EVERYONE = "everyone";
export const CHART_MODES = ["count", "percent"] as const;
export type ChartMode = (typeof CHART_MODES)[number];

export interface ChartView {
  scope: StatsView["luckScope"];
  /** A row's key, or `EVERYONE`: every row the viewer's ack holds. */
  who: string;
  mode: ChartMode;
}

export const DEFAULT_CHART_VIEW: ChartView = { scope: null, who: EVERYONE, mode: "percent" };

const views = createStore<{ views: Readonly<Record<string, ChartView>> }>(() => ({
  views: {},
}));
export const diceChartViews = views;
export const chartViewOf = (all: Readonly<Record<string, ChartView>>, key: string | null) =>
  (key ? all[key] : undefined) ?? DEFAULT_CHART_VIEW;
export function setChartView(key: string | null, patch: Partial<ChartView>) {
  if (!key) return;
  const all = views.getState().views;
  views.setState({ views: { ...all, [key]: { ...chartViewOf(all, key), ...patch } } });
}
/** FR-SHELL-200: closing the window forgets what it showed. */
export const resetChartViews = () => views.setState({ views: {} });

/** The face counts of one row, or all rows added up. */
export function facesOf(
  rows: readonly { key: string; faces: readonly number[] }[],
  who: string,
): number[] {
  const out = new Array<number>(D20_FACES).fill(0);
  for (const r of rows) {
    if (who !== EVERYONE && r.key !== who) continue;
    r.faces.forEach((n, i) => {
      out[i] = (out[i] ?? 0) + n;
    });
  }
  return out;
}

const grouped = (n: number) => n.toLocaleString("en-US");

/** One decimal; two from 10,000 dice, where a fair die's bars differ by less than that. */
const percentText = (share: number, total: number) => `${share.toFixed(total >= 10_000 ? 2 : 1)}%`;

/** Clean steps (1, 2, 5 × 10ⁿ), about four of them, whole numbers only. */
function niceStep(max: number): number {
  const rough = max / 4;
  const unit = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * unit).find((s) => s >= rough) ?? 10 * unit;
  return Math.max(1, Math.ceil(step));
}

/** One style per axis: in full under 10,000, then compact. */
function axisCount(value: number, top: number): string {
  if (top >= 1_000_000) return value === 0 ? "0" : `${value / 1_000_000}M`;
  if (top >= 10_000) return value === 0 ? "0" : `${value / 1_000}K`;
  return grouped(value);
}

export interface ChartBar {
  face: number;
  count: number;
  /** What the mode shows, e.g. `5.2%` or `52`. */
  text: string;
  /** "20: 52 rolls · 5.2%": the hover hint and the bar's accessible name. */
  detail: string;
  /** Height as a share of the plot, 0–1. */
  at: number;
  /** The bar's value is written above it (the one highest and the one lowest bar). */
  labelled: boolean;
}

export interface ChartModel {
  total: number;
  avg: number | null;
  bars: ChartBar[];
  ticks: { label: string; at: number }[];
  /** Where a fair die's bars would end, 0–1 of the plot. */
  fairAt: number;
  fairText: string;
}

export function chartModel(faces: readonly number[], mode: ChartMode): ChartModel {
  const total = faces.reduce((a, b) => a + b, 0);
  const share = (n: number) => (total ? (n / total) * 100 : 0);
  const value = (n: number) => (mode === "percent" ? share(n) : n);
  const fair = mode === "percent" ? 100 / D20_FACES : total / D20_FACES;
  const peak = Math.max(fair, ...faces.map(value));
  const step = peak > 0 ? niceStep(peak) : 1;
  const top = Math.max(step, Math.ceil(peak / step) * step);
  const ticks: ChartModel["ticks"] = [];
  for (let i = 0; i * step <= top; i += 1) {
    const v = i * step;
    ticks.push({ label: mode === "percent" ? `${v}%` : axisCount(v, top), at: v / top });
  }
  const textOf = (n: number) => (mode === "percent" ? percentText(share(n), total) : grouped(n));
  const high = Math.max(...faces);
  const low = Math.min(...faces);
  const only = (v: number) => (faces.filter((n) => n === v).length === 1 ? faces.indexOf(v) : -1);
  const highAt = high > low ? only(high) : -1;
  let lowAt = high > low ? only(low) : -1;
  // Two labels side by side at nearly one height would run together: the highest stays.
  if (
    highAt >= 0 &&
    lowAt >= 0 &&
    Math.abs(highAt - lowAt) <= 2 &&
    (value(high) - value(low)) / top < 0.12
  ) {
    lowAt = -1;
  }
  const fairText =
    mode === "percent" ? `${100 / D20_FACES}%` : grouped(Math.round((total / D20_FACES) * 10) / 10);
  return {
    total,
    avg: total
      ? Math.round((faces.reduce((a, n, i) => a + n * (i + 1), 0) / total) * 10) / 10
      : null,
    bars: faces.map((count, i) => ({
      face: i + 1,
      count,
      text: textOf(count),
      detail: `${i + 1}: ${grouped(count)} ${count === 1 ? "roll" : "rolls"} · ${percentText(share(count), total)}`,
      at: value(count) / top,
      labelled: i === highAt || i === lowAt,
    })),
    ticks,
    fairAt: fair / top,
    fairText,
  };
}
