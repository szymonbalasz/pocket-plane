// FR-FOG-36 (V3), player client: blind = the player's own `vision` row on the shown scene says
// so. While blind the client draws no other placer's AoE templates (kept ones are dropped from
// the store the canvas layers read), pings or laser over the dark map; they still arrive, and
// the player's own template placement still draws. The chip text is FOG §7's.
import { scenePlayerId, VISION_TYPE, type VisionRecord } from "@shared/fog-of-war/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { AOE_TEMPLATE_TYPE } from "@shared/scene-tools/schemas";

export const BLIND_TEXT = "Magical darkness — you can't see";

export function isBlind(store: RecordStore, sceneId: string, playerId: string | null): boolean {
  if (playerId === null) return false;
  const v = store.records[VISION_TYPE]?.[scenePlayerId(sceneId, playerId)] as
    | VisionRecord
    | undefined;
  return v?.blind === true;
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
