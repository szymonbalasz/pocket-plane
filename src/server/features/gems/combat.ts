// Combat gem (GEM FR-GEM-25–31, GM2): the eligibility rule on top of combat-tracker's generic
// `cards.planMaxDice` / `applyMaxDice` (FR-CBT-128), and the spend line's detail by the card's
// audience (FR-GEM-13, -30). The command (`gem.spend`) writes count + spend line + maxed card in
// one transaction.
import type { CardDiePick, CardKnownDice } from "@shared/combat-tracker/schemas";
import { DAMAGE_CARD_KIND } from "@shared/combat-tracker/schemas";
import type { GemSpendDie, GemSpendTarget } from "@shared/gems/log-kinds";
import { combatDiceLevel, combatDiceLimit } from "@shared/gems/schemas";
import { notificationVisibleTo } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import { cards, type MaxDicePlan } from "../combat-tracker/cards";
import { getCombatant } from "../combat-tracker/rows";
import { loadNotification } from "../notifications/helpers";

export interface CombatSpend {
  cardId: string;
  dice: readonly CardDiePick[];
  known?: readonly CardKnownDice[];
}

/** FR-GEM-26: "Level 6 needed for 2 dice". */
export const levelNeeded = (count: number) =>
  `Level ${combatDiceLevel(count)} needed for ${count} dice`;

/**
 * FR-GEM-25–28: the card the gem goes on, checked before anything is written. A card the sender
 * doesn't receive → `not_found` (GEM §11); the attacker must be the character's own combatant
 * (OQ-GEM-15 A: no companions) else `conflict`; more dice than the character's level allows →
 * `invalid` (FR-GEM-26); then the card rules (`cards.planMaxDice`: pending with damage, incl. the
 * damage step after Apply hit; `diceMaxed` unset; weapon dice only; physical totals need `known`).
 */
export function combatTarget(
  env: CommandEnv,
  character: { id: string; name: string },
  spend: CombatSpend,
): { plan: MaxDicePlan; hidden: boolean } {
  const card = loadNotification(env, spend.cardId);
  const sees =
    env.actor.role !== "player" ||
    notificationVisibleTo(card, { role: "player", playerId: env.actor.playerId });
  if (card.kind !== DAMAGE_CARD_KIND || !sees) {
    throw notFound("Damage card not found");
  }
  const attackerId = (card.payload as { attackerId?: unknown }).attackerId;
  const attacker =
    typeof attackerId === "string" ? getCombatant(env.tx, card.campaignId, attackerId) : null;
  if (attacker?.entityId !== character.id) throw conflict(`Not ${character.name}'s attack`);
  const row = env.tx
    .select({ statBlock: entity.statBlock })
    .from(entity)
    .where(eq(entity.id, character.id))
    .get();
  const level = (row?.statBlock as { level?: number } | undefined)?.level ?? 1;
  if (spend.dice.length > combatDiceLimit(level)) {
    const message = levelNeeded(spend.dice.length);
    throw invalid(message, [{ path: ["dice"], message }]);
  }
  return {
    plan: cards.planMaxDice(env, card.id, spend.dice, spend.known),
    hidden: attacker.hidden,
  };
}

/**
 * FR-GEM-30: "Light crossbow: d8 3 → 8 (rolled 7 → 12)": the attack's name, each maxed die
 * (named by its damage type when the card has more than one part), the damage before and after.
 */
export function cardTarget(plan: MaxDicePlan): { target: GemSpendTarget; dice: GemSpendDie[] } {
  const parts = 1 + (plan.p.damage?.extra?.length ?? 0);
  return {
    target: {
      kind: "card",
      id: plan.card.id,
      label: plan.p.attackName,
      from: plan.from,
      to: plan.to,
    },
    dice: plan.dice.map((d) => ({
      ...(parts > 1 ? { part: d.type ?? "weapon" } : {}),
      faces: d.faces,
      from: d.from,
      to: d.to,
    })),
  };
}

/**
 * FR-GEM-13 (rulings-a #1): the detail takes the card's audience: the owner's card (its rolls are
 * public, as its damage line) → the spend's `payload`; a DM-made card or a hidden attacker → the
 * DM's `dmPayload`, the public line names no detail.
 */
export function cardDetailByAudience(plan: MaxDicePlan, hidden: boolean) {
  const detail = cardTarget(plan);
  return plan.card.audience === "player" && !hidden
    ? { payload: detail, dmPayload: undefined }
    : { payload: { target: null }, dmPayload: detail };
}
