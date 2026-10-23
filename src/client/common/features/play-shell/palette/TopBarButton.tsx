// The top-bar search button (FR-SHELL-195; `top-bar-items.ts` entry, 40 px, both clients, before
// the identity chip): opens the palette. Works while not `live` (local groups still answer).
import { SearchIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Tooltip } from "../../../components/ui/overlays";
import { isMac } from "./context";
import { openPalette } from "./state";

/** The slot's width, px (the launcher-fit check counts it, FR-SHELL-43). */
export const PALETTE_BUTTON_W = 40;

export const paletteTip = (mac: boolean) => `Search and commands (${mac ? "⌘K" : "Ctrl+K"})`;

export function PaletteTopBarButton() {
  const tip = paletteTip(isMac());
  return (
    <Tooltip content={tip}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-10"
        data-testid="ui-palette-open"
        aria-label={tip}
        onClick={() => openPalette()}
      >
        <SearchIcon className="size-4" />
      </Button>
    </Tooltip>
  );
}
