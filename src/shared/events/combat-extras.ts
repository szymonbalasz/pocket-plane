// Domain events of combat-extras (CBTX §9, protocol §32). All logged; none undoable (undo stays
// combat log entries only, OQ-CBTX-20). Shared definitions (fix/cbtx-core); the CBTX
// build emits them. Payloads carry ids and numbers, never labels (they may name hidden creatures).
import { DeathCounters, EffectEndedReason, TempHp } from "@shared/combat-extras/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);
const Ids = z.array(Id).min(1).max(300);

/** `cbtx.addEffect`: `effect` creates; ended concentration + linked (FR-CBTX-04, -11). */
export const EffectsAdded = defineEvent({
  type: "EffectsAdded",
  payload: z.strictObject({ effectIds: Ids }),
  logged: true,
  undoable: false,
});

/** `cbtx.updateEffect`: the `effect` (FR-CBTX-08). */
export const EffectUpdated = defineEvent({
  type: "EffectUpdated",
  payload: z.strictObject({ effectId: Id }),
  logged: true,
  undoable: false,
});

/** `cbtx.endEffect`: `effect`s (+ linked); closed cards follow as `NotificationResolved`. */
export const EffectsEnded = defineEvent({
  type: "EffectsEnded",
  payload: z.strictObject({ effectIds: Ids, reason: EffectEndedReason }),
  logged: true,
  undoable: false,
});

/** `cbtx.setConcentration`: the new concentration; the replaced one ended (FR-CBTX-09). */
export const ConcentrationSet = defineEvent({
  type: "ConcentrationSet",
  payload: z.strictObject({ effectId: Id, replacedId: Id.optional() }),
  logged: true,
  undoable: false,
});

/** `cbtx.setTempHp`: `combatant` (monster) or `entity` (character) (FR-CBTX-14). */
export const TempHpSet = defineEvent({
  type: "TempHpSet",
  payload: z.strictObject({
    targetKind: z.enum(["combatant", "character"]),
    targetId: Id,
    before: TempHp,
    after: TempHp,
  }),
  logged: true,
  undoable: false,
});

/** `cbtx.rollConcentration`: `game-log-entry`, `effect`s on a fail; then `NotificationResolved`. */
export const ConcentrationRolled = defineEvent({
  type: "ConcentrationRolled",
  payload: z.strictObject({
    notificationId: Id,
    effectId: Id,
    rollIds: z.array(Id).min(1),
    entryId: Id,
    total: z.int(),
    dc: z.int().min(10),
    success: z.boolean(),
  }),
  logged: true,
  undoable: false,
});

/** `cbtx.rollDeathSave`: `entity`, `game-log-entry` (+ HP on a natural 20) (FR-CBTX-23). */
export const DeathSaveRolled = defineEvent({
  type: "DeathSaveRolled",
  payload: z.strictObject({
    characterId: Id,
    rollIds: z.array(Id).min(1),
    entryId: Id,
    natural: z.int().min(1).max(20),
    before: DeathCounters,
    after: DeathCounters,
  }),
  logged: true,
  undoable: false,
});

/** `cbtx.setDeathSaves`: `entity` (FR-CBTX-24). */
export const DeathSavesSet = defineEvent({
  type: "DeathSavesSet",
  payload: z.strictObject({ characterId: Id, ...DeathCounters.shape }),
  logged: true,
  undoable: false,
});

/** `cbtx.addCombatants`: `combatant` creates + ranks, `encounter`, `effect` copies (FR-CBTX-26). */
export const CombatantsAdded = defineEvent({
  type: "CombatantsAdded",
  payload: z.strictObject({ encounterId: Id, combatantIds: z.array(Id).min(1).max(20) }),
  logged: true,
  undoable: false,
});
