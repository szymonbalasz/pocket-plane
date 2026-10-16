// FR-FOG-21 / -36: the blind chip over the player's canvas (`fog-blind`), shown while the
// player's own `vision` row on the shown scene is blind. Canvas only (OQ-FOG-40): windows stay.
// The canvas runs under the top bar (z-20), so the chip sits below it, like the tool rail.
import { MoonIcon } from "lucide-react";
import { TOP_BAR_H } from "../play-shell/geometry";
import { BLIND_TEXT } from "./blind";

/** The chip's top offset in px: clear of the top bar (FOG §13 step 9). */
export const BLIND_CHIP_TOP = TOP_BAR_H + 8;

export function FogBlindChip({ blind }: { blind: boolean }) {
  if (!blind) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
      style={{ top: BLIND_CHIP_TOP }}
    >
      <span
        data-testid="fog-blind"
        role="status"
        className="flex items-center gap-1.5 rounded-md bg-background/90 px-3 py-1.5 text-center text-sm text-foreground shadow-sm"
      >
        <MoonIcon className="size-4 shrink-0" />
        {BLIND_TEXT}
      </span>
    </div>
  );
}
