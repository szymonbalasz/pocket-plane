// Map effect `fx` (FR-VFX-03, -05, spell-fx §8, ADR-0071): `{preset, params, spellId?}`, JSON ≤
// 200 B. Two strictness levels: the stored / wire shape (`FxRecord`, `SpellRowFxRecord`) accepts
// any preset key, so a newer server's preset parses on an older client (nothing drawn, §11); the
// write shapes (`Fx`, `SpellRowFx`) take only catalogue presets and parse their params (defaults
// filled). A leaf module (zod + the catalogue): `@shared/combat-extras/schemas` imports it.
import { z } from "zod";
import { presetOf } from "./presets";

/** FR-VFX-03: the JSON of a map effect is at most 200 UTF-8 bytes. */
export const FX_MAX_BYTES = 200;

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

const Id = z.string().min(1).max(64);
export const FxPresetKey = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "Preset keys are kebab-case" });
const FxParams = z.record(
  z.string().min(1).max(40),
  z.union([z.string().max(40), z.number(), z.boolean()]),
);

const capped = <S extends z.ZodType>(s: S) =>
  s.refine((v) => bytes(v) <= FX_MAX_BYTES, {
    message: `A map effect is at most ${FX_MAX_BYTES} bytes`,
  });

/** `effect.fx` as stored and sent (FR-VFX-03): any kebab-case preset key. */
export const FxRecord = capped(
  z.strictObject({ preset: FxPresetKey, params: FxParams, spellId: Id.optional() }),
);
export type FxRecord = z.infer<typeof FxRecord>;

/** `spells[].fx` as stored and sent (FR-VFX-05): the row's map effect, no `spellId`. */
export const SpellRowFxRecord = capped(z.strictObject({ preset: FxPresetKey, params: FxParams }));
export type SpellRowFxRecord = z.infer<typeof SpellRowFxRecord>;

/** Catalogue check + params parse (defaults filled); unknown preset / bad params → issues. */
function normalize<T extends { preset: string; params: unknown }>(v: T, ctx: z.RefinementCtx): T {
  const p = presetOf(v.preset);
  if (!p) {
    ctx.addIssue({ code: "custom", path: ["preset"], message: `Unknown preset "${v.preset}"` });
    return z.NEVER;
  }
  const r = p.params.safeParse(v.params);
  if (!r.success) {
    for (const i of r.error.issues) {
      ctx.addIssue({ code: "custom", path: ["params", ...i.path], message: i.message });
    }
    return z.NEVER;
  }
  const out = { ...v, params: r.data };
  if (bytes(out) > FX_MAX_BYTES) {
    ctx.addIssue({ code: "custom", message: `A map effect is at most ${FX_MAX_BYTES} bytes` });
    return z.NEVER;
  }
  return out;
}

const writeParams = z.record(z.string().min(1).max(40), z.unknown()).default({});

/** FR-VFX-03 write shape (`vfx.setEffectFx`): catalogue preset, params parsed, ≤ 200 B. */
export const Fx = z
  .strictObject({ preset: FxPresetKey, params: writeParams, spellId: Id.optional() })
  .transform(normalize) as unknown as z.ZodType<FxRecord, unknown>;

/** FR-VFX-05 write shape (`char.putRow` spell rows): catalogue preset, params parsed, ≤ 200 B. */
export const SpellRowFx = z
  .strictObject({ preset: FxPresetKey, params: writeParams })
  .transform(normalize) as unknown as z.ZodType<SpellRowFxRecord, unknown>;
