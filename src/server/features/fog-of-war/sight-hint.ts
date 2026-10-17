// FR-FOG-53 (sprint 4, ADR-0047 option 3A; review A1–A3): fog's member of the move guards' hint
// phase (`moveHints` in scenes-map's `move-guards.ts`). `map.checkMove` runs it only when every
// guard passed (for a DM drag: passed as the token's owner), so a refused cell gives no sight.
// For a counted vision source (FR-FOG-32 / -52) it returns `{guard: "fog-sight", tokenId, see,
// dark}` = that source's polygons with the token at the checked cell (FR-FOG-33), and the signal
// `fog.sight` for `fogSightAudience` (active scene, holders, owner / party; never the DM).
// Read-only: no `seenBy`, memory, `vision`, log or `seq`. Cached in its own LRU (64) by the
// scene's sight base (fog rev, structure rev, map rect, darkness) + the moved source's
// `(tokenId, col, row, size, senses)`, so drags never evict players' sight (FR-FOG-38).
import { FOG_SIGNALS, type FogSightPayload } from "@shared/fog-of-war/schemas";
import { playerVision } from "@shared/fog-of-war/vision";
import { FOG_SIGHT_HINT, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { scene, sceneFog, token } from "../../db/schema";
import type { MoveHintRegistration } from "../scenes-map/move-guards";
import type { SceneRead } from "../scenes-map/visibility-hooks";
import { campaignPlayers } from "./derive";
import { partyVisionOn } from "./settings";
import { isSource, sceneOccluders, sceneSources, sightBase, sightKey } from "./sight";
import { fogSightAudience } from "./sight-signal";
import { type PreviewSight, previewCache } from "./vision-cache";

let computed = 0;

/** Test support: preview polygons computed (cache misses). */
export const previewsComputed = () => computed;

/**
 * FR-FOG-53: the source's polygons with the token at `to`, or null when the token gives no
 * vision (not owned, hidden, beyond the 4 / 12 source caps, owner not a campaign player).
 */
export function previewSight(
  read: SceneRead,
  t: Pick<TokenRecord, "id" | "sceneId" | "ownerPlayerId">,
  to: { col: number; row: number },
): PreviewSight | null {
  const owner = t.ownerPlayerId;
  if (owner === null) return null;
  const s = read
    .select({ campaignId: scene.campaignId })
    .from(scene)
    .where(eq(scene.id, t.sceneId))
    .get();
  if (!s) return null;
  const party = partyVisionOn(read, s.campaignId);
  const sources = sceneSources(read, t.sceneId, campaignPlayers(read, s.campaignId), party);
  const src = sources.get(owner)?.find((x) => x.tokenId === t.id);
  if (!src) return null;
  // The origin is the footprint's centre (FR-FOG-32): keep its offset from the top-left cell.
  const moved = {
    ...src,
    col: to.col,
    row: to.row,
    x: to.col + src.x - src.col,
    y: to.row + src.y - src.row,
  };
  const f = read
    .select({ rev: sceneFog.rev, darkness: sceneFog.darkness })
    .from(sceneFog)
    .where(eq(sceneFog.sceneId, t.sceneId))
    .get();
  const inputs = { sceneId: t.sceneId, fogRev: f ? f.rev : -1, darkness: f?.darkness ?? [] };
  const { base, bounds } = sightBase(read, inputs);
  const key = `${t.sceneId}|${sightKey(base, [moved])}`;
  const cache = previewCache(read);
  const hit = cache.get(key);
  if (hit) return hit;
  const v = playerVision(sceneOccluders(read, t.sceneId, inputs.darkness, bounds), [moved]);
  computed++;
  const out = { see: v.see, dark: v.dark };
  cache.set(key, out);
  return out;
}

/** The hint-phase line (ADR-0047): `fog-sight` + its `fog.sight` fan-out. */
export const fogSightHint: MoveHintRegistration = {
  name: "fog-of-war.sight",
  hint(env, t, to) {
    if (!isSource(t)) return undefined;
    const sight = previewSight(env.read, t, to);
    if (!sight) return undefined;
    const seenBy =
      env.read.select({ seenBy: token.seenBy }).from(token).where(eq(token.id, t.id)).get()
        ?.seenBy ?? null;
    const payload: FogSightPayload = { sceneId: t.sceneId, tokenId: t.id, ...sight };
    const audience = fogSightAudience(env.read, { ...t, seenBy }, env.actor);
    return {
      hint: { guard: FOG_SIGHT_HINT, tokenId: t.id, ...sight },
      signals: audience.length > 0 ? [{ name: FOG_SIGNALS.sight, payload, audience }] : [],
    };
  },
};
