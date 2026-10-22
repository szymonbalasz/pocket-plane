# Campaign-wide stats from per-session partials kept in memory

- Status: accepted (DM gate, #335) ([OQ-STATS-30](../../specs/stats.md#15-open-questions) A; sprint 8, track SB)
- Date: 2026-10-21
- Refines: [ADR-0059](0059-stats-read-models.md) §4 ("only append-only derivations may be cached"). Everything else in ADR-0059 stands: facts, not projections; filter, then aggregate; read-only command; nothing persisted.
- Affects: [stats](../../specs/stats.md) FR-STATS-46, -51 (trophy case, luck tracker)

## Context

- Tier B adds **campaign-wide** answers: a character's trophy case (lifetime totals, records) and the luck tracker's Campaign scope. Both read every fact of the campaign.
- Measured (stats §12, sprint 8 probe; 100 sessions = 92k entries, 32k `hp_change`, 30k rolls): one campaign pass costs **≈ 540 ms** (trophies, DM) + **≈ 450 ms** (luck, DM); ≈ 0.7 s for players. At 10 sessions: ≈ 50 ms.
- The QueryGate memo (FR-STATS-16) is stamped with the campaign's fact version, which every commit that touches a fact bumps. During a fight, an open Trophies or Luck tab would therefore pay ≈ 1 s on each kill.
- Closed sessions almost never change. What can change them: an undo of an old line, a supersede (rerolls are limited to the newest 100 entries), a companion's owner or kind change (current-owner rule, FR-STATS-09), or a feature switch.
- Reading each session separately is slower than one pass: 2 s at 100 sessions, because each `n`-range read scans the campaign's facts. One lazy pass, however, blocks every connection's frames for ≈ 1 s, since `stats.query` runs synchronously in hub frame order (review A #6).
- Re-measured in chunks at 100 sessions (DM / player). Chunks of 5 sessions peak at **42 / 38 ms** and total 0.74 / 0.66 s. Chunks of 10 peak at 104 / 58 ms; chunks of 1 total 1.9 s.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Per-session partials in server memory**: one tally per character / side for each (campaign, session `fromN`, viewer class, features). Built at server start (and after a drop-all) in yielding chunks of 5 sessions. The newest session is always recomputed. A session's partial is dropped when a commit touches a fact, entry or roll with an `n` inside it; all are dropped on a combatant owner / kind change or a feature switch. | ≈ 25 ms warm at 100 sessions (newest session 18 ms + sums); still computed from facts; no schema; retroactive | A new memo with an invalidation rule to get right (tests: old undo, charm-away, feature off); ≈ 1.4 s of background work per server run at 100 sessions (no block over 50 ms); memory ≈ sessions × sides × viewer classes (small) |
| B. Compute on every query | No new rule | ≈ 1 s per refresh at 100 sessions while facts change |
| C. Materialised tables (ADR-0059 option B) | O(1) reads | Schema lane, backfill, drift, every undo / reroll / visibility path must update them |
| D. Cap campaign scope to the newest N sessions | Cheap | Wrong numbers ("lifetime" isn't) |

## Decision

**A. Per-session partials in server memory**, built at start in yielding 5-session chunks; `pending` until ready when more than 5 sessions are unbuilt (accepted with the SB pushback, #335).

1. A partial is a **memo**, not a projection. It is derived only from facts, keyed by viewer class and enabled features, held in memory, never persisted, and rebuilt freely.
2. **Invalidation** goes through the existing fact-version listener (FR-STATS-16). It also reports the touched entries' `n`, and the partials of those sessions are dropped. Owner / kind changes of combatants and feature switches drop all partials of the campaign. Unsure → drop all: correctness over speed.
3. **Cold build at server start** (after the session-boundary warm, FR-STATS-14), and again after a drop-all. It runs in chunks of 5 sessions, each one `n`-range read, yielding to the event loop between chunks, so hub frames interleave. **Until ready**, a campaign query gets the built partials plus the unbuilt range read uncached when that range is ≤ 5 sessions (one chunk's cost); otherwise `{pending: true}` (the client shows a skeleton and re-queries in 1 s). Bench gate: longest single block ≤ 50 ms; warm ≤ 50 ms.
4. Players' partials are built after the player filter, like every stats answer (filter, then aggregate).

## Consequences

- ADR-0059 §4 reads: "Only append-only derivations **and fact-version-stamped memos (answers, per-session partials)** may be cached; in memory, never persisted."
- A wrong invalidation shows stale numbers until the next server start. Tests must cover an old undo, a reroll, a charm-away and a feature switch, each compared with a cold recompute.
- Revisit C only if the cold pass breaks its gate on real history.
