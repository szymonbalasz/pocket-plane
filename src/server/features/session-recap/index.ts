// session-recap (RECAP, ADR-0013 note): a session at a glance, computed on read from stats' facts
// and the loot ledger. Intents `recap.query` (DM, player; read-only) and `recap.share` (DM);
// notification kind `session-recap` (in `notifications/kinds.ts`). No record type, table or
// snapshot field; server memory: the memo and rate limit (`memo.ts`) on stats' session cache.
import { COMBATANT_TYPE, ENCOUNTER_TYPE, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import type { RecordChange } from "../../events/types";
import type { Feature, Services } from "../../services";
import { statsMemory } from "../stats";
import { recapCommands } from "./commands";
import { RecapGate } from "./memo";

/** Record types whose every change can change a recap (facts, names, owners, switches). */
const FACT_TYPES: ReadonlySet<string> = new Set([
  HP_CHANGE_TYPE,
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  ENTITY_TYPE,
  "campaign",
]);

/**
 * FR-RECAP-29: a change that can change a counted fact. A log line counts when it changes (undo,
 * supersede) or is new with rolls; a new line with no roll (an unrelated line) does not. A token
 * counts only when its owner changes (luck skips owned tokens' rolls).
 */
export function touchesFacts(c: RecordChange): boolean {
  if (FACT_TYPES.has(c.type)) return true;
  if (c.type === GAME_LOG_ENTRY_TYPE) {
    if (c.before) return true;
    const rolls = (c.after as { rollIds?: unknown } | null)?.rollIds;
    return Array.isArray(rolls) && rolls.length > 0;
  }
  if (c.type === TOKEN_TYPE && c.before && c.after) {
    const owner = (x: unknown) => (x as { ownerPlayerId?: string | null }).ownerPlayerId ?? null;
    return owner(c.before) !== owner(c.after);
  }
  return false;
}

const memory = new WeakMap<Services, RecapGate>();

/** This server's recap gate (tests: computations, memo size). */
export function recapMemory(s: Services): RecapGate {
  const m = memory.get(s);
  if (!m) throw new Error("session-recap feature not registered on these services");
  return m;
}

export const sessionRecap: Feature = {
  name: "session-recap",
  register(r) {
    const s = r.services;
    const gate = new RecapGate();
    memory.set(s, gate);
    // Stats' session boundary cache (FR-RECAP-02: stats' sessions); stats registers first.
    const { query, share } = recapCommands(() => statsMemory(s).cache, gate);
    r.command(query, { intent: true });
    r.command(share, { intent: true });
    // FR-RECAP-29: before any listener (CON-23), so a client re-querying on the frame never gets
    // the old answer.
    r.afterCommit("recap-version", ({ event }) => {
      if (event.campaignId === null) return;
      if (event.changes.some(touchesFacts)) gate.bump(event.campaignId);
    });
  },
};
