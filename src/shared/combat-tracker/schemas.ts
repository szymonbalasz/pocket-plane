// combat-tracker boundary schemas (CBT §8, §9; protocol §20–§23). zod is the source of truth for
// the wire records, intents, REST bodies and the damage card's payload / resolution.
import { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
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

export const EncounterEntryInput = z.strictObject({
  definitionId: Id,
  quantity: z.int().min(1).max(QUANTITY_MAX),
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
});
export type CombatantRecord = z.infer<typeof CombatantRecord>;

export const HealthBand = z.enum(["healthy", "bloodied", "down"]);
export type HealthBand = z.infer<typeof HealthBand>;

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
});
export type PlayerCombatant =
  | z.infer<typeof PlayerPcCombatant>
  | z.infer<typeof PlayerMonsterCombatant>;
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

/** Seen by the rolling player (#138): no DM-only ids. */
export const DamageCardResolution = z.strictObject({
  targetName: z.string().nullable(),
  hit: z.boolean(),
  multiplier: DamageMultiplier,
  applied: z.int(),
});
export type DamageCardResolution = z.infer<typeof DamageCardResolution>;

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
export const AttackInput = z.strictObject({
  attackerId: Id,
  mode: RollMode.default("normal"),
  /** FR-CBT-17: two entries, to-hit first. */
  manual: z.array(ManualEntry).length(2).optional(),
});
export type AttackInput = z.input<typeof AttackInput>;
export const AttackResult = z.object({ cardId: z.string(), rollIds: z.array(z.string()) });
export type AttackResult = z.infer<typeof AttackResult>;
export const ApplyCardInput = z.strictObject({
  cardId: Id,
  targetId: Id,
  toHitTotal: z.int().min(-20).max(99),
  hit: z.boolean(),
  damageTotal: z.int().min(0).max(999),
  multiplier: DamageMultiplier,
  public: z.boolean().optional(),
});
export type ApplyCardInput = z.input<typeof ApplyCardInput>;
export const ApplyHpInput = z.strictObject({
  combatantId: Id,
  kind: z.enum(["damage", "heal"]),
  amount: z.int().min(1).max(999),
  public: z.boolean().optional(),
});
export type ApplyHpInput = z.input<typeof ApplyHpInput>;
export const UndoInput = z.strictObject({ expectedHpChangeId: Id });
export const HpChangeResult = z.object({ hpChangeId: z.string() });
export type HpChangeResult = z.infer<typeof HpChangeResult>;
export const RollIdsResult = z.object({ rollIds: z.array(z.string()) });
