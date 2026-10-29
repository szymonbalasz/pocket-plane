// Rests (FR-CHARX-121–123): what a short or a long rest resets on one character. Pure; the server
// writes the result (`char.rest`), the confirm UIs read the summary lines. Conditions and effects
// are never touched; hit dice spending stays manual (FR-CHARX-17 counters).
import { type ClassRow, HIT_DICE, type HitDie, type Spellcasting } from "@shared/entities/schemas";
import type { RestKind } from "@shared/events/character-sheet";
import { clampCounters } from "./counters";
import type { FeatureRow, HitDiceUsed, SheetData, SlotsUsed } from "./sheet";

/** The character's play state a rest reads and writes (`entity` columns + `creature-sheet`). */
export interface RestState {
  hpCurrent: number;
  tempHp: number;
  deathSuccesses: number;
  deathFailures: number;
  sheet: Pick<SheetData, "slotsUsed" | "hitDiceUsed" | "features">;
}

export interface RestStats {
  hpMax: number;
  spellcasting?: Spellcasting;
  classes?: readonly ClassRow[];
}

/** Largest die first (FR-CHARX-122). */
const DICE_DOWN: readonly HitDie[] = [...HIT_DICE].reverse();

/** FR-CHARX-122: Σ class levels (= total hit dice); 0 without classes. */
export const totalLevel = (stats: Pick<RestStats, "classes">): number =>
  (stats.classes ?? []).reduce((n, c) => n + c.level, 0);

/** FR-CHARX-122: hit dice a long rest gives back, `max(1, ⌊total level / 2⌋)`. */
export const hitDiceRegainOf = (stats: Pick<RestStats, "classes">): number =>
  Math.max(1, Math.floor(totalLevel(stats) / 2));

/**
 * FR-CHARX-122: spent hit dice after a long rest: up to `hitDiceRegainOf` come back, largest die
 * size first (d12, d10, d8, d6). `used` is clamped to the class levels first (FR-CHARX-17).
 */
export function regainHitDice(used: HitDiceUsed, stats: Pick<RestStats, "classes">): HitDiceUsed {
  const clamped = clampCounters({ slotsUsed: {}, hitDiceUsed: used }, stats).hitDiceUsed;
  let left = hitDiceRegainOf(stats);
  const out: HitDiceUsed = {};
  for (const die of DICE_DOWN) {
    const n = clamped[die] ?? 0;
    const back = Math.min(n, left);
    left -= back;
    if (n - back > 0) out[die] = n - back;
  }
  return out;
}

/** FR-CHARX-121: rows with uses whose `reset` comes back on this rest (a long rest: both). */
const resetsOn = (f: FeatureRow, kind: RestKind): boolean =>
  f.reset !== undefined && (kind === "long" || f.reset === "short");

/**
 * FR-CHARX-121: the state after the rest. **Short**: feature rows with `reset: short` → `used 0`
 * (also below zero, FR-CHARX-58). **Long**: HP → `hpMax`, temp HP 0, death saves 0 / 0, every
 * slot `used 0`, rows with `reset` short or long → `used 0`, hit dice per `regainHitDice`.
 */
export function restOutcome(kind: RestKind, s: RestState, stats: RestStats): RestState {
  const features = s.sheet.features.map(
    (f): FeatureRow => (f.used !== 0 && resetsOn(f, kind) ? { ...f, used: 0 } : f),
  );
  if (kind === "short") return { ...s, sheet: { ...s.sheet, features } };
  const slotsUsed: SlotsUsed = {};
  return {
    hpCurrent: stats.hpMax,
    tempHp: 0,
    deathSuccesses: 0,
    deathFailures: 0,
    sheet: { features, slotsUsed, hitDiceUsed: regainHitDice(s.sheet.hitDiceUsed, stats) },
  };
}

/** FR-CHARX-123: the confirm's line of what the rest resets. */
export const REST_TEXT: Record<RestKind, string> = {
  short: "Resets short-rest feature uses. Spend hit dice on the sheet.",
  long: "Restores HP, spell slots, feature uses and half the hit dice; clears temp HP and death saves.",
};

/** FR-CHARX-123: the one-line warning while an encounter is running (the rest is allowed). */
export const REST_COMBAT_WARNING = "An encounter is running.";

/** "Short rest" / "Long rest". */
export const restLabel = (kind: RestKind): string =>
  kind === "short" ? "Short rest" : "Long rest";
