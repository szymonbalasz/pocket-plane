// Built-in presets (FR-MOD-05, MOD §8.3): code data, own words, no rules text (ADR-0018). Never
// stored, never sent; both clients and the server import them. Tier-tagged: a build ships each
// built-in with only the parts of the tiers it has built, and hides a built-in with none left.
import {
  type AnyModifier,
  BUILT_TIER,
  type BuiltinPresetKey,
  type Modifier,
  modifierTier,
} from "./schemas";

export interface BuiltinPresetDef {
  key: BuiltinPresetKey;
  name: string;
  /** Every tier's parts; `tier` = the tier that builds it (MOD §2). */
  modifiers: readonly { tier: number; modifier: AnyModifier }[];
  durationRounds: number | null;
  concentration: boolean;
  note: string;
}

/** A built-in at a built tier: only the parts of tiers ≤ that tier. */
export interface BuiltinPreset {
  key: BuiltinPresetKey;
  name: string;
  modifiers: Modifier[];
  durationRounds: number | null;
  concentration: boolean;
  note: string;
}

const part = (modifier: AnyModifier) => ({ tier: modifierTier(modifier), modifier });
const PHYSICAL = ["bludgeoning", "piercing", "slashing"] as const;

/** MOD §8.3, in the order preset lists show them. */
export const BUILTIN_PRESET_DEFS: readonly BuiltinPresetDef[] = [
  {
    key: "bless",
    name: "Bless",
    modifiers: [
      part({ kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 }),
      part({ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: 1 }),
    ],
    durationRounds: 10,
    concentration: true,
    note: "",
  },
  {
    key: "bane",
    name: "Bane",
    modifiers: [
      part({ kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: -1 }),
      part({ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: -1 }),
    ],
    durationRounds: 10,
    concentration: true,
    note: "",
  },
  {
    key: "rage",
    name: "Rage",
    modifiers: [
      part({ kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 }),
      part({ kind: "mode", on: { roll: "check", abilities: ["str"] }, mode: "advantage" }),
      part({ kind: "mode", on: { roll: "save", abilities: ["str"] }, mode: "advantage" }),
      part({ kind: "defense", types: [...PHYSICAL], level: "resistance" }),
    ],
    durationRounds: 10,
    concentration: false,
    note: "Weapon damage includes ranged attacks.",
  },
  {
    key: "hunters-mark",
    name: "Hunter's Mark",
    modifiers: [
      part({ kind: "dice", on: { roll: "damage", via: "weapon" }, dice: "1d6", sign: 1 }),
    ],
    durationRounds: null,
    concentration: true,
    note: "Only against the marked creature: end it or edit the total for other targets.",
  },
  {
    key: "guidance",
    name: "Guidance",
    modifiers: [part({ kind: "dice", on: { roll: "check" }, dice: "1d4", sign: 1 })],
    durationRounds: 1,
    concentration: true,
    note: "Once: end it after the roll.",
  },
  {
    key: "resistance",
    name: "Resistance",
    modifiers: [part({ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: 1 })],
    durationRounds: 1,
    concentration: true,
    note: "Once: end it after the roll.",
  },
  {
    key: "shield-of-faith",
    name: "Shield of Faith",
    modifiers: [part({ kind: "flat", on: { roll: "ac" }, value: 2 })],
    durationRounds: 100,
    concentration: true,
    note: "",
  },
  {
    key: "reckless",
    name: "Reckless Attack",
    modifiers: [part({ kind: "mode", on: { roll: "attack", via: "weapon" }, mode: "advantage" })],
    durationRounds: 1,
    concentration: false,
    note: "Attacks against you: the DM's call.",
  },
  {
    key: "dodge",
    name: "Dodge",
    modifiers: [
      part({ kind: "mode", on: { roll: "save", abilities: ["dex"] }, mode: "advantage" }),
    ],
    durationRounds: 1,
    concentration: false,
    note: "Attacks against you: the DM's call.",
  },
];

/** FR-MOD-05: the built-ins at `tier` (default: this build's), hiding those with no part left. */
export function builtinPresets(tier: number = BUILT_TIER): BuiltinPreset[] {
  return BUILTIN_PRESET_DEFS.flatMap((d) => {
    const modifiers = d.modifiers.filter((p) => p.tier <= tier).map((p) => p.modifier as Modifier);
    if (modifiers.length === 0) return [];
    return [
      {
        key: d.key,
        name: d.name,
        modifiers,
        durationRounds: d.durationRounds,
        concentration: d.concentration,
        note: d.note,
      },
    ];
  });
}

/** This build's built-in by key; undefined for an unknown or hidden one. */
export function builtinPreset(key: string): BuiltinPreset | undefined {
  return builtinPresets().find((p) => p.key === key);
}
