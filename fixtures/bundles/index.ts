// Bundle registry. Append-only (AGENTS §9.9): add your own lines.
import type { Bundle } from "@server/features/fixtures-adapters/fixture-types";
import assetAccess from "./asset-access";
import assetLibrary from "./asset-library";
import base from "./base";
import campaignSwitch from "./campaign-switch";
import characterSheet from "./character-sheet";
import characterSheetFull from "./character-sheet-full";
import cmpImages from "./cmp-images";
import combat from "./combat";
import combatExtras from "./combat-extras";
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
import fuS7 from "./fu-s7";
import fuS7E2e from "./fu-s7-e2e";
import fuSmallCopy from "./fu-small-copy";
import furyLogLine from "./fury-log-line";
import gems from "./gems";
import gemsE2e from "./gems-e2e";
import gemsHidden from "./gems-hidden";
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
import prefsS6 from "./prefs-s6";
import prefsS6E2e from "./prefs-s6-e2e";
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
import syncProbe from "./sync-probe";
import toastHomeE2e from "./toast-home-e2e";
import tokenArtUpdate from "./token-art-update";
import tplMenu from "./tpl-menu";
import usesNegative from "./uses-negative";
import vision from "./vision";
import visionParty from "./vision-party";
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
  // Sprint 7 track GM (fix/gems-core)
  gems,
  gemsHidden,
  gemsE2e,
  // Sprint 7 track GM (build/gems-sheet)
  gemsUiE2e,
];
