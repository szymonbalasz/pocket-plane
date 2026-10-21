// Stats server memory (ADR-0059 §4): the session boundary cache (FR-STATS-14: append-only, extended
// from the last `n`, warmed at server start) and the query gate (FR-STATS-16: ≤ 4 computed answers
// per connection per second; the excess is coalesced into the last answer). Never persisted.

import { extendSessions, type SessionBounds } from "@shared/stats/rules";
import { QUERIES_PER_SECOND } from "@shared/stats/schemas";
import { conflict } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { logTimeline } from "../dice-roll-log/stats-read";

type Read = Pick<Tx, "select">;

/** FR-STATS-14: per campaign, the derived sessions and the last `n` they cover. */
export class SessionCache {
  private byCampaign = new Map<string, { lastN: number; sessions: SessionBounds[] }>();

  /** The campaign's sessions, ascending, after reading only the entries past the cached `n`. */
  sessions(db: Read, campaignId: string): SessionBounds[] {
    let c = this.byCampaign.get(campaignId);
    if (!c) {
      c = { lastN: 0, sessions: [] };
      this.byCampaign.set(campaignId, c);
    }
    const tail = logTimeline(db, campaignId, c.lastN);
    if (tail.length > 0) {
      extendSessions(c.sessions, tail);
      c.lastN = (tail.at(-1) as (typeof tail)[number]).n;
    }
    return c.sessions;
  }

  /** The cached last `n` (tests: warmed / extended), or null = never read. */
  lastN(campaignId: string): number | null {
    return this.byCampaign.get(campaignId)?.lastN ?? null;
  }
}

/** One window of the rate (ms). */
const WINDOW_MS = 1000;
/** Memoised answers kept (all campaigns, viewer classes and inputs). */
const MEMO_MAX = 256;

/**
 * FR-STATS-16. Answers are memoised per (campaign, viewer class, input) and stamped with the
 * campaign's fact version (bumped by a listener on every commit touching a fact or a name): a
 * fresh memo is free; otherwise an actor computes at most 4 answers a second. An excess query is
 * coalesced into the last answer for the same input; with none yet it is refused (`conflict`).
 * Keyed by actor (role + player): commands see no connection, and one actor's tabs share it.
 */
export class QueryGate {
  private versions = new Map<string, number>();
  private times = new Map<string, number[]>();
  private memo = new Map<string, { version: number; result: unknown }>();
  /** Computations so far (tests). */
  computed = 0;

  bump(campaignId: string): void {
    this.versions.set(campaignId, (this.versions.get(campaignId) ?? 0) + 1);
  }

  answer<T>(o: {
    campaignId: string;
    actorKey: string;
    memoKey: string;
    now: number;
    compute(): T;
  }): T {
    const version = this.versions.get(o.campaignId) ?? 0;
    const key = `${o.campaignId}|${o.memoKey}`;
    const m = this.memo.get(key);
    if (m && m.version === version) return m.result as T;
    const recent = (this.times.get(o.actorKey) ?? []).filter((t) => o.now - t < WINDOW_MS);
    this.times.set(o.actorKey, recent);
    if (recent.length >= QUERIES_PER_SECOND) {
      if (m) return m.result as T;
      throw conflict("Too many stats queries, try again in a moment");
    }
    recent.push(o.now);
    const result = o.compute();
    this.computed += 1;
    this.memo.delete(key);
    this.memo.set(key, { version, result });
    if (this.memo.size > MEMO_MAX) {
      const oldest = this.memo.keys().next().value;
      if (oldest !== undefined) this.memo.delete(oldest);
    }
    return result;
  }
}
