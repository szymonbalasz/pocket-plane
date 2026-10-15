// Feature registry. Append-only (AGENTS §9.9): add your feature's line; nothing else.
import type { Feature } from "../services";
import { assetsPipeline } from "./assets-pipeline";
import { campaignManagement } from "./campaign-management";
import { characterSheet } from "./character-sheet";
import { combatExtras } from "./combat-extras";
import { combatTracker } from "./combat-tracker";
import { diceRollLog } from "./dice-roll-log";
import { effectModifiers } from "./effect-modifiers";
import { entities } from "./entities";
import { fixturesAdapters } from "./fixtures-adapters";
import { fogOfWar } from "./fog-of-war";
import { liveSync } from "./live-sync";
import { notifications } from "./notifications";
import { partyLootFeature } from "./party-loot";
import { sceneTools } from "./scene-tools";
import { scenesMap } from "./scenes-map";

export const features: readonly Feature[] = [
  campaignManagement,
  liveSync,
  fixturesAdapters,
  assetsPipeline,
  entities,
  scenesMap,
  notifications,
  diceRollLog,
  characterSheet,
  combatTracker,
  partyLootFeature,
  combatExtras,
  effectModifiers,
  fogOfWar,
  sceneTools,
];
