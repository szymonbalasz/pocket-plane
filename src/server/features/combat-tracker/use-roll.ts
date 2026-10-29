// `cbt.useRoll` (FR-CBT-173, -175, -176; sprint 15, #385, ADR-0073 decision 2): the DM builds a
// to-hit-only card (`attack`) or completes the attacker's pending to-hit-only card / makes a
// damage-only card (`damage`) from a logged `roll` entry's rolls. No reroll, no roll hooks: the
// card's rolls are the entry's items. One transaction: the card, the entry's DM-only stamp
// (`gameLog.markUsed`, FR-DICE-96) and `RollUsed`. Not undoable.
import {
  CARD_EXTRA_DICE_MAX,
  CARD_MODS_MAX,
  type CardExtraPart,
  type CardRoll,
  type CardToHit,
  CBT_INTENTS,
  type CombatantRecord,
  DAMAGE_CARD_KIND,
  type DamageCardPayload,
  UseRollInput,
  type UseRollResult,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  EXTRA_PART_TYPE,
  isUsedRoll,
  RollEntryPayload,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import type { PartDamageType } from "@shared/effect-modifiers/schemas";
import { RollUsed } from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import type { DomainEvent } from "../../events/types";
import { gameLog } from "../dice-roll-log";
import { ALREADY_USED, readEntry } from "../dice-roll-log/game-log";
import { notify } from "../notifications";
import { updateNotification } from "../notifications/helpers";
import { damageCardText, fitCardPayload } from "./card-kind";
import { pendingCards } from "./damage";
import { activeCombatant, requireStarted } from "./guards";

export const UNDONE_OR_REROLLED = "That roll was undone or rerolled";
export const NEEDS_D20 = "Use as attack needs a d20";
export const NEEDS_DAMAGE = "Use as damage needs 1–3 damage rolls";

/** FR-DICE-97: the attack item: the one tagged `attack`, else the first with a natural. */
export const attackItemOf = (items: readonly RollPayloadItem[]): RollPayloadItem | undefined =>
  items.find((i) => i.purpose === "attack") ?? items.find((i) => i.natural !== null);

/** FR-DICE-97: the damage items: those tagged `damage`, else every item without a natural. */
export function damageItemsOf(items: readonly RollPayloadItem[]): RollPayloadItem[] {
  const tagged = items.filter((i) => i.purpose === "damage");
  return tagged.length > 0 ? tagged : items.filter((i) => i.natural === null);
}

/** A card roll from a stored item: its dice, constant, total (mods included), manual, mods. */
function cardRollOfItem(item: RollPayloadItem): CardRoll {
  const mods = item.mods?.map(({ dice: _dice, ...m }) => m);
  if (mods && mods.length > CARD_MODS_MAX) {
    throw conflict(`At most ${CARD_MODS_MAX} effect modifiers on an attack or damage roll`);
  }
  return {
    rollId: item.rollId,
    dice: item.dice.map((d) => [d.value, d.kept] as [number | null, boolean]),
    constant: item.constant,
    total: item.total,
    manual: item.manual,
    ...(mods ? { mods } : {}),
  };
}

/** FR-CBT-173 (OQ-CBT-105 A): the roll's player iff they own the attacker (PC or companion). */
function ownerOf(env: CommandEnv, c: CombatantRecord): string | null {
  if (c.kind !== "pc") return c.ownerPlayerId;
  const e = env.tx
    .select({ owner: entity.ownerPlayerId })
    .from(entity)
    .where(eq(entity.id, c.entityId))
    .get();
  return e?.owner ?? null;
}

/**
 * FR-CBT-173: the damage items' final types: an item's own (`part.type`), else the DM's pick
 * (`types[i]`, only for untyped items); items 2–3 must end typed.
 */
function damageTypes(
  items: readonly RollPayloadItem[],
  types: readonly (PartDamageType | null)[] | undefined,
): (PartDamageType | null)[] {
  if (types && types.length > items.length) {
    throw invalid("One type per damage roll", [{ path: ["types"], message: "Too many types" }]);
  }
  return items.map((item, i) => {
    const own = item.part?.type ?? null;
    const picked = types?.[i] ?? null;
    if (own !== null && picked !== null) {
      const message = "That roll already has a type";
      throw invalid(message, [{ path: ["types", i], message }]);
    }
    const type = own ?? picked;
    if (i > 0 && type === null) {
      throw invalid(EXTRA_PART_TYPE, [{ path: ["types", i], message: EXTRA_PART_TYPE }]);
    }
    return type;
  });
}

export const useRollCommand = defineCommand({
  name: CBT_INTENTS.useRoll,
  input: UseRollInput,
  roles: ["dm"],
  execute(input, env): UseRollResult {
    const enc = requireStarted(env);
    const entry = readEntry(env, input.entryId);
    if (!entry) throw notFound("Log entry not found");
    if (entry.kind !== ROLL_KIND) throw invalid("Not a roll");
    if (entry.undone || entry.supersededBy !== null) throw conflict(UNDONE_OR_REROLLED);
    if (isUsedRoll(entry)) throw conflict(ALREADY_USED);
    const { c } = activeCombatant(env, input.attackerId);
    if (c.encounterId !== enc.id) throw notFound("Combatant not found");
    const items = RollEntryPayload.parse(entry.payload);

    const base = {
      encounterId: enc.id,
      attackerId: c.id,
      attackerName: c.name,
    };
    let payload: DamageCardPayload;
    let attachTo: string | null = null;
    if (input.as === "attack") {
      const item = attackItemOf(items);
      if (!item) throw invalid(NEEDS_D20);
      const toHit: CardToHit = { ...cardRollOfItem(item), natural: item.natural };
      payload = {
        ...base,
        attackName: item.label ?? "Attack",
        damageType: null,
        mode: item.mode,
        crit: item.natural === 20,
        toHit,
        damage: null,
      };
    } else {
      const dmg = damageItemsOf(items);
      if (dmg.length < 1 || dmg.length > 3) throw invalid(NEEDS_DAMAGE);
      const types = damageTypes(dmg, input.types);
      const [first, ...rest] = dmg as [RollPayloadItem, ...RollPayloadItem[]];
      const extra = rest.map((item, i): CardExtraPart => {
        if (item.dice.length > CARD_EXTRA_DICE_MAX) {
          throw invalid(`An extra part holds at most ${CARD_EXTRA_DICE_MAX} dice`);
        }
        const { mods: _mods, ...roll } = cardRollOfItem(item);
        return { type: types[i + 1] as PartDamageType, ...roll };
      });
      const damage = { ...cardRollOfItem(first), ...(extra.length ? { extra } : {}) };
      // FR-CBT-171: a used roll is rowless, so any pending to-hit-only card of the attacker.
      // OQ-CBT-104 A: a crit card completed this way is not doubled (the dice are rolled).
      const pending = pendingCards(env, enc, c.id, null).toHit;
      const type = types[0] ?? null;
      if (pending) {
        attachTo = pending.card.id;
        payload = { ...pending.p, damage, ...(type ? { damageType: type } : {}) };
      } else {
        payload = {
          ...base,
          attackName: first.label ?? "Damage",
          damageType: type,
          mode: "normal",
          crit: false,
          toHit: null,
          damage,
        };
      }
    }

    const used: DomainEvent<{
      entryId: string;
      cardId: string;
      encounterId: string;
      as: "attack" | "damage";
      attached: boolean;
    }> = {
      type: RollUsed.type,
      campaignId: enc.campaignId,
      payload: {
        entryId: entry.id,
        cardId: attachTo ?? "",
        encounterId: enc.id,
        as: input.as,
        attached: attachTo !== null,
      },
      changes: [],
    };
    if (attachTo) {
      // BL-92: the completed card rides on `RollUsed` (one frame, no toast).
      used.changes.push(gameLog.markUsed(env, entry.id, attachTo));
      used.changes.push(
        updateNotification(
          env,
          attachTo,
          { text: damageCardText(payload), payload: fitCardPayload(payload) },
          { emit: false },
        ),
      );
      env.emit(used);
      return { cardId: attachTo, attached: true };
    }
    // Owner event first, the card's `NotificationCreated` after (protocol §22); the stamp needs
    // the card id, so it joins `RollUsed`'s changes once `notify` ran (validated at commit).
    env.emit(used);
    const owner = ownerOf(env, c);
    const toPlayer =
      entry.rollerRole === "player" &&
      entry.rollerPlayerId !== null &&
      entry.rollerPlayerId === owner;
    const cardId = notify(env, {
      kind: DAMAGE_CARD_KIND,
      audience: toPlayer ? "player" : "dm",
      audiencePlayerId: toPlayer ? entry.rollerPlayerId : null,
      text: damageCardText(payload),
      payload: fitCardPayload(payload),
      action: { label: "Apply", role: "dm" },
    });
    used.payload.cardId = cardId;
    used.changes.push(gameLog.markUsed(env, entry.id, cardId));
    return { cardId, attached: false };
  },
});
