// dice-roll-log boundary schemas (DICE §8, §9; data model §15). zod is the source of truth.

import { PartDamageType } from "@shared/effect-modifiers/schemas";
import { ROLL_CATEGORIES, ROLL_MODES, RollCategory, RollMode } from "@shared/events/dice-roll-log";
import { z } from "zod";
import { diceCount, parseExpression } from "./grammar";

export { ROLL_CATEGORIES, ROLL_MODES, RollCategory, RollMode };

export const GAME_LOG_ENTRY_TYPE = "game-log-entry";
export const GAME_LOG_SETTINGS_TYPE = "game-log-settings";
/** FR-DICE-17: snapshot window. */
export const GAME_LOG_WINDOW = 100;
export const LABEL_MAX = 60;

const Id = z.string().min(1).max(64);

export const CATEGORY_LABEL: Record<RollCategory, string> = {
  attack: "Attack",
  damage: "Damage",
  "saving-throw": "Saving throw",
  "ability-check": "Ability check",
  "skill-check": "Skill check",
  contested: "Contested",
  initiative: "Initiative",
  healing: "Healing",
  other: "Other",
};

/** Settings column per category (data model §15: categories kebab-case, columns camelCase). */
export const SETTINGS_COLUMN = {
  attack: "attack",
  damage: "damage",
  "saving-throw": "savingThrow",
  "ability-check": "abilityCheck",
  "skill-check": "skillCheck",
  contested: "contested",
  initiative: "initiative",
  healing: "healing",
  other: "other",
} as const satisfies Record<RollCategory, string>;
export type SettingsColumn = (typeof SETTINGS_COLUMN)[RollCategory];

/** FR-DICE-01 as a zod check: the issue message names the broken limit. */
export const DiceExpression = z.string().superRefine((s, ctx) => {
  const r = parseExpression(s);
  if (!r.ok) ctx.addIssue({ code: "custom", message: r.message });
});

/** FR-DICE-11: trimmed, ≤ 60 chars, no control chars; empty → absent. */
export const RollLabel = z
  .string()
  .max(500)
  .transform((s) => s.trim())
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "Label: no control characters")
  .refine((s) => s.length <= LABEL_MAX, `Label: at most ${LABEL_MAX} characters`);

/**
 * FR-DICE-06: physical dice. `diceTotal` = sum of kept dice; optional `dice` = every die value
 * in notation order (count and faces must match; kept is computed server-side).
 */
export const ManualEntry = z.strictObject({
  diceTotal: z.int().min(-50_000).max(50_000),
  dice: z.array(z.int().min(1).max(1000)).min(1).max(51).optional(),
});
export type ManualEntry = z.infer<typeof ManualEntry>;

/** FR-DICE-10: who the roll is for. Omitted = the roller (player name / "DM"). */
export const RollActorRef = z.union([
  z.strictObject({ entityId: Id }),
  z.strictObject({ tokenId: Id }),
]);
export type RollActorRef = z.infer<typeof RollActorRef>;

/**
 * FR-DICE-34: the DM may also roll as a combatant of the started encounter (the token-less ones
 * are listed); the server resolves it to the combatant's entity and name. Not for players.
 */
export const DmRollActorRef = z.union([
  ...RollActorRef.options,
  z.strictObject({ combatantId: Id }),
]);
export type DmRollActorRef = z.infer<typeof DmRollActorRef>;

/**
 * #385 (FR-DICE-94, ADR-0073): a roll's purpose; absent = plain. `attack`: its d20 decides the
 * crit; `damage`: a damage type per part.
 */
export const ROLL_PURPOSES = ["attack", "damage"] as const;
export const RollPurpose = z.enum(ROLL_PURPOSES);
export type RollPurpose = z.infer<typeof RollPurpose>;

/**
 * ADR-0073 decision 1: one staged part of an attack or damage roll, as the tray sends it. Damage:
 * part 1 = the base part (type optional), parts 2–3 = extra parts (type required).
 */
export const StagedPart = z.strictObject({
  expression: DiceExpression,
  type: PartDamageType.optional(),
});
export type StagedPart = z.infer<typeof StagedPart>;
/** ADR-0073: a damage roll's parts (base + 2 extra, FR-CHARX-54) and their dice together. */
export const STAGED_PARTS_MAX = 3;
export const STAGED_DICE_MAX = 20;
export const StagedParts = z.array(StagedPart).min(1).max(STAGED_PARTS_MAX);
export type StagedParts = z.infer<typeof StagedParts>;

export const ATTACK_NEEDS_D20 = "An attack needs one d20";
export const EXTRA_PART_TYPE = "Pick a type for each extra part";

/**
 * ADR-0073 decision 1 (FR-CHARX-128, FR-CBT-170, FR-DICE-94): why staged parts don't fit their
 * purpose, or null. Attack: exactly 1 part, exactly one `1d20` term, no type. Damage: 1–3 parts,
 * parts 2–3 typed, Σ dice ≤ 20. Each part's grammar is the schema's (FR-DICE-01).
 */
export function stagedPartsIssue(
  parts: readonly { expression: string; type?: string | undefined }[],
  purpose: RollPurpose,
): string | null {
  if (purpose === "attack") {
    if (parts.length !== 1) return "An attack has one part";
    const p = parts[0] as (typeof parts)[number];
    if (p.type !== undefined) return "An attack has no damage type";
    return attackExpressionIssue(p.expression);
  }
  if (parts.length > STAGED_PARTS_MAX) return `At most ${STAGED_PARTS_MAX} damage parts`;
  if (parts.some((p, i) => i > 0 && p.type === undefined)) return EXTRA_PART_TYPE;
  let dice = 0;
  for (const p of parts) {
    const r = parseExpression(p.expression);
    if (!r.ok) return r.message;
    dice += diceCount(r.value);
  }
  return dice > STAGED_DICE_MAX ? `At most ${STAGED_DICE_MAX} damage dice` : null;
}

/** FR-DICE-94: an attack expression has exactly one `1d20` term (adv / dis come from `mode`). */
export function attackExpressionIssue(expression: string): string | null {
  const r = parseExpression(expression);
  if (!r.ok) return r.message;
  const d20s = r.value.filter((t) => t.kind === "dice" && t.faces === 20);
  const one = d20s[0];
  const ok =
    d20s.length === 1 &&
    one?.kind === "dice" &&
    one.count === 1 &&
    one.keep === null &&
    one.sign === 1;
  return ok ? null : ATTACK_NEEDS_D20;
}

/** Adds a `stagedPartsIssue` under `path` (a `superRefine` helper). */
export function checkStagedParts(
  parts: readonly StagedPart[] | undefined,
  purpose: RollPurpose,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ["parts"],
): void {
  if (parts === undefined) return;
  const message = stagedPartsIssue(parts, purpose);
  if (message) ctx.addIssue({ code: "custom", path, message });
}

/**
 * Intent `dice.roll` (FR-DICE-09). `actor.combatantId`: DM only (player → `invalid`). FR-DICE-94
 * (#385): `purpose` and, with `purpose: "damage"`, `parts` in place of `expression` (exactly one
 * of the two); `purpose: "attack"` needs one `1d20` term.
 */
export const DiceRollIntent = z
  .strictObject({
    expression: DiceExpression.optional(),
    mode: RollMode.default("normal"),
    category: RollCategory.default("other"),
    label: RollLabel.optional(),
    actor: DmRollActorRef.optional(),
    manual: ManualEntry.optional(),
    public: z.boolean().optional(),
    purpose: RollPurpose.optional(),
    parts: StagedParts.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.expression === undefined) === (v.parts === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["expression"],
        message: "An expression or parts",
      });
      return;
    }
    if (v.parts !== undefined) {
      if (v.purpose !== "damage") {
        ctx.addIssue({ code: "custom", path: ["parts"], message: "Parts are for damage rolls" });
        return;
      }
      if (v.manual !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["manual"],
          message: "Physical dice: one expression",
        });
      }
      checkStagedParts(v.parts, "damage", ctx);
    }
    if (v.purpose === "attack" && v.expression !== undefined) {
      const message = attackExpressionIssue(v.expression);
      if (message) ctx.addIssue({ code: "custom", path: ["expression"], message });
    }
  });
export type DiceRollIntent = z.input<typeof DiceRollIntent>;

export const DiceRollResult = z.object({ rollId: z.string(), entryId: z.string() });
export type DiceRollResult = z.infer<typeof DiceRollResult>;

/** Intent `dice.setCategoryPublic` (FR-DICE-12). */
export const SetCategoryPublicIntent = z.strictObject({
  category: RollCategory,
  public: z.boolean(),
});
export type SetCategoryPublicIntent = z.infer<typeof SetCategoryPublicIntent>;

/** Intent `dice.setEntryHidden` (FR-DICE-99); `confirmGuarded`: the DM's yes to REVEAL_GUARDED. */
export const SetEntryHiddenIntent = z.strictObject({
  entryId: Id,
  hidden: z.boolean(),
  confirmGuarded: z.literal(true).optional(),
});
export type SetEntryHiddenIntent = z.infer<typeof SetEntryHiddenIntent>;

/** FR-DICE-100: the `conflict` a reveal gets when it would make a guarded roll public. */
export const REVEAL_GUARDED = "This roll was made as a hidden or renamed creature";

/** One stored die (#140): every die incl. dropped; `value` null only for manual totals. */
export const DieResult = z.strictObject({
  faces: z.int().min(2).max(1000),
  value: z.int().nullable(),
  kept: z.boolean(),
  /**
   * FR-MOD-17 (R2 ruling): a physical roll's second d20, rolled by the server because only
   * effects the player can't see give the mode. Absent = as entered / as rolled.
   */
  auto: z.literal(true).optional(),
});
export type DieResult = z.infer<typeof DieResult>;

/** FR-MOD-19: parts per roll (roll hooks; MOD caps a roll's parts at this). */
export const ROLL_MODS_MAX = 20;
/** FR-MOD-19 (review D9): a part carries per-die values only up to this many dice. */
export const PART_DICE_MAX = 20;
/** FR-MOD-19 (review R1): offered rule-trigger parts per damage roll. */
export const ROLL_OFFERED_MAX = 4;
/** FR-MOD-34, -37: DM-only line notes per entry ("Divine Fury skipped: 30 dice > 25"). */
export const ROLL_NOTES_MAX = 4;
export const ROLL_NOTE_MAX = 80;

/**
 * FR-MOD-19 (D9): a part's per-die values in the order of its expression's dice terms, so
 * dice-extras throws them as labelled dice (FR-DICEX-13). A part with more dice carries none.
 */
const PartDice = z.array(z.int().min(1).max(1000)).min(1).max(PART_DICE_MAX);

/**
 * FR-MOD-19: one roll-hook part on a payload (player-safe). `label` = the effect's label iff
 * the effect is player-visible, else null ("(DM)"); `value` signed, in the item's `total`;
 * `expression` / `rollId` for bonus dice (their own `roll` row); `auto` = rolled by the server
 * for a physical base roll (FR-MOD-18). Rule triggers (T): `dice` per die (D9), `type` = a
 * typed part's damage type ("+ 6 radiant (Divine Fury)").
 */
export const RollModPart = z.strictObject({
  label: z.string().max(LABEL_MAX).nullable(),
  value: z.int(),
  expression: z.string().max(20).optional(),
  auto: z.literal(true).optional(),
  rollId: Id.optional(),
  dice: PartDice.optional(),
  type: PartDamageType.optional(),
});
export type RollModPart = z.infer<typeof RollModPart>;

/**
 * FR-MOD-19 (review R1): an offered rule-trigger part on a damage `roll` item: rolled with the
 * damage, **not** in `total` (it lands per target at apply). `label` iff the trigger is `public`
 * (FR-MOD-47), else null "(DM)"; `type` null = the attack's type; no settle facts (those ride on
 * the card). dice-extras (FR-DICEX-13) throws `dice` as labelled offered dice.
 */
export const RollOfferedPart = z.strictObject({
  label: z.string().max(LABEL_MAX).nullable(),
  value: z.int(),
  expression: z.string().min(1).max(20),
  rollId: Id,
  type: PartDamageType.nullable(),
  auto: z.literal(true).optional(),
  dice: PartDice.optional(),
});
export type RollOfferedPart = z.infer<typeof RollOfferedPart>;

/**
 * FR-MOD-19: the DM's names for a part or mode hint (`dmPayload`), same index as the payload's:
 * an effect's (`effectId`) or, for a `roll` trigger's part (FR-MOD-43), a trigger's (`triggerId`).
 */
export const DmModPart = z
  .strictObject({
    effectId: Id.optional(),
    triggerId: Id.optional(),
    label: z.string().max(LABEL_MAX),
  })
  .refine((p) => (p.effectId === undefined) !== (p.triggerId === undefined), {
    message: "An effect or a trigger",
  });
export type DmModPart = z.infer<typeof DmModPart>;

/** FR-MOD-19: the DM's name of an offered part (`dmPayload`), same index as the item's `offered`. */
export const DmOfferedPart = z.strictObject({
  triggerId: Id,
  label: z.string().max(LABEL_MAX),
});
export type DmOfferedPart = z.infer<typeof DmOfferedPart>;

/**
 * FR-MOD-18 (tier 2 / T): one physical dice group for a bonus die or an offered trigger die, sent
 * on a roll intent beside the base `manual` entry. `key` = `e:<effectId>` | `t:<triggerId>`;
 * an effect with several dice parts on one roll keys each `e:<effectId>.<index>` (`bonusDieKey`,
 * `@shared/effect-modifiers/rules`). `e:` groups must match the committed bonus dice (else
 * `conflict`); `t:` groups never conflict (a surplus one is ignored; an offered trigger without
 * one is server-rolled, `auto`).
 */
export const ManualPartKey = z
  .string()
  .max(70)
  .regex(/^[et]:[^\s]{1,68}$/, "Key: e:<effectId> or t:<triggerId>");
export const ManualPart = z.strictObject({ key: ManualPartKey, entry: ManualEntry });
export type ManualPart = z.infer<typeof ManualPart>;
export const ManualParts = z
  .array(ManualPart)
  .max(ROLL_MODS_MAX + ROLL_OFFERED_MAX)
  .refine((ps) => new Set(ps.map((p) => p.key)).size === ps.length, {
    message: "Each part group at most once",
  });
export type ManualParts = z.infer<typeof ManualParts>;

/**
 * FR-MOD-18 (R2): roll intents carry `manualParts` beside `manual` only. Single-roll intents
 * take one list; two-roll intents (`char.roll`, `cbt.attack`) one per `manual` entry (an effect
 * may have bonus dice on both the to-hit and the damage, under the same key).
 */
export const MANUAL_PARTS_ALONE = "Physical part groups need a physical roll";
export const MANUAL_PARTS_PER_ENTRY = "One part-group list per physical roll";
export const ManualPartsPerRoll = z.array(ManualParts).min(1).max(2);

/** The intent-level rule (a `superRefine`): `manualParts` only with `manual`, one list per entry. */
export function checkManualParts(
  v: { manual?: unknown; manualParts?: readonly unknown[] },
  ctx: z.RefinementCtx,
): void {
  if (v.manualParts === undefined) return;
  const message =
    v.manual === undefined
      ? MANUAL_PARTS_ALONE
      : Array.isArray(v.manual) && v.manualParts.length !== v.manual.length
        ? MANUAL_PARTS_PER_ENTRY
        : null;
  if (message) ctx.addIssue({ code: "custom", path: ["manualParts"], message });
}

/** FR-CHARX-55: a weapon damage part's type and role on a `roll` payload item. */
export const RollPart = z.strictObject({ type: PartDamageType.nullable(), extra: z.boolean() });
export type RollPart = z.infer<typeof RollPart>;

/**
 * FR-DICE-64 (sprint 7): the roll this item rerolled, on the new entry's item: the superseded
 * entry and its item's total ("(reroll, was 4)"). Public by construction (same audience).
 */
export const RollReplaces = z.strictObject({ entryId: Id, total: z.int() });
export type RollReplaces = z.infer<typeof RollReplaces>;

/** `roll` kind payload item (data model §15). */
export const RollPayloadItem = z.strictObject({
  rollId: Id,
  expression: z.string().max(80),
  mode: RollMode,
  manual: z.boolean(),
  dice: z.array(DieResult).max(51),
  constant: z.int(),
  total: z.int(),
  natural: z.int().nullable(),
  label: z.string().max(LABEL_MAX).nullable(),
  /**
   * The roll's outcome, set by the owning command once it is known, e.g. a death save's
   * "success (2 / 0)" (FR-CBTX-39); shown after the total. Absent on plain rolls.
   */
  note: z.string().max(80).optional(),
  /** FR-MOD-19: roll-hook parts, after the constant; `total` includes them. Absent = none. */
  mods: z.array(RollModPart).min(1).max(ROLL_MODS_MAX).optional(),
  /** FR-MOD-19 (tier 2): labels of the mode hints behind `mode` (null = "(DM)"). */
  modes: z.array(z.string().max(LABEL_MAX).nullable()).min(1).max(ROLL_MODS_MAX).optional(),
  /** FR-MOD-19 (R1): offered trigger parts of a card's damage roll, **not** in `total`. */
  offered: z.array(RollOfferedPart).min(1).max(ROLL_OFFERED_MAX).optional(),
  /**
   * FR-CHARX-55 (sprint 4): one damage part of an attack row with extra parts (`char.roll`):
   * `extra: false` = the base part (`type` null = untyped), `extra: true` = an extra part. The
   * line merges a base item and the extra items after it into one run. Absent = a plain roll.
   */
  part: RollPart.optional(),
  /** FR-DICE-64: set on a reroll's item (`dice.reroll`); stripped while gems are off (FR-DICE-69). */
  replaces: RollReplaces.optional(),
  /**
   * FR-DICE-80 (sprint 8): a roll-request answer (`dicex.answerRequest` / `rollForMissing`). Data
   * only (the line shows no tag, OQ-DICE-46); the entry is never rerollable (OQ-GEM-20 A).
   */
  answer: z.literal(true).optional(),
  /**
   * FR-DICE-94 (#385): the roll's purpose (absent = plain). Written by `dice.roll`, `char.roll`,
   * `cbt.attack`, `cbt.rollDamage`; damage items also carry `part`. Old entries read as plain.
   */
  purpose: RollPurpose.optional(),
  /**
   * FR-CHARX-130 (OQ-CHARX-51 A): the staged expression differs from the row's derived one
   * (normalised): the dice were changed in the tray. Absent = as the row has it.
   */
  edited: z.literal(true).optional(),
});
export type RollPayloadItem = z.infer<typeof RollPayloadItem>;

export const RollEntryPayload = z.array(RollPayloadItem).min(1).max(20);
export type RollEntryPayload = z.infer<typeof RollEntryPayload>;

/** FR-MOD-19: per payload item (same index), the names of its `mods` / `modes` / `offered` (DM). */
export const RollItemDmMods = z.strictObject({
  mods: z.array(DmModPart).max(ROLL_MODS_MAX),
  modes: z.array(DmModPart).max(ROLL_MODS_MAX).optional(),
  offered: z.array(DmOfferedPart).min(1).max(ROLL_OFFERED_MAX).optional(),
});
export type RollItemDmMods = z.infer<typeof RollItemDmMods>;

/**
 * `roll` kind `dmPayload` (FR-MOD-19): present only when an item has parts, mode hints or offers,
 * or the entry has `notes` (FR-MOD-34, -37: skipped triggers, DM only).
 */
export const RollEntryDmPayload = z.strictObject({
  items: z.array(RollItemDmMods).min(1).max(20),
  notes: z.array(z.string().min(1).max(ROLL_NOTE_MAX)).min(1).max(ROLL_NOTES_MAX).optional(),
  /**
   * FR-DICE-96 (#385): the damage card `cbt.useRoll` built or completed from this entry; set
   * once (`gameLog.markUsed`), never cleared, copied by a reroll. DM only (FR-DICE-15).
   */
  usedByCardId: Id.optional(),
});
export type RollEntryDmPayload = z.infer<typeof RollEntryDmPayload>;

/**
 * FR-DICE-96: a roll entry already feeds a card: combat's own lines (`encounterId`, old ones
 * too) or a used one (`dmPayload.usedByCardId`, DM view only).
 */
export function isUsedRoll(e: { encounterId: string | null; dmPayload?: unknown }): boolean {
  if (e.encounterId !== null) return true;
  const dm = e.dmPayload as { usedByCardId?: unknown } | null | undefined;
  return typeof dm?.usedByCardId === "string";
}

/** FR-DICE-100: an entry's audience, as stamped (FR-DICE-13). */
export const EntryStamp = z.strictObject({
  public: z.boolean(),
  audiencePlayerId: z.string().nullable(),
});
export type EntryStamp = z.infer<typeof EntryStamp>;

/** `game-log-entry` as the DM receives it (full row). */
export const GameLogEntryRecord = z.strictObject({
  id: Id,
  campaignId: Id,
  n: z.int().min(1),
  at: z.string(),
  kind: z.string(),
  category: RollCategory,
  public: z.boolean(),
  undone: z.boolean(),
  rollerRole: z.enum(["dm", "player"]),
  rollerPlayerId: z.string().nullable(),
  actorName: z.string(),
  payload: z.unknown(),
  dmPayload: z.unknown().nullable(),
  rollIds: z.array(z.string()),
  encounterId: z.string().nullable(),
  /**
   * Sprint 6 (ADR-0056, FR-CBT-114): a non-public entry also reaches this player (a companion's
   * owner: its roll lines); null = DM only. Old rows: null.
   */
  audiencePlayerId: z.string().nullable().default(null),
  supersededBy: z.string().nullable(),
  /**
   * FR-DICE-100: the audience the DM hid this line from (`dice.setEntryHidden`), restored by a
   * reveal; null = not hidden by hand. DM only. Old rows: null.
   */
  hiddenFrom: EntryStamp.nullable().default(null),
});
export type GameLogEntryRecord = z.infer<typeof GameLogEntryRecord>;

/** FR-DICE-15, -100: what a player receives (no `dmPayload` or `hiddenFrom` key). */
export const RedactedGameLogEntry = GameLogEntryRecord.omit({ dmPayload: true, hiddenFrom: true });
export type RedactedGameLogEntry = z.infer<typeof RedactedGameLogEntry>;

/** An entry as either client holds it. */
export type GameLogEntryView = Omit<RedactedGameLogEntry, "audiencePlayerId"> & {
  audiencePlayerId?: string | null;
  dmPayload?: unknown;
  hiddenFrom?: EntryStamp | null;
};

/** FR-DICE-99: can any player see this line today? ("Hide" when yes, "Reveal" when no.) */
export const seenByPlayers = (e: {
  public: boolean;
  audiencePlayerId?: string | null | undefined;
}): boolean => e.public || (e.audiencePlayerId ?? null) !== null;

/** `game-log-settings` (DM only). */
export const GameLogSettingsRecord = z.strictObject({
  id: Id,
  campaignId: Id,
  attack: z.boolean(),
  damage: z.boolean(),
  savingThrow: z.boolean(),
  abilityCheck: z.boolean(),
  skillCheck: z.boolean(),
  contested: z.boolean(),
  initiative: z.boolean(),
  healing: z.boolean(),
  other: z.boolean(),
});
export type GameLogSettingsRecord = z.infer<typeof GameLogSettingsRecord>;

/** FR-DICE-12: no row = all hidden. */
export function defaultSettings(campaignId: string): GameLogSettingsRecord {
  return {
    id: campaignId,
    campaignId,
    attack: false,
    damage: false,
    savingThrow: false,
    abilityCheck: false,
    skillCheck: false,
    contested: false,
    initiative: false,
    healing: false,
    other: false,
  };
}

export const categoryPublic = (s: GameLogSettingsRecord, c: RollCategory): boolean =>
  s[SETTINGS_COLUMN[c]];
