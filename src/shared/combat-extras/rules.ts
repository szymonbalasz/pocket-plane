// Pure combat-extras rules shared by server and clients. Redactions read only the record
// (ADR-0021), so derived values are computed here from the record's own fields.
import type { DeathState } from "@shared/entities/schemas";
import { CONDITION_INFO, type Condition } from "./conditions";
import { DEATH_SAVES_MAX, type DeathCounters, type EffectKind, TEMP_HP_MAX } from "./schemas";

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

// ---------- durations (FR-CBTX-05, -06, -07) ----------

/** FR-CBTX-05: `max(round, 1) + durationRounds` (an effect added in round 0 counts from 1). */
export const endsRoundOf = (round: number, durationRounds: number) =>
  Math.max(round, 1) + durationRounds;

/** "N rounds left" = `endsRound − round` (never below 0). */
export const roundsLeft = (endsRound: number, round: number) => Math.max(0, endsRound - round);

export interface ExpiryInput {
  endsRound: number | null;
  anchorCombatantId: string | null;
  endedAt: string | null;
}

/**
 * FR-CBTX-05/06: a Next onto `to` ends the effect at the start of the anchor's turn in
 * `endsRound`, or on the first Next into a round past it (anchor removed, skipped or none).
 */
export function expiresAt(
  e: ExpiryInput,
  to: { round: number; turnCombatantId: string | null },
): boolean {
  if (e.endedAt !== null || e.endsRound === null) return false;
  if (to.round > e.endsRound) return true;
  return to.round === e.endsRound && to.turnCombatantId === e.anchorCombatantId;
}

// ---------- HP rules (FR-CBTX-15, -17, -20, -23) ----------

/** FR-CBTX-17: concentration save DC = max(10, ⌊damage / 2⌋). */
export const concentrationDc = (damage: number) => Math.max(10, Math.floor(damage / 2));

/** FR-CBTX-15: temp HP absorbs first; the rest is the HP loss (before clamping). */
export function absorb(tempHp: number, raw: number): { absorbed: number; rest: number } {
  const absorbed = Math.min(tempHp, Math.max(0, raw));
  return { absorbed, rest: raw - absorbed };
}

export const clampTemp = (n: number) => Math.max(0, Math.min(TEMP_HP_MAX, n));
const clampCount = (n: number) => Math.max(0, Math.min(DEATH_SAVES_MAX, n));

/**
 * FR-CBTX-20: counters after damage / heal on a character. Damage with `raw > 0` at 0 HP (not
 * dead): failures + 1 (+ 2 on a crit), successes 0 if it was stable. Heal to HP > 0: both 0.
 */
export function deathAfterHp(
  c: DeathCounters,
  o: { kind: "damage" | "heal"; raw: number; crit: boolean; hpBefore: number; hpAfter: number },
): DeathCounters {
  if (o.kind === "heal") return o.hpAfter > 0 ? { successes: 0, failures: 0 } : c;
  if (o.raw <= 0 || o.hpBefore > 0 || deathStateOf(0, c.successes, c.failures) === "dead") {
    return c;
  }
  const stable = c.successes >= DEATH_SAVES_MAX;
  return {
    successes: stable ? 0 : c.successes,
    failures: clampCount(c.failures + (o.crit ? 2 : 1)),
  };
}

/**
 * FR-CBTX-22: undo of a change's counters, by delta. HP above 0 after the HP inverse → both 0;
 * still at 0 → each counter minus its change (clamped), so later rolls survive.
 */
export function deathRevert(
  now: DeathCounters,
  before: DeathCounters | null,
  after: DeathCounters | null,
  hpNow: number,
): DeathCounters {
  if (hpNow > 0) return { successes: 0, failures: 0 };
  if (!before || !after) return now;
  return {
    successes: clampCount(now.successes - (after.successes - before.successes)),
    failures: clampCount(now.failures - (after.failures - before.failures)),
  };
}

export type DeathSaveOutcome = "revive" | "success" | "failure";

/** FR-CBTX-23: natural 20 → 1 HP; natural 1 → 2 failures; ≥ 10 success; else failure. */
export function deathSave(
  c: DeathCounters,
  natural: number,
): { outcome: DeathSaveOutcome; after: DeathCounters } {
  if (natural === 20) return { outcome: "revive", after: { successes: 0, failures: 0 } };
  if (natural >= 10) {
    return { outcome: "success", after: { ...c, successes: clampCount(c.successes + 1) } };
  }
  const add = natural === 1 ? 2 : 1;
  return { outcome: "failure", after: { ...c, failures: clampCount(c.failures + add) } };
}

export const sameCounters = (a: DeathCounters, b: DeathCounters) =>
  a.successes === b.successes && a.failures === b.failures;

// ---------- names ----------

export interface EffectNameInput {
  kind: EffectKind;
  condition: Condition | null;
  level: number | null;
  label: string | null;
}

/** "Frightened", "Exhaustion 2", "Bless", "Concentrating: Bless". */
export function effectName(e: EffectNameInput): string {
  if (e.kind === "condition" && e.condition) {
    const name = CONDITION_INFO[e.condition].name;
    return e.level !== null ? `${name} ${e.level}` : name;
  }
  if (e.kind === "concentration") return `Concentrating: ${e.label ?? ""}`;
  return e.label ?? "";
}

/** FR-CBTX-06 toast: "Ended: Bless (Mira, Thorn)" — one group per effect name, first-seen order. */
export function endedText(items: readonly { name: string; target: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const i of items) groups.set(i.name, [...(groups.get(i.name) ?? []), i.target]);
  return `Ended: ${[...groups].map(([n, ts]) => `${n} (${ts.join(", ")})`).join(", ")}`;
}

/** FR-CBTX-07 / -22 toast: "Not restored: Frightened (Goblin) — already active". */
export const notRestoredText = (names: readonly string[]) =>
  `Not restored: ${names.join(", ")} — already active`;
