// Domain events of combat-tracker (CBT §9, protocol §22). All logged; none transient.
// Undoable: `AttackApplied`, `HpApplied` only; undo = compensating `CombatEntryUndone` (ADR-0016).
// Shared definitions (fix/combat-core); combat-tracker emits them. Payloads the specs leave
// open (`{encounterId}` CRUD, initiative, remove / restore) are fix/combat-core picks (§22).
import { DeathCounters } from "@shared/combat-extras/schemas";
import { Ability } from "@shared/entities/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

/** FR-CBT-20: `raw = hit ? floor(damageTotal × {1, ½, 0, 2}) : 0`. */
export const DAMAGE_MULTIPLIERS = ["normal", "half", "none", "double"] as const;
export const DamageMultiplier = z.enum(DAMAGE_MULTIPLIERS);
export type DamageMultiplier = z.infer<typeof DamageMultiplier>;

const Id = z.string();
const Int = z.number().int();
const EncounterRef = z.object({ encounterId: Id }).strict();

/** REST create / replace / delete (planned only): `encounter` (+ `encounter-entry`), DM only. */
export const EncounterCreated = defineEvent({
  type: "EncounterCreated",
  payload: EncounterRef,
  logged: true,
  undoable: false,
});
export const EncounterUpdated = defineEvent({
  type: "EncounterUpdated",
  payload: EncounterRef,
  logged: true,
  undoable: false,
});
export const EncounterDeleted = defineEvent({
  type: "EncounterDeleted",
  payload: EncounterRef,
  logged: true,
  undoable: false,
});

/** `cbt.start`: `encounter`, `combatant` creates (FR-CBT-07). */
export const EncounterStarted = defineEvent({
  type: "EncounterStarted",
  payload: z.object({ encounterId: Id, sceneId: Id, combatantIds: z.array(Id) }).strict(),
  logged: true,
  undoable: false,
});

/** `cbt.end`: `encounter`, every `combatant` (players: deletes) (FR-CBT-10). */
export const EncounterEnded = defineEvent({
  type: "EncounterEnded",
  payload: EncounterRef,
  logged: true,
  undoable: false,
});

/** `cbt.rollInitiative`: changed `combatant`s (ranks), one `game-log-entry` per roll. */
export const InitiativeRolled = defineEvent({
  type: "InitiativeRolled",
  payload: z
    .object({
      encounterId: Id,
      combatantIds: z.array(Id).min(1).max(50),
      rollIds: z.array(Id).min(1).max(50),
      entryIds: z.array(Id).min(1).max(50),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/** `cbt.setInitiative`: changed `combatant`s (ranks). */
export const InitiativeSet = defineEvent({
  type: "InitiativeSet",
  payload: z.object({ encounterId: Id, combatantId: Id, value: Int }).strict(),
  logged: true,
  undoable: false,
});

/** `cbt.nextTurn` / `cbt.prevTurn`: `encounter` (FR-CBT-14). */
export const TurnChanged = defineEvent({
  type: "TurnChanged",
  payload: z
    .object({ round: Int, turnCombatantId: Id.nullable(), direction: z.enum(["next", "prev"]) })
    .strict(),
  logged: true,
  undoable: false,
});

const CombatantRef = z.object({ encounterId: Id, combatantId: Id }).strict();

/** `cbt.setRemoved`: `combatant`s (ranks), `encounter` (player turn copy). */
export const CombatantRemoved = defineEvent({
  type: "CombatantRemoved",
  payload: CombatantRef,
  logged: true,
  undoable: false,
});
export const CombatantRestored = defineEvent({
  type: "CombatantRestored",
  payload: CombatantRef,
  logged: true,
  undoable: false,
});

/** `cbt.attack`: `game-log-entry` (player sender only); card via `notify` after (FR-CBT-18). */
export const AttackRolled = defineEvent({
  type: "AttackRolled",
  payload: z.object({ cardId: Id, rollIds: z.array(Id).min(1) }).strict(),
  logged: true,
  undoable: false,
});

/** `cbt.rollAbility`: one `game-log-entry` (players iff public; hidden combatant never) (FR-CBT-44). */
export const CombatantRolled = defineEvent({
  type: "CombatantRolled",
  payload: z
    .object({
      encounterId: Id,
      combatantId: Id,
      kind: z.enum(["check", "save"]),
      ability: Ability,
      rollIds: z.array(Id).min(1),
      entryId: Id,
    })
    .strict(),
  logged: true,
  undoable: false,
});

/**
 * FR-CBT-23: the combat log entry's facts (rolled and final values, overrides, AC used).
 * combat-extras (FR-CBTX-21) adds temp HP, death counters and the cards created; optional, so
 * payloads logged before CBTX still parse.
 */
export const HpChangeFacts = z
  .object({
    hpChangeId: Id,
    encounterId: Id,
    kind: z.enum(["damage", "heal"]),
    source: z.enum(["card", "direct"]),
    cardId: Id.nullable(),
    rollIds: z.array(Id),
    attackerId: Id.nullable(),
    attackerName: z.string().nullable(),
    attackName: z.string().nullable(),
    damageType: z.string().nullable(),
    targetId: Id,
    targetEntityId: Id,
    targetName: z.string(),
    targetAc: Int,
    toHitRolled: Int.nullable(),
    toHitTotal: Int.nullable(),
    natural: Int.nullable(),
    hitComputed: z.boolean().nullable(),
    hit: z.boolean().nullable(),
    damageRolled: Int.nullable(),
    damageTotal: Int,
    multiplier: DamageMultiplier.nullable(),
    raw: Int,
    applied: Int,
    overkill: Int,
    hpBefore: Int,
    hpAfter: Int,
    tempBefore: Int.optional(),
    tempAfter: Int.optional(),
    /** Null when the change left the counters unchanged. */
    deathBefore: DeathCounters.nullable().optional(),
    deathAfter: DeathCounters.nullable().optional(),
    /** `cbtx-concentration` cards created by this change. */
    noteIds: z.array(Id).optional(),
  })
  .strict();
export type HpChangeFacts = z.infer<typeof HpChangeFacts>;

/** `cbt.applyCard`: target, `hp-change`, `game-log-entry`, card (then `NotificationResolved`). */
export const AttackApplied = defineEvent({
  type: "AttackApplied",
  payload: HpChangeFacts,
  logged: true,
  undoable: true,
});

/** `cbt.applyHp`: target, `hp-change`, `game-log-entry` (FR-CBT-21). */
export const HpApplied = defineEvent({
  type: "HpApplied",
  payload: HpChangeFacts,
  logged: true,
  undoable: true,
});

/** `cbt.undo`: compensating event; target, `hp-change`, entry undone (then `NotificationReopened`). */
export const CombatEntryUndone = defineEvent({
  type: "CombatEntryUndone",
  payload: z.object({ hpChangeId: Id }).strict(),
  logged: true,
  undoable: false,
});
