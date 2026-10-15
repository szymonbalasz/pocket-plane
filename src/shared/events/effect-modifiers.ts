// Domain events of effect-modifiers (MOD §9). All logged; none undoable (corrected by the
// inverse, OQ-CBTX-20). Shared definitions (fix/mod-core); build/effect-modifiers emits them.
// Payloads carry ids, keys and flags, never labels. WS = generic record changes.
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);

/** `mod.putPreset`: the `effect-preset` (create or replace; FR-MOD-06, -07). */
export const EffectPresetSaved = defineEvent({
  type: "EffectPresetSaved",
  payload: z.strictObject({ presetId: Id }),
  logged: true,
  undoable: false,
});

/** `mod.deletePreset`: the `effect-preset` (a customised built-in goes back to the built-in). */
export const EffectPresetDeleted = defineEvent({
  type: "EffectPresetDeleted",
  payload: z.strictObject({ presetId: Id }),
  logged: true,
  undoable: false,
});

/**
 * `mod.apply`: `effect` creates, one per target not skipped; a started / replaced concentration
 * (FR-MOD-09, -10). `presetKey` = the built-in key or the preset id.
 */
export const PresetApplied = defineEvent({
  type: "PresetApplied",
  payload: z.strictObject({
    presetKey: Id,
    effectIds: z.array(Id).max(20),
    concentrationId: Id.optional(),
  }),
  logged: true,
  undoable: false,
});

/** `mod.toggle`: `effect` create / end, `effect-preset` `activeEffectId` (FR-MOD-11). */
export const EffectToggled = defineEvent({
  type: "EffectToggled",
  payload: z.strictObject({
    characterId: Id,
    presetId: Id,
    on: z.boolean(),
    effectId: Id,
  }),
  logged: true,
  undoable: false,
});

/** `mod.setModifiers`: the `effect` (FR-MOD-08). */
export const EffectModifiersSet = defineEvent({
  type: "EffectModifiersSet",
  payload: z.strictObject({ effectId: Id }),
  logged: true,
  undoable: false,
});
