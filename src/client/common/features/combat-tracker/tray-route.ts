// Tray route (FR-CBT-172, ADR-0073 decision 3; one line in dice-extras' `trayRoutes`): a `free`
// Attack / Damage roll whose actor is an active, non-removed combatant of the started encounter
// the sender may attack as → rowless `cbt.attack {rolls: "toHit"}` / `cbt.rollDamage` (FR-CBT-171)
// with the tray's parts, label and mode. Player: an own PC or an own companion; DM: a
// `{combatantId}`, a bound token or an entity with one such combatant. Else the tray sends
// `dice.roll {purpose}` (a label only). The server decides the card; this only picks the intent.
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import type { DmRollActorRef } from "@shared/dice-roll-log/schemas";
import type { EntityRecord } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TrayRoute, TrayRouteClaim } from "../dice-extras/tray-routing";
import { manualFields, notesOf, pendingToHitCard } from "./roll-route";
import { startedIn } from "./store";

export const COMBAT_TRAY_ROUTE_KEY = "combat-tracker";

/** The started encounter's active, non-removed combatants in this client's store. */
function activeCombatants(store: RecordStore): CombatantView[] {
  const enc = startedIn(store);
  if (!enc) return [];
  const all = Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantView[];
  return all.filter((c) => c.encounterId === enc.id && c.active !== false && !c.removed);
}

/**
 * FR-CBT-172: the combatant a tray actor attacks as, or null. Player: `{entityId}` of an own PC
 * (the entity's owner) or an own companion (FR-CBT-114); DM: `{combatantId}`, a bound
 * `{tokenId}`, or an `{entityId}` with exactly one combatant.
 */
export function trayAttacker(
  store: RecordStore,
  actor: DmRollActorRef | undefined,
): CombatantView | null {
  const you = store.you;
  if (!you || !actor) return null;
  const list = activeCombatants(store);
  if (you.role === "player") {
    if (!("entityId" in actor)) return null;
    const entity = store.records.entity?.[actor.entityId] as EntityRecord | undefined;
    const ownPc = entity?.ownerPlayerId === you.playerId && entity?.kind === "character";
    const mine = list.filter(
      (c) =>
        c.entityId === actor.entityId &&
        (c.kind === "pc" ? ownPc : c.ownerPlayerId === you.playerId),
    );
    return mine.length === 1 ? (mine[0] as CombatantView) : null;
  }
  if ("combatantId" in actor) return list.find((c) => c.id === actor.combatantId) ?? null;
  if ("tokenId" in actor) return list.find((c) => c.tokenId === actor.tokenId) ?? null;
  const of = list.filter((c) => c.entityId === actor.entityId);
  return of.length === 1 ? (of[0] as CombatantView) : null;
}

export const combatTrayRoute: TrayRoute = {
  key: COMBAT_TRAY_ROUTE_KEY,
  order: 10,
  claim(store, request): TrayRouteClaim | null {
    const c = trayAttacker(store, request.actor);
    if (!c) return null;
    const label = request.label ? { label: request.label } : {};
    if (request.purpose === "attack") {
      return {
        crit: false,
        send: (sendIntent, parts, roll) =>
          sendIntent("cbt.attack", {
            attackerId: c.id,
            mode: roll.mode,
            rolls: "toHit",
            parts,
            rowless: true,
            ...label,
            ...(roll.manual ? { manual: roll.manual.slice(0, 1) } : {}),
            ...(roll.manualParts ? { manualParts: roll.manualParts.slice(0, 1) } : {}),
          }),
      };
    }
    // FR-CBT-172: a crit iff the attacker's latest pending to-hit-only card (any row, FR-CBT-171's
    // match) has a natural 20: the tray shows the badge, the server doubles.
    const card = pendingToHitCard(notesOf(store), c.id, null);
    return {
      crit: card?.toHit?.natural === 20,
      send: (sendIntent, parts, roll) =>
        sendIntent("cbt.rollDamage", {
          attackerId: c.id,
          parts,
          rowless: true,
          ...label,
          ...manualFields(roll, 1),
        }),
    };
  },
};
