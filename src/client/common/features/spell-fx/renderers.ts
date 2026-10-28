// Aura renderer registry (FR-VFX-01, ADR-0071): one renderer per catalogue preset (`presets.ts`);
// a new preset is one renderer file and one line here. `bun test` checks every preset has one.
import type { AuraRenderer } from "./aura-types";
import { shadowOfMoilRenderer } from "./renderers/shadow-of-moil";
import { spiritGuardiansRenderer } from "./renderers/spirit-guardians";

export const auraRenderers: readonly AuraRenderer[] = [
  spiritGuardiansRenderer, // spirit-guardians (FR-VFX-02)
  shadowOfMoilRenderer, // shadow-of-moil (FR-VFX-02)
];

const byPreset = new Map(auraRenderers.map((r) => [r.preset, r]));

export const rendererOf = (preset: string): AuraRenderer | null => byPreset.get(preset) ?? null;
