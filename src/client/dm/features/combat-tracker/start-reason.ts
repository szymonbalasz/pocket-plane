// BL-02: why "Start round 1" can't start yet (FR-CBT-14). Display only: the server still refuses
// with its own "N without initiative"; this names who, from records the client already has.
// Sprint 6 (FR-CBT-108): companions acting with their owner never need a number.
import type { CombatantView } from "@shared/combat-tracker/schemas";

const MAX_NAMES = 3;

/** "2 without initiative: Mira, Thorn" (max 3 names, then "+N"); null when everyone has one. */
export function startReason(
  rows: readonly Pick<CombatantView, "name" | "removed" | "initiative" | "turnMode">[],
): string | null {
  const missing = rows.filter(
    (c) =>
      !c.removed &&
      c.initiative == null &&
      c.turnMode !== "after-owner" &&
      c.turnMode !== "in-owner-turn",
  );
  if (missing.length === 0) return null;
  const names = missing
    .slice(0, MAX_NAMES)
    .map((c) => c.name)
    .join(", ");
  const more = missing.length > MAX_NAMES ? ` +${missing.length - MAX_NAMES}` : "";
  return `${missing.length} without initiative: ${names}${more}`;
}

/** FR-OVW-43: Start uses the viewed scene (FR-CBT-07), so it is off while an overview is viewed. */
export const startOffHint = (overviewViewed: boolean): string | null =>
  overviewViewed ? "Open a battle scene first" : null;
