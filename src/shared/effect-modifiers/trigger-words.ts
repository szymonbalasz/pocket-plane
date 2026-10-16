// Rule triggers in words and their sheet facts (FR-MOD-49, -50; MOD §7), pure, both clients: the
// sentence ("Once per turn, on a weapon hit on your turn, while Rage is on: 1d6 + … radiant"),
// the formula value now for the owner ("1d6+2"), and the Triggers block's warnings ("Uses link
// broken", "Requires a missing preset"). Reads a DM row or a player's redacted copy alike.
import type { FeatureRow } from "@shared/character-sheet/sheet";
import { type FormulaOwner, type FormulaResult, type FormulaValue, formulaValue } from "./formula";
import { BUILTIN_PRESET_DEFS } from "./presets";
import { hasUses } from "./rules";
import { isBuiltinPresetKey, type RollSel } from "./schemas";
import { MISSING_PRESET_NAME } from "./trigger-records";
import { type PlayerTriggerRule, ruleFormula, type TriggerEvery } from "./triggers";

/** A preset ref as a rule (or a player's copy) names it. */
export type PresetRefView = { preset: string } | { name: string };

export interface TriggerWordsContext {
  /** A preset id's name (DM: any preset; a player: own presets); undefined = not held. */
  presetName(id: string): string | undefined;
  /** A feature row id's name (`every.feature`). */
  featureName(id: string): string | undefined;
}

/** A built-in preset's name (marks too: Hunter's Mark has no modifiers at this tier). */
export const builtinName = (key: string): string =>
  BUILTIN_PRESET_DEFS.find((d) => d.key === key)?.name ?? key;

/** The name a ref shows: a built-in's name, a held preset's name, a redacted copy's name. */
export function presetRefName(ref: PresetRefView, cx: Pick<TriggerWordsContext, "presetName">) {
  if ("name" in ref) return ref.name;
  if (isBuiltinPresetKey(ref.preset)) return builtinName(ref.preset);
  return cx.presetName(ref.preset) ?? MISSING_PRESET_NAME;
}

const ABIL = (a: readonly string[] | undefined) =>
  a?.length ? `${a.map((x) => x.toUpperCase()).join(", ")} ` : "";

/** A roll selector in words: "weapon damage rolls", "DEX saving throws", "initiative". */
export function rollSelWords(on: RollSel): string {
  const via = on.via ? `${on.via} ` : "";
  switch (on.roll) {
    case "attack":
      return `${via}attack rolls`;
    case "damage":
      return `${via}damage rolls`;
    case "save":
      return `${ABIL(on.abilities)}saving throws`;
    case "check":
      return `${ABIL(on.abilities)}checks`;
    case "initiative":
      return "initiative";
  }
}

const MODE_WORDS = {
  normal: "a normal roll",
  advantage: "advantage",
  disadvantage: "disadvantage",
};

function everyWords(every: TriggerEvery, cx: TriggerWordsContext): string | null {
  if (typeof every === "object") {
    return `Spends a use of ${cx.featureName(every.feature) ?? "a missing feature"}`;
  }
  return every === "each" ? null : `Once per ${every}`;
}

/** FR-MOD-49 / -50: the rule as one sentence (the formula as written; its value is a Badge). */
export function triggerSentence(rule: PlayerTriggerRule, cx: TriggerWordsContext): string {
  const via = rule.when.find((f) => f.if === "via");
  const roll = rule.when.find((f) => f.if === "roll");
  const event =
    rule.on === "hit"
      ? `on a ${via && "via" in via ? `${via.via} ` : ""}hit`
      : rule.on === "roll"
        ? `on ${roll && "on" in roll ? rollSelWords(roll.on) : "a roll"}`
        : "at the start of its turn";
  const conds: string[] = [];
  const checks: string[] = [];
  for (const f of rule.when) {
    if (f.if === "ownTurn" && rule.on !== "turnStart") conds.push("on your turn");
    else if (f.if === "crit") conds.push("on a crit");
    else if (f.if === "row") conds.push(`with ${f.names.join(" or ")}`);
    else if (f.if === "targetHurt") conds.push("against a hurt target");
    else if (f.if === "targetMarked") {
      const name = "name" in f ? f.name : presetRefName({ preset: f.preset }, cx);
      conds.push(`against a target with your ${name}`);
    } else if (f.if === "mode") {
      const modes = f.modes.map((m) => MODE_WORDS[m]).join(" or ");
      if (f.soft) checks.push(`ticked with ${modes}`);
      else conds.push(`with ${modes}`);
    } else if (f.if === "ask") checks.push(`check: ${f.note}`);
  }
  const requires = rule.requires && `while ${presetRefName(rule.requires, cx)} is on`;
  const t = rule.then;
  const effect =
    t.do === "damage"
      ? `${t.formula} ${t.type ?? "damage of the attack's type"}`
      : t.do === "part"
        ? `+ ${t.formula}`
        : t.do === "mode"
          ? t.mode
          : `remind “${t.text}”${t.value ? ` (value ${t.value})` : ""}`;
  const head = [everyWords(rule.every, cx), [event, ...conds].join(" "), requires]
    .filter(Boolean)
    .join(", ");
  const lead = head.charAt(0).toUpperCase() + head.slice(1);
  return `${lead}: ${effect}${checks.length ? ` (${checks.join("; ")})` : ""}`;
}

/** FR-MOD-49 "= 1d6+2": the rule's formula for this owner now; null without a formula. */
export function triggerValueNow(
  rule: Pick<PlayerTriggerRule, "then">,
  owner: FormulaOwner | null,
): FormulaResult<FormulaValue> | null {
  const f = ruleFormula(rule);
  if (f === null || owner === null) return null;
  return formulaValue(f, owner);
}

export type TriggerWarning = "uses-broken" | "missing-preset";
export const TRIGGER_WARNING_TEXT: Readonly<Record<TriggerWarning, string>> = {
  "uses-broken": "Uses link broken",
  "missing-preset": "Requires a missing preset",
};

/**
 * FR-MOD-49 warnings (MOD §11): `every.feature` names no feature row with uses → "Uses link
 * broken"; `requires` or a mark names a preset the viewer can't find (deleted; a player's copy
 * "Missing preset") → "Requires a missing preset". `features` undefined = the sheet isn't held.
 */
export function triggerWarnings(
  rule: PlayerTriggerRule,
  features: readonly FeatureRow[] | undefined,
  cx: Pick<TriggerWordsContext, "presetName">,
): TriggerWarning[] {
  const out: TriggerWarning[] = [];
  if (typeof rule.every === "object") {
    const id = rule.every.feature;
    const row = features?.find((f) => f.id === id);
    if (!row || !hasUses(row)) out.push("uses-broken");
  }
  const missing = (ref: PresetRefView) =>
    "name" in ref
      ? ref.name === MISSING_PRESET_NAME
      : !isBuiltinPresetKey(ref.preset) && cx.presetName(ref.preset) === undefined;
  const refs: PresetRefView[] = [
    ...(rule.requires ? [rule.requires] : []),
    ...rule.when.flatMap((f) =>
      f.if === "targetMarked" ? ["name" in f ? { name: f.name } : { preset: f.preset }] : [],
    ),
  ];
  if (refs.some(missing)) out.push("missing-preset");
  return out;
}

/** A player's copy names a campaign preset by `{name}`: it can't be saved back (FR-MOD-47). */
export const hasRedactedRefs = (rule: PlayerTriggerRule): boolean =>
  (rule.requires !== undefined && "name" in rule.requires) ||
  rule.when.some((f) => f.if === "targetMarked" && "name" in f);
