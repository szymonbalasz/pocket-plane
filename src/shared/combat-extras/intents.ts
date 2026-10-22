// combat-extras WS intents, results and the concentration card (CBTX §8, §9; protocol §32).
// Strict zod; none optimistic. DM-only unless the spec lists the owner.
import { GridCell, HpMode } from "@shared/combat-tracker/schemas";
import {
  checkManualParts,
  ManualEntry,
  ManualParts,
  RollMode,
} from "@shared/dice-roll-log/schemas";
import { z } from "zod";
import { Condition, ExhaustionLevel } from "./conditions";
import {
  DeathSaveCount,
  DURATION_ROUNDS_MAX,
  EFFECT_LABEL_MAX,
  EFFECT_TARGETS_MAX,
  TempHp,
} from "./schemas";

export const CBTX_INTENTS = {
  addEffect: "cbtx.addEffect",
  updateEffect: "cbtx.updateEffect",
  endEffect: "cbtx.endEffect",
  setConcentration: "cbtx.setConcentration",
  setTempHp: "cbtx.setTempHp",
  rollConcentration: "cbtx.rollConcentration",
  rollDeathSave: "cbtx.rollDeathSave",
  setDeathSaves: "cbtx.setDeathSaves",
  addCombatants: "cbtx.addCombatants",
  /** FR-CBTX-45 (sprint 2): schema here; the command lands in fix/combat2-add. */
  bindToken: "cbtx.bindToken",
  /** FR-CBTX-64 (sprint 8): drag / Move up / down in Initiative. */
  moveCombatant: "cbtx.moveCombatant",
} as const;

const Id = z.string().min(1).max(64);

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the rule (FR-CBTX-04)
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** FR-CBTX-04: trimmed, 1–40 chars, no control chars. */
export const EffectLabel = z
  .string()
  .max(400)
  .refine((s) => !CONTROL.test(s), { message: "Label must not contain control characters" })
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, { message: "Label is required" })
  .refine((s) => [...s].length <= EFFECT_LABEL_MAX, {
    message: `Label must be at most ${EFFECT_LABEL_MAX} characters`,
  });

export const DurationRounds = z.int().min(1).max(DURATION_ROUNDS_MAX);

/**
 * Target ref (CBTX §6): an active combatant of the started encounter (a PC combatant resolves to
 * its character) or any character of the campaign.
 */
export const TargetRef = z.union([
  z.strictObject({ combatantId: Id }),
  z.strictObject({ characterId: Id }),
]);
export type TargetRef = z.infer<typeof TargetRef>;

export const AddEffectInput = z
  .strictObject({
    targets: z.array(TargetRef).min(1).max(EFFECT_TARGETS_MAX),
    kind: z.enum(["condition", "custom"]),
    condition: Condition.optional(),
    level: ExhaustionLevel.optional(),
    label: EffectLabel.optional(),
    durationRounds: DurationRounds.optional(),
    sourceCombatantId: Id.optional(),
    linkConcentration: z.boolean().optional(),
    secret: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.kind === "condition") {
      if (!v.condition) issue("condition", "Pick a condition");
      if ((v.level !== undefined) !== (v.condition === "exhaustion")) {
        issue("level", "Level 1–6 for exhaustion only");
      }
      if (v.label !== undefined) issue("label", "Conditions take no label");
    } else {
      if (v.label === undefined) issue("label", "Label is required");
      if (v.condition !== undefined || v.level !== undefined) {
        issue("condition", "Custom effects take no condition");
      }
    }
    if (v.linkConcentration && v.sourceCombatantId === undefined) {
      issue("linkConcentration", "Linking needs a source");
    }
  });
export type AddEffectInput = z.input<typeof AddEffectInput>;
export const EffectIdsResult = z.object({ effectIds: z.array(z.string()) });
export type EffectIdsResult = z.infer<typeof EffectIdsResult>;

/** FR-CBTX-08: `durationRounds` null = until removed. */
export const UpdateEffectInput = z.strictObject({
  effectId: Id,
  level: ExhaustionLevel.optional(),
  durationRounds: DurationRounds.nullable().optional(),
  secret: z.boolean().optional(),
});
export type UpdateEffectInput = z.input<typeof UpdateEffectInput>;

export const EndEffectInput = z.strictObject({ effectId: Id });

export const SetConcentrationInput = z.strictObject({
  target: TargetRef,
  label: EffectLabel,
  durationRounds: DurationRounds.optional(),
});
export type SetConcentrationInput = z.input<typeof SetConcentrationInput>;
export const EffectIdResult = z.object({ effectId: z.string() });
export type EffectIdResult = z.infer<typeof EffectIdResult>;

export const SetTempHpInput = z.strictObject({ target: TargetRef, value: TempHp });
export type SetTempHpInput = z.input<typeof SetTempHpInput>;

export const RollConcentrationInput = z
  .strictObject({
    notificationId: Id,
    mode: RollMode.default("normal"),
    manual: ManualEntry.optional(),
    /** FR-MOD-18 (tier 2): physical bonus die groups (Bless's d4 on the save), with `manual`. */
    manualParts: ManualParts.optional(),
    public: z.boolean().optional(),
  })
  .superRefine(checkManualParts);
export type RollConcentrationInput = z.input<typeof RollConcentrationInput>;
export const RollConcentrationResult = z.object({
  rollIds: z.array(z.string()),
  entryId: z.string(),
  success: z.boolean(),
});
export type RollConcentrationResult = z.infer<typeof RollConcentrationResult>;

export const RollDeathSaveInput = z
  .strictObject({
    characterId: Id,
    mode: RollMode.default("normal"),
    manual: ManualEntry.optional(),
    /** FR-MOD-18 (tier 2): physical bonus die groups, with `manual`. */
    manualParts: ManualParts.optional(),
    public: z.boolean().optional(),
  })
  .superRefine(checkManualParts);
export type RollDeathSaveInput = z.input<typeof RollDeathSaveInput>;
export const RollIdsEntryResult = z.object({ rollIds: z.array(z.string()), entryId: z.string() });
export type RollIdsEntryResult = z.infer<typeof RollIdsEntryResult>;

export const SetDeathSavesInput = z.strictObject({
  characterId: Id,
  successes: DeathSaveCount,
  failures: DeathSaveCount,
});
export type SetDeathSavesInput = z.input<typeof SetDeathSavesInput>;

/** FR-CBTX-26: total combatants of an encounter after an add. */
export const COMBATANTS_MAX = 56;
/** FR-CBTX-44: instances per add (a definition item counts its `quantity`). */
export const ADD_INSTANCES_MAX = 20;
export const AddCombatantItem = z.union([
  z.strictObject({ tokenId: Id }),
  z.strictObject({ characterId: Id }),
  /** FR-CBTX-44 (sprint 2): `quantity` 1–20 (absent = 1), `hpMode` (absent = average). */
  z.strictObject({
    definitionId: Id,
    quantity: z.int().min(1).max(ADD_INSTANCES_MAX).optional(),
    hpMode: HpMode.optional(),
  }),
]);
export type AddCombatantItem = z.infer<typeof AddCombatantItem>;
const instancesOf = (i: AddCombatantItem) => ("definitionId" in i ? (i.quantity ?? 1) : 1);
/**
 * FR-CBTX-26 / -44: ≤ 20 instances per call. `createTokens` (absent = false: the token menu's
 * Add to combat is unchanged), `hidden` (created tokens' flag), `at` (FR-CBT-65).
 */
export const AddCombatantsInput = z.strictObject({
  encounterId: Id,
  items: z
    .array(AddCombatantItem)
    .min(1)
    .max(ADD_INSTANCES_MAX)
    .refine((items) => items.reduce((n, i) => n + instancesOf(i), 0) <= ADD_INSTANCES_MAX, {
      message: `At most ${ADD_INSTANCES_MAX} creatures per add`,
    }),
  createTokens: z.boolean().optional(),
  hidden: z.boolean().optional(),
  at: GridCell.optional(),
});
export type AddCombatantsInput = z.input<typeof AddCombatantsInput>;

/**
 * FR-CBTX-45: link a token to a token-less active combatant, or `tokenId: null` to unlink a
 * bound one (DM). Emits `CombatantBound`.
 */
export const BindTokenInput = z.strictObject({ combatantId: Id, tokenId: Id.nullable() });
export type BindTokenInput = z.input<typeof BindTokenInput>;
/**
 * FR-CBTX-64 (sprint 8): drop `combatantId` right after `afterId` (null = top) in the started
 * encounter's Initiative (DM). Emits `CombatantMoved`; the same order → ack, no event.
 */
export const MoveCombatantInput = z.strictObject({
  encounterId: Id,
  combatantId: Id,
  afterId: Id.nullable(),
});
export type MoveCombatantInput = z.input<typeof MoveCombatantInput>;
export const CombatantIdsResult = z.object({ combatantIds: z.array(z.string()) });
export type CombatantIdsResult = z.infer<typeof CombatantIdsResult>;

// ---------- concentration card (notification kind `cbtx-concentration`, CBTX §8) ----------

export const ConcentrationCardPayload = z.strictObject({
  effectId: Id,
  targetName: z.string().max(80),
  dc: z.int().min(10),
  damage: z.int().min(1),
  hpChangeId: Id.nullable(),
  encounterId: Id.nullable(),
});
export type ConcentrationCardPayload = z.infer<typeof ConcentrationCardPayload>;

/** Rolled (FR-CBTX-18), or closed by a rule (FR-CBTX-10 `ended`, FR-CBTX-22 `undone`). */
export const ConcentrationCardResolution = z.union([
  z.strictObject({ total: z.int(), dc: z.int(), success: z.boolean() }),
  z.strictObject({ outcome: z.enum(["ended", "undone"]) }),
]);
export type ConcentrationCardResolution = z.infer<typeof ConcentrationCardResolution>;
export const CONCENTRATION_ACTION = "Roll save";
