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
import diceLog from "./dice-log";
import effectModifiers from "./effect-modifiers";
import entities from "./entities";
import fog from "./fog";
import midCombat from "./mid-combat";
import notifications from "./notifications";
import partyLoot from "./party-loot";
import sceneTools from "./scene-tools";
import scenes from "./scenes";
import sessionSim from "./session-sim";
import syncProbe from "./sync-probe";

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
  sceneTools,
];
