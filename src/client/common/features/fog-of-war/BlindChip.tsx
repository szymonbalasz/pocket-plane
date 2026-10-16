// FR-FOG-21 / -36: the blind chip over the player's canvas (`fog-blind`), shown while the
// player's own `vision` row on the shown scene is blind. Canvas only (OQ-FOG-40): windows stay.
import { MoonIcon } from "lucide-react";
import { BLIND_TEXT } from "./blind";

export function FogBlindChip({ blind }: { blind: boolean }) {
  if (!blind) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <span
        data-testid="fog-blind"
        role="status"
        className="flex items-center gap-1.5 rounded-md bg-background/90 px-3 py-1.5 text-sm text-foreground shadow-sm"
      >
        <MoonIcon className="size-4" />
        {BLIND_TEXT}
      </span>
    </div>
  );
}
