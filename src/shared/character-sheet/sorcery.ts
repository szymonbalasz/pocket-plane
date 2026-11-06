// Sorcery points and Flexible Casting (class-resources FR-CRES-05–08), pure: the pool row, slot →
// points, points → a created slot, and ticking a level that has created slots. The server's
// `char.convertSlot` / `char.createSlot` / `char.useResource {slot}` write what these return; the
// sheet's Convert menu reads the same helpers to enable its choices.
import type { SpellLevelKey } from "@shared/entities/schemas";
import { pactMax, slotMax } from "./counters";
import type {
  CreatedSlotLevel,
  FeatureRow,
  SheetData,
  SlotSource,
  SlotsCreated,
  SlotsUsed,
} from "./sheet";

/** FR-CRES-07 (SRD 5.1, own words): sorcery points a created slot of each level costs. */
export const CREATE_SLOT_COST: Readonly<Record<CreatedSlotLevel, number>> = {
  "1": 2,
  "2": 3,
  "3": 5,
  "4": 6,
  "5": 7,
};

type Stats = Parameters<typeof slotMax>[0];
type Counters = Pick<SheetData, "slotsUsed" | "slotsCreated" | "pactUsed" | "features">;

/** FR-CRES-05: the sheet's sorcery-points row (at most one), if any. */
export const sorceryRow = (sheet: Pick<SheetData, "features">): FeatureRow | undefined =>
  sheet.features.find((f) => f.pool === "sorcery-points");

/** Sorcery points left (below zero once overspent elsewhere, FR-CHARX-58). */
export const pointsLeft = (f: Pick<FeatureRow, "usesMax" | "used">): number =>
  (f.usesMax ?? 0) - f.used;

/** A spell level's slots left: unused normal ones + created ones (FR-CRES-08). */
export function slotsLeft(
  sheet: Pick<SheetData, "slotsUsed" | "slotsCreated">,
  stats: Stats,
  level: SpellLevelKey,
): number {
  const created = sheet.slotsCreated[level as CreatedSlotLevel] ?? 0;
  return slotMax(stats, level) - (sheet.slotsUsed[level] ?? 0) + created;
}

/** The level a slot source is worth in points (pact: the pact level). */
export const sourceLevel = (stats: Stats, from: SlotSource): number =>
  "slot" in from ? from.slot : (stats.spellcasting?.pact?.level ?? 0);

const leafSet = <K extends string>(m: Partial<Record<K, number>>, k: K, n: number) => {
  const out = { ...m };
  if (n > 0) out[k] = n;
  else delete out[k];
  return out;
};

/**
 * FR-CRES-08: tick `delta` slots of `level` (> 0 spends, < 0 gives back). Spending takes created
 * slots first (they disappear), then normal ones up to the maximum; giving back only lowers
 * `used` (a spent created slot is gone). Returns the new leaves and how many changed.
 */
export function tickSlots(
  sheet: Pick<SheetData, "slotsUsed" | "slotsCreated">,
  stats: Stats,
  level: SpellLevelKey,
  delta: number,
): { slotsUsed: SlotsUsed; slotsCreated: SlotsCreated; changed: number } {
  const used = sheet.slotsUsed[level] ?? 0;
  if (delta < 0) {
    const after = Math.max(0, used + delta);
    return {
      slotsUsed: leafSet(sheet.slotsUsed, level, after),
      slotsCreated: sheet.slotsCreated,
      changed: used - after,
    };
  }
  const key = level as CreatedSlotLevel;
  const created = sheet.slotsCreated[key] ?? 0;
  const fromCreated = Math.min(created, delta);
  const fromNormal = Math.min(delta - fromCreated, slotMax(stats, level) - used);
  return {
    slotsUsed: leafSet(sheet.slotsUsed, level, used + fromNormal),
    slotsCreated:
      fromCreated > 0
        ? leafSet(sheet.slotsCreated, key, created - fromCreated)
        : sheet.slotsCreated,
    changed: fromCreated + fromNormal,
  };
}

export type FlexOutcome =
  | { ok: true; sheet: Counters; points: { before: number; after: number } }
  | { ok: false; message: string };

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/**
 * FR-CRES-06: spend one slot of `from` (created slots of that level first) for points equal to
 * its level. Refused without a sorcery-points row, without such a slot, or when the points would
 * pass the maximum (OQ-CRES-02 A).
 */
export function convertSlot(sheet: Counters, stats: Stats, from: SlotSource): FlexOutcome {
  const pool = sorceryRow(sheet);
  if (!pool?.usesMax) return { ok: false, message: "No sorcery points row" };
  const level = sourceLevel(stats, from);
  let next: Counters;
  if ("pact" in from) {
    if (pactMax(stats) === 0) return { ok: false, message: "No pact slots" };
    if (sheet.pactUsed >= pactMax(stats)) return { ok: false, message: "No pact slot left" };
    next = { ...sheet, pactUsed: sheet.pactUsed + 1 };
  } else {
    const l = String(from.slot) as SpellLevelKey;
    if (slotsLeft(sheet, stats, l) <= 0) {
      return { ok: false, message: `No ${ordinal(from.slot)}-level slot left` };
    }
    const t = tickSlots(sheet, stats, l, 1);
    next = { ...sheet, slotsUsed: t.slotsUsed, slotsCreated: t.slotsCreated };
  }
  if (pool.used - level < 0) return { ok: false, message: "Sorcery points are full" };
  const after = pool.used - level;
  return {
    ok: true,
    sheet: {
      ...next,
      features: sheet.features.map((f) => (f.id === pool.id ? { ...f, used: after } : f)),
    },
    points: { before: pointsLeft(pool), after: pool.usesMax - after },
  };
}

/** FR-CRES-07: spend the level's cost in points (no overspend) for one created slot. */
export function createSlot(sheet: Counters, level: number): FlexOutcome {
  const pool = sorceryRow(sheet);
  if (!pool?.usesMax) return { ok: false, message: "No sorcery points row" };
  const key = String(level) as CreatedSlotLevel;
  const cost = CREATE_SLOT_COST[key];
  if (cost === undefined) return { ok: false, message: "Created slots are 1st to 5th level" };
  const left = pointsLeft(pool);
  if (left < cost) {
    return {
      ok: false,
      message: `A ${ordinal(level)}-level slot costs ${cost} sorcery points (${Math.max(0, left)} left)`,
    };
  }
  const created = sheet.slotsCreated[key] ?? 0;
  if (created >= 9) return { ok: false, message: "Too many created slots of that level" };
  const used = pool.used + cost;
  return {
    ok: true,
    sheet: {
      ...sheet,
      slotsCreated: { ...sheet.slotsCreated, [key]: created + 1 },
      features: sheet.features.map((f) => (f.id === pool.id ? { ...f, used } : f)),
    },
    points: { before: left, after: pool.usesMax - used },
  };
}
