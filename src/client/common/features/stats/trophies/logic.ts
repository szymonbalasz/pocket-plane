// Trophy case logic (FR-STATS-42, -44; FR-CHARX-98, -99), pure: the shown values ("—" for 0 or
// none), the records' detail lines, and which live lines refresh the tab (a line of the character
// or one of its companions, by the names the lines carry). Renders only the ack's numbers.
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "@shared/combat-tracker/schemas";
import type { EventFrame } from "@shared/protocol/frames";
import type { TrophyLifetime, TrophyRecord, TrophyRecords } from "@shared/stats/schemas";
import { logUpserts } from "../logic";

export const LIFETIME_ROWS: { key: keyof TrophyLifetime; label: string }[] = [
  { key: "avgD20", label: "Avg d20" },
  { key: "nat20", label: "Nat 20s" },
  { key: "nat1", label: "Nat 1s" },
  { key: "fights", label: "Fights" },
  { key: "dealt", label: "Damage dealt" },
  { key: "taken", label: "Damage taken" },
  { key: "healing", label: "Healing" },
  { key: "kills", label: "Kills" },
  { key: "downed", label: "Times downed" },
];

export const RECORD_ROWS: { key: keyof TrophyRecords; label: string }[] = [
  { key: "biggest-hit", label: "Biggest hit" },
  { key: "biggest-overkill", label: "Biggest overkill" },
  { key: "best-fight-damage", label: "Best fight (damage)" },
  { key: "best-fight-kills", label: "Best fight (kills)" },
];

/** FR-STATS-42: "—" for 0 or none; Avg d20 with 1 decimal. */
export function lifetimeText(key: keyof TrophyLifetime, l: TrophyLifetime): string {
  const v = l[key];
  if (v === null || v === 0) return "—";
  return key === "avgD20" ? v.toFixed(1) : String(v);
}

/**
 * FR-CHARX-98: a record's value ("—" for none) and muted detail ("→ Ogre · Fight 3 · Tue 20 Oct").
 * Sprint 10 (BL-103): a player's Biggest overkill is the callout line's damage (FR-STATS-12), so it
 * reads "30 damage" as on the Session tab; the DM's stays the overkill amount.
 */
export function recordText(
  r: TrophyRecord,
  key?: keyof TrophyRecords,
  role: "dm" | "player" = "dm",
): { value: string; detail: string | null } {
  if (!r || r.value === 0) return { value: "—", detail: null };
  const unit = key === "biggest-overkill" && role === "player" ? " damage" : "";
  return { value: `${r.value}${unit}`, detail: r.to ? `→ ${r.to} · ${r.fight}` : r.fight };
}

/**
 * FR-STATS-44: does this live frame refresh the tab? A log upsert whose actor or target is one of
 * `names` (the character's and its companions'); a roll entry by them counts too.
 */
export function trophiesRefresh(
  frame: Pick<EventFrame, "cause" | "changes">,
  names: ReadonlySet<string>,
): boolean {
  if (names.size === 0) return false;
  return logUpserts(frame).some((e) => {
    if (names.has(e.actorName)) return true;
    if (e.kind !== LOG_KIND_ATTACK && e.kind !== LOG_KIND_HP) return false;
    const target = (e.payload as { targetName?: unknown } | null)?.targetName;
    return typeof target === "string" && names.has(target);
  });
}
