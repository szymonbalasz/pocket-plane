// Built-in presets (FR-MOD-05, MOD §8.3): code data, own words, no rules text (ADR-0018). Never
// stored, never sent; both clients and the server import them. Tier-tagged: a build ships each
// built-in with only the parts of the tiers it has built, and hides a built-in with none left.
// Rule triggers (T) turn `hunters-mark` into a **mark** (OQ-MOD-27): no modifiers, applied to the
// hunted creature with the ranger as source; the ranger's `hunters-mark` trigger adds the d6.
import {
  type AnyModifier,
  BUILT_TIER,
  type BuiltinPresetKey,
  type Modifier,
  modifierTier,
} from "./schemas";

/** Rule triggers are built (R4): marks replace the parts they stand in for (FR-MOD-05). */
export const TRIGGERS_BUILT = true;

export interface BuiltinPresetDef {
  key: BuiltinPresetKey;
  name: string;
  /**
   * Every tier's parts; `tier` = the tier that builds it (MOD §2). `beforeTriggers`: shipped
   * only while rule triggers are unbuilt (Hunter's Mark's d6, "[1 only]" in §8.3).
   */
  modifiers: readonly { tier: number; modifier: AnyModifier; beforeTriggers?: true }[];
  /** With rule triggers built, a **mark** (0 modifiers, named by a `targetMarked` filter). */
  mark?: true;
  durationRounds: number | null;
  concentration: boolean;
  note: string;
  /** With rule triggers built, replaces `note`. */
  markNote?: string;
}

/** A built-in at a built tier: only the parts of tiers ≤ that tier. */
export interface BuiltinPreset {
  key: BuiltinPresetKey;
  name: string;
  /** Empty only for a mark. */
  modifiers: Modifier[];
  /** FR-MOD-05: a mark (Hunter's Mark): apply it to the target with the trigger's owner as source. */
  mark: boolean;
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
      {
        ...part({ kind: "dice", on: { roll: "damage", via: "weapon" }, dice: "1d6", sign: 1 }),
        beforeTriggers: true,
      },
    ],
    mark: true,
    durationRounds: null,
    concentration: true,
    note: "Only against the marked creature: end it or edit the total for other targets.",
    markNote: "Apply to the hunted creature, the ranger as source; their trigger adds the d6.",
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

/**
 * FR-MOD-05: the built-ins at `tier` and `triggers` (default: this build's), hiding those with no
 * part left; a mark (rule triggers built) shows with none.
 */
export function builtinPresets(
  tier: number = BUILT_TIER,
  triggers: boolean = TRIGGERS_BUILT,
): BuiltinPreset[] {
  return BUILTIN_PRESET_DEFS.flatMap((d) => {
    const modifiers = d.modifiers
      .filter((p) => p.tier <= tier && !(triggers && p.beforeTriggers))
      .map((p) => p.modifier as Modifier);
    const mark = triggers && d.mark === true;
    if (modifiers.length === 0 && !mark) return [];
    return [
      {
        key: d.key,
        name: d.name,
        modifiers,
        mark,
        durationRounds: d.durationRounds,
        concentration: d.concentration,
        note: (mark && d.markNote) || d.note,
      },
    ];
  });
}

/** This build's built-in by key; undefined for an unknown or hidden one. */
export function builtinPreset(key: string): BuiltinPreset | undefined {
  return builtinPresets().find((p) => p.key === key);
}
