// DM window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its DM window types; nothing else changes here.
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";
import { shellTestWindow, syncProbesWindow } from "@ui/features/play-shell/test-windows";
import { assetTestWindow } from "./features/assets-pipeline/asset-test-window";
import { dmCompanionWindow } from "./features/character-sheet/companion-window";
import { dmCharSheetWindow } from "./features/character-sheet/sheet-window";
import { encountersWindow } from "./features/combat-tracker/encounters-window";
import { dmInitiativeWindow } from "./features/combat-tracker/initiative-window";
import { dmCompendiumWindow } from "./features/compendium/compendium-window";
import { dmTrayWindow } from "./features/dice-extras/tray-window";
import { dmDiceLogWindow } from "./features/dice-roll-log/log-window";
import { creaturesWindow } from "./features/entities/creatures-window";
import { notificationsHistoryWindow } from "./features/notifications/history-window";
import { dmPartyBoardWindow } from "./features/party-board/board-window";
import { dmHandoutWindow } from "./features/party-board/handout-window";
import { playersWindow } from "./features/play-shell/players-window";
import { scenesWindow } from "./features/scenes-map/scenes-window";

const windows: WindowDef[] = [
  playersWindow, // camp.players (play-shell, FR-SHELL-21)
  syncProbesWindow, // sync.probes, test mode (play-shell, FR-SHELL-21)
  shellTestWindow, // shell.test, test mode (play-shell, FR-SHELL-20)
  assetTestWindow, // asset.test, test mode (assets-pipeline, FR-ASSET-19)
  creaturesWindow, // ent.creatures (entities, FR-ENT-18)
  scenesWindow, // map.scenes (scenes-map, MAP §7)
  notificationsHistoryWindow, // note.history (notifications, FR-NOTE-17)
  dmDiceLogWindow, // dice.log (dice-roll-log, FR-DICE-21)
  dmCharSheetWindow, // char.sheet (character-sheet, FR-CHAR-15)
  dmInitiativeWindow, // cbt.initiative (combat-tracker, CBT §7)
  encountersWindow, // cbt.encounters (combat-tracker, CBT §7)
  dmTrayWindow, // dicex.tray (dice-extras, FR-DICEX-01)
  dmPartyBoardWindow, // party.board (party-board, FR-PARTY-11)
  { ...dmHandoutWindow, restoreOpen: false }, // party.handout (party-board, FR-PARTY-14; FR-SHELL-42)
  dmCompendiumWindow, // cmp.compendium (compendium, FR-CMP-18)
  dmCompanionWindow, // charx.companion (character-sheet-full, FR-CHARX-59)
];

export const dmWindows = createWindowRegistry("dm", windows);
