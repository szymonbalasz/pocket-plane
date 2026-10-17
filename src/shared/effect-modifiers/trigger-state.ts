// `trigger-state` record (FR-MOD-53, -55; MOD §8.2; ADR-0049 D1, data model §27): a derived
// display copy, one row per (enabled trigger, owner combatant) while an encounter is started.
// `trigger_use` stays the only truth for charges: no server rule reads these rows.
import { z } from "zod";
import { TRIGGER_NAME_MAX } from "./trigger-records";
import { TriggerEvent } from "./triggers";

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
