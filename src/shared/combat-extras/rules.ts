// Pure combat-extras rules shared by server and clients. Redactions read only the record
// (ADR-0021), so derived values are computed here from the record's own fields.
import type { DeathState } from "@shared/entities/schemas";
import { DEATH_SAVES_MAX } from "./schemas";

/**
 * FR-CBTX-19: `dead` at 3 failures; else `stable` at 0 HP with 3 successes; else `dying` at
 * 0 HP; else null.
 */
export function deathStateOf(
  hpCurrent: number,
  successes: number,
  failures: number,
): DeathState | null {
  if (failures >= DEATH_SAVES_MAX) return "dead";
  if (hpCurrent > 0) return null;
  return successes >= DEATH_SAVES_MAX ? "stable" : "dying";
}
