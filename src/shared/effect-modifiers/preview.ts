// Roll-control preview (FR-MOD-27, -17, -18; tier 2 + T): the client twin of MOD's roll hook,
// pure over the synced store. From a roll subject it gives the **preview mode** (the roller's
// mode combined with the creature's `mode` effects and enabled `roll` mode triggers), one
// physical **group** per bonus die (`e:` keys from `bonusDieGroups`, the server's function) and
// per trigger that **may** fire (`t:<triggerId>`: requires and owner-side filters pass; charges
// are server-only, so a group may go unused), and the Tooltip's parts line. The server's final
// mode and parts always decide (FR-MOD-17, -18).
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import {
  COMBATANT_TYPE,
  type CombatantView,
  ENCOUNTER_TYPE,
  type EncounterView,
} from "@shared/combat-tracker/schemas";
import {
  ABILITIES,
  abilityMod,
  ENTITY_TYPE,
  IMPORTED_ENTITY_TYPE,
  proficiencyBonus,
} from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { type FormulaOwner, formulaValue } from "./formula";
import {
  bonusDieGroups,
  type CreatureRef,
  combineModes,
  type FinalMode,
  type ModEffect,
  matches,
  matchingMods,
  modeHints,
} from "./rules";
import { EFFECT_PRESET_TYPE, type EffectPresetRecord, type RollSubject } from "./schemas";
import { RULE_TRIGGER_TYPE } from "./trigger-records";
import { type PlayerTriggerRule, rowMatches, type TriggerRule } from "./triggers";

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

interface StatsLike {
  abilities?: Record<string, number>;
  level?: number;
  className?: string;
  classes?: { name: string; level: number }[];
  cr?: string;
}

/** FR-MOD-35: the formula owner from the stat block this client holds (missing → 0). */
export function formulaOwnerOf(store: RecordStore, o: Owner): FormulaOwner {
  if (o === null) return {};
  const id = "characterId" in o ? o.characterId : o.definitionId;
  const rec = (store.records[ENTITY_TYPE]?.[id] ?? store.records[IMPORTED_ENTITY_TYPE]?.[id]) as
    | { statBlock?: StatsLike }
    | undefined;
  const s = rec?.statBlock;
  if (!s) return {};
  const abilities: Partial<Record<(typeof ABILITIES)[number], number>> = {};
  if (s.abilities) {
    for (const a of ABILITIES) abilities[a] = abilityMod(s.abilities[a] ?? 10);
  }
  const prof = proficiencyBonus(s as Parameters<typeof proficiencyBonus>[0]);
  if (s.cr !== undefined) {
    const cr = s.cr.includes("/") ? 0 : Number(s.cr);
    return { level: 0, cr, prof, abilities };
  }
  const level = s.level ?? 0;
  const classes = s.classes ?? (s.className ? [{ name: s.className, level }] : []);
  return { level, classes, prof, abilities };
}

/**
 * FR-MOD-36 (origin match), client side: `requires.preset` holds iff one of the owner's active
 * effects carries a matching key. An effect's keys = its `presetKey` (players: built-in keys
 * only) and the ids of presets toggled on through it (`activeEffectId`). Keys match if equal or
 * if one is a preset whose `originKey` is the other. A `{name}` ref (a campaign preset in a
 * player's copy) can't be checked here: it **may** hold.
 */
function requiresMet(
  store: RecordStore,
  rule: PreviewTrigger["rule"],
  creature: CreatureRef,
  effects: readonly StoreEffect[],
): boolean {
  const req = rule.requires;
  if (!req) return true;
  if (!("preset" in req)) return true;
  const presets = values<EffectPresetRecord>(store, EFFECT_PRESET_TYPE);
  const byId = new Map(presets.map((p) => [p.id, p]));
  const mine = effects.filter((e) =>
    "characterId" in creature
      ? e.targetCharacterId === creature.characterId
      : e.targetCombatantId === creature.combatantId,
  );
  const keys = new Set<string>();
  for (const e of mine) {
    if (e.presetKey) keys.add(e.presetKey);
    for (const p of presets) if (p.activeEffectId === e.id) keys.add(p.id);
  }
  const want = req.preset;
  for (const k of keys) {
    if (k === want) return true;
    if (byId.get(want)?.originKey === k) return true;
    if (byId.get(k)?.originKey === want) return true;
  }
  return false;
}

function isOwnTurn(store: RecordStore, own: CombatantView | null): boolean {
  if (!own) return false;
  const enc = startedEncounter(store);
  const turn = enc?.turnCombatantId ?? enc?.playerTurnCombatantId ?? null;
  return turn !== null && turn === own.id;
}

/**
 * Owner-side filters (FR-MOD-37, -43): `via`, `row`, `ownTurn`, `crit`, hard `mode` (a `hit`
 * trigger reads the card's to-hit mode, absent = normal), `roll` (a `roll` trigger's selector).
 * Target-side and soft filters (`targetMarked`, `targetHurt`, `ask`, soft `mode`) may hold.
 */
function ownerFiltersPass(
  rule: PreviewTrigger["rule"],
  subject: RollSubject,
  ownTurn: boolean,
): boolean {
  for (const f of rule.when) {
    if (f.if === "via" && subject.via !== f.via) return false;
    if (f.if === "row" && !rowMatches(f.names, subject.row)) return false;
    if (f.if === "ownTurn" && !ownTurn) return false;
    if (f.if === "crit" && !subject.crit) return false;
    if (f.if === "roll" && !matches(f.on, subject)) return false;
    if (f.if === "mode" && !f.soft && rule.on === "hit") {
      if (!f.modes.includes(subject.toHitMode ?? "normal")) return false;
    }
  }
  return true;
}

/** The enabled triggers of this roll's owner that may fire on it, in `seq` order. */
function firingTriggers(
  store: RecordStore,
  subject: RollSubject,
  triggers: readonly PreviewTrigger[],
): PreviewTrigger[] {
  const creature = previewCreature(store, subject);
  const owner = ownerOf(store, creature);
  const effects = effectsOf(store);
  const own = ownCombatant(store, subject);
  const ownTurn = isOwnTurn(store, own);
  return [...triggers]
    .filter((t) => t.enabled && ownsTrigger(t, owner))
    .sort((a, b) => a.seq - b.seq)
    .filter((t) => {
      const { rule } = t;
      if (rule.on === "hit") {
        if (!(subject.roll === "damage" && subject.card)) return false;
      } else if (rule.on === "roll") {
        // FR-MOD-43: turn / round / encounter windows only for an active combatant.
        if (rule.every !== "each" && typeof rule.every !== "object" && !own) return false;
      } else {
        return false;
      }
      return (
        requiresMet(store, rule, creature, effects) && ownerFiltersPass(rule, subject, ownTurn)
      );
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
    subject.roll === "damage" && subject.crit === true && !t.rule.when.some((f) => f.if === "crit");
  const owner = formulaOwnerOf(store, ownerOf(store, previewCreature(store, subject)));
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
    if (dice.length > 0) {
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

/** Record types the preview reads (a hook subscribes to just these). */
export const PREVIEW_TYPES = [
  EFFECT_TYPE,
  EFFECT_PRESET_TYPE,
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  ENTITY_TYPE,
  IMPORTED_ENTITY_TYPE,
] as const;

export { RULE_TRIGGER_TYPE };
