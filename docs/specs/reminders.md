---
title: Reminders
prefix: REM
status: in-review
owner: spec-rs
phase: post-mvp-9
---

# Reminders

> Five-minute read for §1–§7. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Sprint 9, track RS: **BL-73** as the DM wrote it ([backlog](../agents/backlog.md), [#338](../decisions-log.md)); scope is decided, not open. DM questions are framed in [§15](#15-open-questions) with a **bold** pick. Companion spec: [strongholds](strongholds.md) (linked reminders). Cross-cutting design: [proposed ADR: reminders and strongholds as record families](../architecture/adr/proposed-s9-rs-record-families.md).

### At a glance

| FR | What | Slice ([§14](#14-dependencies)) | Named test ([§13](#13-test-plan)) |
|---|---|---|---|
| FR-REM-01–06 | Record, input, caps, copies | RS0 `fix/rs-core` | `FR-REM-02 input bounds`, `FR-REM-05 owner copy follows the PC` |
| FR-REM-07–12 | Save / delete, permissions, link rules | RS0 | `FR-REM-08 player rights`, `FR-REM-10 link only by the DM` |
| FR-REM-13–16 | Visibility per viewer, lazy load, leak rule | RS0 | `FR-REM-13 visibility per player`, `FR-REM-16 leak scan` |
| FR-REM-17–26 | Reminders tab (groups, rows, rolls, effects block, editor) | RS1 `build/rem-ui` | `FR-REM-17 groups per viewer`, `FR-REM-21 roll as`, `FR-REM-22 effects block` |
| FR-REM-27–29 | Fixtures, bundle, CON-44 | RS0 | `reminders-strongholds loads from empty`, `FR-REM-29 CON-44` |
| FR-REM-30–31 | Reconnect, crash | RS0 / RS1 | `FR-REM-30 reconnect`, `FR-REM-31 crash` |

## 1. Summary

- A **reminder** is a short text note, with optional clickable rolls, aimed at **the party** or **one character**: a stronghold perk, a blessing, a debt, a curse the party knows about. An optional **source** says where it comes from ("Greystone Keep: Steam Rooms").
- **No mechanics** (BL-73): a reminder never changes a roll, HP or a condition. Roll changes stay with [effects](effect-modifiers.md).
- Shown in the Party Manager's **Reminders** tab (players: the party + their own characters; the DM: all, grouped by character, party first) and in a **Reminders** section of the character sheet ([CHARX FR-CHARX-100–104](character-sheet-full.md#6-functional-requirements)). Each character group also shows a **read-only line of active conditions / effects / concentration** from combat, under existing visibility.

## 2. Scope

- Record type `reminder` (campaign scope, **lazy `"all"`**, [ADR-0045](../architecture/adr/0045-lazy-record-types.md)); intents `rem.save`, `rem.delete`; events `ReminderSaved`, `ReminderDeleted`.
- Reminders tab content (hosted by [party-board FR-PARTY-71–78](party-board.md#611-sprint-9-reminders-and-strongholds-tabs-track-rs)); sheet section `rem.reminders` (CHARX); effects line from [CBTX FR-CBTX-70](combat-extras.md#6-functional-requirements).
- Links to a [stronghold](strongholds.md) / facility (DM only); removing the stronghold or facility removes its reminders ([FR-HOLD-17, -19](strongholds.md#6-functional-requirements)).
- Fixtures + bundle `reminders-strongholds` (shared with HOLD).

## 3. Goals

- The DM adds a party reminder in ≤ 3 clicks; it shows in every player's tab ≤ 1 s after commit.
- A player sees, in one place, what applies to the party and to their own characters, with any roll one click away.
- No leak: a player never receives a DM-only reminder, a reminder linked to a DM-only stronghold or facility, or another player's character's reminder: snapshot, frames, `sync.load` acks; before and after a reconnect.
- CON-44: 0 B in every snapshot (lazy); measured load and event sizes in §12.

## 4. Non-goals

- Mechanics of any kind (modifiers, auto-apply, durations, triggers): [effect-modifiers](effect-modifiers.md).
- Timers, game-time expiry, notifications or toasts on reminders, per-session "used" counters.
- Reminders on monsters, pets or NPC creatures (characters only); reminder folders; rich text.

## 5. User stories

**DM**
- As the DM, I want to note "Steam Rooms: advantage on the first CON save after a long rest" for the whole party, so nobody forgets the keep's perk.
- As the DM, I want a reminder only I see on Thorn ("the blade is cursed"), so I can trigger it later.

**Player**
- As a player, I want my character's reminders on my sheet with the roll button next to them ("Lucky charm: add 1d4"), so I roll it without typing.
- As a player, I want to add my own reminder to my character ("Owe Brenna 20 gp").

## 6. Functional requirements

`env` = `CommandEnv`; campaign = `env.actor.campaignId`; IDs and time from `env.ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). Every command is one transaction with its event-log row. "Clean text" = trimmed, control characters removed (`text` keeps `\n`; `\r\n` → `\n`). **Target** = `{kind: party}` or `{kind: character, characterId}`.

### 6.1 Record and rules

| ID | Requirement | Notes |
|---|---|---|
| FR-REM-01 | Table `reminder` (§8), record type `reminder`, campaign scope, **lazy `"all"`**: never in a snapshot; loaded with `sync.load` ([FR-SYNC-30–37](live-sync.md)). | ADR-0045; §12 |
| FR-REM-02 | Input (strict zod): `target`; `text` clean 1–500; `source` clean 0–60; `rolls` 0–4 × `{id?, label 1–40, expression, category}` (`expression` canonical per [FR-DICE-01](dice-roll-log.md#6-functional-requirements), invalid → `invalid`; `category` from the dice categories, default `other`); `dmOnly` boolean (DM only, default false); `strongholdId`, `facilityId` (DM only, FR-REM-10). A character target must be a `character` entity of the campaign (else `not_found`). | |
| FR-REM-03 | Caps: ≤ 200 reminders per campaign, ≤ 30 per target (the party is one target). Over → `conflict` "Reminder limit reached (‹n›)". | §12 measured |
| FR-REM-04 | Roll ids come from `ctx.ids` on create; an edit keeps ids of rolls it keeps (matched by sent `id`). | stable keys for the UI |
| FR-REM-05 | **Owner copy** `ownerPlayerId` (server-written, DM-only key): the target character's `ownerPlayerId` at write; null for party. An entities owner change rewrites it for that character's reminders in the same transaction through **one line** in entities' `definitionChangedHooks` (`src/server/features/entities/definition-hooks.ts`, append; as macros FR-DICEX-65); the event's changes carry the rows, so the old owner gets deletes and the new owner upserts. | ADR-0024 copy rule |
| FR-REM-06 | **Link copy** `linkHidden` (server-written, DM-only key): true iff the linked stronghold is DM-only, or the linked facility is DM-only ([FR-HOLD-07](strongholds.md#6-functional-requirements)). Written by `rem.save` and by every HOLD command that changes either flag, in that command's transaction (changes ride on its event). | no cross-record read in the visibility fn |

### 6.2 Commands and permissions

| ID | Requirement | Notes |
|---|---|---|
| FR-REM-07 | `rem.save {id?, target, text, source, rolls, dmOnly?, strongholdId?, facilityId?}`: no `id` → create (`seq`, `createdByPlayerId` = the actor's player id, null for the DM); with `id` → full replacement of that row (`not_found` across campaigns). Same values → `ack`, no write, no event. Emits `ReminderSaved {reminderId, created}` (changes: the row). Result `{reminderId}`. | |
| FR-REM-08 | **Who** (OQ-REM-01 **B**): the DM: any reminder. A player: create on `party` or an **own** character (owner = `ownerPlayerId` at commit, else `forbidden`); edit / delete only rows they created (`createdByPlayerId` = self) **and** still on party or an own character; never `dmOnly`, `strongholdId`, `facilityId` (sent → `forbidden`). The DM's reminders are read-only for players (as macros, FR-DICEX-66). A player's row whose PC changed owner: the creator loses edit rights (the new owner sees it read-only). | OQ-REM-01 |
| FR-REM-09 | `rem.delete {id}` (rights as FR-REM-08): deletes the row; emits `ReminderDeleted {reminderIds}`. Unknown → `not_found`; a row the player can't see → `not_found` (never reveals it exists). | |
| FR-REM-10 | **Links** (DM only): `strongholdId` must be a stronghold of the campaign; `facilityId` (optional) a facility of that stronghold (else `not_found`); `facilityId` without `strongholdId` → `invalid`. A link never changes the target or text. | [strongholds](strongholds.md) |
| FR-REM-11 | **Removal with the source** (BL-73): `hold.removeFacility` deletes every reminder with that `facilityId`; `hold.delete` every reminder with that `strongholdId`, in the same transaction ([FR-HOLD-17, -19](strongholds.md#6-functional-requirements)); their ids ride on that event (`reminderIds`). The client confirm names the count. | BL-73 |
| FR-REM-12 | **Hidden reminders** (OQ-REM-02 **A**): the DM may set `dmOnly` on any reminder, including one a player created (the player then loses it from view, and it stays editable by the DM only). | OQ-REM-02 |

### 6.3 Visibility and loading

| ID | Requirement | Notes |
|---|---|---|
| FR-REM-13 | Visibility fn `reminder`: **DM full**. **Player hidden** if `dmOnly`, or `linkHidden`, or (`characterId` set and `ownerPlayerId` ≠ the viewer). Otherwise **redacted**: drops `dmOnly`, `linkHidden`, `ownerPlayerId`. So a player gets party reminders and their own characters' reminders only (BL-73); another player's character's reminders never reach them. A flag flip is an upsert to gainers and a delete to losers (record-change rule). | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) B |
| FR-REM-14 | Clients load with `useLazyRecords("reminder")` when the Reminders tab, the sheet section or a Stronghold window's Reminders tab mounts; consumers check `isLoaded`, never presence ([FR-SYNC-35](live-sync.md)). After a snapshot (reconnect, resync) a mounted view reloads. Loading: skeleton rows; reject: inline "Couldn't load — Retry". | FR-SYNC-35–37 |
| FR-REM-15 | Live events reach every connection that may see the row, loaded or not ([FR-SYNC-34](live-sync.md)). `ReminderSaved` for a DM-only row sends players nothing (the hub's filter: no visible change). | |
| FR-REM-16 | **Leak rule** (tests): with the bundle, `player-1`'s frames, snapshots and `sync.load` acks never contain Thorn's reminders ("REM-THORN-OWN", "REM-SECRET-THORN"), a DM-only reminder, or a reminder linked to a DM-only stronghold / facility ("REM-SECRET-VAULT"); `player-2`'s never contain Mira's ("REM-MIRA-CHARM") or the DM-only ones; before and after a reconnect, and after an owner change. | |

### 6.4 Reminders tab and rows (content; the tab itself is [PARTY FR-PARTY-71–78](party-board.md#611-sprint-9-reminders-and-strongholds-tabs-track-rs))

| ID | Requirement | Notes |
|---|---|---|
| FR-REM-17 | **Groups**: **Party** first, then one group per character. DM: every `character` entity of the campaign by name (empty groups collapsed to the header with "+ Add"). Player: own characters by name (none → only Party). Group header: name, the owner's colour dot ([FR-CAMP-29](campaign-management.md#6-functional-requirements)), count. Rows in creation order, oldest first (OQ-REM-04 **A**). | BL-73 |
| FR-REM-18 | **Row**: text (plain text, line breaks kept, never HTML), source muted under it ("Greystone Keep: Steam Rooms"; with a link, a small icon that opens the Stronghold window on it, [FR-HOLD-23](strongholds.md#6-functional-requirements)), one roll button per roll, and for the DM an eye-off "DM only" Badge on hidden rows (or "Hidden with the stronghold" when only `linkHidden`). Menu: Edit, Delete (inline confirm) where FR-REM-08 allows. | |
| FR-REM-19 | **Editor** (Dialog): Target Select (Party / characters the viewer may target), text Textarea + counter, source Input, rolls (≤ 4 rows: label, expression with live check, category; add / remove), DM: "DM only" Switch and the link (Stronghold Select, then Facility Select or "Whole stronghold"). Save disabled while invalid (FR-REM-02 mirrored), unchanged, not `live` or in flight; reject → inline, values kept; lost intent → Toast "Connection lost — check the reminder before saving again". | as FR-PARTY-15 |
| FR-REM-20 | **Add**: "+ Add" on each group the viewer may target (players: Party and own characters; DM: all), prefilled with that target. | |
| FR-REM-21 | **Rolls use the macros' roll path** (OQ-REM-03 **A**): each roll is a `RollButton` + `useRollControl` (label = roll label) sending `dice.roll` unchanged ([FR-DICEX-68](dice-extras.md#6-functional-requirements)): Shift / Ctrl, physical dice, Alt → tray, throw and popup as any roll. **Roll as**: a character reminder → that character (owner or DM); a party reminder → in the Party Manager the player's "Me" / the DM's "DM" (as a General macro), on a sheet section that sheet's character. Never an attack or apply. Not `live` → disabled. | OQ-REM-03 |
| FR-REM-22 | **Effects block** (BL-73): under each character group's header, CBTX's read-only effects line ([FR-CBTX-70](combat-extras.md#6-functional-requirements)) for that character: active conditions (exhaustion with level), custom effects, concentration (its label), rounds left if timed; only effects the viewer already receives (FR-CBTX-31: players never secret, hidden or ended ones; the DM sees secret ones with eye-off). None → no line. No actions in this line. | 0 B; FR-CBTX-31 |
| FR-REM-23 | **Live**: rows and effects re-render from upserts / deletes (another tab's edit, a DM hide, an owner change, an effect ending). A row deleted while its editor is open → the editor shows "This reminder was removed" and Save disables. | |
| FR-REM-24 | **States**: empty Party group "No party reminders yet"; player with no characters → Party only; disconnected → last view, every action disabled; load error → Retry. | |
| FR-REM-25 | **Shared component**: the tab content, row and editor live in `src/client/common/features/reminders/` (`RemindersTab.tsx`, `ReminderRow.tsx`, `ReminderEditor.tsx`), used by the Party Manager tab, the sheet section (CHARX) and the Stronghold window's Reminders tab (HOLD, filtered by link). | |
| FR-REM-26 | **Layout**: at the Party Manager's default width (550 px, PM) a row shows text, source and up to 4 roll buttons wrapping to a second line; names and text wrap, never cut (W4 rule). | |

### 6.5 Fixtures, CON-44, failure

| ID | Requirement | Notes |
|---|---|---|
| FR-REM-27 | Fixture units (`fixtures/units/reminders/`, setups through `rem.save`; fixed clock; patches only): `rem-party` (DM, party: "Fresh bread: +1 HP on a short rest", no roll), `rem-mira-charm` (DM, Mira: "REM-MIRA-CHARM Lucky charm: once a day add 1d4 to a save", roll "Charm" `1d4`, category `saving-throw`), `rem-thorn-own` (as `player-2`, Thorn: "REM-THORN-OWN Owe Brenna 20 gp"), `rem-thorn-secret` (DM, Thorn, `dmOnly`: "REM-SECRET-THORN The blade is cursed"). Linked reminders are HOLD's units ([FR-HOLD-35](strongholds.md#6-functional-requirements)). | ADR-0017 |
| FR-REM-28 | Bundle **`reminders-strongholds`** = `party-board` + the REM and HOLD units ([§13](#13-test-plan)); loads from empty, deterministic ([FR-FIX-08](fixtures-adapters.md#6-functional-requirements)). The four REM units are **session-sim-12-safe** (new rows only; no pot, sheet or combat change) and join `session-sim-13`. | |
| FR-REM-29 | **CON-44** (measured, §12): `reminder` absent from every snapshot (0 B); tests assert it and bound the worst DM `sync.load` ack at the cap (≤ 370 KB). | |
| FR-REM-30 | **Reconnect**: the snapshot purges lazy rows (FR-SYNC-37); a mounted tab / section reloads and shows only what is visible now (a reminder hidden or moved to another player's PC while away is simply absent). | |
| FR-REM-31 | **Crash**: each command commits with its event-log row or not at all; a facility / stronghold removal and its reminders' deletes are one transaction (`PP_TEST_CRASH=hold.removeFacility:before-commit` → both still there; `:after-commit` → both gone). | #163 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Tabs, Button, Badge, Dialog, Input, Textarea, Select, Switch, Tooltip, ScrollArea, Skeleton. No custom styling.

- **DM view:** Party group, then every character; DM-only rows with eye-off; Add on every group; the editor has "DM only" and the stronghold link.
- **Player view:** Party + own characters; Edit / Delete only on rows they created; DM rows plain. The effects line shows what the token and sheet already show.
- **States:** skeleton while loading; Retry on error; disconnected = last view, actions disabled.
- **Test IDs** (prefix `rem-`): `rem-tab`, `rem-group` + `data-record-id` (character id, `party` for the party), `rem-group-add`, `rem-row` + `data-record-id` + `data-dm-only`, `rem-row-text`, `rem-row-source`, `rem-row-link`, `rem-row-roll` + `data-record-id` (roll id), `rem-row-menu`, `rem-row-edit`, `rem-row-delete`, `rem-row-delete-confirm`, `rem-effects` + `data-record-id` (character id), `rem-editor`, `rem-editor-target`, `rem-editor-text`, `rem-editor-source`, `rem-editor-roll-label` / `-expression` / `-category` / `-remove` + `data-index`, `rem-editor-roll-add`, `rem-editor-dm-only`, `rem-editor-hold`, `rem-editor-facility`, `rem-editor-save`, `rem-editor-error`, `rem-editor-gone`, `rem-empty`, `rem-loading`, `rem-retry`. Effects line chips reuse CBTX's `cbtx-effect-chip` IDs.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Reminder (`reminder`) | id, campaignId, seq | ID, ID → Campaign, int | `ctx.ids`; creation order |
| | characterId | ID \| null | null = party; a `character` entity (no FK; entities has no delete) |
| | text, source | text 1–500, text 0–60 | Plain text |
| | rolls | **JSON leaf** 0–4 × `{id, label, expression, category}` | FR-REM-02 |
| | strongholdId, facilityId | ID \| null ×2 | FR-REM-10; no FK (deleted with the source, FR-REM-11) |
| | dmOnly | bool | FR-REM-12 |
| | ownerPlayerId | ID \| null | **copy**, FR-REM-05; DM-only on the wire |
| | linkHidden | bool | **copy**, FR-REM-06; DM-only on the wire |
| | createdByPlayerId | ID \| null | null = DM; edit rights (FR-REM-08) |
| | createdAt, updatedAt | timestamp ×2 | `ctx.clock` |

- **Relations:** campaign 1–n reminder; character 0..1–n; stronghold / facility 0..1–n (by id).
- **Derived:** groups, order, roll-as actor, effects line (client).
- **Persisted runtime state:** rows only. Indexes `(campaignId, seq)`, `(campaignId, characterId)`, `(strongholdId)`.

## 9. API & events

**REST:** none.

**Record types**

| Type | Scope | DM | Player | Snapshot |
|---|---|---|---|---|
| `reminder` | campaign | full | FR-REM-13: hidden or redacted | **lazy `"all"`** |

**WS intents** (none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `rem.save {id?, target, text, source, rolls, dmOnly?, strongholdId?, facilityId?}` | DM, player | FR-REM-02, -03, -08, -10 | `{reminderId}` |
| `rem.delete {id}` | DM, player | FR-REM-08, -09 | — |
| `sync.load {type: "reminder"}` | DM, player | ADR-0045 | `{records}` |

**WS events** (domain events; all logged; not undoable)

| Event | Payload | Changes | Visibility rule |
|---|---|---|---|
| `ReminderSaved` | `{reminderId, created}` | reminder | FR-REM-13 per viewer (DM-only row: players nothing) |
| `ReminderDeleted` | `{reminderIds}` | reminder → null | DM + players who could see it |
| HOLD's `FacilityRemoved`, `StrongholdDeleted`, `StrongholdUpdated` | per HOLD | + reminder deletes / `linkHidden` upserts | FR-REM-13 per row |
| entities' `EntityUpdated` (owner change) | per ENT | + reminder `ownerPlayerId` upserts | FR-REM-13: old owner delete, new owner upsert |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| See reminders | all | party + own characters, not hidden | FR-REM-13 |
| Add | any target | party, own characters | FR-REM-08 at commit |
| Edit / delete | any | own-created, on party / own character | `createdByPlayerId`, owner at commit |
| Hide (DM only), link to a stronghold | ✓ | ✗ | `forbidden` |
| Roll a reminder's roll | as DM / any | as own character or "Me" | `dice.roll` rules (FR-DICE-10) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** FR-REM-30. Missed changes arrive with the reload; no toasts exist.
- **DM disconnect / reconnect:** players unaffected; DM forms disabled; a lost intent → Toast (FR-REM-19).
- **Server crash mid-action:** FR-REM-31; after restart loads equal the pre-crash state (digest identical).
- **Concurrent edits:** commands serialise; two tabs saving one row → last write wins, the other editor shows "Changed in another tab" and keeps its draft. A delete racing an edit → `not_found` "This reminder was removed".
- **Owner change mid-session:** FR-REM-05; a player's open editor for a row they lose → the row leaves, editor shows "This reminder was removed".
- **Stronghold shown / hidden:** `linkHidden` flips in that command → linked rows appear / leave for players at once.
- **Invalid / malicious input:** over-long text, > 4 rolls, bad notation, foreign ids, a player sending `dmOnly` / links, strict-key violations → `invalid` / `forbidden` / `not_found`. Text rendered as text, never HTML.
- **Campaign switch:** `4409`; the next snapshot and loads are the new campaign's only.

## 12. Performance & bandwidth

**Measured** (throwaway probe on `session-sim` + `buildRealisticHeavy`, frames as `snapshotSizes`, max-length ASCII, 36-char ids; probe deleted). Base heavy: DM **691,581 B**, players 286,190–289,445 B. Realistic = 30 reminders (8 party, 22 on 6 PCs, 3 hidden; 140-char text, half with one roll). Cap = 200 at max length (500-char text, 60-char source, 4 rolls with 59-char notation, links).

| What | Realistic | Cap (200) |
|---|---|---|
| **Snapshot, lazy (pick)** | **0 B** every viewer | **0 B** |
| Snapshot if not lazy (rejected) | DM +17,786 B; player-1 +5,683 B | DM **+369,131 B** (≈ 1.15 MB worst → 1.52 MB, at the 1.5 MiB ceiling) |
| `sync.load` ack | DM 17,873 B; worst player 6,780 B | DM 369,218 B; one player holding all non-hidden 359,204 B |
| `ReminderSaved` frame (one row) | 798 B | 2,062 B |

- Load results stay far below the 4 MiB frame limit. Rates: human-paced (a few per session). Tunnel: a load once per open per snapshot generation.
- Effects line: 0 B (reads `effect` rows already in the snapshot).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). `bun test` on `:memory:`, port 0. Tests named after FRs.

**Bundle `reminders-strongholds`** = `party-board` (base, player-2, Mira, Thorn, party items, loot, campaign-second) + REM units (FR-REM-27) + HOLD units ([FR-HOLD-35](strongholds.md#6-functional-requirements)). E2E alias bundle `rs-e2e` (same units; state-changing specs get their own).

| Level | What | Fixtures |
|---|---|---|
| Unit | zod bounds (`FR-REM-02 input bounds`: 501 chars, 5 rolls, bad notation, party target with `characterId`); visibility fn table (`FR-REM-13 visibility per player`: DM full; party → all players; Mira's → player-1 only; `dmOnly` / `linkHidden` → hidden; redaction drops the three DM keys); client: groups per viewer (`FR-REM-17 groups per viewer`), roll-as actor per surface (`FR-REM-21 roll as`), effects line filtering (`FR-REM-22 effects block`: secret only for the DM, ended never), editor locks | — |
| Integration | Commands: `FR-REM-07 save and no-op`, caps (`FR-REM-03`), `FR-REM-08 player rights` (create on party / own; edit own-created only; DM rows read-only; `dmOnly` / link → `forbidden`), `FR-REM-10 link only by the DM`, `FR-REM-05 owner copy follows the PC` (Thorn → player-1: player-2 gets deletes, player-1 upserts, over a real socket), `FR-REM-06 link copy` (HOLD hide / show flips rows), `FR-REM-11 removal with the source` (facility → its 2 reminders gone, one event), `FR-REM-16 leak scan` (per player: snapshot, every frame, `sync.load` acks; before and after a reconnect; after the owner change), `FR-REM-29 CON-44` (absent from snapshots; DM load ≤ 370 KB at the cap), `FR-REM-30 reconnect` (purge + reload), `FR-REM-31 crash` (`PP_TEST_CRASH`) | `reminders-strongholds` |
| E2E (thin) | DM adds a party reminder with a roll → player-1's Reminders tab shows it; player-1 clicks the roll → the Game log shows the roll as "Me"; player-2's tab has no Mira group | `rs-e2e` |

**Browser walkthrough RS-R** (test agent; `bun run build`; `fixtures:reset-load reminders-strongholds --profile verify`; `start --profile verify` in its pane). Contexts **A** DM, **B** player-1 (Mira), **C** player-2 (Thorn). Every change ≤ 1 s. Leak scan = C's (and B's) WS frames + DOM for the listed strings.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| R1 | Party Manager → Reminders | — | Party: "Fresh bread", "Steam Rooms…" (linked, source); Mira: REM-MIRA-CHARM with "Charm"; Thorn: REM-THORN-OWN, REM-SECRET-THORN (eye-off "DM only"); effects lines where effects exist |
| R2 | — | B, C open Reminders | B: Party + Mira (charm + roll). C: Party + Thorn (REM-THORN-OWN only). Leak scan: B never "REM-THORN-OWN" / "REM-SECRET-THORN"; C never "REM-MIRA-CHARM" / "REM-SECRET-THORN"; nobody "REM-SECRET-VAULT" |
| R3 | — | B clicks "Charm" | Roll "Charm 1d4" as Mira in the Game log, dice as any roll |
| R4 | Thorn: add "Rage lasts 1 minute" | C | C sees it at once; read-only for C (no Edit) |
| R5 | — | C edits REM-THORN-OWN → "Owe Brenna 25 gp" | Saved; A sees the change; B nothing |
| R6 | Set REM-THORN-OWN "DM only" | C | Row leaves C's list; leak scan C clean |
| R7 | Give Mira the Poisoned condition (Initiative / sheet) | B | Mira's group shows the Poisoned chip, read-only; C nothing for Mira |
| R8 | — | B opens Mira's sheet → Reminders tab | Mira's reminders, then Party; "Charm" rolls as Mira |
| R9 | — | B reloads | Skeleton, then the same rows |
| R10 | Hard-kill + restart the server | — | All rejoin; tabs reload identical to R9; leak scans clean; no console errors |

Teardown: stop the server, then `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0045](../architecture/adr/0045-lazy-record-types.md) | `lazy: "all"`, `sync.load`, `useLazyRecords` / `isLoaded`, purge | built |
| [entities](entities.md) | `definitionChangedHooks` (append one line) for the owner copy | built |
| [dice-extras](dice-extras.md) | `RollButton` + `useRollControl` (macros' path, FR-DICEX-68) | built |
| [combat-extras](combat-extras.md) | Read-only effects line export (FR-CBTX-70) | this track (RS1) |
| [party-board](party-board.md) (PM2 first, seams S1) | `party-tabs.ts` registry entry, `order: 50` | PM1 + PM2, then RS1 |
| [character-sheet-full](character-sheet-full.md) | `sheet-sections.ts` append (FR-CHARX-100) | RS1 |
| [strongholds](strongholds.md) | Links, removal with the source, `linkHidden` writes | RS0 |
| New npm dependency | **none** (text, dice and lists use what exists) | — |

**Build split** (AGENTS §9.9; the full RS split is in [strongholds §14](strongholds.md#14-dependencies)): **RS0 `fix/rs-core`** holds the schema / core lane first and alone (seams S10: tables `reminder`, `stronghold`, the Stores columns, `src/shared/events/`, record-type lines, `features/index.ts`), REM's server, fixtures and tests; **RS1 `build/rem-ui`** (after RS0, PM1 and PM2): `src/client/common/features/reminders/` (new, feature-owned), one `party-tabs.ts` entry (`order: 50`, S1), one `sheet-sections.ts` line (append, S12), CBTX's read-only export (`src/client/common/features/combat-extras/sheet-sections.tsx`, CBTX-owned, by assignment, S12). Roll buttons **import** `RollButton` + `useRollControl` from `@ui/features/dice-extras/` without editing dice-extras files (a missing export = a one-line grant); FX2 merges before RS1, else RS1 merges main and re-tests (S11). RS1 ∥ RS2 (strongholds UI).

## 15. Open questions

**Bold** = suggested pick (not decided). DM questions first.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-REM-01 | **DM:** who can add / edit / delete reminders? | A. DM only; players read / **B. Players add on the party and their own characters and edit / delete only what they created; the DM any; the DM's are read-only for players (as macros)** / C. Players edit any reminder they can see. *Tradeoff:* B lets players keep their own notes without touching the DM's | yes | FR-REM-08 |
| OQ-REM-02 | **DM:** can a reminder be hidden from players? | **A. Yes: the DM marks any reminder "DM only"** (eye-off for the DM) / B. No hidden reminders (DM notes elsewhere). *Tradeoff:* A costs one flag and one leak test; sprint-9 gate already plans "a hidden reminder" | yes | FR-REM-12, -13 |
| OQ-REM-03 | **DM:** does a reminder's roll use the macros' roll path? | **A. Yes: roll buttons exactly like macros (`dice.roll`, Shift / Ctrl, physical dice, Alt → tray)** / B. Clickable notation inside the text only (as handouts) / C. A reminder points at a saved macro. *Tradeoff:* A reuses a built path with no parser; B has no labels; C couples two lists | yes | FR-REM-21 |
| OQ-REM-04 | **DM:** ordering inside a group | **A. Creation order, oldest first** / B. Manual ↑ / ↓ (one more intent, a shared order) / C. Newest first. *Tradeoff:* A costs nothing; reorder is additive later | no · owner: DM gate | FR-REM-17 |
| OQ-REM-05 | **DM:** "done" / dismiss vs permanent | **A. Permanent until deleted** / B. A "Done" tick that strikes it out (kept; "Hide done") / C. One-shot: Done deletes it. *Tradeoff:* A is simplest and matches "no mechanics"; B adds state per row | no · owner: DM gate | FR-REM-07 |
| OQ-REM-06 | **SP (session recap):** should the recap list reminders added this session? | **Closed per seams S9 + OQ-RECAP-03 (both picks A):** the recap lists no reminders and no stronghold events this sprint; no strongholds palette provider either (later append). Rejected: ~~list reminders added / removed this session~~ | — · closed (S9) | session-recap (SP) |
| OQ-REM-07 | **Glossary:** add **Reminder** ("a text note with optional rolls for the party or one character; no mechanics"); amend **Condition** ("Reminder only" → "no mechanics", to avoid two meanings) | **Add + amend** | no · owner: integrator | glossary |
| OQ-REM-08 | Snapshot or lazy (measured §12) | **Lazy `"all"`** (0 B; ADR-0045's one path) / in the snapshot (+17.8 KB DM realistic, +369 KB at the cap). In the proposed ADR | no · owner: DM gate (ADR) | live-sync |

## 16. Out of scope

- Mechanics, timers, game-time expiry, toasts or bell entries for reminders (later: an info toast when the DM adds one to your character).
- Reminders on monsters, pets, NPC creatures; manual ordering (OQ-REM-04 B); "Done" state (OQ-REM-05 B); clickable notation in the text (OQ-REM-03 B).
- Reminders in the session recap (seams S9, OQ-REM-06 closed).
