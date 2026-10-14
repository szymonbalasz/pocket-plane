// Overlay tone → canvas colour (visual-direction): `down` = `hp.down`, `bloodied` = `hp.bloodied`,
// `full` = `hp.full` (bars), `neutral` = foreground. Badge pills (labels layer), crosses, bars and
// icons (tokens layer) share it.
import type { CanvasColors } from "../theme";
import type { TokenBadge, TokenBar } from "../token-overlays";

export const toneColor = (c: CanvasColors, tone: TokenBadge["tone"] | TokenBar["tone"]): string =>
  tone === "down"
    ? c.hpDown
    : tone === "bloodied"
      ? c.hpBloodied
      : tone === "full"
        ? c.hpFull
        : c.foreground;
