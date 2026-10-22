---
title: Session recap
prefix: RECAP
status: in-review
owner: spec-sp
phase: post-mvp-9
---

# Session recap

> Five-minute read. See [AGENTS.md](../../AGENTS.md). **Sprint 9, track SP** (DM [#338](../decisions-log.md), decided: a session recap, tier B, from the event log and stats). Promoted from the [campaign-manager](post-mvp/campaign-manager.md) stub's recap row. Everything below the decision is **proposed**: picks in §15 (OQ-RECAP-01–15). Integrator seams S4, S6–S10, S14 applied (OQ-RECAP-08, -10, -14, -15 resolved); review-a rulings 4, 5, 16, 20 applied. Sessions stay derived ([ADR-0013](../architecture/adr/0013-session-journal-scope.md)'s decision unchanged; a note on its consequences, OQ-RECAP-13); numbers follow [stats](stats.md) ([ADR-0059](../architecture/adr/0059-stats-read-models.md), [ADR-0062](../architecture/adr/0062-stats-session-partials.md)).

## 1. Summary

- A **Recap** window: one session at a glance: fights with kills and downs, the party's tally, loot gained and spent, notable rolls (nat 20s / 1s) and the session awards.
- **Computed on read** from the facts stats already reads, plus the loot ledger, **filtered per viewer before counting**: players see what their screens showed, never a hidden roll or monster. Nothing is stored for it.
- The DM can **Share** it: everyone's Recap opens on that session, with an optional short **note** and sections left out; the share is one notification row.
- **Copy as Markdown** for the DM's own notes (Obsidian).

## 2. Scope

- Recap of any session the viewer can list (stats' derived sessions: a ≥ 6 h gap starts a new one), the newest live.
- DM Share (note ≤ 280 chars, sections to leave out); share notification + open on every client; history **Open**.
- Copy as Markdown (both roles; what the viewer sees).
- *(proposed)* Entry points: the palette ([FR-SHELL-186](play-shell.md#6-functional-requirements)), a **Recap** button on Stats' Session tab ([FR-STATS-79](stats.md#62-sprint-9-recap-reads-track-sp)), the share notification. No launcher button (OQ-RECAP-02).

## 3. Goals

- At the end of the night, one click shows the table what happened; one more shares it.
- Zero leaks: a player's recap never names a hidden monster or shows a hidden roll, HP, AC or overkill amount (FR-RECAP-08).
- Every past session works, with no backfill (computed).
- ≤ 50 ms per recap at 100 sessions of history (§12).

## 4. Non-goals

- A story journal or session notes beyond the share note: story belongs to [world-builder](post-mvp/world-builder.md) (ADR-0013). Editing the computed numbers.
- A stored session entity, "End session" marker or session record (ADR-0013, OQ-STATS-09 A).
- XP (OQ-RECAP-07), reminders and strongholds (OQ-RECAP-08), handouts, gems, charts, PDF export.
- A generated story recap ([feature tiers](../feature-tiers.md#6-table-specific) "Auto session recap from event log", tier D: "recaps are story"): this recap is a mechanical summary plus the DM's own note.

## 5. User stories

- **DM:** At 23:40 I open Recap, check the three fights, the loot and Thorn's two nat 20s, add "Cleared the Bandit Camp; the map points north", untick Notable rolls and Share. Next week I paste last session's Markdown into my notes.
- **Player:** When the DM shares, the Recap opens on my screen: what we killed, who went down, what we found. A week later I open it again from the palette.

## 6. Functional requirements

**Read path and visibility**

| ID | Requirement |
|---|---|
| FR-RECAP-01 | **Computed on read.** `recap.query {n?}` (DM, player): a read-only command (no write, event, log row or `seq`), answered in hub frame order like `stats.query` (FR-STATS-16). Nothing is stored for a recap except share rows (FR-RECAP-20). |
| FR-RECAP-02 | **Session** = stats' session (FR-STATS-13: key `fromN`, any `n` inside resolves to it), picked with stats' rule (the viewer's listable sessions; `n` absent = the newest). Unknown or unlisted `n` → `not_found`. |
| FR-RECAP-03 | **Filter, then aggregate** (FR-STATS-03): DM all facts; players the hub filter for a viewer with no `playerId` (public entries only), so every player gets the same recap. Feature-tagged kinds are skipped while their feature is off. Undone facts and superseded rolls never count (FR-STATS-02). |
| FR-RECAP-04 | **Reads through stats** ([FR-STATS-78](stats.md#62-sprint-9-recap-reads-track-sp)): `pickSession`, `sessionStats` (awards), `luckStats` (session scope), `fightsFor` / `fightStats` (highlights), `luckRolls`; plus the loot ledger in the session's time range (FR-RECAP-14). No second copy of a formula. |
| FR-RECAP-05 | **Rate limit per actor** (kept per actor: #327 and track FX's FR-STATS-69, per viewer with a quiet client retry once after 1 s; review-a ruling 16): ≤ 2 queries / s; the excess is coalesced into the next, and a client whose query was coalesced retries once after 1 s. Separate from stats' limit. Repeats are cheap because of the memo (FR-RECAP-29). |
| FR-RECAP-06 | **Live refresh** while the window shows the **newest** session and is not minimised: re-query (trailing 2 s) on a live `game-log-entry` or `loot-entry` upsert, and after each snapshot; the server answers from the memo (FR-RECAP-29) when nothing counted changed. Older sessions re-query only after a snapshot or a picker change. |
| FR-RECAP-07 | **Retroactive and stateless**: every past session, no backfill; a crash loses only an answer; reconnect → re-query (last result muted meanwhile). |
| FR-RECAP-08 | **Player schema** (strict zod per role): no applied HP, HP, AC, temp HP, overkill amount, encounter name, hidden mark, Still standing, `dm-dice` or hidden roll. Players' fight labels are stats' neutral "Fight N · ‹date›"; players' kill lists never name a hidden monster (FR-STATS-35). Acks pass the leak scan. |
| FR-RECAP-09 | **DM extras**: encounter names, hidden marks (eye-off), overkill amounts, Still standing per fight, hidden rolls in Notable rolls (marked), DM dice nat 20s / 1s. |

**Contents** (OQ-RECAP-03 A; section keys in brackets)

| ID | Requirement |
|---|---|
| FR-RECAP-10 | **Window `recap.session` "Recap"** (both clients): no launcher entry (OQ-RECAP-02 A); opened by the palette's "Session recap", Stats' Session tab **Recap** (FR-STATS-79), a share (FR-RECAP-21) and history **Open**. Default 440 × 560 (1280×720: 440 × 412), min 340 × 320, `usefulSize` 400 × 360 (criterion: header + the first 4 fight lines). Registers **after PM1** (seams S4): one `windows.ts` line per client, a size-table row with that criterion, goldens regenerated (`UPDATE_GOLDEN=1`), membership in the replay harness as an **untouched window in sets D3 (DM) and P1 (player)**, `replay.failing.json` regenerated (never hand-merged). Instance `main`; the picked session is view state. |
| FR-RECAP-11 | **Header** [`header`]: the date label and times the viewer sees (stats' clipped span), duration, number of fights; session picker `recap-session-picker` (stats' list and labels). |
| FR-RECAP-12 | **Fights** [`fights`]: each fight with a counted fact the viewer sees in the session (stats' fight count rule), oldest first: label (DM: name), rounds, duration (`startedAt` → `endedAt`, "running" if started), MVP, Kills and Downs in order (FR-STATS-31's lists, per role). DM: Still standing. ≤ 12 fights, then "+N more". |
| FR-RECAP-13 | **Party** [`party`]: one row per party character with a counted fact or roll in the session: Dealt, Kills, Times downed, Healed (FR-STATS-06–09, companions rolled into the owner), Nat 20, Nat 1, Avg d20 (FR-STATS-38, session scope). By Dealt. |
| FR-RECAP-14 | **Loot** [`loot`] (OQ-RECAP-11 A): loot-ledger rows created in the session's time range (`from` ≤ `createdAt` < the next session's `from`; the newest session: up to now) whose one side is `world` and the other the party or a character: coins gained / spent (`loot` rows, ± amounts, and coin moves to / from the world), items found / removed (item rows). Moves between the party and characters are left out. **Stores rule** (seams S8): a row with any end that is a stronghold's Stores (track RS's `stores` end kind) counts as a move and is left out, for the DM too, so a DM-only Stores (`stores_hidden`) never reaches a player's recap. Read through `lootRows(db, campaignId, fromAt, toAt)`, a new file in party-loot's folder (by assignment), after RS0. Totals per coin (net) and per item name. ≤ 60 rows, then "+N more"; totals always complete. Same for every viewer (FR-LOOT-10). Test `FR-RECAP-14 stores rows never in a recap` (a hidden Stores receiving coins and an item: absent from DM and player acks; leak scan). |
| FR-RECAP-15 | **Notable rolls** [`rolls`]: counted rolls (luck's rule, FR-STATS-37: a character actor, not initiative) with a natural 20 or 1, oldest first: "Mira · nat 20 · ‹roll label›"; ≤ 12, then "+N more". Players: public only. |
| FR-RECAP-16 | **Awards** [`awards`]: the session's nine awards (FR-STATS-12, per role), as Stats' Session tab shows them. |
| FR-RECAP-17 | **Empty states**: no sessions → "No sessions yet"; a section with nothing → hidden, except Fights ("No fights this session"); nothing at all → "Nothing happened yet this session". Loading skeleton; "Couldn't load the recap" + Retry; offline → last result muted, picker and Share off. |
| FR-RECAP-18 | **Limits**: ack ≤ 64 KB (measured ≤ 11 KB, §12); names as stored on facts (an ended summon keeps its name, FR-STATS-04). |
| FR-RECAP-19 | **Copy as Markdown** (`recap-copy`, both roles; OQ-RECAP-09 A): writes the visible recap as Markdown (a `##` heading, one `###` per section, bullets; the note as a quote) to the clipboard; Toast "Recap copied". Players' copy holds only their recap. Clipboard refused → Toast "Couldn't copy". |

**Share** (OQ-RECAP-01 A, -05 B)

| ID | Requirement |
|---|---|
| FR-RECAP-20 | **`recap.share {fromN, note?, omit?}`** (DM): `fromN` a session key, `note` ≤ 280 chars (trimmed, control characters removed, plain text), `omit` ⊆ {`party`, `loot`, `rolls`, `awards`} (header and fights always show). One transaction: a `session-recap` notification (FR-RECAP-23) + its event-log row. Re-sharing makes a new row; the newest share of a session wins. Player → `forbidden`; unknown `fromN` → `not_found`. |
| FR-RECAP-21 | **Opens everywhere**: a live `session-recap` notification opens `recap.session` `by: "feature"` on that session in each client, under that client's own filter: placed by the ladder (PCs clear) only if the user never moved or resized it, else it reopens at its remembered spot; fronted (MRU) either way; it never moves another remembered window (seams S4, S14); the DM's own client only toasts. Paused players: deferred to resume (FR-SHELL-127). History **Open** (`note-session-recap-open`) does the same later. |
| FR-RECAP-22 | **Note and omit on view**: the ack carries `shared {note, omit, at} \| null` from the newest `session-recap` row of that session. The DM sees every section, those in `omit` marked "Hidden from players"; players' acks leave omitted sections out. **Omit is presentation, not secrecy**: every section holds only what players already saw. |
| FR-RECAP-23 | **Kind `session-recap`** (one line in `notifications/kinds.ts`, append): audience `all`, no action (state `info`: a toast + a history row), `payloadMaxBytes` 2,048; payload zod `{fromN, toN, from, to, label, note?, omit}` (times = what players see, as `stats-awards`'s `awardsPayload`); text "Session recap: ‹label›". Views in both `notification-views.ts` (append): icon lucide `ScrollText`, **Open**. |
| FR-RECAP-24 | **Share dialog** (DM, `recap-share`): Textarea "Note for the table (optional)" with a 280 counter, one Checkbox per optional section (all ticked), **Share** (`recap-share-send`, disabled unless `live`); ack → Dialog closes, Toast "Recap shared". Reject → inline message, draft kept. |

**Cost, tests, registration**

| ID | Requirement |
|---|---|
| FR-RECAP-25 | **Bench** `recap.bench.ts` (in `bun run bench`, on stats' 100-session history + 12 loot rows a session): one recap ≤ 50 ms for the DM and a player (measured 30 / 37 ms naive, §12). The fights section shares one `fightsFor` per query. |
| FR-RECAP-26 | **CON-44**: no record type; a share row ≤ 2 KB inside the notification window (measured, §12). |
| FR-RECAP-27 | **Test IDs**: `recap-window`, `recap-session-picker`, `recap-section` (+ `data-record-id` = section key, `data-state` shown \| hidden-from-players), `recap-fight` (+ `data-record-id` = fight key), `recap-party-row` (+ character id), `recap-loot-row` (+ loot entry id), `recap-roll` (+ entry id), `recap-note`, `recap-copy`, `recap-share`, `recap-share-note`, `recap-share-omit` (+ `data-value` section), `recap-share-send`, `recap-empty`, `note-session-recap-open`. |
| FR-RECAP-28 | **Palette**: a "Session recap" command (`commands.ts`, append; [FR-SHELL-186](play-shell.md#6-functional-requirements)); keywords "recap summary session". |
| FR-RECAP-29 | **Recap memo** (review-a ruling 4): server memory, keyed `(session fromN, role dm | player, fact high-water n, loot high-water seq)`; **all players share one entry** (FR-RECAP-03), so a Share's fan-out to 7 clients costs ≤ 2 computes (DM + players). The fact high-water = the campaign's highest `game_log_entry.n` inside the session plus stats' fact version (FR-STATS-16: bumped by undo / supersede / owner changes); the loot high-water = the highest `loot_entry.seq` in the session's range (+ edits via `editedAt`). The `shared` part (FR-RECAP-22) is read per query outside the memo (one indexed read). In memory only, never persisted, dropped freely (≤ 2 entries per open session, LRU 32). Tests `FR-RECAP-29 seven concurrent recap.query → ≤ 2 computes`, `FR-RECAP-29 an undo / a new loot row recomputes, an unrelated line does not`. |

## 7. UI/UX notes

- [visual-direction](../design/visual-direction.md); shadcn Select, Card, Table, Badge, Dialog, Textarea, Checkbox, Tooltip, Toast. One scrolling column of sections (headings muted, small caps as Stats); Fights as compact Cards (Kills / Downs as wrapped lists); Party and Loot as Tables; awards as Stats' award cards (two columns ≥ 400 px).
- **DM view:** names, hidden eye-off marks, Still standing, overkill amounts; buttons **Share** and **Copy as Markdown** in the header; omitted sections greyed with "Hidden from players".
- **Player view:** neutral fight labels, public facts only; the note as a quoted block under the header; **Copy as Markdown** only.
- **States:** FR-RECAP-17.

## 8. Data model

**No new table, column or record type** (ADR-0013 holds).

| Source (owner) | Fields read | Use |
|---|---|---|
| `hp_change`, `game_log_entry`, `roll`, `combatant`, `encounter`, `entity` ([stats §8](stats.md#8-data-model)) | via stats' compute helpers (FR-STATS-78) | fights, party, rolls, awards |
| `loot_entry` ([party-loot](party-loot.md#8-data-model)) | kind, from / to kind and character, text, coins, qty, createdAt | loot (FR-RECAP-14) |
| `notification` kind `session-recap` (this spec, FR-RECAP-23) | payload `{fromN, toN, from, to, label, note?, omit}` | share note / omit |

- **Relations:** a share row → a session by `fromN` (no FK; sessions are derived). Loot rows → a session by `createdAt`.
- **Derived:** everything in a recap; Markdown text (client).
- **Persisted runtime state:** share rows only (notifications, kept forever, windowed in the snapshot like every notification). Server memory: none of its own (stats' session cache and partials).

## 9. API & events

**WS intents**

| Intent | Who | Validation | Ack |
|---|---|---|---|
| `recap.query {n?}` | DM, player | active campaign; `n` in a session the viewer can list | `{recap: {fromN, toN, from, to, label, fights[], party[], loot {rows, totals, more}, rolls {rows, more}, awards[], shared}}` per role (FR-RECAP-08) |
| `recap.share {fromN, note?, omit?}` | DM | session key; note ≤ 280; omit keys | `{notificationId}` |

**Events / frames**

| Event | Changes | Visibility rule |
|---|---|---|
| (none for `recap.query`) | read-only | ack to the caller only, per-role schema |
| `NotificationCreated` (kind `session-recap`, in `recap.share`'s transaction) | `notification` upsert | audience `all`: DM and every player; payload player-safe (times, label, note, omit) |

- **REST:** none. **Event log:** `recap.share` logs its notification (as `stats.showAwards`).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Query a recap | ✓ all facts | ✓ public facts, listable sessions | role from the connection; zod; rate limit |
| Share | ✓ | ✗ | `forbidden` |
| Copy as Markdown | ✓ | ✓ (own recap) | — (client) |
| Change a recap | ✗ | ✗ | no such command |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** last recap muted; re-query on reconnect; a share made while offline is in history (Open), not auto-opened (as FR-STATS-34).
- **DM disconnect / reconnect:** Share disabled until `live`; the dialog keeps its draft.
- **Server crash mid-share:** one transaction: no row or the row and its log entry; a crash after commit is a normal share (reconnect snapshot carries the row). Test seam `PP_TEST_CRASH=recap.share:before-commit` / `:after-commit`.
- **Undo, rerolls, late reveals:** a recap re-reads facts, so an undo drops the kill, a reroll counts only the final roll; a reveal doesn't backfill players' numbers (FR-STATS-04).
- **A session grows after its share:** the recap is live, the note stays (no frozen copy; OQ-RECAP-05 C would freeze it).
- **A fight across two sessions:** listed in each session it has counted facts in; highlights cover the whole fight (stats' fight scope) — accepted.
- **Loot between sessions** (a ledger row in a ≥ 6 h gap) belongs to the earlier session (`createdAt` < the next `from`).
- **Concurrent shares** (two DM tabs): two rows; the newest wins on view.
- **Invalid / malicious input:** strict zod; note clipped server-side to 280 after cleaning; unknown `omit` keys → `invalid`; spam → rate limit (query), the notification kind's own limits (share).
- **Leaks:** player acks are leak-scanned; omitted sections are dropped from players' acks; Stores rows never enter any recap (S8); the note is the DM's own text (shown as text nodes only).

## 12. Performance & bandwidth

Throwaway probes (deleted before commit): stats' bench history (100 sessions, 92k entries, 32k `hp_change`) + 12 loot rows a session; `session-sim-12` as loaded; the realistic-heavy harness for share rows. "Recap" = awards + luck (session) + highlights of each fight in the session + loot in range + notable rolls, composed from stats' existing compute functions.

| Figure | DM | Player |
|---|---|---|
| Recap compute, 100 sessions, mid / newest session (best of runs) | **31.6 / 29.8 ms** | **37.6 / 37.2 ms** |
| Ack, 100-session history (highlights only) | 10.9 KB | 8.3 KB |
| Ack with full fight tables instead (not picked) | 15.1 KB | 9.0 KB |
| `session-sim-12` (one fixture session: 3 fights, 13 loot rows) | 8.7 ms, 9.0 KB | 7.3 ms, 8.1 KB |
| **CON-44** one share row, 280-char note of 4-byte characters (heavy harness, sim-heavy base 691,560 B DM) | **+1,026 B** | **+1,025 B** each |
| CON-44 worst: every row of the closed-notification window a max share (120 rows) | 793,531 B (+102 KB; ceiling 1.5 MiB) | 388,144 B (+102 KB; ceiling 512 KiB) |

- A 500-char note would cost +1.9 KB a row and 476 KB worst for players: hence the 280 cap.
- Per share: one `NotificationCreated` (≈ 1 KB) to each connection, then one recap ack per client (≤ 11 KB). With the memo (FR-RECAP-29) a fan-out to the DM + 6 players costs **2 computes ≈ 70 ms**, not 7 ≈ 260 ms; live re-queries cost a memo hit (< 1 ms) unless a counted fact or loot row changed.
- `recap.query` runs synchronously in hub order: ≤ 38 ms of other frames' wait per **computed** query at 100 sessions; the memo and the rate limit bound how often.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

**Fixtures** (`fixtures/units/session-recap/`; headers list expected DM and player numbers per section):
- **`recap-loot-haul`** (setup; requires `loot-1`, `char-mira`, `char-thorn`; **`sp-s9` only, not session-sim-13**: it changes the party pot, same rule as RS's `hold-tower-move`; review-a ruling 20): in the fixture session (the load-time clock anchor, FR-FIX-29): "Bandit Camp strongbox" +40 gp 25 sp (world → party), "Healer's fee" −5 gp, `party.addItem` "Bandit captain's map" ×1, and Thorn's own "Silver ring" 15 gp (world → Thorn). session-sim-13's recap uses sim-12's existing loot rows.
- **`recap-share-note`** (setup; requires `recap-loot-haul`; `sp-s9-shared` only): `recap.share` of the fixture session with note "Cleared the Bandit Camp; the map points north." and `omit: ["rolls"]`.
- The rest comes from `session-sim-12`: the ended Bandit Camp with its Captain (`sb-past-bandits` via `stats-b-past`), the Old Crypt (`st-past-crypt`), nat 20s / 1s incl. hidden ones (`sb-luck-rolls`), the running ambush. The recap units' headers restate those units' expected kills, downs and rolls per role.
- **Bundles:** `sp-s9` ([play-shell §13](play-shell.md#13-test-plan)); **`sp-s9-shared`** = `sp-s9` + `recap-share-note`; e2e aliases `sp-s9-e2e`, `sp-s9-shared-e2e`.

**Named tests** (all `FR-RECAP-NN …`):
- **Unit:** 12 fight lines per role; 13 party rows (companion roll-up); 14 loot range (between sessions → earlier; moves out; totals complete past 60); 15 nat lines (initiative out, ≤ 12 + more); 19 Markdown per role (no hidden name in the player's); 20 note cleaning and 280 clip; 22 omit per role.
- **Integration:** 01 read-only (no row, event or `seq`); 14 stores rows never in a recap (S8: a hidden Stores with coins and an item, absent for DM and players); 29 seven concurrent queries → ≤ 2 computes; 29 undo / new loot recomputes, an unrelated line hits; 02 any `n` resolves, unlisted `n` → `not_found`; 03 same recap for player-1 and player-2; 03 undone and superseded excluded; 03 gems-tagged lines skipped while off; **08 leak scan per player** (acks: no HP, AC, overkill amount, encounter name, hidden name or roll); 09 DM extras; 05 rate limit coalesces; 07 three sittings (injected clock) → three recaps; 20 share: one row + log, player `forbidden`; 21 notification to all, payload player-safe; 22 newest share wins; 23 kind registered; hard kill → same recap (`state:digest` equal); crash seam before / after commit.
- **Client:** 06 live refresh (newest only, trailing 2 s, minimised off); 10 registered + opens from Stats / palette / history; 17 states; 21 opens `by: "feature"`, deferred while paused; 24 share dialog.
- **E2E (thin, `recap.e2e.ts`, `// e2e-bundle: sp-s9-e2e`):** DM opens Recap from the palette, Share with a note → player-1's Recap opens with the note ≤ 2 s.
- **Bench:** FR-RECAP-25.

**Browser walkthrough** (bundle `sp-s9`, verify profile, contexts `dm`, `player-1`, `player-2`, 1440×900; RC3 also at 1280×720):

| Step | DM (A) | Players (B, C) | Expect |
|---|---|---|---|
| RC1 | Palette "recap" → Enter | — | Recap on the fixture session: fights by name (incl. the ended Bandit Camp), hidden kills marked as the units' headers list, Still standing; loot incl. the strongbox; Notable rolls incl. the hidden DM nat 20 as Thorn (marked) |
| RC2 | — | B: Stats → Session → Recap | "Fight N · ‹load date›" labels (the anchored load clock, FR-FIX-29; review-a ruling 5), no hidden monster named, Thorn's nat 20s lower than A's by the hidden ones; loot identical to A's |
| RC3 | Share: note "Cleared the Bandit Camp", untick Notable rolls | B, C | Toast "Session recap: ‹load date›"; Recap opens with the note, no Notable rolls, no PC covered; A sees Notable rolls marked "Hidden from players" |
| RC4 | — | C: Copy as Markdown | Clipboard text has the heading, sections and note; no hidden name |
| RC5 | Apply a kill in the running ambush; add 10 gp loot | B on the current session | Same session (the load anchor is < 6 h ago, no new session); its recap gains the kill and the 10 gp ≤ 2 s; the note stays |
| RC6 | — | C: leak scan over frames and recap acks | No HP, AC, overkill amount, hidden name, encounter name |
| RC7 | Pause; share the session again with the note "Back after the break"; Resume | B, C | Nothing while paused; the Recap opens at resume with the new note (newest share wins) |
| RC8 | Reload all; history Open on the first share; hard kill + restart | same | Same recap and note; `state:digest` equal |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [stats](stats.md) FR-STATS-78–80 | exported compute helpers; Recap button on the Session tab | this track (SP3), after FX1 (S7) |
| [party-loot](party-loot.md) | `lootRows` read helper, Stores rule (FR-RECAP-14) | after RS0 (S8) |
| [notifications](notifications.md) | kind registry, views registry, info toasts | append-only (S6) |
| [play-shell](play-shell.md) | window registration, `commands.ts` (SP1), FR-SHELL-127 deferral, `by: "feature"` rule (S14) | after PM1 (S4) |
| Libraries | **none** | — |

**Build split**

| Slice | Files | ⚠ Shared (AGENTS §9.9) | Order |
|---|---|---|---|
| **SP3** `build/sp-recap` | new `src/server/features/session-recap/*` (commands, compose, rate limit, `recap.bench.ts`), `src/shared/session-recap/*` (zod per role), `@ui/features/session-recap/*` (window, share dialog, Markdown), `fixtures/units/session-recap/*`; stats: one new export in `features/stats/compute.ts` (FR-STATS-78) + the Session tab button (FR-STATS-79) | appends: `features/index.ts` + protocol record / intent lines (**after RS0 merges**, S10), `notifications/kinds.ts` + `notification-views.ts` ×2 (info class, no toast-runtime file, S6), `windows.ts` ×2 + PM's size-table row (`recap.session`), goldens regenerated, replay sets **D3 + P1** (untouched), `replay.failing.json` regenerated (S4), `bundles/index.ts`, `commands.ts`, `package.json` bench list (integrator); new `party-loot/recap-read.ts` (`lootRows`, after RS0, S8) | **Wave 2**: server part after RS0 (merges main first for its index / protocol lines, S10); ∥ SP1, SP2. The window after PM1 (S4). The stats edits after **FX1** merges (S7). |

- No schema lane: computed on read (S10: RS0 alone holds the schema lane).

## 15. Open questions

**Bold** = suggested pick, not decided.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-RECAP-01 | When does it appear? | **A. On demand; the DM's Share opens it for everyone**: like Show awards · B. Automatically at the next session's first entry ("Last time…" for everyone): no click, but sessions end only in hindsight (≥ 6 h gap) · C. An "End session" button that shares it: needs a session marker (supersedes ADR-0013) | yes (DM) | FR-RECAP-20, -21 |
| OQ-RECAP-02 | Where does it live? | **A. Its own window, no launcher button (palette, Stats' Session tab, share)**: room to read; launcher stays lean · B. A Recap tab in the Stats window: no new window, but 400 px and the stats client files track FX is fixing · C. Its own launcher button: easier to find, one more at 1280 px | yes (DM) | FR-RECAP-10 |
| OQ-RECAP-03 | What does it list? | **A. Fights (kills, downs), party tally, loot, notable rolls, awards** · B. A + XP from the killed monsters' CR · C. A + reminders, handouts, gems spent | yes (DM) | FR-RECAP-11–16 |
| OQ-RECAP-04 | Who sees it? | **A. Players any session they can list, same public numbers for all**: as Stats · B. Players only sessions the DM shared: a reveal moment, but the numbers are already public · C. DM only | yes (DM) | FR-RECAP-02, -08 |
| OQ-RECAP-05 | Can the DM edit it before sharing? | A. No: Share as is · **B. A note (≤ 280) + untick sections, carried in the share row**: no new table · C. A stored, editable recap (frozen text): a new table and record type, no longer live; a step towards a session entity (ADR-0013) | yes (DM) | FR-RECAP-20, -22 |
| OQ-RECAP-06 | Kept per session? | **A. Computed for every session; shares kept as notification rows (history)** · B. Only shared sessions kept | no | FR-RECAP-07 |
| OQ-RECAP-07 | XP? | **A. None** (the table may use milestones; stats has no XP either) · B. CR-based XP of counted kills, DM only · C. B for everyone (hidden monsters' XP leaks their CR) | yes (DM) | FR-RECAP-13 |
| ~~OQ-RECAP-08~~ | **Track RS (reminders, strongholds):** list reminders added / done this session? | **Resolved (integrator, seams S9):** no reminders and no stronghold events in the recap this sprint (agrees with OQ-REM-06 A and OQ-RECAP-03 A) | — | RS's reminders spec |
| OQ-RECAP-09 | Copy as Markdown | **A. Both roles, what the viewer sees** · B. DM only · C. None | no | FR-RECAP-19 |
| ~~OQ-RECAP-10~~ | **party-loot / track RS:** how the recap reads the ledger, now that RS adds a Stores holder | **Resolved (integrator, seams S8):** A: `lootRows` in party-loot's folder (by assignment) after RS0; any Stores end = a move, left out (FR-RECAP-14, leak test) | — | FR-RECAP-14 |
| OQ-RECAP-11 | Which loot rows? | **A. `world` ↔ party / character (gains, spends, items found / removed); no moves** · B. Every row incl. moves: noisy | no | FR-RECAP-14 |
| OQ-RECAP-12 | Glossary: **Session recap** ("the Recap window's summary of one derived session; computed, shareable with a note"), **Command palette**, **Shortcuts sheet** (play-shell) | **A. Add** | no (integrator) | glossary |
| OQ-RECAP-13 | **ADR-0013**'s consequence says the session recap stays a story tool, "not combat history"; DM #338 asks for a summary "from the event log and stats" | **A. The integrator adds an amendment note to ADR-0013 at merge (decision unchanged: no session entity, sessions derived; the recap may summarise combat and loot facts)** · B. A superseding ADR | no (integrator; DM ack at gate) | ADR-0013 |
| ~~OQ-RECAP-14~~ | **notifications (track FX holds the toast runtime):** the `session-recap` kind | **Resolved (integrator, seams S6 + S7):** info class; SP3 appends only to `notifications/kinds.ts` and both `notification-views.ts`, no toast-runtime change; the NOTE kind row from FR-RECAP-23 at merge | — | FR-RECAP-21, -23 |
| ~~OQ-RECAP-15~~ | **stats / track FX:** SP3's stats edits (one `compute.ts` export, the Session tab button) | **Resolved (integrator, seams S7):** one holder at a time: FX1 first, then SP3's stats edits; SP3's server work and window start without waiting; no read-model change by FX | — | FR-STATS-78, -79 |

## 16. Out of scope

- Story notes and journals ([world-builder](post-mvp/world-builder.md)); a session entity; XP; reminders and strongholds in the recap (OQ-RECAP-08); handouts; gems; charts; export beyond Markdown; editing numbers; recaps across campaigns.
