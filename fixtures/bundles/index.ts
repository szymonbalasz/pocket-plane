// Bundle registry. Append-only (AGENTS §9.9): add your own lines.
import type { Bundle } from "@server/features/fixtures-adapters/fixture-types";
import alertSounds from "./alert-sounds";
import alertSoundsE2e from "./alert-sounds-e2e";
import assetAccess from "./asset-access";
import assetLibrary from "./asset-library";
import base from "./base";
import campaignSwitch from "./campaign-switch";
import cbPartyE2e from "./cb-party-e2e";
import cbReorderE2e from "./cb-reorder-e2e";
import cbTurnRingE2e from "./cb-turn-ring-e2e";
import characterSheet from "./character-sheet";
import characterSheetFull from "./character-sheet-full";
import cmpImages from "./cmp-images";
import combat from "./combat";
import combatExtras from "./combat-extras";
import combatPolish from "./combat-polish";
import companions from "./companions";
import companionsAlly from "./companions-ally";
import companionsE2e from "./companions-e2e";
import companionsPrep from "./companions-prep";
import companionsStart from "./companions-start";
import compendium from "./compendium";
import compendiumFull from "./compendium-full";
import cpPetsE2e from "./cp-pets-e2e";
import cpTokens from "./cp-tokens";
import diceDisplay from "./dice-display";
import diceExtras from "./dice-extras";
import diceLog from "./dice-log";
import dicePolish from "./dice-polish";
import effectModifiers from "./effect-modifiers";
import entities from "./entities";
import fog from "./fog";
import fogScn from "./fog-scn";
import fuMapE2e from "./fu-map-e2e";
import fuS7 from "./fu-s7";
import fuS7E2e from "./fu-s7-e2e";
import fuSmallCopy from "./fu-small-copy";
import furyLogLine from "./fury-log-line";
import fxDiceE2e from "./fx-dice-e2e";
import fxToastsE2e from "./fx-toasts-e2e";
import fxS9 from "./fx-s9";
import fxStaleChunkE2e from "./fx-stale-chunk-e2e";
import gems from "./gems";
import gemsCombatE2e from "./gems-combat-e2e";
import gemsE2e from "./gems-e2e";
import gemsHidden from "./gems-hidden";
import gemsRerollE2e from "./gems-reroll-e2e";
import gemsUiE2e from "./gems-ui-e2e";
import imageSearch from "./image-search";
import initChipsEffect from "./init-chips-effect";
import initRowsE2e from "./init-rows-e2e";
import lateDamage from "./late-damage";
import logNoteColours from "./log-note-colours";
import lootSubtractE2e from "./loot-subtract-e2e";
import mapTools from "./map-tools";
import midCombat from "./mid-combat";
import notifications from "./notifications";
import partyBoard from "./party-board";
import partyCmp from "./party-cmp";
import partyLoot from "./party-loot";
import partyS5 from "./party-s5";
import physicalDiceCombat from "./physical-dice-combat";
import playerColours from "./player-colours";
import pmMemory from "./pm-memory";
import pmMemoryE2e from "./pm-memory-e2e";
import prefsS6 from "./prefs-s6";
import prefsS6E2e from "./prefs-s6-e2e";
import remindersStrongholds from "./reminders-strongholds";
import rsE2e from "./rs-e2e";
import ruleTriggers from "./rule-triggers";
import rulesEffects from "./rules-effects";
import sceneTools from "./scene-tools";
import sceneToolsProps from "./scene-tools-props";
import scenes from "./scenes";
import sessionSim from "./session-sim";
import sessionSim7 from "./session-sim-7";
import sessionSim8 from "./session-sim-8";
import sessionSim9 from "./session-sim-9";
import sessionSim10 from "./session-sim-10";
import sessionSim11 from "./session-sim-11";
import sessionSim12 from "./session-sim-12";
import sessionSim13 from "./session-sim-13";
import spPalette from "./sp-palette";
import spPaletteE2e from "./sp-palette-e2e";
import stats from "./stats";
import statsB from "./stats-b";
import statsBE2e from "./stats-b-e2e";
import statsBPast from "./stats-b-past";
import statsBUiE2e from "./stats-b-ui-e2e";
import statsE2e from "./stats-e2e";
import statsPast from "./stats-past";
import statsWindowE2e from "./stats-window-e2e";
import syncProbe from "./sync-probe";
import tableTools from "./table-tools";
import tableToolsE2e from "./table-tools-e2e";
import tableToolsPaused from "./table-tools-paused";
import tableToolsPausedE2e from "./table-tools-paused-e2e";
import toastHomeE2e from "./toast-home-e2e";
import tokenArtUpdate from "./token-art-update";
import tplMenu from "./tpl-menu";
import usesNegative from "./uses-negative";
import vision from "./vision";
import visionParty from "./vision-party";
import wfFrame from "./wf-frame";
import wfFrameE2e from "./wf-frame-e2e";
import windowsS5 from "./windows-s5";

export const bundles: readonly Bundle[] = [
  base,
  sessionSim,
  campaignSwitch,
  syncProbe,
  assetLibrary,
  assetAccess,
  entities,
  scenes,
  notifications,
  diceLog,
  characterSheet,
  combat,
  midCombat,
  partyLoot,
  characterSheetFull,
  combatExtras,
  effectModifiers,
  fog,
  sceneToolsProps,
  sceneTools,
  fogScn,
  diceExtras,
  partyBoard,
  compendium,
  ruleTriggers,
  vision,
  sessionSim7,
  compendiumFull,
  visionParty,
  diceDisplay,
  rulesEffects,
  mapTools,
  furyLogLine,
  physicalDiceCombat,
  tokenArtUpdate,
  usesNegative,
  sessionSim8,
  sessionSim9,
  windowsS5,
  lateDamage,
  partyS5,
  dicePolish,
  cmpImages,
  tplMenu,
  initChipsEffect,
  partyCmp,
  playerColours,
  logNoteColours,
  prefsS6,
  prefsS6E2e,
  // Sprint 6 track CP (fix/cp-core)
  companionsPrep,
  companions,
  companionsE2e,
  companionsStart,
  companionsAlly,
  imageSearch,
  sessionSim10,
  sessionSim11,
  toastHomeE2e,
  initRowsE2e,
  lootSubtractE2e,
  // Sprint 6 track CP (build/cp-pets)
  cpPetsE2e,
  cpTokens,
  // Sprint 7 track FU (fix/fu-small-copy)
  fuSmallCopy,
  // Sprint 7 track FU (fix/fu-combat)
  fuS7,
  fuS7E2e,
  // Sprint 7 track FU (fix/fu-map)
  fuMapE2e,
  // Sprint 7 track GM (fix/gems-core)
  gems,
  gemsHidden,
  gemsE2e,
  // Sprint 7 track GM (build/gems-reroll)
  gemsRerollE2e,
  // Sprint 7 track ST (fix/st-core)
  statsPast,
  stats,
  statsE2e,
  // Sprint 7 track GM (build/gems-sheet)
  gemsUiE2e,
  // Sprint 7 track GM (build/gems-combat)
  gemsCombatE2e,
  // Sprint 7 track ST (build/st-window)
  statsWindowE2e,
  // Sprint 8 track WF (fix/placer-core)
  wfFrame,
  wfFrameE2e,
  // Sprint 8 track TT (fix/tt-core): the sprint-8 gate bundle, each track appends its units
  sessionSim12,
  // Sprint 8 track SB (build/sb-core)
  statsB,
  statsBE2e,
  statsBPast,
  // Sprint 8 track TT (build/tt-sounds): alert sounds
  alertSounds,
  alertSoundsE2e,
  // Sprint 8 track CB (fix/cb-core)
  combatPolish,
  cbReorderE2e,
  cbTurnRingE2e,
  cbPartyE2e,
  // Sprint 8 track TT (build/tt-dice): macros + roll requests
  tableTools,
  tableToolsE2e,
  // Sprint 8 track SB (build/sb-stats-ui)
  statsBUiE2e,
  // Sprint 8 track TT (build/tt-pause): the pause screen
  tableToolsPaused,
  tableToolsPausedE2e,
  // Sprint 9 track PM (fix/window-memory): aliases of session-sim-12
  pmMemory,
  pmMemoryE2e,
  // Sprint 9 track RS (fix/rs-core): the sprint-9 gate bundle (each track appends its units)
  sessionSim13,
  remindersStrongholds,
  rsE2e,
  // Sprint 9 track FX (fix/fx-dice-lines): dice + gems lines
  fxDiceE2e,
  // Sprint 9 track FX (fix/fx-toasts-feed): toast stack + kill feed
  fxToastsE2e,
  // Sprint 9 track SP (build/sp-palette): aliases of session-sim-12 for the palette
  spPalette,
  spPaletteE2e,
  // Sprint 9 track FX (fix/fx-sync-shell): stale-chunk reload e2e alias, FX3's bundle
  fxStaleChunkE2e,
  fxS9,
];
