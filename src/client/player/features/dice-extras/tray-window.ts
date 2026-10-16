// Player `dicex.tray` window (FR-DICEX-01): left edge, just above the player `dice.log` (340×280).
import { trayWindowBase } from "@ui/features/dice-extras/window";
import { defineWindow } from "@ui/features/play-shell/registry";

export const playerTrayWindow = defineWindow({
  ...trayWindowBase,
  clients: ["player"],
  defaultPosition: { anchor: "bottom-left", dx: 56, dy: 280 + 12 },
});
