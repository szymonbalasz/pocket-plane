// MOD's rule-trigger roll hook (FR-MOD-14, -34–37, -42, -43, -52; ADR-0043 D1), a line of its own
// in dice-roll-log's `rollHooks` after the effect parts. On every subject roll: the owner's
// enabled `roll` triggers add parts (used at once); on a card's damage roll (`card: true`) the
// attacker's `hit` triggers are rolled as **offered** parts (not in the total) with the popup's
// settle facts. Owner = a PC's character or a monster combatant's definition; triggers in `seq`
// order. A formula error or a cap skips the trigger with a DM-only note; it never fails the roll.
//
// Writes only `trigger_use` rows of `roll` triggers (server-only); a hit offer's row needs the card
// id, so the caller records it (`recordOffers`). Imports stay to the schema, `@shared` and
// row readers: `roll-hooks.ts` (imported by `dice.evaluate`) imports this module.
import {
  type CombatantRecord,
  type EncounterRecord,
  TRIGGER_ASK_MAX,
  TRIGGER_LABEL_MAX,
} from "@shared/combat-tracker/schemas";
import { PART_DICE_MAX, ROLL_NOTE_MAX, ROLL_OFFERED_MAX } from "@shared/dice-roll-log/schemas";
import { evaluateFormula, type FormulaValue, parseFormula } from "@shared/effect-modifiers/formula";
import { isBuiltinPresetKey, type RollSubject } from "@shared/effect-modifiers/schemas";
import {
  type FireFacts,
  formulaOwnerOf,
  ownerFiltersPass,
  requiresMet,
  settleFacts,
  windowed,
  windowKey,
} from "@shared/effect-modifiers/trigger-fire";
import { MISSING_PRESET_NAME } from "@shared/effect-modifiers/trigger-records";
import { doublesOnCrit, type TriggerRule } from "@shared/effect-modifiers/triggers";
import type { StatBlock } from "@shared/entities/schemas";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import {
  combatant,
  effect,
  effectPreset,
  entity,
  ruleTrigger,
  triggerUse,
  triggerUseSeqNext,
} from "../../db/schema";
import { getSheet } from "../character-sheet/sheet-rows";
import { startedEncounter, toCombatantRecord } from "../combat-tracker/rows";
import type {
  OfferedPart,
  RollHook,
  RollHookBase,
  RollHookResult,
  RollModeHint,
  RollPart,
} from "../dice-roll-log/roll-hooks";

type Trigger = typeof ruleTrigger.$inferSelect;
type Env = CommandEnv;

/** Who a subject's triggers belong to, and where they stand in the started encounter. */
export interface TriggerOwner {
  kind: "character" | "definition";
  /** The character's or the definition's id (the trigger's owner column). */
  id: string;
  stats: StatBlock;
  /** Effects on it: a character's (PC) or the combatant's (monster). */
  effectsOn: { characterId: string } | { combatantId: string };
  /** Its combatant in the started encounter (active, not removed), if any. */
  combatant: CombatantRecord | null;
  enc: EncounterRecord | null;
}

const campaignOf = (env: Pick<Env, "actor">) => env.actor.campaignId as string;

function statsOf(env: Env, id: string): StatBlock | null {
  const r = env.tx.select({ s: entity.statBlock }).from(entity).where(eq(entity.id, id)).get();
  return (r?.s as StatBlock | undefined) ?? null;
}

/** A PC (by character or its combatant) → the character; a monster combatant → its definition. */
export function ownerOf(env: Env, creature: RollSubject["creature"]): TriggerOwner | null {
  const enc = startedEncounter(env.tx, campaignOf(env));
  if ("characterId" in creature) {
    const stats = statsOf(env, creature.characterId);
    if (!stats) return null;
    const c = enc
      ? env.tx
          .select()
          .from(combatant)
          .where(
            and(
              eq(combatant.encounterId, enc.id),
              eq(combatant.kind, "pc"),
              eq(combatant.entityId, creature.characterId),
              eq(combatant.active, true),
              eq(combatant.removed, false),
            ),
          )
          .get()
      : undefined;
    return {
      kind: "character",
      id: creature.characterId,
      stats,
      effectsOn: creature,
      combatant: c ? toCombatantRecord(c) : null,
      enc,
    };
  }
  const row = env.tx.select().from(combatant).where(eq(combatant.id, creature.combatantId)).get();
  if (!row) return null;
  const c = toCombatantRecord(row);
  if (c.kind === "pc") return ownerOf(env, { characterId: c.entityId });
  const stats = statsOf(env, c.entityId);
  if (!stats) return null;
  const live = enc?.id === c.encounterId && c.active && !c.removed;
  return {
    kind: "definition",
    id: c.entityId,
    stats,
    effectsOn: { combatantId: c.id },
    combatant: live ? c : null,
    enc: live ? enc : null,
  };
}

/** The owner's enabled triggers of an event, `seq` order (FR-MOD-52). One indexed read. */
export function triggersOf(env: Env, o: TriggerOwner, on: TriggerRule["on"]): Trigger[] {
  const col = o.kind === "character" ? ruleTrigger.characterId : ruleTrigger.definitionId;
  return env.tx
    .select()
    .from(ruleTrigger)
    .where(and(eq(ruleTrigger.campaignId, campaignOf(env)), eq(col, o.id)))
    .orderBy(asc(ruleTrigger.seq))
    .all()
    .filter((t) => t.enabled && t.rule.on === on);
}

/**
 * FR-MOD-36: `requires` against the owner's active effects now, with origin match (a preset's
 * `originKey`). Returns a predicate over rules.
 */
export function requiresOf(env: Env, o: TriggerOwner): (rule: TriggerRule) => boolean {
  const target =
    "characterId" in o.effectsOn
      ? eq(effect.targetCharacterId, o.effectsOn.characterId)
      : eq(effect.targetCombatantId, o.effectsOn.combatantId);
  const keys = env.tx
    .select({ k: effect.presetKey })
    .from(effect)
    .where(and(target, isNull(effect.endedAt)))
    .all()
    .map((r) => r.k);
  let origins: Map<string, string | null> | null = null;
  const originOf = (key: string): string | null => {
    if (!origins) {
      const ids = keys.filter((k): k is string => k !== null);
      origins = new Map(
        env.tx
          .select({ id: effectPreset.id, originKey: effectPreset.originKey })
          .from(effectPreset)
          .where(eq(effectPreset.campaignId, campaignOf(env)))
          .all()
          .filter((p) => ids.includes(p.id) || p.originKey !== null)
          .map((p) => [p.id, p.originKey]),
      );
    }
    return origins.get(key) ?? null;
  };
  return (rule) => requiresMet(rule, keys, originOf);
}

/** FR-MOD-42: no `used` row of this trigger, owner combatant, encounter and window. */
export function chargeFree(
  env: Env,
  triggerId: string,
  ownerCombatantId: string,
  encounterId: string,
  window: string,
  exceptId?: string,
): boolean {
  return !env.tx
    .select({ id: triggerUse.id })
    .from(triggerUse)
    .where(
      and(
        eq(triggerUse.triggerId, triggerId),
        eq(triggerUse.ownerCombatantId, ownerCombatantId),
        eq(triggerUse.encounterId, encounterId),
        eq(triggerUse.window, window),
        eq(triggerUse.state, "used"),
      ),
    )
    .all()
    .some((u) => u.id !== exceptId);
}

/** `every: {feature}`: the character's feature row with uses, and how many are left. */
export function featureUses(
  env: Env,
  characterId: string,
  featureId: string,
): { name: string; left: number } | null {
  const f = getSheet(env.tx, characterId)?.features.find((r) => r.id === featureId);
  if (!f?.usesMax) return null;
  return { name: f.name, left: f.usesMax - f.used };
}

const note = (text: string) => text.slice(0, ROLL_NOTE_MAX);

/** FR-MOD-34: the formula's value now, or a skip note. */
function fireValue(t: Trigger, o: TriggerOwner, crit: boolean): FormulaValue | string {
  const formula =
    t.rule.then.do === "damage" || t.rule.then.do === "part" ? t.rule.then.formula : null;
  if (formula === null) return `${t.name} skipped: no formula`;
  const p = parseFormula(formula);
  const v = p.ok ? evaluateFormula(p.value, formulaOwnerOf(o.stats), { crit }) : p;
  return v.ok ? v.value : `${t.name} skipped: ${v.error.message}`;
}

/** Per-die values of a server roll in expression order (FR-MOD-19, D9): ≤ 20 dice, else none. */
export function dieValues(r: { dice: { value: number | null }[] }): number[] | undefined {
  const vs = r.dice.map((d) => d.value);
  if (vs.length === 0 || vs.length > PART_DICE_MAX || vs.some((v) => v === null)) return undefined;
  return vs as number[];
}

/** The window facts at this roll: own turn, the card's to-hit mode (damage-only = normal). */
function factsOf(o: TriggerOwner, subject: RollSubject): FireFacts {
  return {
    subject,
    ownTurn: !!o.combatant && o.enc?.turnCombatantId === o.combatant.id,
    mode: subject.toHitMode ?? "normal",
  };
}

/** Is this trigger's charge free now (FR-MOD-42)? `each`: always; feature: a use left. */
function chargeOpen(env: Env, t: Trigger, o: TriggerOwner): boolean | "no-combat" {
  const every = t.rule.every;
  if (every === "each") return true;
  if (typeof every === "object") {
    return o.kind === "character" && (featureUses(env, o.id, every.feature)?.left ?? 0) > 0;
  }
  if (!o.combatant || !o.enc) return "no-combat";
  return chargeFree(env, t.id, o.combatant.id, o.enc.id, windowKey(every, o.enc));
}

/**
 * FR-MOD-43: the owner's enabled `roll` triggers that fire on this roll now: requires, hard
 * filters, charge open (`each` anywhere; windowed in combat only). `{feature}` ones are rejected
 * at save (#223: a sheet spend needs a `creature-sheet` change the roll's event can't list); a row
 * written before that is skipped with a note.
 */
function firingRollTriggers(
  env: Env,
  o: TriggerOwner,
  subject: RollSubject,
  notes: string[] | null,
): Trigger[] {
  const triggers = triggersOf(env, o, "roll");
  if (triggers.length === 0) return [];
  const requires = requiresOf(env, o);
  const facts = factsOf(o, subject);
  return triggers.filter((t) => {
    if (!requires(t.rule) || !ownerFiltersPass(t.rule, facts)) return false;
    if (typeof t.rule.every === "object") {
      notes?.push(note(`${t.name} skipped: feature uses on roll triggers not built`));
      return false;
    }
    return chargeOpen(env, t, o) === true;
  });
}

/** FR-MOD-42: a windowed `roll` trigger's charge is `used` at once (in combat). */
function spendAtOnce(env: Env, t: Trigger, o: TriggerOwner, rollId: string | null): void {
  if (!windowed(t.rule.every) || !o.combatant || !o.enc) return;
  const now = env.ctx.clock.iso();
  env.tx
    .insert(triggerUse)
    .values({
      id: env.ctx.ids.next(),
      campaignId: campaignOf(env),
      encounterId: o.enc.id,
      seq: triggerUseSeqNext,
      triggerId: t.id,
      ownerCombatantId: o.combatant.id,
      window: windowKey(t.rule.every, o.enc),
      state: "used",
      rollId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/**
 * FR-MOD-43: firing `part` triggers → parts on this roll; a `mode` trigger's hint came from
 * `modes()` before the roll, its windowed charge is spent here.
 */
function rollParts(
  env: Env,
  o: TriggerOwner,
  subject: RollSubject,
  base: RollHookBase,
  notes: string[],
): RollPart[] {
  const parts: RollPart[] = [];
  for (const t of firingRollTriggers(env, o, subject, notes)) {
    if (t.rule.then.do === "mode") {
      spendAtOnce(env, t, o, null);
      continue;
    }
    if (t.rule.then.do !== "part") continue;
    const crit = !!subject.crit && subject.roll === "damage" && doublesOnCrit(t.rule);
    const v = fireValue(t, o, crit);
    if (typeof v === "string") {
      notes.push(note(v));
      continue;
    }
    if (v.expression === null) continue;
    // FR-MOD-18: a physical `t:` group (lenient, as offers; R2 ruling #224) else server-rolled.
    const r = v.dice.length > 0 ? base.rollExtra(v.expression, t.name, `t:${t.id}`) : null;
    parts.push({
      effectId: t.id,
      triggerId: t.id,
      label: t.name,
      public: t.public,
      value: r ? r.total : v.constant,
      ...(r ? { expression: r.expression, rollId: r.id } : {}),
      ...(r && base.manual && !r.manual ? { auto: true } : {}),
      ...(r && dieValues(r) ? { dice: dieValues(r) } : {}),
    });
    spendAtOnce(env, t, o, r?.id ?? null);
  }
  return parts;
}

/**
 * FR-MOD-37, -47 (R7): the card's `marked` fact. A player's own card is theirs to read, and
 * players never get a campaign preset's id (FR-MOD-21, -47): a built-in key stays, a campaign
 * mark becomes its name (the owner's trigger copy shows it too); the DM's popup matches the name
 * against its campaign presets (`settleTriggers`).
 */
function markedFact(env: Env, preset: string): string {
  if (isBuiltinPresetKey(preset)) return preset;
  const row = env.tx
    .select({ name: effectPreset.name })
    .from(effectPreset)
    .where(eq(effectPreset.id, preset))
    .get();
  return (row?.name ?? MISSING_PRESET_NAME).slice(0, TRIGGER_LABEL_MAX);
}

/**
 * FR-MOD-37: on a card's damage roll, the attacker's `hit` triggers whose requires, hard
 * owner-side filters and charge pass → rolled offered parts (dice doubled on a crit unless the
 * rule has a `crit` filter) with settle facts. > 4 → the rest skipped with a note.
 */
function hitOffers(
  env: Env,
  o: TriggerOwner,
  subject: RollSubject,
  base: RollHookBase,
  notes: string[],
): OfferedPart[] {
  if (!subject.card || subject.roll !== "damage" || !o.combatant || !o.enc) return [];
  const triggers = triggersOf(env, o, "hit");
  if (triggers.length === 0) return [];
  const requires = requiresOf(env, o);
  const facts = factsOf(o, subject);
  const offers: OfferedPart[] = [];
  let skipped = 0;
  for (const t of triggers) {
    if (t.rule.then.do !== "damage") continue;
    if (!requires(t.rule) || !ownerFiltersPass(t.rule, facts)) continue;
    if (chargeOpen(env, t, o) !== true) continue;
    const v = fireValue(t, o, !!subject.crit && doublesOnCrit(t.rule));
    if (typeof v === "string") {
      notes.push(note(v));
      continue;
    }
    if (v.expression === null) continue;
    if (offers.length >= ROLL_OFFERED_MAX) {
      skipped++;
      continue;
    }
    // FR-MOD-18: a physical `t:` group (lenient; R2 ruling) else server-rolled.
    const r = base.rollExtra(v.expression, t.name, `t:${t.id}`);
    const s = settleFacts(t.rule, facts);
    const dice = dieValues(r);
    offers.push({
      triggerId: t.id,
      label: t.name.slice(0, TRIGGER_LABEL_MAX),
      public: t.public,
      value: r.total,
      expression: r.expression,
      rollId: r.id,
      type: t.rule.then.type,
      ...(base.manual && !r.manual ? { auto: true } : {}),
      ...(dice ? { dice } : {}),
      ...(s.ask ? { ask: s.ask.slice(0, TRIGGER_ASK_MAX) } : {}),
      ...(s.marked ? { marked: markedFact(env, s.marked) } : {}),
      ...(s.hurt ? { hurt: true } : {}),
      ...(s.untick ? { untick: true } : {}),
    });
  }
  if (skipped > 0) notes.push(note(`+ ${skipped} trigger${skipped === 1 ? "" : "s"} skipped`));
  return offers;
}

export const modTriggerHook: RollHook = {
  id: "effect-modifiers.triggers",
  /** FR-MOD-43 (tier 2): firing `roll` triggers with `then.mode` → mode hints, before the d20. */
  modes(env, subject): RollModeHint[] {
    const o = ownerOf(env, subject.creature);
    if (!o) return [];
    return firingRollTriggers(env, o, subject, null).flatMap((t) =>
      t.rule.then.do === "mode"
        ? [
            {
              effectId: t.id,
              triggerId: t.id,
              mode: t.rule.then.mode,
              label: t.name,
              public: t.public,
            },
          ]
        : [],
    );
  },
  adjust(env, subject, base): RollHookResult {
    const o = ownerOf(env, subject.creature);
    if (!o) return { parts: [], modes: [] };
    const notes: string[] = [];
    const parts = rollParts(env, o, subject, base, notes);
    const offered = hitOffers(env, o, subject, base, notes);
    return {
      parts,
      modes: [],
      ...(offered.length ? { offered } : {}),
      ...(notes.length ? { notes } : {}),
    };
  },
};

/** The trigger rows of offers (window per trigger now), for `recordOffers`. */
export function triggersByIds(env: Env, ids: readonly string[]): Trigger[] {
  if (ids.length === 0) return [];
  return env.tx
    .select()
    .from(ruleTrigger)
    .where(inArray(ruleTrigger.id, [...ids]))
    .all();
}
