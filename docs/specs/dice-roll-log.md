---
title: Dice and game log
prefix: DICE
status: in-review
owner: spec-dice-roll-log
wave: 2
---

# Dice and game log

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Server-side dice via `@dice-roller/rpg-dice-roller` ([ADR-0001](../architecture/adr/0001-tech-stack.md)), numbers from one injectable seam (`ctx.dice`). Every roll can instead be a **manual roll** from physical dice ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #43).
- **Game log** (tier S): a play-shell window with BG2-style lines, e.g. *"Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage."* Persisted per campaign; survives a crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- **Public log settings** (tier S): DM tickbox per roll category decides whether DM rolls reach players. Player rolls are always public (#73).
- Other features (character sheet, combat tracker) roll and write log lines through this spec's internal APIs and typed **log-entry kinds**.

## 2. Scope

- Free roll from a dice expression; click-to-roll component for other features (`RollButton`).
- Advantage / disadvantage on any d20 roll: toggle, or **Shift = advantage, Ctrl = disadvantage** (tier S).
- Manual roll (DM and players), marked manual. Physical-dice mode toggle per client.
- Roll categories: attack, damage, saving throw, ability check, skill check, contested, initiative, healing, other.
- Public log settings per campaign, changeable live; per-roll public/hidden override (DM); DM reveals or hides a single DM-rolled entry.
- Game log window `dice.log` (both clients); typed entries so text can join later (chat tier C–D, #61).
- Every roll persisted with roller, actor, context, automated vs manual ([stats](post-mvp/stats.md), #54).

## 3. Goals

- Every roll at the table is server-made or explicitly manual, and visible to exactly the right people.
- Players read what happened in combat from the log instead of asking. The DM hides what should stay hidden, per category, without per-roll effort.
- Stats can later be computed from persisted rolls without retrofits.

## 4. Non-goals

- 3D dice, inline rolls, macros, roll requests, whispers (→ [dice-extras](post-mvp/dice-extras.md)). Text chat (tier C–D).
- Client-side authoritative rolling. Editing or deleting rolls or entries. Undo of rolls (#67).
- Saves, skills and DCs on the sheet (→ [character-sheet-full](post-mvp/character-sheet-full.md)); hit/miss and damage outcomes (→ [combat-tracker](combat-tracker.md) kinds).
- Older-history browsing beyond the snapshot window (OQ-DICE-04). Stats UI (→ [stats](post-mvp/stats.md)).

## 5. User stories

**DM**
- As the DM, I want to tick which categories of my rolls players see, so that attack rolls are public but my Perception checks stay secret.
- As the DM, I want to make one roll hidden (or reveal one later), so that I can handle exceptions without changing the settings.
- As the DM, I want to roll physical dice and type the result, so that I keep my dice and the log stays complete.

**Player**
- As a player, I want to Shift-click my attack to roll with advantage, so that I don't fiddle with options.
- As a player, I want to read every public roll in one log, so that combat feels fair and I can catch up after looking away.
- As a player, I want to enter my physical die result, so that I can roll real dice.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-DICE-01 | Expression grammar: terms joined by `+`/`-`; term = `NdM`, `NdMkhK`, `NdMklK` or integer constant. N 1–50, M 2–1000, K 1–N, constants 0–999, ≤ 10 terms, ≤ 50 dice total, ≤ 60 chars; case-insensitive, spaces ignored. Checked by zod **before** the library; else `invalid` with a readable message. *(limits proposed, OQ-DICE-20)* | ⊇ entities' damage grammar |
| FR-DICE-02 | The server evaluates every automated roll with the library; its numbers come only from `ctx.dice`. Clients never send results except manual rolls (FR-DICE-06). | OQ-DICE-03 |
| FR-DICE-03 | **Dice seam `ctx.dice`** on the command context, beside `ctx.ids` / `ctx.tokens` / `ctx.clock`: an engine `{next(): int32}` the library draws from. Real = CSPRNG. Seeded = deterministic engine; the fixture loader reseeds it with `ids` from `(fixed seed, fixture key)`; `bun test` passes a seed. Built by the same factory and guard as [ADR-0022](../architecture/adr/0022-deterministic-seams.md): seeded only when the data dir is disposable; a running server always uses the real engine. The library's generator is process-global: the roll service sets it to `ctx.dice` for one synchronous evaluation and restores it. Lint/review: no `Math.random` or default library engine outside the seam. | AGENTS §9.3, OQ-DICE-18 |
| FR-DICE-04 | Roll mode `normal` / `advantage` / `disadvantage`. Adv/dis rewrites the expression's first `1d20` term to `2d20kh1` / `2d20kl1`; no `1d20` term → `invalid` "Advantage needs a d20 roll". Both dice kept in the breakdown, dropped die marked. | 5e |
| FR-DICE-05 | Client: Shift+click / Shift+Enter = advantage, Ctrl+click / Ctrl+Enter = disadvantage, both = normal; keys override the window's mode toggle for that roll. | Tier S |
| FR-DICE-06 | Manual roll: payload `manual {diceTotal, dice?}`. `diceTotal` = sum of kept dice, within the dice part's min–max; optional `dice` = every die value (count and faces must match; kept dice computed server-side; sum must equal `diceTotal`). Constants added by the server. Out of range / mismatch → `invalid`. Stored and shown as manual. | OQ-DICE-07 |
| FR-DICE-07 | Physical-dice mode: toggle in the game log window, per client, stored in browser storage `pp.dice.v1.<campaignId>.<dm \| playerId>`. On → every roll (roll bar, `RollButton`) opens a manual-entry popover showing the expression and mode instead of rolling. | OQ-DICE-21 |
| FR-DICE-08 | Each roll is one immutable `roll` row (§8), written in the calling command's transaction. Never updated or deleted. | Stats source |
| FR-DICE-09 | WS intent `dice.roll {expression, mode, category, label?, actor?, manual?, public?}` (DM, player) writes one roll + one `roll`-kind entry + event-log row in one transaction, emits `DiceRolled`, acks `{rollId, entryId}`. | |
| FR-DICE-10 | Actor: player → omitted (= own player name) or `{entityId}` of a character they own (else `forbidden`; not visible → `not_found`). DM → omitted (= "DM"), `{entityId}` (via `resolveDefinition`) or `{tokenId}` in the campaign. The actor's display name is copied into the entry at roll time. | [FR-ENT-12](entities.md#6-functional-requirements) |
| FR-DICE-11 | `label` ≤ 60 chars, trimmed, no control chars, rendered as text. `category` required (default `other`). | |
| FR-DICE-12 | Public log settings: one per campaign, one boolean per category; absent row = defaults (all hidden, *proposed*, OQ-DICE-14). `dice.setCategoryPublic {category, public}` (DM) emits `PublicLogCategorySet`. Applies only to entries created after its commit. | OQ-DICE-10 |
| FR-DICE-13 | Entry `public` is stamped at creation: roller is a player → `true`, always (a player `public` field → `forbidden`). Roller is DM → the `public` override if given, else the category's setting at that moment. | #73, OQ-DICE-11 |
| FR-DICE-14 | `dice.setEntryPublic {entryId, public}` (DM) flips one DM-rolled entry; player-rolled → `conflict` "Player rolls are always public"; same value → no-op, no event. Players see it appear / disappear ≤ 1 s (transition matrix). | OQ-DICE-10 |
| FR-DICE-15 | Visibility `game-log-entry`: DM full. Player: `public` → redacted (record minus `dmPayload`); else hidden. Hidden entries leave no trace for players (no placeholder). | OQ-DICE-09 |
| FR-DICE-16 | Visibility `game-log-settings`: `audience: dm`; never sent to players. | |
| FR-DICE-17 | Entries carry `n`, a per-campaign counter (max + 1 in the transaction). Clients order by `n`. Snapshot provider: the campaign's newest 100 entries by `n` (*proposed*, OQ-DICE-04); players get the visible subset. | ADR-0022 tiebreak |
| FR-DICE-18 | Log-entry kind registry in `@shared/dice` (append-only): `kind → {payload schema, dmPayload schema?, formatLine}`. Dice ships `roll`. Unregistered kind on write → `internal`; client renders an unknown kind as "Unsupported entry". | Text kind later |
| FR-DICE-19 | Internal server APIs, inside the caller's transaction: `dice.evaluate(ctx, input) → Roll` (FR-DICE-01–08; row only, no entry, no event); `gameLog.append(ctx, {kind, category, actorName, payload, dmPayload?, rollIds, encounterId?, public?}) → RecordChange` (stamps `n`, `at`, `public` per FR-DICE-13); `gameLog.markUndone(ctx, entryId) → RecordChange`. The caller lists the returned changes in its own domain event. | [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) |
| FR-DICE-20 | `roll` line (`formatLine`, pure, `@shared`): `<actor> — <label or expression>: <dice> + <constants> = <total>`; adv/dis shows "(adv)" / "(dis)" and the dropped die struck through; a single kept d20 of 20 / 1 appends "— natural 20!" / "— natural 1"; manual shows a "physical" marker. | BG2 style |
| FR-DICE-21 | Window `dice.log`, both clients, default open: entries oldest → newest; sticks to the bottom unless the user scrolled up, then shows "N new". Live ≤ 1 s after commit. DM: hidden entries muted with an eye-off marker; DM-rolled entries have a reveal/hide toggle. Undone entries struck through with "undone". | [play-shell](play-shell.md) |
| FR-DICE-22 | Roll bar (window footer): expression, category, label, mode toggle, physical-dice toggle; DM also a public toggle preset from the category's setting. Enter rolls. On `ack` the input clears; on `reject` it stays with the message inline. Disabled unless `live`. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-DICE-23 | DM settings popover (window header): one checkbox per category; change sends `dice.setCategoryPublic`; reflects other DM tabs ≤ 1 s. | |
| FR-DICE-24 | `@ui` exports `RollButton` (props: expression, category, label, actor, testId) and `rollModeFromEvent(e)`: modifier keys, physical-dice popover, sends `dice.roll`. Used by character-sheet and other features for plain rolls. | OQ-DICE-22 |
| FR-DICE-25 | Same seed + same command sequence → identical roll values, entries and `n` (fixture load, tests). | FR-FIX-08 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, semantic tokens (`visibility.hidden` placeholder for the hidden marker).

- **Window `dice.log`** "Game log": both clients, default open, bottom-left above the launcher, 420×320, min 300×200, launcher "Log" *(proposed; answers [OQ-SHELL-06](play-shell.md#15-open-questions))*.
- **Line:** actor bold, text body, total bold; category as a small muted Badge; Tooltip = time + expression + all dice. Kept/dropped dice inline; "physical" Badge for manual.
- **Roll bar:** Input (expression), Select (category), Input (label), ToggleGroup (Dis / Normal / Adv), Switch "Physical dice"; DM: Switch "Public". Manual popover: dice total Input (+ optional per-die Inputs), expression shown read-only.
- **States:** empty "No rolls yet"; loading skeleton; disconnected: last log stays, banner, roll bar disabled; reject: inline error under the bar.
- **DM view:** all entries; hidden ones muted + eye-off, reveal/hide toggle on DM-rolled entries; settings popover (gear).
- **Player view:** public entries only, no hidden markers, no settings, no public toggle; actor Select offers own character(s) or "me".
- **Keyboard:** Enter / Shift+Enter / Ctrl+Enter in the expression input. macOS Ctrl+click opens a context menu: Mac users use the toggle (laptops per ADR-0007; accepted).
- **Test IDs:** `dice-log`, `dice-log-empty`, `dice-log-new`, `dice-log-entry` + `data-record-id` + `data-public`, `dice-log-entry-manual`, `dice-log-entry-toggle-public`, `dice-roll-expression`, `-category`, `-label`, `-mode` (+ `data-record-id=normal|advantage|disadvantage`), `-physical`, `-public`, `-submit`, `-error`, `dice-manual-total`, `dice-manual-die`, `dice-manual-submit`, `dice-settings-open`, `dice-settings-category` + `data-record-id=<category>`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Roll *(server table; not a record type)* | id, campaignId, at | ID, ID, timestamp | `ctx.ids`, `ctx.clock` |
| | rollerRole, rollerPlayerId | `dm` \| `player`, ID \| null | From connection context |
| | actorKind, actorId, actorName | `dm` \| `player` \| `entity` \| `token`, ID \| null, text | Name copied at roll time |
| | targetEntityId, targetTokenId, targetName | ID \| null ×2, text \| null | Set by callers (combat) only |
| | category, label, source | enum, text \| null, text | `source` = `dice` or caller prefix (`cbt`, `char`) |
| | expression, mode, manual | text (normalised), enum, bool | |
| | dice | **JSON leaf** `{faces, value, kept}[]` | All dice incl. dropped |
| | constant, total, natural | int, int, int \| null | `natural` = single kept d20 value |
| | entryId | ID \| null | Null when never logged (e.g. cancelled attack popup) → treated as hidden by stats |
| Game log entry (`game-log-entry`) | id, campaignId, n, at | ID, ID, int, timestamp | Unique (`campaignId`, `n`) |
| | kind, category, public, undone | text, enum, bool, bool | `undone` set via `gameLog.markUndone` |
| | rollerRole, rollerPlayerId, actorName | as Roll | |
| | payload | **JSON leaf** per kind | Player-safe; `roll` kind: roll display copies `{rollId, expression, mode, manual, dice, constant, total, natural, label}[]` (1–20) |
| | dmPayload | **JSON leaf** \| null | DM-only extras (e.g. target AC, OQ-DICE-13); stripped for players |
| | rollIds, encounterId | ID[], ID \| null | `encounterId` set by combat-tracker |
| Public log settings (`game-log-settings`) | id (= campaignId), campaignId | ID | One row per campaign, created on first change |
| | attack … other | bool × 9 | Defaults per OQ-DICE-14 |

- **Relations:** Campaign 1—* Roll, Entry; Entry 1—* Roll; Roll → Player, Entity, Token by id (no FK; names copied).
- **Derived values:** line text (`formatLine`), natural 20/1, effective settings (row or defaults). **Persisted runtime state:** rolls, entries, settings. Physical-dice mode: browser only.

## 9. API & events

**REST:** none. Live play over WS ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D).

**WS intents (client → server)**

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `dice.roll` | DM, player | FR-DICE-01, 04, 06, 10, 11, 13 | `{rollId, entryId}` |
| `dice.setEntryPublic {entryId, public}` | DM | Entry in `ctx.campaignId` else `not_found`; player-rolled → `conflict` | — |
| `dice.setCategoryPublic {category, public}` | DM | Category enum | — |

**Record types** (generic record changes + `cause`, scope `campaign`)

| Type | Visibility rule | Snapshot provider |
|---|---|---|
| `game-log-entry` | DM full; player redacted (minus `dmPayload`) iff `public`, else hidden | Newest 100 by `n` |
| `game-log-settings` | `audience: dm`; DM full | Row, or defaults with `id = campaignId` |

**Domain events** (all logged; none undoable or transient)

| Event | Emitted by | Payload | Changes | Player sees |
|---|---|---|---|---|
| `DiceRolled` | `dice.roll` | `{entryId, rollIds}` | `game-log-entry` upsert | upsert iff public |
| `LogEntryVisibilitySet` | `dice.setEntryPublic` | `{entryId, public}` | `game-log-entry` upsert | hidden→visible `upsert`, visible→hidden `delete` |
| `PublicLogCategorySet` | `dice.setCategoryPublic` | `{category, public}` | `game-log-settings` upsert | nothing |
| *(callers' events)* | `gameLog.append` / `markUndone` | caller's, incl. `rollIds` | `game-log-entry` upsert listed by caller | per entry rule |

- No intent is optimistic ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) E). No listeners added. No signals. Roll facts for stats: immutable `roll` rows joined via `rollIds` in event payloads.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Roll (automated / manual) | ✓ any actor in campaign | ✓ as self or own character | FR-DICE-10 ownership |
| Set public override on a roll | ✓ | ✗ | `forbidden` |
| Reveal / hide one entry | DM-rolled only | ✗ | role; `conflict` for player-rolled |
| Change public log settings | ✓ | ✗ | role |
| Read entries | all | public, redacted | FR-DICE-15 |
| Edit / delete rolls or entries | ✗ | ✗ | no command exists |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** roll bar disabled; an in-flight `dice.roll` is never resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)); the input keeps its text (no `ack`). Reconnect snapshot shows the roll if it committed; the player sees it and doesn't re-roll.
- **DM disconnect / reconnect:** same; players unaffected. Settings and hidden state are server-side.
- **Server crash mid-action:** roll row + entry + event-log row commit together or not at all. After restart, snapshots equal pre-crash state; settings intact.
- **Concurrent edits:** rolls serialise; `n` = commit order. Two DM tabs toggle a category → last commit wins, both tabs converge. Category toggled between a roll and its commit → the setting at commit applies.
- **Campaign switch:** the new campaign's log and settings; no cross-campaign entries (scope gate).
- **Hidden actor leak:** a public DM roll for a hidden token shows its display name. DM's call: per-roll Public toggle; combat-tracker may preset hidden for hidden combatants (OQ-DICE-17).
- **Renames:** entries keep the name at roll time.
- **Invalid / malicious input:** `1000d1000`, `1d20*5`, functions, 61+ chars → `invalid` before the library; library throw → `invalid`. Manual out of range, wrong die count → `invalid`. Player `public` → `forbidden`; other's character → `forbidden`. Labels rendered as text.
- **Log growth:** rows kept forever (~1 KB/roll; 10 k rolls ≈ 10 MB); snapshot stays bounded (FR-DICE-17). A live session's store grows past 100 until the next snapshot (proposed ADR, below).

## 12. Performance & bandwidth

- Entry typically 300–600 B on the wire; schema hard max (20 rolls × 50 dice) ≈ 8 KB. `DiceRolled` event ≈ 0.6 KB × 7 connections per roll; rolls are human-paced.
- DM snapshot: 100 entries ≈ 60 KB typical, ≤ 100 KB, inside live-sync's 512 KB beside scenes ≤ 300 KB and entities ≤ 40 KB.
- Evaluation ≤ 50 dice: sub-millisecond; commit → frame < 50 ms locally ([live-sync §12](live-sync.md#12-performance--bandwidth)).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:` + seeded `ctx.dice`.

**Fixtures** (setups run as DM, FR-FIX-13; seeded dice per fixture key, so values are stable)

| Key | Kind | Requires | Contents | In `session-sim` |
|---|---|---|---|---|
| `dice-settings` | setup | `campaign` | `dice.setCategoryPublic` true for attack, damage, initiative, healing | yes *(proposed)* |
| `rolls-1` | setup | `dice-settings`, `char-mira`, `enemy-1` | e1: actor Goblin, attack "Scimitar" `1d20+4` → public. e2: actor Goblin, damage `1d6+2`, `public:false`, label "DM-SECRET-ROLL" → hidden. e3: skill "Perception" `1d20+3` → hidden (category off). e4: actor Mira, initiative `1d20+2`, manual 15 → public, manual | no |

- **Bundle `dice-log`** = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `dice-settings` + `rolls-1`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Grammar + limits (incl. `1000d1000`, `1d20*2`, `kh` bounds); adv/dis rewrite and no-d20 error; Shift/Ctrl/both → mode; manual range, die count, kept calc; `formatLine` snapshots (adv, dis, nat 20, nat 1, manual, multi-roll); visibility matrix (DM / player × public / hidden; `dmPayload` stripped); stamping rules FR-DICE-13; seeded determinism; real factory refuses seeding on a non-disposable dir | In-code |
| Integration | `dice.roll`: roll + entry + log in one tx, event before `ack`, rollback → none. Ownership: `player-1` as Mira ✓, as Thorn `forbidden`, with `public` `forbidden`. Category change not retroactive. `setEntryPublic`: upsert/delete per player, player-rolled → `conflict`, no-op → no event. Settings never in player frames. Window: 105 entries → newest 100, ordered. Test-registered kind via `gameLog.append` + `markUndone` commits/rolls back with its caller. **Leak scan:** player frames never contain "DM-SECRET-ROLL" or `dmPayload`. Restart → identical snapshots. Convergence over the window (proposed ADR) | `dice-log` |
| E2E (thin) | DM + `player-1`: player Shift+Enter roll appears for DM; DM hidden roll absent from player frames; DM reveals it → player sees it | `dice-log` |

**Browser walkthrough** — `PP_TEST_MODE=1` (for "drop connection"); `bun run build`, `fixtures:reset-load dice-log --profile verify`, `start --profile verify`; evidence per AGENTS §9.6. Contexts **A** DM, **B** `player-1`, **C** `player-2`. Automated totals are random: check *total = kept dice + constants*. Teardown: stop server, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | — | Game log open: e1–e4; e2, e3 muted + eye-off; e4 "physical" |
| 2 | — | B, C open links | Both see e1, e4 only; frame logs contain no "DM-SECRET-ROLL" |
| 3 | — | B: actor Mira, attack, `1d20+4`, Shift+Enter | A, B, C: "(adv)", two d20s, one struck; total consistent |
| 4 | — | B: skill, `1d20+1` (category off) | A, C see it (player rolls always public) |
| 5 | — | B: Physical dice on; `1d6+2`, enters 5 | All: "5 + 2 = 7", "physical" |
| 6 | Tick Skill check; roll skill "Stealth" `1d20` | — | B, C see Stealth ≤ 1 s; e3 still absent for them |
| 7 | Roll attack with Public off; then reveal it; then hide it | — | B, C: absent → appears → disappears, each ≤ 1 s |
| 8 | Look at B's entries | — | No reveal/hide toggle on player-rolled entries |
| 9 | — | B: `1000d1000`; Ctrl+Enter on `2d6` | Inline errors; no entry anywhere |
| 10 | Roll public attack while C is dropped ("drop connection") | C back | C: banner, then the entry without reload |
| 11 | Hard-kill + restart server | — | All rejoin; logs, markers and settings unchanged; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md), [protocol](../protocol/README.md) | Intents, record types, `audience: dm`, transition matrix; windowed snapshot convergence | complete; window → [proposed ADR](../architecture/adr/0029-windowed-record-types.md) |
| Command context (`src/server/commands/`, shared) | `ctx.dice` seam (FR-DICE-03) | shared change, OQ-DICE-18 |
| [campaign-management](campaign-management.md) | Player name for actor copies (copied server-side; doesn't need [OQ-CAMP-13](campaign-management.md#15-open-questions)); settings in our own table, no change to `campaign` | complete |
| [entities](entities.md), [scenes-map](scenes-map.md) | `resolveDefinition`; character owner; token display name | complete |
| [play-shell](play-shell.md) | Window registry (`dice.log`), toast-free | complete |
| [combat-tracker](combat-tracker.md) | Uses `dice.evaluate`, `gameLog.append` / `markUndone`; registers its kinds; sets `encounterId`, `dmPayload` | open (OQ-DICE-13, 16, 17) |
| [character-sheet](character-sheet.md) | Uses `RollButton` + `dice.roll` for plain rolls | open (OQ-DICE-22) |
| [notifications](notifications.md) | Separate from the game log ([OQ-NOTE-02](notifications.md#15-open-questions)); no dice notifications in MVP | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICE-03 | Dice seeding for tests | **`ctx.dice` engine on the command context; CSPRNG real, seeded per fixture key / test seed, disposable only** (one seam like ADR-0022) / mock the library per test (no stable fixture rolls) | yes · owner: DM | all specs using rolls |
| OQ-DICE-04 | Snapshot depth of the game log | **Newest 100; no older-history UI in MVP** (bounded; history kept in DB) / full log (unbounded snapshot) / 100 + "load older" intent (more scope). Needs [proposed ADR](../architecture/adr/0029-windowed-record-types.md) for FR-SYNC-20 | yes · owner: integrator | live-sync, notifications, party-loot |
| OQ-DICE-05 | ~~Rolls tagged by session?~~ **Decided: no sessions** ([ADR-0013](../architecture/adr/0013-session-journal-scope.md), #78); entries carry `encounterId` set by combat-tracker | — | — | — |
| OQ-DICE-06 | ~~Visibility modes in MVP~~ **Superseded: per-category public log settings** (whispers tier C) | — | — | — |
| OQ-DICE-07 | Manual entry granularity | **Dice total, optional per-die** (fast; per-die for adv) / per-die required (slower) | no · owner: spec-dice-roll-log | combat-tracker |
| OQ-DICE-08 | ~~Toggles apply to player rolls?~~ **Decided: no** (#73) | — | — | — |
| OQ-DICE-09 | Category off: what do players see? | **Nothing** (no leak, no timing tells) / "DM rolled something" line (tension) | no · owner: DM | — |
| OQ-DICE-10 | Toggling a category on: reveal past entries? | **No; new rolls only. DM reveals or hides single DM-rolled entries** / retroactive (surprise reveals) | no · owner: DM | — |
| OQ-DICE-11 | Per-roll override at roll time? | **Yes, DM Public toggle preset from the category** / category only (less control) | no · owner: DM | combat-tracker |
| OQ-DICE-12 | ~~"Hit!" in the log~~ **Decided: computed vs target AC; DM confirms** (#74) | — | — | — |
| OQ-DICE-13 | Monster stats in log lines | **Roll + modifier + outcome public; target AC etc. in `dmPayload` only** / show all / outcome only | no · owner: combat-tracker | combat-tracker |
| OQ-DICE-14 | Defaults for a new campaign's settings | **All hidden** (no accidental leak; DM ticks once) / all public / attack, damage, initiative, healing public | no · owner: DM | — |
| OQ-DICE-15 | Contested checks | **Two entries, category `contested`, no winner computed in MVP** / contest flow linking both rolls (more scope) | no · owner: DM | — |
| OQ-DICE-16 | Player attack in combat: when does the log show it? | **Roll line at roll time (`dice.evaluate` + `roll` entry), outcome line at DM confirm** (player sees own roll at once) / one line at confirm (player waits) | no · owner: combat-tracker | combat-tracker |
| OQ-DICE-17 | Entry mixing categories (attack + damage in one line) | **One category per entry; composer splits lines if it wants separate control; hidden combatant's rolls preset hidden** / per-part redaction (complex) | no · owner: combat-tracker | combat-tracker |
| OQ-DICE-18 | Shared changes: `ctx.dice` on the command context; append-only kind registry `src/shared/dice/kinds.ts` in AGENTS §9.9 | **Both, sequenced before `build/dice-roll-log`** / dice owns its own RNG outside `ctx` (two seams) | yes · owner: orchestrator | AGENTS, combat-tracker |
| OQ-DICE-19 | Glossary: add **Log entry** (one typed line of the game log), **Roll mode** (normal / advantage / disadvantage), **Physical-dice mode** | **Add** / leave implicit | no · owner: integrator | glossary |
| OQ-DICE-20 | Expression limits (FR-DICE-01) | **As proposed** / DM sets others | no · owner: DM | entities |
| OQ-DICE-21 | Physical-dice mode persistence | **Browser storage per (campaign, owner)**, like layout / per page load | no · owner: spec-dice-roll-log | play-shell |
| OQ-DICE-22 | Sheet roll buttons | **Plain rolls via `RollButton` + `dice.roll`; in-combat attack button supplied by combat-tracker** / sheet always uses `dice.roll` (no damage card) | no · owner: character-sheet | character-sheet, combat-tracker |

## 16. Out of scope

- 3D dice, inline rolls, macros, roll requests, whispers (→ [dice-extras](post-mvp/dice-extras.md)); text entries (later kind); stats UI (→ [stats](post-mvp/stats.md)).
- Client-side authoritative rolling. Combat outcomes and undo semantics (→ [combat-tracker](combat-tracker.md)).
