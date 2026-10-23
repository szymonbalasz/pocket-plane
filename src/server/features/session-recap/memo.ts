// Recap server memory (FR-RECAP-05, -29): the memo and the per-actor rate limit. In memory only,
// never persisted, dropped freely.
//
// Memo key: (campaign, session `fromN`, role, enabled features); all players share one entry
// (FR-RECAP-03). An entry is fresh while its stamp equals now's: the campaign's fact version
// (bumped after a commit that touches a counted fact: a rolled line, an `hp_change`, an undo or
// supersede, a name, an owner, a switch; a line with no fact never bumps it) and the session's
// loot high-water (`lootHighWater`).
import { RECAP_QUERIES_PER_SECOND } from "@shared/session-recap/schemas";
import { conflict } from "../../commands/errors";

/** One window of the rate (ms). */
const WINDOW_MS = 1000;
/** FR-RECAP-29: LRU entries kept (all campaigns, sessions and roles). */
export const RECAP_MEMO_MAX = 32;

export class RecapGate {
  private versions = new Map<string, number>();
  private times = new Map<string, number[]>();
  private memo = new Map<string, { stamp: string; result: unknown }>();
  /** Computations so far (tests, FR-RECAP-29). */
  computed = 0;

  bump(campaignId: string): void {
    this.versions.set(campaignId, (this.versions.get(campaignId) ?? 0) + 1);
  }

  version(campaignId: string): number {
    return this.versions.get(campaignId) ?? 0;
  }

  /**
   * A fresh memo is free; otherwise an actor computes at most 2 answers a second. An excess query
   * is coalesced into the last answer for the same key (the client re-asks once after 1 s); with
   * none yet it is refused (`conflict`). Keyed by actor (role + player): one actor's tabs share it.
   */
  answer<T>(o: {
    campaignId: string;
    actorKey: string;
    memoKey: string;
    /** The loot high-water; joined with the fact version into the entry's stamp. */
    loot: string;
    now: number;
    compute(): T;
  }): T {
    const key = `${o.campaignId}|${o.memoKey}`;
    const stamp = `${this.version(o.campaignId)}|${o.loot}`;
    const m = this.memo.get(key);
    if (m && m.stamp === stamp) {
      // LRU: a hit is the newest use.
      this.memo.delete(key);
      this.memo.set(key, m);
      return m.result as T;
    }
    const recent = (this.times.get(o.actorKey) ?? []).filter((t) => o.now - t < WINDOW_MS);
    this.times.set(o.actorKey, recent);
    if (recent.length >= RECAP_QUERIES_PER_SECOND) {
      if (m) return m.result as T;
      throw conflict("Too many recap queries, try again in a moment");
    }
    recent.push(o.now);
    const result = o.compute();
    this.computed += 1;
    this.memo.delete(key);
    this.memo.set(key, { stamp, result });
    if (this.memo.size > RECAP_MEMO_MAX) {
      const oldest = this.memo.keys().next().value;
      if (oldest !== undefined) this.memo.delete(oldest);
    }
    return result;
  }

  /** Entries kept now (tests). */
  get size(): number {
    return this.memo.size;
  }
}
