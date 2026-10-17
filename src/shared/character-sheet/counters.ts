// Sheet counters (FR-CHARX-17): spell slots used, hit dice used, feature uses. Pure; the server
// clamps with them and the sheet draws its pips from them. FR-CHARX-58 (sprint 4): feature uses
// may go below zero, down to −9 (`used` up to `usesMax + 9`); slots and hit dice keep `0 … max`.
import {
  type ClassRow,
  HIT_DICE,
  type HitDie,
  hitDice,
  SPELL_LEVELS,
  type Spellcasting,
  type SpellLevelKey,
} from "@shared/entities/schemas";
import type { SheetResource } from "@shared/events/character-sheet";
import {
  FEATURE_OVERSPEND_MAX,
  type FeatureRow,
  type HitDiceUsed,
  type SheetData,
  type SlotsUsed,
} from "./sheet";

type CounterStats = { spellcasting?: Spellcasting; classes?: readonly ClassRow[] };

/** Slot maximum of a spell level (absent = 0). */
export const slotMax = (stats: CounterStats, level: SpellLevelKey): number =>
  stats.spellcasting?.slots[level] ?? 0;

/** Hit dice of a size = Σ class levels with it (FR-CHARX-05). */
export const hitDieMax = (stats: CounterStats, die: HitDie): number => hitDice(stats)[die] ?? 0;

/** `clamp(used, 0, max)`; a 0 is left out of the leaf (absent = 0). */
function clampLeaf<K extends string>(
  used: Partial<Record<K, number>>,
  keys: readonly K[],
  max: (k: K) => number,
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const n = Math.min(used[k] ?? 0, max(k));
    if (n > 0) out[k] = n;
  }
  return out;
}

/** FR-CHARX-17: lowering a maximum clamps `used` (stat block side: slots, hit dice). */
export function clampCounters(
  sheet: Pick<SheetData, "slotsUsed" | "hitDiceUsed">,
  stats: CounterStats,
): { slotsUsed: SlotsUsed; hitDiceUsed: HitDiceUsed } {
  return {
    slotsUsed: clampLeaf(sheet.slotsUsed, SPELL_LEVELS, (l) => slotMax(stats, l)),
    hitDiceUsed: clampLeaf(sheet.hitDiceUsed, HIT_DICE, (d) => hitDieMax(stats, d)),
  };
}

/** FR-CHARX-58: a feature row's highest `used` = `usesMax + 9` (uses left −9); no uses → 0. */
export const featureUsedCap = (f: Pick<FeatureRow, "usesMax">): number =>
  f.usesMax ? f.usesMax + FEATURE_OVERSPEND_MAX : 0;

/** FR-CHARX-58: uses left of a feature row with uses (below zero once overspent). */
export const featureLeft = (f: Pick<FeatureRow, "usesMax" | "used">): number =>
  (f.usesMax ?? 0) - f.used;

/** Uses left as shown: a typographic minus below zero ("−1"), FR-CHARX-58. */
export const leftText = (left: number): string => (left < 0 ? `−${-left}` : String(left));

/**
 * A counter's `{used, max, cap}`; `cap` = the highest `used` (slots, hit dice: `max`; feature
 * rows: `usesMax + 9`, FR-CHARX-58); `null` = unknown feature row.
 */
export function counterOf(
  sheet: Pick<SheetData, "slotsUsed" | "hitDiceUsed" | "features">,
  stats: CounterStats,
  resource: SheetResource,
): { used: number; max: number; cap: number } | null {
  if ("slot" in resource) {
    const l = String(resource.slot) as SpellLevelKey;
    const max = slotMax(stats, l);
    return { used: sheet.slotsUsed[l] ?? 0, max, cap: max };
  }
  if ("hitDie" in resource) {
    const max = hitDieMax(stats, resource.hitDie);
    return { used: sheet.hitDiceUsed[resource.hitDie] ?? 0, max, cap: max };
  }
  const f = sheet.features.find((r) => r.id === resource.feature);
  return f ? { used: f.used, max: f.usesMax ?? 0, cap: featureUsedCap(f) } : null;
}

/** `used = clamp(used + delta, 0, cap)`; `reset` → 0 (FR-CHARX-17, -58). */
export const nextUsed = (used: number, cap: number, op: { delta?: number; reset?: true }) =>
  op.reset ? 0 : Math.max(0, Math.min(cap, used + (op.delta ?? 0)));

/** The counter written back into the sheet's leaves / feature row. */
export function withUsed(
  sheet: Pick<SheetData, "slotsUsed" | "hitDiceUsed" | "features">,
  resource: SheetResource,
  used: number,
): Pick<SheetData, "slotsUsed" | "hitDiceUsed" | "features"> {
  const leaf = <K extends string>(m: Partial<Record<K, number>>, k: K) => {
    const out = { ...m };
    if (used > 0) out[k] = used;
    else delete out[k];
    return out;
  };
  if ("slot" in resource) {
    const l = String(resource.slot) as SpellLevelKey;
    return { ...sheet, slotsUsed: leaf(sheet.slotsUsed, l) };
  }
  if ("hitDie" in resource) {
    return { ...sheet, hitDiceUsed: leaf(sheet.hitDiceUsed, resource.hitDie) };
  }
  return {
    ...sheet,
    features: sheet.features.map(
      (f): FeatureRow => (f.id === resource.feature ? { ...f, used } : f),
    ),
  };
}
