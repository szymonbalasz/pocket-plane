// Effect intents (FR-CBTX-04, -08, -09, -10, -11): `cbtx.addEffect`, `cbtx.updateEffect`,
// `cbtx.endEffect`, `cbtx.setConcentration`. Rows + event in one transaction; cards of an ended
// concentration close after the event (FR-CBTX-10, -43). The effect hooks' rows join each
// event (FR-CBTX-51).

import { INCAPACITATING_CONDITIONS } from "@shared/combat-extras/conditions";
import {
  AddEffectInput,
  CBTX_INTENTS,
  type EffectIdResult,
  type EffectIdsResult,
  EndEffectInput,
  SetConcentrationInput,
  UpdateEffectInput,
} from "@shared/combat-extras/intents";
import { endsRoundOf } from "@shared/combat-extras/rules";
import { type EffectRecord, effectVisibleToPlayers } from "@shared/combat-extras/schemas";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import {
  ConcentrationSet,
  EffectsAdded,
  EffectsEnded,
  EffectUpdated,
} from "@shared/events/combat-extras";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import type { RecordChange } from "../../events/types";
import { activeCombatant } from "../combat-tracker/guards";
import { campaignOf, startedEncounter } from "../combat-tracker/rows";
import {
  checkLimits,
  closeCardsOfEnded,
  type Ended,
  endEffects,
  insertEffect,
  runEffectHooks,
  updateEffectRow,
} from "./effects";
import {
  activeConcentrationOf,
  activeEffectsOf,
  combatantOf,
  combatantTargetColumns,
  type Env,
  effectChange,
  effectCombatantId,
  getEffect,
  hiddenOf,
  readCharacter,
  resolveTarget,
  type Target,
  targetColumns,
  targetKey,
} from "./rows";

const DURATION_NEEDS_ENCOUNTER = "Durations need a running encounter";

/**
 * FR-CBTX-05: anchor = the source if given, else the turn combatant, else the target's
 * combatant; `endsRound = max(round, 1) + durationRounds`.
 */
function timing(
  env: Env,
  enc: EncounterRecord | null,
  t: Target,
  durationRounds: number | undefined,
  source: CombatantRecord | null,
) {
  if (durationRounds === undefined) {
    return { durationRounds: null, endsRound: null, anchorCombatantId: null };
  }
  if (!enc) throw conflict(DURATION_NEEDS_ENCOUNTER);
  return {
    durationRounds,
    endsRound: endsRoundOf(enc.round, durationRounds),
    anchorCombatantId:
      source?.id ?? enc.turnCombatantId ?? combatantOf(env.tx, enc.campaignId, t)?.id ?? null,
  };
}

const merge = (a: Ended, b: Ended): Ended => ({
  changes: [...a.changes, ...b.changes],
  ended: [...a.ended, ...b.ended],
  concentrationIds: [...a.concentrationIds, ...b.concentrationIds],
});
const none = (): Ended => ({ changes: [], ended: [], concentrationIds: [] });

export const addEffect = defineCommand({
  name: CBTX_INTENTS.addEffect,
  input: AddEffectInput,
  execute(input, env): EffectIdsResult {
    const cid = campaignOf(env.actor);
    const enc = startedEncounter(env.tx, cid);
    if (input.durationRounds !== undefined && !enc) throw conflict(DURATION_NEEDS_ENCOUNTER);
    // Two refs to one creature (a PC's combatant and its character) count once.
    const seen = new Set<string>();
    const targets = input.targets
      .map((r) => resolveTarget(env, r))
      .filter((t) => !seen.has(targetKey(t)) && seen.add(targetKey(t)));
    let source: CombatantRecord | null = null;
    if (input.sourceCombatantId !== undefined) {
      source = activeCombatant(env, input.sourceCombatantId, { allowRemoved: true }).c;
    }
    // FR-CBTX-10: a link needs the source's active concentration.
    let concentrationId: string | null = null;
    if (input.linkConcentration && source) {
      const conc = activeConcentrationOf(env.tx, combatantTargetColumns(source));
      if (!conc) throw conflict(`${source.name} is not concentrating`);
      concentrationId = conc.id;
    }
    const ids: string[] = [];
    const changes: RecordChange[] = [];
    let ended = none();
    for (const t of targets) {
      const cols = targetColumns(t);
      if (input.kind === "condition") {
        const have = activeEffectsOf(env.tx, cols).find(
          (e) => e.kind === "condition" && e.condition === input.condition,
        );
        if (have) {
          // FR-CBTX-04: already there → skipped; exhaustion takes the new level.
          if (input.condition === "exhaustion" && have.level !== (input.level ?? null)) {
            changes.push(updateEffectRow(env, have, { level: input.level ?? null }));
            ids.push(have.id);
          }
          continue;
        }
      }
      checkLimits(env, cols, 1);
      const e = insertEffect(env, {
        kind: input.kind,
        condition: input.condition ?? null,
        level: input.level ?? null,
        label: input.label ?? null,
        ...cols,
        encounterId: enc?.id ?? null,
        sourceCombatantId: source?.id ?? null,
        sourceName: source?.name ?? null,
        concentrationId,
        ...timing(env, enc, t, input.durationRounds, source),
        secret: input.secret ?? false,
        hidden: hiddenOf(env.tx, cid, t),
      });
      changes.push(effectChange(null, e));
      ids.push(e.id);
      // FR-CBTX-11: an incapacitating condition ends the target's concentration (+ links).
      if (input.condition && INCAPACITATING_CONDITIONS.includes(input.condition)) {
        const conc = activeConcentrationOf(env.tx, cols);
        if (conc) ended = merge(ended, endEffects(env, [conc], "incapacitated"));
      }
    }
    if (ids.length === 0) return { effectIds: [] };
    env.emit({
      type: EffectsAdded.type,
      campaignId: cid,
      payload: { effectIds: ids },
      changes: [...changes, ...ended.changes, ...runEffectHooks(env, enc)],
    });
    closeCardsOfEnded(env, ended);
    return { effectIds: ids };
  },
});

export const updateEffect = defineCommand({
  name: CBTX_INTENTS.updateEffect,
  input: UpdateEffectInput,
  execute(input, env): void {
    const e = getEffect(env, input.effectId);
    if (e.endedAt !== null) throw conflict("Effect has ended");
    const set: Partial<EffectRecord> = {};
    if (input.level !== undefined) {
      if (e.condition !== "exhaustion") throw invalid("Only exhaustion has a level");
      if (input.level !== e.level) set.level = input.level;
    }
    if (input.durationRounds === null) {
      if (e.durationRounds !== null) {
        Object.assign(set, { durationRounds: null, endsRound: null, anchorCombatantId: null });
      }
    } else if (input.durationRounds !== undefined) {
      // FR-CBTX-08: a new duration counts from now.
      const enc = startedEncounter(env.tx, campaignOf(env.actor));
      if (!enc) throw conflict(DURATION_NEEDS_ENCOUNTER);
      Object.assign(set, {
        durationRounds: input.durationRounds,
        endsRound: endsRoundOf(enc.round, input.durationRounds),
        anchorCombatantId:
          e.anchorCombatantId ??
          e.sourceCombatantId ??
          enc.turnCombatantId ??
          effectCombatantId(env.tx, enc.campaignId, e),
        encounterId: enc.id,
      });
    }
    if (input.secret !== undefined && input.secret !== e.secret) set.secret = input.secret;
    if (Object.keys(set).length === 0) return;
    env.emit({
      type: EffectUpdated.type,
      campaignId: e.campaignId,
      payload: { effectId: e.id },
      changes: [updateEffectRow(env, e, set), ...runEffectHooks(env)],
    });
  },
});

export const endEffect = defineCommand({
  name: CBTX_INTENTS.endEffect,
  input: EndEffectInput,
  roles: ["dm", "player"],
  execute({ effectId }, env): void {
    const e = getEffect(env, effectId);
    if (env.actor.role === "player") {
      // FR-CBTX-08: players end their own PC's concentration only — even while the PC is hidden
      // (FR-CBTX-43, #141); anything else they can't see → not_found.
      const own =
        e.kind === "concentration" &&
        e.targetCharacterId !== null &&
        readCharacter(env.tx, e.targetCharacterId).ownerPlayerId === env.actor.playerId;
      if (!own && !effectVisibleToPlayers(e)) throw notFound("Effect not found");
      if (!own) throw forbidden("Only the DM can end this effect");
    }
    if (e.endedAt !== null) throw conflict("Effect has already ended");
    const ended = endEffects(env, [e], "removed");
    env.emit({
      type: EffectsEnded.type,
      campaignId: e.campaignId,
      payload: { effectIds: ended.ended.map((x) => x.id), reason: "removed" },
      changes: [...ended.changes, ...runEffectHooks(env)],
    });
    closeCardsOfEnded(env, ended);
  },
});

export const setConcentration = defineCommand({
  name: CBTX_INTENTS.setConcentration,
  input: SetConcentrationInput,
  roles: ["dm", "player"],
  execute(input, env): EffectIdResult {
    const cid = campaignOf(env.actor);
    if (env.actor.role === "player" && !("characterId" in input.target)) {
      throw forbidden("Players concentrate on their own character");
    }
    const t = resolveTarget(env, input.target);
    if (
      env.actor.role === "player" &&
      (t.kind !== "character" || t.character.ownerPlayerId !== env.actor.playerId)
    ) {
      throw forbidden("Not your character");
    }
    const enc = startedEncounter(env.tx, cid);
    const cols = targetColumns(t);
    // FR-CBTX-09: one active per creature; the old one ends first (`replaced`, + links).
    const old = activeConcentrationOf(env.tx, cols);
    const ended = old ? endEffects(env, [old], "replaced") : none();
    checkLimits(env, cols, 1);
    const e = insertEffect(env, {
      kind: "concentration",
      condition: null,
      level: null,
      label: input.label,
      ...cols,
      encounterId: enc?.id ?? null,
      sourceCombatantId: null,
      sourceName: null,
      concentrationId: null,
      // The concentrating creature is the caster: its own turn anchors the duration (like a
      // linked effect's source, FR-CBTX-05), else the turn combatant.
      ...timing(env, enc, t, input.durationRounds, enc ? combatantOf(env.tx, cid, t) : null),
      secret: false,
      hidden: hiddenOf(env.tx, cid, t),
    });
    env.emit({
      type: ConcentrationSet.type,
      campaignId: cid,
      payload: { effectId: e.id, ...(old ? { replacedId: old.id } : {}) },
      changes: [...ended.changes, effectChange(null, e), ...runEffectHooks(env, enc)],
    });
    closeCardsOfEnded(env, ended);
    return { effectId: e.id };
  },
});
