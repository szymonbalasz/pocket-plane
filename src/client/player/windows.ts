// Player window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its player window types; nothing else changes here.
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";
import { shellTestWindow, syncProbesWindow } from "@ui/features/play-shell/test-windows";
import { playerCompanionWindow } from "./features/character-sheet/companion-window";
import { playerCharSheetWindow } from "./features/character-sheet/sheet-window";
import { playerInitiativeWindow } from "./features/combat-tracker/initiative-window";
import { playerCompendiumWindow } from "./features/compendium/compendium-window";
import { playerTrayWindow } from "./features/dice-extras/tray-window";
import { playerDiceLogWindow } from "./features/dice-roll-log/log-window";
import { notificationsHistoryWindow } from "./features/notifications/history-window";
import { playerPartyBoardWindow } from "./features/party-board/board-window";
import { playerHandoutWindow } from "./features/party-board/handout-window";

const windows: WindowDef[] = [
  syncProbesWindow, // sync.probes, test mode (play-shell, FR-SHELL-21)
  shellTestWindow, // shell.test, test mode (play-shell, FR-SHELL-20)
  notificationsHistoryWindow, // note.history (notifications, FR-NOTE-17)
  playerDiceLogWindow, // dice.log (dice-roll-log, FR-DICE-21)
  playerCharSheetWindow, // char.sheet (character-sheet, FR-CHAR-15)
  playerInitiativeWindow, // cbt.initiative (combat-tracker, CBT §7)
  playerTrayWindow, // dicex.tray (dice-extras, FR-DICEX-01)
  playerPartyBoardWindow, // party.board (party-board, FR-PARTY-11)
  { ...playerHandoutWindow, restoreOpen: false }, // party.handout (party-board, FR-PARTY-14; FR-SHELL-42)
  playerCompendiumWindow, // cmp.compendium (compendium, FR-CMP-18)
  playerCompanionWindow, // charx.companion (character-sheet-full, FR-CHARX-59)
];

export const playerWindows = createWindowRegistry("player", windows);
