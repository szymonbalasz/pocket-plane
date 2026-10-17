// FR-FOG-36 (V3), player client: blind = the player's own `vision` row on the shown scene says
// so; sprint 4 (FR-FOG-50, V10): while party vision is on, only when the whole party is
// (`party-view.ts`). While blind the client draws no other placer's AoE templates (kept ones are
// dropped from the store the canvas layers read), pings or laser over the dark map; they still
// arrive, and the player's own template placement still draws. The chip text is FOG §7's, by
// reason (FR-FOG-21 / -48: darkness, Blinded, or "You can't see" for a secret Blinded).
import { VISION_TYPE, type VisionRecord } from "@shared/fog-of-war/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { AOE_TEMPLATE_TYPE } from "@shared/scene-tools/schemas";
import { BLIND_TEXTS, type ChipReason, partyView } from "./party-view";

export const BLIND_TEXT = BLIND_TEXTS.darkness;

export function isBlind(store: RecordStore, sceneId: string, playerId: string | null): boolean {
  if (playerId === null) return false;
  return partyView(store.records, sceneId, playerId).vision?.blind === true;
}

/**
 * FR-FOG-21 / -48: the chip reason of a blind player, from the store alone (the player's rows are
 * the active scene's): the own `vision` row's scene, else any held one. Null when not blind.
 */
export function blindReasonOf(store: RecordStore): ChipReason | null {
  const me = store.you?.role === "player" ? store.you.playerId : null;
  if (!me) return null;
  const rows = Object.values(store.records[VISION_TYPE] ?? {}) as VisionRecord[];
  const sceneId = (rows.find((v) => v.playerId === me) ?? rows[0])?.sceneId;
  return sceneId === undefined ? null : partyView(store.records, sceneId, me).reason;
}

/**
 * FR-FOG-36: the shown canvas is a blind player's (the DM is never blind). Read by scene-tools'
 * templates layer, which then draws none of the others' live (ephemeral) template previews.
 */
export function canvasBlind(
  client: "dm" | "player",
  store: RecordStore,
  sceneId: string,
  playerId: string | null,
): boolean {
  return client === "player" && isBlind(store, sceneId, playerId);
}

/** The store the canvas layers read while blind: only the player's own kept templates. */
export function blindStore(store: RecordStore, playerId: string | null): RecordStore {
  const byId = store.records[AOE_TEMPLATE_TYPE];
  if (!byId) return store;
  const own = Object.fromEntries(
    Object.entries(byId).filter(
      ([, r]) => (r as { placedByPlayerId?: string | null }).placedByPlayerId === playerId,
    ),
  );
  return { ...store, records: { ...store.records, [AOE_TEMPLATE_TYPE]: own } };
}
