// stats (STATS, ADR-0059): read models computed on read over the fact tables. Intents
// `stats.query` (DM, player; read-only) and `stats.showAwards` (DM); notification kind
// `stats-awards` (in `notifications/kinds.ts`). No record type, table or snapshot field.
import { COMBATANT_TYPE, ENCOUNTER_TYPE, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { Feature, Services } from "../../services";
import { activeCampaign } from "../campaign-management/commands";
import { QueryGate, SessionCache } from "./cache";
import { statsCommands } from "./commands";

/** Record types whose changes can change a stats answer (facts, names, kinds, switches). */
const FACT_TYPES: ReadonlySet<string> = new Set([
  GAME_LOG_ENTRY_TYPE,
  HP_CHANGE_TYPE,
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  ENTITY_TYPE,
  "campaign",
]);

const memory = new WeakMap<Services, { cache: SessionCache; gate: QueryGate }>();

/** This server's stats memory (tests: the warmed cache, the gate's computations). */
export function statsMemory(s: Services): { cache: SessionCache; gate: QueryGate } {
  const m = memory.get(s);
  if (!m) throw new Error("stats feature not registered on these services");
  return m;
}

export const stats: Feature = {
  name: "stats",
  register(r) {
    const cache = new SessionCache();
    const gate = new QueryGate();
    memory.set(r.services, { cache, gate });
    const { query, showAwards } = statsCommands(cache, gate);
    r.command(query, { intent: true });
    r.command(showAwards, { intent: true });
    // FR-STATS-16: a commit touching a fact stales the campaign's memoised answers (CON-23 order:
    // before any listener, so a client re-querying on the frame never gets the old answer).
    r.afterCommit("stats-version", ({ event }) => {
      if (event.campaignId === null) return;
      if (event.changes.some((c) => FACT_TYPES.has(c.type))) gate.bump(event.campaignId);
    });
    // FR-STATS-14: the active campaign's session boundaries, read once before the first query.
    r.onStart("stats-sessions", (s) => {
      const c = activeCampaign(s.db);
      if (c) cache.sessions(s.db, c.id);
    });
  },
};
