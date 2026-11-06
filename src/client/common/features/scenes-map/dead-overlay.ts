// FR-MAP-151: a token marked dead draws the red X (combat's Down look) on every client that
// receives it, in or out of combat. Combat's own Down X, earlier in the registry, wins when both
// apply (same look).
import type { TokenCross, TokenOverlay } from "./token-overlays";

export const DEAD_CROSS: TokenCross = { id: "map-token-dead", tone: "down" };

export const deadTokenOverlay: TokenOverlay = {
  id: "dead",
  decorate: (token) => (token.dead ? { cross: DEAD_CROSS } : null),
};
