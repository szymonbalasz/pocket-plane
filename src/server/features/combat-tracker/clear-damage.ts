// `cbt.clearDamage` (FR-CBT-178, #428): the DM takes a wrong damage roll off a pending card, ruled
// or not, so a new one can fill it. The card goes back to to-hit-only: the damage (extra parts,
// maxed dice, offers) and any unused rolls leave it, the ruling stays, and `cbt.rollDamage` /
// `cbt.useRoll` complete it again by their usual rule. One transaction, one frame, no toast.
// Rolls stay in the log, stamps included. Not undoable: combat's own rolls can't be used again
// from the log (FR-DICE-96), but the DM can read one there and type its total.
import {
  CBT_INTENTS,
  ClearDamageInput,
  type ClearDamageResult,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { DamageCleared } from "@shared/events/combat-tracker";
import { and, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { triggerUse } from "../../db/schema";
import { loadNotification, updateNotification } from "../notifications/helpers";
import { damageCardText, fitCardPayload } from "./card-kind";
import { ALREADY_APPLIED, NO_DAMAGE_YET } from "./cards";
import { CARD_CHANGED } from "./hp";
import { campaignOf, readEncounter } from "./rows";

export const clearDamageCommand = defineCommand({
  name: CBT_INTENTS.clearDamage,
  input: ClearDamageInput,
  roles: ["dm"],
  execute(input, env): ClearDamageResult {
    const cid = campaignOf(env.actor);
    const card = loadNotification(env, input.cardId);
    if (card.kind !== DAMAGE_CARD_KIND) throw notFound("Damage card not found");
    const p = DamageCardPayload.parse(card.payload);
    const enc = readEncounter(env.tx, p.encounterId);
    if (enc.status !== "started") throw conflict("Encounter has ended");
    if (card.state !== "pending") throw conflict(ALREADY_APPLIED);
    // A card needs a to-hit or a damage roll: a damage-only card is dismissed instead.
    if (!p.toHit) throw invalid("This card has no to-hit roll");
    if (!p.damage) throw conflict(NO_DAMAGE_YET);
    if (p.damage.rollId !== input.damageRollId) throw conflict(CARD_CHANGED);
    const rollIds = [p.damage.rollId, ...(p.damage.extra ?? []).map((x) => x.rollId)];
    const { diceMaxed: _maxed, unusedRolls: _unused, ...rest } = p;
    const payload: DamageCardPayload = { ...rest, damage: null, damageCleared: true };
    env.tx
      .delete(triggerUse)
      .where(and(eq(triggerUse.cardId, card.id), eq(triggerUse.state, "offered")))
      .run();
    env.emit({
      type: DamageCleared.type,
      campaignId: cid,
      payload: { cardId: card.id, encounterId: enc.id, rollIds },
      changes: [
        updateNotification(
          env,
          card.id,
          { text: damageCardText(payload), payload: fitCardPayload(payload) },
          { emit: false },
        ),
      ],
    });
    return { cardId: card.id };
  },
});
