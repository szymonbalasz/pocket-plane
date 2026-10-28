// Domain events of spell-fx (VFX §9, ADR-0071). Logged, not undoable. `vfx.cast` emits the
// effect's own combat-extras events (`ConcentrationSet` / `EffectsAdded`), so only the map-effect
// edit has an event of its own. Hit cues are transient server signals, never events.
import { z } from "zod";
import { defineEvent } from "./types";

/** `vfx.setEffectFx` (FR-VFX-09): the `effect` with its new `fx` (or none). */
export const EffectFxSet = defineEvent({
  type: "EffectFxSet",
  payload: z.strictObject({ effectId: z.string() }),
  logged: true,
  undoable: false,
});
