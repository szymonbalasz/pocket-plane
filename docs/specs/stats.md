---
title: Stats and summaries
prefix: STATS
status: in-review
owner: spec-stats
phase: post-mvp-7
---

# Stats and summaries

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Promoted from the [post-MVP stub](post-mvp/stats.md) (the integrator removes the stub).

> **Sprint 7, track ST** (DM [#311](../decisions-log.md), decided): tier A of [feature tiers](../feature-tiers.md#6-table-specific), meaning a live damage leaderboard, overkill callouts and BG2-style session awards. They come from the append-only log ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)), are visibility-safe, and sessions follow [ADR-0013](../architecture/adr/0013-session-journal-scope.md).
>
> Proposed ADR: [stats as read models](../architecture/adr/proposed-s7-st-stats-read-models.md). Also revised: FR-CBT-136–138, FR-DICE-72–73, FR-SHELL-93–94, FR-NOTE-48–49. Integrator seams applied: S1–S8, S11, S13.

## 1. Summary

- A **Stats** window in both clients:
  - **Fight** tab: a live leaderboard (dealt / taken / healed / kills) for the current fight or a past one.
  - **Session** tab: 9 awards for the current session or a past one, plus the DM's **Show awards**.
- **Overkill callouts**: the outcome line gets "— Overkill!", and everyone who sees that line gets a short toast.
- **Computed on read** on the server from the facts the game already writes (`hp_change`, `roll`, `game-log-entry`):
  - no stats table, and nothing in the snapshot;
  - each viewer's numbers come only from the lines that viewer's log shows, filtered **before** aggregation.

## 2. Scope

- §1, plus a picker over every ended fight and every past session (derived from ≥ 6 h log gaps).
- Combat-tracker: a **From** on the DM's direct Damage / heal, so a heal has an author (FR-CBT-136).

## 3. Goals

- An overkill reaches every screen in ≤ 1 s. End-of-night awards take one click.
- Zero leaks to players through stats: no hidden roll or combatant, no monster HP / AC / temp HP. Acks are leak-scanned.
- All history works, with no backfill.
- Cheap (§12): +21 B per callout line; a fight < 2 ms; a session < 15 ms.

## 4. Non-goals

- Tier B items (§16).
- Out-of-combat HP (`char.adjustHp`, `pet.adjustHp`): there is no combat log entry.
- A "gems spent" award (seam S2).
- Charts, and editing stats.

## 5. User stories

- **DM:** a live damage table to pace fights; one **Show awards** at the end of the night; hidden rolls and monsters count only in my view.
- **Player:** watch my damage and kills climb, see "Overkill!", and look back at last session's awards.

## 6. Functional requirements

**Facts and visibility**

| ID | Requirement |
|---|---|
| FR-STATS-01 | **Computed on read** from the §8 sources at query time. Nothing is written for stats. Read helpers: FR-CBT-138, FR-DICE-73. |
| FR-STATS-02 | **Counted facts.**<br>• `hp_change` rows that are not `undone`.<br>• Rolls per [FR-DICE-67](dice-roll-log.md#6-functional-requirements) (GM): a roll counts iff an entry that is neither undone nor superseded lists it. So only the **final** roll of a reroll counts, and a reroll is never an extra roll.<br>• A roll listed by several entries counts once.<br>• A roll no entry lists never counts. |
| FR-STATS-03 | **Viewer filter before aggregation.**<br>• DM: every counted fact.<br>• Player: only facts whose entry is `public`. For an `hp_change` that is its `entryId` line; for a roll, a public listing entry.<br>• `audiencePlayerId`-only lines count for the DM only, so every player gets the same numbers.<br>• Stats read entries **only through the hub's viewer filter**. Feature-tagged entries (seam S1, e.g. gem log kinds while gems are off) are skipped exactly as in a snapshot. |
| FR-STATS-04 | **Hidden never leaks; names.**<br>• Hidden attacker or target → a non-public line (FR-CBT-24) → never counted for players. A later reveal doesn't backfill.<br>• Player rows: party members with a counted fact, or visible and active in the fight.<br>• **Names come from fact and combatant rows, never tokens.** A dismissed or ended summon (token deleted, FR-CBT-145) still shows by name (seam S7). |
| FR-STATS-05 | **Player result schema** (zod per role) has no field for `applied`, `hpBefore`, `hpAfter`, the overkill amount, AC, temp HP or Effective. The leak scan reads `stats.query` acks. |

**Formulas** (same code for fight and session; party = PCs + companions)

| ID | Stat | Rule |
|---|---|---|
| FR-STATS-06 | Dealt / Taken | Each damage row adds its `raw` to the attacker's Dealt and the target's Taken.<br>• `raw` is the line's number: after multipliers, DM overrides and trigger parts, including temp HP absorbed.<br>• A ruled miss (`raw 0`) adds 0.<br>• Direct damage with no source goes to the DM-only row "DM (direct)". |
| FR-STATS-07 | Healed | Each heal row adds its `raw` to its source (`attackerId`, from FR-CBT-136's From).<br>• No source → DM-only row "Unattributed".<br>• Overheal counts.<br>• Setting temp HP is never healing. |
| FR-STATS-08 | Kills / downs / overkill | **Kill**: a damage row on a `monster` with `hpBefore > 0 → hpAfter = 0`, credited to the attacker. A revive + drop counts again. Kept HP at bind is not a fact (seam S8).<br>**Down**: the same test on a `pc`.<br>**Overkill**: the row's stored `overkill` = `max(0, raw − absorbed − hpBefore)`. |
| FR-STATS-09 | Companions | On the leaderboard a companion has its own line under its owner (owner chip).<br>• Awards roll a companion's dealt, healed, kills, biggest hit and overkill into its owner ("Mira + Owlbear"). Taken and downs stay the PC's own.<br>• A companion whose owner was cleared (#310) counts as a monster. |
| FR-STATS-10 | Nat 20 / nat 1 | Per **character**: counted rolls with `natural` ∈ {20, 1}.<br>• The kept die under adv / dis.<br>• Not `initiative` rolls; death saves count.<br>• Actor must be a character entity: DM rolls for a PC count for that PC.<br>• "As me", monster and companion rolls are not counted. |
| FR-STATS-11 | Gems | A Combat-gem maxed die counts only through the applied `raw`, with no stat of its own (seam S2). While gems are off nothing changes. |
| FR-STATS-15 | Awards | Session scope, each with winner(s), a value and a detail line ("Thorn → Goblin 1, 30, Goblin Ambush"):<br>1. Biggest hit (max `raw` of one row)<br>2. Biggest overkill<br>3. Most damage dealt<br>4. Most damage taken<br>5. Most healing<br>6. Most kills<br>7. Most nat 20s<br>8. Most nat 1s<br>9. Most times downed<br>Candidates are party members. Ties list everyone. A value of 0 shows an empty line ("Nobody went down. Nice."). |

**Scopes**

| ID | Requirement |
|---|---|
| FR-STATS-12 | **Session** = entries (by `n`) with no ≥ 6 h gap; derived, never stored. Facts: `hp_change` with `at` in `[from, to]` (via overlapping encounters), roll entries with `n` in `[fromN, toN]`. Current = the one holding the newest entry. Players list sessions with a public entry, clipped to public entries. |
| FR-STATS-13 | **Boundary cache**: in server memory per campaign, extended from the last `n` (entries are append-only). Rebuilt on the first query after a restart (≤ 103 ms at 100 sessions). |
| FR-STATS-14 | **Fight** = one encounter's counted rows. Default: the started encounter, else the newest ended one.<br>• The picker lists ended fights newest first.<br>• Players never see a planned encounter. |

**Read path and UI**

| ID | Requirement |
|---|---|
| FR-STATS-16 | **`stats.query`** (DM, player; scopes in §9): a read-only command (no write, event, log row or `seq`), answered in hub frame order. Unknown or (player) planned encounter, or unknown `fromN` → `not_found`. |
| FR-STATS-17 | **Live refresh**: while the window is open and not minimised, the client re-queries (trailing debounce 1 s):<br>• on a live frame with a `game-log-entry` upsert (Fight tab: only that `encounterId`);<br>• after every snapshot.<br>Never computed on the client. |
| FR-STATS-18 | **Fight tab** (`stats-fight-table`): Name, Dealt, Taken, Healed, Kills; by Dealt, party first. Header: name · round · picker (`stats-fight-picker`). DM: monster rows (muted; hidden ones eye-off), special rows, Effective Tooltip (`applied` + absorbed). |
| FR-STATS-19 | **Session tab**:<br>• picker (`stats-session-picker`, "Tue 20 Oct · 19:02–23:41 · 3 fights");<br>• 9 award cards (`stats-award`, `data-record-id` = award key);<br>• DM **Show awards** (`stats-show-awards`). |
| FR-STATS-20 | **`stats.showAwards {fromN}`** (DM): `notify` a `stats-awards` info notification to all (FR-NOTE-48). Each client opens Stats on that session's awards (FR-SHELL-94), under its own viewer filter. Showing again = a new notification. |
| FR-STATS-21 | **Callout rule**: `hpAfter = 0` and `overkill ≥ max(10, hpBefore + absorbed)`, i.e. ≥ double what was needed and ≥ 10 extra. Stamped once at apply (FR-CBT-137). |
| FR-STATS-22 | **Callout toast** (`stats-overkill-toast`, 4 s), from **live** frames only: a `cbt.attack` upsert with `callout`, not undone. Players: "Overkill! Thorn → Goblin 1: 30 damage" (no HP); the DM adds "(+23 over 7 HP)". One toast per frame. An info toast, not a notification (FR-NOTE-49). |
| FR-STATS-23 | **Retroactive**: all history, no backfill. Old rows read temp fields as 0. Lines from before this sprint have no `callout`, but their overkill still counts. |
| FR-STATS-24 | **States**: skeleton rows; "No fight yet" / "No damage yet this fight" / "No sessions yet"; "Couldn't load stats" + Retry; offline = last result muted, pickers off. |
| FR-STATS-25 | **Limits**: fight ≤ 70 rows; ≤ 8 tied names per award; `sessions` ≤ 200 newest; ack ≤ 64 KB. |

## 7. UI/UX notes

[visual-direction](../design/visual-direction.md); shadcn Table, Tabs, Select, Card, Tooltip, Toast.

- **Screens:** `stats.board` "Stats" (FR-SHELL-93), Tabs Fight | Session. Award cards in a 3-column grid (1 under 400 px), winners in the player colour (FR-CAMP-28).
- **DM view:** all rows, Effective Tooltips, special rows, Show awards.
- **Player view:** party rows only, public-line numbers, no Show awards. Awards open by themselves.
- **Callout:** the line suffix (FR-CBT-137) and an info Toast in the client's toast region.

## 8. Data model

**No new entity, column or record type.** Read:

| Source (owner) | Fields | Use |
|---|---|---|
| `hp_change` (CBT) | encounterId, at, kind, attackerId / Name, targetId / Name, raw, applied, overkill, hpBefore, hpAfter, tempBefore / After, entryId, undone | the formulas, Effective (DM) |
| `game_log_entry` (DICE) | n, at, kind, public, undone, rollIds, encounterId, supersededBy, payload.callout | the filter, sessions, callout |
| `roll` (DICE) | id, actorKind, actorId, category, natural | nat counts |
| `combatant`, `encounter`, `entity` | kind, ownerCharacterId, hidden, active, name; encounter name / status / times; entity kind | rows, names, party, picker |

- **Relations:** `hp_change` → combatants → encounter; → entry (visibility). Entry → rolls, → superseding entry. Roll → character.
- **Added (CBT):** line `callout` / `dmPayload.overkill`; `cbt.applyHp sourceId` → `attackerId`.
- **Derived:** all stats, boundaries. **Persisted runtime state:** none (server cache, client view state).

## 9. API & events

**WS intents** (no REST)

| Intent | Who | Validation | Ack |
|---|---|---|---|
| `stats.query {scope: "fight", encounterId?}` | DM, player | encounter of the active campaign; player: started / ended | `{fight: {encounterId, name, round, status, rows}}` |
| `stats.query {scope: "session", fromN?}` | DM, player | a session start the viewer can list | `{session: {fromN, toN, from, to, fights, awards}}` |
| `stats.query {scope: "sessions"}` | DM, player | none | `{sessions: [{fromN, toN, from, to, fights}]}` |
| `stats.showAwards {fromN}` | DM | a session start | `{notificationId}` |

- `Row` = `{key, name, ownerName?, kind, dealt, taken, healed, kills}` (+ DM: `effective*`, `hidden`, `special?`). `Award` = `{key, names, playerIds, value, detail}`.

**WS events**

| Event | Visibility rule |
|---|---|
| none new (`stats.query` answers in its ack) | per-viewer filter before aggregation; leak-scanned |
| `NotificationCreated` (`stats-awards`) | audience all |
| `AttackApplied` / `HpApplied` (existing) | `callout` in `payload` (player-safe); amounts in `dmPayload` (DM only) |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Query | ✓ all facts | ✓ public facts | role from the connection; no planned encounter for a player |
| Show awards | ✓ | ✗ | DM-only (`forbidden`) |
| Change stats | ✗ | ✗ | no such command |

## 11. Edge cases & failure modes

- **Disconnect / reconnect (DM, player):** last result muted, re-query after the snapshot. Awards shown while offline wait in history with **Open**.
- **Server crash:** stats hold no state, so only committed applies count. The cache rebuilds on the first query; a lost query is retried after reconnect.
- **Concurrent edits:** serialised in hub order. An undo upserts the line → re-query → the row drops.
- **Invalid input:** zod per intent; a player can't widen the filter.
- **DM hides attack lines:** players' numbers for them stay empty, by design (OQ-STATS-01).
- **Apply hit + late damage:** counted once, at the damage apply. A ruled hit that never gets damage counts nothing.
- **Override:** the set total counts ("DM set" in the DM Tooltip).
- **Multi-target:** one row per target.
- **Fight across two sessions:** each row goes by its `at`.

## 12. Performance & bandwidth

Throwaway probe (deleted) on `session-sim` + `buildRealisticHeavy`.

| What | Measured |
|---|---|
| Snapshot today | DM 690,584 B; worst player 288,913 B (ceilings 1.5 MiB / 512 KiB) |
| `callout` + DM `overkill` on all 30 outcome lines (worst) | DM +1,461 B (≈ 49 B a line); each player +630 B (21 B a line) |
| `stats-awards` row | 575 B; it takes one of the 100 closed-row slots, so the snapshot doesn't grow with sessions |

Compute (a synthetic session = 4 fights × 80 applies + 300 rolls; medians of 7):

| History | Fight (DM / player) | One session's awards | Session list (cold) |
|---|---|---|---|
| 1 session | 0.55 / 0.47 ms | 6.3 ms | 3 ms |
| 10 sessions (9.6k entries) | 0.40 / 0.38 ms | 7.3 ms | 12 ms |
| 100 sessions (94k entries, 32k rows) | 0.37 / 0.69 ms | 5.4–6.0 ms | 103 ms, so cached (a SQL window function took 374 ms) |

- **Bench gates** (`stats.bench.ts`, 100 sessions): fight ≤ 20 ms, session ≤ 50 ms, list cold ≤ 300 / warm ≤ 5 ms.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

**Fixtures** in `fixtures/units/stats/`. Bundle **`stats`** = `session-sim-10` + both units; e2e alias **`stats-e2e`**.

- **`st-past-crypt`** (**joins session-sim-11**, seam S13): an ended fight "Old Crypt": Thorn vs 2 Skeletons, one overkill, Mira downed once, a public nat 20 by Thorn.
- **`st-ambush-facts`**: on sim-10's Goblin Ambush, with manual dice. The unit header lists the expected DM and player numbers.
  - Thorn: nat 20, 30 on Goblin 1 at 7 HP (callout).
  - Mira: nat 1, a miss.
  - Brakka heals Mira 8 with From set, while Mira is 3 below max.
  - Goblin 2 downs Brakka.
  - The hidden Elite hits Thorn for 9.
  - A hidden DM roll as Thorn: nat 20.
  - Apply hit, then late damage 11.
  - An override from 6 to 12.
  - One undone apply.
  - The Owlbear kills Goblin 3.
- All fixture facts share the fixed clock (FR-FIX-08), so the bundle is one past session. Multi-sitting cases inject the clock in integration.

| Level | Named tests |
|---|---|
| Unit (in-memory rows) | `FR-STATS-06 dealt and taken use raw`, `-07 healing raw, overheal, unattributed`, `-08 kill, down, revive counts again`, `-08 overkill with temp HP absorbed`, `-10 nat 20 / 1 rules`, `-12 sessions by 6 h gap`, `-15 ties and zero`, `-21 callout threshold` |
| Integration (`stats`) | `FR-STATS-02 undone excluded`, `-02 only the final roll of a reroll counts`, `-03 public facts only, same for every player`, `-03 feature-tagged entries skipped while off` (S1), `-04 hidden roll / hidden monster never counted for players`, `-04 ended summon still listed by name` (S7), `-05 leak scan per player on stats acks`, `-06 override counts the set total`, `-06 apply hit + late damage counted once`, `-09 companion line and roll-up`, `-12 retroactive past session` (injected clock), `-13 cache extends and rebuilds`, `-16 read-only: no event, log row or seq`, `-16 planned encounter not_found for players`, `-16 hard kill → restart → same results`, `-20 show awards notifies all`, `-23 old rows parse` |

**E2E (thin, `stats-e2e`):** the DM applies an overkill → both Fight tabs update ≤ 2 s and Player 2 gets the toast. Show awards → Player 1's Stats opens on Awards.

**Bench:** the §12 gates.

**Browser walkthrough** (bundle `stats`, verify profile, contexts `dm`, `player-1`, `player-2`, 1440×900):
1. All three open Stats. The DM sees the unit's DM numbers (Elite row with eye-off, "DM (direct)"); the players see the party rows with player numbers (Thorn's Taken 9 lower).
2. DM: Thorn applies 40 to Goblin 4 at ≤ 10 HP. The line gets "— Overkill!"; toasts appear (the DM's with "+N over M HP"); the tables update ≤ 2 s.
3. DM Undo: the line is struck and the 40 drops out. Re-apply.
4. Player 2: no HP, AC or hidden name (leak-scan helper).
5. Session tab: the bundle session and **Today**. Bundle awards match the unit; Thorn's nat 20s are 1 higher for the DM.
6. End, then Show awards (Today): both players get a toast and Stats opens. Biggest hit and overkill are Thorn's 40.
7. Reloads and a hard kill + restart: same numbers (`state:digest` equal).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [combat-tracker](combat-tracker.md) FR-CBT-136–138 | From, callout, read helper | this track |
| [dice-roll-log](dice-roll-log.md) FR-DICE-62–67 (GM), -72–73 | supersede; read rules + helper | GM0 / GM1 |
| [gems](post-mvp/gems.md) (GM) | feature tag (S1), supersede (S2) | settled |
| [play-shell](play-shell.md) FR-SHELL-86, -93–94 | window contract, registration | after FU1 |
| [notifications](notifications.md) FR-NOTE-48–49 | kind, callout toast | this track |
| [live-sync](live-sync.md) | `useEventFrame`, leak scan, viewer filter | built / GM0 |
| Libraries | **none** (Recharts ≈ 100 KB gz rejected: no chart in tier A) | — |

**Build split** (seams S3–S5; build plan wave 2–3)

| Slice | What | Files (⚠ shared) | Order |
|---|---|---|---|
| **ST-core** = ST0 + ST1 (one builder) | **ST0:** `stats.query`, `stats.showAwards`, formulas, filter, cache, kind `stats-awards`, read helpers, bench, units + bundles.<br>**ST1:** FR-CBT-136 From (server + DM dialog), FR-CBT-137 callout + `formatLine` | `src/server/features/stats/*`, `src/shared/stats/*`, `{combat-tracker,dice-roll-log}/stats-read.ts` (new), `combat-tracker/hp.ts`, `src/shared/combat-tracker/` line kinds;<br>⚠ `features/index.ts`, ⚠ `notifications/kinds.ts`, ⚠ `fixtures/bundles/index.ts` (append); ⚠ `package.json` bench list | **ST0 after GM0** (supersede columns). No schema. Builds in parallel with GM1; **GM1 merges first, ST-core rebases** (apply path, S3); GM2 after both |
| **ST2** `build/st-window` | Stats window, live refresh, toast, awards open, notification views; its golden row + size-table row (S5) | `@ui/features/stats/*`, ⚠ `src/client/{dm,player}/windows.ts`, ⚠ `notification-views.ts` ×2 (append) | **After FU1 + ST-core** |

## 15. Open questions

**Bold** = suggested pick (not decided). DM questions unless marked.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-STATS-01 | Who sees which stats? | **A. DM all; players the same numbers, public lines only** (zero-leak; thin if attacks are hidden) · B. + own-audience lines (differs per player) · C. DM-only | yes | STATS, DICE |
| OQ-STATS-02 | Leaderboard where? | **A. Stats window, live** · B. Initiative footer (steals rows) · C. End-of-combat popup (tier B) | yes | SHELL |
| OQ-STATS-03 | Callout form | **A. Toast + line** · B. Line · C. Toast | no · DM | CBT, NOTE |
| OQ-STATS-04 | Players and monster overkill | **A. "Overkill!" + public damage, no HP** · B. The amount (reveals HP) · C. DM-only | yes | CBT |
| OQ-STATS-05 | Callout threshold | **A. ≥ max(10, needed)** (rare) · B. any ≥ 10 · C. ≥ 2× needed (minion spam) | no · DM | STATS |
| OQ-STATS-06 | "Dealt" = ? | **A. The log number; DM also Effective** · B. Effective (leaks HP) · C. Rolled, before overrides | yes | STATS, CBT |
| OQ-STATS-07 | Overheal, temp HP | **A. Log number (overheal counts); temp HP isn't healing** · B. Effective | no · DM | STATS |
| OQ-STATS-08 | Heal credit (none today) | **A. From on direct heal, preset turn combatant** · B. Healing-category rolls (unapplied heals count) · C. Drop the award | yes | CBT |
| OQ-STATS-09 | What is a session? | **A. Derived ≥ 6 h log gap** (ADR-0013 holds, retroactive) · B. "End session" marker (supersedes ADR-0013) · C. The DM picks a range | yes | STATS |
| OQ-STATS-10 | When do awards show? | **A. Show awards opens everyone's Stats** · B. No push · C. Auto at the last End (a guess) | no · DM | NOTE, SHELL |
| OQ-STATS-11 | Monsters on players' board? | **A. Party only (DM all)** · B. Visible monsters too · C. PCs only | no · DM | STATS |
| OQ-STATS-12 | Companion credit | **A. Rolled into owner (taken / downs own)** · B. Own winners · C. Ignored | no · DM | STATS |
| OQ-STATS-13 | Retroactive? | **A. All history** · B. From release | no · DM | STATS |
| ~~OQ-STATS-14~~ | ~~Reroll, maxed die~~ | **Resolved (seam S2):** the final roll only (FR-DICE-67); a maxed die via `raw`; no gems award | — | GEM |
| OQ-STATS-15 | Which kills count? | **A. Any monster to 0; revive + drop counts again** · B. Enemies, once per fight | no · DM | STATS |
| OQ-STATS-16 | Out-of-combat HP | **A. Not counted** · B. Downs from `CharacterHpAdjusted` | no · DM | STATS |
| ~~OQ-STATS-17~~ | ~~Window size~~ | **Resolved (seam S5, [FR-SHELL-86](play-shell.md#6-functional-requirements)):** 400 × 412, min 320 × 280, parkable | — | SHELL |
| OQ-STATS-18 | Glossary: Stats window, Session awards, Overkill callout; Session "derived, ≥ 6 h gap" | **A. Add / amend** | no · integrator | glossary |

## 16. Out of scope

- Tier B: end-of-combat popup, kill-feed toasts, trophy case, dice luck tracker, XP.
- Campaign records, favourite weapon, charts, export, a "gems spent" award.
- Session records and journal ([campaign-manager](post-mvp/campaign-manager.md), ADR-0013).
