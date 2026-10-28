// combat-extras boundary schemas (CBTX §8, §9; protocol §32): the `effect` wire record, its
// player redaction, play-state limits and the shapes CBTX's domain events carry. Intents and
// notification payloads come with the CBTX build.
import {
  BUILTIN_PRESET_KEYS,
  Modifiers,
  PRESET_KEY_MAX,
  playerPresetKey,
} from "@shared/effect-modifiers/schemas";
import { FxRecord } from "@shared/spell-fx/fx";
import { z } from "zod";
import { Condition, ExhaustionLevel } from "./conditions";

export const EFFECT_TYPE = "effect";
/** Notification kind of a concentration card (FR-CBTX-17). */
export const CONCENTRATION_CARD_KIND = "cbtx-concentration";

/** FR-CBTX-03 / -04 / -05 / -14 / -19 limits. */
export const EFFECT_LABEL_MAX = 40;
export const DURATION_ROUNDS_MAX = 100;
export const EFFECT_TARGETS_MAX = 20;
export const EFFECTS_PER_TARGET_MAX = 20;
export const EFFECTS_PER_CAMPAIGN_MAX = 300;
export const TEMP_HP_MAX = 999;
export const DEATH_SAVES_MAX = 3;

export const EFFECT_KINDS = ["condition", "custom", "concentration"] as const;
export const EffectKind = z.enum(EFFECT_KINDS);
export type EffectKind = z.infer<typeof EffectKind>;

/** Why an effect ended (data model §21); null = active. Soft end: Prev and undo restore. */
export const EFFECT_ENDED_REASONS = [
  "removed",
  "expired",
  "replaced",
  "concentration",
  "incapacitated",
  "save-failed",
  "down",
  "encounter-ended",
] as const;
export const EffectEndedReason = z.enum(EFFECT_ENDED_REASONS);
export type EffectEndedReason = z.infer<typeof EffectEndedReason>;

export const TempHp = z.int().min(0).max(TEMP_HP_MAX);
export const DeathSaveCount = z.int().min(0).max(DEATH_SAVES_MAX);

/** Death-save counters (FR-CBTX-19); `hp_change.deathBefore` / `deathAfter` (FR-CBTX-21). */
export const DeathCounters = z.strictObject({
  successes: DeathSaveCount,
  failures: DeathSaveCount,
});
export type DeathCounters = z.infer<typeof DeathCounters>;

const Id = z.string();

/** `effect` row = DM view (FR-CBTX-03, data model §21). */
export const EffectRecordShape = z.object({
  id: Id,
  campaignId: Id,
  seq: z.int(),
  kind: EffectKind,
  /** Kind `condition` only. */
  condition: Condition.nullable(),
  /** Exhaustion only, 1–6. */
  level: ExhaustionLevel.nullable(),
  /** Kinds `custom` / `concentration`: 1–40 chars. */
  label: z.string().min(1).max(EFFECT_LABEL_MAX).nullable(),
  /** Exactly one target: a monster's combatant or a PC's character. */
  targetCombatantId: Id.nullable(),
  targetCharacterId: Id.nullable(),
  /** Copies at the time. */
  encounterId: Id.nullable(),
  sourceCombatantId: Id.nullable(),
  sourceName: z.string().nullable(),
  /** Linked effects end with this concentration (FR-CBTX-10). */
  concentrationId: Id.nullable(),
  durationRounds: z.int().min(1).max(DURATION_ROUNDS_MAX).nullable(),
  /** FR-CBTX-05: ends at the start of the anchor's turn in this round. */
  endsRound: z.int().nullable(),
  anchorCombatantId: Id.nullable(),
  secret: z.boolean(),
  /** Copy of the target's bound combatant `hidden` (FR-CBTX-13). */
  hidden: z.boolean(),
  endedAt: z.string().nullable(),
  endedReason: EffectEndedReason.nullable(),
  endedRound: z.int().nullable(),
  endedTurnId: Id.nullable(),
  endedByHpChangeId: Id.nullable(),
  /** effect-modifiers (FR-MOD-03): `custom` effects only; copied from a preset or set by the DM. */
  modifiers: Modifiers,
  /** Built-in preset key or preset id it was applied from (FR-MOD-09); `custom` only. */
  presetKey: z.string().min(1).max(PRESET_KEY_MAX).nullable(),
  /** spell-fx (FR-VFX-03, ADR-0071): the map effect drawn while the effect is active, or null. */
  fx: FxRecord.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const EffectRecord = EffectRecordShape.superRefine((r, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((r.targetCombatantId === null) === (r.targetCharacterId === null)) {
    issue("Exactly one target");
  }
  if ((r.kind === "condition") !== (r.condition !== null)) issue("Condition iff kind condition");
  if ((r.level !== null) !== (r.condition === "exhaustion")) issue("Level iff exhaustion");
  if ((r.kind === "condition") === (r.label !== null)) issue("Label iff custom / concentration");
  if ((r.endedAt === null) !== (r.endedReason === null)) issue("Ended at iff ended reason");
  if (r.kind !== "custom" && (r.modifiers.length > 0 || r.presetKey !== null)) {
    issue("Modifiers and preset key on custom effects only");
  }
});
export type EffectRecord = z.infer<typeof EffectRecordShape>;

/**
 * What a player receives (FR-CBTX-31): no source, anchor or concentration link (they may name
 * hidden creatures), no secret / hidden flags or end facts; the map effect `fx` (VFX §8). FR-MOD-21: `modifiers` and
 * `presetKey` only on PC effects (`targetCharacterId` set), `presetKey` built-in keys only.
 */
export const PlayerEffectRecord = EffectRecordShape.pick({
  id: true,
  kind: true,
  condition: true,
  level: true,
  label: true,
  targetCombatantId: true,
  targetCharacterId: true,
  encounterId: true,
  endsRound: true,
}).extend({
  /** spell-fx (VFX §8): always sent by `redactEffect`; absent = none (older test records). */
  fx: FxRecord.nullable().optional(),
  modifiers: Modifiers.optional(),
  presetKey: z.enum(BUILTIN_PRESET_KEYS).nullable().optional(),
});
export type PlayerEffectRecord = z.infer<typeof PlayerEffectRecord>;
/** An effect as either client holds it (the DM's `presetKey` may be a preset id). */
export type EffectView = Omit<PlayerEffectRecord, "presetKey"> & Partial<EffectRecord>;

/** FR-CBTX-31: players never receive secret, hidden or ended effects. */
export const effectVisibleToPlayers = (r: EffectRecord): boolean =>
  !r.secret && !r.hidden && r.endedAt === null;

export function redactEffect(r: EffectRecord): PlayerEffectRecord {
  const out: PlayerEffectRecord = {
    id: r.id,
    kind: r.kind,
    condition: r.condition,
    level: r.level,
    label: r.label,
    targetCombatantId: r.targetCombatantId,
    targetCharacterId: r.targetCharacterId,
    encounterId: r.encounterId,
    endsRound: r.endsRound,
    // spell-fx (VFX §8): `fx` rides the effect's rule; every receiver gets it.
    fx: r.fx,
  };
  // FR-MOD-21 (OQ-MOD-06): PC effects carry modifiers to every player who receives them; no
  // preset id ever reaches a player; monster effects carry neither key.
  if (r.targetCharacterId === null) return out;
  return { ...out, modifiers: r.modifiers, presetKey: playerPresetKey(r.presetKey) };
}
