---
title: Stats and summaries
prefix: STATS
status: in-review
owner: spec-sb
phase: post-mvp-8
---

# Stats and summaries

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Promoted from the post-MVP stub (the integrator moves it).

> **Sprint 7, track ST** (DM [#311](../decisions-log.md), decided): tier A of [feature tiers](../feature-tiers.md#6-table-specific), meaning a live damage leaderboard, overkill callouts and BG2-style session awards. They come from the append-only log ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)) and never leak; sessions follow [ADR-0013](../architecture/adr/0013-session-journal-scope.md). Proposed ADR: [stats as read models](../architecture/adr/0059-stats-read-models.md). Also revised: FR-CBT-136–138, FR-DICE-72–73, FR-SHELL-93–94, FR-NOTE-48–49. Seams S1–S8, S11, S13 and review rulings 2–4, 10, 13, 20–25 applied.

> **Sprint 8, track SB** (DM [#334](../decisions-log.md), decided, not open): tier B on top of tier A's read models: **kill-feed toasts**, a **trophy case** per character, a **dice luck tracker**, an **end-of-combat summary**. Same visibility rules as tier A. New FR-STATS-26–53 ([§6.1](#61-tier-b-sprint-8)); FR-STATS-22's toast is folded into the kill feed. Also revised: FR-CBT-152–153, FR-NOTE-68–69, FR-CHARX-97–99, FR-DICE-89–90. No schema. Proposed ADR: [session partials](../architecture/adr/proposed-s8-sb-session-partials.md) (refines ADR-0059 §4). DM questions: OQ-STATS-20–30.

## 1. Summary

- A **Stats** window (both clients): **Fight** = a live leaderboard; **Session** = 9 awards and the DM's **Show awards**.
- **Overkill callouts**: "— Overkill!" on the line, and a toast.
- **Computed on read** from facts already written, filtered per viewer **before** aggregation; nothing in the snapshot.
- Combat-tracker gains a **From** on direct heals (FR-CBT-136).
- *(Sprint 8)* **Kill feed**: "Thorn finished Goblin 1" as a toast on every screen that saw the line (the overkill toast becomes part of it).
- *(Sprint 8)* **Fight summary**: at End, Stats opens on the fight with **Highlights** (MVP, biggest hit, kills, downs, nat 20s…).
- *(Sprint 8)* **Luck** tab: average d20, nat 20s / 1s per character, per session or campaign.
- *(Sprint 8)* **Trophy case**: a **Trophies** tab on the character sheet, campaign-wide totals and records.

## 2. Scope

- Live and past fights and sessions, callouts, awards.
- *(Sprint 8)* Kill feed, fight highlights and the End summary, luck (session, campaign), trophies (campaign).

## 3. Goals

- An overkill reaches every screen in ≤ 1 s. Awards take one click.
- Zero leaks to players (FR-STATS-05).
- All history works, with no backfill.
- Cheap (§12).
- *(Sprint 8)* A kill reaches every screen that saw its line in ≤ 1 s, once. Campaign numbers in ≤ 50 ms warm at 100 sessions.

## 4. Non-goals

- Out-of-combat HP (`char.adjustHp`, `pet.adjustHp`): there's no combat log entry for it.
- A "gems spent" award (seam S2), charts, editing stats.
- *(Sprint 8)* XP, campaign records across characters ("party records"), export, a kill feed for old lines (live only).

## 5. User stories

- **DM:** a live damage table to pace fights; one **Show awards** at the end of the night; my hidden rolls and monsters count only for me.
- **Player:** watch my damage and kills climb, see "Overkill!", look back at last session's awards.
- *(Sprint 8)* **DM:** see each kill as it lands; at End, a summary I can talk over; know whether my dice are hot tonight.
- *(Sprint 8)* **Player:** "Thorn finished the Ogre!" on my screen; my character's lifetime kills and biggest hit; proof my d20 is cursed.

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
| FR-STATS-22 | **Callout toast** `stats-overkill-toast` (4 s), from **live** frames only: a `cbt.attack` upsert with `callout`, not undone. Players: "Overkill! Thorn → Goblin 1: 30 damage"; the DM adds "(+23 over 7 HP)". One per frame. An info toast, not a notification (FR-NOTE-49). *(ST2 build, #328: fires on any outcome line with the callout: `cbt.attack` and the DM's direct `cbt.hp` damage)* *(Sprint 8: **folded into FR-STATS-28**: one feed toast per line; a callout line with `fell` reads as a kill, a callout on an already-downed target (`hpBefore` 0) keeps this text; `stats-overkill-toast` is retired.)* |
| FR-STATS-23 | **Retroactive, stateless**: no backfill. A crash loses only an answer; reconnect → re-query (last result muted). Undo → re-query drops the row. Old facts keep old names. |
| FR-STATS-24 | **States**: skeleton rows; "No fight yet" / "No damage yet this fight" / "No sessions yet"; "Couldn't load stats" + Retry; offline = last result muted, pickers off. |
| FR-STATS-25 | **Limits**: fight ≤ 70 rows; ≤ 8 tied names; `sessions` ≤ 200 newest; ack ≤ 64 KB. |

### 6.1 Tier B (sprint 8)

Every rule above holds (filter, then aggregate; final roll only; names from facts; party = PCs + companions, credit to the current owner). Picks marked *(OQ-STATS-NN)* wait for the DM gate.

**Kill feed** *(OQ-STATS-20, -21)*

| ID | Requirement |
|---|---|
| FR-STATS-26 | **Feed events**: a damage fact with `hpBefore > 0 → hpAfter = 0` on a **non-companion monster** = a **kill** (FR-STATS-08), on a **PC or companion** = a **down**. Every one, whoever the attacker: party, monster, "DM (direct)". Read from the outcome line's `fell` flag ([FR-CBT-152](combat-tracker.md#6-functional-requirements)); the client computes nothing. |
| FR-STATS-27 | **Text** (names = the line's names, never tokens). Kill: "Thorn finished Goblin 1"; no source: "Goblin 1 falls". Down: "Goblin 2 dropped Brakka"; no source: "Brakka is down". Callout line: "Overkill! " in front. **DM** appends ", overkill 23" whenever the overkill > 0 (from `dmPayload`) and "(hidden)" after a hidden side's name. Players never get an amount. |
| FR-STATS-28 | **Toast** `stats-feed-toast` (4 s, info, not a notification: [FR-NOTE-69](notifications.md#6-functional-requirements)), from **live** `event` frames only: a `cbt.attack` / `cbt.hp` line new to the store with `fell` or `callout`, not undone. **One toast per frame**: up to 3 lines joined by " · ", then "and N more" (an area attack); a newer feed toast replaces a shown one (as FR-NOTE-49). One client-level listener, never one per window (BL-71: exactly one toast per kill). |
| FR-STATS-29 | **Visibility**: a client toasts only lines the hub sent it. Hidden attacker or target → the line is non-public (FR-CBT-24) → DM only (plus a companion owner's audience line, FR-CBT-114). Snapshots, resyncs, undo and supersede upserts never toast. No new record or event. |
| FR-STATS-30 | **Preference** "Kill feed" (Switch, per browser, both clients, default on) through the Preferences sections registries (append). Off → no feed toasts; lines unchanged. |

**Fight summary** *(OQ-STATS-27–29)*

| ID | Requirement |
|---|---|
| FR-STATS-31 | **Highlights** of a fight (the fight ack's `highlights`, per role, party only for players): **MVP** (most Dealt), **Biggest hit** (from → to, `raw`), **Biggest overkill** (DM: the amount; players: the callout line with the largest `raw`, as FR-STATS-12), **Most healing**, **Kills** in log order ("Thorn → Goblin 1"), **Downs** (name × count), **Nat 20s / Nat 1s** (per character, FR-STATS-32), **Rounds**, **Duration** (minutes, `startedAt` → `endedAt` or now). DM adds monsters' kills and downs, hidden marks, and **Still standing** (active monsters with HP > 0, hidden ones marked). Ties list all (≤ 8). |
| FR-STATS-32 | **Fight span for rolls**: entries from the first with `at ≥ startedAt` to the last with `at ≤ endedAt` (now while started), as an `n` range from the session timeline. Rolls in it count per FR-STATS-10 / FR-STATS-37 (character actors only). |
| FR-STATS-33 | **At End**: combat's `ended` rule hook `stats.fight-summary` ([FR-CBT-153](combat-tracker.md#6-functional-requirements)) calls `notify` kind `stats-fight-summary` ([FR-NOTE-68](notifications.md#6-functional-requirements)) in the `cbt.end` transaction: audience **`all`** if the fight has a counted public fact, else **`dm`**; no counted fact → no notification. |
| FR-STATS-34 | **Opens by itself**: a client receiving that notification in a live frame opens / fronts **Stats** on the **Fight** tab of that encounter with Highlights expanded (the "summary"), placed by the shell's placer like any open. Preference "Open the fight summary at End" (per browser, default on; off → the notification's toast only). The history row's **Open** does the same later, after a reload too. The DM client opens it after FR-CBT-60 minimises Initiative. |
| FR-STATS-35 | **Hidden at End**: players' highlights read public facts only; nothing names a hidden monster, counts survivors or says "victory". The DM's names hidden rows (eye-off) and Still standing. |
| FR-STATS-36 | **UI**: a collapsible **Highlights** block above the Fight table (`stats-highlights`, `data-state` open / closed; items `stats-highlight` + `data-record-id` = `mvp`, `biggest-hit`, `biggest-overkill`, `most-healing`, `kills`, `downs`, `nat20`, `nat1`, `rounds`, `duration`, `standing`). Closed by default on a started fight; open when opened from End or history. Empty item → hidden. |

**Luck tracker** *(OQ-STATS-24–26)*

| ID | Requirement |
|---|---|
| FR-STATS-37 | **Counted d20 rolls**: counted rolls (FR-STATS-02, final roll only, FR-DICE-67) after the viewer filter (FR-STATS-03), actor a **character**, category not `initiative` (death saves count, FR-STATS-10), with ≥ 1 d20 die. **Physical** rolls count. Macro and roll-request rolls count like any roll ([dice-extras](dice-extras.md); OQ-STATS-33). Companion and monster rolls don't (FR-STATS-39's DM row). |
| FR-STATS-38 | **Formulas** per character: **Rolls** = counted rolls; **d20s** = every d20 face with a value, kept and dropped ([FR-DICE-89](dice-roll-log.md#6-functional-requirements)); **Average** = their mean, 1 decimal ("—" with none; hint "expected 10.5"); **Nat 20s / Nat 1s** = the kept `natural` (as the awards). |
| FR-STATS-39 | **Rows**: party characters with ≥ 1 counted roll in scope, by name. DM also gets **"DM dice"** (`dm-dice`): every other d20 roll (DM, monsters, tokens, companions; hidden included). Players never get it. |
| FR-STATS-40 | **Scopes**: one session (the Session tab's picker and rule, FR-STATS-13; default the newest) or **Campaign** (all sessions). |
| FR-STATS-41 | **UI**: a third tab **Luck** (`stats-luck`): scope Select `stats-luck-scope` (sessions, then "Campaign"), table `stats-luck-table` of `stats-luck-row` (`data-record-id` = character id or `dm-dice`): Name (player colour), Rolls, d20s, Avg, Nat 20, Nat 1. Live refresh as FR-STATS-17 on a live `roll`-kind entry. |

**Trophy case** *(OQ-STATS-22, -23)*

| ID | Requirement |
|---|---|
| FR-STATS-42 | **Contents** per character, campaign-wide, viewer-filtered, companions rolled into the current owner (FR-STATS-09). **Lifetime**: Fights (encounters with a counted fact of theirs), Damage dealt, Damage taken, Healing, Kills, Times downed, Nat 20s, Nat 1s, Average d20 (FR-STATS-38). **Records**: Biggest hit, Biggest overkill (as FR-STATS-12 per role), Most damage in one fight, Most kills in one fight, each with "→ target · ‹fight label›" where it applies. 0 → "—". |
| FR-STATS-43 | **Who**: DM any character (all facts). Player: **only characters they own** (`forbidden` otherwise), numbers from public facts (the same any player would get). Shown in the sheet's **Trophies** tab ([FR-CHARX-97](character-sheet-full.md#6-functional-requirements)). |
| FR-STATS-44 | **Refresh**: on tab show, then as FR-STATS-17 (trailing 1 s) on a live outcome or `roll` line of that character or their companions. |

**Read path, cost, limits**

| ID | Requirement |
|---|---|
| FR-STATS-45 | **`stats.query`** gains scopes `luck {n? \| campaign: true}` and `trophies {characterId}`; `fight` acks gain `highlights`. Same read-only pipeline, frame order, rate limit and memo (FR-STATS-16). Unknown character or session → `not_found`. |
| FR-STATS-46 | **Campaign scope = session partials** ([proposed ADR](../architecture/adr/proposed-s8-sb-session-partials.md), OQ-STATS-30): per (campaign, session `fromN`, viewer class, features) one tally per character / side, in server memory, built for all closed sessions in **one** campaign-wide pass at the first campaign query; the newest session always recomputed. The fact-version listener (FR-STATS-16) also drops the partial of each session whose `n` a commit touched (undo, supersede, a line's facts) and **all** partials on an owner / kind change of a combatant (current-owner rule). Never persisted. |
| FR-STATS-47 | **Player schemas** (strict, zod per role): luck rows, trophies and highlights have no applied, HP, overkill amount, AC, encounter name, hidden mark, Still standing or `dm-dice`. Acks are leak-scanned. |
| FR-STATS-48 | **Limits**: luck ≤ 70 rows; highlights ≤ 20 kills / downs then "+N", ≤ 8 tied; trophies one character; ack ≤ 64 KB. |
| FR-STATS-49 | **Retroactive**: highlights, luck and trophies work for every past fight and session, no backfill. The feed is live only (old lines have no `fell`). Crash / reconnect / undo as FR-STATS-23. |
| FR-STATS-50 | **States**: as FR-STATS-24, plus "No rolls yet" (Luck) and "No fights yet" (Trophies); offline = last result muted. |
| FR-STATS-51 | **Bench gates** (`stats.bench.ts`, 100 sessions): fight with highlights ≤ 20 ms; luck one session ≤ 50 ms; campaign luck / trophies **warm ≤ 50 ms**, **cold (first pass) ≤ 2 s**. |

**Sim-11 follow-ups (stats work)**

| ID | Requirement |
|---|---|
| FR-STATS-52 | **BL-69**: during a started fight a player's default is that fight even before a public fact: label "This fight", party rows on screen at 0 (amends FR-STATS-15; it gets its "Fight N" once it has one). Planned fights still never list. |
| FR-STATS-53 | **BL-71**: "Session awards" opens Stats and toasts **once** per client (one listener per client, as FR-STATS-28). |

## 7. UI/UX notes

- [visual-direction](../design/visual-direction.md); shadcn Table, Tabs, Select, Card, Tooltip, Toast. Window `stats.board` (FR-SHELL-93). Layout and test IDs: FR-STATS-18, -19.
- **Player view:** party rows, neutral fight labels, no Show awards; awards open by themselves.
- **DM view:** everything (FR-STATS-18).
- *(Sprint 8)* Tabs **Fight · Session · Luck** (fit 320 px). Highlights: a two-column list of label / value lines (one column under 400 px), shadcn Collapsible; kills as a wrapped list of "A → B" chips. Luck: shadcn Table, numbers right-aligned. Feed toast: the existing info Toast, no new look. Trophies tab: [FR-CHARX-98](character-sheet-full.md#6-functional-requirements).
- *(Sprint 8)* **Player view:** party only, no amounts, no hidden marks, no DM dice, Trophies for own characters. **DM view:** + monsters, hidden marks, Still standing, DM dice, any character's Trophies.
- *(Sprint 8)* Window size and the summary's spot: WF's placer and useful sizes (OQ-STATS-32); the summary opens the same `stats.board` window, never a modal.

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
- *(Sprint 8)* **No new entity, column or record type.** Added: outcome line `payload.fell?: "kill" | "down"` (CBT, FR-CBT-152); notification kind `stats-fight-summary` rows (NOTE, FR-NOTE-68). Read in addition: `roll.dice` d20 faces and `manual` (DICE, FR-DICE-89); `encounter.startedAt` / `endedAt`. **Derived:** feed text, highlights, luck, trophies. **Server memory:** session partials (FR-STATS-46). **Client:** the two preferences (browser storage).

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
| `stats.query {scope: "fight", …}` | DM, player | as above | + `highlights` per role (FR-STATS-31, -47) |
| `stats.query {scope: "luck", n?}` / `{scope: "luck", campaign: true}` | DM, player | `n` in a session the viewer lists | `{luck: {scope, fromN?, rows}}`; DM rows + `dm-dice` |
| `stats.query {scope: "trophies", characterId}` | DM; player for an own character | character in the campaign; player owner else `forbidden` | `{trophies: {characterId, lifetime, records}}` per role |
| Outcome line `fell` (in the existing `cbt.attack` / `cbt.hp` upsert) | — | stamped at apply | **DM**: every line. **Player**: public lines (the target is visible, its band already reads "down"), plus a companion owner's audience lines. No new event |
| `NotificationCreated` kind `stats-fight-summary` (inside `cbt.end`) | system (hook) | FR-STATS-33 | **DM**: always. **Players**: audience `all` only when the fight has a counted public fact; payload `{encounterId}` (already on public lines, #327) |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Query | ✓ all facts | ✓ public facts | role from the connection; zod; rate limit |
| Show awards | ✓ | ✗ | `forbidden` |
| Change stats | ✗ | ✗ | no such command |
| *(S8)* Luck, highlights | ✓ all facts | ✓ public facts, party only | role; zod; rate limit |
| *(S8)* Trophies | ✓ any character | ✓ own characters | owner check → `forbidden` |
| *(S8)* Feed / summary preferences | ✓ own browser | ✓ own browser | client only |

## 11. Edge cases & failure modes

- Disconnect / reconnect (DM, player), server crash, concurrent undo, renames: FR-STATS-23. Invalid input / spam: FR-STATS-16. DM-hidden attack lines leave players' numbers empty, by design (OQ-STATS-01). Multi-target: one row per target. A fight across two sessions splits rows by `at`.
- *(Sprint 8)*
  - **Disconnect during a kill**: the missed frame never toasts (snapshots don't); the line is in the log. **Reconnect after End**: the summary notification arrives in the snapshot (no auto-open, FR-NOTE-13), so its toast-less history row offers **Open**.
  - **Server crash**: `fell` and the summary notification commit with their command or not at all; partials are rebuilt on the next campaign query; acks lost → re-query.
  - **Undo of a kill**: the line is struck; no toast; highlights, luck and trophies drop it on re-query (FR-STATS-46 drops the partial).
  - **Revive then kill again**: a second kill (FR-STATS-08), a second toast.
  - **A charmed-away companion**: its past kills leave its old owner's trophies (OQ-STATS-12 A; all partials drop).
  - **End with nothing counted**: no notification. **End with only hidden facts**: DM-only notification.
  - **A reveal later**: no backfill (FR-STATS-04).
  - **Fight with no `endedAt`** (started): the span runs to now.

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

**Sprint 8** (throwaway probe, deleted; 2026-10-21; `session-sim` + `buildRealisticHeavy` + gems on, then the bench's synthetic history: a session = 4 fights × 80 applies + 300 rolls (¼ with advantage, 1 in 7 physical) + 300 other lines, 10 s apart ≈ a **4-hour sitting**; medians of 7)

- **Snapshot (CON-44):** `fell` on the 30 outcome lines in the heavy 100-entry window: **+420 B per viewer** (14 B a line); worst, 100 kill lines in the window: ≈ +1.4 KB. A `stats-fight-summary` row is **536 B** inside notifications' 100-closed window: measured **−202 B** (it pushed out a larger row), so no growth with fights. Baseline here DM 690,811 B, players 285,838–289,138 B.
- **Cumulative worst** (sprint-7 figure + SB): **DM ≈ 944 KB of 1.5 MiB; players ≈ 301 KB of 512 KiB.**
- **Per event:** a kill adds 14 B to its line's upsert frame. End adds one `NotificationCreated` frame (≈ 0.6 KB a viewer) and one fight ack per open client (8 combatants: DM 1,773 B / player 552 B before highlights; highlights capped by FR-STATS-48, not built yet).

| Compute | 1 session (920 entries) | 10 sessions (9.2k) | 100 sessions (92k, 32k `hp_change`, 30k rolls) |
|---|---|---|---|
| Fight + its rolls (summary), DM | 1.1 ms | 1.0 ms | 1.5 ms |
| Luck, one session | 1.5–2.1 ms | 1.9 ms | 7–10 ms |
| Luck, campaign, DM / player (one pass) | 1.7 / 1.5 ms | 18 / 14 ms | **404–449 / 289–299 ms** |
| Trophies (all characters), campaign, DM / player (one pass) | 3.6 / 3.0 ms | 30 / 25 ms | **538 / 417–430 ms** |
| Partials: every session queried separately (player) | 6 ms | 48 ms | 2,040 ms (each `n`-range read scans the campaign's facts) |
| Partials warm: the newest session only (player) | 3.3 ms | 4.8 ms | **18.5 ms** |

- **Why partials:** on read, a campaign answer at 100 sessions costs ≈ 1 s (luck + trophies). The memo goes stale on every fact, so an open Trophies tab would pay that on every kill. With partials, one campaign-wide pass bucketed by session runs once (≈ 1 s DM, ≈ 0.7 s player at 100 sessions; ≈ 50 ms at 10). After that, an answer = the newest session (≈ 20–30 ms) plus a sum. Per-session reads must not be used for the cold build (2 s).

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

**Fixtures** (`fixtures/units/stats/`, kind setup, via commands; each header lists the expected DM and player numbers):
- **`sb-fight-facts`** (requires `st-ambush-facts`; on sim-10's running Goblin Ambush):
  - Mira kills Goblin 4: 25 at 7 HP (callout + `fell`).
  - Thorn kills the hidden Wolf (non-public kill line).
  - Goblin 2 drops Mira (a down).
  - One 3-target apply by Mira kills two goblins in one frame (names in the unit header).
  - One kill undone.
  - The Owlbear's Goblin 3 kill (companion) comes from `st-ambush-facts`.
- **`sb-luck-rolls`** (requires `char-mira`, `char-thorn`, `gems-on`):
  - Mira: Stealth with advantage 18 / 3, a physical nat 20, and an initiative nat 20 (not counted).
  - Thorn: a nat 1 (save), and a death save nat 20 (counted).
  - The DM: a hidden roll as Thorn, nat 20 (DM only); a monster nat 20 (DM dice).
  - Mira's Perception 4, rerolled with Inspiration to 17 (17 counts).
- **Bundle `stats-b`** = `stats` + `gems-on` + both units. `st-past-crypt` (an ended fight, so it has its own summary notification from the load) plus the fixed clock make one past session; live play makes "Today". E2E alias **`stats-b-e2e`**. **session-sim-12** includes both units.

**Named tests** (all `FR-STATS-NN …`):
- **Unit (`@shared/stats`):** 26 kill vs down vs companion target vs `hpBefore` 0; 27 feed text per role (sources, no source, callout, overkill, hidden mark); 28 one toast per frame, "and N more"; 31 highlights (MVP, ties, overkill per role, standing DM only); 32 fight span bounds; 38 average over kept + dropped faces, nat from the kept die, null faces skipped, physical counted; 39 DM-dice row; 42 trophy formulas (lifetime, records, companion roll-up); 48 limits.
- **Integration (`stats-b`):**
  - 29 hidden-attacker / hidden-target kill: no line, no `fell` to players.
  - 33 End → notification `all`; a hidden-only fight → `dm`; no fact → none; same transaction (a throwing hook rolls back End).
  - 35 players' highlights never name the Wolf or Still standing.
  - 37 initiative excluded; reroll final only; superseded / undone excluded; tagged kinds off.
  - 40 session vs campaign scope; 43 player trophies for another's character → `forbidden`.
  - 45 read-only, rate limit shared; 46 partials built once, the newest recomputed, dropped on an old undo and on a charm-away (all).
  - 47 **leak scan per player** (luck, trophies, highlights acks; frames).
  - 49 retroactive past session (injected clock: three sittings); 52 player default fight before a public fact.
  - **Hard kill**: after End and a restart, same highlights / luck / trophies.
- **Client:** 28 feed toast live only, not undone, not on snapshot / resync, one per kill with Stats open (BL-71); 30 preference off; 34 summary opens Stats on the fight (pref on / off; DM after Initiative minimises), history Open after reload; 36 highlights open / closed; 41 Luck tab + scope; 50 states; 53 one awards toast.
- **E2E (`stats-b-e2e`):** a kill toasts on DM + Player 2 once each; End opens Stats with Highlights on both; Player 1's Trophies tab. **Bench:** FR-STATS-51.

**Browser walkthrough** (bundle `stats-b`, verify profile, contexts `dm`, `player-1`, `player-2`, 1440×900; step 6 also at DM 1280×720):
1. All open Stats → **Luck · Campaign**. DM: Thorn's nat 20s are 1 higher than the players' (the hidden roll), a "DM dice" row; players have no DM dice. Mira's d20s include the dropped 3. The reroll shows 17, not 4.
2. DM: Thorn applies 40 to Goblin 4 (≤ 10 HP). **Exactly one** toast per client: players "Overkill! Thorn finished Goblin 4", the DM's adds ", overkill N". No separate overkill toast.
3. DM kills the hidden Elite. The DM's toast reads "(hidden)"; players get no toast and no line (frames).
4. Goblin 2 hits Brakka to 0: "Goblin 2 dropped Brakka" on all three. A 3-target apply that kills 2 → one toast "… and 1 more" or two names.
5. Undo the last kill → struck line, no toast. Re-apply → toast.
6. **End**. All three get "Fight summary". Stats opens on the Fight tab with Highlights open, placed by the placer (no PC under it at 1280×720). Players' Kills omit the Elite; the DM sees Still standing.
7. Player 2: leak-scan helper over frames and acks: no HP, AC, amounts, encounter name, hidden names, `dm-dice`.
8. Player 1 opens Mira's sheet → **Trophies** (values per the unit header, incl. the Old Crypt). The DM opens Thorn's: the hidden nat 20 counts. Player 2 sees no Trophies on Mira's summary card; a raw `trophies` intent for Mira → `forbidden`.
9. Player 2 turns **Kill feed** off; the DM kills again → no toast for Player 2, Player 1 gets one.
10. Reload all: Notifications → Open on the summary reopens it with the same numbers. Hard kill + restart: same numbers (`state:digest` equal).

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

**Sprint 8 dependencies**

| On | What we need | Status |
|---|---|---|
| [combat-tracker](combat-tracker.md) FR-CBT-152–153 | `fell` on lines; the `ended` hook line | this track |
| [dice-roll-log](dice-roll-log.md) FR-DICE-89–90 | d20 faces, `manual`, `n` in `rollFacts`; whole-campaign read | this track |
| [notifications](notifications.md) FR-NOTE-68–69 | summary kind; feed toast not a notification | this track |
| [character-sheet-full](character-sheet-full.md) FR-CHARX-97–99 | Trophies tab via `sheet-sections.ts` | this track |
| [play-shell](play-shell.md) (WF) | placer for the summary open; toast stack policy for feed bursts; Preferences sections | WF frame core first (OQ-STATS-32) |
| [dice-extras](dice-extras.md) (TT) | macro / roll-request rolls as ordinary counted rolls | seam (OQ-STATS-33) |
| [combat-extras](combat-extras.md) (CB) | nothing: highlights don't read initiative order | seam (OQ-STATS-34) |
| Libraries | **none**: no chart (Luck is a table; tier B has no chart). Alternatives not needed | — |

**Build split, sprint 8** (no schema; `lifecycle.ts` untouched)

| Slice | Files | ⚠ Shared (AGENTS §9.9) | Order |
|---|---|---|---|
| **SB0** `build/sb-core` (server + shared) | `features/stats/*` (scopes, highlights, luck, trophies, partials in `cache.ts`, the `ended` hook, the summary kind), `shared/stats/*`, `dice-roll-log/stats-read.ts`, `combat-tracker/stats-read.ts`, `combat-tracker/hp.ts` + `@shared/combat-tracker/log-kinds.ts` (`fell`), `stats.bench.ts`, `fixtures/units/stats/sb-*` | appends: `combat-tracker/rule-hooks.ts` (one line), `notifications/kinds.ts`, `fixtures/bundles/index.ts` | any time; parallel with WF / TT / CB cores (no file overlap) |
| **SB1** `build/sb-stats-ui` | `@ui/features/stats/*`: the feed toast (replaces the overkill toast), Highlights, Luck tab, End open, summary view | appends: `notification-views.ts` ×2, `pref-sections.ts` ×2 | after SB0 **and** WF's frame core (toast stack, placer) |
| **SB2** `build/sb-trophies` | `@ui/features/stats/trophies/*` (new folder) | append: `sheet-sections.ts` | after SB0; **parallel with SB1** |

- SB1 and SB2 can be one builder with one walkthrough if slots are short (same feature folder, separate files).

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

**Resolved (integrator, sprint-7 seams / rulings)**: ~~OQ-STATS-14~~ (S2: final roll only, maxed die via `raw`), ~~OQ-STATS-17~~ (S5: [FR-SHELL-86](play-shell.md#6-functional-requirements), 400 × 412, min 320 × 280).

**Sprint 8 (track SB).** Bold = pick, for DM gate 1. None blocks the spec (each FR is written to its pick); the DM's answer may change an FR.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-STATS-20 | Kill feed: which kills? | **A. Every kill and every party down on a line the viewer sees** (party, companions, monsters dropping PCs "Goblin 2 dropped Brakka", DM direct "Goblin 1 falls"): one rule, busier in big fights · B. Party kills + party downs only (no "Goblin 1 falls"): quieter, the DM's own kills go silent · C. Party kills only: no bad news on screen | DM gate | STATS, CBT |
| OQ-STATS-21 | Kill feed: toast or log line? | **A. Toast only; the line keeps its text, gains a hidden `fell` flag** (14 B a line): no new noise in the log · B. Toast + the line says "— falls" / "— down": a record in the log, longer lines · C. A notification kind (bell + history, 536 B a row): kills push older info rows out of the 100-row window · D. Line only, no toast: quiet, easy to miss | DM gate | STATS, NOTE, CBT |
| OQ-STATS-22 | Trophy case contents | **A. Lifetime totals + records (FR-STATS-42)**: fights, dealt, taken, healed, kills, downs, nat 20s / 1s, avg d20; biggest hit / overkill, best fight: full picture, one query · B. A + "session awards won" (×N per award): more fun, each session's awards computed into the partials · C. Three lines (kills, biggest hit, nat 20s): smallest, little to browse | DM gate | STATS, CHARX |
| OQ-STATS-23 | Trophy case: where, who sees? | **A. A Trophies tab on the sheet; the owner and the DM** (others see summary cards only, FR-CHARX-32): private like the sheet · B. A + one line on other players' summary cards ("Kills 12 · Biggest hit 41"): bragging rights, breaks "summary cards render no sections" · C. A Stats "Trophies" tab for everyone (public numbers): compare the party, not "on the character" | DM gate | STATS, CHARX |
| OQ-STATS-24 | Luck: public or private? | **A. Everyone sees the party's luck from public rolls** (same numbers for every player, DM all + DM dice): fun at the table, zero leak · B. Each player sees only their own characters (+ DM all): no teasing, differs per player · C. DM only | DM gate | STATS |
| OQ-STATS-25 | Luck: which rolls count? | **A. Character d20 rolls except initiative** (death saves in; physical in; rerolled = final roll only; macro / roll-request rolls like any; maxed dice don't apply to d20s): the awards' rule · B. Attack, save, check only (no "other", no death saves): "real" rolls, a second rule · C. A minus physical rolls: only server dice, misses a table with real dice | DM gate | STATS, DICE |
| OQ-STATS-26 | Luck: average of which faces? | **A. Every d20 face rolled, dropped ones too**: true dice luck (expected 10.5), advantage-neutral; "d20s" can exceed "Rolls" · B. The kept die only: matches the log's natural markers, advantage inflates it | DM gate | STATS |
| OQ-STATS-27 | End-of-combat summary: when, for whom? | **A. Automatic at End for everyone** (players only when the fight has a public fact; a per-browser "open at End" preference): no clicks · B. Automatic for the DM; a **Share** button sends it to players: the DM controls the moment, one more click · C. On demand only (a Summary button): quiet, easy to forget | DM gate | STATS, CBT, NOTE |
| OQ-STATS-28 | Summary: what surface? | **A. The Stats window opens on the fight with Highlights** (placed like any window): one place for stats, no modal · B. A centred dialog over the map: big moment, blocks play and the placer · C. A large card toast: light, too small for a leaderboard | DM gate | STATS, SHELL |
| OQ-STATS-29 | The DM Ends with hidden monsters | **A. Players' summary from public facts only; never survivors, hidden names or "victory"; the DM sees Still standing**: zero leak, nothing to remember · B. Players get no summary while a hidden monster still has HP: safest, players miss summaries after retreats | DM gate | STATS |
| OQ-STATS-30 | Campaign-wide numbers at 100 sessions (≈ 1 s a query) | **A. Session partials in server memory ([proposed ADR](../architecture/adr/proposed-s8-sb-session-partials.md))**: ≈ 25 ms warm, ≈ 1 s once per server run · B. Compute every time: no new rule, ≈ 1 s on each refresh of an open Trophies / Luck tab after any fact · C. Materialised tables (ADR-0059 B): schema lane, backfill, drift | DM gate (ADR) | STATS, ADR-0059 |
| OQ-STATS-31 | Glossary: Kill feed, Fight summary (Highlights), Luck tracker, Trophy case | **A. Add** · B. None | no (integrator) | glossary |
| OQ-STATS-32 | Seam **WF**: feed toasts and the summary open vs the toast stack and the placer | **A. Feed = the info stack's existing transient toast (4 s; WF's cap / "+N more" applies); the summary = an ordinary `stats.board` open through WF's placer (useful size incl. Highlights' first rows)** · B. Feed and summary get their own region / keep-out | no (seams; owner orchestrator) | NOTE, SHELL |
| OQ-STATS-33 | Seam **TT**: roll-request and macro rolls in Luck | **A. Counted like any roll iff they're `roll` rows listed in a log entry's `rollIds` with `public` per FR-DICE-13 (a results-hidden request counts for the DM only; an audience-only result line counts for the DM only, FR-DICE-72)**; no new roll table, no "request" flag needed · B. Excluded from Luck (needs a flag on the roll) | no (seams; owner orchestrator) | DICE, DICEX |
| OQ-STATS-34 | Seam **CB**: dragged initiative order in the summary | **A. None: Highlights and the table sort by Dealt; SB never touches `lifecycle.ts` or rows; `rule-hooks.ts` is an append** · B. Show the fight's final order | no (seams; owner orchestrator) | CBT, CBTX |

## 16. Out of scope

- *(Sprint 8: kill feed, trophy case, luck tracker and end-of-combat summary moved in, §6.1.)* XP, charts, export, party-wide campaign records, session records ([campaign-manager](post-mvp/campaign-manager.md)).
