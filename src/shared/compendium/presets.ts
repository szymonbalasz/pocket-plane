// FR-CMP-29 preset resolution (seams S5), one pure fn for the server (Add to sheet) and the view
// ("Preset: ‹name›"). Trigger presets only: a feature's `presetKey` (a MOD built-in trigger key),
// else its inline `preset` (a `TriggerRule`), else the built-in trigger listing its `featureKey`.
// Spells resolve by built-in only. Effect presets (e.g. `rage`) never resolve here. An entry with
// none of its own inherits from what it replaces (FR-CMPX-15, server: `inheritedPreset`).
import {
  getTriggerPreset,
  triggerPresetForFeature,
} from "@shared/effect-modifiers/trigger-presets";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { type CompendiumKind, featureKey } from "./schemas";

export interface PresetSource {
  id: string;
  kind: CompendiumKind;
  name: string;
  source: string | null;
  sourceKey: string | null;
  body: unknown;
}

/** What `addTriggerFromPreset` takes, plus the name the view shows. */
export type ResolvedPreset =
  | { via: "presetKey" | "builtin"; name: string; from: { presetKey: string } }
  | { via: "preset"; name: string; from: { name: string; rule: TriggerRule } };

/** The built-in trigger listing a feature key (`<source>:<sourceKey>`), if any. */
export function builtinPreset(key: string): ResolvedPreset | null {
  const p = triggerPresetForFeature(key);
  return p ? { via: "builtin", name: p.name, from: { presetKey: p.key } } : null;
}

export function resolvePreset(e: PresetSource): ResolvedPreset | null {
  if (e.kind !== "feature" && e.kind !== "spell") return null;
  if (e.kind === "feature") {
    const b = e.body as { presetKey?: string; preset?: TriggerRule };
    if (b.presetKey !== undefined) {
      const p = getTriggerPreset(b.presetKey);
      // An unknown key (MOD renamed it) resolves to nothing; MOD would refuse it anyway.
      return p ? { via: "presetKey", name: p.name, from: { presetKey: p.key } } : null;
    }
    if (b.preset !== undefined) {
      return { via: "preset", name: e.name, from: { name: e.name, rule: b.preset } };
    }
  }
  return builtinPreset(featureKey(e));
}
