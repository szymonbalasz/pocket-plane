// stats (STATS, ADR-0059): read models computed on read over the fact tables. Intents
// `stats.query` (DM, player; read-only) and `stats.showAwards` (DM); notification kinds
// `stats-awards` and (sprint 8) `stats-fight-summary` (in `notifications/kinds.ts`); the End hook
// in `combat-tracker/rule-hooks.ts` (`summary.ts`). No record type, table or snapshot field.
// Sprint 8 (ADR-0062): campaign-wide luck and trophies from in-memory session partials.
import { COMBATANT_TYPE, ENCOUNTER_TYPE, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { LogEntryHiddenSet } from "@shared/events/dice-roll-log";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import type { RecordChange } from "../../events/types";
import type { Feature, Services } from "../../services";
import { activeCampaign } from "../campaign-management/commands";
import { campaignFeatures } from "../campaign-management/features";
import { QueryGate, SessionCache } from "./cache";
import { statsCommands } from "./commands";
import { characters, type StatsRead } from "./compute";
import { Partials } from "./partials";

/** Record types whose changes can change a stats answer (facts, names, kinds, switches). */
const FACT_TYPES: ReadonlySet<string> = new Set([
  GAME_LOG_ENTRY_TYPE,
  HP_CHANGE_TYPE,
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  ENTITY_TYPE,
  "campaign",
]);

/** A token's owner changed (luck skips owned tokens' rolls); token moves never stale stats. */
const tokenOwnerChanged = (c: RecordChange): boolean => {
  if (c.type !== TOKEN_TYPE || !c.before || !c.after) return false;
  const owner = (x: unknown) => (x as { ownerPlayerId?: string | null }).ownerPlayerId ?? null;
  return owner(c.before) !== owner(c.after);
};

interface StatsMemory {
  cache: SessionCache;
  gate: QueryGate;
  partials: Partials;
}

const memory = new WeakMap<Services, StatsMemory>();

/** This server's stats memory (tests: the warmed cache, the gate's computations, partials). */
export function statsMemory(s: Services): StatsMemory {
  const m = memory.get(s);
  if (!m) throw new Error("stats feature not registered on these services");
  return m;
}

export const stats: Feature = {
  name: "stats",
  register(r) {
    const s = r.services;
    const cache = new SessionCache();
    const gate = new QueryGate();
    // FR-STATS-46: the viewers partials are built for: both roles, the campaign's features now.
    const reads = (campaignId: string): StatsRead[] => {
      const features = campaignFeatures(s.db, campaignId);
      return (["dm", "player"] as const).map((role) => ({
        db: s.db,
        viewer: { role, features },
        campaignId,
      }));
    };
    const partials: Partials = new Partials({
      db: s.db,
      sessions: (campaignId) => cache.sessions(s.db, campaignId),
      reads,
      characters: (campaignId) => characters(s.db, campaignId),
      // ADR-0062 §3: a drop-all rebuilds in the background (yielding chunks), after the commit.
      onDropAll: (campaignId) => {
        setTimeout(() => void partials.build(campaignId), 0);
      },
      onError: (err) => s.log.debug(`stats partials build stopped: ${(err as Error).message}`),
    });
    memory.set(s, { cache, gate, partials });
    const { query, showAwards } = statsCommands(cache, gate, partials);
    r.command(query, { intent: true });
    r.command(showAwards, { intent: true });
    // FR-STATS-16: a commit touching a fact stales the campaign's memoised answers (CON-23 order:
    // before any listener, so a client re-querying on the frame never gets the old answer).
    // FR-STATS-46: the same listener drops the touched sessions' partials (ADR-0062 §2).
    r.afterCommit("stats-version", ({ event }) => {
      if (event.campaignId === null) return;
      // FR-DICE-102: the session spans keep each line's `public`, which a hide or reveal changes.
      if (event.type === LogEntryHiddenSet.type) cache.drop(event.campaignId);
      if (!event.changes.some((c) => FACT_TYPES.has(c.type) || tokenOwnerChanged(c))) return;
      gate.bump(event.campaignId);
      partials.invalidate(event.campaignId, event.changes);
    });
    // FR-STATS-14: the active campaign's session boundaries, read once before the first query;
    // then FR-STATS-46's partials, built in the background (not awaited: the server listens
    // meanwhile, and campaign queries answer `pending` until then).
    r.onStart("stats-sessions", (svc) => {
      const c = activeCampaign(svc.db);
      if (!c) return;
      cache.sessions(svc.db, c.id);
      void partials.build(c.id);
    });
  },
};
