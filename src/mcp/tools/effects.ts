// Character effect tools (AGENT §9, FR-AGENT-33–40): toggles and rule triggers on a player character
// over the DM's `mod.putPreset` / `mod.putTrigger` / `mod.toggle`, with the DM's authority (locked
// sheets too). Names stand in for ids that don't exist yet, so one plan can add a feature row, the
// preset that spends it and the trigger that requires that preset (FR-AGENT-38). No delete tool
// exists, so a name a character already has is refused: replace by id instead (FR-AGENT-39).
import {
  CREATURE_SHEET_TYPE,
  type CreatureSheetRecord,
  CreatureSheetRecord as SheetSchema,
} from "@shared/character-sheet/sheet";
import { EFFECT_TYPE, EffectRecord } from "@shared/combat-extras/schemas";
import {
  MOD_INTENTS,
  PresetInput,
  PutPresetResult,
  ToggleInput,
  ToggleResult,
} from "@shared/effect-modifiers/intents";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { hasUses, presetUses, toggleOn } from "@shared/effect-modifiers/rules";
import {
  BUILTIN_PRESET_KEYS,
  CHARACTER_PRESETS_MAX,
  EFFECT_PRESET_TYPE,
  EffectPresetRecord,
  isBuiltinPresetKey,
  PRESET_NOTE_MAX,
} from "@shared/effect-modifiers/schemas";
import { formulaOwnerOf } from "@shared/effect-modifiers/trigger-fire";
import {
  PutTriggerResult,
  TRIGGER_INTENTS,
  TriggerName,
} from "@shared/effect-modifiers/trigger-intents";
import {
  CAMPAIGN_TRIGGERS_MAX,
  CHARACTER_TRIGGERS_MAX,
  RULE_TRIGGER_TYPE,
  RuleTriggerRecord,
} from "@shared/effect-modifiers/trigger-records";
import { checkRuleForOwner, TriggerRule } from "@shared/effect-modifiers/triggers";
import { ENTITY_TYPE, EntityRecord, entityNameKey } from "@shared/entities/schemas";
import { z } from "zod";
import type { WsSession } from "../client";
import { AgentError } from "../errors";
import type { PlanContext } from "../plan";
import {
  NOT_A_CHARACTER,
  type PlannedFeature,
  planCharacter,
  plannedFeaturesKey,
} from "./character";
import { defineTool, registerTools } from "./registry";

const RecordId = z.string().min(1).max(64);
const RowName = z.string().min(1).max(60);
const PresetName = PresetInput.shape.name;

export const BOTH_USES = "Give usesFeature (a row name) or usesFeatureId, not both";
export const BOTH_REQUIRES = "Give requiresPreset (a preset name) or rule.requires, not both";
export const ONE_PRESET = "Give exactly one of presetId and presetName";

const key = (s: string) => entityNameKey(s.trim());
const REPLACE_HINT = "find ids with character_effects";

// ---- reads ----

function characterOf(s: WsSession, id: string): EntityRecord {
  const e = s.records(ENTITY_TYPE, EntityRecord).find((x) => x.id === id);
  if (e?.kind === "monster") throw new AgentError("invalid", NOT_A_CHARACTER);
  if (!e) throw new AgentError("not_found", `No character ${id}: find ids with characters_list`);
  return e;
}

const presetsOn = (s: WsSession, characterId: string) =>
  s.records(EFFECT_PRESET_TYPE, EffectPresetRecord).filter((p) => p.characterId === characterId);

const featuresOf = (s: WsSession, characterId: string): CreatureSheetRecord["features"] =>
  s.records(CREATURE_SHEET_TYPE, SheetSchema).find((x) => x.id === characterId)?.features ?? [];

async function triggersOn(s: WsSession, characterId: string) {
  const all = await s.load(RULE_TRIGGER_TYPE, RuleTriggerRecord);
  return all.filter((t) => t.characterId === characterId);
}

// ---- names → rows (FR-AGENT-38): the same rule at run time and in `plan_check` ----

/** A row or preset, real (`id`) or planned by an earlier call of the plan (`call`). */
interface Named {
  id: string | null;
  name: string;
  call?: number;
}
type Picked<T> = { ok: true; row: T } | { ok: false; message: string };

const labelOf = (r: Named) => r.id ?? `planned by call ${r.call}`;

function pickOne<T extends Named>(matches: T[], what: string, name: string, idKey: string) {
  if (matches.length === 1) return { ok: true, row: matches[0] as T } as Picked<T>;
  return {
    ok: false,
    message: `${matches.length} ${what} are named "${name}" (${matches.map(labelOf).join(", ")}): pass ${idKey}`,
  } as Picked<T>;
}

/** A feature row by name, among those with uses: none, or more than one, is refused. */
function pickUsesRow<T extends Named & { usesMax?: number | null }>(
  rows: readonly T[],
  name: string,
  who: string,
): Picked<T> {
  const named = rows.filter((r) => key(r.name) === key(name));
  if (named.length === 0) return { ok: false, message: `No feature row "${name}" on ${who}` };
  const withUses = named.filter((r) => hasUses({ usesMax: r.usesMax ?? undefined }));
  if (withUses.length === 0) {
    return { ok: false, message: `Feature row "${name}" on ${who} has no uses: set its usesMax` };
  }
  return pickOne(withUses, "feature rows with uses", name, "usesFeatureId");
}

/** One of the character's presets by name: none, or more than one, is refused. */
function pickPreset<T extends Named>(
  rows: readonly T[],
  name: string,
  who: string,
  idKey: string,
): Picked<T> {
  const named = rows.filter((r) => key(r.name) === key(name));
  if (named.length === 0) return { ok: false, message: `No preset "${name}" on ${who}` };
  return pickOne(named, "presets", name, idKey);
}

const orInvalid = <T>(p: Picked<T>, path: string): T => {
  if (p.ok) return p.row;
  throw new AgentError("invalid", p.message, [{ path: [path], message: p.message }]);
};

/** FR-AGENT-39: the message that names the id to replace. */
const nameTaken = (what: string, who: string, name: string, id: string) =>
  `${who} already has a ${what} named "${name}" (id ${id}): pass id ${id} to replace it`;

// ---- plan side: the character's rows and presets, plus what earlier calls add ----

const plannedPresetsKey = (characterId: string) => `presets:${characterId}`;
const plannedTriggersKey = (characterId: string) => `triggers:${characterId}`;
const PLANNED_TRIGGER_CREATES = "trigger-creates";

/** Stored rows overlaid with the planned ones (a planned replace stands in for its row). */
const overlay = <T extends Named>(stored: readonly T[], planned: readonly T[]) => [
  ...stored.filter((r) => !planned.some((p) => p.id === r.id)),
  ...planned,
];

function planFeatures(ctx: PlanContext, characterId: string): PlannedFeature[] {
  const sheet = ctx.world.sheets.find((x) => x.id === characterId);
  const stored = (sheet?.features ?? []).map(
    (f): PlannedFeature => ({ id: f.id ?? null, name: f.name, usesMax: f.usesMax ?? null }),
  );
  return overlay(stored, ctx.planned<PlannedFeature>(plannedFeaturesKey(characterId)));
}

function planPresets(ctx: PlanContext, characterId: string): Named[] {
  const stored = ctx.world.presets
    .filter((p) => p.characterId === characterId)
    .map((p): Named => ({ id: p.id, name: p.name }));
  return overlay(stored, ctx.planned<Named>(plannedPresetsKey(characterId)));
}

// ---- character_effects ----

const characterEffects = defineTool({
  name: "character_effects",
  description:
    "One player character's effect presets (toggles), rule triggers and active effects, each with " +
    "its id, in their wire shapes. Use the ids to replace a preset or trigger, or to toggle.",
  input: z.strictObject({ id: RecordId }),
  write: false,
  run: ({ caller }, { id }) =>
    caller.ws({}, async (s) => {
      const c = characterOf(s, id);
      return {
        campaign: s.campaign,
        character: { id, name: c.name },
        presets: presetsOn(s, id),
        triggers: await triggersOn(s, id),
        activeEffects: s
          .records(EFFECT_TYPE, EffectRecord)
          .filter((e) => e.targetCharacterId === id && e.endedAt === null),
      };
    }),
});

// ---- character_put_preset ----

export const NEEDS_FIELDS =
  "A new preset needs name, modifiers, durationRounds and concentration, or from (a built-in key)";

/**
 * FR-AGENT-34/35: `PresetInput` for a character. Absent fields come from `from` (a built-in copied
 * as the sheet's Start from does) and, on a replace, from the stored preset (FR-AGENT-17).
 */
export const PutPresetToolInput = z
  .strictObject({
    characterId: RecordId,
    id: RecordId.optional().meta({ description: "Replace this preset; absent = add" }),
    from: z
      .enum(BUILTIN_PRESET_KEYS)
      .optional()
      .meta({ description: "Copy this built-in and keep it as originKey (FR-MOD-36)" }),
    name: PresetName.optional(),
    modifiers: PresetInput.shape.modifiers.optional(),
    durationRounds: PresetInput.shape.durationRounds.optional(),
    concentration: z.boolean().optional(),
    note: z
      .string()
      .max(PRESET_NOTE_MAX * 2)
      .optional(),
    usesFeature: RowName.optional().meta({
      description: "Feature row (with uses) spent by each toggle on, by name; may be planned",
    }),
    usesFeatureId: RecordId.nullable()
      .optional()
      .meta({ description: "The same by row id; null removes the link on a replace" }),
  })
  .superRefine((v, ctx) => {
    if (v.usesFeature !== undefined && v.usesFeatureId !== undefined) {
      ctx.addIssue({ code: "custom", path: ["usesFeature"], message: BOTH_USES });
    }
    const missing =
      v.name === undefined ||
      v.modifiers === undefined ||
      v.durationRounds === undefined ||
      v.concentration === undefined;
    if (v.id === undefined && v.from === undefined && missing) {
      ctx.addIssue({ code: "custom", path: [], message: NEEDS_FIELDS });
    }
  });
export type PutPresetToolInput = z.output<typeof PutPresetToolInput>;

/** The `mod.putPreset` body, but for a `usesFeature` name (resolved by the caller). */
function composePreset(input: PutPresetToolInput, before: EffectPresetRecord | undefined) {
  const built = input.from ? builtinPreset(input.from) : undefined;
  if (input.from && !built) {
    throw new AgentError("invalid", `This built-in preset is not available: ${input.from}`);
  }
  const base = built ?? before;
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    characterId: input.characterId,
    key: null,
    ...(input.from ? { originKey: input.from } : {}),
    name: input.name ?? before?.name ?? base?.name,
    modifiers: input.modifiers ?? base?.modifiers,
    durationRounds:
      input.durationRounds === undefined ? base?.durationRounds : input.durationRounds,
    concentration: input.concentration ?? base?.concentration,
    note: input.note ?? base?.note ?? "",
    ...(input.usesFeatureId === undefined ? {} : { usesFeatureId: input.usesFeatureId }),
  };
}

const characterPutPreset = defineTool({
  name: "character_put_preset",
  description:
    "Add or replace (with `id`) an effect preset, a toggle on a player character's sheet. Custom: " +
    "name, modifiers (1–6), durationRounds (null = none), concentration, note?. Or `from` a built-in " +
    "key, which copies it and keeps it as originKey so a trigger requiring that key matches; other " +
    "fields override. `usesFeature` names a feature row with uses that each toggle on spends. A name " +
    "the character already has → conflict naming the id to replace. DM authority: locked sheets too.",
  input: PutPresetToolInput,
  write: true,
  run: ({ caller }, input) =>
    caller.ws({ write: true }, async (s) => {
      const c = characterOf(s, input.characterId);
      const presets = presetsOn(s, c.id);
      const before = input.id === undefined ? undefined : presets.find((p) => p.id === input.id);
      if (input.id !== undefined && !before) {
        throw new AgentError("not_found", `No preset ${input.id} on ${c.name}: ${REPLACE_HINT}`);
      }
      const preset = composePreset(input, before);
      const name = String(preset.name);
      const taken = presets.find((p) => p.id !== input.id && key(p.name) === key(name));
      if (taken) throw new AgentError("conflict", nameTaken("preset", c.name, name, taken.id));
      const row =
        input.usesFeature === undefined
          ? undefined
          : orInvalid(
              pickUsesRow(
                featuresOf(s, c.id).map((f) => ({ ...f, id: f.id ?? null })),
                input.usesFeature,
                c.name,
              ),
              "usesFeature",
            );
      const r = PutPresetResult.parse(
        await s.intent(MOD_INTENTS.putPreset, {
          preset: { ...preset, ...(row ? { usesFeatureId: row.id } : {}) },
        }),
      );
      return {
        campaign: s.campaign,
        character: { id: c.id, name: c.name },
        presetId: r.presetId,
        name,
        created: !before,
        ...(row ? { usesFeatureId: row.id } : {}),
      };
    }),
  async plan(ctx, input) {
    const fallback = input.name ?? input.from ?? input.id ?? "";
    const e = await planCharacter(ctx, input.characterId, ["characterId"]);
    if (!e) return `character_put_preset: "${fallback}"`;
    const before =
      input.id === undefined
        ? undefined
        : ctx.world.presets.find((p) => p.id === input.id && p.characterId === e.id);
    if (input.id !== undefined && !before) {
      ctx.issue(["id"], `No preset ${input.id} on ${e.name}`);
      return `character_put_preset: "${fallback}" on ${e.name}`;
    }
    const preset = composePreset(input, before);
    const parsed = PresetInput.safeParse(preset);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) {
        ctx.issue(iss.path as (string | number)[], iss.message);
      }
    }
    const name = String(preset.name ?? "");
    const presets = planPresets(ctx, e.id);
    const taken = presets.find(
      (p) => (input.id === undefined || p.id !== input.id) && key(p.name) === key(name),
    );
    if (taken) {
      ctx.issue(
        ["name"],
        taken.id
          ? nameTaken("preset", e.name, name, taken.id)
          : `Name "${name}" is already used by call ${taken.call}`,
      );
    }
    if (!before && presets.length >= CHARACTER_PRESETS_MAX) {
      ctx.issue(["characterId"], `At most ${CHARACTER_PRESETS_MAX} presets per character`);
    }
    if (input.usesFeature !== undefined) {
      const p = pickUsesRow(planFeatures(ctx, e.id), input.usesFeature, e.name);
      if (!p.ok) ctx.issue(["usesFeature"], p.message);
    } else if (
      typeof input.usesFeatureId === "string" &&
      input.usesFeatureId !== before?.usesFeatureId
    ) {
      const f = planFeatures(ctx, e.id).find((r) => r.id === input.usesFeatureId);
      if (!f || !hasUses({ usesMax: f.usesMax ?? undefined })) {
        ctx.issue(["usesFeatureId"], `Not a feature row with uses on ${e.name}`);
      }
    }
    // A refused call adds nothing, so later calls resolve against what would really be there.
    if (!taken) {
      ctx
        .planned<Named>(plannedPresetsKey(e.id))
        .push({ id: input.id ?? null, name, call: ctx.call });
    }
    const from = input.from ? ` from ${input.from}` : "";
    const uses = input.usesFeature ? `, spends "${input.usesFeature}"` : "";
    return `character_put_preset: ${before ? "replace" : "add"} "${name}" on ${e.name}${from}${uses}`;
  },
});

// ---- character_put_trigger ----

/** FR-AGENT-36: `TriggerInput` for a character; `requiresPreset` stands in for `rule.requires`. */
export const PutTriggerToolInput = z
  .strictObject({
    characterId: RecordId,
    id: RecordId.optional().meta({ description: "Replace this trigger; absent = add" }),
    name: TriggerName,
    enabled: z.boolean().optional(),
    public: z.boolean().optional(),
    requiresPreset: PresetName.optional().meta({
      description: "One of the character's presets, by name; may be planned earlier in the plan",
    }),
    rule: TriggerRule,
  })
  .superRefine((v, ctx) => {
    if (v.requiresPreset !== undefined && v.rule.requires !== undefined) {
      ctx.addIssue({ code: "custom", path: ["requiresPreset"], message: BOTH_REQUIRES });
    }
  });
export type PutTriggerToolInput = z.output<typeof PutTriggerToolInput>;

const characterPutTrigger = defineTool({
  name: "character_put_trigger",
  description:
    "Add or replace (with `id`) a rule trigger on a player character. `rule`: {on: hit | roll | " +
    "turnStart, when: filters, every: each | turn | round | encounter | {feature: rowId}, then: " +
    'effect, requires?: {preset: built-in key or id}}, e.g. on hit, when [{if: "via", via: "weapon"}, ' +
    '{if: "ownTurn"}], every "turn", then {do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", ' +
    'type: "radiant"}. `requiresPreset` names one of the character\'s presets instead of ' +
    "`rule.requires`. A name the character already has → conflict naming the id to replace. DM " +
    "authority: locked sheets too.",
  input: PutTriggerToolInput,
  write: true,
  run: ({ caller }, input) =>
    caller.ws({ write: true }, async (s) => {
      const c = characterOf(s, input.characterId);
      const triggers = await triggersOn(s, c.id);
      const before = input.id === undefined ? undefined : triggers.find((t) => t.id === input.id);
      if (input.id !== undefined && !before) {
        throw new AgentError("not_found", `No trigger ${input.id} on ${c.name}: ${REPLACE_HINT}`);
      }
      const taken = triggers.find((t) => t.id !== input.id && key(t.name) === key(input.name));
      if (taken)
        throw new AgentError("conflict", nameTaken("trigger", c.name, input.name, taken.id));
      const required =
        input.requiresPreset === undefined
          ? undefined
          : orInvalid(
              pickPreset(presetsOn(s, c.id), input.requiresPreset, c.name, "rule.requires.preset"),
              "requiresPreset",
            );
      const rule = required ? { ...input.rule, requires: { preset: required.id } } : input.rule;
      const r = PutTriggerResult.parse(
        await s.intent(TRIGGER_INTENTS.putTrigger, {
          trigger: {
            ...(input.id === undefined ? {} : { id: input.id }),
            characterId: c.id,
            definitionId: null,
            name: input.name,
            // FR-AGENT-17: a replace keeps what it doesn't name.
            enabled: input.enabled ?? before?.enabled ?? true,
            ...(input.public === undefined ? {} : { public: input.public }),
            rule,
          },
        }),
      );
      return {
        campaign: s.campaign,
        character: { id: c.id, name: c.name },
        triggerId: r.triggerId,
        name: input.name,
        created: !before,
        ...(required ? { requiresPresetId: required.id } : {}),
      };
    }),
  async plan(ctx, input) {
    const e = await planCharacter(ctx, input.characterId, ["characterId"]);
    if (!e) return `character_put_trigger: "${input.name}"`;
    const stored = (await ctx.world.triggers()).filter((t) => t.characterId === e.id);
    const before = input.id === undefined ? undefined : stored.find((t) => t.id === input.id);
    if (input.id !== undefined && !before) ctx.issue(["id"], `No trigger ${input.id} on ${e.name}`);
    const planned = ctx.planned<Named>(plannedTriggersKey(e.id));
    const all = overlay(
      stored.map((t): Named => ({ id: t.id, name: t.name })),
      planned,
    );
    const taken = all.find(
      (t) => (input.id === undefined || t.id !== input.id) && key(t.name) === key(input.name),
    );
    if (taken) {
      ctx.issue(
        ["name"],
        taken.id
          ? nameTaken("trigger", e.name, input.name, taken.id)
          : `Name "${input.name}" is already used by call ${taken.call}`,
      );
    }
    if (!before) {
      const creates = ctx.planned<number>(PLANNED_TRIGGER_CREATES);
      if (all.length >= CHARACTER_TRIGGERS_MAX) {
        ctx.issue(["characterId"], `At most ${CHARACTER_TRIGGERS_MAX} triggers per character`);
      } else if ((await ctx.world.triggers()).length + creates.length >= CAMPAIGN_TRIGGERS_MAX) {
        ctx.issue(["characterId"], `At most ${CAMPAIGN_TRIGGERS_MAX} triggers per campaign`);
      }
      creates.push(ctx.call);
    }
    if (!taken) planned.push({ id: input.id ?? null, name: input.name, call: ctx.call });

    const presets = planPresets(ctx, e.id);
    if (input.requiresPreset !== undefined) {
      const p = pickPreset(presets, input.requiresPreset, e.name, "rule.requires.preset");
      if (!p.ok) ctx.issue(["requiresPreset"], p.message);
    } else if (input.rule.requires) {
      const ref = input.rule.requires.preset;
      const known =
        isBuiltinPresetKey(ref) ||
        presets.some((p) => p.id === ref) ||
        ctx.world.presets.some((p) => p.id === ref && p.characterId === null);
      if (!known) ctx.issue(["rule", "requires", "preset"], "Requires: no such preset");
    }
    const every = input.rule.every;
    if (typeof every === "object") {
      const f = planFeatures(ctx, e.id).find((r) => r.id === every.feature);
      if (!f || !hasUses({ usesMax: f.usesMax ?? undefined })) {
        ctx.issue(["rule", "every", "feature"], "Uses: a feature row with uses");
      }
    }
    const bad = checkRuleForOwner(input.rule, {
      kind: "character",
      values: formulaOwnerOf(e.statBlock),
    });
    if (bad) ctx.issue(["rule", ...bad.path], bad.message);
    const requires = input.requiresPreset ?? input.rule.requires?.preset;
    return `character_put_trigger: ${before ? "replace" : "add"} "${input.name}" on ${e.name}${requires ? `, requires "${requires}"` : ""}`;
  },
});

// ---- character_toggle_preset ----

/** FR-AGENT-37: `ToggleInput` without `force` / `overspend`; a strict object refuses both. */
export const ToggleToolInput = z
  .strictObject({
    characterId: ToggleInput.shape.characterId,
    presetId: ToggleInput.shape.presetId.optional(),
    presetName: PresetName.optional().meta({
      description: "The character's preset by name; may be planned earlier in the plan",
    }),
    on: ToggleInput.shape.on,
  })
  .superRefine((v, ctx) => {
    if ((v.presetId === undefined) === (v.presetName === undefined)) {
      ctx.addIssue({ code: "custom", path: ["presetId"], message: ONE_PRESET });
    }
  });
export type ToggleToolInput = z.output<typeof ToggleToolInput>;

const characterTogglePreset = defineTool({
  name: "character_toggle_preset",
  description:
    "Switch one of a player character's presets on or off, as the sheet's switch does: on spends a " +
    "use of its linked feature row, and with none left the refusal is reported (no force, no " +
    "overspend). Already in that state → no change. `presetName` may replace `presetId`.",
  input: ToggleToolInput,
  write: true,
  run: ({ caller }, input) =>
    caller.ws({ write: true }, async (s) => {
      const c = characterOf(s, input.characterId);
      const presetId =
        input.presetId ??
        orInvalid(
          pickPreset(presetsOn(s, c.id), input.presetName as string, c.name, "presetId"),
          "presetName",
        ).id;
      const r = ToggleResult.parse(
        await s.intent(MOD_INTENTS.toggle, { characterId: c.id, presetId, on: input.on }),
      );
      return {
        campaign: s.campaign,
        character: { id: c.id, name: c.name },
        presetId,
        on: input.on,
        effectId: r.effectId,
      };
    }),
  async plan(ctx, input) {
    const state = input.on ? "on" : "off";
    const e = await planCharacter(ctx, input.characterId, ["characterId"]);
    const shown = input.presetName ?? input.presetId;
    if (!e) return `character_toggle_preset: "${shown}" ${state}`;
    const presets = planPresets(ctx, e.id);
    let target: Named | undefined;
    if (input.presetName !== undefined) {
      const p = pickPreset(presets, input.presetName, e.name, "presetId");
      if (p.ok) target = p.row;
      else ctx.issue(["presetName"], p.message);
    } else {
      target = presets.find((p) => p.id === input.presetId);
      if (!target) ctx.issue(["presetId"], `No preset ${input.presetId} on ${e.name}`);
    }
    const stored = ctx.world.presets.find((p) => p.id === target?.id);
    if (input.on && stored && !toggleOn(stored, ctx.world.effects)) {
      const sheet = ctx.world.sheets.find((x) => x.id === e.id);
      const uses = presetUses(
        stored,
        sheet?.features.map((f) => ({ ...f, id: f.id ?? "" })),
      );
      const refilled = ctx
        .planned<PlannedFeature>(plannedFeaturesKey(e.id))
        .some((f) => f.id === stored.usesFeatureId);
      if (uses?.state === "ok" && uses.left <= 0 && !refilled) {
        ctx.issue(["on"], `No ${uses.name} uses left`);
      }
    }
    return `character_toggle_preset: "${target?.name ?? shown}" ${state} on ${e.name}`;
  },
});

registerTools(characterEffects, characterPutPreset, characterPutTrigger, characterTogglePreset);
