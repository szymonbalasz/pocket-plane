// Player window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its player window types; nothing else changes here.
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";
import { shellTestWindow, syncProbesWindow } from "@ui/features/play-shell/test-windows";
import { playerInitiativeWindow } from "./features/combat-tracker/initiative-window";
import { playerDiceLogWindow } from "./features/dice-roll-log/log-window";
import { notificationsHistoryWindow } from "./features/notifications/history-window";

const windows: WindowDef[] = [
  syncProbesWindow, // sync.probes, test mode (play-shell, FR-SHELL-21)
  shellTestWindow, // shell.test, test mode (play-shell, FR-SHELL-20)
  notificationsHistoryWindow, // note.history (notifications, FR-NOTE-17)
  playerDiceLogWindow, // dice.log (dice-roll-log, FR-DICE-21)
  playerInitiativeWindow, // cbt.initiative (combat-tracker, CBT §7)
];

export const playerWindows = createWindowRegistry("player", windows);
