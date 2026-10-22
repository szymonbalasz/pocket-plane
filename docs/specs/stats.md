---
title: Stats and summaries
prefix: STATS
status: in-review
owner: spec-wf, spec-sb, spec-fx
phase: post-mvp-9
---

# Stats and summaries

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Promoted from the post-MVP stub (the integrator moves it).

> **Sprint 7, track ST** (DM [#311](../decisions-log.md), decided): tier A of [feature tiers](../feature-tiers.md#6-table-specific), meaning a live damage leaderboard, overkill callouts and BG2-style session awards. They come from the append-only log ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)) and never leak; sessions follow [ADR-0013](../architecture/adr/0013-session-journal-scope.md). Proposed ADR: [stats as read models](../architecture/adr/0059-stats-read-models.md). Also revised: FR-CBT-136–138, FR-DICE-72–73, FR-SHELL-93–94, FR-NOTE-48–49. Seams S1–S8, S11, S13 and review rulings 2–4, 10, 13, 20–25 applied.

> **Sprint 8, track SB** (DM [#334](../decisions-log.md), decided): tier B, with tier A's visibility rules. FR-STATS-26–53 ([§6.1](#61-tier-b-sprint-8)); also FR-CBT-152–153, FR-NOTE-68–69, FR-CHARX-97–99, FR-DICE-89–90. No schema. [ADR: session partials](../architecture/adr/0062-stats-session-partials.md). Seams applied. OQ-STATS-20–30 decided at DM gate 1 (#335).

> **Sprint 8, track WF** (DM [#333](../decisions-log.md); size rows only): FR-STATS-66 gives `stats.board` a useful size checked by content; FR-STATS-67 sizes the award grid to the window (BL-66). Slice WF4; walkthrough F9, F13 ([play-shell §13](play-shell.md#13-test-plan)). 0 B.

> **Sprint 9, track FX** (fix pack, DM [#338](../decisions-log.md)): FR-STATS-68–70 ([§6.2](#62-sprint-9-fix-pack)).
> - **BL-84** (sim-12 FAIL h): the DM got no kill-feed callout for hidden kills.
> - **BL-74**: a `conflict` on rapid queries from a viewer's two tabs.
> - **BL-90**: players' "No damage yet" beside a kill.
> - **BL-69**, dates half: the fixture clock. [OQ-STATS-36](#15-open-questions) moved to the DM as [OQ-FIX-21](fixtures-adapters.md#15-open-questions) (review-b ruling 4: it amends ADR-0022). Under A, [FR-FIX-29](fixtures-adapters.md#6-functional-requirements) anchors CLI loads at load time.
> - Slice **FX1** with [notifications](notifications.md) FR-NOTE-70–73; walkthrough [notifications §13 FX1](notifications.md#13-test-plan). No schema, 0 B.

## 1. Summary

- A **Stats** window (both clients): **Fight** = a live leaderboard; **Session** = 9 awards and the DM's **Show awards**.
- **Overkill callouts**: "— Overkill!" on the line, and a toast.
- **Computed on read** from facts already written, filtered per viewer **before** aggregation; nothing in the snapshot.
- Combat-tracker gains a **From** on direct heals (FR-CBT-136).
- *(Sprint 8)* **Kill feed** toasts ("Thorn finished Goblin 1"); at End, Stats opens on the fight with **Highlights**; a **Luck** tab; a **Trophies** tab on the sheet.

## 2. Scope

- Live and past fights and sessions, callouts, awards. *(Sprint 8)* Kill feed, highlights, luck (session, campaign), trophies (campaign).

## 3. Goals

- An overkill reaches every screen in ≤ 1 s. Awards take one click.
- Zero leaks to players (FR-STATS-05).
- All history works, with no backfill.
- Cheap (§12). *(Sprint 8)* A kill toasts once, ≤ 1 s; campaign numbers ≤ 50 ms warm.

## 4. Non-goals

- Out-of-combat HP (`char.adjustHp`, `pet.adjustHp`): there's no combat log entry for it.
- A "gems spent" award (seam S2), charts, editing stats. *(Sprint 8)* XP, party-wide records, a feed for old lines.

## 5. User stories

- **DM:** a live damage table to pace fights; one **Show awards** at the end of the night; my hidden rolls and monsters count only for me.
- **Player:** watch my damage and kills climb, see "Overkill!", look back at last session's awards. *(Sprint 8)* See who finished the Ogre, my character's lifetime records, proof my d20 is cursed.

## 6. Functional requirements

**Facts and visibility**

| ID | Requirement |
|---|---|
| FR-STATS-01 | **Computed on read** from the §8 sources at query time; nothing is written for stats. Read helpers: FR-CBT-138, FR-DICE-73. |
| FR-STATS-02 | **Counted:** `hp_change` rows not `undone`; rolls per [FR-DICE-67](dice-roll-log.md#6-functional-requirements) (a reroll's final roll only), each once. |
| FR-STATS-03 | **Filter, then aggregate.** DM: all. **Players: the hub filter for a viewer with no `playerId`** (public entries only; `hp_change` via `entryId`), so every player gets the same numbers. Feature-tagged kinds are skipped while off (S1). |
| FR-STATS-04 | **Hidden never leaks.** A hidden attacker / target makes the line non-public (FR-CBT-24); a reveal doesn't backfill. Player rows: the party only. **Names come from fact and combatant rows, never tokens** (an ended summon keeps its name, S7). |
| FR-STATS-05 | **Player schema** (zod per role) has no applied, HP, overkill amount, AC, temp HP, Effective or encounter name / id. Acks are leak-scanned. |

**Formulas** (party = PCs + companions)

| ID | Stat | Rule |
|---|---|---|
| FR-STATS-06 | Dealt / Taken | `raw` (the line's number, after multipliers and overrides, incl. absorbed temp) to attacker and target. No source → DM-only "DM (direct)". Apply hit + late damage counts once. |
| FR-STATS-07 | Healed | `raw` to the source (FR-CBT-136), else DM-only "Unattributed". Overheal counts; temp HP isn't healing. |
| FR-STATS-08 | Kills / downs / overkill | **Kill**: a `monster` going `hpBefore > 0 → 0`, to the attacker (again after a revive; bind HP is no fact, S8). **Down**: same on a `pc`. **Overkill**: stored `max(0, raw − absorbed − hpBefore)`, DM only. |
| FR-STATS-09 | Companions | Own line under the owner; awards roll dealt, healed, kills, hits into the **current** owner ("Mira + Owlbear"). A charmed-away companion (#310) is a monster, past facts too. |
| FR-STATS-10 | Nat 20 / 1 | Per character actor: `natural` 20 / 1 (kept die), not `initiative`; death saves count. |
| FR-STATS-11 | Gems | A Combat-gem maxed die counts only via the applied `raw` (S2). Gems off → no change. |
| FR-STATS-12 | Awards | Session scope: Biggest hit, Biggest overkill, Most damage dealt / taken, Most healing, Most kills, Most nat 20s, Most nat 1s, Most times downed. Party only; ties list all; 0 → an empty line. **`value`** = the sum / count / max raw, except **Biggest overkill: DM the overkill amount; players the callout line (FR-CBT-137) with the largest `raw`, valued and ranked by `raw`** (no `raw − value`). Detail: "Thorn → Goblin 1, 30, ‹fight label›". |

**Scopes**

| ID | Requirement |
|---|---|
| FR-STATS-13 | **Session** = entries with no ≥ 6 h gap; never stored. **Key = the unclipped `fromN` for every viewer**; any `n` inside resolves to it. Facts: `hp_change` by `at`, rolls by entry `n`. Players list sessions with a public entry (times clipped). Hidden entries may bridge a gap (accepted). |
| FR-STATS-14 | **Boundary cache** in server memory per campaign, **warmed at server start** (a start hook, ≤ 103 ms at 100 sessions) and extended from the last `n`. |
| FR-STATS-15 | **Fight** = one encounter. Default: the started one, else the newest ended. **Players** see only fights with a public fact (also in `fights` counts), as "Fight N · Tue 20 Oct" (N by `startedAt`); the DM sees names (OQ-STATS-19). |

**Read path and UI**

| ID | Requirement |
|---|---|
| FR-STATS-16 | **`stats.query`** (DM, player; §9): a read-only command (no write, event, log row or `seq`) in hub frame order. **Rate limit per connection: ≤ 4 / s; the excess is coalesced into the next.** An unknown or hidden fight, or an unknown `n` → `not_found`. |
| FR-STATS-17 | **Live refresh** while the window is open and not minimised: re-query (trailing 1 s) on a live `game-log-entry` upsert (Fight: same `encounterId`) and after each snapshot. Never computed on the client. |
| FR-STATS-18 | **Fight tab**: `stats-fight-picker`, `stats-fight-table` of `stats-fight-row` (`data-record-id` = combatant key): Name, Dealt, Taken, Healed, Kills, by Dealt. DM: monster rows (hidden eye-off), special rows, Effective Tooltip. |
| FR-STATS-19 | **Session tab**: `stats-session-picker` ("Tue 20 Oct · 19:02–23:41 · 3 fights"), 9 cards `stats-award` (`data-record-id` = key) holding `stats-award-value`, winners in the player colour. DM: `stats-show-awards`. Grid of 3 columns, 1 under 400 px. |
| FR-STATS-20 | **`stats.showAwards {fromN}`** (DM) → a `stats-awards` info notification to all (FR-NOTE-48). Each client opens Stats on those awards (FR-SHELL-94) under its own filter; an offline player has **Open** in history. |
| FR-STATS-21 | **Callout rule**: `hpAfter = 0` and `overkill ≥ max(10, hpBefore + absorbed)`; stamped at apply (FR-CBT-137). |
| FR-STATS-22 | **Callout toast** `stats-overkill-toast` (4 s), from **live** frames only: a `cbt.attack` upsert with `callout`, not undone. Players: "Overkill! Thorn → Goblin 1: 30 damage"; the DM adds "(+23 over 7 HP)". One per frame. An info toast, not a notification (FR-NOTE-49). *(ST2 build, #328: fires on any outcome line with the callout: `cbt.attack` and the DM's direct `cbt.hp` damage)* *(Sprint 8: folded into FR-STATS-28; a callout on an already-downed target keeps this text.)* |
| FR-STATS-23 | **Retroactive, stateless**: no backfill. A crash loses only an answer; reconnect → re-query (last result muted). Undo → re-query drops the row. Old facts keep old names. |
| FR-STATS-24 | **States**: skeleton rows; "No fight yet" / "No damage yet this fight" / "No sessions yet"; "Couldn't load stats" + Retry; offline = last result muted, pickers off. |
| FR-STATS-25 | **Limits**: fight ≤ 70 rows; ≤ 8 tied names; `sessions` ≤ 200 newest; ack ≤ 64 KB. |
| FR-STATS-66 | **Stats useful size** (S8, WF; BL-66: players' Stats opened at 320 × 280, names cut). Default 400 × 412 and min 320 × 280 stay. `usefulSize` **400 × 360**; criterion (seams S5): **5 rows with names whole, or 2 award cards, or the first 4 Highlights lines** visible without scrolling. The placer opens it at least that big while a put-away or a player's map yield helps ([FR-SHELL-97](play-shell.md#6-functional-requirements)). Test `FR-STATS-66 Stats useful size` in `e2e/useful-size.e2e.ts` (browser; [FR-SHELL-100](play-shell.md#6-functional-requirements)). |
| FR-STATS-67 | **Award cards fit** (BL-66, DM: text clipped at 400 wide; amends FR-STATS-19's columns). Columns follow the window's body width: 3 ≥ 600 px, 2 ≥ 380 px, else 1. Names and values wrap, never run into the next card. Test `FR-STATS-67 award grid fits` in `e2e/useful-size.e2e.ts` (400 × 412 and 320 wide; no card's `scrollWidth` > `clientWidth`). |

### 6.1 Tier B (sprint 8)

Tier A rules hold: filter, then aggregate; final roll only; names from facts; party = PCs + companions, credited to the current owner. *(OQ-STATS-NN)* = decided at DM gate 1 (#335).

| ID | Requirement |
|---|---|
| | **Kill feed** |
| FR-STATS-26 | **Events**: a damage fact `hpBefore > 0 → 0` on a non-companion monster = **kill**, on a PC or companion = **down**, whoever the attacker *(OQ-STATS-20)*. Read from the line's `fell` ([FR-CBT-152](combat-tracker.md#6-functional-requirements)). |
| FR-STATS-27 | **Text** (the line's names): "Thorn finished Goblin 1" / "Goblin 1 falls"; "Goblin 2 dropped Brakka" / "Brakka is down"; a callout starts "Overkill! ". DM adds ", overkill 23" and "(hidden)"; players never get an amount. |
| FR-STATS-28 | **Toast** `stats-feed-toast`, **callout** class ([FR-NOTE-50](notifications.md#6-functional-requirements)), 4 s *(OQ-STATS-21)*. Live frames only: a new line with `fell` or `callout`, not undone. One per frame (≤ 3 lines, then "and N more"), one listener per client (BL-71). Dropped while paused (S10). |
| FR-STATS-29 | **Visibility**: only lines the hub sent (a hidden side → DM only, FR-CBT-24). Snapshots, resyncs, undo / supersede upserts never toast. |
| FR-STATS-30 | **Preference** "Kill feed" (per browser, both clients, default on; Preferences sections, append). |
| | **Fight summary** |
| FR-STATS-31 | **Highlights** (fight ack `highlights`; players party only): MVP (most Dealt), Biggest hit, Biggest overkill (per role, FR-STATS-12), Most healing, Kills / Downs in order (by `fell`, as the feed; Times downed stays PCs only), Nat 20s / 1s (FR-STATS-32), Rounds, Duration. DM adds monsters, hidden marks, **Still standing**. Ties ≤ 8. |
| FR-STATS-32 | **A fight's rolls** = in the `n` span `startedAt…endedAt` (now while started): entries with its `encounterId`, plus `attack` / `saving-throw` rolls by its combatants' actors (no checks, skills or other). |
| FR-STATS-33 | **At End**: combat's `ended` rule hook ([FR-CBT-153](combat-tracker.md#6-functional-requirements)) runs one indexed existence query (no Highlights build) and notifies `stats-fight-summary` ([FR-NOTE-68](notifications.md#6-functional-requirements)) in `cbt.end`'s transaction. Audience `all` if the fight has a counted public fact, else `dm`; nothing counted → none *(OQ-STATS-27)*. |
| FR-STATS-34 | **Summary opens**: a live notification opens `stats.board` `by: "feature"` on that fight, Highlights open, via the ladder *(OQ-STATS-28)*. Preference "Open the fight summary at End" (default on). History **Open** does the same. DM: after FR-CBT-60. Paused players: deferred to resume (S10). |
| FR-STATS-35 | **Hidden at End**: players' Highlights never name a hidden monster, count survivors or say "victory" *(OQ-STATS-29)*. |
| FR-STATS-36 | **UI**: `stats-highlights` (`data-state`) above the Fight table; items `stats-highlight` + `data-record-id` = the FR-STATS-31 key (`mvp`, `biggest-hit`, …, `standing`); empty → hidden. Closed on a started fight. The first 4 lines fit the useful 400 × 360 (S5). |
| | **Luck tracker** |
| FR-STATS-37 | **Counted rolls**: counted (FR-STATS-02), character actor, not `initiative`, ≥ 1 d20; physical, macro, request and DM-on-behalf rolls too *(OQ-STATS-25)*. Players: public entries only; a hidden request answer is DM-only, even for its roller (S6; awards, trophies too). |
| FR-STATS-38 | **Formulas**: the table below *(OQ-STATS-26)*. |
| FR-STATS-39 | **Rows**: party characters with ≥ 1 counted roll, by name. DM also `dm-dice`: d20 rolls by the DM, **unowned** monsters and token actors, hidden included *(OQ-STATS-24)*. A player's roll with no character ("Me") counts nowhere; nor does a roll by an **owned** creature (pet / summon / companion, ADR-0056) (integrator ruling, SB0). |
| FR-STATS-40 | **Scopes**: one session (FR-STATS-13's picker, default the newest) or Campaign. |
| FR-STATS-41 | **UI**: tab **Luck** (`stats-luck`): `stats-luck-scope`, `stats-luck-table` of `stats-luck-row` (`data-record-id` = character id / `dm-dice`): Name, Rolls, d20s, Avg, Nat 20, Nat 1. Refresh as FR-STATS-17 on a live `roll` entry. |
| | **Trophy case** |
| FR-STATS-42 | **Contents**: the Lifetime and Records rows below, campaign-wide, "—" for 0 *(OQ-STATS-22)*. |
| FR-STATS-43 | **Who**: DM any character. A player only their own (else `forbidden`), from public facts. Shown as the sheet's Trophies tab ([FR-CHARX-97](character-sheet-full.md#6-functional-requirements)) *(OQ-STATS-23)*. |
| FR-STATS-44 | **Refresh**: on tab show, then as FR-STATS-17 on a live line of the character or their companions. |
| | **Read path and cost** |
| FR-STATS-45 | `stats.query` gains `luck {n? \| campaign: true}` and `trophies {characterId}`; fight acks gain `highlights`. Same pipeline, rate limit and memo (FR-STATS-16); unknown → `not_found`. |
| FR-STATS-46 | **Campaign = session partials** ([ADR](../architecture/adr/0062-stats-session-partials.md), accepted #335) *(OQ-STATS-30)*: in-memory tallies per (session, viewer class, features), **built at start** (and after a drop-all) in yielding 5-session chunks. Newest session recomputed; dropped per touched session, all on owner / kind / feature changes. **Until ready**: the rest read uncached if ≤ 5 sessions, else `{pending: true}` (re-query in 1 s). |
| FR-STATS-47 | **Player schemas** (strict): no applied, HP, overkill amount, AC, encounter name, hidden mark, Still standing or `dm-dice`. Acks are leak-scanned. |
| FR-STATS-48 | **Limits**: luck ≤ 70 rows; highlights ≤ 20 kills / downs, then "+N"; ack ≤ 64 KB. |
| FR-STATS-49 | **Retroactive** for every past fight and session; the feed is live only. Crash / reconnect / undo as FR-STATS-23. |
| FR-STATS-50 | **States**: FR-STATS-24, plus "No rolls yet" and "No fights yet". |
| FR-STATS-51 | **Bench** (100 sessions): fight + highlights ≤ 20 ms; luck, one session ≤ 50 ms; campaign warm ≤ 50 ms; the chunked build's **longest single block ≤ 50 ms**. |
| FR-STATS-52 | **BL-69** (default-fight half only; flagged at the gate): a player's default fight is the started one even before a public fact ("This fight", party rows at 0; amends FR-STATS-15). |
| FR-STATS-53 | **BL-71**: Show awards toasts and opens Stats once per client. |

### 6.2 Sprint 9 (fix pack)

| ID | Requirement |
|---|---|
| FR-STATS-68 | **The DM's feed shows hidden kills** (BL-84, sim-12 FAIL h; FR-STATS-27 / -28 unchanged).<br>• Every live line the DM receives with `fell` or `callout` shows its feed callout within 1 s. That includes hidden lines, from a card (`cbt.attack` line) or from the DM's direct damage (`hp` line), and lines that arrive while another callout shows (it replaces that one, [FR-NOTE-73](notifications.md#6-functional-requirements)).<br>• **Root cause: not confirmed.**<br>&nbsp;&nbsp;– Probe (real server, `stats-b`, DM direct 30 on the hidden Elite): `feedLinesOf(frame, "dm")` returns "Overkill! Elite Goblin Warrior falls, overkill 15 (hidden)". So the server, the frame and the feed parse work, and the unit `feed.test.tsx` hidden case passes. The loss is downstream.<br>&nbsp;&nbsp;– Hypothesis 1: the callout replaced one already showing in the same unkeyed node, which the sim recorder (each node once) can't see. FR-NOTE-73 fixes both.<br>&nbsp;&nbsp;– Hypothesis 2: the show path (`onStatsFrame` → `showFeedToast` → `showCallout`).<br>• Hypothesis 3 (review-b ruling 13): a hidden card Apply reaches the DM as an **upsert of the existing attack line** (or a `dmPayload` change) rather than a new line, and FR-STATS-28's "a new line" rule drops it.<br>• **Amends FR-STATS-28:** a line toasts the first time this page sees it carry `fell` or `callout`, whether as a new line or as an upsert of one it already held. Undo and supersede upserts still never toast, and a line toasts once.<br>• The builder reproduces sim-12 step h first, at 1440×900 with a content recorder, covering **both paths** (the DM's direct `hp` line, the card-Apply upsert), and writes down which cause it was. |
| FR-STATS-69 | **A query limit is per viewer; the client retries it quietly** (BL-74; amends FR-STATS-16's "per connection; the excess is coalesced into the next"; review-b ruling 18).<br>• The ≤ 4 / s limit is **per viewer** (role + player, all their tabs): the sprint-7 integrator pick in [#327](../decisions-log.md) ("per-actor (not per-connection) rate limit"), and the [protocol](../protocol/README.md) `stats.query` row's "an actor's 5th computed answer". Commands see no connection.<br>• **Server outcome, unchanged:** an over-limit query whose input has a memo gets that memo; one with no memo is answered **`conflict`** "Too many stats queries", **not coalesced**.<br>• Client: a `stats.query` answered `conflict` keeps the last result shown (no error state) and asks again once, 1 s later, with the latest input.<br>• "Couldn't load stats" shows only if that retry fails too. Server unchanged. |
| FR-STATS-70 | **No "No damage yet" beside a kill** (BL-90, sim-12 f09; amends FR-STATS-24).<br>• "No damage yet this fight" shows only when every row's numbers are 0 **and** the viewer's Highlights for the fight hold no event (kill, down, callout).<br>• Otherwise an all-zero table shows no copy and Highlights carry the fight. For players that is a fight whose damage was the DM's own or on hidden sides (OQ-STATS-01). |

**Formulas** (per character; companions rolled up, FR-STATS-09)

| Stat | Rule | Luck | Trophies |
|---|---|---|---|
| Rolls | counted rolls (FR-STATS-37) | ✓ | |
| d20s | every d20 face with a value, kept **and dropped** ([FR-DICE-89](dice-roll-log.md#6-functional-requirements)) | ✓ | |
| Avg d20 | mean of d20s, 1 decimal, "—" with none (expected 10.5) | ✓ | Lifetime |
| Nat 20s / 1s | `natural` (FR-STATS-10): set only for one kept d20 (FR-DICE-20), so a `1d20+1d20` roll adds faces, never nats | ✓ | Lifetime |
| Fights | encounters with a counted fact of theirs | | Lifetime |
| Dealt, Taken, Healing, Kills, Times downed | FR-STATS-06–08 | | Lifetime |
| Biggest hit, Biggest overkill | FR-STATS-12 per role, "→ target · fight label" | | Records |
| Best fight (damage / kills) | max over fights of Dealt / Kills, with the fight label | | Records |

## 7. UI/UX notes

- [visual-direction](../design/visual-direction.md); shadcn Table, Tabs, Select, Card, Tooltip, Toast. Window `stats.board` (FR-SHELL-93). Layout and test IDs: FR-STATS-18, -19.
- **Player view:** party rows, neutral fight labels, no Show awards; awards open by themselves.
- **DM view:** everything (FR-STATS-18).
- *(Sprint 8)* Tabs Fight · Session · Luck (fit 320 px); Highlights a Collapsible, two columns from 400 px; Luck a Table. **Player:** party only, own Trophies. **DM:** + monsters, hidden marks, Still standing, DM dice, any Trophies.

## 8. Data model

**No new entity, column or record type.** Read:

| Source (owner) | Fields | Use |
|---|---|---|
| `hp_change` (CBT) | encounterId, at, kind, attacker / target id + name, raw, applied, overkill, hpBefore, hpAfter, temp, entryId, undone | formulas |
| `game_log_entry` (DICE) | n, at, kind, public, undone, rollIds, encounterId, supersededBy, payload.callout | filter, sessions, callout |
| `roll` (DICE) | id, actorKind, actorId, category, natural | nat counts |
| `combatant`, `encounter`, `entity` | kind, owner, hidden, name; status, times | rows, labels |

- **Relations:** `hp_change` → combatants, entry; entry → rolls. Roll → character.
- **Added (CBT):** line `callout` / `dmPayload.overkill`; `cbt.applyHp sourceId` → `attackerId`.
- **Derived:** all stats, sessions, labels. **Persisted runtime state:** none (server cache; client view state).
- *(Sprint 8)* Nothing new stored for stats. Added: line `payload.fell?: "kill" | "down"` (FR-CBT-152), `stats-fight-summary` rows (FR-NOTE-68). Also read: `roll.dice` d20 faces, `manual` (FR-DICE-89), `encounter.startedAt` / `endedAt`. Server memory: partials (FR-STATS-46). Client: two preferences.

## 9. API & events

| Intent | Who | Validation | Ack |
|---|---|---|---|
| `stats.query {scope: "fight", encounterId?}` | DM, player | active campaign; player: a fight with a public fact | `{fight: {key, label, round, status, rows}}` (`label` = name for the DM) |
| `stats.query {scope: "session", n?}` | DM, player | `n` inside a session the viewer can list | `{session: {fromN, toN, from, to, fights, awards}}` |
| `stats.query {scope: "sessions"}` | DM, player | none | `{sessions: [{fromN, toN, from, to, fights}]}` |
| `stats.showAwards {fromN}` | DM | a session key | `{notificationId}` |

- `Row` / `Award` per role (FR-STATS-05). **Events:** none new; `stats-awards` notification to all; outcome lines carry `callout` (public) and amounts in `dmPayload` (DM).

*(Sprint 8)*

| Intent / event | Who | Validation | Ack / visibility |
|---|---|---|---|
| `stats.query {scope: "fight", …}` | DM, player | as above | + `highlights` per role |
| `stats.query {scope: "luck", n? \| campaign: true}` | DM, player | `n` in a listed session | `{luck: {scope, fromN?, rows}}`; DM + `dm-dice` |
| `stats.query {scope: "trophies", characterId}` | DM; player, own | else `forbidden` | `{trophies: {characterId, lifetime, records}}` per role |
| Line `fell` (existing upsert) | — | at apply | DM all; players public lines (the band already reads "down") + a companion owner's audience lines |
| `NotificationCreated` `stats-fight-summary` (in `cbt.end`) | hook | FR-STATS-33 | DM always; players only for audience `all`; payload `{encounterId}` (already public, #327) |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Query | ✓ all facts | ✓ public facts | role from the connection; zod; rate limit |
| Show awards | ✓ | ✗ | `forbidden` |
| Change stats | ✗ | ✗ | no such command |
| *(S8)* Trophies | ✓ any character | ✓ own | owner check → `forbidden` |

## 11. Edge cases & failure modes

- Disconnect / reconnect (DM, player), server crash, concurrent undo, renames: FR-STATS-23. Invalid input / spam: FR-STATS-16. DM-hidden attack lines leave players' numbers empty, by design (OQ-STATS-01). Multi-target: one row per target. A fight across two sessions splits rows by `at`.
- *(Sprint 8)* A missed frame never toasts; after End, a reconnect shows the summary in history (no auto-open). A crash loses no `fell` or summary row (same transaction); partials rebuild. A revive + kill toasts again; a charm-away moves trophies (OQ-STATS-12).

## 12. Performance & bandwidth

Throwaway probe (deleted), `session-sim` + `buildRealisticHeavy`:

- Snapshot: callout fields on all 30 lines (worst) +1,461 B DM / +630 B per player; `stats-awards` row 575 B inside the closed window (no growth).
- **Cumulative worst, GM + ST** (GM's 935,356 B run): **DM ≈ 942 KB of 1.5 MiB; players ≈ 299 KB of 512 KiB**.

Compute (a synthetic session = 4 fights × 80 applies + 300 rolls; medians of 7):

| History | Fight (DM / player) | One session | Session list (cold) |
|---|---|---|---|
| 1 session | 0.55 / 0.47 ms | 6.3 ms | 3 ms |
| 10 sessions | 0.40 / 0.38 ms | 7.3 ms | 12 ms |
| 100 sessions (94k entries) | 0.37 / 0.69 ms | 5.4–6.0 ms | 103 ms, warmed at start |

- **Bench gates** (`stats.bench.ts`, 100 sessions): fight ≤ 20 ms, session ≤ 50 ms, list cold ≤ 300 / warm ≤ 5 ms.

**Sprint 8** (throwaway probe, deleted): heavy harness + gems on, then the bench's history (a session ≈ a 4-hour sitting: 4 fights × 80 applies, 300 rolls, 300 lines). Medians of 7.

- **CON-44:** `fell` +14 B a line (+420 B per viewer for 30 lines; worst ≈ +1.4 KB). A summary row: 536 B, inside the 100-closed window (no growth). **DM ≈ 944 KB of 1.5 MiB; players ≈ 301 KB of 512 KiB.**
- **Per event:** +14 B a kill. End: one `NotificationCreated` (≈ 0.6 KB) + a fight ack per client (DM 1.8 / player 0.55 KB).

| Compute (DM / player) | 1 session | 10 sessions | 100 sessions |
|---|---|---|---|
| Fight + its rolls | 1.1 ms | 1.0 ms | 1.5 ms |
| Luck, one session | 2 ms | 2 ms | 7–10 ms |
| Luck, campaign (one pass) | 1.7 / 1.5 ms | 18 / 14 ms | 404–449 / 289–299 ms |
| Trophies, campaign (one pass) | 3.6 / 3.0 ms | 30 / 25 ms | 538 / 417–430 ms |
| Partials, warm (newest session) | 3.3 ms | 4.8 ms | 18.5 ms |

- **Why partials:** ≈ 1 s per campaign answer, after every fact.
- **Chunked build** (re-measured; 100 sessions, DM / player): 1-session chunks peak 32 / 24 ms (1.9 s total); **5-session: 42 / 38 ms peak, 0.74 / 0.66 s total**; 10-session: 104 / 58 ms peak.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

**Fixtures** in `fixtures/units/stats/`; bundle **`stats`** = `session-sim-10` + both units; e2e alias **`stats-e2e`**.
- **`st-past-crypt`** (joins session-sim-11, S13): an ended "Old Crypt": Thorn vs 2 Skeletons, one overkill, Mira downed, a public nat 20.
- **`st-ambush-facts`**: manual dice on sim-10's Goblin Ambush. The header lists the expected DM and player numbers.
  - Thorn: nat 20, 30 on Goblin 1 at 7 HP (callout).
  - Mira: nat 1, a miss.
  - Brakka heals Mira 8 with From set (3 below max).
  - Goblin 2 downs Brakka.
  - The hidden Elite hits Thorn for 9.
  - A hidden DM roll as Thorn: nat 20.
  - Apply hit, then late damage 11.
  - An override from 6 to 12.
  - One undone apply.
  - The Owlbear kills Goblin 3.
- All fixture facts share the fixed clock (FR-FIX-08): the bundle is one past session. Multi-sitting cases inject the clock.

Named tests (all `FR-STATS-NN …`):
- **Unit:** 06 raw dealt / taken; 07 heal raw, overheal, unattributed; 08 kill, down, revive; 08 overkill with absorbed temp; 10 nat rules; 11 maxed die via raw; 12 ties and zero; 12 overkill value per role; 13 6 h gap; 21 threshold; 25 limits.
- **Integration (`stats`):** 02 undone excluded; 02 final roll only; 03 public only, same for all players; 03 tagged kinds skipped while off; 04 hidden roll / monster never counted for players; 04 ended summon still named; 05 leak scan per player (no `raw − value`, no encounter name); 06 override; 06 apply hit + late damage once; 09 companion roll-up; 09 charmed-away companion moves to monsters; 13 retroactive session (injected clock); 13 any `n` resolves; 14 cache warmed and extended; 15 default fight, player label, no planned / fact-less fight; 16 read-only; 16 rate limit coalesces; 16 hard kill → same results; 20 show awards notifies all; `FR-STATS-20 awards open for a player when the session starts hidden`; 23 old rows parse.
- **Client:** 17 refresh (debounce, encounter filter, snapshot, minimised); 18 fight rows; 19 session cards, DM-only button; 22 toast live-only, not undone; 24 states.
- **E2E (`stats-e2e`):** an overkill updates both Fight tabs ≤ 2 s and toasts Player 2; Show awards opens Player 1's Stats. **Bench:** §12 gates.

**Browser walkthrough** (bundle `stats`, verify profile, contexts `dm`, `player-1`, `player-2`, 1440×900):
1. All three open Stats. The DM sees the unit's numbers and names (Elite eye-off, "DM (direct)"). The players see party rows with player numbers (Thorn's Taken 9 lower) and "Fight N" labels.
2. DM: Thorn applies 40 to Goblin 4 at ≤ 10 HP → "— Overkill!" and toasts (the DM's with "+N over M HP"). Tables update ≤ 2 s.
3. DM Undo → the line is struck and the 40 drops out. Re-apply.
4. Player 2: no HP, AC, hidden or encounter name (leak-scan helper).
5. Session tab: the bundle session and **Today**. Bundle awards match the unit; Thorn's nat 20s are 1 higher for the DM.
6. End, then Show awards (Today): both players get a toast and Stats opens. Biggest hit is Thorn's 40. **Biggest overkill: the DM sees Thorn's overkill amount, the players see "40" (Thorn's callout line raw).**
7. Reloads, then a hard kill + restart: same numbers (`state:digest` equal).

### 13.1 Sprint 8 (tier B)

**Fixtures** (`fixtures/units/stats/`; headers list expected numbers per bundle). `sb-fight-facts` and `sb-luck-rolls` **join session-sim-12** (S15), so they are sim-11-safe: no `gems-on` or `st-ambush-facts`, Goblin / Goblin 2 untouched.
- **`sb-fight-facts`** (requires `combat-1`, `cp-combat`, `char-mira`, `char-thorn`, `char-brakka`): adds 4 token-less Bandits (11 HP) and a hidden Bandit Captain.
  - Mira kills Bandit 1 (25: callout, overkill 14).
  - Thorn kills the hidden Captain.
  - The Owlbear kills Bandit 3 (companion).
  - Bandit 2 drops Thorn (200), then the DM heals him 10.
  - Thorn → Bandit 4, 11, undone: Bandit 4 stays at 11 HP, a live target.
- **`sb-luck-rolls`** (requires `char-mira`, `char-thorn`; manual dice, so all physical):
  - Mira: advantage 18 / 3; a nat 20; an initiative nat 20 (not counted).
  - Thorn: a save nat 1; a death-save nat 20.
  - DM: a hidden roll as Thorn, nat 20; a Bandit nat 20 (DM dice).
  - Player 1: a "Me" nat 20 (counts nowhere).
- **`sb-luck-reroll`** (requires `gems-on`, `sb-luck-rolls`; **`stats-b` only**, not session-sim-12): Mira's Perception 4 rerolled to 17.
- **Bundle `stats-b`** = `stats` + `gems-on` + the three units (the fixed-clock past session + live "Today"); e2e alias `stats-b-e2e`.

**Named tests** (`FR-STATS-NN …`):
- **Unit:** 26, 27 per role, 28, 31 per role, 32, 38 every formula row, 39, 42 companion roll-up, 48.
- **Integration:**
  - Fixtures: `stats-b` and **session-sim-12 load from empty** (`stats.fixtures.test.ts`; TT / CB units are noted by the integrator).
  - 29 hidden-side kill: no `fell` reaches players.
  - 33 audience `all` / `dm` / none; a throwing hook rolls End back.
  - 35 players' highlights never name the Wolf.
  - 37 initiative out; reroll final only; a hidden request answer counts for the DM only, not for its roller (S6).
  - 40 scopes; 43 another's trophies → `forbidden`.
  - 46 partials: chunked start build; queries before ready; an old undo, a charm-away and a feature switch match a cold recompute.
  - 47 **leak scan per player**.
  - 49 three sittings (injected clock); 52 default fight.
  - Hard kill → same numbers.
- **Client:** 28 live only, once with Stats open, dropped while paused; 30 / 34 preferences; 34 opens `by: "feature"`, after Initiative minimises (DM), deferred while paused, history Open after reload; 36; 41; 50; 53.
- **E2E (`stats-b-e2e`):** one kill toast on DM + Player 2; End opens Highlights on both; Player 1's Trophies. **Bench:** FR-STATS-51.

**Browser walkthrough** (bundle `stats-b`, verify profile, contexts `dm`, `player-1`, `player-2`, 1440×900; step 6 also at DM **and** player-1 1280×720):
1. All open Stats → Luck · Campaign. The DM's Thorn nat 20s are **2 higher** (two hidden rolls). Only the DM has "DM dice". Mira's d20s include the dropped 3; the reroll counts 17; the "Me" nat 20 counts nowhere.
2. Thorn applies 25 to **Bandit 4** (11 HP): **one** toast per client ("Overkill! Thorn finished Bandit 4"; the DM's adds ", overkill 14").
3. DM kills the hidden Elite: the DM's toast reads "(hidden)"; players get nothing (frames).
4. Heal Brakka 20 (he is down), then Bandit 2 → Brakka 200: "Bandit 2 dropped Brakka" on all three. Mira's card on Goblin Scout 2 + Bandit 2, 30 each: one toast, both names.
5. Undo that apply: no toast. Re-apply: a toast.
6. **End**: "Fight summary" on all three. Stats opens with Highlights, clear of PCs at 1280×720 (DM and player-1, companion card open). Players' Kills omit the Elite and the Captain; the DM sees Still standing.
7. Player 2 leak scan over frames and acks.
8. Mira's Trophies for Player 1, per the units' headers (incl. the Old Crypt). Thorn's for the DM (both hidden nat 20s count). Nothing on Player 2's summary card; a raw intent → `forbidden`.
9. Player 2 turns Kill feed off: no toast for them.
10. Reload, then history Open: same numbers. Hard kill + restart: `state:digest` equal.

### 13.2 Sprint 9 (fix pack)

- **Client integration, `feed.test.tsx`.** `FR-STATS-68 hidden kill reaches the DM's feed`:
  - Real frames come from the test harness on `stats-b`: Thorn's card kills the hidden Elite (`cbt.attack` line), and DM direct damage kills the hidden Wolf (`hp` line). They go through `onStatsFrame` into a mounted `ToastRuntime`.
  - **Card-Apply upsert case:** the hidden Elite's attack line first arrives without `fell` (the roll), then as an upsert carrying `fell` (the Apply) → exactly one toast, on the upsert.
  - Each shows a visible `stats-feed-line` with "(hidden)": once with no callout showing, once while one shows (a new `data-callout-seq`). An undo upsert of the same line → none.
  - Players' frames give none.
- **Client, `refresh.test.ts`.** `FR-STATS-69 conflict retried quietly`: a `conflict` keeps the last result, re-asks once 1 s later with the latest input, and shows no error. A second `conflict` → "Couldn't load stats" + Retry.
- **Server, `stats.test.ts`.** `FR-STATS-16 rate limit coalesces` is reworded "per viewer"; its cases are unchanged.
- **Client, `logic.test.ts`.** `FR-STATS-70 no "No damage yet" beside a kill`: zero rows + a kill highlight → no copy; zero rows and no highlight → the copy. `render.test.tsx` gets the same case.
- Walkthrough: [notifications §13 FX1](notifications.md#13-test-plan) steps 5–8. Bundles: `session-sim-12`, `stats-b` (tests). E2E: none new (FR-STATS-68's outcome is in FX1's walkthrough).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [combat-tracker](combat-tracker.md) FR-CBT-136–138 | From, callout, helper | this track |
| [dice-roll-log](dice-roll-log.md) FR-DICE-62–67, -72–73 | supersede (GM); read rules | GM0 / GM1 |
| [gems](gems.md) | feature tag (S1) | settled |
| [play-shell](play-shell.md) FR-SHELL-86, -93–94 | window | after FU1 |
| [notifications](notifications.md) FR-NOTE-48–49 | kind, toast | this track |
| Libraries | **none** (no chart in tier A) | — |

**Build split** (S3–S5)

- **ST-core** (ST0 server + ST1 CBT lines): `features/stats/*`, `shared/stats/*`, `stats-read.ts` ×2 (new), `combat-tracker/hp.ts`, CBT line kinds; ⚠ appends to `features/index.ts`, `notifications/kinds.ts`, `bundles/index.ts`, the `package.json` bench list. **After GM0**, no schema; parallel with GM1, **GM1 merges first**; GM2 after both.
- **ST2** `build/st-window`: `@ui/features/stats/*`; ⚠ appends to `windows.ts` ×2, `notification-views.ts` ×2; golden + size rows. **After FU1 + ST-core.**

**Sprint 8.** Needs FR-CBT-152–153, FR-DICE-89–90, FR-NOTE-68–69, FR-CHARX-97–99 (this track) and WF1 + WF4 (placer, toast classes). TT and CB: nothing beyond seams S6, S8. **Libraries: none** (Luck is a table; no chart).

| Slice | Files | ⚠ Shared (AGENTS §9.9) | Order |
|---|---|---|---|
| **SB0** `build/sb-core` | `features/stats/*`, `shared/stats/*`, both `stats-read.ts`, `combat-tracker/hp.ts` + `@shared/combat-tracker/log-kinds.ts` (`fell`), `stats.bench.ts`, `fixtures/units/stats/sb-*` | appends: `rule-hooks.ts`, `notifications/kinds.ts`, `bundles/index.ts` | wave 1, ∥ WF1 / TT0 / CB0; no schema, no `lifecycle.ts` |
| **SB1** `build/sb-stats-ui` | `@ui/features/stats/*` (feed, Highlights, Luck, End open) | appends: `notification-views.ts` ×2, `pref-sections.ts` ×2 | after SB0 + WF1 + WF4 |
| **SB2** `build/sb-trophies` | `@ui/features/stats/trophies/*` | append: `sheet-sections.ts` (`order: 100`) | after SB0 + WF1 + WF4; ∥ SB1 (or one builder, one walkthrough) |

**Sprint 9 (track FX).** FR-STATS-68–70 go in **FX1** `fix/fx-toasts-feed`, with [notifications](notifications.md#14-dependencies) FR-NOTE-70–73: one builder and one walkthrough.
- Files: `@ui/features/stats/{feed.ts, runtime.tsx, query.ts, refresh.ts, StatsWindow.tsx, logic.ts}` and their tests. Server: none (FR-STATS-16's test wording only).
- Shared: none. Docs: the protocol `stats.query` row gets "per viewer; client retries" (written with FX1).
- **Stats client files have one holder at a time** (seams S7): FX1 first, then SP3's stats edits.
- *(If OQ-FIX-21 A)* [FR-FIX-29](fixtures-adapters.md#6-functional-requirements) (BL-69, seams S13) also lands in FX1: `server/features/fixtures-adapters/loader.ts` (`now`) and test. ⚠ `scripts/fixtures.ts` is shared tooling (AGENTS §9.9): one line passing the load start, `shared change needed`.
- Order (seams S5, S10): FX1 builds in wave 3 and merges **after PM1**.

## 15. Open questions

**Bold** = pick. All decided at DM gate 1 (#315): every bold pick accepted.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-STATS-01 | Who sees which stats? | **Decided (#315): A** · **A. DM all; players the same numbers from public lines** (zero-leak; thin if attacks are hidden) · B. + own-audience lines (differs per player) · C. DM-only | — | STATS, DICE |
| OQ-STATS-02 | Leaderboard where? | **Decided (#315): A** · **A. Stats window, live** · B. Initiative footer (steals rows) · C. End-of-combat popup (tier B) | — | SHELL |
| OQ-STATS-03 | Callout form | **Decided (#315): A** · **A. Toast + line** · B. Line only (quiet) | — | CBT, NOTE |
| OQ-STATS-04 | Players and monster overkill | **Decided (#315): A** · **A. "Overkill!" + public damage, no number** (but a callout bounds HP: needed ≤ min(raw − 10, raw / 2), finer than the band) · B. The amount (exact HP) · C. DM-only (no bound) | — | CBT |
| OQ-STATS-05 | Callout threshold | **Decided (#315): A** · **A. ≥ max(10, needed)** (rare) · B. any ≥ 10 (frequent) | — | STATS |
| OQ-STATS-06 | "Dealt" = ? | **Decided (#315): A** · **A. The log number; DM also Effective** · B. Effective (leaks HP) · C. Rolled, before overrides | — | STATS, CBT |
| OQ-STATS-07 | Overheal | **Decided (#315): A** · **A. Counts (log number)** · B. Effective only (fairer) | — | STATS |
| OQ-STATS-08 | Heal credit (none today) | **Decided (#315): A** · **A. From on direct heal, preset turn combatant** · B. Healing-category rolls (unapplied heals count) · C. Drop the award | — | CBT |
| OQ-STATS-09 | What is a session? | **Decided (#315): A** · **A. Derived ≥ 6 h log gap** (ADR-0013 holds, retroactive) · B. "End session" marker (supersedes ADR-0013) · C. The DM picks a range | — | STATS |
| OQ-STATS-10 | When do awards show? | **Decided (#315): A** · **A. Show awards opens everyone's Stats** · B. No push (quieter) | — | NOTE |
| OQ-STATS-11 | Monsters on players' board? | **Decided (#315): A** · **A. Party only (DM all)** · B. Visible monsters (busier) | — | STATS |
| OQ-STATS-12 | Companion credit | **Decided (#315): A** · **A. Rolled into the current owner** (a charmed-away companion's past glory leaves its old owner: accepted) · B. Own winners | — | STATS |
| OQ-STATS-13 | Retroactive? | **Decided (#315): A** · **A. All history** (free) · B. From release | — | STATS |
| OQ-STATS-15 | Which kills count? | **Decided (#315): A** · **A. Any monster to 0, again after a revive** (simple) · B. Enemies, once per fight | — | STATS |
| OQ-STATS-16 | Out-of-combat HP | **Decided (#315): A** · **A. Not counted** (no source) · B. Downs from `CharacterHpAdjusted` | — | STATS |
| OQ-STATS-18 | Glossary: Stats window, Session awards, Overkill callout; Session "derived" | **Resolved (integrator, sprint-7 seams / rulings)** · **A. Add** | — | glossary |
| OQ-STATS-19 | Encounter names in players' stats? | **Decided (#315): A** · **A. Neutral "Fight 3 · Tue 20 Oct"** (names stay DM-only) · B. Real names (reveals names players never saw) | — | STATS |
| ~~OQ-STATS-35~~ | SB seam: end-of-combat summary | **Resolved (integrator, sprint-8 seams / rulings)**: seams S5: a `stats.board` view opened `by: "feature"` at End, placed by the ladder; its toast is info class | — | FR-SHELL-112 |

**Resolved (integrator, sprint-7 seams / rulings)**: ~~OQ-STATS-14~~ (S2: final roll only, maxed die via `raw`), ~~OQ-STATS-17~~ (S5: [FR-SHELL-86](play-shell.md#6-functional-requirements), 400 × 412, min 320 × 280).

**Sprint 8 (track SB).** All decided at DM gate 1 (#335): every bold pick accepted.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-STATS-20 | Kill feed: which kills? | **Decided (#335): A** · **A. Every kill and party down the viewer sees**: one rule, busier · B. Party kills + downs: DM kills silent · C. Party kills only | no | STATS, CBT |
| OQ-STATS-21 | Toast or log line? | **Decided (#335): A** · **A. Toast; the line gains a hidden `fell`**: no log noise · B. + "— falls" in the line · C. A notification kind: fills history · D. Line only: easy to miss | no | STATS, NOTE, CBT |
| OQ-STATS-22 | Trophy contents | **Decided (#335): A** · **A. Lifetime + records (§6.1 table)** · B. A + session awards won: more compute · C. Three lines: little to browse | no | STATS, CHARX |
| OQ-STATS-23 | Trophies: where, who? | **Decided (#335): A** · **A. Sheet tab; owner + DM**: private · B. A + a line on others' summary cards · C. Stats tab for everyone | no | STATS, CHARX |
| OQ-STATS-24 | Luck: who sees? | **Decided (#335): A** · **A. Everyone, from public rolls (DM all + DM dice)**: fun, zero leak · B. Own characters only: differs per player · C. DM only | no | STATS |
| OQ-STATS-25 | Luck: which rolls? | **Decided (#335): A** · **A. FR-STATS-37 (the awards' rule)** · B. Attack / save / check only · C. A minus physical | no | STATS, DICE |
| OQ-STATS-26 | Average of which faces? | **Decided (#335): A** · **A. Every d20 face, dropped too**: true luck, advantage-neutral · B. Kept die only: matches log markers, advantage inflates it | no | STATS |
| OQ-STATS-27 | Summary: when, for whom? | **Decided (#335): A** · **A. Automatic at End for everyone**: no clicks · B. DM auto + Share: DM's moment · C. On demand | no | STATS, CBT, NOTE |
| OQ-STATS-28 | Summary surface | **Decided (#335): A** · **A. Stats window with Highlights** · B. A centred dialog: blocks play · C. A card toast: too small | no | STATS, SHELL |
| OQ-STATS-29 | End with hidden monsters | **Decided (#335): A** · **A. Public facts only; no survivors / "victory"; DM sees Still standing** · B. No players' summary while a hidden monster has HP: missed summaries | no | STATS |
| OQ-STATS-30 | Campaign numbers (≈ 1 s at 100 sessions) | **Decided (#335): A** · **A. Session partials ([ADR](../architecture/adr/0062-stats-session-partials.md))**: ≈ 25 ms warm · B. Compute each time · C. Tables: schema, drift | no | STATS |
| OQ-STATS-31 | Glossary: Kill feed, Fight summary (Highlights), Luck tracker, Trophy case | **Resolved (integrator, sprint-8 seams / rulings)** · **A. Add** | no (integrator, S16) | glossary |
| OQ-STATS-36 | *(Sprint 9, BL-69 dates half)* The fixture-started fight reads "Fight 3 · Thu 1 Jan" and "Duration 7074 h 18 min". Cause (code read): the seeded clock is the fixed `FIXTURE_INSTANT` 2026-01-01 (`commands/context.ts`, FR-FIX-08). The fight's `startedAt` comes from the fixture, but its live lines and End use real time, and the label and duration read `startedAt` (`rules.ts` `neutralFightLabel`, `rules-b.ts`). | **Moved to [OQ-FIX-21](fixtures-adapters.md#15-open-questions)** (DM, gate 1; review-b ruling 4: an ADR-0022 amendment, [proposed ADR](../architecture/adr/proposed-s9-fx-load-clock.md)). Under A it is [FR-FIX-29](fixtures-adapters.md#6-functional-requirements) (CLI loads anchor at load time, minute; tests and e2e keep the fixed instant). Options as first written: · **A. Fixtures anchor the seeded clock at the load** (`bun test` keeps the fixed instant unless a test passes `now`; amends FR-FIX-08). Fixes the root, but loads on different days differ. · B. Stats takes the label and duration from the fight's first counted fact and shows "—" over 24 h: no fixture change, but it hides the date half rather than fixing it. · C. Drop it as a fixture-only artefact: real play never mixes clocks. | no (→ OQ-FIX-21, DM) | STATS, FIX |

**Resolved (integrator, sprint-8 seams / rulings)**: ~~OQ-STATS-32~~ (S4 / S5: feed = callout class; summary = `stats.board` via the ladder), ~~OQ-STATS-33~~ (S6: counted iff the entry is public), ~~OQ-STATS-34~~ (S8: no `lifecycle.ts`).

## 16. Out of scope

- XP, charts, export, party-wide records, session records ([campaign-manager](post-mvp/campaign-manager.md)).
