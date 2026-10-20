---
title: Stats and summaries
prefix: STATS
status: in-review
owner: spec-stats
phase: post-mvp-7
---

# Stats and summaries

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Promoted from the [post-MVP stub](post-mvp/stats.md) (the integrator removes the stub at merge).

> **Sprint 7, track ST** ([sprint-7](../agents/sprint-7.md), DM [#311](../decisions-log.md)). Decided by the DM (not open): tier A of [feature tiers](../feature-tiers.md#6-table-specific), meaning a **live damage leaderboard** (who dealt / took / healed what this fight), **overkill callouts** and BG2-style **session awards** (biggest hit, most damage taken, most healing, kills, nat 20s / nat 1s, times downed). They are computed from the append-only log ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)), so past sessions get them too. They never leak hidden DM rolls or hidden monsters. The session boundary follows [ADR-0013](../architecture/adr/0013-session-journal-scope.md) (no session record). Proposed ADR: [stats as read models](../architecture/adr/proposed-s7-st-stats-read-models.md). Other specs revised in this track: [combat-tracker](combat-tracker.md) FR-CBT-136–138, [dice-roll-log](dice-roll-log.md) FR-DICE-72–73, [play-shell](play-shell.md) FR-SHELL-93–94, [notifications](notifications.md) FR-NOTE-48–49.

## 1. Summary

- A **Stats** window (both clients) with two tabs. **Fight** is a live leaderboard for the current (or a past) encounter: dealt, taken, healed and kills per combatant. **Session** shows the BG2-style awards for a session (the current one or any past one).
- **Overkill callouts**: a big overkill marks the outcome line ("— Overkill!") and pops a short toast for everyone who sees that line.
- **Computed on read** on the server from facts the game already writes: combat log entries (`hp_change`), rolls and game-log entries. No stats table, no projection, nothing in the snapshot. Each viewer's numbers are built **only from the facts that viewer's log shows** (players: the public lines), filtered **before** aggregation.

## 2. Scope

- Fight leaderboard: live for the started encounter, plus a picker for ended fights (all history).
- Session awards: 9 awards per session (FR-STATS-15). A session is derived from gaps in the log (FR-STATS-12, pick of OQ-STATS-09). The DM can **Show awards** to everyone.
- Overkill callouts: a flag on the outcome line, a line suffix and a live toast.
- One combat-tracker addition: a **From** (healer / source) on the DM's direct Damage / heal, so healing has an author (FR-CBT-136, pick of OQ-STATS-08).
- Every pick below is a **proposal for the DM** (§15) unless marked decided.

## 3. Goals

- At the table: "Thorn did 100 to that goblin!" is visible within 1 s, and the awards at the end of the night take one click.
- Zero leaks: no hidden roll, hidden combatant, monster HP / AC / temp HP or DM-only number reaches a player through any stat. The leak scan covers stats acks.
- Works on every past fight and session already in a campaign's DB, with no backfill.
- Cheap: no CON-44 snapshot growth beyond the outcome-line flag (measured, §12). A fight computes in < 2 ms and a session in < 15 ms at 100 sessions of history.

## 4. Non-goals

- Tier B (feature tiers): end-of-combat summary popup, kill-feed toasts, trophy case on the sheet, dice luck tracker (average d20), XP, campaign-wide records. These are §16.
- Out-of-combat HP (sheet `char.adjustHp`, pet `pet.adjustHp`): not counted (OQ-STATS-16 pick; they have no combat log entry).
- Charts. Tables and numbers only (§14: no dependency).
- Editing or deleting stats. Stats change only when their facts change (apply, undo, reroll).

## 5. User stories

**DM**
- As the DM, I want a live table of who's dealing and taking damage, so I can pace the fight and call out heroics.
- As the DM, I want to press **Show awards** at the end of the night, so everyone sees the BG2-style awards together.
- As the DM, I want my hidden rolls and hidden monsters to count only in my view, so stats never spoil a surprise.

**Player**
- As a player, I want to see my damage and kills climb during the fight, and an "Overkill!" when someone flattens a goblin.
- As a player, I want to look back at last session's awards.

## 6. Functional requirements

**Facts and visibility**

| ID | Requirement | Notes |
|---|---|---|
| FR-STATS-01 | **Computed on read** (proposed ADR): every stat is a pure function of the fact tables at query time: combat log entries (`hp_change`, CBT §8), `roll` and `game-log-entry` (DICE §8), and `combatant` / `encounter` rows for names, kinds and owners. Nothing is written for stats: no table, column, record type or snapshot field. Read helpers are owned by their specs (FR-CBT-138, FR-DICE-73). | OQ-STATS-01 |
| FR-STATS-02 | **Counted facts**: `hp_change` rows with `undone = false` (ADR-0016). Roll entries with `supersededBy = null` (FR-DICE-72). A roll referenced by several entries counts once (OQ-CBT-33). A roll no entry references is never counted (DICE §8 I24). | |
| FR-STATS-03 | **Viewer filter before aggregation.** DM: every counted fact. **Player: only facts whose game-log entry is `public`**: for an `hp_change`, its `entryId` line; for a roll, at least one public entry that references it. Entries visible to one player only (`audiencePlayerId`, ADR-0056) **don't count** for anyone but the DM. So every player gets the **same** numbers (pick of OQ-STATS-01). | Public is stamped once (FR-DICE-13) |
| FR-STATS-04 | **Hidden never leaks.** A line with a hidden attacker or target is non-public (FR-CBT-24), so it never counts for players. A later reveal doesn't backfill (public is stamped once). A player gets a **row** only for a party member (FR-STATS-09) that has ≥ 1 counted fact or is a visible active combatant of the fight (OQ-STATS-11 A). Names come from the facts' name copies. | FR-CBT-24, -44 |
| FR-STATS-05 | **No hidden numbers in player views**: the server's player-view result type has no field for `applied`, `hpBefore`, `hpAfter`, `overkill` amount, AC, temp HP or `effective`. A zod schema per role, and the leak scan reads `stats.query` acks (FR-SYNC-38 style). | Goal §3 |

**Formulas** (fight or session; same code)

| ID | Requirement | Notes |
|---|---|---|
| FR-STATS-06 | **Dealt / taken.** For a damage row: **dealt** += `raw` to `attackerId`, **taken** += `raw` to `targetId`. `raw` is the outcome line's number: after multipliers, DM overrides and trigger parts, including temp HP absorbed (pick of OQ-STATS-06). A ruled miss (`raw 0`, FR-CBT-91) adds 0. Direct damage with no source goes to a DM-only row "DM (direct)". | |
| FR-STATS-07 | **Healed.** For a heal row: **healed** += `raw` to its source (`attackerId`, set by FR-CBT-136's **From**). No source → DM-only row "Unattributed". Overheal counts (the log number; pick of OQ-STATS-07). Setting temp HP is never healing. | |
| FR-STATS-08 | **Kills, downs, overkill.** **Kill**: a damage row on a `monster` target with `hpBefore > 0` and `hpAfter = 0`, credited to `attackerId` (none → "DM (direct)"). A creature revived and dropped again counts again. **Down**: the same test on a `pc` target, counted for that PC. **Overkill** = the row's stored `overkill`, i.e. `max(0, raw − absorbed − hpBefore)` (FR-CBTX-15). | OQ-STATS-15 |
| FR-STATS-09 | **Party and companions.** Party = PCs plus companions (owner set). On the leaderboard a companion has its own line, indented under its owner with the owner chip. **Awards roll a companion's dealt, healed, kills, biggest hit and overkill into its owner** ("Mira + Owlbear"). Taken and downs are the PC's own (pick of OQ-STATS-12). A companion whose owner was cleared (#310: charmed, hostile) is a monster for every fact; its earlier facts follow the current owner field. | ADR-0056 |
| FR-STATS-10 | **Nat 20 / nat 1** per **character**: counted rolls with `natural` ∈ {20, 1} (single kept d20, so adv / dis count the kept die), category ≠ `initiative` (FR-DICE-29), actor = a character entity (DM rolls for a PC count for that PC). Death saves count. "As me" rolls (no character) and monster / companion rolls are not counted. | FR-DICE-72 |
| FR-STATS-11 | **Gems (GM track, seam proposal):** a reroll supersedes its entry, so only the **final** roll counts (FR-STATS-02). A **maxed die** is in the card's total, so it counts through `raw` when applied (no separate stat). While gems are off nothing changes (#312). | OQ-STATS-14 |

**Scopes**

| ID | Requirement | Notes |
|---|---|---|
| FR-STATS-12 | **Session** = a run of game-log entries (by `n`) where each entry is < **6 h** after the previous one. A gap of ≥ 6 h starts a new session. No session record (ADR-0013 holds); boundaries are derived only. Session facts: `hp_change` rows with `at` in the session's `[from, to]` (read through encounters overlapping it) and roll entries with `n` in `[fromN, toN]`. **Current session** = the one holding the newest entry. Players' session list: the DM's sessions with ≥ 1 public entry, ranges clipped to public entries. | OQ-STATS-09 |
| FR-STATS-13 | **Session boundaries are cached** per campaign in server memory: computed once, then extended from the last seen `n` (entries are append-only). After a restart the first list query rebuilds it (≤ 103 ms at 100 sessions, measured §12). | |
| FR-STATS-14 | **Fight** = one encounter's counted `hp_change` rows. The default is the started encounter, else the newest ended one. The picker lists ended encounters newest first, by name and date; players see only encounters that were started (planned ones never). | |
| FR-STATS-15 | **Awards** (session scope), each with a winner, a number and a detail line: **Biggest hit** (max `raw` of one row: "Thorn → Goblin 1, 30, Goblin Ambush"), **Biggest overkill**, **Most damage dealt**, **Most damage taken**, **Most healing**, **Most kills**, **Most nat 20s**, **Most nat 1s**, **Most times downed**. Candidates are party members (FR-STATS-09). Ties list every name. An award with value 0 shows its empty line ("Nobody went down. Nice."). | BG2 |

**Read path and UI**

| ID | Requirement | Notes |
|---|---|---|
| FR-STATS-16 | **`stats.query`** (DM, player) takes `{scope: "fight", encounterId?}`, `{scope: "session", fromN?}` or `{scope: "sessions"}`. It is a **read-only command**: no write, no event, no log row, no `seq`. It runs in hub frame order like any command, so facts committed before it are in its result. Ack is `{fight}`, `{session}` or `{sessions}` (§9). Errors: unknown encounter, or a planned one for a player → `not_found`; an unknown `fromN` → `not_found`. | ADR-0021 |
| FR-STATS-17 | **Live refresh**: while the Stats window is open and not minimised, the client re-sends its query (trailing debounce 1 s) on any live frame with a `game-log-entry` upsert. For the Fight tab only entries with that `encounterId` trigger it. It also re-sends after every snapshot. Stats are never computed on the client. | ≤ 1 per s |
| FR-STATS-18 | **Fight tab**: one table (`stats-fight-table`) with columns Name, Dealt, Taken, Healed, Kills, sorted by Dealt, then Name. Party first. DM: monster rows too, muted, hidden ones with eye-off, plus "DM (direct)" / "Unattributed" rows, and a Tooltip on Dealt / Healed with **Effective** (`applied` + absorbed, healing `applied`). A header shows the fight name, round, and a picker (`stats-fight-picker`). | OQ-STATS-11 |
| FR-STATS-19 | **Session tab**: a session picker (`stats-session-picker`, "Tue 20 Oct · 19:02–23:41 · 3 fights"), then the 9 award cards (`stats-award`, `data-record-id` = award key) in FR-STATS-15 order. DM: a **Show awards** button (`stats-show-awards`). | |
| FR-STATS-20 | **`stats.showAwards {fromN}`** (DM): `notify` a `stats-awards` notification (audience all, no action; payload `{fromN, toN, from, to, label}`, FR-NOTE-48). On arrival each client opens Stats on that session's awards (FR-SHELL-94), computed under its own viewer filter. Showing again makes a new notification. | OQ-STATS-10 |
| FR-STATS-21 | **Overkill callout rule**: a damage row is a callout when `hpAfter = 0` and `overkill ≥ max(10, hpBefore + absorbed)`, i.e. at least double what was needed and ≥ 10 extra (pick of OQ-STATS-05). Written once at apply (FR-CBT-137); stats only read it. | |
| FR-STATS-22 | **Callout toast**: on a **live** frame (never a snapshot) whose `game-log-entry` upsert is a `cbt.attack` line with `callout: "overkill"`, not undone, the client shows a 4 s Toast (`stats-overkill-toast`). Players see "Overkill! Thorn → Goblin 1: 30 damage" (no HP). The DM sees "… (+23 over 7 HP)". The lines of one frame merge into one toast. It is not a notification (FR-NOTE-49). | OQ-STATS-03, -04 |
| FR-STATS-23 | **Retroactive**: every fight and session already in the DB works with no backfill. Rows from before sprint 3 read `tempBefore` / `tempAfter` as 0 (their defaults). Lines from before this sprint carry no `callout`, and the table still shows their overkill. | OQ-STATS-13 |
| FR-STATS-24 | **States**: loading (skeleton rows), empty ("No fight yet" / "No damage yet this fight" / "No sessions yet"), error (inline "Couldn't load stats" + Retry), offline (last result, muted, "Offline", picker disabled). | |
| FR-STATS-25 | **Limits**: a fight result holds ≤ 70 rows (60 combatants + specials). A session holds ≤ 9 awards × ≤ 8 tied names. `sessions` returns ≤ 200 newest. Each ack is ≤ 64 KB (well under the 4 MiB frame). | §12 |

## 7. UI/UX notes

Reference [visual-direction](../design/visual-direction.md). shadcn Table, Tabs, Select, Card, Badge, Tooltip, Toast; no custom styling.

- **Screens:** the window `stats.board` "Stats" (FR-SHELL-93), with Tabs **Fight** | **Session**.
  - Fight: the header (fight name · round N · picker), then the table.
  - Session: the picker, then a 3-column grid of award cards (1 column under 400 px). Each card has the title, the winner name(s) in the player colour (FR-CAMP-28), the number, and the detail line in muted text.
- **States:** FR-STATS-24.
- **DM view:** every row (monsters muted, hidden rows with eye-off), Effective tooltips, special rows, Show awards.
- **Player view:** party rows only (PCs + companions, OQ-STATS-11). Numbers are public-line numbers only. No Show awards. Awards open by themselves when the DM shows them.
- **Callout:** the line suffix " — Overkill!" (FR-CBT-137). The Toast goes in the client's toast region (players bottom-right, DM top-centre band, FR-NOTE-42).

## 8. Data model

**No new entity, column or record type.** Stats read:

| Source (owner) | Fields read | Use |
|---|---|---|
| `hp_change` (CBT §8) | encounterId, at, kind, attackerId, attackerName, targetId, targetName, raw, applied, overkill, hpBefore, hpAfter, tempBefore, tempAfter, entryId, undone | dealt, taken, healed, kills, downs, overkill, effective (DM) |
| `game_log_entry` (DICE §8) | n, at, kind, public, undone, rollIds, encounterId, supersededBy, payload.callout | viewer filter, sessions, callout |
| `roll` (DICE §8) | id, actorKind, actorId, category, natural | nat 20 / nat 1 |
| `combatant`, `encounter`, `entity` | kind, ownerCharacterId, hidden, active, name; encounter name, status, startedAt, endedAt; entity kind (character) | rows, party, picker |

- **Added by this track (owned by CBT):** outcome line `payload.callout?: "overkill"` and `dmPayload.overkill? {amount, hpBefore}` (FR-CBT-137). `cbt.applyHp` input `sourceId?` writes the existing `hp_change.attackerId` / `attackerName` (FR-CBT-136).
- **Relations (read):** `hp_change` → combatant (attacker, target) → encounter, and → game-log entry (`entryId`, visibility). Game-log entry → rolls (`rollIds`), and → the superseding entry (`supersededBy`). Roll → character entity (`actorId`). Combatant → owner character (companions).
- **Derived:** every stat (§6), session boundaries (FR-STATS-12).
- **Persisted runtime state:** none. Server memory holds the session-boundary cache per campaign. The client's open tab, picks and last result live in client memory (window geometry per ADR-0025).

## 9. API & events

**REST:** none.

**WS intents (client → server)**

| Intent | Who | Validation / ownership | Ack |
|---|---|---|---|
| `stats.query {scope: "fight", encounterId?}` | DM, player | Encounter of the active campaign; player: status `started` / `ended` | `{fight: {encounterId, name, round, status, rows: Row[]}}` |
| `stats.query {scope: "session", fromN?}` | DM, player | `fromN` = a session start the viewer can list; default current | `{session: {fromN, toN, from, to, fights, awards: Award[]}}` |
| `stats.query {scope: "sessions"}` | DM, player | none | `{sessions: [{fromN, toN, from, to, fights}]}` (≤ 200, newest first) |
| `stats.showAwards {fromN}` | DM | a session start (`not_found`) | `{notificationId}` |

- `Row` (player) = `{key, name, ownerName?, kind: "pc" | "companion" | "monster", dealt, taken, healed, kills}`. The DM's `Row` adds `effectiveDealt`, `effectiveHealed`, `hidden`, `special?: "direct" | "unattributed"`.
- `Award` = `{key, names: string[], playerIds: (string | null)[], value, detail}`. `detail` is built from public facts in the player schema: names, attack name, fight name and the raw number only.

**WS events (server → client)**

| Event | Payload | Visibility rule |
|---|---|---|
| (none new) | `stats.query` answers in its `ack` | Per-viewer filter FR-STATS-03 / -05 before aggregation; leak-scanned |
| `NotificationCreated` (kind `stats-awards`) | NOTE §9 | audience all (FR-NOTE-48) |
| `AttackApplied` / `HpApplied` (existing) | outcome lines with `callout` (FR-CBT-137) | as today: `callout` in `payload` (player-safe), amounts in `dmPayload` (DM only) |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Query a fight / session / list | ✓ (all facts) | ✓ (public facts) | role → filter (FR-STATS-03); player: no planned encounter |
| Show awards | ✓ | ✗ | `stats.showAwards` DM-only (`forbidden`) |
| Change stats | ✗ | ✗ | no command exists; facts change only via apply / undo / reroll |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** the window shows its last result muted, then re-queries after the snapshot (FR-STATS-17). Awards shown while offline arrive as a notification in history with **Open**.
- **DM disconnect / reconnect:** same. No pending state.
- **Server crash mid-action:** stats hold no state. A crash before the apply's commit means no row and no stat; after it, the row counts. The boundary cache is rebuilt on the first query. A hard kill during `stats.query` loses only the answer, and the client retries after reconnecting.
- **Concurrent edits:** apply, undo and query are serialised in hub order. An undo marks the line undone (`game-log-entry` upsert) → the stats re-query and drop the row.
- **Invalid / malicious input:** zod per intent. A player asking for a planned encounter or a DM-only session gets `not_found`. No player input can widen the filter (role from the connection).
- **DM hides attack lines** (attack category not public, FR-DICE-12): players' Dealt / Taken for monster attacks stay empty. This is correct (the log didn't show them), and it's named in OQ-STATS-01.
- **Apply hit + late damage:** stats count only the damage Apply's rows. A ruled hit that never gets damage (dropped, dismissed, End) counts nothing.
- **Manual override:** the overridden total counts (it's the log number). The DM tooltip shows "DM set".
- **Multi-target apply:** one row per target. Biggest hit is per target, not per card.
- **Fight spanning two sessions:** each row goes to the session holding its `at`.
- **Name changes:** rows use the names copied at the time. A PC renamed mid-campaign shows its old name on old facts and is grouped by entity id under its current name.

## 12. Performance & bandwidth

Measured on `session-sim` + `buildRealisticHeavy` (throwaway probe, deleted), Bun 1.3.14, Windows dev box.

| What | Measured |
|---|---|
| Snapshot today (heavy) | DM 690,584 B; worst player 288,913 B (ceilings 1.5 MiB / 512 KiB, #256) |
| `callout` + DM `overkill` on **every** outcome line in the window (30, worst case) | DM +1,461 B (≈ 49 B a line), each player +630 B (21 B a line) |
| `stats-awards` notification row | 575 B a row. It takes a slot in the 100 newest closed rows (pinned + 100 window, ADR-0029), so the snapshot doesn't grow with sessions; it measured −169 B net with 10 rows replacing max-length ones |
| New per-event traffic | outcome line +21 B (players) / +49 B (DM) on callout lines only; one notification per Show awards |

Compute (prototype of FR-STATS-03–15 on synthetic history: per session 4 fights × 80 applies + 300 other rolls = 940 entries, 940 rolls, 320 `hp_change` rows):

| History | Entries / rolls / `hp_change` | Fight (DM / player) | One session's awards (DM / player) | Session list (cold) |
|---|---|---|---|---|
| 1 session (4 h) | 1,166 / 1,166 / 350 | 0.55 / 0.47 ms | 6.3 / 6.2 ms | 3.0 ms |
| 10 sessions | 9,626 / 9,626 / 3,230 | 0.40 / 0.38 ms | 7.3 / 6.1 ms | 12 ms |
| 100 sessions | 94,226 / 94,226 / 32,030 | 0.37 / 0.69 ms | 5.4 / 6.0 ms | 103 ms (a SQL window function took 374 ms, rejected) |

- Medians of 7. The list is the only cost that grows with history, so it's cached (FR-STATS-13). Every query is O(one fight or one session), and the debounce caps re-queries at 1/s per open window.
- **Bench gates** (`stats.bench.ts`, `bun run bench` only): fight ≤ 20 ms, session ≤ 50 ms, list cold ≤ 300 ms / warm ≤ 5 ms at 100 sessions.
- **Ack size:** ≤ 64 KB bound (FR-STATS-25). Typical fight ≈ 2–4 KB.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)), per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

**Fixtures** (`fixtures/units/stats/`; bundle **`stats`** = `session-sim-10` + these; e2e alias **`stats-e2e`**):
- `st-past-crypt`: an **ended** fight "Old Crypt" (Thorn vs 2 Skeletons, one overkill, Mira downed once, a public nat 20 by Thorn) for the fight picker. All fixture facts share the fixed fixture clock (FR-FIX-08), so the whole bundle is one **past session** next to live play. Two past sittings are tested in integration with an injected clock.
- `st-ambush-facts`: on sim-10's running Goblin Ambush, scripted applies with **manual dice** (exact numbers):
  - Thorn nat-20 hit, 30 on Goblin 1 at 7 HP → overkill 23, callout.
  - Mira nat 1 → miss (raw 0).
  - Brakka heals Mira 8 with From = Brakka, Mira 3 below max → raw 8, effective 3.
  - Goblin 2 downs Brakka.
  - The hidden Elite hits Thorn for 9 (non-public line).
  - A **hidden DM roll** as Thorn: nat 20, public off.
  - Apply hit, then late damage 11 on Goblin 3.
  - A DM-overridden total (rolled 6 → set 12).
  - One applied-then-undone hit.
  - Mira's Owlbear kills Goblin 3.

  The unit's header lists the expected DM and player numbers per row and award.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-STATS-06 dealt and taken use raw`, `FR-STATS-07 healing raw, overheal, unattributed`, `FR-STATS-08 kill, down, revive counts again`, `FR-STATS-08 overkill raw vs applied (temp HP absorbed)`, `FR-STATS-10 nat 20 / 1: kept die, initiative excluded, death saves in`, `FR-STATS-12 sessions by 6 h gap`, `FR-STATS-15 award ties and zero`, `FR-STATS-21 callout threshold` | in-memory rows |
| Integration | `FR-STATS-02 undone rows excluded`, `FR-STATS-03 public facts only, same for every player`, `FR-STATS-04 hidden roll never counted for players` (+ for the DM), `FR-STATS-04 hidden monster never counted / no row`, `FR-STATS-05 leak scan per player on stats acks` (Player 1, Player 2: no HP, AC, temp, applied, hidden name), `FR-STATS-06 manual override counts the set total`, `FR-STATS-06 apply hit + late damage counted once at the damage apply`, `FR-STATS-09 companion line and roll-up into owner`, `FR-STATS-11 superseded entry not counted` (runs once GM's supersede lands; until then on a hand-set `supersededBy`), `FR-STATS-12 retroactive past session` (clock injected: two sittings 8 days apart), `FR-STATS-13 cache extends, rebuilds after restart`, `FR-STATS-16 read-only: no event, log row or seq`, `FR-STATS-16 player planned encounter not_found`, `FR-STATS-20 show awards notifies all`, `FR-STATS-23 old rows parse`, crash: `FR-STATS-16 kill server mid-fight → restart → same results` (digest equal) | `stats` |
| E2E (thin) | DM applies an overkill → both clients' Fight tab updates ≤ 2 s and Player 2 gets the toast; DM Show awards → Player 1's Stats opens on Awards | `stats-e2e` |
| Bench | FR-STATS §12 gates | synthetic 100 sessions |

**Browser walkthrough** (test agent; bundle `stats`, verify profile; contexts `dm`, `player-1`, `player-2`; 1440×900):
1. DM opens Stats → Fight shows Goblin Ambush with the unit's DM numbers (incl. the Elite row, eye-off, and "DM (direct)"). Player 1 and Player 2 open Stats → the party rows have the unit's **player** numbers (Thorn's Taken is 9 lower, no Elite, no monster rows).
2. DM: Thorn attacks Goblin 4 (manual 20), Apply 40 at ≤ 10 HP → the line reads "— Overkill!". Toasts: DM "(+N over M HP)", both players "Overkill! Thorn → Goblin 4: 40 damage". All three tables update ≤ 2 s.
3. DM Undo → the line is struck, the tables drop the 40 and no toast appears. DM re-applies.
4. Player 2's view: no HP, AC or hidden name anywhere (snapshot + acks, leak-scan helper).
5. Session tab: the picker lists **two** sessions: the bundle's (every fixture fact sits at the fixed fixture clock: sim-10, Old Crypt and the ambush facts) and **Today** (steps 2–3, live). The bundle session's awards match the unit header. **Thorn's nat-20 count is 1 higher for the DM** (the hidden roll), and Player 2 sees the public count.
6. DM ends the fight, then **Show awards** for Today → an info toast and both players' Stats open on Today's awards. Biggest hit and biggest overkill = Thorn's 40 from step 2 (the undone apply isn't counted).
7. Reload Player 1 and the DM → the same numbers. Hard-kill the server, restart → the same numbers (`state:digest` equal).

Evidence under `.verify/<run-id>/` per AGENTS §9.6.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [combat-tracker](combat-tracker.md) FR-CBT-136–138 | heal / damage **From**, the outcome-line `callout`, the read helper; `hp_change` semantics unchanged | revised in this track |
| [dice-roll-log](dice-roll-log.md) FR-DICE-72–73 | roll-fact contract, read helpers, supersede rule | revised in this track; **after GM's reroll core** |
| [gems](post-mvp/gems.md) (GM promotes it to `gems.md`) (GM track, parallel) | rerolls set `supersededBy` on the old entry; Combat gem's maxed die is in the card total | OQ-STATS-14, seam |
| [play-shell](play-shell.md) FR-SHELL-93–94 | window registration, the feature open on awards | revised; **after FU's frame slice** |
| [notifications](notifications.md) FR-NOTE-48–49 | `stats-awards` kind + view, callout toasts aren't notifications | revised in this track |
| [live-sync](live-sync.md) | `useEventFrame` (live frames), leak scan over acks, command pipeline with an empty event list | built |
| Libraries | **none**: tables and numbers only. Rejected: a chart library (Recharts ≈ 100 KB gz, MIT) since tier A has no chart | — |

**Build split** (AGENTS §9.9; sprint-7 hotspots)

| Slice | What | Files (shared marked ⚠) | Order |
|---|---|---|---|
| **ST0** `fix/st-core` | `stats.query`, `stats.showAwards`, formulas, viewer filter, boundary cache, the `stats-awards` kind, read helpers (FR-CBT-138, FR-DICE-73), bench, units + bundle `stats` | `src/server/features/stats/*`, `src/shared/stats/*`, `src/server/features/{combat-tracker,dice-roll-log}/stats-read.ts` (new files), ⚠ `src/server/features/index.ts` (append), ⚠ `notifications/kinds.ts` (append), ⚠ `fixtures/bundles/index.ts` (append), ⚠ `docs/protocol/` (assigned writer), `package.json` bench list ⚠ | **No schema lane.** After GM core (reads `supersededBy`) |
| **ST1** `fix/st-lines` | FR-CBT-136 From (server + the DM's Damage / heal dialog), FR-CBT-137 callout on the line + `formatLine` | `combat-tracker/hp.ts`, `cbt.attack` / `cbt.hp` kinds in `src/shared/combat-tracker/`, the DM HP dialog | Holds the apply path: after GM core, **one holder at a time** with GM's card total change; parallel with ST0 |
| **ST2** `build/st-window` | the Stats window (both clients), live refresh, callout toast, award open, notification views | `src/client/common/features/stats/*`, ⚠ `src/client/{dm,player}/windows.ts` (append), ⚠ `notification-views.ts` ×2 (append) | After ST0 + ST1 **and FU's frame slice** (parking / default sizes) |

- ST0 ∥ ST1 (no shared file). ST2 runs in parallel with any non-frame FU slice.

## 15. Open questions

**Bold** option = suggested pick (not decided). All are DM questions unless they're marked cross-spec.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-STATS-01 | Who sees which stats? | **A. DM all facts; every player the same numbers from public log lines only** (zero-leak, but thin if the DM hides monster attacks) · B. A + each player also counts lines only they see (companion rolls) (numbers differ per player) · C. DM-only, DM shares a frozen copy (most control, most clicks) | yes | STATS, DICE |
| OQ-STATS-02 | Where and when is the leaderboard? | **A. A Stats window (launcher), live** (one place, opt-in) · B. A strip in the Initiative footer (always in view, but steals Initiative's rows, FR-SHELL-32) · C. An end-of-combat popup (tier B, not live) | yes | SHELL, CBT |
| OQ-STATS-03 | Overkill callout as a toast, a log line or both? | **A. Both** (the moment + a record) · B. Line only (quiet) · C. Toast only (gone after 4 s) | no · DM | CBT, NOTE |
| OQ-STATS-04 | What do players see of an overkill on a monster? | **A. "Overkill!" + the public damage, no HP** (no HP leak, FR-CBT-26) · B. The overkill amount (fun, but it reveals the HP left) · C. DM-only callout | yes | CBT |
| OQ-STATS-05 | Callout threshold | **A. overkill ≥ max(10, what was needed)** (rare and loud) · B. any overkill ≥ 10 (frequent) · C. damage ≥ 2× needed (spams on 1-HP minions) | no · DM | STATS |
| OQ-STATS-06 | What counts as "dealt"? | **A. The log number (raw after multipliers and DM overrides); DM also sees Effective** (matches the log, no HP leak) · B. Effective (HP + temp actually removed) (truer, but leaks monster HP to players) · C. Rolled before overrides (ignores DM rulings) | yes | STATS, CBT |
| OQ-STATS-07 | Healing over max, temp HP | **A. The log number (overheal counts); temp HP is never healing; DM sees Effective** (simple, consistent with A above) · B. Effective healing only (fairer to careful healers) | no · DM | STATS |
| OQ-STATS-08 | Who gets credit for a heal? (today nobody: the DM's direct heal has no source) | **A. A From field on the DM's Damage / heal, preset to the turn combatant for heals** (one click, FR-CBT-136) · B. Sum of each character's `healing`-category rolls (no DM step, but counts heals never applied) · C. No healer, so drop "Most healing" | yes | CBT |
| OQ-STATS-09 | What is a session? | **A. Derived: a ≥ 6 h gap in the log starts one** (no record, ADR-0013 holds, works retroactively) · B. A DM "End session" marker (exact, but supersedes ADR-0013 and doesn't work for the past) · C. The DM picks a date range each time | yes | STATS, ADR-0013 |
| OQ-STATS-10 | When do awards show? | **A. The DM presses Show awards → everyone's Stats opens on Awards** (a moment at the table) · B. Always in the window, no push · C. Automatically at the End of the night's last fight (the app has to guess which fight is last) | no · DM | NOTE, SHELL |
| OQ-STATS-11 | Monsters and companions on the players' leaderboard? | **A. Players: party (PCs + companions); DM: everyone** (party-focused, spares the band-only monsters) · B. Everyone sees visible monsters too ("Goblin 2 dealt 14") · C. PCs only | no · DM | STATS |
| OQ-STATS-12 | Companion credit in awards | **A. Rolled into the owner ("Mira + Owlbear") for dealt / healed / kills / hits; taken and downs own** (your summons are your glory) · B. Companions can win on their own · C. Companions ignored | no · DM | STATS, ADR-0056 |
| OQ-STATS-13 | Past sessions retroactively? | **A. All history, no backfill** (free with compute-on-read) · B. From the release on | no · DM | STATS |
| OQ-STATS-14 | *(cross-spec: [gems](post-mvp/gems.md) (GM promotes it to `gems.md`))* A reroll and a maxed die | **A. Count the final roll only (the superseded entry doesn't count); a maxed die counts through the applied total, with no stat of its own** (needs GM to set `supersededBy` on the old entry, not delete or edit it) · B. Count both rolls for nat 20 / 1 | yes · orchestrator seam | GEM, DICE |
| OQ-STATS-15 | Which kills count? | **A. Any monster dropped to 0, including allies and friendly fire; revive + drop counts again** (simple and visible) · B. Enemy side only, once per creature per fight | no · DM | STATS |
| OQ-STATS-16 | Out-of-combat HP (sheet / pet HP changes) | **A. Not counted** (no combat log entry, no source) · B. Count downs from `CharacterHpAdjusted` events (reads the event log, unindexed) | no · DM | STATS |
| OQ-STATS-17 | *(cross-spec: [play-shell](play-shell.md), FU track)* the default size / spot of `stats.board` and its place in the parking rule | **A. 400 × 412, top-left dx 56, min 320 × 240, `defaultOpen: false`, parked like any launcher window** (FR-SHELL-61 contract; FU's rule wins) | no · owner: FU | SHELL |
| OQ-STATS-18 | Glossary: add "Stats window", "Session awards", "Overkill callout"; amend **Session** to "derived from a ≥ 6 h log gap for stats, never stored" | **A. Add / amend** | no · integrator | glossary |

## 16. Out of scope

- Tier B ([feature tiers](../feature-tiers.md#6-table-specific)): end-of-combat summary popup, kill-feed toasts ("Thorn finished the Ogre, overkill 37"), character trophy case on the sheet, dice luck tracker, XP.
- Campaign-wide records ("toughest monster ever killed"), favourite weapon, charts.
- Session records, recaps and journal ([campaign-manager](post-mvp/campaign-manager.md), ADR-0013).
- Exporting stats.
