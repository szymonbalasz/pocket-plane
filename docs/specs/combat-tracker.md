---
title: Combat tracker
prefix: CBT
status: in-review
owner: spec-combat-tracker
wave: 3
---

# Combat tracker

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Replaces Shieldmaiden for one table: **build an encounter** with a difficulty rating, **start** it on a prepped battlemap, run initiative and turns, **confirm every attack** in the DM's attack popup, track HP, **undo** mistakes ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #53, #55, #74).
- Every attack is a **damage card** (notification kind `damage-card`), created in the attack command's transaction ([ADR-0027](../architecture/adr/0027-notification-creation.md)). The card has no target; **the DM picks the target** and applies (#134, #135). Apply = HP change + game-log line + card resolved, in one transaction. Server-side only: commands, in-transaction hooks and helpers. **No listener writes state.** All combat state is in the DB, so a crash mid-turn loses nothing.

## 2. Scope

MVP = tier S ([feature tiers §2, §5, §7](../feature-tiers.md#2-combat)).

- **Encounter builder:** name, creatures × quantity from **one picker** over every monster definition (any source, #84; type-to-filter), party (default all characters), live XP, rating and total CR. Lifecycle planned → started → ended (#78).
- **Custom creature form** (Shieldmaiden-style, #85): New / Derive / Edit, from the Creatures window ([FR-ENT-20](entities.md#6-functional-requirements)). **Start** binds combatants to tokens the DM placed (some hidden, #77; hidden tokens → hidden combatants, #76). **End.**
- Initiative: roll (one click for all monsters, individual rolls) or enter; deterministic ties. Next / previous turn; rounds.
- **Attack** (DM from the initiative list; player from the sheet while in combat, #135): to-hit + damage rolled server-side (Shift adv / Ctrl dis, manual entry) → card → **attack popup** (DM picks target; hit vs AC computed; override any value; normal / half / none / double) → apply.
- Direct damage / heal (DM). Remove / restore a combatant. **Undo** (DM, strict LIFO, damage/heal only, [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).
- Player initiative view with **monster health band** (healthy / bloodied / down). **Stats capture** (#54): every HP change stores source, target, attack, rolls, overrides, applied, overkill, HP before/after.

## 3. Goals

- One full fight vs mixed enemies runs from the play page: no one reads numbers aloud, the DM confirms every hit ([roadmap](../roadmap.md) Combat exit).
- Players never learn a hidden combatant (name, ID, rank, turn; except a hidden PC's own sheet rolls, OQ-CBT-28), a monster's AC, stats or HP number (only the band, and the damage their own hit applied, #138), or a planned encounter.
- Hard kill mid-turn → restart → round, turn, initiative, HP, pending cards and game log intact ([vision](../vision.md#success-criteria)).
- A wrong damage is fixed in two clicks (Undo, re-apply the reopened card).

## 4. Non-goals

- Conditions, concentration, durations, temp HP, death saves, add combatants mid-fight, token-less hidden combatants, legendary / lair / reactions → [combat-extras](post-mvp/combat-extras.md).
- Drag-to-reorder initiative, current-turn token highlight, end-of-combat summary (tier B); player target selection, stat block on token click (later, unranked; #134). Rules automation beyond the hit hint.
- Redo (re-apply the reopened card). Undo of initiative, turns, removals (#70). Undo after End. Multi-target, custom actions, spells (tier A). Party HP for players (tier B). Stats UI → [stats](post-mvp/stats.md). Gems → [gems](post-mvp/gems.md) (design-for-later only, FR-CBT-32).

## 5. User stories

- **DM:** As the DM, I want to pick goblins, a wolf and my Elite Goblin Warrior from one list and see "Deadly", and have Start pick up the tokens I placed (hidden stay hidden), so that prep is done before the session.
- **DM:** As the DM, I want each attack in a popup where I pick the target, see hit/miss vs AC and fudge numbers, and undo a wrong apply, so that I stay in control and mistakes cost seconds.
- **Player:** As a player, I want to press Attack on my sheet (Shift for advantage), see the damage my hit did, the turn order and whether a monster is bloodied, so that nobody reads numbers aloud and I can plan.

## 6. Functional requirements

All commands: rows + event-log entry + domain event in one transaction, then helper events (I15); IDs and time from `ctx`, dice from `ctx.dice` ([AGENTS §9.3](../../AGENTS.md#93-fixtures), #137). Helpers take `env: CommandEnv`; campaign and player = `env.actor.campaignId` / `.playerId`. Failure → no change, event or log entry.

| ID | Requirement | Notes |
|---|---|---|
| **Prep** | | |
| FR-CBT-01 | Encounter create / update / delete (REST, DM): `{name, partyCharacterIds \| null, entries [{definitionId, quantity}]}`. Name trimmed 1–60, no control chars. 0–20 entries, quantity 1–20, total ≤ 50; ≤ 30 non-ended encounters per campaign (`conflict`). Definitions via `resolveDefinition`, kind `monster` (else `invalid`); duplicate definitions merged. Update / delete only while `planned`, else `conflict`. | ADR-0021 D |
| FR-CBT-02 | Party: `null` = every character of the campaign at read time; a list holds only characters of the campaign (else `invalid`). | #139 (P12) |
| FR-CBT-03 | Difficulty is **derived, never stored** (#136). `difficultyMethods` registry in `@shared/combat-tracker`: `{id, label, rate(partyLevels, monsterCrs)}`; MVP ships one, `dmg-2014`: XP per CR (entities' table, CR 0 = 10); thresholds = sum of per-level easy / medium / hard / deadly; ladder `[×0.5, ×1, ×1.5, ×2, ×2.5, ×3, ×4, ×5]`, base step by monster count 1 / 2 / 3–6 / 7–10 / 11–14 / 15+ = ×1 … ×4, one step up for < 3 PCs, one down for ≥ 6, clamped. Rating = highest threshold ≤ adjusted XP, else "Trivial"; no party → "—". Card shows rating, base / adjusted XP, thresholds and **total CR** (sum, secondary); live while editing. DMG numbers only, no text (licence note, [ADR-0018](../architecture/adr/0018-global-imported-content.md)). | #136, I27 |
| FR-CBT-04 | Creature picker: one Combobox of every monster the campaign can use, FR-ENT-18 order, type-to-filter; row = name, CR, XP; never branches on source. Pick adds quantity 1, or +1 if present. | #84 |
| FR-CBT-05 | Creature form (Dialog), `creatureActions` New (blank), Derive (any monster; name = base, or "‹name› (copy)" for a custom), Edit (customs only). Fields = creature core: name, size, AC, HP max, init bonus, CR (+ XP), portrait (asset picker), optional attack (name, to-hit, damage, damage type). Entities' zod; saves via `POST` / `PUT /api/entities`; errors inline. | FR-ENT-09/11 |
| FR-CBT-06 | Definition-changed hook ([FR-ENT-19](entities.md#6-functional-requirements)) `(env, before, after)`: active monster combatants of the definition get the new `hpMax`; `hpCurrent` = new max if it equalled the old, else clamped. Any combatant whose `imageAssetId` = the old portrait takes the new one. Rows go into `EntityUpdated.changes`. | I10, I23 |
| **Start / end** | | |
| FR-CBT-07 | `cbt.start {encounterId, sceneId}`: encounter `planned`, no other `started` in the campaign (`conflict`), scene in campaign. Creates combatants, `round 0`, `turn null`, status `started`, ranks (FR-CBT-13), then `EncounterStarted`. | #139 (P15) |
| FR-CBT-08 | Binding: party characters by name, then entries in order × quantity. Each takes the next unbound token on the scene with that `definitionId` (token `seq` order) and copies its `name`, `imageAssetId`, `hidden`. None left → token-less, visible: name per FR-MAP-16 numbering over the encounter's combatant names ("Goblin" → "Goblin 3"), image = portrait. Monsters: `hpMax = hpCurrent = effectiveStats.hpMax`. Start dialog previews bindings ("no token" marked). | #139 (P16) |
| FR-CBT-09 | Token-changed hook ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) `(env, before, after \| null)`: rename / image / hide / reveal of a token bound to an active combatant updates its copies in the token command's transaction, plus ranks and the player turn copy if `hidden` changed. Delete (token or scene) of a token bound to an active combatant → `conflict` "Token is in a running encounter"; other bound combatants get `tokenId` null. | #134 |
| FR-CBT-10 | `cbt.end {encounterId}`: `started` → `ended`, `endedAt`; every combatant `active = false` (players get deletes). Open cards stay pending; apply → `conflict` "Encounter has ended"; the DM dismisses. | #139 (P17) |
| **Initiative and turns** | | |
| FR-CBT-11 | `cbt.rollInitiative {combatantIds (1–50), mode?, manual?, public?}`: one roll each, d20 + init bonus (`characterRolls(effectiveStats, "initiative")`), via `dice.evaluate` + one `roll` entry each (category initiative, `encounterId`, `public` per FR-CBT-24: hidden → false). Player: exactly one own PC (`ownerPlayerId`), initiative still null (else `conflict`), no `public` (→ `forbidden`, as FR-DICE-13). `manual` needs exactly one combatant (else `invalid`). DM may overwrite. "Roll monsters" sends every monster without initiative. | I25, #139 (P10) |
| FR-CBT-12 | `cbt.setInitiative {combatantId, value}` (DM): int −10…50, no roll. | Manual "enter" |
| FR-CBT-13 | Order: initiative desc, init bonus desc, PC before monster, combatant `seq`; no initiative last. The server writes `position` (1…n, all combatants) and `playerPosition` (1…k over active, non-removed, non-hidden; else null) for every row whose value changed, in the commanding transaction (start, initiative, remove / restore, hide / reveal hook). | #139 (P3) |
| FR-CBT-14 | `cbt.nextTurn` / `cbt.prevTurn {encounterId, expectedRound, expectedTurnId}`; mismatch → `conflict`. Eligible = not removed and not a monster at 0 HP. Round 0 next: every non-removed combatant needs initiative (`conflict` "N without initiative"), then round 1, first eligible. Next past the last → round + 1; prev before the first → previous round's last; at round 1's first → `conflict`. Initiative changes keep the turn on the same combatant. | #139 (P14) |
| FR-CBT-31 | `playerTurnCombatantId` on the encounter = the turn combatant if not hidden or removed, else null; written with the turn, by `setRemoved` and by the token hook. | I20 |
| FR-CBT-15 | `cbt.setRemoved {combatantId, removed}` (DM): removed combatants skip turns, are hidden from players; DM sees a "Removed" section with Restore. | |
| **Attacks and damage cards** | | |
| FR-CBT-16 | `cbt.attack {attackerId, mode?, manual?}` (no target, #135): attacker = active, non-removed combatant of the started encounter; player: own PC only (`forbidden`), visible to them (`not_found`). No attack → `conflict` "No weapon attack". Rolls to-hit (d20 + toHit, mode) then damage (`characterRolls(effectiveStats, "attack")`); natural 20 → damage dice count doubled ("critical"). | #139 (P13) |
| FR-CBT-17 | Manual attack: two entries, to-hit first (dice total, per-die optional); the client shows the doubled damage expression if the d20 is 20; the server validates against the expression it implies. | I3 |
| FR-CBT-18 | Same transaction: rolls; **player sender** → one public `roll` entry (category attack, both rolls, `encounterId`); DM sender → no entry until apply. `AttackRolled`, then `notify(env, …)` kind `damage-card`, action "Apply" (DM only, #136), payload §8, audience = the rolling player, or `dm`; text "‹attacker›: ‹to-hit› to hit, ‹damage› ‹type›". Result `{cardId, rollIds}`; the DM client opens the popup on its own attacks. | ADR-0027, I4 |
| FR-CBT-19 | **Attack popup** (DM Dialog; card `onAction`; open cards also listed in `cbt.initiative`): attacker, attack, **target Select** (active, non-removed combatants incl. hidden; empty until picked), to-hit dice + editable total, "vs AC N → Hit / Miss" (nat 20 hit, nat 1 miss, else total ≥ AC) with a Hit / Miss toggle, damage dice + editable total, multiplier Normal / Half / None / Double, preview "‹target› 7 → 4". **Apply** (needs a target), **Later** (card stays pending), **Dismiss** (`note.dismiss`). | #74, #134 |
| FR-CBT-20 | `cbt.applyCard {cardId, targetId, toHitTotal (−20…99), hit, damageTotal (0–999), multiplier, public?}` (DM): target active, non-removed (else `not_found`); encounter started. Rolled values come from the card's roll rows, never the client. `raw = hit ? floor(damageTotal × {1, ½, 0, 2}) : 0`. Applies HP (FR-CBT-22), appends a `cbt.attack` entry, writes the combat log entry, emits `AttackApplied`, then `resolveNotification(env, cardId, resolution §8)`; card not pending → `conflict`, all rolls back. | FR-NOTE-08 |
| FR-CBT-21 | `cbt.applyHp {combatantId, kind: damage \| heal, amount 1–999, public?}` (DM): direct change, `cbt.hp` entry (category damage / healing), combat log entry, `HpApplied`. | Traps, potions |
| FR-CBT-22 | HP: monster → `hpCurrent` clamped 0…hpMax. PC → `characters.adjustHp(env, characterId, ∓raw)` ([FR-CHAR-13](character-sheet.md#6-functional-requirements)); its change listed in our event. `applied = \|hpBefore − hpAfter\|`; damage `overkill = max(0, raw − hpBefore)`. | #139 (P11) |
| FR-CBT-23 | Stats capture: every apply writes one combat log entry (§8): rolled and final values, override flags (to-hit, hit, damage), target AC used; the event payload carries the same facts. | #54 |
| FR-CBT-24 | Log lines (kinds `cbt.attack`, `cbt.hp`, `encounterId` set): public text = actors, roll + modifier, outcome, damage ("Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage"); AC, computed hit, overrides in `dmPayload`. One category per entry. `public`: **false** if attacker or target is hidden; else true for a player-rolled card (#73); else the DM's `public` if sent, else the category setting. DM rolls for a PC follow the same rule. | #139 (P1, P6), I4 |
| FR-CBT-32 | **Design for later (gems, #140):** apply reads the card's current to-hit and damage rolls; a later gem intent may replace either (per-die results in the payload) before apply. No MVP intent or UI. | Tier A |
| **Undo** | | |
| FR-CBT-25 | `cbt.undo {expectedHpChangeId}` (DM): the latest non-undone combat log entry of the started encounter (by `seq`); none → `conflict` "Nothing to undo"; ≠ expected → `conflict`. Applies the inverse delta, clamped (monster or `characters.adjustHp`); marks the row undone, `gameLog.markUndone`; emits `CombatEntryUndone`, **then** `reopenNotification` if from a card. One step per click. | I2, I28, #139 (P4) |
| **Visibility and resilience** | | |
| FR-CBT-26 | Health band (players, monsters): `down` if hp = 0; `bloodied` if 2 × hp ≤ hpMax; else `healthy`. Computed in the visibility fn; HP numbers never sent. | #139 (P9) |
| FR-CBT-27 | Visibility per §9; DM always full. Visibility fns read only the record and the connection context; every command lists every record whose visibility changes. | ADR-0021 |
| FR-CBT-28 | No combat state in memory: after a hard kill + restart, snapshots equal pre-crash state. | Vision |
| FR-CBT-29 | Controls disabled unless `live`; one intent in flight per control; an in-flight intent lost to a drop → Toast "Connection lost — check the game log / HP before trying again". Reject → Toast with message. | as FR-CHAR-12 |
| FR-CBT-30 | Client registrations: windows `cbt.initiative`, `cbt.encounters`; `creatureActions` New / Derive / Edit; token menu "Damage / heal…", "Remove from combat" on tokens bound to an active combatant (DM); notification views `damage-card` (DM `onAction` = popup; player: pending "Waiting for DM", resolved "Hit ‹target›: N damage" ("Hit: N damage" if `targetName` is null) / "Miss"); dice kinds `cbt.attack`, `cbt.hp`; **sheet roll routing**: while the character is an active, non-removed combatant of the started encounter (store), its sheet Attack sends `cbt.attack` (no `public`; supplies the doubled-damage `critExpressions`) and Initiative `cbt.rollInitiative`, else the sheet's own `char.roll`. | #135 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense; `hp.full` / `hp.bloodied` / `hp.down`, `visibility.hidden` tokens.

| Kind | Clients | Default open | Geometry | Launcher |
|---|---|---|---|---|
| `cbt.initiative` | both (player `available` iff a started encounter is in the store) | yes | DM: right edge; player: top-left below the top bar, clear of the tool rail; 340×520, min 280×240 | "Initiative" |
| `cbt.encounters` | DM | no | centre-left, 460×560, min 360×320 | "Encounters" |

- **`cbt.encounters` (DM):** list (planned / started / ended Badges) + "New encounter". Editor: name, picker, entry rows (name, CR, − qty +, remove), party checkboxes (level), difficulty Card (rating Badge, base / adjusted XP, thresholds, total CR). **Start** (viewed scene; Dialog previews bindings) / **End** (confirm). Started / ended: read-only.
- **`cbt.initiative` (DM):** header: encounter, Round N, Prev / Next (round 0: "Start round 1"), **Undo** (Tooltip "Undo: Goblin → Mira, 6"), "Roll monsters". **Pending cards** (click → popup). Rows by `position`: turn marker, portrait, name, initiative (roll button / number input), AC, HP `cur/max`, band Badge, eye-off if hidden; row menu Attack, Damage / heal, Remove. Removed section with Restore.
- **`cbt.initiative` (player), read-only:** Round N; rows by `playerPosition`: turn marker (`playerTurnCombatantId`), portrait / initials, name, band Badge (monsters), initiative (PCs). Own PC without initiative: "Roll initiative on your sheet". Attacks start from the sheet (one Attack button).
- **Attack popup:** FR-CBT-19; changed numbers marked "edited".
- **States:** no encounter: DM "No encounter running — open Encounters"; player window unavailable. Loading: shell skeleton. Disconnected: last state + banner, controls disabled. Errors: Toast.
- **Test IDs** (records add `data-record-id`; option values use `data-value`): `cbt-enc-<list|row|new|name|picker|entry|entry-inc|entry-dec|entry-remove|party|xp-base|xp-adjusted|rating|total-cr|start|start-confirm|binding|end>` (`row` + `data-status`); `cbt-init-<round|next|prev|undo|roll-monsters|row|card|hint|empty>` (`row` + `data-turn`, `data-hidden`), `cbt-init-row-<init|roll|hp|band|attack|hp-adjust|remove|restore>`; `cbt-popup-<target|tohit|hit|damage|mult|preview|apply|later|dismiss>`; `cbt-hp-<amount|damage|heal>`; `cbt-form-<field|save|error>`. Roots: `cbt-init`, `cbt-enc-list`, `cbt-popup`, `cbt-form`.

## 8. Data model

All rows per campaign; `seq` by the DB ([CON-20](../data-model/README.md#8-conflicts-log)); timestamps `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Encounter | id, campaignId, seq, name | ID, ID, int, text 1–60 | |
| | status, sceneId, partyCharacterIds | `planned` \| `started` \| `ended`, ID → Scene \| null (set null), **JSON leaf** ID[] \| null | ≤ 1 `started` per campaign (partial unique); party null = all |
| | round, turnCombatantId, playerTurnCombatantId | int ≥ 0, ID \| null, ID \| null | **Combat** state; round 0 = initiative phase; player copy FR-CBT-31 |
| | startedAt, endedAt, createdAt, updatedAt | timestamp \| null ×2, timestamp ×2 | |
| Encounter entry | id, encounterId, seq, definitionId, quantity | ID, ID (cascade), int, ID → Entity, int 1–20 | Live link to the definition |
| Combatant | id, campaignId, encounterId, seq, kind | ID, ID, ID, int, `pc` \| `monster` | Instance ([ADR-0009](../architecture/adr/0009-entity-content-model.md)) |
| | entityId, tokenId | ID → Entity, ID → Token \| null (set null) | Character or definition |
| | name, imageAssetId, hidden, active, removed | text 1–40, **asset ref** \| null, bool ×3 | Display copies (FR-CBT-08/09); `active` false after End |
| | initiative, initRollId, position, playerPosition | int \| null, ID \| null, int, int \| null | Server-written (FR-CBT-13) |
| | hpCurrent, hpMax | int \| null ×2 | Monsters only (PC HP on the character, #92) |
| **Combat log entry** (`hp_change`) | id, campaignId, encounterId, seq, at, kind | ID, ID, ID, int, timestamp, `damage` \| `heal` | Undo + stats source (I9) |
| | source, cardId, rollIds | `card` \| `direct`, ID \| null, **JSON leaf** ID[] | |
| | attackerId, attackerName, attackName, damageType | ID \| null, text \| null ×3 | Copies at the time |
| | targetId, targetEntityId, targetName, targetAc | ID, ID, text, int | Effective values (ADR-0009) |
| | toHitRolled, toHitTotal, natural, hitComputed, hit | int \| null ×3, bool \| null ×2 | Override = rolled ≠ final |
| | damageRolled, damageTotal, multiplier | int \| null, int, `normal` \| `half` \| `none` \| `double` \| null | |
| | raw, applied, overkill, hpBefore, hpAfter, entryId, undone, undoneAt | int ×5, ID → game-log entry, bool, timestamp \| null | Undo marker on this row |
| Damage card | `notification` row, kind `damage-card` | [notifications §8](notifications.md#8-data-model) | |
| | payload (player-safe, ≤ 1 KB) | **JSON leaf** | `{encounterId, attackerId, attackerName, attackName, damageType, mode, crit, toHit {rollId, dice[], constant, total, natural, manual}, damage {rollId, dice[], constant, total, manual}}`; `dice[]` = per-die results as compact `[value, kept]` pairs (#140); test: payload ≤ 1 KB at 50 dice |
| | resolution | **JSON leaf** | `{targetName \| null (null if hidden), hit, multiplier, applied}` (hp_change links back via `cardId`); seen by the rolling player (#138) |

- **Relations:** Campaign 1—* Encounter 1—* Entry, Combatant; Entry, Combatant → Entity; Combatant → Token (0..1); combat log entry → Combatant, card, rolls, game-log entry. Game-log entries carry `encounterId`; rolls are linked from entries via `rollIds` (I24).
- **Derived:** difficulty and total CR (FR-CBT-03), band (FR-CBT-26), eligible turns, hit hint.
- **Persisted runtime state:** status, round, turns, initiative, positions, monster HP, flags, combat log, cards. Popup edits are client memory (lost on reload; card stays).

## 9. API & events

**REST (DM, `Authorization: Bearer`):** `POST /api/encounters` → `201 {encounter}`; `PUT /api/encounters/:id` (whole replace) → `200`; `DELETE /api/encounters/:id` → `204` *(prefix proposed, [OQ-CAMP-15](campaign-management.md#15-open-questions))*. Creature form uses entities' routes.

**WS intents** (strict zod; none optimistic)

| Intent | Who | Validation | Result |
|---|---|---|---|
| `cbt.start` / `cbt.end` | DM | FR-CBT-07, -10 | — |
| `cbt.rollInitiative {combatantIds, mode?, manual?, public?}` | DM, player | FR-CBT-11; invisible → `not_found` | `{rollIds}` |
| `cbt.setInitiative`, `cbt.nextTurn`, `cbt.prevTurn`, `cbt.setRemoved` | DM | FR-CBT-12, -14, -15 | — |
| `cbt.attack {attackerId, mode?, manual?}` | DM, player | FR-CBT-16, -17 | `{cardId, rollIds}` |
| `cbt.applyCard`, `cbt.applyHp`, `cbt.undo` | DM | FR-CBT-20, -21, -25 | `{hpChangeId}` |
| `note.dismiss {id}` (notifications) | DM | Dismisses a card (#136) | — |

**Record types** (scope `campaign`; DM full)

| Type | Player visibility | Snapshot ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)) |
|---|---|---|
| `encounter` | `started` → `{id, status, round, playerTurnCombatantId}`; else hidden | `window {orderBy: seq, size: 20, pin: status ≠ ended}` (I26) |
| `encounter-entry` | `audience: dm` | Entries of encounters in the `encounter` snapshot |
| `combatant` | `!active`, `removed` or `hidden` → hidden. PC → `{id, encounterId, kind, entityId, tokenId, name, imageAssetId, playerPosition, initiative}`. Monster → `{id, encounterId, kind, tokenId, name, imageAssetId, playerPosition, band}` | Combatants of the started encounter |
| `hp-change` (combat log entry) | `audience: dm` | Started encounter's rows, `window {orderBy: seq, size: 50}` (I22) |
| `notification` `damage-card` | Notifications' audience rule: rolling player + DM, or DM | `pin` pending, newest 100 closed |

**Domain events** (all logged; WS = generic record changes, `cause.name` = event)

| Event | Changes | Player sees | Undoable |
|---|---|---|---|
| `EncounterCreated` / `Updated` / `Deleted` | `encounter` (+ entries) | nothing | no |
| `EncounterStarted {encounterId, sceneId, combatantIds}` | `encounter`, `combatant` creates | encounter + visible combatants | no |
| `EncounterEnded {encounterId}` | `encounter`, every `combatant` | deletes | no |
| `InitiativeRolled` / `InitiativeSet` | `combatant`s (positions); `game-log-entry` | visible rows whose rank or value changed; entry if public | no |
| `TurnChanged {round, turnCombatantId, direction}`; `CombatantRemoved` / `Restored` | `encounter` / `combatant`s | upsert; removed = delete | no |
| `AttackRolled {cardId, rollIds}` (+ `NotificationCreated`) | `game-log-entry` (player roll); card | entry; own card | no |
| `AttackApplied {hpChangeId, …facts}` (+ `NotificationResolved`) | target `combatant` or `entity` (adjustHp); `hp-change`; `game-log-entry`; card | band; own PC full; entry per FR-CBT-24; own card resolution | **yes** |
| `HpApplied {hpChangeId, …facts}` | target; `hp-change`; `game-log-entry` | as above | **yes** |
| `CombatEntryUndone {hpChangeId}` (+ `NotificationReopened`) | target; `hp-change`; entry (`undone`); card | band / own HP; struck entry if visible; card pending | compensating |
| `EntityUpdated` / token events (hooks) | + `combatant`, `encounter` copies | per rule (reveal = upsert, hide = delete) | no |

- **Hooks:** definition-changed (FR-CBT-06), token-changed (FR-CBT-09). **Helpers used:** `dice.evaluate`, `gameLog.append` / `markUndone`, `notify` / `resolveNotification` / `reopenNotification`, `characters.adjustHp`, `characterRolls`, `effectiveStats`, `resolveDefinition`. **Listeners, signals:** none.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Encounter CRUD, start, end, creature form | ✓ | ✗ | DM credential / DM-only intents |
| Roll initiative | any combatant, overwrite | own PC, once | FR-CBT-11 |
| Set initiative, turns, remove, direct HP, undo | ✓ | ✗ | role |
| Attack | any active combatant | own visible PC (from the sheet) | FR-CBT-16 |
| Pick target, apply / dismiss card | ✓ | ✗ (sees own card and resolution) | role; FR-NOTE-08 (#136) |
| Own PC HP outside combat | via sheet | own, via sheet; not undoable, not a combat log entry | [FR-CHAR-09](character-sheet.md#6-functional-requirements) (#139, P5) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled; an attack in flight is never resent; if committed, the card and roll line are in the snapshot. Reconnect mid-turn → round, turn, order, bands.
- **DM disconnect:** players keep attacking; cards pile up pending; summary toast on return. An open popup's edits are lost; the card stays pending.
- **Server crash mid-action:** one transaction each: card ⇔ rolls; apply ⇔ HP ⇔ log line ⇔ card resolved; undo ⇔ inverse ⇔ marks ⇔ reopen. Restart → identical snapshots. **Concurrency:** two DM tabs apply one card → second `conflict`. Double Next / Undo → `expected*` guards. Sheet heal + combat damage → deltas in commit order; undo restores only its own delta.
- **Removed target** can't be picked or applied (`not_found`). **After End:** pending cards can only be dismissed; Undo → "Nothing to undo" (combat log entries stay for stats). **Hidden PC** (its token hidden): hidden from every player incl. the owner, so the sheet falls back to `char.roll` (no card); the DM rolls for it or reveals (OQ-CBT-28, #141).
- **Definition edited mid-fight:** FR-CBT-06; log keeps the values used. Active scene switched: combat continues. **Windowed log:** undoing an entry older than the newest 100 still delivers the struck entry live; a fresh snapshot omits it ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)).
- **Leaks accepted:** the rolling player's resolution shows `applied`, so a killing blow reveals the monster's last HP, and `multiplier` hints at resistances (#138); a band upsert with unchanged band hints "something hit it" (as the public log); a hidden combatant's turn shows no marker (timing hint).
- **Invalid input:** strict zod; a player can't attack as another PC, send `public` or a target, or re-roll set initiative; ids of another campaign → `not_found`; names rendered as text.

## 12. Performance & bandwidth

- Snapshot per type (I17): `combatant` ≤ 56 × 300 B ≈ 17 KB (players ≈ 12 KB redacted); `encounter` + entries ≤ 30 non-ended × ≈ 1.5 KB + 20 ended × 400 B ≈ 53 KB worst, DM-only (typ. < 10 KB); `hp-change` ≤ 50 × 400 B = 20 KB DM-only; cards in notifications' budget. Human-paced: per attack 2–3 events ≤ 3 KB × 7 connections; "Roll monsters" = one event, ≤ 50 rows ≈ 15 KB. Target: sheet Attack → card on the DM screen ≤ 1 s over the tunnel; apply → player band / sheet ≤ 1 s.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:`, port 0, seeded `ctx.dice`; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs.

**Fixtures** (`fixtures/units/combat-tracker/`; setups run as DM, FR-FIX-13; manual rolls where values must be exact)

| Key | Requires | Contents | `session-sim` |
|---|---|---|---|
| `goblin-2` | `battlemap` | Token "Goblin 2" (`enemy-1`, `token-goblin`) on Goblin Ambush (12, 8), visible | yes |
| `encounter-1` | `enemy-1`, `enemy-2`, `enemy-custom` | Planned "Ambush at the Ford": Goblin × 2, Wolf, Elite Goblin Warrior; party `null` (FIX §8 row amended at merge, I11) | yes |
| `thorn-battlemap` | `battlemap`, `char-thorn` | Thorn token (owner `player-2`) on Goblin Ambush (2, 9) | no |
| `combat-1` | `encounter-1`, `goblin-2`, `thorn-battlemap` | Start on Goblin Ambush; initiative Wolf 18, Mira 15, Goblin 12, Goblin 2 12, Thorn 10, Elite 8; next → round 1, Wolf | no |
| `combat-hit` | `combat-1` | Goblin attacks, manual 15 / 4 → card; apply target Mira, hit, normal → Mira 6/12 | no |
| `combat-pending` | `combat-hit` | Elite attacks, manual 19 / 5, left pending | no |

- **Bundle `combat`** = `session-sim` + `player-2` + `char-thorn` + `thorn-battlemap`. **Bundle `mid-combat`** = `combat` + `combat-1` + `combat-hit` + `combat-pending` (answers OQ-FIX-04).
- **Leak strings** (player frames): "Elite Goblin Warrior", "Goblin Boss", "Ambush at the Ford", Wolf / Elite combatant ids while hidden, `"position"`, `"turnCombatantId"`, monster `hpCurrent` / `hpMax` / `initiative` on `combatant`, `dmPayload`, `encounter-entry`, `hp-change`.

| Level | What | Fixtures |
|---|---|---|
| Unit | `dmg-2014` (DMG examples, ladder ends ×0.5 / ×5, CR 0, no party), total CR; order + ties; `playerPosition` with hidden / removed; turn eligibility, wrap, round 1; binding (seq order, FR-MAP-16 numbering); band; `raw` per multiplier (half rounds down); overkill; crit doubling; hit rule; visibility matrix (encounter / combatant × DM / owner / other player × hidden / removed / ended); log `public` rule | In-code |
| Integration | Each command: rows + log + events, rollback → none. Start: bindings, hidden copy, second start `conflict`. Hooks: hide / reveal → combatant delete / upsert, ranks and `playerTurnCombatantId` in the same event; token delete `conflict` while started, set null after; portrait + hpMax edit follow. Attack: player as Thorn `forbidden`; player with a target field `invalid`; player initiative re-roll `conflict`; card audience; player roll line public. Apply: monster + PC paths, rolled values from rows, double apply `conflict`, ended `conflict`; resolution `targetName` null for a hidden target. Undo LIFO, `expected` guard, inverse after a sheet heal, event order, card reopened. **Crash-resume:** `mid-combat`, `restartServer()` → identical snapshots; next turn + apply pending card work. Leak scan; convergence per player | `combat`, `mid-combat` |
| E2E (thin) | DM + `player-1`: start, roll all, Mira attacks from the sheet, DM targets Goblin, applies half, band shown to player; undo; restart | `combat` |

**Browser walkthrough** — needs dice-roll-log, notifications, character-sheet built. `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load combat --profile verify`; `start --profile verify` in the test agent's Herdr pane. Contexts **A** DM (`pw-dm`), **B** `player-1`, **C** `player-2`; B, C frame logs via `page.on('websocket')`. Evidence + teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, "Show to players"; Encounters → "Ambush at the Ford" | B, C open links | Goblin ×2, Wolf, Elite; party Mira, Thorn; 250 XP base, 625 adjusted, **Deadly**, total CR 1.25. B, C: no Initiative launcher; no leak string |
| 2 | Picker "wo" → Wolf ×2, then −1. Creatures → Derive Goblin → "Goblin Boss", AC 17, HP 21, CR 1, Save | — | Rating updates live; Goblin Boss listed as Custom; not in B, C frames |
| 3 | Start → preview (all bound) → confirm | — | A: 6 rows, Wolf + Elite eye-off. B, C ≤ 1 s: Thorn, Mira, Goblin, Goblin 2 ranked 1…4 |
| 4 | Roll monsters; Start round 1 | B: sheet Shift+Initiative; C: sheet manual 12 | B, C never see Wolf / Elite rolls; B adv line; order sorted; A: first marked; B, C: no marker if it is Wolf / Elite |
| 5 | — | B: sheet Attack | B: public roll line; Notifications window: card "Waiting for DM" (no toast, FR-NOTE-13). A: sticky card toast; card in Pending |
| 6 | Open card: target Goblin; "vs AC 15" shown (set Hit); Double; Apply | — | Outcome line (A, B, C); Goblin bloodied / down for B, C (no HP in frames); B's card in Notifications "Hit Goblin: N damage" |
| 7 | Elite row → Ctrl+Attack; target Mira; Hit; damage 9; Apply | — | B's sheet HP −9 ≤ 1 s; outcome line absent for B, C (hidden attacker) |
| 8 | Undo; Undo | — | Mira HP back, Elite card pending; Goblin band back; both entries struck for A; B sees Goblin's line struck, own card pending again |
| 9 | Reveal Wolf; try to delete Goblin 2's token; Remove Goblin 2 | — | Wolf appears, ranks shift, for B, C ≤ 1 s; delete → Toast "Token is in a running encounter"; Goblin 2 gone for B, C |
| 10 | Next while C is dropped | C back | C: banner, then current turn without reload |
| 11 | Hard-kill + restart | — | All rejoin; round, turn, HP, pending cards, log intact |
| 12 | End; Undo | — | B, C Initiative unavailable; Ended in list; "Nothing to undo". No leak string, no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0016, 0021, 0022, 0024, 0027, 0028, 0029; #53–55, #74, #76–78, #84–85, #92, #134–140 | Instances, events + undo, sync, seams, cards in-tx, token hooks, windows | accepted |
| [entities](entities.md) | `resolveDefinition`, `effectiveStats`, XP table, routes, definition hook + `creatureActions` registries | complete |
| [scenes-map](scenes-map.md) | Tokens; token-changed hook registry (ADR-0028, in `build/scenes-map`); token menu registry (FR-MAP-29) | complete; amended per ADR-0028 (FR-MAP-30, FR-MAP-29) |
| [character-sheet](character-sheet.md) | `characters.adjustHp(env, …)`, `characterRolls`; client roll-action routing registry (FR-CBT-30) | in revision |
| [dice-roll-log](dice-roll-log.md) | `ctx.dice`, `dice.evaluate` (per-die results), `gameLog.append` / `markUndone`, kind registry, `encounterId`, `dmPayload`, N-expression manual popover | in revision |
| [notifications](notifications.md) | `notify` / `resolveNotification` / `reopenNotification`, `note.dismiss`, kind + view registries, resolution visible to the audience (#138); post-MVP payload update for gems | in revision |
| [live-sync](live-sync.md), [play-shell](play-shell.md), [fixtures-adapters](fixtures-adapters.md) | Registries incl. `window`, windows, bundles | complete |

**Shared-file changes** ([AGENTS §9.9](../../AGENTS.md#99-shared-files), gate §4); `shared change needed:` each line, orchestrator picks the route:
- `src/server/db/` — tables `encounter` (partial unique one `started` per campaign), `encounter_entry`, `combatant`, `hp_change`. `src/shared/events/` — `EncounterCreated` / `Updated` / `Deleted` / `Started` / `Ended`, `InitiativeRolled` / `Set`, `TurnChanged`, `CombatantRemoved` / `Restored`, `AttackRolled`, `AttackApplied`, `HpApplied`, `CombatEntryUndone`.
- Record-type registry (append) — `encounter`, `encounter-entry`, `combatant`, `hp-change`; needs ADR-0029 `window` in `src/server/ws/` first (gate item 4). `src/server/app.ts` (append) — mount `/api/encounters`.
- Registries (append lines): `combatTracker` in `src/server/features/index.ts`; `src/shared/dice-roll-log/kinds.ts` (`cbt.attack`, `cbt.hp`); server notification kind registry + `src/client/{dm,player}/notification-views.ts` (`damage-card`); scenes-map token-changed hooks; scenes-map token menu; character-sheet client roll-action routing; `src/client/{dm,player}/windows.ts`; entities' definition hooks; `creatureActions`; `fixtures/bundles/index.ts` (`combat`, `mid-combat`). All on the AGENTS §9.9 list; paths in [protocol §26](../protocol/README.md#26-combat-registries-and-seams).
- Docs (integrator): protocol rows, data-model rows (+ undo note, I9), glossary (I13), ADR-0016 "MVP use" (I30), ADR-0014 / feature-tiers hit-miss line (I29), FIX §8 rows (I11).

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-CBT-02, 04, 05, 09, 10, 14, 21, 22, 23, 24, 25~~ | ~~DM product picks~~ | **Decided (#139):** bold picks P4, P5, P9–P17 (band; DM applies combat damage, sheet HP not undoable; individual rolls; cards persist after End; applied + overkill; selectable party; crits; skip rules; one started; undo reopens the card, no Redo; auto-bind) | — | — |
| ~~OQ-CBT-07, 17~~ | ~~Card target; token hooks~~ | **Decided (#134):** the DM picks the target in the popup, no scenes-map click change; [ADR-0028](../architecture/adr/0028-token-changed-hooks.md) | — | — |
| ~~OQ-CBT-12, 18, 19~~ | ~~CR maths; sheet buttons in combat; card creation~~ | **Decided (#136):** derived label, method registry, MVP 2014 DMG + total CR. **(#135):** sheet routes to `cbt.*` in combat; `notify` in `cbt.attack`'s tx ([ADR-0027](../architecture/adr/0027-notification-creation.md)) | — | — |
| ~~OQ-CBT-03, 06, 11, 15, 16, 20, 26, 27~~ | ~~HP source; auto tokens; roll modes; picker; form; undo marker; glossary; registries~~ | **Decided:** character (ADR-0009); no (#77); everyone (I8); one list, Shieldmaiden form (#84–85); own table (I9); I13; §14 (gate §4) | — | — |
| ~~OQ-CBT-28~~ | ~~A PC whose token is hidden is hidden from its owner too, so its sheet rolls via `char.roll` (no card) and the roll line is public to every player (#73), naming the hidden PC~~ | **Decided (#141):** accepted; the DM rolls for it or reveals it | — | character-sheet |

Answers to other specs' questions: recorded in the [gate](../agents/gate-phase3-combat.md) (§1–3) and decisions #134–140.

## 16. Out of scope

- See §4. Full monster editor, compendium import → [compendium](post-mvp/compendium.md); gems → [gems](post-mvp/gems.md).
