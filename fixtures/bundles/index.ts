// Bundle registry. Append-only (AGENTS §9.9): add your own lines.
import type { Bundle } from "@server/features/fixtures-adapters/fixture-types";
import assetAccess from "./asset-access";
import assetLibrary from "./asset-library";
import base from "./base";
import campaignSwitch from "./campaign-switch";
import characterSheet from "./character-sheet";
import characterSheetFull from "./character-sheet-full";
import combat from "./combat";
import combatExtras from "./combat-extras";
import compendium from "./compendium";
import compendiumFull from "./compendium-full";
import diceDisplay from "./dice-display";
import diceExtras from "./dice-extras";
import diceLog from "./dice-log";
import effectModifiers from "./effect-modifiers";
import entities from "./entities";
import fog from "./fog";
import fogScn from "./fog-scn";
import furyLogLine from "./fury-log-line";
import mapTools from "./map-tools";
import midCombat from "./mid-combat";
import notifications from "./notifications";
import partyBoard from "./party-board";
import partyLoot from "./party-loot";
import physicalDiceCombat from "./physical-dice-combat";
import ruleTriggers from "./rule-triggers";
import sceneTools from "./scene-tools";
import sceneToolsProps from "./scene-tools-props";
import scenes from "./scenes";
import sessionSim from "./session-sim";
import sessionSim7 from "./session-sim-7";
import syncProbe from "./sync-probe";
import vision from "./vision";
import visionParty from "./vision-party";

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
  mapTools,
  furyLogLine,
  physicalDiceCombat,
];
