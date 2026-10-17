---
title: Dice and game log
prefix: DICE
status: in-review
owner: spec-dice
wave: 2
phase: post-mvp-4
---

# Dice and game log

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Server-side dice via `@dice-roller/rpg-dice-roller` ([ADR-0001](../architecture/adr/0001-tech-stack.md)). Numbers come from one seam, `ctx.dice` (#137). Any roll can be a **manual roll** from physical dice ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #43).
- **Game log** (tier S): a play-shell window with BG2-style lines, e.g. *"Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage."* Persisted per campaign; survives a crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- **Public log settings** (tier S): one DM tickbox per roll category decides whether DM rolls reach players. Player rolls are always public (#73).
- character-sheet and combat-tracker roll and log through this spec's internal helpers, **log-entry kinds** and the shared roll control.
- **Playtest pass** (#171; FR-DICE-28, 29): one rule for **DM-only detail** in any kind's line (facts a kind declares DM-only, e.g. AC, "DM ruled hit", an NPC's damage dice, live in `dmPayload`, shown on the DM client only) and for the "physical" tag across kinds (P5, G7, G8); no "natural 1" noise on initiative lines (G12).
- **Polish pass** (sprint 1, R3; FR-DICE-30): the roll bar collapses to one row, so the Game log shows ≥ 6 lines of history at default size ([FR-SHELL-35](play-shell.md#6-functional-requirements)).
- **Sprint 2 phase 1** (P2b; FR-DICE-31–34): physical dice after a natural 20 ask only for the **extra critical dice** and keep what was typed (G6); a Roll that can't go never fails silently; a minimised Game log shows a "new" dot (N1, decided #190, [OQ-SHELL-21](play-shell.md#15-open-questions)); the DM can roll as a token-less combatant (S4).
- **Sprint 4** (DM [#243](../decisions-log.md) [17]; FR-DICE-35–37): log lines show **the same dice as the tray**: each die as an inline die-shape chip in the roller's look ([FR-DICEX-42](dice-extras.md#6-functional-requirements)); the roll popup opens the log at its entry. No payload, kind, event or schema change.

## 2. Scope

- Free roll (roll bar) and a shared roll control for other features. Adv/dis on any d20 roll: toggle, or **Shift = advantage, Ctrl = disadvantage**.
- Manual roll (DM and players), marked manual; physical-dice mode per client.
- Categories: attack, damage, saving throw, ability check, skill check, contested, initiative, healing, other. Public log settings per campaign, live; DM per-roll override at roll time.
- Window `dice.log` (both clients); typed entries so text can join later (chat tier C–D, #61).
- Every roll persisted with roller, actor, every die, automated vs manual ([stats](post-mvp/stats.md), #54).
- *(Sprint 4)* Dice chips in log lines; a `die` line segment for kinds; `focusLogEntry` for the roll popup (FR-DICE-35–37).

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
| FR-DICE-07 | Physical-dice mode: toggle in the game log window, per client, browser storage `pp.dice.v1.<campaignId>.<dm \| playerId>`. On → every roll through the roll control opens the manual popover instead of rolling. While on: every RollButton shows a physical marker, the game log's physical-dice row (in the pinned roll bar) turns into a "Physical dice on" strip with "Turn off", and the popover offers a one-off "Roll for me" (server roll, mode stays on). The toggle sits on its own row of the roll bar, away from Adv (#149) *(R3: in the options row, FR-DICE-30; the strip shows whenever the mode is on)*. | I5 |
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
| FR-DICE-20 | `roll` line (`formatLine`, pure, `@shared`): `<actor> — <label or expression>: <dice> + <constants> = <total>` per roll; adv/dis shows "(adv)" / "(dis)" and the dropped die struck through; a single kept d20 of 20 / 1 appends "— natural 20!" / "— natural 1" (*#171:* not on initiative, FR-DICE-29); manual shows "physical". | BG2 style |
| FR-DICE-21 | Window `dice.log`, both clients, default open: entries by `n`, oldest at the top; sticks to the bottom unless scrolled up, then "N new". Live ≤ 1 s after commit. DM: hidden entries muted with an eye-off marker. Undone entries struck through, "undone". | I12 |
| FR-DICE-22 | Roll bar (window footer): expression, category, label, actor (FR-DICE-27), mode toggle, physical-dice toggle; DM: public switch preset from the category's setting, and a gear for the settings popover (in the window body; no shell change) *(R3: layout per FR-DICE-30)*. Enter rolls. `ack` → input clears; `reject` → text stays, message inline. Disabled unless `live`. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-DICE-23 | Settings popover: one checkbox per category; change sends `dice.setCategoryPublic`; other DM tabs reflect it ≤ 1 s. | |
| FR-DICE-24 | `@ui` roll control: `useRollControl({expressions, category, critExpressions?, onRoll})` + `RollButton` wrapper; DM: a public toggle preset from `category`'s setting (FR-DICE-13). Reads FR-DICE-05 keys and FR-DICE-07 mode. Physical mode → popover with one `ManualEntry` per expression (attack = 2); if the first is a natural 20 and `critExpressions` is set, the rest show those (doubled damage) *(G6: as extra dice, FR-DICE-31)*. Then `onRoll({mode, manual?, public?})` (`public` DM only); the **caller sends its own intent** (`dice.roll`, `char.roll`, `cbt.attack`, `cbt.rollInitiative`). | I3, #135 |
| FR-DICE-25 | Same seed + same command sequence → identical rolls, entries and `n`. | FR-FIX-08 |
| FR-DICE-26 | A multi-roll action (sheet attack = to-hit + damage) is **one entry** with several `rollIds` and the action's category (attack). Each roll keeps its own category for stats. Outcome lines are separate entries written by their owner. | I4, I18 |
| FR-DICE-27 | Actor Select: player → "me" + own characters. DM → "DM", characters, tokens of the active scene (a character's own token is not listed again, #149). | |
| **Playtest pass** (#171) | | |
| FR-DICE-28 | **DM-only detail and tags in any kind** (P5, G7, G8): a kind's `formatLine(entry)` receives `dmPayload` only on the DM client (players' entries never carry it, FR-DICE-15); facts the owning kind declares DM-only (target AC, the computed hit, overrides, and for `cbt.attack` the damage dice breakdown and kept / dropped d20s) go **only** in `dmPayload`, never in `payload` or text built from it. Public dice stay public: a public DM `roll` entry (FR-DICE-13) and `cbt.attack`'s "d20 + modifier" text (FR-CBT-24) are by design. A kind whose line shows dice from a manual roll marks them with the same "physical" badge segment as `roll` (FR-DICE-20, test id `dice-log-entry-manual`); kinds reuse `rollSegments` for dice parts. A DM-only entry (internal caller passing `public: false`, e.g. combat's monster attack roll, [FR-CBT-52](combat-tracker.md#6-functional-requirements)) is shown to the DM muted with the eye-off marker like any hidden entry (FR-DICE-21). No new field, kind or registry change. | P5, G7 |
| FR-DICE-29 | (decided #172, OQ-DICE-23) The natural 20 / 1 marker (FR-DICE-20) is not added to `initiative`-category rolls (a natural 1 has no rule meaning there and read as an error at the table, G12). | G12 |
| **Polish pass** (sprint 1, R3; decided #178, OQ-DICE-25) | | |
| FR-DICE-30 | **Compact roll bar** (both clients; amends FR-DICE-22, FR-DICE-07 placement): the pinned footer is **one row**: expression, mode toggle, DM: public toggle as an eye / eye-off icon Button (preset from the category, Tooltip "Public" / "Hidden"), Roll, and an **Options** chevron. Options open a second row: category, actor, label, DM gear, physical-dice toggle. The chevron shows a dot while category ≠ `other`, an actor or label is set, or the DM's public toggle differs from the category preset. While Physical dice is on, its "Physical dice on" strip with "Turn off" shows below the first row whether Options are open or not (FR-DICE-07). Options open / closed is stored per browser beside the FR-DICE-07 entry: key `pp.dice.options.v1.<campaignId>.<dm \| playerId>` = `"1"` / `"0"`, default closed. Only the entry list scrolls; history numbers: [FR-SHELL-35](play-shell.md#6-functional-requirements). | R3 |
| **Sprint 2 phase 1** (P2b) | | |
| FR-DICE-31 | **Physical crit keeps what was typed** (G6; amends FR-DICE-24's swap): when the first entry becomes a natural 20 and `critExpressions` is set, each later slot keeps its base expression's inputs **as entered** (total and per-die values) and gains a second group **"Extra critical dice: 4d6"** (the base expression's dice terms once more, no constants) with its own total input and optional per-die inputs. The slot's `ManualEntry` for the crit expression = base dice total + extra total; `dice` = base dice then extra dice when every die was entered, else omitted (FR-DICE-06). The first entry moves off 20 → the extra group goes (its values dropped), the base inputs stay. Server unchanged: it still receives one `ManualEntry` per crit expression. **`crit: true`** (option on `useRollControl`, review X-1): the caller already knows the hit is critical (e.g. a Damage roll after a natural-20 to-hit, combat-tracker FR-CBT-74), so every slot shows its extra critical group **from the start**, with no d20 entry needed; `critExpressions` then gives the expressions sent. | G6; X-1 |
| FR-DICE-32 | **No silent Roll** (G6): a slot is complete when its total (base and, after a crit, extra) is filled and within the dice part's min–max, or when every per-die box of that group is filled (the total is then computed and shown). Roll / Enter with an incomplete or out-of-range slot sends nothing, focuses the first offending input and shows an inline message under the popover (`dice-manual-error`): "Enter the total for 4d6 (critical)" / "Total must be 4–24". The Roll button stays enabled (a disabled button is the silent case the report hit). | G6 |
| FR-DICE-33 | **Minimised Game log dot** (N1; decided #190, [OQ-SHELL-21](play-shell.md#15-open-questions)): both clients' `dice.log` window types declare `activity(store)` = the highest entry `n` in this client's store ([FR-SHELL-38](play-shell.md#6-functional-requirements)), so a new entry this client can see lights the launcher dot while the log is minimised (players: public entries only; the DM: every entry). | N1 |
| FR-DICE-34 | **Roll as token-less combatants** (report item 17; settled S4, OQ-CBT-55; amends FR-DICE-27, FR-DICE-10): the DM's actor Select also lists every **active, non-removed combatant of the started encounter that has no token** (e.g. "Goblin 3" added mid-fight), after the scene's tokens, by the combatant's name. It sends actor `{combatantId}` (**DM only**; a player sending it → `invalid`, not in the player schema). The server resolves it in the campaign's started encounter (else `not_found`) to `{kind: entity, id: combatant.entityId, name: combatant's name}`, so the `roll` row and entry need no new actor kind or column. Visibility unchanged: the entry is a DM roll, public per category / override (FR-DICE-13). Encounter ended or combatant removed between pick and roll → `not_found` inline, the Select drops it. | Item 17 |
| **Sprint 4** (#243 [17]) | | |
| FR-DICE-35 | **Dice in log lines** (OQ-DICE-27): a `roll` line (FR-DICE-20) shows each die as an inline **die-shape chip** ([FR-DICEX-42](dice-extras.md#6-functional-requirements), size `sm` 18 px, the roller's look) in place of its number: "Mira — Athletics: ⬡13 + 5 = 18". Dropped dice struck and dimmed (adv / dis), MOD / offered dice with their label, manual dice with per-die values as chips plus the "physical" badge, a manual total without per-die values as one round chip. Built from a new optional `die {faces, value, kept, label?}` on `LineSegment` (`@shared/dice-roll-log/kind-types.ts`), emitted by `rollSegments` / `rollBreakdownSegments`; `text` stays on every segment, so `lineText`, copy, the Tooltip and screen readers read "d20: 13". A chip fits the line height: FR-SHELL-35's ≥ 6 single-line entries hold. | [17] |
| FR-DICE-36 | **Other kinds** get chips through the shared helpers, with no change of their own, for exactly the dice their line already shows: the DM's `cbt.attack` dice breakdown ([FR-CBT-53](combat-tracker.md#6-functional-requirements)) shows chips on the DM client; players' `cbt.attack` to-hit ("12 + 4", a sum in `payload`) stays text. No new payload field, so nothing new reaches players; the FR-DICE-28 kind contract still holds (a `die` segment is DM-only exactly when its text is). R's Divine Fury line ([15], effect-modifiers) builds on the same segment after this slice. *(Seams S8)* **Segment format (D's, binding for every kind):** optional `die {faces, value, kept, label?}` on `LineSegment`, **one segment per die**, from `rollSegments` / `rollBreakdownSegments`; no `{kind: "dice", values[]}` shape, no `muted` field. Trigger and weapon extra parts (R: Divine Fury, Flame Tongue fire) go through the same helpers or the same per-die segments with `label` = the part's name; an offered part the DM did not apply is `kept: false` (struck + dimmed). Monster trigger parts stay DM-only (#190). | Seam R (S8) |
| FR-DICE-37 | **Focus an entry**: `focusLogEntry(entryId)` (`@ui`, dice-roll-log client) opens or restores and fronts `dice.log` ([FR-SHELL-08](play-shell.md#6-functional-requirements)), scrolls the entry into view and highlights it for 2 s (`dice-log-entry` `data-focused`); an entry not in the store (below the window, FR-DICE-17) → the log opens only. Caller: the roll popup ([FR-DICEX-39](dice-extras.md#6-functional-requirements)). | [11] |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, semantic tokens (`visibility.hidden` for the hidden marker).

- **Window `dice.log`** "Game log": both clients, default open, bottom-left above the launcher, 420×320, min 300×200, launcher "Log" (OQ-SHELL-06, I12).
- **Line:** actor bold, body text, total bold; category as a small muted Badge; Tooltip = time + expression + all dice. "physical" Badge for manual. *(Sprint 4)* Dice as inline die-shape chips (FR-DICE-35), vertically centred on the text; a focused entry (FR-DICE-37) gets the accent ring for 2 s.
- **Roll bar:** Input (expression), Select (category), Input (label), Select (actor), ToggleGroup (Dis / Normal / Adv), Switch "Physical dice"; DM: Switch "Public", gear Button. *(R3, FR-DICE-30)* Row 1: expression, mode, DM eye toggle, Roll, Options chevron (lucide `chevron-up` / `-down`); row 2 (Options): the rest. Manual popover: per expression a read-only expression + dice total Input (+ optional per-die Inputs). *(G6)* After a natural 20 a crit slot adds a muted sub-row "Extra critical dice: 4d6" with its own total (+ per-die) Inputs; the inline error sits under the inputs.
- **States:** empty "No rolls yet"; loading skeleton; disconnected: log stays, banner, roll bar disabled; reject: inline error under the bar.
- **DM view:** all entries, hidden ones muted + eye-off; public switch; gear. **Player view:** public entries only; no markers, switch or gear.
- **Keyboard:** Enter / Shift+Enter / Ctrl+Enter in the expression input. macOS Ctrl+click opens a context menu: Mac users use the toggle (laptops per ADR-0007; accepted).
- **Test IDs:** `dice-log`, `dice-log-empty`, `dice-log-new`, `dice-log-entry` + `data-record-id` + `data-public` + `data-undone`, `dice-log-entry-manual`; `dice-roll-expression`, `-category`, `-label`, `-actor`, `-mode` (+ `data-value=normal|advantage|disadvantage`), `-physical`, `-public`, `-submit`, `-error`; `dice-manual-total`, `dice-manual-die` (+ `data-value` = expression position), `dice-manual-submit`; `dice-settings-open`, `dice-settings-category` + `data-value=<category>`. *(R3)* `dice-roll-options` (+ `data-state=open|closed`, `data-dirty`); `dice-roll-public` is the eye toggle (+ `data-state=public|hidden`). *(G6)* `dice-manual-crit-total`, `dice-manual-crit-die` (+ `data-value` = expression position), `dice-manual-error`. *(Sprint 4)* `dice-log-die` (a chip in a line; + `data-shape`, `data-faces`, `data-value`, `data-kept`), `dice-log-entry` gains `data-focused`.
- *(Sprint 4)* **DM view:** chips on every line incl. hidden ones and the DM-only dice breakdowns. **Player view:** chips only for dice in public payloads.

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
- **Derived:** line text (`formatLine`), natural 20/1, effective settings; *(sprint 4)* `die` segments and their chips from the same payload (FR-DICE-35). **Persisted:** rolls, entries, settings. Physical-dice mode: browser only.
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
- **DM-only detail (#171):** a kind that leaks into `payload` what belongs in `dmPayload` is a leak; the kind contract test and combat's leak tests catch it. Reconnect / crash: detail is stored on the entry, so the DM's snapshot shows it again; players never had it.
- **Hidden actor:** a public DM roll for a hidden token shows its name; the DM uses the per-roll switch. Combat presets hidden for a hidden attacker or target (I4). Later token hide / rename ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) doesn't touch entries: names are copied at roll time.
- **Invalid / malicious input:** `1000d1000`, `1d20*5`, functions, 61+ chars → `invalid` before the library; library throw → `invalid`. Manual out of range / wrong die count → `invalid`. Player `public` or another's character → `forbidden`. Labels rendered as text.
- **Compact bar (R3):** a DM rolling with Options closed still gets the category preset for Public (the eye shows it), so a hidden roll can't go public by surprise; the dot warns when a hidden option is set. Storage unavailable → Options closed, in memory. Disconnect: bar disabled as before; Options toggle still works (client only).
- **Physical crit (G6):** the popover is client state; a disconnect while it is open disables Roll (not `live`) and keeps the typed values; reconnect → Roll works again. Server crash: nothing was sent. A manual crit entry still validates server-side against the crit expression (FR-DICE-06), so a client bug can't log an impossible total.
- **Log growth:** rows kept forever (~1 KB/roll; 10 k rolls ≈ 10 MB); snapshots stay bounded (FR-DICE-17).
- *(Sprint 4)* **Chips:** rows written before sprint 4 render chips too (same payload); a manual roll without per-die values → one round chip with the dice total; > 20 dice in a line → all chips, wrapping (the Tooltip still lists them). Disconnect / reconnect / crash: chips are derived on render, nothing to recover. Reload: same lines, same chips. `focusLogEntry` on an entry below the window → the log opens, no scroll.

## 12. Performance & bandwidth

- Entry 300–600 B typical on the wire; schema max (20 rolls × 50 dice) ≈ 8 KB. `DiceRolled` ≈ 0.6 KB × 7 connections per roll; human-paced.
- Snapshot budget `game-log-entry`: 100 entries ≈ 60 KB typical, ≤ 100 KB (protocol per-type budget table, I17).
- *(Sprint 4, measured 2026-10-17 on real sockets, `dice-log`)* `DiceRolled` frame: player `1d20+5` 782 B to the DM / 765 B to another player; `10d6` 1,084 / 1,067 B; `50d6` 2,439 / 2,422 B; a DM hidden roll sends players **no frame**. FR-DICE-35–37 add **0 B** (chips are drawn from the payload already sent). Evaluation of ≤ 50 dice sub-millisecond; commit → frame < 50 ms locally ([live-sync §12](live-sync.md#12-performance--bandwidth)).

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
| Unit | Grammar + limits (`1000d1000`, `1d20*2`, `kh` bounds, messages); adv/dis rewrite + no-d20 error; Shift/Ctrl/both → mode; manual range, die count, kept calc; `formatLine` (adv, dis, nat 20, nat 1, manual, multi-roll, undone); visibility matrix (DM / player × public / hidden; `dmPayload` stripped); FR-DICE-13 stamping (player forced public, DM override, DM for a PC); roll control: N expressions, crit swap on nat 20; seeded determinism; real factory refuses seeding on a non-disposable dir. **Playtest (#171):** `FR-DICE-28 kind contract` (for every registered kind: fill every `dmPayload` field with the sentinel `"DMONLY"` (numbers: a sentinel value) and assert `formatLine` without `dmPayload` never outputs it; a manual roll segment carries the "physical" badge); `FR-DICE-29` (initiative nat 1 / nat 20 → no marker; attack and save keep it). **Polish (R3):** `FR-DICE-30 compact bar` (closed by default: one row, ≤ 44 px; Options toggles row 2; dot per dirty rule; Physical on → strip with Options closed; stored state round-trips per (campaign, owner), no entry → closed, throwing storage → memory; DM eye preset follows the category). **Sprint 2:** `FR-DICE-31 crit keeps entries` (4d6 per-die 3, 4, 5, 6 then d20 20 → base boxes still 3, 4, 5, 6, extra group 4d6 empty; extra total 10 → `ManualEntry {diceTotal: 28}` for 8d6, with `dice` only when all 8 dice are entered; d20 back to 15 → extra group gone, base kept; `crit: true` on a Damage-only control → extra group shown at once, no d20 slot, `ManualEntry` for the crit expression); `FR-DICE-32 no silent roll` (empty extra total → no `onRoll`, focus + "Enter the total for 4d6 (critical)"; total 30 for 4d6 → "Total must be 4–24"; complete → one `onRoll`); `FR-DICE-33 activity` (`activity` = max `n` in the store; a hidden DM entry changes it for the DM only); `FR-DICE-34 actor list` (token-less active combatant listed by name; tokened ones not listed twice; removed / ended → gone) | In-code |
| Integration (S4) | `FR-DICE-34`: DM `dice.roll {actor: {combatantId}}` for a token-less combatant → entry `actorName` "Goblin 3", roll `actorKind` entity; unknown / ended → `not_found`; player sending it → `invalid` | `combat` (combat-tracker's bundle) |
| Integration | `dice.roll`: roll + entry + log row in one tx, event before `ack`, rollback → none. Ownership: `player-1` as Mira ✓, as Thorn `forbidden`, with `public` `forbidden`. Category change not retroactive; same value → no event. Settings never in player frames. Window: 105 entries → newest 100; floor cut before the filter; `markUndone` below the floor; convergence per ADR-0029. Test-registered kind via `gameLog.append` + `markUndone` commits / rolls back with its caller; multi-roll entry. **Leak scan:** player frames never contain "DM-SECRET-ROLL" or `dmPayload`. Restart → identical snapshots | `dice-log` |
| E2E (thin) | DM + `player-1`: player Shift+Enter roll appears for DM; DM hidden roll absent from player frames; DM public roll appears for player | `dice-log` |
| Unit (sprint 4) | `FR-DICE-35 log die chips`: `rollSegments` gives one `die` segment per die (kept / dropped, MOD / offered labels, manual with and without per-die values → chips / one round chip), `lineText` unchanged byte for byte vs sprint 3 for every `line.test.ts` case; `GameLog` renders `dice-log-die` with the right `data-shape` per faces and the roller's look; `FR-SHELL-35` layout test still ≥ 6 lines. `FR-DICE-36`: the DM's `cbt.attack` breakdown yields chips; the player view of the same entry has no `die` segment beyond the text it showed; FR-DICE-28 kind contract with `die` segments (sentinel never in a player line). `FR-DICE-36 segment format (S8)`: every `die` segment carries exactly one die (`faces`, `value`, `kept`, optional `label`); a labelled part ("Divine Fury" `1d6` = 4) → one labelled segment; an unapplied offered part → `kept: false`. `FR-DICE-37 focusLogEntry`: closed / minimised log opens and fronts, scrolls, `data-focused` 2 s; unknown id → opens only | in-code |

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
| 11 | Roll bar: expression `1d20+2`, label "Initiative", category initiative, actor Mira, Physical dice on, enter 1 | — | Line "Mira — Initiative: 1 + 2 = 3 physical", no "natural 1" (FR-DICE-29) |
| 12 | *(R3)* Physical dice off; Options closed; Launcher "Reset layout" (default 460×240 at 1440×900); roll `1d4` 8 times | B: Reset layout; same | A, B: roll bar one row, ≥ 6 single-line entries fully visible above it (FR-SHELL-35); Options → row 2 (category, actor, label, gear, physical) and the dot after picking Skill check; Physical on with Options closed → strip shows, ≥ 4 entries visible. Reload: Options state kept |

**G6 walkthrough** (sprint 2; `critExpressions` exist only on a routed attack in combat): stop; `fixtures:reset-load session-sim --profile verify`; start. A: Encounters → Start "Ambush at the Ford" (combat-tracker §13 setup), so B's sheet attacks route to combat. Button (review P2b-7): **Attack + damage** (`charx-roll-attack-damage`) once `fix/charx-buttons` has merged; before it, the old `charx-roll-attack` (then to-hit + damage) does the same. After P2a's `fix/combat2-split-attack`, also: Attack (natural 20 typed), then **Damage** → the popover opens with "Extra critical dice: 1d8" already shown (`crit: true`, X-1).

| # | DM (A) | Players (B) | Expected |
|---|---|---|---|
| 13 | — | B: Physical dice on; Mira's Light crossbow **Attack + damage**; type the damage total 6 first, then the d20 = 20 | Damage slot keeps "6" for 1d8 and shows "Extra critical dice: 1d8" with an empty total (FR-DICE-31) |
| 14 | — | B: Roll with the extra total empty; then 30; then 4 | Empty → inline "Enter the total for 1d8 (critical)", focus on it, nothing sent; 30 → "Total must be 1–8"; 4 → one card for A: "… (natural 20), 12 piercing (critical)" (6 + 4 + 2), line marked physical |

DM-only detail in combat lines (NPC dice, "DM ruled hit", physical tags on outcome lines) is walked in [combat-tracker §13](combat-tracker.md#13-test-plan) step 9a.

**Sprint 4 walkthrough:** log chips and `focusLogEntry` are walked with the dice display in [dice-extras §13](dice-extras.md#13-test-plan) steps 14, 22 and 26 (bundle `dice-display`). Also here, on `dice-log`: step 1 again → e1–e4 show die chips (e4's manual 15 as a d20 chip + "physical"); step 3 → B's adv line shows two d20 chips, one struck.

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

**Shared changes — playtest pass** (#171): none. FR-DICE-28 is a contract on kinds (combat's kind in `@shared/combat-tracker/log-kinds.ts` does the work); FR-DICE-29 is in `@shared/dice-roll-log/roll-kind.ts` (feature-owned). `kinds.ts`, schema, events, protocol unchanged; protocol §26 log-kinds row may cite FR-DICE-28 at consolidation.

**Shared changes — polish pass** (sprint 1, R3): none shared. Feature-owned: `src/client/common/features/dice-roll-log/{GameLog.tsx (bar layout), physical.ts (helper for the new key)}`. No DB, event, protocol or record change; one new browser key `pp.dice.options.v1.*`. Docs at consolidation: protocol §24 `dice.log` row (collapsed bar).

**Shared changes — sprint 2 phase 1** (P2b): none shared. Feature-owned: `src/client/common/features/dice-roll-log/{roll-control.tsx (extra crit group, inline error), logic.ts (slot completeness, `ManualEntry` merge)}` (G6); the `dice.log` window defs (`window.ts` / the DM and player `log-window` files) gain `activity` (N1, after play-shell's `activity?` field lands). No DB, event, protocol, record type or server change; `ManualEntry` unchanged. Docs at consolidation: protocol §26 roll-control row (crit as extra dice). *(S4)* FR-DICE-34: `@shared/dice-roll-log/schemas.ts` (DM actor `{combatantId}`), `src/server/features/dice-roll-log/commands.ts` (resolve via a combat-tracker read, as it already reads `token`), `GameLog.tsx` (list); protocol §5 `dice.roll` row at consolidation. Order (review plan): `fix/physical-crit` (G6, `crit: true`, FR-DICE-34) first; roll-control lock → P2a `fix/combat2-split-attack` (consumer of `crit: true`) → M `fix/mod-roll-preview`; dice-roll-log shared + server lock → M `fix/mod-core` (X-3).

**Shared changes — sprint 4** (#243 [17]): none in AGENTS §9.9. Feature-owned (D owns the dice display hotspot): `src/shared/dice-roll-log/{kind-types.ts (optional `die` on `LineSegment`), roll-kind.ts (segments)}`, `src/client/common/features/dice-roll-log/{GameLog.tsx (chips, focus), focus.ts (new)}`; `DieShape` from dice-extras. `kinds.ts`, schema, events, protocol unchanged. Order (seams S8): D5 `build/dice-shapes` (wave 1, lock-free) → R S4-5 `fix/fury-log-line` (also after R S4-1b, which holds combat's `log-kinds.ts`). Docs at consolidation: protocol §26 log-kinds row (`die` segment).

**Combat lines (R4, sprint 1):** [combat-tracker](combat-tracker.md) FR-CBT-57/58 add natural markers to `cbt.attack` lines from public `payload` fields only, so FR-DICE-28 holds unchanged.

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-DICE-03–22~~ | ~~Seeding; snapshot depth; shared changes; manual; visibility; defaults; contests; limits; log timing; glossary; storage; sheet buttons~~ | Decided: 05 no sessions (ADR-0013), 06 superseded, 08 #73, 12 #74; #137 (`ctx.dice`, newest 100, §14); #139 P6, P8, P21–P25; gate I3–I5, I13; #135 + I1 (`char.roll` out of combat, `cbt.*` in combat) | — | — |
| ~~OQ-DICE-23~~ | ~~Natural marker on initiative lines (G12)~~ | **Decided (#172):** no natural marker on initiative lines (FR-DICE-29) | — | combat-tracker |
| ~~OQ-DICE-25~~ | ~~R3: DM Game log history shows ~3 lines; multi-line outcome lines are cut~~ | **Decided #178:** collapse the roll bar to one row, options behind a chevron (FR-DICE-30). Rejected: taller or wider DM default (covers more map, R1) | — | play-shell |
| ~~OQ-DICE-26~~ | ~~G6: after a natural 20, how does the physical popover ask for crit damage?~~ | **Decided (#190):** keep the typed base dice, add an "Extra critical dice" group (FR-DICE-31) | — | combat-tracker (crit expressions) |
| OQ-DICE-27 | Sprint 4 [17]: how do log lines show the dice? (owner `spec-dice`, for the DM gate) | **A inline die-shape chips in place of the dice numbers: ≥ 6 lines still fit**. B a chip row under each line: bigger dice, about half the lines visible at default size (breaks FR-SHELL-35). C chips only in the Tooltip: no layout change, but not "the same dice" at a glance | no | FR-DICE-35, play-shell (FR-SHELL-35) |
| ~~OQ-DICE-28~~ | ~~Sprint 4 seam with R ([15] Divine Fury in the combat log): who builds the trigger part's dice in the line?~~ | **Settled by seams S8:** A: R, in R S4-5 `fix/fury-log-line` after D5 (and after R S4-1b), through D5's per-die `die` segments (`label` = part name; offered and not applied → `kept: false`); `die` segments DM-only exactly when their text is. Rejected: B D edits combat's `log-kinds.ts` | — | [effect-modifiers](effect-modifiers.md), [combat-tracker](combat-tracker.md) |
| ~~OQ-DICE-24~~ | ~~G12 verdicts (dice part)~~ | **Decided (#172):** verdicts accepted: "— natural 1" per FR-DICE-20 except initiative (FR-DICE-29); no group roll (each combatant rolls, FR-CBT-11); fixture clock by design (FR-FIX-08) | — | fixtures-adapters |

## 16. Out of scope

- As §4; plus text entries (a later kind) and combat undo semantics (→ [combat-tracker](combat-tracker.md)).
