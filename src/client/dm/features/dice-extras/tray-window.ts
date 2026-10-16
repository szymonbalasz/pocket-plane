// DM `dicex.tray` window (FR-DICEX-01): left edge, just above the DM `dice.log` (460×240).
import { trayWindowBase } from "@ui/features/dice-extras/window";
import { defineWindow } from "@ui/features/play-shell/registry";

export const dmTrayWindow = defineWindow({
  ...trayWindowBase,
  clients: ["dm"],
  defaultPosition: { anchor: "bottom-left", dx: 56, dy: 240 + 12 },
});
