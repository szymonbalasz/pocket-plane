// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Rule-trigger rule (MOD §8.4, FR-MOD-33; ADR-0043): the strict zod of the `rule-trigger.rule`
// JSON leaf. Only the event × filter × effect combinations of §8.4's table parse; every formula
// parses with the §8.5 grammar. Compendium carries a `TriggerRule` opaquely (FR-MOD-46, S5).
import { z } from "zod";
import { type FormulaOwner, type FormulaValue, formulaValue, parseFormula } from "./formula";
import {
  BUILT_TIER,
  MODIFIER_DAMAGE_TYPES,
  PRESET_KEY_MAX,
  PRESET_NAME_MAX,
  RollSel,
  RollVia,
} from "./schemas";

/** MOD §8.4 limits. */
export const TRIGGER_FILTERS_MAX = 6;
export const ROW_NAMES_MAX = 4;
export const ROW_NAME_MAX = 40;
export const ASK_NOTE_MAX = 60;
export const REMIND_TEXT_MAX = 120;
/** Ids in a rule (preset ids, feature row ids) are ≤ 40, as keys. */
const REF_MAX = PRESET_KEY_MAX;

export const TRIGGER_EVENTS = ["hit", "roll", "turnStart"] as const;
export const TriggerEvent = z.enum(TRIGGER_EVENTS);
export type TriggerEvent = z.infer<typeof TriggerEvent>;

export const TRIGGER_WINDOWS = ["each", "turn", "round", "encounter"] as const;
export const TO_HIT_MODES = ["normal", "advantage", "disadvantage"] as const;

const Ref = z.string().min(1).max(REF_MAX);
const PresetRef = z.strictObject({ preset: Ref });
/** FR-MOD-47: a player's copy names a campaign preset instead of its id. */
const PresetName = z.strictObject({ name: z.string().min(1).max(PRESET_NAME_MAX) });

const Formula = z.string().superRefine((s, ctx) => {
  const r = parseFormula(s);
  if (!r.ok) ctx.addIssue({ code: "custom", message: r.error.message });
});

const filterOptions = [
  z.strictObject({ if: z.literal("via"), via: RollVia }),
  z.strictObject({
    if: z.literal("row"),
    names: z.array(z.string().min(1).max(ROW_NAME_MAX)).min(1).max(ROW_NAMES_MAX),
  }),
  z.strictObject({ if: z.literal("roll"), on: RollSel }),
  z.strictObject({ if: z.literal("ownTurn") }),
  z.strictObject({ if: z.literal("crit") }),
  z.strictObject({
    if: z.literal("mode"),
    modes: z
      .array(z.enum(TO_HIT_MODES))
      .min(1)
      .max(TO_HIT_MODES.length)
      .refine((m) => new Set(m).size === m.length, "Modes: no duplicates"),
    soft: z.literal(true).optional(),
  }),
  z.strictObject({ if: z.literal("targetHurt") }),
  z.strictObject({ if: z.literal("ask"), note: z.string().min(1).max(ASK_NOTE_MAX) }),
] as const;
const TargetMarked = z.strictObject({ if: z.literal("targetMarked"), preset: Ref });
const TargetMarkedName = z.strictObject({
  if: z.literal("targetMarked"),
  name: PresetName.shape.name,
});

export const TriggerFilter = z.discriminatedUnion("if", [...filterOptions, TargetMarked]);
export type TriggerFilter = z.infer<typeof TriggerFilter>;
export type TriggerFilterKind = TriggerFilter["if"];
const PlayerTriggerFilter = z.union([...filterOptions, TargetMarked, TargetMarkedName]);

export const TriggerEvery = z.union([z.enum(TRIGGER_WINDOWS), z.strictObject({ feature: Ref })]);
export type TriggerEvery = z.infer<typeof TriggerEvery>;

export const TriggerEffect = z.discriminatedUnion("do", [
  z.strictObject({
    do: z.literal("damage"),
    formula: Formula,
    /** null = the attack's type. */
    type: z.enum(MODIFIER_DAMAGE_TYPES).nullable(),
  }),
  z.strictObject({ do: z.literal("part"), formula: Formula }),
  z.strictObject({ do: z.literal("mode"), mode: z.enum(["advantage", "disadvantage"]) }),
  z.strictObject({
    do: z.literal("remind"),
    text: z.string().min(1).max(REMIND_TEXT_MAX),
    value: Formula.optional(),
  }),
]);
export type TriggerEffect = z.infer<typeof TriggerEffect>;

/** MOD §8.4 table: filters and effects each event allows. */
export const EVENT_FILTERS: Readonly<Record<TriggerEvent, readonly TriggerFilterKind[]>> = {
  hit: ["via", "row", "ownTurn", "crit", "mode", "targetMarked", "targetHurt", "ask"],
  roll: ["roll", "row", "ownTurn", "crit", "mode"],
  // ownTurn is implied; writing it is allowed and changes nothing.
  turnStart: ["ownTurn"],
};
export const EVENT_EFFECTS: Readonly<Record<TriggerEvent, readonly TriggerEffect["do"][]>> = {
  hit: ["damage"],
  roll: ["part", "mode"],
  turnStart: ["remind"],
};
/** Tier of an effect kind (MOD §2): `mode` is tier 2, gated by `BUILT_TIER` like modifiers. */
const EFFECT_TIER: Readonly<Record<TriggerEffect["do"], number>> = {
  damage: 1,
  part: 1,
  mode: 2,
  remind: 1,
};

interface RuleShape {
  on: TriggerEvent;
  when: readonly { if: TriggerFilterKind; soft?: true; on?: { roll: string } }[];
  every: TriggerEvery;
  then: { do: TriggerEffect["do"] };
}

function checkCombination(r: RuleShape, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  const allowed = EVENT_FILTERS[r.on];
  r.when.forEach((f, i) => {
    if (!allowed.includes(f.if)) issue(["when", i, "if"], `No ${f.if} filter on ${r.on} triggers`);
    if (f.soft && r.on !== "hit") issue(["when", i, "soft"], "Soft filters on hit triggers only");
  });
  const count = (k: TriggerFilterKind) => r.when.filter((f) => f.if === k).length;
  if (count("row") > 1) issue(["when"], "At most one row filter");
  if (r.on === "roll") {
    const rolls = r.when.filter((f) => f.if === "roll");
    if (rolls.length !== 1) issue(["when"], "Roll triggers need exactly one roll filter");
    if (count("crit") > 0 && rolls.some((f) => f.on?.roll !== "damage")) {
      issue(["when"], "Crit filters on damage rolls only");
    }
  }
  if (!EVENT_EFFECTS[r.on].includes(r.then.do)) {
    issue(["then", "do"], `No ${r.then.do} effect on ${r.on} triggers`);
  } else if (EFFECT_TIER[r.then.do] > BUILT_TIER) {
    issue(["then", "do"], "This effect is not available yet");
  }
  if (r.on === "turnStart" && r.every !== "each") {
    issue(["every"], "Turn start reminders fire every time (each)");
  }
}

const ruleFields = { on: TriggerEvent, every: TriggerEvery, then: TriggerEffect };

/** FR-MOD-33: the stored / intent rule (`rule-trigger.rule`). */
export const TriggerRule = z
  .strictObject({
    ...ruleFields,
    requires: PresetRef.optional(),
    when: z.array(TriggerFilter).max(TRIGGER_FILTERS_MAX),
  })
  .superRefine(checkCombination);
export type TriggerRule = z.infer<typeof TriggerRule>;

/**
 * FR-MOD-47: a player's copy. `requires` and `targetMarked` may name a campaign preset
 * (`{name}`) instead of its id; everything else as `TriggerRule`.
 */
export const PlayerTriggerRule = z
  .strictObject({
    ...ruleFields,
    requires: z.union([PresetRef, PresetName]).optional(),
    when: z.array(PlayerTriggerFilter).max(TRIGGER_FILTERS_MAX),
  })
  .superRefine(checkCombination);
export type PlayerTriggerRule = z.infer<typeof PlayerTriggerRule>;

/** §8.4: a trigger's dice double on a crit unless it has a `crit` filter (Brutal Critical). */
export const doublesOnCrit = (rule: Pick<TriggerRule, "when">): boolean =>
  !rule.when.some((f) => f.if === "crit");

/** `row` filter (#209): the subject's row equals one of the names, case-insensitive. */
export function rowMatches(names: readonly string[], row: string | undefined): boolean {
  if (row === undefined) return false;
  const r = row.trim().toLowerCase();
  return names.some((n) => n.trim().toLowerCase() === r);
}

/** The rule's formula, if its effect has one (`damage`, `part`, `remind` value). */
export function ruleFormula(rule: Pick<TriggerRule, "then">): string | null {
  const t = rule.then;
  if (t.do === "damage" || t.do === "part") return t.formula;
  if (t.do === "remind") return t.value ?? null;
  return null;
}

export type RuleOwnerKind = "character" | "definition";
export interface RuleIssue {
  path: (string | number)[];
  message: string;
}

/**
 * FR-MOD-34, -45 save-time checks against the owner (after `TriggerRule` parsed): `feature`
 * frequency on characters only; the formula evaluates for this owner (≤ 25 dice, die-size
 * formulas 4–12). Returns the first issue or null.
 */
export function checkRuleForOwner(
  rule: TriggerRule,
  owner: { kind: RuleOwnerKind; values: FormulaOwner },
): RuleIssue | null {
  if (typeof rule.every === "object" && owner.kind !== "character") {
    return { path: ["every"], message: "Feature uses: characters only" };
  }
  const f = ruleFormula(rule);
  if (f === null) return null;
  const v = formulaValue(f, owner.values);
  if (v.ok) return null;
  const field = rule.then.do === "remind" ? "value" : "formula";
  return { path: ["then", field], message: v.error.message };
}

/** FR-MOD-44: a reminder's text with `{value}` replaced by the evaluated formula ("0" if none). */
export const reminderText = (text: string, value: FormulaValue | null): string =>
  text.replaceAll("{value}", value?.expression ?? "0");
