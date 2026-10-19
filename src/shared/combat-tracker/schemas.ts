// combat-tracker boundary schemas (CBT §8, §9; protocol §20–§23). zod is the source of truth for
// the wire records, intents, REST bodies and the damage card's payload / resolution.
import { DeathCounters, TempHp } from "@shared/combat-extras/schemas";
import {
  checkManualParts,
  ManualEntry,
  ManualParts,
  ManualPartsPerRoll,
  RollMode,
  RollModPart,
} from "@shared/dice-roll-log/schemas";
import { PartDamageType } from "@shared/effect-modifiers/schemas";
import { Ability, EXTRA_DAMAGE_MAX } from "@shared/entities/schemas";
import { DamageMultiplier } from "@shared/events/combat-tracker";
import { CellIndex } from "@shared/scenes-map/schemas";
import { z } from "zod";

export { DamageMultiplier };

export const ENCOUNTER_TYPE = "encounter";
export const ENCOUNTER_ENTRY_TYPE = "encounter-entry";
export const COMBATANT_TYPE = "combatant";
export const HP_CHANGE_TYPE = "hp-change";
/** Sprint 5 (FR-CBT-88, ADR-0053): the DM-only hit ruling of a pending card. */
export const HIT_RULING_TYPE = "hit-ruling";
export const DAMAGE_CARD_KIND = "damage-card";
export const LOG_KIND_ATTACK = "cbt.attack";
export const LOG_KIND_HP = "cbt.hp";
/** Sprint 5 (#252, FR-CBT-99): "Goblin 2 is now an ally". */
export const LOG_KIND_SIDE = "cbt.side";

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
  /** FR-CBT-71 (sprint 2, N7): completes a to-hit-only card or makes a damage-only one. */
  rollDamage: "cbt.rollDamage",
  applyCard: "cbt.applyCard",
  applyHp: "cbt.applyHp",
  undo: "cbt.undo",
  rollAbility: "cbt.rollAbility",
  /** FR-CBT-88 (sprint 5, ADR-0053): rule the hit before the damage exists. */
  applyHit: "cbt.applyHit",
  /** FR-CBT-99 (sprint 5, #252): a combatant's side, secret or not. */
  setSide: "cbt.setSide",
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

/**
 * FR-CBT-98 (#252): `ally` = the party's, `enemy` = against it. Combatant `side` / `publicSide`
 * null = the kind's default (`sideOf`, `publicSideOf` in `./rules`).
 */
export const SIDES = ["ally", "enemy"] as const;
export const Side = z.enum(SIDES);
export type Side = z.infer<typeof Side>;

export const EncounterEntryInput = z.strictObject({
  definitionId: Id,
  quantity: z.int().min(1).max(QUANTITY_MAX),
  /** FR-CBT-62: omitted = `average`. */
  hpMode: HpMode.optional(),
  /** FR-CBT-98 (#252): the builder's "Friendly" (`ally`); omitted = `enemy`. */
  side: Side.optional(),
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
  /** FR-CBT-98 (#252): Start copies it onto each instance; difficulty counts enemies only. */
  side: Side,
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
  /**
   * FR-CBT-98 (#252): the true side and the side players were last openly shown; null = the
   * kind's default. DM only: players get `side = publicSideOf` (FR-CBT-100).
   */
  side: Side.nullable(),
  publicSide: Side.nullable(),
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
  /** FR-CBT-100 (#252): `publicSideOf`; the true side never reaches players. */
  side: Side,
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
  side: Side,
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
  side: Side,
});
export type PlayerCombatant =
  | z.infer<typeof PlayerPcCombatant>
  | z.infer<typeof PlayerMonsterCombatant>
  | z.infer<typeof PlayerRemovedCombatant>;
/** A combatant as either client holds it. */
export type CombatantView = PlayerCombatant & Partial<CombatantRecord> & { band?: HealthBand };

/** effect-modifiers (FR-MOD-19, -37): offered rule-trigger parts per damage roll / card / apply. */
export const TRIGGER_PARTS_MAX = 4;
/** MOD §8.2 text limits of an offered part. */
export const TRIGGER_LABEL_MAX = 40;
export const TRIGGER_EXPRESSION_MAX = 20;
export const TRIGGER_ASK_MAX = 60;

/**
 * FR-MOD-38, -48: a rule-trigger part an apply landed on the target (hp_change `triggerParts`,
 * DM only): `value` = damage after `multiplier`, `forced` = the DM forced a used charge.
 */
export const HpTriggerPart = z.strictObject({
  triggerId: Id,
  name: z.string().min(1).max(TRIGGER_LABEL_MAX),
  value: z.int().min(0),
  multiplier: DamageMultiplier,
  type: PartDamageType.nullable(),
  forced: z.boolean(),
});
export type HpTriggerPart = z.infer<typeof HpTriggerPart>;

/**
 * FR-CBT-84 (sprint 4): one extra weapon damage part an apply landed (hp_change `damageParts`,
 * DM only, stats): `rolled` = its dice + constant, `total` = the DM's value (= rolled unless
 * set), `raw` = floor(total × multiplier). The base part keeps the row's own damage columns.
 */
export const HpDamagePart = z.strictObject({
  type: PartDamageType,
  rolled: z.int().min(0),
  total: z.int().min(0).max(999),
  multiplier: DamageMultiplier,
  raw: z.int().min(0),
});
export type HpDamagePart = z.infer<typeof HpDamagePart>;

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
  /** effect-modifiers (FR-MOD-38, -48): rule-trigger parts this apply landed (DM, stats). */
  triggerParts: z.array(HpTriggerPart).max(TRIGGER_PARTS_MAX),
  /** FR-CBT-84 (sprint 4): extra weapon damage parts; null = none (every older row). */
  damageParts: z.array(HpDamagePart).min(1).max(EXTRA_DAMAGE_MAX).nullable(),
  entryId: z.string(),
  undone: z.boolean(),
  undoneAt: z.string().nullable(),
});
export type HpChangeRecord = z.infer<typeof HpChangeRecord>;

// ---------- damage card (notification kind `damage-card`, CBT §8) ----------

/**
 * effect-modifiers (MOD §12): parts per card roll, so a worst-case card (50 dice, max names,
 * 2 × 6 parts at max label length) stays within the kind's 4 KB payload cap.
 */
export const CARD_MODS_MAX = 6;

/** Per-die `[value, kept]`; value null for a manual total of several dice (#140). */
export const CardDie = z.tuple([z.int().nullable(), z.boolean()]);
export const CardRoll = z.strictObject({
  rollId: z.string(),
  dice: z.array(CardDie).max(51),
  constant: z.int(),
  total: z.int(),
  manual: z.boolean(),
  /**
   * effect-modifiers (FR-MOD-19): roll-hook parts of this roll, player-safe labels (null =
   * "(DM)"); `total` includes them. Absent = none (rows from before parse unchanged).
   */
  mods: z.array(RollModPart).min(1).max(CARD_MODS_MAX).optional(),
});
export const CardToHit = CardRoll.extend({ natural: z.int().nullable() });
export type CardToHit = z.infer<typeof CardToHit>;
export type CardRoll = z.infer<typeof CardRoll>;

/**
 * FR-MOD-19, -37: one offered rule-trigger part on the card's damage (rolled with it, **not** in
 * `total`; lands per target at apply). The card's audience is the owner or the DM, so `label` is
 * the trigger's name. Settle facts for the DM popup (FR-MOD-39), frozen at the roll: `marked` =
 * the `targetMarked` preset (a built-in key, or a campaign mark's **name**: a player's card never
 * carries a preset id, R7), `hurt` = a `targetHurt` filter, `ask` = the first `ask`
 * note, `untick` = soft filters and none of the non-`ask` ones held at the roll.
 */
export const CardTriggerPart = z.strictObject({
  triggerId: Id,
  label: z.string().min(1).max(TRIGGER_LABEL_MAX),
  value: z.int(),
  expression: z.string().min(1).max(TRIGGER_EXPRESSION_MAX),
  rollId: Id,
  /** null = the attack's type. */
  type: PartDamageType.nullable(),
  auto: z.literal(true).optional(),
  ask: z.string().min(1).max(TRIGGER_ASK_MAX).optional(),
  marked: z.string().min(1).max(TRIGGER_LABEL_MAX).optional(),
  hurt: z.literal(true).optional(),
  untick: z.literal(true).optional(),
});
export type CardTriggerPart = z.infer<typeof CardTriggerPart>;

/** FR-CBT-83: an extra part's dice per roll: 6 (FR-CHARX-54), doubled on a crit. */
export const CARD_EXTRA_DICE_MAX = 12;

/**
 * FR-CBT-81 (sprint 4): one extra weapon damage part of the card's damage, its own roll row in
 * the same entry, typed, in attack-row order. Not in the base part's `total` (summed per target
 * at apply with its own multiplier, FR-CBT-82).
 */
export const CardExtraPart = z.strictObject({
  type: PartDamageType,
  rollId: Id,
  dice: z.array(CardDie).max(CARD_EXTRA_DICE_MAX),
  constant: z.int(),
  total: z.int(),
  manual: z.boolean(),
});
export type CardExtraPart = z.infer<typeof CardExtraPart>;

/**
 * The card's damage roll (the base part: `damage` + `bonus`, typed `damageType`, effect mods
 * attached): + offered trigger parts and the extra weapon parts (absent = none; old cards parse).
 */
export const CardDamage = CardRoll.extend({
  triggers: z.array(CardTriggerPart).min(1).max(TRIGGER_PARTS_MAX).optional(),
  extra: z.array(CardExtraPart).min(1).max(EXTRA_DAMAGE_MAX).optional(),
});
export type CardDamage = z.infer<typeof CardDamage>;

/** A save spell's DC on a damage-only card ("— DC 13 DEX", FR-CBT-71). */
export const CardSaveDc = z.strictObject({ dc: z.int().min(1).max(30), ability: Ability });

/** FR-CBT-92 (sprint 5): a card keeps the owner's last 3 unused damage rolls (oldest dropped). */
export const UNUSED_ROLLS_MAX = 3;
export const CardUnusedRoll = z.strictObject({ rollId: Id, total: z.int() });
export type CardUnusedRoll = z.infer<typeof CardUnusedRoll>;

/**
 * Card payload. Sprint 2 (FR-CBT-70/71, ADR-0037): `toHit` and `damage` each nullable, never both
 * (to-hit-only card from `cbt.attack {rolls: "toHit"}`, completed or damage-only from
 * `cbt.rollDamage`); `attackId` / `spellId` = the sheet row Damage completes; `saveDc` on save
 * spells. Rows stored before parse unchanged.
 */
export const DamageCardPayload = z
  .strictObject({
    encounterId: z.string(),
    attackerId: z.string(),
    attackerName: z.string(),
    attackName: z.string(),
    damageType: z.string().nullable(),
    mode: RollMode,
    crit: z.boolean(),
    toHit: CardToHit.nullable(),
    damage: CardDamage.nullable(),
    attackId: z.string().optional(),
    spellId: z.string().optional(),
    saveDc: CardSaveDc.optional(),
    /** FR-CBT-92 (sprint 5): the owner's later damage rolls, not used ("Also rolled: 9"). */
    unusedRolls: z.array(CardUnusedRoll).min(1).max(UNUSED_ROLLS_MAX).optional(),
  })
  .refine((p) => p.toHit !== null || p.damage !== null, {
    path: ["damage"],
    message: "A card needs a to-hit or a damage roll",
  });
export type DamageCardPayload = z.infer<typeof DamageCardPayload>;
/** A card with both rolls (`cbt.attack`'s default, or a to-hit-only card once completed). */
export type FullDamageCardPayload = DamageCardPayload & { toHit: CardToHit; damage: CardDamage };
export const isFullCard = (p: DamageCardPayload): p is FullDamageCardPayload =>
  p.toHit !== null && p.damage !== null;
/** Parses a stored payload that must have both rolls; throws on a partial card. */
export function parseFullCard(v: unknown): FullDamageCardPayload {
  const p = DamageCardPayload.parse(v);
  if (!isFullCard(p)) throw new Error("Damage card has no to-hit or no damage roll");
  return p;
}

/** One target's outcome, seen by the rolling player (#138): no DM-only ids. */
export const DamageCardTargetOutcome = z.strictObject({
  targetName: z.string().nullable(),
  hit: z.boolean(),
  multiplier: DamageMultiplier,
  applied: z.int(),
  /** FR-CBT-91 (sprint 5): a ruled hit the DM dropped from the damage step (`applied: 0`). */
  dropped: z.literal(true).optional(),
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

/** A grid cell (`at`, FR-CBT-65): where created tokens go; the server clamps it into the map. */
export const GridCell = z.strictObject({ col: CellIndex, row: CellIndex });
export type GridCell = z.infer<typeof GridCell>;

/**
 * `cbt.start` (FR-CBT-07; sprint 2 FR-CBT-64–66): `at` = the DM's free-area centre cell when it
 * views the encounter's scene; `excludeCharacterIds` = party PCs left out (each a party member).
 */
export const StartInput = z.strictObject({
  encounterId: Id,
  sceneId: Id,
  at: GridCell.optional(),
  excludeCharacterIds: z.array(Id).max(50).optional(),
});
export type StartInput = z.input<typeof StartInput>;
export const EndInput = z.strictObject({ encounterId: Id });
export const RollInitiativeInput = z
  .strictObject({
    combatantIds: z.array(Id).min(1).max(50),
    mode: RollMode.default("normal"),
    manual: ManualEntry.optional(),
    /** FR-MOD-18 (tier 2): physical bonus / trigger die groups (one combatant, with `manual`). */
    manualParts: ManualParts.optional(),
    public: z.boolean().optional(),
  })
  .superRefine(checkManualParts);
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
/** FR-CBT-70: what `cbt.attack` rolls. */
export const AttackRolls = z.enum(["both", "toHit"]);
export type AttackRolls = z.infer<typeof AttackRolls>;
/** FR-CBT-81 (sprint 4): one physical entry per extra damage part; needs `manual`. */
const ManualExtra = z.array(ManualEntry).min(1).max(EXTRA_DAMAGE_MAX);
const checkManualExtra = (v: { manual?: unknown; manualExtra?: unknown }, ctx: z.RefinementCtx) => {
  if (v.manualExtra !== undefined && v.manual === undefined) {
    ctx.addIssue({ code: "custom", path: ["manualExtra"], message: "Physical parts need manual" });
  }
};

export const AttackInput = z
  .strictObject({
    attackerId: Id,
    mode: RollMode.default("normal"),
    /** FR-CBT-17: two entries, to-hit first (one with `rolls: "toHit"`). */
    manual: z.array(ManualEntry).min(1).max(2).optional(),
    /** FR-MOD-18 (tier 2): physical bonus / trigger die groups, one list per `manual` entry. */
    manualParts: ManualPartsPerRoll.optional(),
    /**
     * FR-CBT-81, -83 (sprint 4): physical entries of the row's extra damage parts, row order,
     * with `manual` only; one per extra part (checked in the command; doubled on a crit).
     */
    manualExtra: ManualExtra.optional(),
    /** FR-CHARX-24 (OQ-CBT-47): one attack row; absent (and no `spellId`) = the first attack. */
    attackId: Id.optional(),
    /** FR-CHARX-24: a sheet spell with `roll: attack` and damage. */
    spellId: Id.optional(),
    /**
     * FR-CBT-70 (sprint 2): `toHit` rolls the d20 only (card `damage: null`; `manual` then holds
     * one entry); absent = `both`.
     */
    rolls: AttackRolls.optional(),
  })
  .refine((v) => v.attackId === undefined || v.spellId === undefined, {
    path: ["spellId"],
    message: "Either an attack or a spell",
  })
  .refine((v) => v.manual === undefined || v.manual.length === (v.rolls === "toHit" ? 1 : 2), {
    path: ["manual"],
    message: "One manual entry per roll",
  })
  .refine((v) => v.rolls !== "toHit" || v.manualExtra === undefined, {
    path: ["manualExtra"],
    message: "No damage roll",
  })
  .superRefine(checkManualParts)
  .superRefine(checkManualExtra);
export type AttackInput = z.input<typeof AttackInput>;
export const AttackResult = z.object({ cardId: z.string(), rollIds: z.array(z.string()) });
export type AttackResult = z.infer<typeof AttackResult>;

/**
 * `cbt.rollDamage` (FR-CBT-71, ADR-0037): completes the attacker's latest pending to-hit-only
 * card of the same row, else makes a damage-only card. `manual`: one entry (the implied, doubled
 * on a crit, expression).
 */
export const RollDamageInput = z
  .strictObject({
    attackerId: Id,
    manual: ManualEntry.optional(),
    /** FR-MOD-18 (tier 2): physical bonus / trigger die groups (Divine Fury's d6), with `manual`. */
    manualParts: ManualParts.optional(),
    /**
     * FR-CBT-81, -83 (sprint 4): physical entries of the row's extra damage parts, row order,
     * with `manual` only; one per extra part (checked in the command; doubled on a crit).
     */
    manualExtra: ManualExtra.optional(),
    attackId: Id.optional(),
    spellId: Id.optional(),
  })
  .refine((v) => v.attackId === undefined || v.spellId === undefined, {
    path: ["spellId"],
    message: "Either an attack or a spell",
  })
  .superRefine(checkManualParts)
  .superRefine(checkManualExtra);
export type RollDamageInput = z.input<typeof RollDamageInput>;
/** `attached` = completed an existing card (`NotificationUpdated`), else a new card. */
export const RollDamageResult = z.object({
  cardId: z.string(),
  rollIds: z.array(z.string()),
  attached: z.boolean(),
  /** FR-CBT-92 (sprint 5): kept on the owner's completed card as an unused roll, no new card. */
  unused: z.literal(true).optional(),
});
export type RollDamageResult = z.infer<typeof RollDamageResult>;
/**
 * effect-modifiers (FR-MOD-38, -40): the DM's assignment of one offered part to this target.
 * `value` = the DM's edit (absent = as rolled), `multiplier` = the part's own (absent = the
 * row's), `force` = land it although its charge is used.
 */
export const ApplyTargetTrigger = z.strictObject({
  triggerId: Id,
  value: z.int().min(0).max(999).optional(),
  multiplier: DamageMultiplier.optional(),
  force: z.boolean().optional(),
});
export type ApplyTargetTrigger = z.infer<typeof ApplyTargetTrigger>;

export const ApplyCardTarget = z.strictObject({
  targetId: Id,
  hit: z.boolean(),
  /** The base part's multiplier. */
  multiplier: DamageMultiplier,
  /**
   * FR-CBT-82 (sprint 4): each extra part's own multiplier, card order (absent = `multiplier`);
   * ≤ the card's extra count (`invalid` in the command).
   */
  extraMultipliers: z.array(DamageMultiplier).min(1).max(EXTRA_DAMAGE_MAX).optional(),
  /** FR-MOD-38: offered parts this target takes; only on a Hit row. */
  triggers: z
    .array(ApplyTargetTrigger)
    .min(1)
    .max(TRIGGER_PARTS_MAX)
    .refine((ts) => new Set(ts.map((t) => t.triggerId)).size === ts.length, {
      message: "Each trigger part at most once",
    })
    .optional(),
});
export type ApplyCardTarget = z.infer<typeof ApplyCardTarget>;
/** One target of the apply intent as a client writes it (popup parts merge into it). */
export type ApplyTargetInput = z.input<typeof ApplyCardTarget>;

/**
 * `cbt.applyCard` (FR-CBT-34): 1–20 unique targets, all or nothing. Sprint 2 (FR-CBT-72): the
 * totals are optional on the wire; the server requires `toHitTotal` iff the card has `toHit`, and
 * `damageTotal` unless the card has no damage roll and every target misses (`invalid`).
 */
export const ApplyCardTargetsInput = z.strictObject({
  cardId: Id,
  toHitTotal: z.int().min(-20).max(99).optional(),
  damageTotal: z.int().min(0).max(999).optional(),
  /**
   * FR-CBT-82 (sprint 4): the DM's values of the extra parts, card order (absent = rolled);
   * ≤ the card's extra count (`invalid` in the command).
   */
  extraTotals: z.array(z.int().min(0).max(999)).min(1).max(EXTRA_DAMAGE_MAX).optional(),
  targets: z
    .array(ApplyCardTarget)
    .min(1)
    .max(APPLY_TARGETS_MAX)
    .refine((ts) => new Set(ts.map((t) => t.targetId)).size === ts.length, {
      message: "Each target at most once",
    })
    // FR-MOD-38: an offered part lands on at most one target, and only on a hit.
    .refine((ts) => ts.every((t) => t.hit || !t.triggers), {
      message: "Trigger parts on Hit targets only",
    })
    .refine(
      (ts) => {
        const ids = ts.flatMap((t) => (t.triggers ?? []).map((x) => x.triggerId));
        return new Set(ids).size === ids.length;
      },
      { message: "Each trigger part on at most one target" },
    ),
  public: z.boolean().optional(),
  /**
   * FR-CBT-94 (sprint 5): the card's damage `rollId` the popup was built from (null = none yet);
   * another one on the card → `conflict` "Damage just arrived — check and Apply again". Absent =
   * no check (callers from before sprint 5).
   */
  damageRollId: Id.nullable().optional(),
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
export const RollAbilityInput = z
  .strictObject({
    combatantId: Id,
    kind: z.enum(["check", "save"]),
    ability: Ability,
    mode: RollMode.default("normal"),
    manual: ManualEntry.optional(),
    /** FR-MOD-18 (tier 2): physical bonus / trigger die groups, with `manual`. */
    manualParts: ManualParts.optional(),
    public: z.boolean().optional(),
  })
  .superRefine(checkManualParts);
export type RollAbilityInput = z.input<typeof RollAbilityInput>;
export const RollAbilityResult = z.object({ rollIds: z.array(z.string()), entryId: z.string() });
export type RollAbilityResult = z.infer<typeof RollAbilityResult>;

// ---------- sprint 5: Apply hit (ADR-0053), side (#252) ----------

/** One ruled target, ruling order: Hit / Miss and the base part's multiplier preset. */
export const HitRulingTarget = z.strictObject({
  targetId: Id,
  hit: z.boolean(),
  multiplier: DamageMultiplier,
});
export type HitRulingTarget = z.infer<typeof HitRulingTarget>;

/** `cbt.applyHit` (FR-CBT-88): DM only; 1–20 unique targets, ≥ 1 `hit: true` (the command). */
export const ApplyHitInput = z.strictObject({
  cardId: Id,
  toHitTotal: z.int().min(-20).max(99),
  targets: z
    .array(HitRulingTarget)
    .min(1)
    .max(APPLY_TARGETS_MAX)
    .refine((ts) => new Set(ts.map((t) => t.targetId)).size === ts.length, {
      message: "Each target at most once",
    }),
});
export type ApplyHitInput = z.input<typeof ApplyHitInput>;
export const ApplyHitResult = z.object({ rulingId: z.string() });
export type ApplyHitResult = z.infer<typeof ApplyHitResult>;

/**
 * `hit-ruling` (CBT §8 sprint 5, DM only): one per card, written by `cbt.applyHit`, never edited;
 * `toHitSet` = the DM's total differs from the rolled one (stats, FR-CBT-23).
 */
export const HitRulingRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  encounterId: z.string(),
  cardId: z.string(),
  toHitTotal: z.int(),
  toHitSet: z.boolean(),
  targets: z.array(HitRulingTarget).min(1).max(APPLY_TARGETS_MAX),
  createdAt: z.string(),
});
export type HitRulingRecord = z.infer<typeof HitRulingRecord>;

/** `cbt.setSide` (FR-CBT-99): DM only, any combatant of the started encounter, both ways. */
export const SetSideInput = z.strictObject({
  combatantId: Id,
  side: Side,
  secret: z.boolean().optional(),
});
export type SetSideInput = z.input<typeof SetSideInput>;
