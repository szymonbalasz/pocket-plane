// Overlay tone → canvas colour (visual-direction): `down` = `hp.down`, `bloodied` = `hp.bloodied`,
// `neutral` = foreground. Badge pills (labels layer) and crosses (tokens layer) share it.
import type { CanvasColors } from "../theme";
import type { TokenBadge } from "../token-overlays";

export const toneColor = (c: CanvasColors, tone: TokenBadge["tone"]): string =>
  tone === "down" ? c.hpDown : tone === "bloodied" ? c.hpBloodied : c.foreground;
