// DM window registry (FR-SHELL-07, ADR-0025). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line in the list for each of its DM window types; nothing else changes here.

import { prefsWindow } from "@ui/features/play-shell/PreferencesWindow";
import { createWindowRegistry, type WindowDef } from "@ui/features/play-shell/registry";
import { shellTestWindow, syncProbesWindow } from "@ui/features/play-shell/test-windows";
import { recapWindow } from "@ui/features/session-recap/window";
import { statsWindow } from "@ui/features/stats/window";
import { strongholdWindow } from "@ui/features/strongholds/window";
import { assetTestWindow } from "./features/assets-pipeline/asset-test-window";
import { assetsWindow } from "./features/assets-pipeline/assets-window";
import { dmCompanionWindow } from "./features/character-sheet/companion-window";
import { dmCharSheetWindow } from "./features/character-sheet/sheet-window";
import { encountersWindow } from "./features/combat-tracker/encounters-window";
import { dmInitiativeWindow } from "./features/combat-tracker/initiative-window";
import { dmCompendiumWindow } from "./features/compendium/compendium-window";
import { dmRulesWindow } from "./features/compendium/rules-window";
import { requestsWindow } from "./features/dice-extras/requests-window";
import { dmTrayWindow } from "./features/dice-extras/tray-window";
import { dmDiceLogWindow } from "./features/dice-roll-log/log-window";
import { creaturesWindow } from "./features/entities/creatures-window";
import { statBlockWindow } from "./features/entities/statblock/window";
import { notificationsHistoryWindow } from "./features/notifications/history-window";
import { dmPartyBoardWindow } from "./features/party-board/board-window";
import { dmHandoutWindow } from "./features/party-board/handout-window";
import { playersWindow } from "./features/play-shell/players-window";
import { scenesWindow } from "./features/scenes-map/scenes-window";
import { dmPrefSections } from "./pref-sections";

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
  dmPartyBoardWindow, // party.board "Party Manager" (party-board, FR-PARTY-11, -59; absorbs party.summary, FR-SHELL-155)
  { ...dmHandoutWindow, restoreOpen: false }, // party.handout (party-board, FR-PARTY-14; FR-SHELL-42)
  dmCompendiumWindow, // cmp.compendium (compendium, FR-CMP-18)
  prefsWindow("dm", dmPrefSections), // shell.prefs, no launcher (play-shell, FR-SHELL-71)
  dmCompanionWindow, // charx.companion (character-sheet-full, FR-CHARX-59)
  statsWindow, // stats.board (stats, FR-SHELL-93)
  requestsWindow, // dicex.requests (dice-extras, FR-DICEX-86)
  strongholdWindow, // hold.stronghold, no launcher (strongholds, FR-SHELL-170)
  dmRulesWindow, // cmp.rules (compendium, FR-CMP-63; sprint 9 SP2, seams S4)
  recapWindow, // recap.session, no launcher (session-recap, FR-RECAP-10)
  statBlockWindow, // ent.statblock "Stat block" (kit-parity K7, FR-KIT-100)
  assetsWindow, // asset.library "Assets" (assets-pipeline, FR-ASSET-69; #394)
];

export const dmWindows = createWindowRegistry("dm", windows);
