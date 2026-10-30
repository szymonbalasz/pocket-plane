// Player window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its player window types; nothing else changes here.

import { prefsWindow } from "@ui/features/play-shell/PreferencesWindow";
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";
import { shellTestWindow, syncProbesWindow } from "@ui/features/play-shell/test-windows";
import { recapWindow } from "@ui/features/session-recap/window";
import { statsWindow } from "@ui/features/stats/window";
import { strongholdWindow } from "@ui/features/strongholds/window";
import { playerCompanionWindow } from "./features/character-sheet/companion-window";
import { playerCharSheetWindow } from "./features/character-sheet/sheet-window";
import { playerInitiativeWindow } from "./features/combat-tracker/initiative-window";
import { playerCompendiumWindow } from "./features/compendium/compendium-window";
import { playerRulesWindow } from "./features/compendium/rules-window";
import { playerTrayWindow } from "./features/dice-extras/tray-window";
import { playerDiceDetailsWindow } from "./features/dice-roll-log/details-window";
import { playerDiceLogWindow } from "./features/dice-roll-log/log-window";
import { notificationsHistoryWindow } from "./features/notifications/history-window";
import { playerPartyBoardWindow } from "./features/party-board/board-window";
import { playerHandoutWindow } from "./features/party-board/handout-window";
import { playerPrefSections } from "./pref-sections";

const windows: WindowDef[] = [
  syncProbesWindow, // sync.probes, test mode (play-shell, FR-SHELL-21)
  shellTestWindow, // shell.test, test mode (play-shell, FR-SHELL-20)
  notificationsHistoryWindow, // note.history (notifications, FR-NOTE-17)
  playerDiceLogWindow, // dice.log (dice-roll-log, FR-DICE-21)
  playerCharSheetWindow, // char.sheet (character-sheet, FR-CHAR-15)
  playerInitiativeWindow, // cbt.initiative (combat-tracker, CBT §7)
  playerTrayWindow, // dicex.tray (dice-extras, FR-DICEX-01)
  playerPartyBoardWindow, // party.board "Party Manager" (party-board, FR-PARTY-11, -59; absorbs party.summary, FR-SHELL-155)
  { ...playerHandoutWindow, restoreOpen: false }, // party.handout (party-board, FR-PARTY-14; FR-SHELL-42)
  playerCompendiumWindow, // cmp.compendium (compendium, FR-CMP-18)
  prefsWindow("player", playerPrefSections), // shell.prefs, no launcher (play-shell, FR-SHELL-71)
  playerCompanionWindow, // charx.companion (character-sheet-full, FR-CHARX-59)
  statsWindow, // stats.board (stats, FR-SHELL-93)
  strongholdWindow, // hold.stronghold, no launcher (strongholds, FR-SHELL-170)
  playerRulesWindow, // cmp.rules (compendium, FR-CMP-63; sprint 9 SP2, seams S4)
  recapWindow, // recap.session, no launcher (session-recap, FR-RECAP-10)
  playerDiceDetailsWindow, // dice.details, no launcher (dice-roll-log, FR-DICE-106)
];

export const playerWindows = createWindowRegistry("player", windows);
