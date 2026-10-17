// Roll-control preview (FR-MOD-27, -17, -18; tier 2 + T): the client twin of MOD's roll hook,
// pure over the synced store. From a roll subject it gives the **preview mode** (the roller's
// mode combined with the creature's `mode` effects and enabled `roll` mode triggers), one
// physical **group** per bonus die (`e:` keys from `bonusDieGroups`, the server's function) and
// per `hit` trigger that can be offered (`t:<triggerId>`: requires and owner-side filters pass,
// R4's `trigger-fire` rules, and its `trigger-state` row says armed and ready, FR-MOD-56), and
// the Tooltip's parts line. `roll` trigger parts are server-rolled (no group; R4 passes no key). The server's final
// mode and parts always decide (FR-MOD-17, -18).
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import {
  COMBATANT_TYPE,
  type CombatantView,
  ENCOUNTER_TYPE,
  type EncounterView,
} from "@shared/combat-tracker/schemas";
import {
  type ABILITIES,
  ENTITY_TYPE,
  IMPORTED_ENTITY_TYPE,
  SKILL_ABILITY,
  type StatBlock,
} from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { type FormulaOwner, formulaValue } from "./formula";
import {
  bonusDieGroups,
  type CreatureRef,
  combineModes,
  type FinalMode,
  type ModEffect,
  matchingMods,
  modeHints,
} from "./rules";
import {
  EFFECT_PRESET_TYPE,
  type EffectPresetRecord,
  ROLL_ROW_MAX,
  type RollSubject,
} from "./schemas";
import { type FireFacts, formulaOwnerOf, ownerFiltersPass, requiresMet } from "./trigger-fire";
import { RULE_TRIGGER_TYPE } from "./trigger-records";
import { TRIGGER_STATE_TYPE, type TriggerStateRecord } from "./trigger-state";
import { doublesOnCrit, type PlayerTriggerRule, type TriggerRule } from "./triggers";

/** A `rule-trigger` as either client holds it (the player copy may name presets by `{name}`). */
export interface PreviewTrigger {
  id: string;
  seq: number;
  characterId: string | null;
  definitionId: string | null;
  name: string;
  enabled: boolean;
  rule: TriggerRule | PlayerTriggerRule;
}

/** An effect row as the store holds it (players: no `seq`, built-in `presetKey` only). */
type StoreEffect = ModEffect & { presetKey?: string | null };

/** One physical group of a roll (FR-MOD-18): what the tray shows and `ManualForm` asks. */
export interface PreviewGroup {
  /** `e:<effectId>` / `e:<effectId>.<index>` (bonus die) or `t:<triggerId>` (trigger). */
  key: string;
  label: string;
  /** FR-DICE-01 expression rolled for the group, e.g. "1d4", "1d6+2" (crit-doubled). */
  expression: string;
  /** Dice terms of `expression`, in order (the tray's labelled chips). */
  dice: { count: number; faces: number; sign: 1 | -1 }[];
  /** The part's sign in the total (Bane −1d4); trigger parts are always +. */
  sign: 1 | -1;
  /** `hit` trigger: offered on the card, not in the total ("on a hit"). */
  onHit?: true;
}

/** One entry of the Tooltip line ("Bless +1d4 · Divine Fury 1d6+2 (on a hit)"). */
export interface PreviewPart {
  label: string;
  text: string;
}

export interface RollPreview {
  /** Mode hints of the d20 roll (effects, then `roll` mode triggers); `modeFor` combines them. */
  hints: readonly { mode: "advantage" | "disadvantage" }[];
  groups: PreviewGroup[];
  parts: PreviewPart[];
}

const values = <T>(store: RecordStore, type: string): T[] =>
  Object.values(store.records[type] ?? {}) as T[];

function startedEncounter(store: RecordStore): EncounterView | null {
  return values<EncounterView>(store, ENCOUNTER_TYPE).find((e) => e.status === "started") ?? null;
}

const inEncounter = (c: CombatantView, enc: EncounterView) =>
  c.encounterId === enc.id && c.active !== false && !c.removed;

/** The roller's combatant in the started encounter (a PC by its character), else null. */
function ownCombatant(store: RecordStore, subject: RollSubject): CombatantView | null {
  const enc = startedEncounter(store);
  if (!enc) return null;
  const all = values<CombatantView>(store, COMBATANT_TYPE);
  const s = subject.creature;
  const c =
    "combatantId" in s
      ? all.find((x) => x.id === s.combatantId)
      : all.find((x) => x.kind === "pc" && x.entityId === s.characterId && inEncounter(x, enc));
  return c && inEncounter(c, enc) ? c : null;
}

/** A PC combatant's subject is its character (FR-MOD-15), as MOD's server hook resolves it. */
export function previewCreature(store: RecordStore, subject: RollSubject): CreatureRef {
  const s = subject.creature;
  if ("characterId" in s) return s;
  const c = store.records[COMBATANT_TYPE]?.[s.combatantId] as CombatantView | undefined;
  return c?.kind === "pc" && c.entityId ? { characterId: c.entityId } : s;
}

const effectsOf = (store: RecordStore): StoreEffect[] =>
  values<StoreEffect>(store, EFFECT_TYPE).filter((e) => (e.endedAt ?? null) === null);

/** The trigger owner: a character, or the monster combatant's definition. */
type Owner = { characterId: string } | { definitionId: string } | null;

function ownerOf(store: RecordStore, creature: CreatureRef): Owner {
  if ("characterId" in creature) return { characterId: creature.characterId };
  const c = store.records[COMBATANT_TYPE]?.[creature.combatantId] as CombatantView | undefined;
  return c?.entityId ? { definitionId: c.entityId } : null;
}

const ownsTrigger = (t: PreviewTrigger, o: Owner): boolean =>
  o !== null &&
  ("characterId" in o ? t.characterId === o.characterId : t.definitionId === o.definitionId);

/** FR-MOD-35: the owner's formula values from the stat block this client holds (none → 0s). */
function ownerValues(store: RecordStore, o: Owner): FormulaOwner {
  if (o === null) return {};
  const id = "characterId" in o ? o.characterId : o.definitionId;
  const rec = (store.records[ENTITY_TYPE]?.[id] ?? store.records[IMPORTED_ENTITY_TYPE]?.[id]) as
    | { statBlock?: StatBlock }
    | undefined;
  return rec?.statBlock ? formulaOwnerOf(rec.statBlock) : {};
}

/**
 * FR-MOD-36 (origin match, `requiresMet` as the server's hook): the owner's active effects'
 * keys = their `presetKey` (players: built-in keys only, ids redacted) plus, client side, the
 * ids of presets toggled on through them (`activeEffectId`; the player holds their own). A
 * `{name}` ref (a campaign preset in a player's copy) can't be checked here: it **may** hold.
 */
function requiresHold(
  store: RecordStore,
  rule: PreviewTrigger["rule"],
  creature: CreatureRef,
  effects: readonly StoreEffect[],
): boolean {
  const req = rule.requires;
  if (req && !("preset" in req)) return true;
  const presets = values<EffectPresetRecord>(store, EFFECT_PRESET_TYPE);
  const origin = new Map(presets.map((p) => [p.id, p.originKey]));
  const mine = effects.filter((e) =>
    "characterId" in creature
      ? e.targetCharacterId === creature.characterId
      : e.targetCombatantId === creature.combatantId,
  );
  const keys = mine.flatMap((e) => [
    e.presetKey ?? null,
    ...presets.filter((p) => p.activeEffectId === e.id).map((p) => p.id),
  ]);
  return requiresMet(req ? { requires: req } : {}, keys, (k) => origin.get(k) ?? null);
}

/**
 * FR-MOD-60 out of combat: a trigger's `requires` against the creature's active effects in the
 * store, as the preview checks it (a `{name}` ref may hold).
 */
export function triggerArmedNow(
  store: RecordStore,
  rule: PreviewTrigger["rule"],
  creature: CreatureRef,
): boolean {
  return requiresHold(store, rule, creature, effectsOf(store));
}

/** The started encounter's turn as this client sees it (players: `playerTurnCombatantId`). */
function isOwnTurn(store: RecordStore, own: CombatantView | null): boolean {
  if (!own) return false;
  const enc = startedEncounter(store);
  const turn = enc?.turnCombatantId ?? enc?.playerTurnCombatantId ?? null;
  return turn !== null && turn === own.id;
}

/** `every: {feature}`: uses left on the character's sheet row (null: sheet or row not held). */
function featureUsesLeft(
  store: RecordStore,
  characterId: string | null,
  featureId: string,
): number | null {
  const sheet = values<CreatureSheetRecord>(store, CREATURE_SHEET_TYPE).find(
    (s) => s.entityId === characterId,
  );
  const f = sheet?.features.find((r) => r.id === featureId);
  return f?.usesMax ? f.usesMax - f.used : null;
}

/**
 * FR-MOD-56 (sim-7): the tray never promises a spent trigger. The trigger's `trigger-state` row
 * for the roller's combatant is armed and `ready`, and a `feature` trigger has a use left on the
 * sheet. No row received → false. The server still decides (FR-MOD-18).
 */
function chargeReady(store: RecordStore, t: PreviewTrigger, own: CombatantView): boolean {
  const row = values<TriggerStateRecord>(store, TRIGGER_STATE_TYPE).find(
    (r) => r.triggerId === t.id && r.combatantId === own.id,
  );
  if (!row?.armed || row.charge !== "ready") return false;
  const every = t.rule.every;
  return (
    typeof every !== "object" || (featureUsesLeft(store, t.characterId, every.feature) ?? 0) > 0
  );
}

/**
 * The enabled triggers of this roll's owner that can fire on it, in `seq` order, as MOD's
 * server hook picks them: `hit` → `damage` on a card's damage roll in combat; `roll` → `each`
 * anywhere, windowed ones in combat only, no `feature` ones (FR-MOD-43). Requires and hard
 * owner-side filters (`ownerFiltersPass`) must hold; `hit` and windowed `roll` triggers also
 * need their trigger state armed and ready (FR-MOD-56).
 */
function firingTriggers(
  store: RecordStore,
  subject: RollSubject,
  triggers: readonly PreviewTrigger[],
): PreviewTrigger[] {
  const creature = previewCreature(store, subject);
  const owner = ownerOf(store, creature);
  const effects = effectsOf(store);
  const own = ownCombatant(store, subject);
  const facts: FireFacts = {
    subject,
    ownTurn: isOwnTurn(store, own),
    mode: subject.toHitMode ?? "normal",
  };
  return [...triggers]
    .filter((t) => t.enabled && ownsTrigger(t, owner))
    .sort((a, b) => a.seq - b.seq)
    .filter((t) => {
      const { rule } = t;
      if (rule.on === "hit") {
        if (!(subject.roll === "damage" && subject.card && own) || rule.then.do !== "damage") {
          return false;
        }
        if (!chargeReady(store, t, own)) return false;
      } else if (rule.on === "roll") {
        if (typeof rule.every === "object") return false;
        if (rule.every !== "each" && !(own && chargeReady(store, t, own))) return false;
      } else {
        return false;
      }
      // Target-side filters of a player copy (`targetMarked {name}`) hold here, as all do.
      const when = rule.when as TriggerRule["when"];
      return requiresHold(store, rule, creature, effects) && ownerFiltersPass({ when }, facts);
    });
}

const TERM_RE = /([+-]?)(\d+)d(\d+)/g;

/** Dice terms of an FR-DICE-01 expression ("1d6+1d8+2" → [1d6, 1d8]). */
export function diceOfExpression(expression: string): PreviewGroup["dice"] {
  const out: PreviewGroup["dice"] = [];
  for (const m of expression.matchAll(TERM_RE)) {
    out.push({ count: Number(m[2]), faces: Number(m[3]), sign: m[1] === "-" ? -1 : 1 });
  }
  return out;
}

/** A trigger's part expression for this roll (FR-MOD-34; crit doubles unless crit-filtered). */
function triggerExpression(
  store: RecordStore,
  t: PreviewTrigger,
  subject: RollSubject,
): string | null {
  const then = t.rule.then;
  if (then.do !== "damage" && then.do !== "part") return null;
  const crit =
    subject.roll === "damage" &&
    subject.crit === true &&
    doublesOnCrit({ when: t.rule.when as TriggerRule["when"] });
  const owner = ownerValues(store, ownerOf(store, previewCreature(store, subject)));
  const v = formulaValue(then.formula, owner, { crit });
  return v.ok ? v.value.expression : null;
}

const signed = (sign: 1 | -1, text: string) => `${sign === -1 ? "−" : "+"}${text}`;

/**
 * FR-MOD-27: the preview of one roll. `triggers` = the loaded `rule-trigger` rows (none until
 * loaded: bonus dice only, and the server rolls missing `t:` groups, FR-MOD-18).
 */
export function rollPreview(
  store: RecordStore,
  subject: RollSubject,
  triggers: readonly PreviewTrigger[] = [],
): RollPreview {
  const creature = previewCreature(store, subject);
  const effects = effectsOf(store);
  const fire = firingTriggers(store, subject, triggers);
  const hints = [
    ...modeHints(effects, creature, subject),
    ...fire.flatMap((t) => (t.rule.then.do === "mode" ? [{ mode: t.rule.then.mode }] : [])),
  ];
  const groups: PreviewGroup[] = [];
  const parts: PreviewPart[] = [];
  const dieGroups = new Map(
    bonusDieGroups(effects, creature, subject).map((g) => [`${g.effect.id}:${g.index}`, g]),
  );
  for (const { effect, modifier: m, index } of matchingMods(effects, creature, subject)) {
    const label = effect.label ?? "";
    if (m.kind === "dice") {
      const g = dieGroups.get(`${effect.id}:${index}`);
      if (!g) continue;
      groups.push({
        key: g.key,
        label,
        expression: g.dice,
        dice: diceOfExpression(g.dice),
        sign: g.sign,
      });
      parts.push({ label, text: signed(g.sign, g.dice) });
    } else if (m.kind === "flat" && m.on.roll !== "ac") {
      parts.push({ label, text: signed(m.value < 0 ? -1 : 1, String(Math.abs(m.value))) });
    }
  }
  for (const t of fire) {
    const expression = triggerExpression(store, t, subject);
    if (expression === null) continue;
    const onHit = t.rule.on === "hit";
    const dice = diceOfExpression(expression);
    // FR-MOD-18: offered (`hit`) dice take a physical `t:` group; `roll` parts are server-rolled.
    if (onHit && dice.length > 0) {
      groups.push({
        key: `t:${t.id}`,
        label: t.name,
        expression,
        dice,
        sign: 1,
        ...(onHit ? { onHit: true as const } : {}),
      });
    }
    parts.push({ label: t.name, text: onHit ? `${expression} (on a hit)` : `+${expression}` });
  }
  return { hints, groups, parts };
}

/** FR-MOD-17: the final mode the preview expects for the roller's mode (5e combine). */
export const modeFor = (p: Pick<RollPreview, "hints">, roller: FinalMode): FinalMode =>
  combineModes(roller, p.hints);

/**
 * FR-MOD-27: `previewMode(store, subject)`, the client twin of the hooks' `modes()`: the mode a
 * d20 roll of this subject will be rolled with for `roller` (default normal).
 */
export function previewMode(
  store: RecordStore,
  subject: RollSubject,
  roller: FinalMode = "normal",
  triggers: readonly PreviewTrigger[] = [],
): FinalMode {
  return modeFor(rollPreview(store, subject, triggers), roller);
}

/** "Bless +1d4 · Divine Fury 1d6+2 (on a hit)"; null when no part. */
export function previewText(parts: readonly PreviewPart[]): string | null {
  if (parts.length === 0) return null;
  return parts.map((p) => (p.label ? `${p.label} ${p.text}` : p.text)).join(" · ");
}

/** A sheet roll's spec category (`characterRolls`), as `char.roll` maps it to a subject. */
type SheetCategory = string;

/**
 * FR-MOD-15, -27: the subjects of a sheet roll's specs, as `char.roll` derives them (attack /
 * damage via weapon or spell, save / check with the ability, a skill's ability, initiative;
 * anything else, e.g. healing, none). `row` = the attack / spell row's name (#209). `card` = the
 * roll is routed to a combat card (`cbt.attack` / `cbt.rollDamage`): its damage subject gets
 * `card: true` and the card's to-hit mode. Definition (NPC) rolls have no subject.
 */
export function sheetRollSubjects(o: {
  characterId: string;
  kind: string;
  categories: readonly SheetCategory[];
  ability?: (typeof ABILITIES)[number];
  skill?: keyof typeof SKILL_ABILITY;
  row?: string;
  card?: { toHitMode?: FinalMode };
}): (RollSubject | null)[] {
  const creature = { characterId: o.characterId };
  const via = o.kind.startsWith("spell") ? ("spell" as const) : ("weapon" as const);
  const row = o.row ? { row: o.row.slice(0, ROLL_ROW_MAX) } : {};
  return o.categories.map((c): RollSubject | null => {
    if (c === "attack") return { creature, roll: "attack", via, ...row };
    if (c === "damage") {
      const card = o.card
        ? { card: true, ...(o.card.toHitMode ? { toHitMode: o.card.toHitMode } : {}) }
        : {};
      return { creature, roll: "damage", via, ...row, ...card };
    }
    if (c === "saving-throw" && o.ability) return { creature, roll: "save", ability: o.ability };
    if (c === "ability-check" && o.ability) return { creature, roll: "check", ability: o.ability };
    if (c === "skill-check" && o.skill) {
      return { creature, roll: "check", ability: SKILL_ABILITY[o.skill] };
    }
    if (c === "initiative") return { creature, roll: "initiative" };
    return null;
  });
}

/** Record types the preview reads (a hook subscribes to just these). */
export const PREVIEW_TYPES = [
  EFFECT_TYPE,
  EFFECT_PRESET_TYPE,
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  ENTITY_TYPE,
  IMPORTED_ENTITY_TYPE,
  TRIGGER_STATE_TYPE,
  CREATURE_SHEET_TYPE,
] as const;

export { RULE_TRIGGER_TYPE };
