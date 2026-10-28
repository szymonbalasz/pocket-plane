// FX preset catalogue (FR-VFX-01, -02, ADR-0071). APPEND-ONLY (AGENTS §9.9): a new preset is one
// entry here (+ one client renderer file and one renderer registry line). Shared: the server
// validates `fx` against it, clients draw from it. A leaf module (zod only): the `effect` record
// schema imports it through `./fx`.
import { z } from "zod";

/** Visual-only reactions (FR-VFX-15, -16): a turn passing inside the aura, a hit on its anchor. */
export const FX_REACTIONS = ["turnInside", "hitOnAnchor"] as const;
export type FxReaction = (typeof FX_REACTIONS)[number];

/** Param values a preset may declare (strings, numbers, booleans; the 200 B cap holds the rest). */
export type FxParamValue = string | number | boolean;
export type FxParamsOut = Record<string, FxParamValue>;

export interface FxPreset {
  /** Kebab-case, unique. */
  key: string;
  label: string;
  /** Lower-case spell names this preset suggests itself for (FR-VFX-04); unique across presets. */
  names: readonly string[];
  /** Parses params, filling defaults (FR-VFX-03). */
  params: z.ZodType<FxParamsOut, unknown>;
  /** The aura's radius in feet (affected cells, turn reaction); absent = none. */
  radiusFt?(params: FxParamsOut): number;
  reactions?: readonly FxReaction[];
}

function definePreset<S extends z.ZodType<FxParamsOut, unknown>>(p: {
  key: string;
  label: string;
  names: readonly string[];
  params: S;
  radiusFt?(params: z.output<S>): number;
  reactions?: readonly FxReaction[];
}): FxPreset {
  return p as unknown as FxPreset;
}

/** Radius in feet: `min`–`max`, step 5. */
const radius = (min: number, max: number, dflt: number) =>
  z.int().min(min).max(max).multipleOf(5).default(dflt);

export const SPIRIT_GUARDIANS_VARIANTS = ["radiant", "necrotic"] as const;

/** FR-VFX-02: Spirit Guardians (radiant gold-white or necrotic green), 15 ft by default. */
export const spiritGuardians = definePreset({
  key: "spirit-guardians",
  label: "Spirit Guardians",
  names: ["spirit guardians"],
  params: z.strictObject({
    variant: z.enum(SPIRIT_GUARDIANS_VARIANTS).default("radiant"),
    radiusFt: radius(5, 60, 15),
  }),
  radiusFt: (p) => p.radiusFt,
  reactions: ["turnInside"],
});

/** FR-VFX-02: Shadow of Moil, 10 ft by default. */
export const shadowOfMoil = definePreset({
  key: "shadow-of-moil",
  label: "Shadow of Moil",
  names: ["shadow of moil"],
  params: z.strictObject({ radiusFt: radius(5, 30, 10) }),
  radiusFt: (p) => p.radiusFt,
  reactions: ["hitOnAnchor"],
});

export const fxPresets: readonly FxPreset[] = [
  spiritGuardians,
  shadowOfMoil,
  // New presets: one line here (FR-VFX-01).
];

const byKey = new Map(fxPresets.map((p) => [p.key, p]));

/** The catalogue entry for `key`, or null (unknown: a newer server's preset, FR-VFX §11). */
export const presetOf = (key: string): FxPreset | null => byKey.get(key) ?? null;

/** FR-VFX-04: the preset whose `names` holds the trimmed, lower-cased spell name, else null. */
export function suggestPreset(spellName: string): FxPreset | null {
  const name = spellName.trim().toLowerCase();
  return fxPresets.find((p) => p.names.includes(name)) ?? null;
}
