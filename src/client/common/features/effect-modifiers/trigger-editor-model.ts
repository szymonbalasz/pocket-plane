// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Trigger editor drafts (FR-MOD-50, MOD §7 "Trigger editor"): flat, form-friendly fields for one
// rule; `ruleOfDraft` builds the §8.4 rule and the strict zod `PlayerTriggerRule` decides validity
// (the server validates again, with the owner's refs; a kept `{name}` ref of a player's copy
// resolves to the stored preset there, FR-MOD-47 #228). Pure; both clients.
import type { RollKind, RollVia } from "@shared/effect-modifiers/schemas";
import type { PutTriggerInput } from "@shared/effect-modifiers/trigger-intents";
import {
  type StartFromConfirm,
  type StartFromOwner,
  startFromTriggerPreset,
} from "@shared/effect-modifiers/trigger-presets";
import { TRIGGER_NAME_MAX } from "@shared/effect-modifiers/trigger-records";
import {
  EVENT_EFFECTS,
  EVENT_FILTERS,
  PlayerTriggerRule,
  TO_HIT_MODES,
  TRIGGER_FILTERS_MAX,
  type TriggerEffect,
  type TriggerEvent,
  type TriggerFilterKind,
} from "@shared/effect-modifiers/triggers";
import type { Ability, DAMAGE_TYPES } from "@shared/entities/schemas";

export type ToHitMode = (typeof TO_HIT_MODES)[number];
export type EveryDraft = "each" | "turn" | "round" | "encounter" | "feature";
export type EffectKind = TriggerEffect["do"];
/** "attack" = null: the attack's own damage type. */
export type TypeDraft = (typeof DAMAGE_TYPES)[number] | "attack";

export interface FilterDraft {
  kind: TriggerFilterKind;
  /** `via`. */
  via: RollVia;
  /** `row`: names, comma-separated. */
  names: string;
  /** `roll`: the roll selector. */
  roll: RollKind;
  abilities: Ability[];
  rollVia: "any" | RollVia;
  /** `mode`. */
  modes: ToHitMode[];
  soft: boolean;
  /** `targetMarked`: a preset ref; `presetName` set = a player's redacted copy (FR-MOD-47). */
  preset: string;
  presetName: string | null;
  /** `ask`. */
  note: string;
}

export interface TriggerDraft {
  name: string;
  enabled: boolean;
  public: boolean;
  on: TriggerEvent;
  /** "" = no requirement; else a preset ref. `requiresName` set = a redacted copy. */
  requires: string;
  requiresName: string | null;
  when: FilterDraft[];
  every: EveryDraft;
  /** `every: feature`: the feature row id. */
  feature: string;
  effect: EffectKind;
  /** `damage` / `part` formula; `remind` value ("" = none). */
  formula: string;
  type: TypeDraft;
  mode: "advantage" | "disadvantage";
  text: string;
}

export const NO_REQUIRES = "";

export const newFilter = (kind: TriggerFilterKind): FilterDraft => ({
  kind,
  via: "weapon",
  names: "",
  roll: kind === "roll" ? "damage" : "attack",
  abilities: [],
  rollVia: "any",
  modes: ["advantage"],
  soft: false,
  preset: "hunters-mark",
  presetName: null,
  note: "",
});

const FIRST_EFFECT: Readonly<Record<TriggerEvent, EffectKind>> = {
  hit: "damage",
  roll: "part",
  turnStart: "remind",
};

export function blankTrigger(ownerKind: "character" | "definition"): TriggerDraft {
  return {
    name: "",
    enabled: true,
    public: ownerKind === "character",
    on: "hit",
    requires: NO_REQUIRES,
    requiresName: null,
    when: [newFilter("via")],
    every: "turn",
    feature: "",
    effect: "damage",
    formula: "1d6",
    type: "attack",
    mode: "advantage",
    text: "",
  };
}

function filterDraftOf(f: PlayerTriggerRule["when"][number]): FilterDraft {
  const d = newFilter(f.if);
  switch (f.if) {
    case "via":
      return { ...d, via: f.via };
    case "row":
      return { ...d, names: f.names.join(", ") };
    case "roll":
      return {
        ...d,
        roll: f.on.roll,
        abilities: [...(f.on.abilities ?? [])],
        rollVia: f.on.via ?? "any",
      };
    case "mode":
      return { ...d, modes: [...f.modes], soft: f.soft === true };
    case "targetMarked":
      return "name" in f
        ? { ...d, preset: "", presetName: f.name }
        : { ...d, preset: f.preset, presetName: null };
    case "ask":
      return { ...d, note: f.note };
    default:
      return d;
  }
}

/** A stored rule (DM row or a player's copy) as a draft. */
export function draftOfRule(
  t: { name: string; enabled: boolean; public: boolean },
  rule: PlayerTriggerRule,
): TriggerDraft {
  const r = rule.requires;
  const then = rule.then;
  return {
    name: t.name,
    enabled: t.enabled,
    public: t.public,
    on: rule.on,
    requires: r && "preset" in r ? r.preset : NO_REQUIRES,
    requiresName: r && "name" in r ? r.name : null,
    when: rule.when.map(filterDraftOf),
    every: typeof rule.every === "object" ? "feature" : rule.every,
    feature: typeof rule.every === "object" ? rule.every.feature : "",
    effect: then.do,
    formula:
      then.do === "damage" || then.do === "part"
        ? then.formula
        : then.do === "remind"
          ? (then.value ?? "")
          : "",
    type: then.do === "damage" ? (then.type ?? "attack") : "attack",
    mode: then.do === "mode" ? then.mode : "advantage",
    text: then.do === "remind" ? then.text : "",
  };
}

/**
 * "Start from ▸" (FR-MOD-46, R5's `startFromTriggerPreset`): the built-in for this owner as a
 * draft, plus the owner-specific fields the user must confirm (`requires`, a preselected feature).
 * Undefined for an unknown key or a built-in of the other owner kind.
 */
export function draftFromPreset(
  key: string,
  owner: StartFromOwner,
): { draft: TriggerDraft; confirm: StartFromConfirm[] } | undefined {
  const s = startFromTriggerPreset(key, owner);
  if (!s) return undefined;
  const t = s.draft;
  const draft = draftOfRule(
    { name: t.name, enabled: t.enabled ?? true, public: t.public ?? owner.kind === "character" },
    t.rule,
  );
  return { draft, confirm: s.confirm };
}

/** Filter kinds the event allows (MOD §8.4 table). */
export const filterKinds = (on: TriggerEvent): readonly TriggerFilterKind[] => EVENT_FILTERS[on];
export const effectKinds = (on: TriggerEvent): readonly EffectKind[] => EVENT_EFFECTS[on];
/** `turnStart` fires each time (review R6); `feature` on characters' hit triggers only (#223). */
export function everyOptions(
  on: TriggerEvent,
  ownerKind: "character" | "definition",
): EveryDraft[] {
  if (on === "turnStart") return ["each"];
  // #223: roll triggers can't spend a feature use (ROLL_FEATURE_UNSUPPORTED).
  return ownerKind === "character" && on === "hit"
    ? ["each", "turn", "round", "encounter", "feature"]
    : ["each", "turn", "round", "encounter"];
}

/**
 * The event changed: drop filters it doesn't allow, pick its first effect if the current one
 * doesn't fit, `each` for a turn start; a roll trigger gets its required `roll` filter.
 */
export function withEvent(
  d: TriggerDraft,
  on: TriggerEvent,
  ownerKind: "character" | "definition",
): TriggerDraft {
  const allowed = filterKinds(on);
  // Soft filters exist on hit triggers only.
  let when = d.when
    .filter((f) => allowed.includes(f.kind))
    .map((f) => (on === "hit" ? f : { ...f, soft: false }));
  if (on === "roll" && !when.some((f) => f.kind === "roll")) when = [newFilter("roll"), ...when];
  const effect = effectKinds(on).includes(d.effect) ? d.effect : FIRST_EFFECT[on];
  const every = everyOptions(on, ownerKind).includes(d.every) ? d.every : "each";
  return { ...d, on, when, effect, every };
}

const ROLL_ABILITY = (r: RollKind) => r === "save" || r === "check";
const ROLL_VIA = (r: RollKind) => r === "attack" || r === "damage";

function filterOf(f: FilterDraft): unknown {
  switch (f.kind) {
    case "via":
      return { if: "via", via: f.via };
    case "row":
      return {
        if: "row",
        names: f.names
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case "roll":
      return {
        if: "roll",
        on: {
          roll: f.roll,
          ...(ROLL_ABILITY(f.roll) && f.abilities.length ? { abilities: f.abilities } : {}),
          ...(ROLL_VIA(f.roll) && f.rollVia !== "any" ? { via: f.rollVia } : {}),
        },
      };
    case "mode":
      return {
        if: "mode",
        modes: TO_HIT_MODES.filter((m) => f.modes.includes(m)),
        ...(f.soft ? { soft: true } : {}),
      };
    case "targetMarked":
      // A player's kept `{name}` (FR-MOD-47): the server keeps the stored preset.
      return f.presetName !== null
        ? { if: "targetMarked", name: f.presetName }
        : { if: "targetMarked", preset: f.preset };
    case "ask":
      return { if: "ask", note: f.note.trim() };
    default:
      return { if: f.kind };
  }
}

function effectOf(d: TriggerDraft): unknown {
  const formula = d.formula.trim();
  switch (d.effect) {
    case "damage":
      return { do: "damage", formula, type: d.type === "attack" ? null : d.type };
    case "part":
      return { do: "part", formula };
    case "mode":
      return { do: "mode", mode: d.mode };
    case "remind":
      return { do: "remind", text: d.text.trim(), ...(formula ? { value: formula } : {}) };
  }
}

export type RuleOfDraft =
  | { ok: true; rule: PlayerTriggerRule }
  | { ok: false; message: string; path: (string | number)[] };

/** The draft's rule, or the first problem (zod's message and path). */
export function ruleOfDraft(d: TriggerDraft): RuleOfDraft {
  if (d.when.length > TRIGGER_FILTERS_MAX) {
    return { ok: false, message: `At most ${TRIGGER_FILTERS_MAX} filters`, path: ["when"] };
  }
  if (d.every === "feature" && !d.feature) {
    return { ok: false, message: "Pick a feature with uses", path: ["every", "feature"] };
  }
  const raw = {
    on: d.on,
    ...(d.requiresName !== null
      ? { requires: { name: d.requiresName } }
      : d.requires !== NO_REQUIRES
        ? { requires: { preset: d.requires } }
        : {}),
    when: d.when.map(filterOf),
    every: d.every === "feature" ? { feature: d.feature } : d.every,
    then: effectOf(d),
  };
  const r = PlayerTriggerRule.safeParse(raw);
  if (r.success) return { ok: true, rule: r.data };
  const first = r.error.issues[0];
  return {
    ok: false,
    message: first?.message ?? "Invalid rule",
    path: (first?.path ?? []) as (string | number)[],
  };
}

export const nameValid = (name: string) => {
  const n = name.trim();
  return n.length >= 1 && [...n].length <= TRIGGER_NAME_MAX;
};

export type TriggerOwnerRef = { characterId: string } | { definitionId: string };

/** FR-MOD-45: the `mod.putTrigger` payload (no `id` → create; with `id` → replace). */
export function putTriggerPayload(
  d: TriggerDraft,
  rule: PlayerTriggerRule,
  owner: TriggerOwnerRef,
  id?: string,
): PutTriggerInput {
  return {
    trigger: {
      ...(id ? { id } : {}),
      ...owner,
      name: d.name.trim(),
      enabled: d.enabled,
      public: d.public,
      rule,
    },
  };
}
