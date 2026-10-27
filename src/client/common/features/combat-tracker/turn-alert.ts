// Turn alert predicate (FR-CBT-41, OQ-CBT-30): derived on the owner's client from a live
// `TurnChanged` event whose `encounter` upsert names a PC combatant of a character this player
// owns. Never from a snapshot, a resync or another cause (reveal, restore); a hidden PC never
// reaches its owner, so its turn has a null player copy (#141). A dying own PC: "Your turn —
// Mira (death save)" (FR-CBTX-38). Sprint 6 (FR-CBT-115): also a companion this player owns
// (`ownerPlayerId`), "Owlbear (Mira)"; the owner PC's own alert names its `in-owner-turn`
// companions, "Brakka + Drake Companion, Fire Elemental 2". Kit parity K3 (FR-KIT-59, OQ-KIT-03
// A): the DM's turn card text, "Mira's turn", from the same live frames (`dmTurnCardFor`).
import { COMBATANT_TYPE, type CombatantView, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import type { EventFrame } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import { characterOf, deathStateFor } from "../combat-extras/logic";
import { companionLayout } from "./companions";

export interface TurnAlert {
  id: "cbt.turn";
  title: string;
  detail: string;
  sound: "turn";
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
  const all = store.records[COMBATANT_TYPE] as Record<string, CombatantView> | undefined;
  const c = all?.[turnId];
  if (c?.kind === "monster" && c.ownerPlayerId === me && c.ownerCharacterId) {
    return { ...ALERT, detail: `${c.name} (${ownerName(store, c.ownerCharacterId)})` };
  }
  if (c?.kind !== "pc" || !c.entityId) return null;
  const owner = (store.records[ENTITY_TYPE]?.[c.entityId] as { ownerPlayerId?: string } | undefined)
    ?.ownerPlayerId;
  if (owner !== me) return null;
  // FR-CBTX-38: a dying own PC rolls a death save this turn.
  const dying = deathStateFor(characterOf(store, c.entityId)) === "dying";
  const name = dying ? `${c.name} (death save)` : c.name;
  const rows = Object.values(all ?? {});
  const lines = companionLayout(
    rows.filter((r) => r.encounterId === c.encounterId),
    "playerPosition",
  ).find((r) => r.c.id === c.id)?.lines;
  const extra = lines?.length ? ` + ${lines.map((l) => l.name).join(", ")}` : "";
  return { ...ALERT, detail: `${name}${extra}` };
}

const ALERT = { id: "cbt.turn", title: "Your turn", sound: "turn" } as const;

/** The owner PC's name: its combatant's, else its character's (FR-CBT-115 "Owlbear (Mira)"). */
function ownerName(store: RecordStore, characterId: string): string {
  const rows = Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantView[];
  const pc = rows.find((r) => r.kind === "pc" && r.entityId === characterId);
  const ch = store.records[ENTITY_TYPE]?.[characterId] as { name?: string } | undefined;
  return pc?.name ?? ch?.name ?? "?";
}

/**
 * FR-KIT-59 (OQ-KIT-03 A): the DM's turn card for a live `TurnChanged` frame: "‹name›'s turn" for
 * the combatant whose turn it now is (the DM sees every combatant); null for players, other causes
 * or no current turn. `store` = the store after the frame was applied.
 */
export function dmTurnCardFor(
  frame: Pick<EventFrame, "cause" | "changes">,
  store: RecordStore,
): string | null {
  if (frame.cause.name !== TurnChanged.type || store.you?.role !== "dm") return null;
  const enc = frame.changes.find((c) => c.type === ENCOUNTER_TYPE && c.op === "upsert");
  const turnId = (enc?.data as { turnCombatantId?: string | null } | undefined)?.turnCombatantId;
  if (!turnId) return null;
  const c = store.records[COMBATANT_TYPE]?.[turnId] as CombatantView | undefined;
  return c ? `${c.name}'s turn` : null;
}
