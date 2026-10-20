---
title: Stats and summaries
prefix: STATS
status: in-review
owner: spec-stats
phase: post-mvp-7
---

# Stats and summaries

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Promoted from the post-MVP stub (the integrator moves it).

> **Sprint 7, track ST** (DM [#311](../decisions-log.md), decided): tier A of [feature tiers](../feature-tiers.md#6-table-specific), meaning a live damage leaderboard, overkill callouts and BG2-style session awards. They come from the append-only log ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)) and never leak; sessions follow [ADR-0013](../architecture/adr/0013-session-journal-scope.md). Proposed ADR: [stats as read models](../architecture/adr/proposed-s7-st-stats-read-models.md). Also revised: FR-CBT-136–138, FR-DICE-72–73, FR-SHELL-93–94, FR-NOTE-48–49. Seams S1–S8, S11, S13 and review rulings 2–4, 10, 13, 20–25 applied.

## 1. Summary

- A **Stats** window (both clients): **Fight** = a live leaderboard; **Session** = 9 awards and the DM's **Show awards**.
- **Overkill callouts**: "— Overkill!" on the line, and a toast.
- **Computed on read** from facts already written, filtered per viewer **before** aggregation; nothing in the snapshot.
- Combat-tracker gains a **From** on direct heals (FR-CBT-136).

## 2. Scope

- Live and past fights and sessions, callouts, awards.

## 3. Goals

- An overkill reaches every screen in ≤ 1 s. Awards take one click.
- Zero leaks to players (FR-STATS-05).
- All history works, with no backfill.
- Cheap (§12).

## 4. Non-goals

- Tier B (§16), and out-of-combat HP (`char.adjustHp`, `pet.adjustHp`): there's no combat log entry for it.
- A "gems spent" award (seam S2), charts, editing stats.

## 5. User stories

- **DM:** a live damage table to pace fights; one **Show awards** at the end of the night; my hidden rolls and monsters count only for me.
- **Player:** watch my damage and kills climb, see "Overkill!", look back at last session's awards.

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
| FR-STATS-22 | **Callout toast** `stats-overkill-toast` (4 s), from **live** frames only: a `cbt.attack` upsert with `callout`, not undone. Players: "Overkill! Thorn → Goblin 1: 30 damage"; the DM adds "(+23 over 7 HP)". One per frame. An info toast, not a notification (FR-NOTE-49). |
| FR-STATS-23 | **Retroactive, stateless**: no backfill. A crash loses only an answer; reconnect → re-query (last result muted). Undo → re-query drops the row. Old facts keep old names. |
| FR-STATS-24 | **States**: skeleton rows; "No fight yet" / "No damage yet this fight" / "No sessions yet"; "Couldn't load stats" + Retry; offline = last result muted, pickers off. |
| FR-STATS-25 | **Limits**: fight ≤ 70 rows; ≤ 8 tied names; `sessions` ≤ 200 newest; ack ≤ 64 KB. |

## 7. UI/UX notes

- [visual-direction](../design/visual-direction.md); shadcn Table, Tabs, Select, Card, Tooltip, Toast. Window `stats.board` (FR-SHELL-93). Layout and test IDs: FR-STATS-18, -19.
- **Player view:** party rows, neutral fight labels, no Show awards; awards open by themselves.
- **DM view:** everything (FR-STATS-18).

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

## 9. API & events

| Intent | Who | Validation | Ack |
|---|---|---|---|
| `stats.query {scope: "fight", encounterId?}` | DM, player | active campaign; player: a fight with a public fact | `{fight: {key, label, round, status, rows}}` (`label` = name for the DM) |
| `stats.query {scope: "session", n?}` | DM, player | `n` inside a session the viewer can list | `{session: {fromN, toN, from, to, fights, awards}}` |
| `stats.query {scope: "sessions"}` | DM, player | none | `{sessions: [{fromN, toN, from, to, fights}]}` |
| `stats.showAwards {fromN}` | DM | a session key | `{notificationId}` |

- `Row` / `Award` per role (FR-STATS-05). **Events:** none new; `stats-awards` notification to all; outcome lines carry `callout` (public) and amounts in `dmPayload` (DM).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Query | ✓ all facts | ✓ public facts | role from the connection; zod; rate limit |
| Show awards | ✓ | ✗ | `forbidden` |
| Change stats | ✗ | ✗ | no such command |

## 11. Edge cases & failure modes

- Disconnect / reconnect (DM, player), server crash, concurrent undo, renames: FR-STATS-23. Invalid input / spam: FR-STATS-16. DM-hidden attack lines leave players' numbers empty, by design (OQ-STATS-01). Multi-target: one row per target. A fight across two sessions splits rows by `at`.

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

## 15. Open questions

**Bold** = pick. DM questions unless marked.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-STATS-01 | Who sees which stats? | **A. DM all; players the same numbers from public lines** (zero-leak; thin if attacks are hidden) · B. + own-audience lines (differs per player) · C. DM-only | yes | STATS, DICE |
| OQ-STATS-02 | Leaderboard where? | **A. Stats window, live** · B. Initiative footer (steals rows) · C. End-of-combat popup (tier B) | yes | SHELL |
| OQ-STATS-03 | Callout form | **A. Toast + line** · B. Line only (quiet) | no | CBT, NOTE |
| OQ-STATS-04 | Players and monster overkill | **A. "Overkill!" + public damage, no number** (but a callout bounds HP: needed ≤ min(raw − 10, raw / 2), finer than the band) · B. The amount (exact HP) · C. DM-only (no bound) | yes | CBT |
| OQ-STATS-05 | Callout threshold | **A. ≥ max(10, needed)** (rare) · B. any ≥ 10 (frequent) | no | STATS |
| OQ-STATS-06 | "Dealt" = ? | **A. The log number; DM also Effective** · B. Effective (leaks HP) · C. Rolled, before overrides | yes | STATS, CBT |
| OQ-STATS-07 | Overheal | **A. Counts (log number)** · B. Effective only (fairer) | no | STATS |
| OQ-STATS-08 | Heal credit (none today) | **A. From on direct heal, preset turn combatant** · B. Healing-category rolls (unapplied heals count) · C. Drop the award | yes | CBT |
| OQ-STATS-09 | What is a session? | **A. Derived ≥ 6 h log gap** (ADR-0013 holds, retroactive) · B. "End session" marker (supersedes ADR-0013) · C. The DM picks a range | yes | STATS |
| OQ-STATS-10 | When do awards show? | **A. Show awards opens everyone's Stats** · B. No push (quieter) | no | NOTE |
| OQ-STATS-11 | Monsters on players' board? | **A. Party only (DM all)** · B. Visible monsters (busier) | no | STATS |
| OQ-STATS-12 | Companion credit | **A. Rolled into the current owner** (a charmed-away companion's past glory leaves its old owner: accepted) · B. Own winners | no | STATS |
| OQ-STATS-13 | Retroactive? | **A. All history** (free) · B. From release | no | STATS |
| OQ-STATS-15 | Which kills count? | **A. Any monster to 0, again after a revive** (simple) · B. Enemies, once per fight | no | STATS |
| OQ-STATS-16 | Out-of-combat HP | **A. Not counted** (no source) · B. Downs from `CharacterHpAdjusted` | no | STATS |
| OQ-STATS-18 | Glossary: Stats window, Session awards, Overkill callout; Session "derived" | **A. Add** | no · integrator | glossary |
| OQ-STATS-19 | Encounter names in players' stats? | **A. Neutral "Fight 3 · Tue 20 Oct"** (names stay DM-only) · B. Real names (reveals names players never saw) | no | STATS |

Resolved by the integrator: ~~OQ-STATS-14~~ (S2: final roll only, maxed die via `raw`), ~~OQ-STATS-17~~ (S5: [FR-SHELL-86](play-shell.md#6-functional-requirements), 400 × 412, min 320 × 280).

## 16. Out of scope

- Tier B: end-of-combat popup, kill-feed toasts, trophy case, dice luck tracker, XP. Campaign records, charts, export. Session records ([campaign-manager](post-mvp/campaign-manager.md)).
