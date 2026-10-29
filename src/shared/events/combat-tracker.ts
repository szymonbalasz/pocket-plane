// Domain events of combat-tracker (CBT §9, protocol §22). All logged; none transient.
// Undoable: `AttackApplied`, `HpApplied` only; undo = compensating `CombatEntryUndone` (ADR-0016).
// Shared definitions (fix/combat-core); combat-tracker emits them. Payloads the specs leave
// open (`{encounterId}` CRUD, initiative, remove / restore) are fix/combat-core picks (§22).
import { DeathCounters } from "@shared/combat-extras/schemas";
import { Ability, TurnMode } from "@shared/entities/schemas";
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

/**
 * `cbt.rollDamage` (FR-CBT-71, ADR-0037): `game-log-entry`, plus the card upsert in these changes
 * when it updates a card (`attached`: completed the attacker's pending to-hit-only card; or an
 * unused roll on a completed one, FR-CBT-92; sprint 10, BL-92: one frame), else a following
 * `NotificationCreated` (a new damage-only card).
 */
export const DamageRolled = defineEvent({
  type: "DamageRolled",
  payload: z.object({ cardId: Id, rollIds: z.array(Id).min(1), attached: z.boolean() }).strict(),
  logged: true,
  undoable: false,
});

/**
 * `cbt.useRoll` (FR-CBT-173, -175; sprint 15, #385): the used `game-log-entry` (its DM-only
 * `usedByCardId` stamp, FR-DICE-96) and, when `attached`, the completed card's upsert (BL-92: one
 * frame); a new card follows as `NotificationCreated`. Not undoable (like rolling it, ADR-0037).
 */
export const RollUsed = defineEvent({
  type: "RollUsed",
  payload: z
    .object({
      entryId: Id,
      cardId: Id,
      encounterId: Id,
      as: z.enum(["attack", "damage"]),
      attached: z.boolean(),
    })
    .strict(),
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

/**
 * `cbt.applyHit` (sprint 5, FR-CBT-88, ADR-0053): `hit-ruling` create (DM only) and one
 * `game-log-entry` per ruled target (`awaitingDamage`); no HP, the card unchanged. Not undoable.
 */
export const HitApplied = defineEvent({
  type: "HitApplied",
  payload: z
    .object({
      cardId: Id,
      encounterId: Id,
      rulingId: Id,
      entryIds: z.array(Id).min(1).max(20),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/**
 * `cbt.setSide` (sprint 5, #252, FR-CBT-99): `combatant` upsert + one `cbt.side` line. `side` =
 * the new true side (the schemas' `Side`); `secret` = players keep the side they were shown.
 */
export const CombatantSideChanged = defineEvent({
  type: "CombatantSideChanged",
  payload: z
    .object({
      encounterId: Id,
      combatantId: Id,
      side: z.enum(["ally", "enemy"]),
      secret: z.boolean(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

// ---------- sprint 6: companions (#252, FR-CBT-105–122, ADR-0056) ----------

/**
 * `cbt.summon` (FR-CBT-110): `token` creates first, then `combatant` creates (others' ranks),
 * initiative / HP `roll` entries and one `cbt.companion` line. Not undoable (Dismiss).
 */
export const CompanionsSummoned = defineEvent({
  type: "CompanionsSummoned",
  payload: z
    .object({
      encounterId: Id,
      combatantIds: z.array(Id).min(1).max(8),
      ownerCharacterId: Id,
    })
    .strict(),
  logged: true,
  undoable: false,
});

/**
 * `cbt.setCompanion` (FR-CBT-111): the `combatant` (+ reranked rows), its bound `token` (owner)
 * and one `cbt.companion` line. `ownerCharacterId` / `turnMode` null = released; `side` set on
 * turn hostile (an open change, FR-CBT-99).
 */
export const CompanionChanged = defineEvent({
  type: "CompanionChanged",
  payload: z
    .object({
      encounterId: Id,
      combatantId: Id,
      ownerCharacterId: Id.nullable(),
      turnMode: TurnMode.nullable(),
      side: z.enum(["ally", "enemy"]).optional(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/**
 * `cbt.dismiss` (FR-CBT-112): `combatant` inactive; a summon's `token` delete or a pet's `entity`
 * write-back; ended `effect`s; reranked rows; one line. `by` = the DM or the owner player id.
 */
export const CompanionDismissed = defineEvent({
  type: "CompanionDismissed",
  payload: z.object({ encounterId: Id, combatantId: Id, by: z.string() }).strict(),
  logged: true,
  undoable: false,
});
