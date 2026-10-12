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

- Server-side dice via `@dice-roller/rpg-dice-roller` ([ADR-0001](../architecture/adr/0001-tech-stack.md)). Numbers come from one seam, `ctx.dice` (#137). Any roll can be a **manual roll** from physical dice ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #43).
- **Game log** (tier S): a play-shell window with BG2-style lines, e.g. *"Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage."* Persisted per campaign; survives a crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- **Public log settings** (tier S): one DM tickbox per roll category decides whether DM rolls reach players. Player rolls are always public (#73).
- character-sheet and combat-tracker roll and log through this spec's internal helpers, **log-entry kinds** and the shared roll control.

## 2. Scope

- Free roll (roll bar) and a shared roll control for other features. Adv/dis on any d20 roll: toggle, or **Shift = advantage, Ctrl = disadvantage**.
- Manual roll (DM and players), marked manual; physical-dice mode per client.
- Categories: attack, damage, saving throw, ability check, skill check, contested, initiative, healing, other. Public log settings per campaign, live; DM per-roll override at roll time.
- Window `dice.log` (both clients); typed entries so text can join later (chat tier C–D, #61).
- Every roll persisted with roller, actor, every die, automated vs manual ([stats](post-mvp/stats.md), #54).

## 3. Goals

- Every roll is server-made or explicitly manual, and visible to exactly the right people.
- Players read what happened in combat from the log instead of asking. The DM hides what should stay hidden, per category, without per-roll effort.
- Stats and [gems](post-mvp/gems.md) (#140) work later from persisted rolls without data changes.

## 4. Non-goals

- 3D dice, inline rolls, macros, roll requests, whispers (→ [dice-extras](post-mvp/dice-extras.md)). Text chat (tier C–D).
- Client-side authoritative rolling. Editing or deleting rolls or entries. Undo of plain rolls (#67). Retroactive category changes; single-entry reveal / hide (tier B, #139 P8).
- Hit/miss and damage outcomes (→ [combat-tracker](combat-tracker.md) kinds). Contest winners (two entries, #139 P24).
- History beyond the snapshot window ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)). Stats UI. Gem UI (post-MVP, #140).

## 5. User stories

- **DM:** As the DM, I want to tick which categories of my rolls players see, override one roll as I make it, and type physical dice results, so that secrets stay secret without per-roll effort and the log stays complete.
- **Player:** As a player, I want to Shift-click for advantage, enter physical dice, and read every public roll in one log, so that combat feels fair and I can catch up after looking away.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-DICE-01 | Grammar: terms joined by `+`/`-`; term = `NdM`, `NdMkhK`, `NdMklK` or integer constant. N 1–50, M 2–1000, K 1–N, constants 0–999, ≤ 10 terms, ≤ 50 dice total, ≤ 60 chars; case-insensitive, spaces ignored. zod checks **before** the library; failure → `invalid` with the zod issue message naming the limit (e.g. "At most 50 dice"). | #139 P25; ⊇ entities' damage grammar |
| FR-DICE-02 | The server evaluates every automated roll with the library. Clients send results only for manual rolls (FR-DICE-06). | |
| FR-DICE-03 | **`ctx.dice`** on the command context, beside `ids` / `tokens` / `clock`: an engine `{next(): int32}`. Real = CSPRNG. Seeded = deterministic; the fixture loader reseeds it per fixture key from `(fixed seed, key)`; `bun test` passes a seed. Same factory and disposable guard as [ADR-0022](../architecture/adr/0022-deterministic-seams.md); a running server always uses the real engine. The library's generator is process-global: the roll service sets it to `ctx.dice` for one synchronous evaluation, then restores it. No `Math.random` or default engine in server code (Biome + review). | #137 |
| FR-DICE-04 | Roll mode `normal` / `advantage` / `disadvantage`. Adv/dis rewrites the first `1d20` term to `2d20kh1` / `2d20kl1`; no `1d20` term → `invalid` "Advantage needs a d20 roll". Both dice stored and shown, dropped die marked. | 5e |
| FR-DICE-05 | Client: Shift+click / Shift+Enter = advantage, Ctrl+click / Ctrl+Enter = disadvantage, both = normal; keys override the mode toggle for that roll. | Tier S |
| FR-DICE-06 | `ManualEntry {diceTotal, dice?}` (`@shared/dice-roll-log`). `diceTotal` = sum of kept dice, within the dice part's min–max; optional `dice` = every die value (count and faces must match; kept computed server-side; sum = `diceTotal`). Without `dice`: one die → its value is `diceTotal`; several → stored with `value: null`. Server adds constants. Out of range / mismatch → `invalid`. Stored and shown as manual. | I3 |
| FR-DICE-07 | Physical-dice mode: toggle in the game log window, per client, browser storage `pp.dice.v1.<campaignId>.<dm \| playerId>`. On → every roll through the roll control opens the manual popover instead of rolling. | I5 |
| FR-DICE-08 | Each roll is one immutable `roll` row (§8) storing **each die's result**, written in the calling command's transaction. Never updated or deleted. | #140 |
| FR-DICE-09 | Intent `dice.roll {expression, mode, category, label?, actor?, manual?, public?}` (DM, player): one roll + one `roll`-kind entry + event-log row in one transaction; emits `DiceRolled`; acks `{rollId, entryId}`. | |
| FR-DICE-10 | Actor: player → omitted (= own player name) or `{entityId}` of a character they own (else `forbidden`; not visible → `not_found`). DM → omitted (= "DM"), `{entityId}` (via `resolveDefinition`) or `{tokenId}` in the campaign. Display name copied into roll and entry at roll time. | [FR-ENT-12](entities.md#6-functional-requirements) |
| FR-DICE-11 | `label` ≤ 60 chars, trimmed, no control chars, rendered as text. `category` required (default `other`). | |
| FR-DICE-12 | Public log settings: one row per campaign, one boolean per category; no row = **all hidden**. `dice.setCategoryPublic {category, public}` (DM) emits `PublicLogCategorySet`; same value → no-op, no event. Applies only to entries created after its commit; never retroactive. | #139 P8, P23 |
| FR-DICE-13 | Entry `public` is stamped once, at creation, by **who rolls** (`env.actor`): player → `true` always (a player-sent `public` → `forbidden`; internal callers' `public` ignored). DM → the `public` override if given, else the entry category's setting at commit. Applies when the DM rolls for a PC too. | #73, #139 P1, P22 |
| FR-DICE-15 | Visibility `game-log-entry`: DM full. Player: `public` → redacted (minus `dmPayload`); else hidden, no placeholder. | #139 P21 |
| FR-DICE-16 | Visibility `game-log-settings`: `audience: dm`. | |
| FR-DICE-17 | Entries carry `n`, a per-campaign counter (max + 1 in the transaction); `n` is the entries' [ADR-0022](../architecture/adr/0022-deterministic-seams.md) tiebreak. Registered with `window {orderBy: n, size: 100}` ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)): snapshot = newest 100 by `n`, cut before the visibility filter; players get the visible subset. | #137 |
| FR-DICE-18 | Log-entry kind registry `src/shared/dice-roll-log/kinds.ts` (append-only): `kind → {payload schema, dmPayload schema?, formatLine}`. Dice ships `roll`. Unregistered kind on write → `internal`; client renders unknown kinds as "Unsupported entry". | Gate §4.9 |
| FR-DICE-19 | Internal helpers, in the caller's transaction, `env: CommandEnv` first: `dice.evaluate(env, {expression, mode, category, label?, actor: {kind, id, name}, manual?, source, target?}) → Roll` (caller resolves the actor; combat passes the combatant's name) (FR-DICE-01–08; row only); `gameLog.append(env, {kind, category, actorName, payload, dmPayload?, rollIds, encounterId?, public?}) → RecordChange` (stamps `n`, `at`, roller, `public` per FR-DICE-13); `gameLog.markUndone(env, entryId) → RecordChange`. No events of their own: the caller lists the changes in its event (`CharacterRolled`, combat's events). Campaign and roller from `env.actor`. | I1, I14, I15 |
| FR-DICE-20 | `roll` line (`formatLine`, pure, `@shared`): `<actor> — <label or expression>: <dice> + <constants> = <total>` per roll; adv/dis shows "(adv)" / "(dis)" and the dropped die struck through; a single kept d20 of 20 / 1 appends "— natural 20!" / "— natural 1"; manual shows "physical". | BG2 style |
| FR-DICE-21 | Window `dice.log`, both clients, default open: entries by `n`, oldest at the top; sticks to the bottom unless scrolled up, then "N new". Live ≤ 1 s after commit. DM: hidden entries muted with an eye-off marker. Undone entries struck through, "undone". | I12 |
| FR-DICE-22 | Roll bar (window footer): expression, category, label, actor (FR-DICE-27), mode toggle, physical-dice toggle; DM: public switch preset from the category's setting, and a gear for the settings popover (in the window body; no shell change). Enter rolls. `ack` → input clears; `reject` → text stays, message inline. Disabled unless `live`. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-DICE-23 | Settings popover: one checkbox per category; change sends `dice.setCategoryPublic`; other DM tabs reflect it ≤ 1 s. | |
| FR-DICE-24 | `@ui` roll control: `useRollControl({expressions, category, critExpressions?, onRoll})` + `RollButton` wrapper; DM: a public toggle preset from `category`'s setting (FR-DICE-13). Reads FR-DICE-05 keys and FR-DICE-07 mode. Physical mode → popover with one `ManualEntry` per expression (attack = 2); if the first is a natural 20 and `critExpressions` is set, the rest show those (doubled damage). Then `onRoll({mode, manual?, public?})` (`public` DM only); the **caller sends its own intent** (`dice.roll`, `char.roll`, `cbt.attack`, `cbt.rollInitiative`). | I3, #135 |
| FR-DICE-25 | Same seed + same command sequence → identical rolls, entries and `n`. | FR-FIX-08 |
| FR-DICE-26 | A multi-roll action (sheet attack = to-hit + damage) is **one entry** with several `rollIds` and the action's category (attack). Each roll keeps its own category for stats. Outcome lines are separate entries written by their owner. | I4, I18 |
| FR-DICE-27 | Actor Select: player → "me" + own characters. DM → "DM", characters, tokens of the active scene. | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, semantic tokens (`visibility.hidden` for the hidden marker).

- **Window `dice.log`** "Game log": both clients, default open, bottom-left above the launcher, 420×320, min 300×200, launcher "Log" (OQ-SHELL-06, I12).
- **Line:** actor bold, body text, total bold; category as a small muted Badge; Tooltip = time + expression + all dice. "physical" Badge for manual.
- **Roll bar:** Input (expression), Select (category), Input (label), Select (actor), ToggleGroup (Dis / Normal / Adv), Switch "Physical dice"; DM: Switch "Public", gear Button. Manual popover: per expression a read-only expression + dice total Input (+ optional per-die Inputs).
- **States:** empty "No rolls yet"; loading skeleton; disconnected: log stays, banner, roll bar disabled; reject: inline error under the bar.
- **DM view:** all entries, hidden ones muted + eye-off; public switch; gear. **Player view:** public entries only; no markers, switch or gear.
- **Keyboard:** Enter / Shift+Enter / Ctrl+Enter in the expression input. macOS Ctrl+click opens a context menu: Mac users use the toggle (laptops per ADR-0007; accepted).
- **Test IDs:** `dice-log`, `dice-log-empty`, `dice-log-new`, `dice-log-entry` + `data-record-id` + `data-public` + `data-undone`, `dice-log-entry-manual`; `dice-roll-expression`, `-category`, `-label`, `-actor`, `-mode` (+ `data-value=normal|advantage|disadvantage`), `-physical`, `-public`, `-submit`, `-error`; `dice-manual-total`, `dice-manual-die` (+ `data-value` = expression position), `dice-manual-submit`; `dice-settings-open`, `dice-settings-category` + `data-value=<category>`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Roll *(server table; not a record type)* | id, campaignId, at | ID, ID, timestamp | `ctx.ids`, `ctx.clock` |
| | rollerRole, rollerPlayerId | `dm` \| `player`, ID \| null | From `env.actor` |
| | actorKind, actorId, actorName | `dm` \| `player` \| `entity` \| `token`, ID \| null, text | Name copied at roll time |
| | targetEntityId, targetTokenId, targetName | ID \| null ×2, text \| null | Set by callers only |
| | category, label, source | enum, text \| null, text | `source` = `dice`, `char`, `cbt` |
| | expression, mode, manual | text (normalised), enum, bool | |
| | dice | **JSON leaf** `{faces, value: int \| null, kept}[]` | Every die incl. dropped (#140); `null` only for manual totals |
| | constant, total, natural | int, int, int \| null | `natural` = single kept d20 value |
| | replacesRollId | ID \| null | Reserved for gems (#140); null in MVP |
| Game log entry (`game-log-entry`) | id, campaignId, n, at | ID, ID, int, timestamp | Unique (`campaignId`, `n`) |
| | kind, category, public, undone | text, enum, bool, bool | `public` set once; `undone` via `markUndone` |
| | rollerRole, rollerPlayerId, actorName | as Roll | |
| | payload | **JSON leaf** per kind | Player-safe; `roll`: `{rollId, expression, mode, manual, dice, constant, total, natural, label}[]` (1–20) |
| | dmPayload | **JSON leaf** \| null | DM-only extras (e.g. target AC); stripped for players |
| | rollIds, encounterId | ID[], ID \| null | `encounterId` set by combat-tracker |
| | supersededBy | ID \| null | Reserved for gem rerolls (#140): the later entry replacing this one; null in MVP |
| Public log settings (`game-log-settings`) | id (= campaignId), campaignId | ID | Created on first change |
| | attack … other | bool × 9 | No row = all false |

- **Relations:** Campaign 1—* Roll, Entry; Entry → Rolls via `rollIds` (no entry references a roll = never logged → hidden for stats; I24, no `Roll.entryId`); Roll → Player, Entity, Token by id (no FK; names copied).
- **Derived:** line text (`formatLine`), natural 20/1, effective settings. **Persisted:** rolls, entries, settings. Physical-dice mode: browser only.
- **Gems later (#140):** a reroll = new roll + new entry, old entry's `supersededBy` set (shown struck through); a modified damage die = new roll row with `replacesRollId`, written by the owning command. No MVP command sets either field. Manual rolls stored without per-die values (FR-DICE-06) need them entered before a Combat gem applies.

## 9. API & events

**WS intents** (no REST; live play over WS, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `dice.roll` | DM, player | FR-DICE-01, 04, 06, 10, 11, 13 | `{rollId, entryId}` |
| `dice.setCategoryPublic {category, public}` | DM | Category enum | — |

**Record types** (generic record changes + `cause`, scope `campaign`)

| Type | Visibility rule | Snapshot provider |
|---|---|---|
| `game-log-entry` | DM full; player redacted (minus `dmPayload`) iff `public`, else hidden | `window {orderBy: n, size: 100}` (ADR-0029) |
| `game-log-settings` | `audience: dm` | Row, or defaults with `id = campaignId` |

**Domain events** (all logged; none undoable or transient)

| Event | Emitted by | Payload | Changes | Player sees |
|---|---|---|---|---|
| `DiceRolled` | `dice.roll` | `{entryId, rollIds}` | `game-log-entry` upsert | upsert iff public |
| `PublicLogCategorySet` | `dice.setCategoryPublic` | `{category, public}` | `game-log-settings` upsert | nothing |
| *(callers' events)* | via `gameLog.append` / `markUndone` | caller's, incl. `rollIds` | `game-log-entry` upserts listed by caller | per entry rule |

- No intent is optimistic ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) E). No listeners, no signals. Stats join immutable `roll` rows via `rollIds`.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Roll (automated / manual) | ✓ any actor in campaign | ✓ as self or own character | FR-DICE-10 |
| Public override on a roll | ✓ | ✗ | `forbidden` |
| Change public log settings | ✓ | ✗ | role |
| Read entries | all | public, redacted | FR-DICE-15 |
| Edit / delete / re-hide rolls or entries | ✗ | ✗ | no command exists |

## 11. Edge cases & failure modes

- **Disconnect / reconnect (DM or player):** roll bar disabled; an in-flight `dice.roll` is rejected `disconnected`, never resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)); the input keeps its text. The reconnect snapshot shows the roll if it committed. Settings are server-side.
- **Server crash mid-action:** roll + entry + event-log row commit together or not at all. After restart, snapshots equal pre-crash state.
- **Concurrent edits:** rolls serialise; `n` = commit order. Two DM tabs toggle a category → last commit wins, both converge. A category toggled between a roll and its commit → the setting at commit applies. Campaign switch → only the new campaign's log and settings.
- **Window:** a player may get fewer than 100 entries when many are hidden (accepted, ADR-0029). `markUndone` on an entry below the floor is delivered live; a fresh snapshot omits it; convergence compares only `n` ≥ floor.
- **Hidden actor:** a public DM roll for a hidden token shows its name; the DM uses the per-roll switch. Combat presets hidden for a hidden attacker or target (I4). Later token hide / rename ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) doesn't touch entries: names are copied at roll time.
- **Invalid / malicious input:** `1000d1000`, `1d20*5`, functions, 61+ chars → `invalid` before the library; library throw → `invalid`. Manual out of range / wrong die count → `invalid`. Player `public` or another's character → `forbidden`. Labels rendered as text.
- **Log growth:** rows kept forever (~1 KB/roll; 10 k rolls ≈ 10 MB); snapshots stay bounded (FR-DICE-17).

## 12. Performance & bandwidth

- Entry 300–600 B typical on the wire; schema max (20 rolls × 50 dice) ≈ 8 KB. `DiceRolled` ≈ 0.6 KB × 7 connections per roll; human-paced.
- Snapshot budget `game-log-entry`: 100 entries ≈ 60 KB typical, ≤ 100 KB (protocol per-type budget table, I17). Evaluation of ≤ 50 dice sub-millisecond; commit → frame < 50 ms locally ([live-sync §12](live-sync.md#12-performance--bandwidth)).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:` + seeded `ctx.dice`.

**Fixtures** (setups run as DM, FR-FIX-13; dice seeded per fixture key, so values are stable)

| Key | Kind | Requires | Contents | In `session-sim` |
|---|---|---|---|---|
| `dice-settings` | setup | `campaign` | `dice.setCategoryPublic` true for attack, damage, initiative, healing | yes |
| `rolls-1` | setup | `dice-settings`, `char-mira`, `enemy-1` | e1: Goblin, attack "Scimitar" `1d20+4` → public. e2: Goblin, damage `1d6+2`, `public:false`, label "DM-SECRET-ROLL" → hidden. e3: skill "Perception" `1d20+3` → hidden (category off). e4: Mira, initiative `1d20+2`, manual 15 → public (DM roll for a PC, category on), manual | no |

- **Bundle `dice-log`** = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `dice-settings` + `rolls-1`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Grammar + limits (`1000d1000`, `1d20*2`, `kh` bounds, messages); adv/dis rewrite + no-d20 error; Shift/Ctrl/both → mode; manual range, die count, kept calc; `formatLine` (adv, dis, nat 20, nat 1, manual, multi-roll, undone); visibility matrix (DM / player × public / hidden; `dmPayload` stripped); FR-DICE-13 stamping (player forced public, DM override, DM for a PC); roll control: N expressions, crit swap on nat 20; seeded determinism; real factory refuses seeding on a non-disposable dir | In-code |
| Integration | `dice.roll`: roll + entry + log row in one tx, event before `ack`, rollback → none. Ownership: `player-1` as Mira ✓, as Thorn `forbidden`, with `public` `forbidden`. Category change not retroactive; same value → no event. Settings never in player frames. Window: 105 entries → newest 100; floor cut before the filter; `markUndone` below the floor; convergence per ADR-0029. Test-registered kind via `gameLog.append` + `markUndone` commits / rolls back with its caller; multi-roll entry. **Leak scan:** player frames never contain "DM-SECRET-ROLL" or `dmPayload`. Restart → identical snapshots | `dice-log` |
| E2E (thin) | DM + `player-1`: player Shift+Enter roll appears for DM; DM hidden roll absent from player frames; DM public roll appears for player | `dice-log` |

**Browser walkthrough** — `PP_TEST_MODE=1` (for "drop connection"); `bun run build`, `fixtures:reset-load dice-log --profile verify`, `start --profile verify`; evidence per AGENTS §9.6. Contexts **A** DM, **B** `player-1`, **C** `player-2`. Automated totals are random: check *total = kept dice + constants*. Teardown: stop server, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | — | Game log open: e1–e4; e2, e3 muted + eye-off; e4 "physical" |
| 2 | — | B, C open links | Both see e1, e4 only; frames contain no "DM-SECRET-ROLL" |
| 3 | — | B: actor Mira, attack, `1d20+4`, Shift+Enter | A, B, C: "(adv)", two d20s, one struck; total consistent |
| 4 | — | B: skill, `1d20+1` (category off) | A, C see it (player rolls always public) |
| 5 | — | B: Physical dice on; `1d6+2`, enters 5 | All: "5 + 2 = 7", "physical" |
| 6 | Tick Skill check; roll skill "Stealth" `1d20` | — | B, C see Stealth ≤ 1 s; e3 still absent |
| 7 | Roll attack with Public off; then untick Attack | — | B, C never see the new roll and still see e1 (not retroactive); A shows it muted |
| 8 | — | B: `1000d1000`; Ctrl+Enter on `2d6` | Inline errors; no entry anywhere |
| 9 | Roll public damage while C is dropped ("drop connection") | C back | C: banner, then the entry without reload |
| 10 | Hard-kill + restart server | — | All rejoin; logs, markers and settings unchanged; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md), [protocol](../protocol/README.md) | Intents, record types, `audience: dm`; windowed type per [ADR-0029](../architecture/adr/0029-windowed-record-types.md) | complete; ADR accepted (#137) |
| [campaign-management](campaign-management.md), [entities](entities.md), [scenes-map](scenes-map.md), [play-shell](play-shell.md) | Player name; `resolveDefinition`, character owner; token display name (copied server-side); window registry `dice.log`, no header slot (gear in body) | complete |
| [character-sheet](character-sheet.md) | `char.roll` calls `dice.evaluate` + `gameLog.append`, emits `CharacterRolled` (I1); sheet buttons use the roll control (FR-DICE-24) | in revision |
| [combat-tracker](combat-tracker.md) | `dice.evaluate`, `gameLog.append` / `markUndone`; kinds `cbt.attack`, `cbt.hp`; `encounterId`, `dmPayload`; hidden preset (I4) | in revision |
| [notifications](notifications.md) | Separate from the game log (I6); no dice notifications in MVP | in revision |
| [gems](post-mvp/gems.md) | Reserved `supersededBy`, `replacesRollId`, per-die storage (#140) | stub |

**Shared changes needed** (AGENTS §9.9, gate §4; the orchestrator picks sequence or shared branch first)
- `src/server/commands/context.ts` — `ctx.dice` engine (CSPRNG / seeded, disposable guard) — FR-DICE-03.
- `src/server/features/fixtures-adapters/` (loader) — reseed `ctx.dice` per fixture key — FR-DICE-03; path to be assigned.
- `package.json`, `bun.lock` — add `@dice-roller/rpg-dice-roller` (ADR-0001). `biome.json` — restricted global `Math.random`, server code only (the client backoff uses it).
- `src/server/ws/` + `src/shared/protocol/` — optional `window {orderBy, size, pin?}` on registration; convergence + leak-scan helpers honour it (ADR-0029).
- `src/server/db/` — tables `roll`, `game_log_entry` (unique `campaignId` + `n`), `game_log_settings`. `src/shared/events/` — `DiceRolled`, `PublicLogCategorySet`.
- Registries (append lines): `diceRollLog` in `src/server/features/index.ts`; record types `game-log-entry`, `game-log-settings`; `src/client/{dm,player}/windows.ts` `dice.log`; `fixtures/bundles/index.ts` `dice-log`. New append-only `src/shared/dice-roll-log/kinds.ts` (created with `roll` by this build; on the AGENTS §9.9 list).
- Docs at merge: protocol rows (intents, types, events, budget), data-model rows, glossary (I13).

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-DICE-03–22~~ | ~~Seeding; snapshot depth; shared changes; manual; visibility; defaults; contests; limits; log timing; glossary; storage; sheet buttons~~ | Decided: 05 no sessions (ADR-0013), 06 superseded, 08 #73, 12 #74; #137 (`ctx.dice`, newest 100, §14); #139 P6, P8, P21–P25; gate I3–I5, I13; #135 + I1 (`char.roll` out of combat, `cbt.*` in combat) | — | — |

## 16. Out of scope

- As §4; plus text entries (a later kind) and combat undo semantics (→ [combat-tracker](combat-tracker.md)).
