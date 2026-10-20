// `cbt.dismiss` (sprint 6, #252, FR-CBT-112; FR-CBT-120 for the card form): a companion leaves the
// fight in one transaction: `active = false` (players get a delete), its effects end (`removed`),
// a summon's token is deleted (FR-MAP-79, OQ-CBT-83b), a pet writes its HP back (FR-CBT-113) and
// keeps its token, a companion made with `cbt.setCompanion` keeps its token without an owner;
// ranks, one `cbt.companion` line; `CompanionDismissed`. The DM dismisses any companion; a player
// only their own summon (OQ-CBT-78). Not the turn combatant ("Press Next first"). Not undoable.
import { isSummon } from "@shared/combat-tracker/companion";
import { LOG_KIND_COMPANION } from "@shared/combat-tracker/companion-kind";
import {
  CBT_INTENTS,
  type CombatantRecord,
  DismissInput,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { SUMMON_CARD_KIND, SummonCardPayload } from "@shared/combat-tracker/summon-card-kind";
import { CompanionDismissed } from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { combatant, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { closeCardsOfEnded, endEffects, runEffectHooks } from "../combat-extras/effects";
import { activeEffectsOf, combatantTargetColumns } from "../combat-extras/rows";
import { gameLog } from "../dice-roll-log";
import { syncPetPresence } from "../entities/pet-presence";
import { getRow, toEntityRecord } from "../entities/rows";
import { resolveNotification } from "../notifications";
import { loadNotification } from "../notifications/helpers";
import { deleteTokenIn } from "../scenes-map/commands";
import { setTokenOwnerIn } from "../scenes-map/token-owner";
import { resolveSummonCards, summonsLeft } from "./concentration-card";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "./ranks";
import { combatantVisibility } from "./records";
import { campaignOf, combatantsOf, getCombatant, readCombatant, readEncounter } from "./rows";

export const ONLY_COMPANIONS = "Only companions can be dismissed";
/** FR-CBT-112: the turn combatant stays until its turn is over. */
export const PRESS_NEXT_FIRST = "Press Next first";

/** FR-CBT-113: a pet's combatant HP back onto the pet (temp HP dropped); the entity change. */
export function petWriteBack(env: CommandEnv, c: CombatantRecord): RecordChange[] {
  const row = getRow(env.tx, c.entityId);
  if (!row || row.companionOf === null) return [];
  const before = toEntityRecord(row);
  const hp = Math.max(0, c.hpCurrent ?? 0);
  if (before.hpCurrent === hp) return [];
  env.tx
    .update(entity)
    .set({ hpCurrent: hp, updatedAt: env.ctx.clock.iso() })
    .where(eq(entity.id, c.entityId))
    .run();
  const after = toEntityRecord(getRow(env.tx, c.entityId) as NonNullable<typeof row>);
  return [{ type: "entity", id: c.entityId, before, after }];
}

/**
 * FR-CBT-112 / -113: what a companion leaving the fight does to its token and pet, after its
 * combatant is inactive (so the token hook allows the delete): a summon's token is deleted, a
 * pet writes its HP back (and its presence follows), any other companion's token stays without
 * an owner (it is no longer anyone's). The rows for the caller's event.
 */
export function companionLeaves(env: CommandEnv, c: CombatantRecord): RecordChange[] {
  if (c.pet) {
    return [
      ...petWriteBack(env, c),
      ...syncPetPresence(env, campaignOf(env.actor), { petIds: [c.entityId] }),
    ];
  }
  if (!c.tokenId) return [];
  if (c.summoned) return deleteTokenIn(env, c.tokenId);
  return setTokenOwnerIn(env, c.tokenId, null);
}

/** One companion out of the fight; emits its `CompanionDismissed`. Card closures after it. */
function dismissOne(env: CommandEnv, enc: EncounterRecord, c: CombatantRecord): void {
  const { tx } = env;
  const cid = campaignOf(env.actor);
  if (enc.turnCombatantId === c.id) throw conflict(PRESS_NEXT_FIRST);
  const rows = combatantsOf(tx, enc.id);
  const ownerName = rows.find((r) => r.kind === "pc" && r.entityId === c.ownerCharacterId)?.name;
  tx.update(combatant).set({ active: false }).where(eq(combatant.id, c.id)).run();
  // FR-CBT-112 (OQ-CBT-84 c): its effects end (`removed`), linked effects with them.
  const ended = endEffects(env, activeEffectsOf(tx, combatantTargetColumns(c)), "removed");
  const leaves = companionLeaves(env, readCombatant(tx, c.id));
  rerank(tx, enc.id);
  const after = syncPlayerTurn(env, enc.id);
  const entry = gameLog.append(env, {
    kind: LOG_KIND_COMPANION,
    category: "other",
    actorName: env.actor.role === "player" ? (ownerName ?? "") : "DM",
    payload: { action: "dismiss", name: c.name, ...(ownerName ? { ownerName } : {}) },
    dmPayload: {},
    rollIds: [],
    encounterId: enc.id,
    // FR-CBT-122: public iff players saw it.
    public: combatantVisibility(c) !== "hidden",
  });
  env.emit({
    type: CompanionDismissed.type,
    campaignId: cid,
    payload: {
      encounterId: enc.id,
      combatantId: c.id,
      by: env.actor.role === "player" ? env.actor.playerId : "dm",
    },
    changes: [
      ...combatantDiff(tx, rows),
      ...encounterDiff(enc, after),
      ...ended.changes,
      ...leaves,
      ...runEffectHooks(env, after),
      entry,
    ],
  });
  closeCardsOfEnded(env, ended);
}

export const dismissCommand = defineCommand({
  name: CBT_INTENTS.dismiss,
  input: DismissInput,
  roles: ["dm", "player"],
  execute(input, env): void {
    const { tx } = env;
    const cid = campaignOf(env.actor);
    const player = env.actor.role === "player" ? env.actor.playerId : null;
    if ("notificationId" in input) {
      // FR-CBT-120: the card's action, DM only: every summon still with its owner, one tx.
      if (player !== null) throw forbidden("Only the DM can do this");
      const card = loadNotification(env, input.notificationId);
      if (card.kind !== SUMMON_CARD_KIND) throw notFound("Notification not found");
      if (card.state !== "pending") throw conflict("No longer pending");
      const p = SummonCardPayload.parse(card.payload);
      const enc = readEncounter(tx, p.encounterId);
      if (enc.status !== "started") throw conflict("Encounter is not running");
      const left = summonsLeft(combatantsOf(tx, enc.id), p);
      for (const c of left) dismissOne(env, readEncounter(tx, enc.id), readCombatant(tx, c.id));
      resolveNotification(env, card.id, { outcome: "dismissed" }, { byRule: true });
      resolveSummonCards(env, enc.id, "gone");
      return;
    }
    const c = getCombatant(tx, cid, input.combatantId);
    const enc = readEncounter(tx, c.encounterId);
    if (player !== null) {
      // A player sees only what they're shown (FR-CBT-116): hidden → not found.
      if (combatantVisibility(c) === "hidden" && c.active) throw notFound("Combatant not found");
      if (c.ownerPlayerId !== player || !isSummon(c)) {
        throw forbidden("You can dismiss only your own summons");
      }
    }
    if (enc.status !== "started" || c.ownerCharacterId === null) throw invalid(ONLY_COMPANIONS);
    if (!c.active) throw invalid(`${c.name} is no longer in the fight`);
    dismissOne(env, enc, c);
    resolveSummonCards(env, enc.id, "gone");
  },
});
