// Feature registry. Append-only (AGENTS §9.9): add your feature's line; nothing else.
import type { Feature } from "../services";
import { assetsPipeline } from "./assets-pipeline";
import { campaignManagement } from "./campaign-management";
import { characterSheet } from "./character-sheet";
import { combatExtras } from "./combat-extras";
import { combatPolish } from "./combat-extras/move";
import { combatTracker } from "./combat-tracker";
import { compendium } from "./compendium";
import { diceExtras } from "./dice-extras";
import { diceRollLog } from "./dice-roll-log";
import { effectModifiers } from "./effect-modifiers";
import { entities } from "./entities";
import { fixturesAdapters } from "./fixtures-adapters";
import { fogOfWar } from "./fog-of-war";
import { gems } from "./gems";
import { liveSync } from "./live-sync";
import { notifications } from "./notifications";
import { overviewScenes } from "./overview-scenes";
import { partyBoard } from "./party-board";
import { partyLootFeature } from "./party-loot";
import { reminders } from "./reminders";
import { sceneTools } from "./scene-tools";
import { scenesMap } from "./scenes-map";
import { sessionRecap } from "./session-recap";
import { spellFx } from "./spell-fx";
import { stats } from "./stats";
import { strongholds } from "./strongholds";

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
  partyBoard,
  compendium,
  diceExtras,
  gems,
  stats,
  // Sprint 8 track CB (fix/cb-core)
  combatPolish,
  // Sprint 9 track RS (fix/rs-core)
  reminders,
  strongholds,
  // Sprint 9 track SP (build/sp-recap)
  sessionRecap,
  // Spell FX core (fix/vfx-core)
  spellFx,
  // Overview scenes core (fix/ovw-core)
  overviewScenes,
];
