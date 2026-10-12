// Domain event registry. Append-only (AGENTS §9.9): add your feature's events below.
import * as assetsPipeline from "./assets-pipeline";
import * as campaignManagement from "./campaign-management";
import * as characterSheet from "./character-sheet";
import * as combatTracker from "./combat-tracker";
import * as diceRollLog from "./dice-roll-log";
import * as entities from "./entities";
import * as liveSync from "./live-sync";
import * as notifications from "./notifications";
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
];

/** `cause.name` of presence changes (not a domain event, CON-07). */
export const PRESENCE_CAUSE = "presence";
