// Domain event registry. Append-only (AGENTS §9.9): add your feature's events below.
import * as assetsPipeline from "./assets-pipeline";
import * as campaignManagement from "./campaign-management";
import * as characterSheet from "./character-sheet";
import * as combatExtras from "./combat-extras";
import * as combatTracker from "./combat-tracker";
import * as diceRollLog from "./dice-roll-log";
import * as effectModifiers from "./effect-modifiers";
import * as entities from "./entities";
import * as fogOfWar from "./fog-of-war";
import * as liveSync from "./live-sync";
import * as notifications from "./notifications";
import * as partyLoot from "./party-loot";
import * as scenesMap from "./scenes-map";
import { type DomainEventDef, isDomainEventDef } from "./types";

export type { DomainEventDef } from "./types";
export { defineEvent } from "./types";

export const domainEvents: readonly DomainEventDef[] = [
  ...Object.values(campaignManagement),
  ...Object.values(liveSync),
  ...Object.values(assetsPipeline),
  ...Object.values(entities),
  ...Object.values(scenesMap),
  // Combat (fix/combat-core). These modules also export enums and payload schemas: keep events only.
  ...[diceRollLog, characterSheet, notifications, combatTracker].flatMap((m) =>
    Object.values(m).filter(isDomainEventDef),
  ),
  // Reward (build/party-loot): the module also exports the endpoint schema.
  ...Object.values<unknown>(partyLoot).filter(isDomainEventDef),
  // combat-extras (fix/cbtx-core).
  ...Object.values<unknown>(combatExtras).filter(isDomainEventDef),
  // effect-modifiers (fix/mod-core).
  ...Object.values<unknown>(effectModifiers).filter(isDomainEventDef),
  // fog-of-war (fix/fog-core).
  ...Object.values<unknown>(fogOfWar).filter(isDomainEventDef),
];

/** `cause.name` of presence changes (not a domain event, CON-07). */
export const PRESENCE_CAUSE = "presence";
