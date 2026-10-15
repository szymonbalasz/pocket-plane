// `cbtx.rollConcentration` (FR-CBTX-18): the action of a concentration card (kind in
// `./card-kind`). Rolls 1d20 + the CON save bonus; a fail ends the concentration (+ links).
import {
  CBTX_INTENTS,
  ConcentrationCardPayload,
  RollConcentrationInput,
  type RollConcentrationResult,
} from "@shared/combat-extras/intents";
import { CONCENTRATION_CARD_KIND } from "@shared/combat-extras/schemas";
import { d20Expression } from "@shared/combat-tracker/rules";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { concentrationSaveBonus, effectiveStats, type StatBlock } from "@shared/entities/schemas";
import { ConcentrationRolled } from "@shared/events/combat-extras";
import { isActionOwner, notificationVisibleTo } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import { readCombatant } from "../combat-tracker/rows";
import { dice, gameLog } from "../dice-roll-log";
import { resolveNotification } from "../notifications";
import { loadNotification } from "../notifications/helpers";
import { closeCardsOfEnded, endEffects } from "./effects";
import { pcCombatant, readCharacter, readEffect } from "./rows";

export const rollConcentration = defineCommand({
  name: CBTX_INTENTS.rollConcentration,
  input: RollConcentrationInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    // FR-DICE-13: player rolls are always public; a player-sent `public` → forbidden.
    if (env.actor.role === "player" && input.public !== undefined) {
      throw forbidden("Player rolls are always public");
    }
  },
  execute(input, env): RollConcentrationResult {
    const card = loadNotification(env, input.notificationId);
    const viewer =
      env.actor.role === "player"
        ? { role: "player" as const, playerId: env.actor.playerId }
        : { role: "dm" as const, playerId: null };
    if (card.kind !== CONCENTRATION_CARD_KIND || !notificationVisibleTo(card, viewer)) {
      throw notFound("Notification not found");
    }
    if (viewer.role === "player" && !isActionOwner(card, viewer)) {
      throw forbidden("Only the action owner or the DM can do this");
    }
    if (card.state !== "pending") throw conflict("No longer pending");
    const p = ConcentrationCardPayload.parse(card.payload);
    const conc = readEffect(env.tx, p.effectId);
    // FR-CBTX-10 closes the card when the concentration ends; belt and braces.
    if (conc.endedAt !== null) throw conflict("Concentration has ended");

    // FR-CBTX-42: the sheet's CON save (CHARX resolver, overrides honoured); monsters the same
    // resolver over their effective stats.
    let name: string;
    let bonus: number | null;
    let hidden: boolean;
    let actorId: string;
    if (conc.targetCharacterId) {
      const ch = readCharacter(env.tx, conc.targetCharacterId);
      name = ch.name;
      bonus = concentrationSaveBonus(ch.statBlock);
      hidden = pcCombatant(env.tx, ch.campaignId, ch.id)?.hidden ?? false;
      actorId = ch.id;
    } else {
      const c = readCombatant(env.tx, conc.targetCombatantId as string);
      const row = env.tx
        .select({ statBlock: entity.statBlock })
        .from(entity)
        .where(eq(entity.id, c.entityId))
        .get();
      if (!row) throw new Error(`Combatant ${c.id}: entity ${c.entityId} missing`);
      name = c.name;
      bonus = concentrationSaveBonus(effectiveStats({ statBlock: row.statBlock as StatBlock }));
      hidden = c.hidden;
      actorId = c.entityId;
    }
    if (bonus === null) throw conflict("No ability scores");

    const label = `Concentration save (DC ${p.dc})`;
    const r = dice.evaluate(env, {
      expression: d20Expression(bonus),
      mode: input.mode,
      category: "saving-throw",
      label,
      actor: { kind: "entity", id: actorId, name },
      manual: input.manual,
      source: "cbt",
      // FR-MOD-15: a concentration save is a CON save of the concentrating creature.
      subject: {
        creature: conc.targetCharacterId
          ? { characterId: conc.targetCharacterId }
          : { combatantId: conc.targetCombatantId as string },
        roll: "save",
        ability: "con",
      },
    });
    // FR-MOD-16: the total vs the DC includes the parts.
    const total = r.total + (r.mods?.modTotal ?? 0);
    const rollIds = dice.rollIdsOf(r);
    const success = total >= p.dc;
    // FR-CBTX-18: player → public (stamped); a hidden creature's save → never.
    const entry = gameLog.append(env, {
      kind: ROLL_KIND,
      category: "saving-throw",
      actorName: name,
      // FR-CBTX-39: "… Concentration save (DC 10): 12 — kept".
      payload: [{ ...dice.rollPayloadItem(r), note: success ? "kept" : "lost" }],
      dmPayload: dice.rollDmPayload([r]),
      rollIds,
      encounterId: p.encounterId,
      public: hidden ? false : input.public,
    });
    const ended = success ? null : endEffects(env, [conc], "save-failed");
    env.emit({
      type: ConcentrationRolled.type,
      campaignId: card.campaignId,
      payload: {
        notificationId: card.id,
        effectId: conc.id,
        rollIds,
        entryId: entry.id,
        total,
        dc: p.dc,
        success,
      },
      changes: [entry, ...(ended?.changes ?? [])],
    });
    resolveNotification(env, card.id, { total, dc: p.dc, success });
    // FR-CBTX-10: a lost concentration closes its other open cards (same transaction).
    if (ended) closeCardsOfEnded(env, ended);
    return { rollIds, entryId: entry.id, success };
  },
});
