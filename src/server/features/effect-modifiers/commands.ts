// effect-modifiers intents (MOD §9): `mod.putPreset`, `mod.deletePreset` (DM; owner on their
// own character presets while unlocked), `mod.apply`, `mod.setModifiers` (DM), `mod.toggle`
// (DM; owner). Effects go through CBTX's internal helpers (limits, insert, soft end, cards), so
// every CBTX rule moves them. One transaction per command (FR-MOD-30); nothing in memory.
import { endsRoundOf } from "@shared/combat-extras/rules";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import {
  ApplyInput,
  type ApplyResult,
  DeletePresetInput,
  MOD_INTENTS,
  PutPresetInput,
  type PutPresetResult,
  SetModifiersInput,
  ToggleInput,
  type ToggleResult,
} from "@shared/effect-modifiers/intents";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { toggleOn } from "@shared/effect-modifiers/rules";
import {
  CAMPAIGN_PRESETS_MAX,
  CHARACTER_PRESETS_MAX,
  type EffectPresetRecord,
  type Modifier,
} from "@shared/effect-modifiers/schemas";
import type { CharacterRecord } from "@shared/entities/schemas";
import {
  EffectModifiersSet,
  EffectPresetDeleted,
  EffectPresetSaved,
  EffectToggled,
  PresetApplied,
} from "@shared/events/effect-modifiers";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid } from "../../commands/errors";
import { effectPreset, effectPresetSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { editableCreature, NOT_YOURS } from "../character-sheet/access";
import { getCharacter } from "../character-sheet/hp";
import {
  checkLimits,
  closeCardsOfEnded,
  type Ended,
  endEffects,
  insertEffect,
  updateEffectRow,
} from "../combat-extras/effects";
import {
  activeConcentrationOf,
  activeEffectsOf,
  combatantOf,
  combatantTargetColumns,
  effectChange,
  effectsByIds,
  getEffect,
  hiddenOf,
  resolveTarget,
  type Target,
  targetColumns,
  targetKey,
} from "../combat-extras/rows";
import { activeCombatant } from "../combat-tracker/guards";
import { startedEncounter } from "../combat-tracker/rows";
import {
  campaignOf,
  customisedPreset,
  getPreset,
  presetChange,
  presetCount,
  readPreset,
} from "./rows";

type Env = CommandEnv;

/** Player edits: their own character's presets while the sheet is unlocked (FR-MOD-07). */
function editableCharacter(env: Env, characterId: string): CharacterRecord {
  const { creature } = editableCreature(env, characterId);
  if (creature.kind !== "character") throw invalid("Character presets need a character");
  return creature;
}

// ---------- presets (FR-MOD-06, -07) ----------

export const putPreset = defineCommand({
  name: MOD_INTENTS.putPreset,
  input: PutPresetInput,
  roles: ["dm", "player"],
  execute({ preset: p }, env): PutPresetResult {
    const cid = campaignOf(env);
    if (p.characterId === null && env.actor.role !== "dm") {
      throw forbidden("Only the DM edits campaign presets");
    }
    const before = p.id === undefined ? null : getPreset(env, p.id);
    if (before && (before.characterId !== p.characterId || before.key !== p.key)) {
      throw invalid("A preset keeps its character and key");
    }
    const owner = p.characterId === null ? null : editableCharacter(env, p.characterId);
    if (!before) {
      if (p.key !== null) {
        if (!builtinPreset(p.key)) throw invalid("This built-in preset is not available yet");
        if (customisedPreset(env.tx, cid, p.key)) {
          throw conflict(`${builtinPreset(p.key)?.name} is already customised`);
        }
      }
      const max = p.characterId === null ? CAMPAIGN_PRESETS_MAX : CHARACTER_PRESETS_MAX;
      if (presetCount(env.tx, cid, p.characterId) >= max) {
        throw conflict(
          p.characterId === null
            ? `At most ${max} campaign presets`
            : `At most ${max} presets per character`,
        );
      }
    }
    const now = env.ctx.clock.iso();
    const values = {
      name: p.name,
      modifiers: p.modifiers as Modifier[],
      durationRounds: p.durationRounds,
      concentration: p.concentration,
      note: p.note,
      ownerPlayerId: owner?.ownerPlayerId ?? null,
      // FR-MOD-36: kept on a replace that doesn't name it.
      originKey: p.originKey === undefined ? (before?.originKey ?? null) : p.originKey,
      updatedAt: now,
    };
    let id: string;
    if (before) {
      id = before.id;
      env.tx.update(effectPreset).set(values).where(eq(effectPreset.id, id)).run();
    } else {
      id = env.ctx.ids.next();
      env.tx
        .insert(effectPreset)
        .values({
          ...values,
          id,
          campaignId: cid,
          seq: effectPresetSeqNext,
          key: p.key,
          characterId: p.characterId,
          activeEffectId: null,
          usesFeatureId: null,
          createdAt: now,
        })
        .run();
    }
    env.emit({
      type: EffectPresetSaved.type,
      campaignId: cid,
      payload: { presetId: id },
      changes: [presetChange(before, readPreset(env.tx, id))],
    });
    return { presetId: id };
  },
});

export const deletePreset = defineCommand({
  name: MOD_INTENTS.deletePreset,
  input: DeletePresetInput,
  roles: ["dm", "player"],
  execute({ presetId }, env): void {
    const before = getPreset(env, presetId);
    if (before.characterId !== null) editableCharacter(env, before.characterId);
    env.tx.delete(effectPreset).where(eq(effectPreset.id, before.id)).run();
    env.emit({
      type: EffectPresetDeleted.type,
      campaignId: before.campaignId,
      payload: { presetId: before.id },
      changes: [presetChange(before, null)],
    });
  },
});

// ---------- apply (FR-MOD-09, -10) ----------

/** What an apply copies: name, modifiers, defaults and the effect's `presetKey`. */
interface Resolved {
  presetKey: string;
  name: string;
  modifiers: Modifier[];
  durationRounds: number | null;
  concentration: boolean;
  characterId: string | null;
}

function resolvePreset(env: Env, ref: ApplyInput["preset"]): Resolved {
  if ("key" in ref) {
    const row = customisedPreset(env.tx, campaignOf(env), ref.key);
    const b = row ?? builtinPreset(ref.key);
    if (!b) throw invalid("This built-in preset is not available yet");
    return { ...pick(b), presetKey: ref.key, characterId: null };
  }
  const row = getPreset(env, ref.presetId);
  // A customised built-in keeps the built-in key (FR-MOD-09); other rows their id.
  return { ...pick(row), presetKey: row.key ?? row.id, characterId: row.characterId };
}

const pick = (p: {
  name: string;
  modifiers: Modifier[];
  durationRounds: number | null;
  concentration: boolean;
}) => ({
  name: p.name,
  modifiers: [...p.modifiers],
  durationRounds: p.durationRounds,
  concentration: p.concentration,
});

/**
 * FR-MOD-09 duration: dropped (no `conflict`) without a started encounter or when the creature
 * is not in it; anchor per FR-CBTX-05 (source, else the turn combatant, else the target's).
 */
function timing(
  env: Env,
  enc: EncounterRecord | null,
  t: Target,
  durationRounds: number | null,
  source: CombatantRecord | null,
) {
  const own = enc ? combatantOf(env.tx, enc.campaignId, t) : null;
  if (durationRounds === null || !enc || !own) {
    return { durationRounds: null, endsRound: null, anchorCombatantId: null };
  }
  return {
    durationRounds,
    endsRound: endsRoundOf(enc.round, durationRounds),
    anchorCombatantId: source?.id ?? enc.turnCombatantId ?? own.id,
  };
}

const noneEnded = (): Ended => ({ changes: [], ended: [], concentrationIds: [] });

export const applyPreset = defineCommand({
  name: MOD_INTENTS.apply,
  input: ApplyInput,
  execute(input, env): ApplyResult {
    const cid = campaignOf(env);
    const preset = resolvePreset(env, input.preset);
    const enc = startedEncounter(env.tx, cid);
    const seen = new Set<string>();
    const targets = input.targets
      .map((r) => resolveTarget(env, r))
      .filter((t) => !seen.has(targetKey(t)) && seen.add(targetKey(t)));
    if (
      preset.characterId !== null &&
      targets.some((t) => t.kind !== "character" || t.character.id !== preset.characterId)
    ) {
      throw invalid("Character presets can't be applied to another creature");
    }
    const durationRounds =
      input.durationRounds === undefined ? preset.durationRounds : input.durationRounds;
    const source =
      input.sourceCombatantId === undefined
        ? null
        : activeCombatant(env, input.sourceCombatantId, { allowRemoved: true }).c;

    // FR-MOD-10: start (an active one ends `replaced`, + its links) or find the concentration.
    let ended = noneEnded();
    let concentrationId: string | null = null;
    let started: string | undefined;
    const changes: RecordChange[] = [];
    if (source && input.startConcentration) {
      if (!preset.concentration) throw invalid(`${preset.name} is not a concentration preset`);
      const caster = resolveTarget(env, { combatantId: source.id });
      const cols = targetColumns(caster);
      const old = activeConcentrationOf(env.tx, cols);
      if (old) ended = endEffects(env, [old], "replaced");
      checkLimits(env, cols, 1);
      const conc = insertEffect(env, {
        kind: "concentration",
        condition: null,
        level: null,
        label: preset.name,
        ...cols,
        encounterId: enc?.id ?? null,
        sourceCombatantId: null,
        sourceName: null,
        concentrationId: null,
        ...timing(env, enc, caster, durationRounds, source),
        secret: false,
        hidden: hiddenOf(env.tx, cid, caster),
      });
      changes.push(effectChange(null, conc));
      concentrationId = started = conc.id;
    } else if (source && input.linkConcentration) {
      const conc = activeConcentrationOf(env.tx, combatantTargetColumns(source));
      if (!conc) throw conflict(`${source.name} is not concentrating`);
      concentrationId = conc.id;
    }

    const ids: string[] = [];
    const skipped: string[] = [];
    for (const t of targets) {
      const cols = targetColumns(t);
      if (activeEffectsOf(env.tx, cols).some((e) => e.presetKey === preset.presetKey)) {
        skipped.push(t.name);
        continue;
      }
      checkLimits(env, cols, 1);
      const e = insertEffect(env, {
        kind: "custom",
        condition: null,
        level: null,
        label: preset.name,
        ...cols,
        encounterId: enc?.id ?? null,
        sourceCombatantId: source?.id ?? null,
        sourceName: source?.name ?? null,
        concentrationId,
        ...timing(env, enc, t, durationRounds, source),
        secret: input.secret ?? false,
        hidden: hiddenOf(env.tx, cid, t),
        modifiers: preset.modifiers,
        presetKey: preset.presetKey,
      });
      changes.push(effectChange(null, e));
      ids.push(e.id);
    }
    if (ids.length === 0 && !started) return { effectIds: [], skipped };
    env.emit({
      type: PresetApplied.type,
      campaignId: cid,
      payload: {
        presetKey: preset.presetKey,
        effectIds: ids,
        ...(started ? { concentrationId: started } : {}),
      },
      changes: [...ended.changes, ...changes],
    });
    closeCardsOfEnded(env, ended);
    return { effectIds: ids, skipped };
  },
});

// ---------- toggle (FR-MOD-11) ----------

export const togglePreset = defineCommand({
  name: MOD_INTENTS.toggle,
  input: ToggleInput,
  roles: ["dm", "player"],
  execute(input, env): ToggleResult {
    if (env.actor.role === "player" && input.force) throw forbidden("Only the DM can force");
    const character = getCharacter(env, input.characterId);
    if (env.actor.role === "player" && character.ownerPlayerId !== env.actor.playerId) {
      throw forbidden(NOT_YOURS);
    }
    const preset = getPreset(env, input.presetId);
    if (preset.characterId === null) throw invalid("Campaign presets are applied, not toggled");
    if (preset.characterId !== character.id) throw invalid("Not a preset of this character");
    const current = preset.activeEffectId ? effectsByIds(env.tx, [preset.activeEffectId]) : [];
    const on = toggleOn(preset, current);
    // Already in the asked state → success, no event.
    if (on === input.on) return { effectId: on ? preset.activeEffectId : null };
    return input.on ? toggleOnCmd(env, character, preset) : toggleOffCmd(env, character, preset);
  },
});

function setActive(env: Env, p: EffectPresetRecord, activeEffectId: string | null): RecordChange {
  env.tx
    .update(effectPreset)
    .set({ activeEffectId, updatedAt: env.ctx.clock.iso() })
    .where(eq(effectPreset.id, p.id))
    .run();
  return presetChange(p, readPreset(env.tx, p.id));
}

function toggleOnCmd(env: Env, c: CharacterRecord, p: EffectPresetRecord): ToggleResult {
  const cid = campaignOf(env);
  const enc = startedEncounter(env.tx, cid);
  const t: Target = { kind: "character", character: c, name: c.name };
  const cols = targetColumns(t);
  checkLimits(env, cols, 1);
  const e = insertEffect(env, {
    kind: "custom",
    condition: null,
    level: null,
    label: p.name,
    ...cols,
    encounterId: enc?.id ?? null,
    sourceCombatantId: null,
    sourceName: null,
    concentrationId: null,
    // No source: the character's own combatant anchors the duration.
    ...timing(env, enc, t, p.durationRounds, enc ? combatantOf(env.tx, cid, t) : null),
    secret: false,
    hidden: hiddenOf(env.tx, cid, t),
    modifiers: [...p.modifiers],
    presetKey: p.id,
  });
  env.emit({
    type: EffectToggled.type,
    campaignId: cid,
    payload: { characterId: c.id, presetId: p.id, on: true, effectId: e.id },
    changes: [effectChange(null, e), setActive(env, p, e.id)],
  });
  return { effectId: e.id };
}

function toggleOffCmd(env: Env, c: CharacterRecord, p: EffectPresetRecord): ToggleResult {
  const effectId = p.activeEffectId as string;
  const ended = endEffects(env, effectsByIds(env.tx, [effectId]), "removed");
  env.emit({
    type: EffectToggled.type,
    campaignId: p.campaignId,
    payload: { characterId: c.id, presetId: p.id, on: false, effectId },
    changes: [...ended.changes, setActive(env, p, null)],
  });
  closeCardsOfEnded(env, ended);
  return { effectId: null };
}

// ---------- edit an effect's modifiers (FR-MOD-08) ----------

export const setModifiers = defineCommand({
  name: MOD_INTENTS.setModifiers,
  input: SetModifiersInput,
  execute({ effectId, modifiers }, env): void {
    const e = getEffect(env, effectId);
    if (e.kind !== "custom") throw invalid("Only custom effects carry modifiers");
    if (e.endedAt !== null) throw conflict("Effect has ended");
    if (JSON.stringify(e.modifiers) === JSON.stringify(modifiers)) return;
    env.emit({
      type: EffectModifiersSet.type,
      campaignId: e.campaignId,
      payload: { effectId: e.id },
      changes: [updateEffectRow(env, e, { modifiers: modifiers as Modifier[] })],
    });
  },
});
