// FR-FOG-53 (sprint 4, review A1, OQ-FOG-58): `fog.sight`, the server-originated sight preview of
// a dragged source token. Carried by the result of the `map.checkMove` that returned a
// `fog-sight` hint (the hint member is V8's, in `move-guards.ts`); the hub sends it right after
// the ack (`withSignals`, `src/server/ws/signals.ts`), ≤ 4 / s per token per receiver, the excess
// dropped. `fogSightAudience` is who may receive it:
// - nobody unless the token's scene is the campaign's **active** scene (a prep-scene drag reaches
//   no player) and the token is not hidden;
// - only players who hold the token (`dragAudience`'s seers: `seenBy` + its owner, FR-FOG-15);
// - party vision off: the token's owner, when the sender isn't the owner (the DM drags Thorn);
//   on: every such player but the sender, and nobody while the party is blind (FR-FOG-50);
// - never the DM (players only; the hub skips DM connections anyway).
import { FOG_SIGNALS, FogSightPayload } from "@shared/fog-of-war/schemas";
import { partyVision } from "@shared/fog-of-war/vision";
import { eq } from "drizzle-orm";
import { scene } from "../../db/schema";
import { defineServerSignal } from "../../ws/signals";
import type { SceneRead } from "../scenes-map/visibility-hooks";
import { loadSceneSight } from "./derive";

/** FR-FOG-53: ≤ 4 frames per token per receiver in any second. */
export const FOG_SIGHT_PER_SECOND = 4;

export const fogSightSignal = defineServerSignal({
  name: FOG_SIGNALS.sight,
  schema: FogSightPayload,
  rate: { perSecond: FOG_SIGHT_PER_SECOND, key: (d) => d.tokenId },
});

/** The token fields the audience reads. */
export interface SightToken {
  sceneId: string;
  ownerPlayerId: string | null;
  hidden: boolean;
  seenBy?: readonly string[] | null;
}

/** FR-FOG-53: the players who may receive `fog.sight` for `token` sent by `sender`. */
export function fogSightAudience(
  read: SceneRead,
  token: SightToken,
  sender: { role: "dm" | "player" | "system"; playerId: string | null },
): string[] {
  if (token.hidden) return [];
  const s = read
    .select({ active: scene.active })
    .from(scene)
    .where(eq(scene.id, token.sceneId))
    .get();
  if (!s?.active) return [];
  const holders = [...(token.seenBy ?? [])];
  const owner = token.ownerPlayerId;
  if (owner !== null && !holders.includes(owner)) holders.push(owner);
  const me = sender.role === "player" ? sender.playerId : null;
  const loaded = loadSceneSight(read, token.sceneId);
  if (!loaded?.party) return owner !== null && owner !== me ? [owner] : [];
  const party = partyVision([...loaded.sight.values()].map((e) => e.vision));
  if (party?.blind) return [];
  return holders.filter((p) => p !== me);
}
