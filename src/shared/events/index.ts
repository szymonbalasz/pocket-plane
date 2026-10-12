// Domain event registry. Append-only (AGENTS §9.9): add your feature's events below.
import * as campaignManagement from "./campaign-management";
import * as liveSync from "./live-sync";
import type { DomainEventDef } from "./types";

export type { DomainEventDef } from "./types";
export { defineEvent } from "./types";

export const domainEvents: readonly DomainEventDef[] = [
  ...Object.values(campaignManagement),
  ...Object.values(liveSync),
];

/** `cause.name` of presence changes (not a domain event, CON-07). */
export const PRESENCE_CAUSE = "presence";
