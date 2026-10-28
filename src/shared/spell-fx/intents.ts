// spell-fx WS intents (VFX §9, protocol): `vfx.cast` and `vfx.setEffectFx`. Strict zod; none
// optimistic. Hit cues are server-sent only (`./cue`).
import { z } from "zod";
import { Fx } from "./fx";

export const VFX_INTENTS = {
  cast: "vfx.cast",
  setEffectFx: "vfx.setEffectFx",
} as const;

const Id = z.string().min(1).max(64);

/** FR-VFX-07: start the spell row's effect (concentration or custom) with its map effect. */
export const CastInput = z.strictObject({ creatureId: Id, spellId: Id });
export type CastInput = z.input<typeof CastInput>;
export const CastResult = z.object({ effectId: z.string() });
export type CastResult = z.infer<typeof CastResult>;

/** FR-VFX-09: set (`fx`) or clear (`null`) the map effect of an active effect. */
export const SetEffectFxInput = z.strictObject({ effectId: Id, fx: Fx.nullable() });
export type SetEffectFxInput = z.input<typeof SetEffectFxInput>;

/** FR-VFX-07 conflicts (named in the spec). */
export const noFxMessage = (spell: string) => `No map effect on ${spell}`;
export const alreadyActiveMessage = (spell: string) => `${spell} is already active`;
export const ROW_DELETED_MESSAGE = "Row was deleted";
