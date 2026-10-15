// combat-tracker boundary schemas (CBT §8, §9; protocol §20–§23). zod is the source of truth for
// the wire records, intents, REST bodies and the damage card's payload / resolution.
import { DeathCounters, TempHp } from "@shared/combat-extras/schemas";
import { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
import { Ability } from "@shared/entities/schemas";
import { DamageMultiplier } from "@shared/events/combat-tracker";
import { z } from "zod";

export { DamageMultiplier };

export const ENCOUNTER_TYPE = "encounter";
export const ENCOUNTER_ENTRY_TYPE = "encounter-entry";
export const COMBATANT_TYPE = "combatant";
export const HP_CHANGE_TYPE = "hp-change";
export const DAMAGE_CARD_KIND = "damage-card";
export const LOG_KIND_ATTACK = "cbt.attack";
export const LOG_KIND_HP = "cbt.hp";

/** FR-CBT-01 limits. */
export const ENCOUNTER_NAME_MAX = 60;
export const ENTRIES_MAX = 20;
export const QUANTITY_MAX = 20;
export const MONSTERS_MAX = 50;
export const OPEN_ENCOUNTERS_MAX = 30;
/** Snapshot windows (I22, I26). */
export const ENCOUNTER_WINDOW = 20;
export const HP_CHANGE_WINDOW = 50;
export const INITIATIVE_MIN = -10;
export const INITIATIVE_MAX = 50;
/** FR-CBT-39: `movedFt` cap. */
export const MOVED_FT_MAX = 9999;

/** WS intents (CBT §9). */
export const CBT_INTENTS = {
  start: "cbt.start",
  end: "cbt.end",
  rollInitiative: "cbt.rollInitiative",
  setInitiative: "cbt.setInitiative",
  nextTurn: "cbt.nextTurn",
  prevTurn: "cbt.prevTurn",
  setRemoved: "cbt.setRemoved",
  attack: "cbt.attack",
  applyCard: "cbt.applyCard",
  applyHp: "cbt.applyHp",
  undo: "cbt.undo",
  rollAbility: "cbt.rollAbility",
} as const;

const Id = z.string().min(1).max(64);

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the rule (FR-CBT-01)
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** FR-CBT-01: trimmed, 1–60 chars, no control chars. */
export const EncounterName = z
  .string()
  .max(400)
  .refine((s) => !CONTROL.test(s), { message: "Name must not contain control characters" })
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, { message: "Name is required" })
  .refine((s) => [...s].length <= ENCOUNTER_NAME_MAX, {
    message: `Name must be at most ${ENCOUNTER_NAME_MAX} characters`,
  });

/** FR-CBT-62: a monster's HP at Start / add. `average` = stat block `hpMax`; `rolled` = `hpFormula`. */
export const HP_MODES = ["average", "rolled"] as const;
export const HpMode = z.enum(HP_MODES);
export type HpMode = z.infer<typeof HpMode>;

export const EncounterEntryInput = z.strictObject({
  definitionId: Id,
  quantity: z.int().min(1).max(QUANTITY_MAX),
  /** FR-CBT-62: omitted = `average`. */
  hpMode: HpMode.optional(),
});

/** POST / PUT `/api/encounters` (whole replace). */
export const EncounterBody = z.strictObject({
  name: EncounterName,
  partyCharacterIds: z.array(Id).max(50).nullable(),
  entries: z
    .array(EncounterEntryInput)
    .max(ENTRIES_MAX)
    .refine((es) => es.reduce((n, e) => n + e.quantity, 0) <= MONSTERS_MAX, {
      message: `At most ${MONSTERS_MAX} creatures`,
    }),
  /** FR-CBT-62: builder options; omitted = true. */
  createTokens: z.boolean().optional(),
  addHidden: z.boolean().optional(),
});
export type EncounterBody = z.input<typeof EncounterBody>;

// ---------- wire records ----------

export const ENCOUNTER_STATUSES = ["planned", "started", "ended"] as const;
export const EncounterStatus = z.enum(ENCOUNTER_STATUSES);
export type EncounterStatus = z.infer<typeof EncounterStatus>;

export const EncounterRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  seq: z.int(),
  name: z.string(),
  status: EncounterStatus,
  sceneId: z.string().nullable(),
  partyCharacterIds: z.array(z.string()).nullable(),
  round: z.int(),
  turnCombatantId: z.string().nullable(),
  playerTurnCombatantId: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** FR-CBT-62 (DM only, never in the player view). */
  createTokens: z.boolean(),
  addHidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EncounterRecord = z.infer<typeof EncounterRecord>;

/** What a player receives of the started encounter (FR-CBT-31). */
export const PlayerEncounterRecord = EncounterRecord.pick({
  id: true,
  status: true,
  round: true,
  playerTurnCombatantId: true,
});
export type PlayerEncounterRecord = z.infer<typeof PlayerEncounterRecord>;
export type EncounterView = PlayerEncounterRecord & Partial<EncounterRecord>;

/** Full row plus the encounter's `campaignId` (scope gate; the table has no such column). */
export const EncounterEntryRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  encounterId: z.string(),
  seq: z.int(),
  definitionId: z.string(),
  quantity: z.int(),
  hpMode: HpMode,
});
export type EncounterEntryRecord = z.infer<typeof EncounterEntryRecord>;

export const CombatantKind = z.enum(["pc", "monster"]);
export type CombatantKind = z.infer<typeof CombatantKind>;

export const CombatantRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  encounterId: z.string(),
  seq: z.int(),
  kind: CombatantKind,
  entityId: z.string(),
  tokenId: z.string().nullable(),
  name: z.string(),
  imageAssetId: z.string().nullable(),
  hidden: z.boolean(),
  active: z.boolean(),
  removed: z.boolean(),
  initiative: z.int().nullable(),
  initRollId: z.string().nullable(),
  position: z.int(),
  playerPosition: z.int().nullable(),
  hpCurrent: z.int().nullable(),
  hpMax: z.int().nullable(),
  /** Movement used this turn, ft (FR-CBT-39). */
  movedFt: z.int().min(0).max(MOVED_FT_MAX),
  /** Monsters' temp HP (FR-CBTX-14). DM only: no player view below carries it (FR-CBTX-32). */
  tempHp: TempHp,
});
export type CombatantRecord = z.infer<typeof CombatantRecord>;

export const HealthBand = z.enum(["healthy", "bloodied", "down"]);
export type HealthBand = z.infer<typeof HealthBand>;

const movedFt = z.int().min(0).max(MOVED_FT_MAX);

/** Player view of a visible PC combatant (FR-CBT-27). */
export const PlayerPcCombatant = z.object({
  id: z.string(),
  encounterId: z.string(),
  kind: z.literal("pc"),
  entityId: z.string(),
  tokenId: z.string().nullable(),
  name: z.string(),
  imageAssetId: z.string().nullable(),
  playerPosition: z.int().nullable(),
  initiative: z.int().nullable(),
  removed: z.literal(false),
  movedFt,
});
/** Player view of a visible monster combatant: band, never HP numbers (FR-CBT-26). */
export const PlayerMonsterCombatant = z.object({
  id: z.string(),
  encounterId: z.string(),
  kind: z.literal("monster"),
  tokenId: z.string().nullable(),
  name: z.string(),
  imageAssetId: z.string().nullable(),
  playerPosition: z.int().nullable(),
  band: HealthBand,
  removed: z.literal(false),
  movedFt,
});
/** Player view of an active, removed, non-hidden combatant: no rank, band or initiative (FR-CBT-37). */
export const PlayerRemovedCombatant = z.object({
  id: z.string(),
  encounterId: z.string(),
  kind: CombatantKind,
  tokenId: z.string().nullable(),
  name: z.string(),
  imageAssetId: z.string().nullable(),
  removed: z.literal(true),
  movedFt,
});
export type PlayerCombatant =
  | z.infer<typeof PlayerPcCombatant>
  | z.infer<typeof PlayerMonsterCombatant>
  | z.infer<typeof PlayerRemovedCombatant>;
/** A combatant as either client holds it. */
export type CombatantView = PlayerCombatant & Partial<CombatantRecord> & { band?: HealthBand };

export const HpChangeRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  encounterId: z.string(),
  seq: z.int(),
  at: z.string(),
  kind: z.enum(["damage", "heal"]),
  source: z.enum(["card", "direct"]),
  cardId: z.string().nullable(),
  rollIds: z.array(z.string()),
  attackerId: z.string().nullable(),
  attackerName: z.string().nullable(),
  attackName: z.string().nullable(),
  damageType: z.string().nullable(),
  targetId: z.string(),
  targetEntityId: z.string(),
  targetName: z.string(),
  targetAc: z.int(),
  toHitRolled: z.int().nullable(),
  toHitTotal: z.int().nullable(),
  natural: z.int().nullable(),
  hitComputed: z.boolean().nullable(),
  hit: z.boolean().nullable(),
  damageRolled: z.int().nullable(),
  damageTotal: z.int(),
  multiplier: DamageMultiplier.nullable(),
  raw: z.int(),
  applied: z.int(),
  overkill: z.int(),
  hpBefore: z.int(),
  hpAfter: z.int(),
  /** combat-extras (FR-CBTX-21): temp HP around the change, death counters (null = unchanged). */
  tempBefore: z.int(),
  tempAfter: z.int(),
  deathBefore: DeathCounters.nullable(),
  deathAfter: DeathCounters.nullable(),
  /** `cbtx-concentration` cards this change created. */
  noteIds: z.array(z.string()),
  entryId: z.string(),
  undone: z.boolean(),
  undoneAt: z.string().nullable(),
});
export type HpChangeRecord = z.infer<typeof HpChangeRecord>;

// ---------- damage card (notification kind `damage-card`, CBT §8) ----------

/** Per-die `[value, kept]`; value null for a manual total of several dice (#140). */
export const CardDie = z.tuple([z.int().nullable(), z.boolean()]);
export const CardRoll = z.strictObject({
  rollId: z.string(),
  dice: z.array(CardDie).max(51),
  constant: z.int(),
  total: z.int(),
  manual: z.boolean(),
});
export const DamageCardPayload = z.strictObject({
  encounterId: z.string(),
  attackerId: z.string(),
  attackerName: z.string(),
  attackName: z.string(),
  damageType: z.string().nullable(),
  mode: RollMode,
  crit: z.boolean(),
  toHit: CardRoll.extend({ natural: z.int().nullable() }),
  damage: CardRoll,
});
export type DamageCardPayload = z.infer<typeof DamageCardPayload>;

/** One target's outcome, seen by the rolling player (#138): no DM-only ids. */
export const DamageCardTargetOutcome = z.strictObject({
  targetName: z.string().nullable(),
  hit: z.boolean(),
  multiplier: DamageMultiplier,
  applied: z.int(),
});
export type DamageCardTargetOutcome = z.infer<typeof DamageCardTargetOutcome>;

/** FR-CBT-34: one apply resolves for 1–20 targets, apply order. */
export const APPLY_TARGETS_MAX = 20;

/** Resolution: one part per target, apply order (FR-CBT-34, FR-CBT-42). Over 256 B: cap below. */
export const DamageCardTargetsResolution = z.strictObject({
  targets: z.array(DamageCardTargetOutcome).min(1).max(APPLY_TARGETS_MAX),
});
export type DamageCardTargetsResolution = z.infer<typeof DamageCardTargetsResolution>;

/** Per-kind resolution cap the `damage-card` kind declares (FR-NOTE-03, OQ-CBT-39, #157). */
export const DAMAGE_CARD_RESOLUTION_MAX_BYTES = 8192;

/** Readers: either stored shape → `{targets}` (legacy single-target rows from before = one part). */
export const DamageCardResolutionRead = z.union([
  DamageCardTargetsResolution,
  DamageCardTargetOutcome.transform((t): DamageCardTargetsResolution => ({ targets: [t] })),
]);

// ---------- intents ----------

export const StartInput = z.strictObject({ encounterId: Id, sceneId: Id });
export const EndInput = z.strictObject({ encounterId: Id });
export const RollInitiativeInput = z.strictObject({
  combatantIds: z.array(Id).min(1).max(50),
  mode: RollMode.default("normal"),
  manual: ManualEntry.optional(),
  public: z.boolean().optional(),
});
export type RollInitiativeInput = z.input<typeof RollInitiativeInput>;
export const SetInitiativeInput = z.strictObject({
  combatantId: Id,
  value: z.int().min(INITIATIVE_MIN).max(INITIATIVE_MAX),
});
export const TurnInput = z.strictObject({
  encounterId: Id,
  expectedRound: z.int().min(0),
  expectedTurnId: Id.nullable(),
});
export type TurnInput = z.input<typeof TurnInput>;
export const SetRemovedInput = z.strictObject({ combatantId: Id, removed: z.boolean() });
export const AttackInput = z
  .strictObject({
    attackerId: Id,
    mode: RollMode.default("normal"),
    /** FR-CBT-17: two entries, to-hit first. */
    manual: z.array(ManualEntry).length(2).optional(),
    /** FR-CHARX-24 (OQ-CBT-47): one attack row; absent (and no `spellId`) = the first attack. */
    attackId: Id.optional(),
    /** FR-CHARX-24: a sheet spell with `roll: attack` and damage. */
    spellId: Id.optional(),
  })
  .refine((v) => v.attackId === undefined || v.spellId === undefined, {
    path: ["spellId"],
    message: "Either an attack or a spell",
  });
export type AttackInput = z.input<typeof AttackInput>;
export const AttackResult = z.object({ cardId: z.string(), rollIds: z.array(z.string()) });
export type AttackResult = z.infer<typeof AttackResult>;
export const ApplyCardTarget = z.strictObject({
  targetId: Id,
  hit: z.boolean(),
  multiplier: DamageMultiplier,
});
export type ApplyCardTarget = z.infer<typeof ApplyCardTarget>;

/** `cbt.applyCard` (FR-CBT-34): 1–20 unique targets, all or nothing. */
export const ApplyCardTargetsInput = z.strictObject({
  cardId: Id,
  toHitTotal: z.int().min(-20).max(99),
  damageTotal: z.int().min(0).max(999),
  targets: z
    .array(ApplyCardTarget)
    .min(1)
    .max(APPLY_TARGETS_MAX)
    .refine((ts) => new Set(ts.map((t) => t.targetId)).size === ts.length, {
      message: "Each target at most once",
    }),
  public: z.boolean().optional(),
});
export type ApplyCardTargetsInput = z.input<typeof ApplyCardTargetsInput>;
export const ApplyHpInput = z.strictObject({
  combatantId: Id,
  kind: z.enum(["damage", "heal"]),
  amount: z.int().min(1).max(999),
  public: z.boolean().optional(),
});
export type ApplyHpInput = z.input<typeof ApplyHpInput>;
export const UndoInput = z.strictObject({ expectedHpChangeId: Id });
/** Result of `cbt.applyHp`. */
export const HpChangeResult = z.object({ hpChangeId: z.string() });
export type HpChangeResult = z.infer<typeof HpChangeResult>;
/** Result of `cbt.applyCard` (apply order) and `cbt.undo` (latest first). */
export const HpChangesResult = z.object({ hpChangeIds: z.array(z.string()).min(1) });
export type HpChangesResult = z.infer<typeof HpChangesResult>;
/**
 * combat-extras: names of effects a restore skipped because the slot is taken (FR-CBTX-07,
 * FR-CBTX-22); the DM client toasts them. Absent = none.
 */
const NotRestored = z.array(z.string()).default([]);
/** Result of `cbt.undo` (FR-CBT-35, FR-CBTX-22). */
export const UndoResult = HpChangesResult.extend({ notRestored: NotRestored });
export type UndoResult = z.input<typeof UndoResult>;
/** Result of `cbt.nextTurn` / `cbt.prevTurn` (FR-CBTX-07); Next never fills it. */
export const TurnResult = z.object({ notRestored: NotRestored });
export type TurnResult = z.input<typeof TurnResult>;
export const RollIdsResult = z.object({ rollIds: z.array(z.string()) });

/** `cbt.rollAbility` (FR-CBT-44): a combatant's check or save, DM only. */
export const RollAbilityInput = z.strictObject({
  combatantId: Id,
  kind: z.enum(["check", "save"]),
  ability: Ability,
  mode: RollMode.default("normal"),
  manual: ManualEntry.optional(),
  public: z.boolean().optional(),
});
export type RollAbilityInput = z.input<typeof RollAbilityInput>;
export const RollAbilityResult = z.object({ rollIds: z.array(z.string()), entryId: z.string() });
export type RollAbilityResult = z.infer<typeof RollAbilityResult>;
