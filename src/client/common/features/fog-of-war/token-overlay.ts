// Fog's token overlay `fog` (FR-FOG-20, registry FR-MAP-34): a DM-only "Fog" badge on fog-hidden
// tokens (`fogged` and no owner, FR-FOG-11). `hidden` tokens keep their own styling instead (no
// badge; FOG §13 step 1); players never get the badge (they never receive a fog-hidden token).
import { fogHidden, TOKEN_SUBJECT } from "@shared/fog-of-war/visibility";
import type { TokenBadge, TokenOverlay } from "../scenes-map/token-overlays";

export const FOG_BADGE: TokenBadge = {
  id: "fog-token-fogged",
  icon: "cloud-fog",
  tone: "neutral",
  label: "Fog",
};

export const fogTokenOverlay: TokenOverlay = {
  id: "fog",
  decorate(token, _store, view) {
    if (view.client !== "dm" || token.hidden || !fogHidden(TOKEN_SUBJECT, token)) return null;
    return { badges: [FOG_BADGE] };
  },
};
