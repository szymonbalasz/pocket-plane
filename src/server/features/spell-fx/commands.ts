// spell-fx intents (VFX §9, ADR-0071): `vfx.cast` (FR-VFX-07, -08) starts a spell row's effect
// through combat-extras' own paths (concentration or custom) with the row's map effect, in one
// transaction with the effect's own events; `vfx.setEffectFx` (FR-VFX-09) sets or clears `fx` on
// an active effect (`EffectFxSet`). Neither rolls, spends a slot or changes HP.
import { AddEffectInput, EffectLabel } from "@shared/combat-extras/intents";
import { EFFECT_LABEL_MAX, effectVisibleToPlayers } from "@shared/combat-extras/schemas";
import { EffectFxSet } from "@shared/events/spell-fx";
import { Fx } from "@shared/spell-fx/fx";
import {
  alreadyActiveMessage,
  CastInput,
  type CastResult,
  noFxMessage,
  ROW_DELETED_MESSAGE,
  SetEffectFxInput,
  VFX_INTENTS,
} from "@shared/spell-fx/intents";
import { and, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { combatant } from "../../db/schema";
import { getSheet } from "../character-sheet/sheet-rows";
import { addEffects, concentrateOn } from "../combat-extras/effect-commands";
import { runEffectHooks, updateEffectRow } from "../combat-extras/effects";
import {
  activeEffectsOf,
  type Env,
  getEffect,
  readCharacter,
  resolveTarget,
  type Target,
  targetColumns,
} from "../combat-extras/rows";
import { campaignOf, startedEncounter, toCombatantRecord } from "../combat-tracker/rows";
import { getRow } from "../entities/rows";

const NOT_FOUND = "Character not found";

/**
 * FR-VFX-07 / OQ-VFX-01 A: the casting creature as an effect target. Player: their own character
 * (a locked sheet is fine, like counters). DM: any character, or a campaign monster with exactly
 * one active combatant in the started encounter (its effects sit on the combatant).
 */
function caster(env: Env, creatureId: string): Target {
  const cid = campaignOf(env.actor);
  const row = getRow(env.tx, creatureId);
  if (!row || row.campaignId !== cid) throw notFound(NOT_FOUND);
  if (row.kind === "character") {
    const t = resolveTarget(env, { characterId: creatureId });
    if (
      env.actor.role === "player" &&
      readCharacter(env.tx, creatureId).ownerPlayerId !== env.actor.playerId
    ) {
      throw forbidden("Not your character");
    }
    return t;
  }
  if (env.actor.role === "player") throw notFound(NOT_FOUND);
  const enc = startedEncounter(env.tx, cid);
  const rows = enc
    ? env.tx
        .select()
        .from(combatant)
        .where(
          and(
            eq(combatant.encounterId, enc.id),
            eq(combatant.entityId, creatureId),
            eq(combatant.active, true),
            eq(combatant.removed, false),
          ),
        )
        .all()
    : [];
  if (rows.length !== 1) {
    throw conflict(
      rows.length === 0
        ? `${row.name} is not in the fight`
        : `Several ${row.name} in the fight: give one its map effect from Initiative`,
    );
  }
  return { kind: "monster", combatant: toCombatantRecord(rows[0]!), name: row.name };
}

/** FR-CBTX-04 labels are ≤ 40 characters; a longer spell name is cut. */
const labelOf = (name: string) => EffectLabel.parse([...name].slice(0, EFFECT_LABEL_MAX).join(""));

export const cast = defineCommand({
  name: VFX_INTENTS.cast,
  input: CastInput,
  roles: ["dm", "player"],
  execute({ creatureId, spellId }, env): CastResult {
    const t = caster(env, creatureId);
    const spell = getSheet(env.tx, creatureId)?.spells.find((s) => s.id === spellId);
    if (!spell) throw notFound(ROW_DELETED_MESSAGE);
    if (!spell.fx) throw conflict(noFxMessage(spell.name));
    if (activeEffectsOf(env.tx, targetColumns(t)).some((e) => e.fx?.spellId === spellId)) {
      throw conflict(alreadyActiveMessage(spell.name));
    }
    // The stored row's preset is re-checked against the catalogue (defaults filled, ≤ 200 B).
    const parsed = Fx.safeParse({ ...spell.fx, spellId });
    if (!parsed.success) throw invalid(`Map effect of ${spell.name} is not valid`);
    const extra = { fx: parsed.data };
    const label = labelOf(spell.name);
    if (spell.concentration) return concentrateOn(env, t, { label }, extra);
    // OQ-VFX-09 A: a custom effect with no duration, ended by hand.
    const ref =
      t.kind === "character" ? { characterId: t.character.id } : { combatantId: t.combatant.id };
    const input = AddEffectInput.parse({ targets: [ref], kind: "custom", label });
    const [effectId] = addEffects(input, env, extra).effectIds;
    return { effectId: effectId as string };
  },
});

export const setEffectFx = defineCommand({
  name: VFX_INTENTS.setEffectFx,
  input: SetEffectFxInput,
  roles: ["dm", "player"],
  execute({ effectId, fx }, env): void {
    const e = getEffect(env, effectId);
    if (env.actor.role === "player") {
      // FR-VFX-09: non-secret effects on their own character; anything unseen → not_found.
      if (!effectVisibleToPlayers(e)) throw notFound("Effect not found");
      const own =
        e.targetCharacterId !== null &&
        readCharacter(env.tx, e.targetCharacterId).ownerPlayerId === env.actor.playerId;
      if (!own) throw forbidden("Only the DM can change this effect");
    }
    if (e.endedAt !== null) throw notFound("Effect not found");
    if (Bun.deepEquals(e.fx, fx, true)) return;
    env.emit({
      type: EffectFxSet.type,
      campaignId: e.campaignId,
      payload: { effectId: e.id },
      changes: [updateEffectRow(env, e, { fx }), ...runEffectHooks(env)],
    });
  },
});
