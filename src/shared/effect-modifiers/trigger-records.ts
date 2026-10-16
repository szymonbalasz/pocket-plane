// `rule-trigger` record (MOD §8.2, FR-MOD-32, -47; data model §27): the DM wire row, the player
// copy and its redaction; `trigger_use` states (server-only table, never a record type).
import { z } from "zod";
import { BUILTIN_PRESET_KEYS, isBuiltinPresetKey, PRESET_NAME_MAX } from "./schemas";
import { PlayerTriggerRule, type TriggerFilter, TriggerRule } from "./triggers";

export const RULE_TRIGGER_TYPE = "rule-trigger";

/** FR-MOD-32 caps (`conflict` in the commands; CON-44, MOD §12). */
export const TRIGGER_NAME_MAX = 40;
export const CHARACTER_TRIGGERS_MAX = 6;
export const DEFINITION_TRIGGERS_MAX = 4;
export const CAMPAIGN_TRIGGERS_MAX = 40;

/** `trigger_use.state` (FR-MOD-37, -38): offered at the damage roll, used at apply. */
export const TRIGGER_USE_STATES = ["offered", "used"] as const;
export type TriggerUseState = (typeof TRIGGER_USE_STATES)[number];

/** The name a player's copy shows for a referenced campaign preset that no longer exists. */
export const MISSING_PRESET_NAME = "Missing preset";

const Id = z.string().min(1).max(64);

const fields = {
  id: Id,
  campaignId: Id,
  seq: z.int(),
  /** Exactly one of `characterId` / `definitionId` (FR-MOD-32). */
  characterId: Id.nullable(),
  definitionId: Id.nullable(),
  /** Copy of the character's owner (FR-MOD-47); null on definition triggers. */
  ownerPlayerId: Id.nullable(),
  name: z.string().min(1).max(TRIGGER_NAME_MAX),
  enabled: z.boolean(),
  /** Part labels in public lines (FR-MOD-47, OQ-MOD-26): character default on, definition off. */
  public: z.boolean(),
  updatedAt: z.string(),
};

const oneOwner = (
  r: { characterId: string | null; definitionId: string | null; ownerPlayerId: string | null },
  ctx: z.RefinementCtx,
) => {
  if ((r.characterId === null) === (r.definitionId === null)) {
    ctx.addIssue({ code: "custom", path: ["characterId"], message: "Exactly one owner" });
  }
  if (r.definitionId !== null && r.ownerPlayerId !== null) {
    ctx.addIssue({ code: "custom", path: ["ownerPlayerId"], message: "No owner player" });
  }
};

/** `rule-trigger` as the DM receives it (the row). */
export const RuleTriggerRecord = z
  .strictObject({ ...fields, rule: TriggerRule })
  .superRefine(oneOwner);
export type RuleTriggerRecord = z.infer<typeof RuleTriggerRecord>;

/**
 * FR-MOD-47: what the owner player receives (character triggers only): campaign preset ids in
 * `requires` / `targetMarked` redacted to `{name}`.
 */
export const PlayerRuleTriggerRecord = z
  .strictObject({ ...fields, rule: PlayerTriggerRule })
  .superRefine(oneOwner);
export type PlayerRuleTriggerRecord = z.infer<typeof PlayerRuleTriggerRecord>;

/**
 * Server-side facts for the player copy, per preset ref of a rule (not a built-in key): `own` =
 * a preset of the trigger's own character (kept), else the campaign preset's name (redacted).
 */
export type TriggerPresetRef = { own: true } | { name: string };
export type TriggerPresetRefs = Readonly<Record<string, TriggerPresetRef>>;

/** Every preset ref a rule names (`requires`, `targetMarked`), in rule order, no built-ins. */
export function rulePresetRefs(rule: TriggerRule): string[] {
  const refs = [
    ...(rule.requires ? [rule.requires.preset] : []),
    ...rule.when.flatMap((f) => (f.if === "targetMarked" ? [f.preset] : [])),
  ];
  return [...new Set(refs)].filter((r) => !isBuiltinPresetKey(r));
}

/**
 * FR-MOD-47 (review R9, #209 campaign marks), fail closed: a built-in key or a ref `refs` marks
 * `own` stays; every other ref becomes `{name}` (its name, or "Missing preset").
 */
export function redactRuleForPlayer(rule: TriggerRule, refs: TriggerPresetRefs): PlayerTriggerRule {
  const kept = (ref: string) => {
    const r = refs[ref];
    return (
      (BUILTIN_PRESET_KEYS as readonly string[]).includes(ref) || (r !== undefined && "own" in r)
    );
  };
  const name = (ref: string) => {
    const r = refs[ref];
    return (r && "name" in r ? r.name : MISSING_PRESET_NAME).slice(0, PRESET_NAME_MAX);
  };
  const when = rule.when.map((f: TriggerFilter): PlayerTriggerRule["when"][number] =>
    f.if === "targetMarked" && !kept(f.preset) ? { if: "targetMarked", name: name(f.preset) } : f,
  );
  const { requires, ...rest } = rule;
  return {
    ...rest,
    ...(requires
      ? { requires: kept(requires.preset) ? requires : { name: name(requires.preset) } }
      : {}),
    when,
  };
}
