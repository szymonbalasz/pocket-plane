// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Built-in trigger presets (FR-MOD-46, MOD §8.6; #209): five, all SRD-based, own words, no rules
// text (ADR-0018). Code data: never stored, never sent; "Start from" copies one into the editor.
// No non-SRD built-in: Divine Fury is trigger data on a fixture character, not a preset here.
import type { RuleOwnerKind, TriggerRule } from "./triggers";

export const TRIGGER_PRESET_KEYS = [
  "sneak-attack",
  "hunters-mark",
  "colossus-slayer",
  "martial-advantage",
  "regeneration",
] as const;
export type TriggerPresetKey = (typeof TRIGGER_PRESET_KEYS)[number];

export const isTriggerPresetKey = (k: string): k is TriggerPresetKey =>
  (TRIGGER_PRESET_KEYS as readonly string[]).includes(k);

export interface TriggerPreset {
  key: TriggerPresetKey;
  /** Default trigger name (the part label). */
  name: string;
  /** Who it is written for: a character's sheet or a monster definition (§8.6 note). */
  owner: RuleOwnerKind;
  /** Default `public` (FR-MOD-47): on for character triggers, off for monster ones. */
  public: boolean;
  rule: TriggerRule;
  /** Compendium keys it implements, `<source>:<sourceKey>` (seams S5). */
  featureKeys: readonly string[];
}

/** MOD §8.6, in the order "Start from" lists them. */
export const TRIGGER_PRESETS: readonly TriggerPreset[] = [
  {
    key: "sneak-attack",
    name: "Sneak Attack",
    owner: "character",
    public: true,
    rule: {
      on: "hit",
      when: [
        { if: "via", via: "weapon" },
        { if: "mode", modes: ["normal", "advantage"] },
        { if: "mode", modes: ["advantage"], soft: true },
        { if: "ask", note: "finesse or ranged; or an ally within 5 ft" },
      ],
      every: "turn",
      then: { do: "damage", formula: "(ceil(level(rogue) / 2))d6", type: null },
    },
    featureKeys: ["srd-5.1:feature/rogue/sneak-attack"],
  },
  {
    key: "hunters-mark",
    name: "Hunter's Mark",
    owner: "character",
    public: true,
    rule: {
      on: "hit",
      when: [
        { if: "via", via: "weapon" },
        { if: "targetMarked", preset: "hunters-mark" },
      ],
      every: "each",
      then: { do: "damage", formula: "1d6", type: null },
    },
    featureKeys: ["srd-5.1:spell/hunters-mark"],
  },
  {
    key: "colossus-slayer",
    name: "Colossus Slayer",
    owner: "character",
    public: true,
    rule: {
      on: "hit",
      when: [{ if: "via", via: "weapon" }, { if: "targetHurt" }],
      every: "turn",
      then: { do: "damage", formula: "1d8", type: null },
    },
    featureKeys: ["srd-5.1:feature/ranger/colossus-slayer"],
  },
  {
    key: "martial-advantage",
    name: "Martial Advantage",
    owner: "definition",
    public: false,
    rule: {
      on: "hit",
      when: [
        { if: "via", via: "weapon" },
        { if: "ask", note: "an ally within 5 ft of the target" },
      ],
      every: "turn",
      then: { do: "damage", formula: "2d6", type: null },
    },
    featureKeys: [],
  },
  {
    key: "regeneration",
    name: "Regeneration",
    owner: "definition",
    public: false,
    rule: {
      on: "turnStart",
      when: [],
      every: "each",
      then: {
        do: "remind",
        text: "regain {value} HP unless it took acid or fire damage",
        value: "10",
      },
    },
    featureKeys: [],
  },
];

export const getTriggerPreset = (key: string): TriggerPreset | undefined =>
  TRIGGER_PRESETS.find((p) => p.key === key);
