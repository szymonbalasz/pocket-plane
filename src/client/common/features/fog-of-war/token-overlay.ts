// Fog's token overlay `fog` (registry FR-MAP-34), DM only (players never get either state):
// - FR-FOG-20: a "Fog" badge on tokens seen by no player (`fogged` and no owner, FR-FOG-10).
//   `hidden` tokens keep their own styling instead (no badge; FOG §13 step 1).
// - FR-FOG-47 (#210): an invisible token draws at ≈ 50 % with an "Invisible" badge.
// - FR-FOG-20 / -47 View as P: tokens P can't see are dimmed (FR-FOG-34 / -46 on P's loaded
//   `vision`; sprint 4: the drawn union while party vision is on, and for View as Party,
//   `party-view.ts`); an invisible token P sees through a Sees-invisible polygon is not.
import { seenByNobody, TOKEN_SUBJECT } from "@shared/fog-of-war/visibility";
import type { TokenBadge, TokenOverlay } from "../scenes-map/token-overlays";
import { partyView } from "./party-view";
import { dmFogOf, useViewAs, viewAsFor, viewAsSees, visionOf } from "./view-as";

export const FOG_BADGE: TokenBadge = {
  id: "fog-token-fogged",
  icon: "cloud-fog",
  tone: "neutral",
  label: "Fog",
};

export const INVISIBLE_BADGE: TokenBadge = {
  id: "fog-token-invisible",
  icon: "ghost",
  tone: "neutral",
  label: "Invisible",
};

export const fogTokenOverlay: TokenOverlay = {
  id: "fog",
  decorate(token, store, view) {
    if (view.client !== "dm") return null;
    const invisible = (token as { invisible?: boolean }).invisible === true;
    const badges: TokenBadge[] = [];
    if (!token.hidden && seenByNobody(TOKEN_SUBJECT, token)) badges.push(FOG_BADGE);
    if (invisible) badges.push(INVISIBLE_BADGE);
    const pair = viewAsFor(token.sceneId);
    let dim = invisible;
    if (pair) {
      const v = partyView(store.records, pair.sceneId, pair.playerId).vision;
      dim = !viewAsSees(
        { ...token, invisible },
        pair.playerId,
        visionOf(v),
        dmFogOf(store.records, token.sceneId),
      );
    }
    if (badges.length === 0 && !dim) return null;
    return dim ? { badges, dim } : { badges };
  },
  // View as is client state: a pick or a load re-runs the decorations.
  subscribe: (onChange) =>
    useViewAs.subscribe((s, prev) => {
      if (s.loaded !== prev.loaded) onChange();
    }),
};
