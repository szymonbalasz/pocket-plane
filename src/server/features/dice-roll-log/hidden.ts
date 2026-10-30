// `dice.setEntryHidden` (FR-DICE-99–101): the DM's soft-delete of a log line from the party. Hide:
// `public = false`, `audiencePlayerId = null` for every viewer but the DM (the roller and a
// companion's owner too), the prior stamp kept in `hiddenFrom`. Reveal: that stamp restored, or
// `public = true` for a line hidden since it was rolled. A rerolled chain moves together, both
// directions along `supersededBy`. No filter change: `entryVisibility` hides the line and the
// record-change matrix deletes it live for players.
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryRecord,
  REVEAL_GUARDED,
  SetEntryHiddenIntent,
  seenByPlayers,
} from "@shared/dice-roll-log/schemas";
import { LogEntryHiddenSet } from "@shared/events/dice-roll-log";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { gameLogEntry } from "../../db/schema";
import { readEntry, toEntryRecord } from "./game-log";
import { rollGuarded } from "./roll-guard";
import { campaignOf } from "./settings";

export const SET_ENTRY_HIDDEN = "dice.setEntryHidden";

/** The line's next stamp: hide keeps the old one in `hiddenFrom`, reveal brings it back. */
function nextStamp(e: GameLogEntryRecord, hidden: boolean) {
  if (hidden) {
    const hiddenFrom = { public: e.public, audiencePlayerId: e.audiencePlayerId };
    return { public: false, audiencePlayerId: null, hiddenFrom };
  }
  return { ...(e.hiddenFrom ?? { public: true, audiencePlayerId: null }), hiddenFrom: null };
}

/** FR-DICE-101: the entry and every line it replaced or was replaced by, in `n` order. */
function chainOf(env: CommandEnv, first: GameLogEntryRecord): GameLogEntryRecord[] {
  const cid = campaignOf(env.actor);
  const chain = new Map([[first.id, first]]);
  let next = first.supersededBy;
  while (next !== null) {
    const e = readEntry(env, next);
    if (!e || chain.has(e.id)) break;
    chain.set(e.id, e);
    next = e.supersededBy;
  }
  let id = first.id;
  while (true) {
    const prev = env.tx
      .select()
      .from(gameLogEntry)
      .where(and(eq(gameLogEntry.campaignId, cid), eq(gameLogEntry.supersededBy, id)))
      .get();
    if (!prev || chain.has(prev.id)) break;
    chain.set(prev.id, toEntryRecord(prev));
    id = prev.id;
  }
  return [...chain.values()].sort((a, b) => a.n - b.n);
}

export const setEntryHidden = defineCommand({
  name: SET_ENTRY_HIDDEN,
  input: SetEntryHiddenIntent,
  execute(input, env): void {
    const cid = campaignOf(env.actor);
    const entry = readEntry(env, input.entryId);
    if (!entry) throw notFound("Log entry not found");
    // Same value: a line already where it should be stays as it is (no event when all do).
    const moving = chainOf(env, entry).filter((e) => seenByPlayers(e) === input.hidden);
    if (moving.length === 0) return;
    if (!input.hidden && !input.confirmGuarded) {
      const guarded = moving.some(
        (e) => nextStamp(e, false).public && rollGuarded(env, cid, e.rollIds, e.encounterId),
      );
      if (guarded) throw conflict(REVEAL_GUARDED);
    }
    const changes = moving.map((before) => {
      env.tx
        .update(gameLogEntry)
        .set(nextStamp(before, input.hidden))
        .where(eq(gameLogEntry.id, before.id))
        .run();
      return {
        type: GAME_LOG_ENTRY_TYPE,
        id: before.id,
        before,
        after: readEntry(env, before.id) as GameLogEntryRecord,
      };
    });
    env.emit({
      type: LogEntryHiddenSet.type,
      campaignId: cid,
      payload: { entryIds: moving.map((e) => e.id), hidden: input.hidden },
      changes,
    });
  },
});
