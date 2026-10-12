// Encounter difficulty (FR-CBT-03, #136): derived, never stored. A method registry; MVP ships the
// 2014 DMG XP-threshold method. Numbers only (DMG tables, no text; licence note, ADR-0018).
import { XP_BY_CR } from "@shared/entities/schemas";

export const RATINGS = ["Trivial", "Easy", "Medium", "Hard", "Deadly"] as const;
export type Rating = (typeof RATINGS)[number] | "—";

export interface Thresholds {
  easy: number;
  medium: number;
  hard: number;
  deadly: number;
}

export interface DifficultyResult {
  rating: Rating;
  baseXp: number;
  adjustedXp: number;
  multiplier: number;
  /** Party sums; null without a party. */
  thresholds: Thresholds | null;
}

export interface DifficultyMethod {
  id: string;
  label: string;
  rate(partyLevels: readonly number[], monsterCrs: readonly string[]): DifficultyResult;
}

/** DMG 2014 XP thresholds per character level 1–20: [easy, medium, hard, deadly]. */
const DMG_THRESHOLDS: readonly (readonly [number, number, number, number])[] = [
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
  [300, 600, 900, 1400],
  [350, 750, 1100, 1700],
  [450, 900, 1400, 2100],
  [550, 1100, 1600, 2400],
  [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600],
  [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100],
  [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200],
  [2000, 3900, 5900, 8800],
  [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900],
  [2800, 5700, 8500, 12700],
];

/** Multiplier ladder, ends ×0.5 / ×5 (I27). */
export const DMG_LADDER = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5] as const;

/** Base ladder step by monster count: 1 / 2 / 3–6 / 7–10 / 11–14 / 15+ → ×1 … ×4. */
function baseStep(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count <= 6) return 3;
  if (count <= 10) return 4;
  if (count <= 14) return 5;
  return 6;
}

export function xpOf(cr: string): number {
  return XP_BY_CR[cr] ?? 0;
}

export function crValue(cr: string): number {
  const [n, d] = cr.split("/");
  const v = d ? Number(n) / Number(d) : Number(n);
  return Number.isFinite(v) ? v : 0;
}

export const dmg2014: DifficultyMethod = {
  id: "dmg-2014",
  label: "DMG 2014",
  rate(partyLevels, monsterCrs) {
    const baseXp = monsterCrs.reduce((s, cr) => s + xpOf(cr), 0);
    let step = baseStep(monsterCrs.length);
    if (partyLevels.length > 0 && partyLevels.length < 3) step += 1;
    if (partyLevels.length >= 6) step -= 1;
    step = Math.max(0, Math.min(DMG_LADDER.length - 1, step));
    const multiplier = monsterCrs.length === 0 ? 1 : (DMG_LADDER[step] ?? 1);
    const adjustedXp = Math.floor(baseXp * multiplier);
    if (partyLevels.length === 0) {
      return { rating: "—", baseXp, adjustedXp, multiplier, thresholds: null };
    }
    const t: Thresholds = { easy: 0, medium: 0, hard: 0, deadly: 0 };
    for (const lvl of partyLevels) {
      const row = DMG_THRESHOLDS[Math.max(1, Math.min(20, lvl)) - 1] ?? [0, 0, 0, 0];
      t.easy += row[0];
      t.medium += row[1];
      t.hard += row[2];
      t.deadly += row[3];
    }
    let rating: Rating = "Trivial";
    if (adjustedXp >= t.easy) rating = "Easy";
    if (adjustedXp >= t.medium) rating = "Medium";
    if (adjustedXp >= t.hard) rating = "Hard";
    if (adjustedXp >= t.deadly) rating = "Deadly";
    return { rating, baseXp, adjustedXp, multiplier, thresholds: t };
  },
};

/** The registry (FR-CBT-03). MVP: one method. */
export const difficultyMethods: readonly DifficultyMethod[] = [dmg2014];

/** Total CR, the secondary figure on the card (#136). */
export function totalCr(monsterCrs: readonly string[]): number {
  return monsterCrs.reduce((s, cr) => s + crValue(cr), 0);
}

/** "1.25", "0.5", "3". */
export function formatCr(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
