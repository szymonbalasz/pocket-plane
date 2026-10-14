// Turn alert predicate (FR-CBT-41, OQ-CBT-30): derived on the owner's client from a live
// `TurnChanged` event whose `encounter` upsert names a PC combatant of a character this player
// owns. Never from a snapshot, a resync or another cause (reveal, restore); a hidden PC never
// reaches its owner, so its turn has a null player copy (#141). A dying own PC: "Your turn —
// Mira (death save)" (FR-CBTX-38).
import { COMBATANT_TYPE, type CombatantView, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import type { EventFrame } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import { characterOf, deathStateFor } from "../combat-extras/logic";

export interface TurnAlert {
  id: "cbt.turn";
  title: string;
  detail: string;
  sound: "ping";
}

/** `store` = the store after the frame was applied. */
export function turnAlertFor(
  frame: Pick<EventFrame, "cause" | "changes">,
  store: RecordStore,
): TurnAlert | null {
  if (frame.cause.name !== TurnChanged.type) return null;
  const me = store.you?.role === "player" ? store.you.playerId : null;
  if (!me) return null;
  const enc = frame.changes.find((c) => c.type === ENCOUNTER_TYPE && c.op === "upsert");
  const turnId = (enc?.data as { playerTurnCombatantId?: string | null } | undefined)
    ?.playerTurnCombatantId;
  if (!turnId) return null;
  const c = store.records[COMBATANT_TYPE]?.[turnId] as CombatantView | undefined;
  if (c?.kind !== "pc" || !c.entityId) return null;
  const owner = (store.records[ENTITY_TYPE]?.[c.entityId] as { ownerPlayerId?: string } | undefined)
    ?.ownerPlayerId;
  if (owner !== me) return null;
  // FR-CBTX-38: a dying own PC rolls a death save this turn.
  const dying = deathStateFor(characterOf(store, c.entityId)) === "dying";
  return {
    id: "cbt.turn",
    title: "Your turn",
    detail: dying ? `${c.name} (death save)` : c.name,
    sound: "ping",
  };
}
