// `trigger-state` record (FR-MOD-53, -55; MOD §8.2; ADR-0049 D1, data model §27): a derived
// display copy, one row per (enabled trigger, owner combatant) while an encounter is started.
// `trigger_use` stays the only truth for charges: no server rule reads these rows.
import { z } from "zod";
import { windowed } from "./trigger-fire";
import { TRIGGER_NAME_MAX } from "./trigger-records";
import { TriggerEvent, type TriggerEvery } from "./triggers";

export const TRIGGER_STATE_TYPE = "trigger-state";

/**
 * FR-MOD-53 `charge`: `waiting` = an owner-side window filter fails right now (`ownTurn` on
 * another creature's turn, review B23); `used` = a `used` use row for the current window key of
 * a `turn` / `round` / `encounter` trigger; else `ready` (`each`, `feature`: ready / waiting).
 */
export const TRIGGER_CHARGES = ["ready", "used", "waiting"] as const;
export const TriggerCharge = z.enum(TRIGGER_CHARGES);
export type TriggerCharge = z.infer<typeof TriggerCharge>;

const Id = z.string().min(1).max(64);

/** The row as the DM and the owning player receive it (FR-MOD-55: full or nothing). */
export const TriggerStateRecord = z
  .strictObject({
    id: Id,
    campaignId: Id,
    encounterId: Id,
    combatantId: Id,
    triggerId: Id,
    /** Copies for visibility (FR-MOD-55): null / null on a monster (definition) trigger. */
    characterId: Id.nullable(),
    ownerPlayerId: Id.nullable(),
    /** Copies of the trigger. */
    name: z.string().min(1).max(TRIGGER_NAME_MAX),
    on: TriggerEvent,
    /** `requires` met (FR-MOD-36); no `requires` → true. */
    armed: z.boolean(),
    charge: TriggerCharge,
    /** The `every.feature` row (uses left come from the sheet, FR-CHARX-58), else null. */
    featureId: Id.nullable(),
    updatedAt: z.string(),
  })
  .refine((r) => r.characterId !== null || r.ownerPlayerId === null, {
    path: ["ownerPlayerId"],
    message: "Only character triggers have an owner player",
  });
export type TriggerStateRecord = z.infer<typeof TriggerStateRecord>;

/**
 * FR-MOD-53 `charge` of one (trigger, owner combatant), pure: `waiting` while an owner-side
 * window filter fails right now (`ownTurn` and the turn isn't the owner's: never a false Ready,
 * review B23); else `used` iff the trigger is windowed and its current window holds a `used`
 * use row; else `ready`.
 */
export function triggerCharge(
  rule: { when: readonly { if: string }[]; every: TriggerEvery },
  now: { ownTurn: boolean; used: boolean },
): TriggerCharge {
  if (!now.ownTurn && rule.when.some((f) => f.if === "ownTurn")) return "waiting";
  return windowed(rule.every) && now.used ? "used" : "ready";
}

// ---------- badge words (FR-MOD-60; FR-CBTX-52, -53 use the same words) ----------

/** `data-state` of a badge: the charge, `off` (not armed) or `in-effect` (out of combat). */
export type TriggerBadgeState = TriggerCharge | "off" | "in-effect";

export interface TriggerBadge {
  state: TriggerBadgeState;
  text: string;
  /** Uses below zero (FR-MOD-59): drawn in `hp.down`. */
  down?: true;
}

/** What a badge reads besides the row: the trigger's window, its owner's name, sheet uses. */
export interface TriggerBadgeFacts {
  every: TriggerEvery;
  /** The owner creature's name ("On Brakka's turn"). */
  ownerName: string;
  /** The required preset's name, if the rule has `requires` ("Not in effect — needs Rage"). */
  needs: string | null;
  /** `every.feature`: the sheet row's uses (FR-CHARX-58), null when the sheet isn't held. */
  uses?: { left: number; max: number } | null;
}

const USED_WORDS = {
  turn: "Used this turn",
  round: "Used this round",
  encounter: "Used this fight",
};

/** "−1" with a real minus sign (FR-MOD-60: "−1 / 3 left"). */
const signedCount = (n: number) => (n < 0 ? `−${-n}` : String(n));

/** Out of combat, or no row: armed from the store, no charge. */
export function armedBadge(armed: boolean, needs: string | null): TriggerBadge {
  return armed
    ? { state: "in-effect", text: "In effect" }
    : { state: "off", text: needs ? `Not in effect — needs ${needs}` : "Not in effect" };
}

/**
 * FR-MOD-60: a `trigger-state` row's badge: not armed → "Not in effect — needs Rage"; `waiting`
 * → "On Brakka's turn" (never Ready); `used` → "Used this turn / round / fight"; a `feature`
 * trigger → "2 / 3 left" ("−1 / 3 left" down); else "Ready".
 */
export function triggerBadge(
  row: Pick<TriggerStateRecord, "armed" | "charge">,
  f: TriggerBadgeFacts,
): TriggerBadge {
  if (!row.armed) return armedBadge(false, f.needs);
  if (row.charge === "waiting") return { state: "waiting", text: `On ${f.ownerName}'s turn` };
  if (row.charge === "used") {
    return { state: "used", text: windowed(f.every) ? USED_WORDS[f.every] : USED_WORDS.turn };
  }
  if (typeof f.every === "object" && f.uses) {
    const { left, max } = f.uses;
    return {
      state: left > 0 ? "ready" : "used",
      text: `${signedCount(left)} / ${max} left`,
      ...(left < 0 ? { down: true as const } : {}),
    };
  }
  return { state: "ready", text: "Ready" };
}
