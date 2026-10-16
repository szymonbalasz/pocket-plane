// effect-modifiers WS intents and results (MOD §9; protocol §34). Strict zod; none optimistic.
// DM-only unless MOD §10 lists the owner (`mod.putPreset`, `mod.deletePreset`, `mod.toggle`).
import { EffectLabel, TargetRef } from "@shared/combat-extras/intents";
import { DURATION_ROUNDS_MAX, EFFECT_TARGETS_MAX } from "@shared/combat-extras/schemas";
import { z } from "zod";
import {
  BUILTIN_PRESET_KEYS,
  Modifiers,
  PRESET_DURATION_MAX,
  PRESET_NOTE_MAX,
  PresetModifiers,
  presetModifiersIssue,
} from "./schemas";

export const MOD_INTENTS = {
  putPreset: "mod.putPreset",
  deletePreset: "mod.deletePreset",
  apply: "mod.apply",
  toggle: "mod.toggle",
  setModifiers: "mod.setModifiers",
} as const;

const Id = z.string().min(1).max(64);
const BuiltinKey = z.enum(BUILTIN_PRESET_KEYS);
const Duration = z.int().min(1).max(Math.min(PRESET_DURATION_MAX, DURATION_ROUNDS_MAX));

/**
 * A preset as the DM or owner writes it (MOD §8.2). No `id` → create; with `id` → replace (same
 * `characterId` and `key`). `characterId` null = campaign preset (DM); `key` customises that
 * built-in (campaign presets only). The name becomes the effect label (CBTX label rules).
 * `originKey` (FR-MOD-36): the built-in key "Start from" copied; only a built-in key; absent on
 * a replace = kept, on a create = null; never with `key`. `modifiers` 1–6; 0 only on a campaign
 * preset (a **mark**, FR-MOD-05).
 */
export const PresetInput = z
  .strictObject({
    id: Id.optional(),
    characterId: Id.nullable(),
    key: BuiltinKey.nullable().default(null),
    originKey: BuiltinKey.nullable().optional(),
    name: EffectLabel,
    modifiers: PresetModifiers,
    durationRounds: Duration.nullable(),
    concentration: z.boolean(),
    note: z
      .string()
      .max(PRESET_NOTE_MAX * 2)
      .transform((s) => s.trim())
      .refine((s) => s.length <= PRESET_NOTE_MAX, {
        message: `Note must be at most ${PRESET_NOTE_MAX} characters`,
      })
      .default(""),
  })
  .superRefine((v, ctx) => {
    if (v.key !== null && v.characterId !== null) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "Key on campaign presets only" });
    }
    const empty = presetModifiersIssue(v);
    if (empty) ctx.addIssue({ code: "custom", path: ["modifiers"], message: empty });
    if (v.key !== null && v.originKey) {
      ctx.addIssue({
        code: "custom",
        path: ["originKey"],
        message: "A customised built-in has no origin",
      });
    }
  });
export type PresetInput = z.input<typeof PresetInput>;

export const PutPresetInput = z.strictObject({ preset: PresetInput });
export type PutPresetInput = z.input<typeof PutPresetInput>;
export const PutPresetResult = z.object({ presetId: z.string() });
export type PutPresetResult = z.infer<typeof PutPresetResult>;

export const DeletePresetInput = z.strictObject({ presetId: Id });
export type DeletePresetInput = z.input<typeof DeletePresetInput>;

/** `{key}` = a built-in (or its customisation); `{presetId}` = a campaign preset. */
export const PresetRef = z.union([
  z.strictObject({ key: BuiltinKey }),
  z.strictObject({ presetId: Id }),
]);
export type PresetRef = z.infer<typeof PresetRef>;

/**
 * FR-MOD-09/10. `durationRounds`: absent = the preset's, null = none. Linking and starting
 * concentration need a source.
 */
export const ApplyInput = z
  .strictObject({
    targets: z.array(TargetRef).min(1).max(EFFECT_TARGETS_MAX),
    preset: PresetRef,
    sourceCombatantId: Id.optional(),
    durationRounds: Duration.nullable().optional(),
    linkConcentration: z.boolean().optional(),
    startConcentration: z.boolean().optional(),
    secret: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    for (const k of ["linkConcentration", "startConcentration"] as const) {
      if (v[k] && v.sourceCombatantId === undefined) {
        ctx.addIssue({ code: "custom", path: [k], message: "Concentration needs a source" });
      }
    }
  });
export type ApplyInput = z.input<typeof ApplyInput>;
export const ApplyResult = z.object({
  effectIds: z.array(z.string()),
  /** Names of targets skipped: an active effect of the same preset (FR-MOD-09). */
  skipped: z.array(z.string()),
});
export type ApplyResult = z.infer<typeof ApplyResult>;

/** FR-MOD-11: `force` (DM only) is tier 3's "on without spending a use". */
export const ToggleInput = z.strictObject({
  characterId: Id,
  presetId: Id,
  on: z.boolean(),
  force: z.boolean().optional(),
});
export type ToggleInput = z.input<typeof ToggleInput>;
export const ToggleResult = z.object({ effectId: z.string().nullable() });
export type ToggleResult = z.infer<typeof ToggleResult>;

/** FR-MOD-08: an active `custom` effect's list (0–6). */
export const SetModifiersInput = z.strictObject({ effectId: Id, modifiers: Modifiers });
export type SetModifiersInput = z.input<typeof SetModifiersInput>;
