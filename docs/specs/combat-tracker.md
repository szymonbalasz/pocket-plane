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

- Replaces Shieldmaiden for one table: **build an encounter** with 2014 DMG difficulty, **start** it on a prepped battlemap, run initiative, turns and **attacks confirmed by the DM** in an attack popup, track HP, **undo** mistakes ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #53, #55, #74).
- Every attack is a **damage card** ([notifications](notifications.md) kind `damage-card`): a player's attack lands as a pending card; the DM's own attack opens the same card as a popup. Apply = HP change + game-log line + card resolved, in one transaction.
- Server-side only: commands, in-transaction hooks and helpers. **No listener writes state.** All combat state is in the DB, so a crash mid-turn loses nothing.

## 2. Scope

MVP = tier S ([feature tiers §2, §5, §7](../feature-tiers.md#2-combat)).

- **Encounter builder:** name, creatures × quantity from **one picker** over every monster definition (SRD, custom, fixture alike, #84; type-to-filter, near-free), party (default: all characters), live XP + difficulty. Lifecycle planned → started → ended (#78).
- **Custom creature form** (Shieldmaiden-style, #85): New / Derive / Edit over the shared creature core, from the Creatures window ([FR-ENT-20](entities.md#6-functional-requirements)).
- **Start** binds combatants to tokens the DM already placed (some hidden, #77); hidden tokens → hidden combatants (#76). **End.**
- Initiative: roll (one click for all monsters, individual rolls) or enter; sorted, deterministic ties. Next / previous turn; rounds.
- **Attack** (DM or player): to-hit + damage rolled server-side (Shift adv / Ctrl dis, manual entry) → card → **attack popup** (hit vs target AC computed, override any value, normal / half / none / double) → apply.
- Direct damage / heal (DM). Remove / restore a combatant. **Undo** (DM, strict LIFO, damage/heal only, [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).
- Player initiative view; **monster health band** (healthy / bloodied / down).
- **Stats capture** (#54): every HP change stores source, target, attack, rolls, overrides, applied, overkill, HP before/after.

## 3. Goals

- One full fight vs mixed enemies runs from the play page: no one reads numbers aloud, the DM confirms every hit ([roadmap](../roadmap.md) Combat exit).
- Players never learn a hidden combatant, a monster's HP number, AC or stats, or a planned encounter.
- Hard kill mid-turn → restart → round, turn, initiative, HP, pending cards and game log intact ([vision](../vision.md#success-criteria)).
- A wrong damage is fixed in two clicks (Undo, re-apply the reopened card).

## 4. Non-goals

- Conditions, concentration, durations, temp HP, death saves, add combatants mid-fight, hidden token-less combatants, legendary / lair / reactions → [combat-extras](post-mvp/combat-extras.md) (tier A–C).
- Drag-to-reorder initiative, current-turn token highlight, stat block on token click, end-of-combat summary (tier B). Rules automation beyond the hit hint: the DM applies everything.
- Redo (re-apply the reopened card instead). Undo of initiative, turns, removals (#70). Multi-target, custom actions, spells (tier A).
- Party HP for players (tier B, OQ-ENT-15 answer). Stats UI → [stats](post-mvp/stats.md).

## 5. User stories

**DM**
- As the DM, I want to pick goblins, a wolf and my Elite Goblin Warrior from one list and see "Deadly", so that I tune the fight before the session.
- As the DM, I want Start to pick up the tokens I placed (hidden ones stay hidden), so that I don't rebuild the fight.
- As the DM, I want each attack in a popup with hit/miss vs AC and fudgeable numbers, so that I stay in control.
- As the DM, I want to undo the last damage and re-apply it as "half", so that mistakes cost seconds.

**Player**
- As a player, I want to click my target, then Attack (Shift for advantage), so that the DM gets my numbers without me reading them out.
- As a player, I want to see the turn order and whether a monster is bloodied, so that I can plan.

## 6. Functional requirements

All commands: rows + event-log entry + domain event in one transaction; IDs, time from `ctx`, dice from `ctx.dice` ([AGENTS §9.3](../../AGENTS.md#93-fixtures), [FR-DICE-03](dice-roll-log.md#6-functional-requirements)). Failure → no change, event or log entry.

| ID | Requirement | Notes |
|---|---|---|
| **Prep** | | |
| FR-CBT-01 | Encounter create / update (REST, DM): `{name, partyCharacterIds \| null, entries [{definitionId, quantity}]}`. Name trimmed 1–60, no control chars (not unique). 0–20 entries, quantity 1–20, total ≤ 50. Definitions via `resolveDefinition`, kind `monster` (else `invalid`); duplicate definition rows merged. Update and delete only while `planned`, else `conflict`. | ADR-0021 D |
| FR-CBT-02 | Party: `null` = every character of the campaign at read time; a list must hold characters of `ctx.campaignId` (else `invalid`). | OQ-CBT-14 |
| FR-CBT-03 | `encounterDifficulty(partyLevels, monsterCrs)` (pure, `@shared/combat-tracker`), 2014 DMG: XP per CR (entities' table, CR 0 = 10); party thresholds = sum of per-level easy / medium / hard / deadly; multiplier by monster count 1 ×1, 2 ×1.5, 3–6 ×2, 7–10 ×2.5, 11–14 ×3, 15+ ×4, one step up for < 3 PCs, one step down for ≥ 6. Rating = highest threshold ≤ adjusted XP, else "trivial"; no party → "—". Editor shows base XP, adjusted XP, rating, thresholds; updates as you edit. | OQ-CBT-12, OQ-ENT-11 |
| FR-CBT-04 | Creature picker: one Combobox listing every monster the campaign can use (`entity` monsters + `imported-entity`), FR-ENT-18 order, type-to-filter; row = name, CR, XP; never branches on source. Picking adds quantity 1, or +1 if present. | #84, OQ-CBT-15 |
| FR-CBT-05 | Creature form (Dialog), registered as `creatureActions`: **New** (blank), **Derive** (any monster; prefilled; name = base name, or "‹name› (copy)" for a custom), **Edit** (customs only). Fields = creature core: name, size, AC, HP max, init bonus, CR (+ XP shown), portrait (asset picker), optional attack (name, to-hit, damage, damage type). Validates with entities' zod; saves via `POST` / `PUT /api/entities`; server errors inline. | OQ-CBT-16, FR-ENT-09/11 |
| FR-CBT-06 | Definition-changed hook ([FR-ENT-19](entities.md#6-functional-requirements)): every active monster combatant of the definition gets the new `hpMax`; `hpCurrent` = new max if it equalled the old max, else clamped to the new max. Token-less combatants also take a new portrait. Rows returned for `EntityUpdated.changes`. | OQ-ENT-10 |
| **Start / end** | | |
| FR-CBT-07 | `cbt.start {encounterId, sceneId}`: encounter `planned`; no other `started` encounter in the campaign (`conflict`); scene in campaign. Creates combatants in one transaction, `round 0`, `turn null`, status `started`, then `EncounterStarted`. | OQ-CBT-23 |
| FR-CBT-08 | Binding: party characters by name, then entries in order × quantity. Each takes the next unbound token on the scene with that `definitionId` (by token `seq`); copies token `name`, `imageAssetId`, `hidden`. None left → token-less: name = definition / character name (monsters numbered "Goblin 3" if needed), image = portrait, visible. Monsters: `hpMax = hpCurrent = effectiveStats.hpMax`. Start dialog previews bindings ("no token" marked). | OQ-CBT-25, #77 |
| FR-CBT-09 | Token-changed hook (scenes-map, [proposed ADR](../architecture/adr/0028-token-changed-hooks.md)): rename / image / hide / reveal of a bound token updates the combatant's copy **in the same transaction** (hidden token → hidden combatant). Deleting a token (or its scene) bound to an active combatant → `conflict` "Token is in a running encounter"; otherwise the combatant's `tokenId` is set null. | OQ-MAP-03, -11 |
| FR-CBT-10 | `cbt.end {encounterId}`: `started` → `ended`, `endedAt`; every combatant `active = false` (players get deletes). Open cards stay pending; applying one later → `conflict` "Encounter has ended"; DM dismisses. | OQ-CBT-09 |
| **Initiative and turns** | | |
| FR-CBT-11 | `cbt.rollInitiative {combatantIds (1–50), mode?, manual?[]}`: one roll per combatant, d20 + init bonus (`characterRolls(effectiveStats, "initiative")`), via `dice.evaluate` + one `roll` log entry each (category initiative, `encounterId`; hidden combatant → `public: false`). "Roll monsters" sends every monster without initiative (OQ-CBT-05: individual rolls). Overwrites earlier values. | FR-CHAR-05 |
| FR-CBT-12 | `cbt.setInitiative {combatantId, value}` (DM): int −10…50, no roll. | Manual "enter" |
| FR-CBT-13 | Order: initiative desc, then init bonus desc, then PC before monster, then combatant `seq`; no initiative last. The server writes `position` (1…n) for every combatant whose place changed, in the same transaction. | Ties, ADR-0022 tiebreak |
| FR-CBT-14 | `cbt.nextTurn` / `cbt.prevTurn {encounterId, expectedRound, expectedTurnId}`; mismatch → `conflict` (no double advance). Round 0: next needs every non-removed combatant to have initiative (`conflict` "N without initiative"), then round 1, first eligible. Eligible = not removed and not a monster at 0 HP. Next past the last → round + 1, first eligible; prev before the first → previous round's last; at round 1's first → `conflict`. Initiative changes keep the turn on the same combatant. | OQ-CBT-22 |
| FR-CBT-15 | `cbt.setRemoved {combatantId, removed}` (DM): removed combatants skip turns and are hidden from players; DM sees them under "Removed" with Restore. | |
| **Attacks and damage cards** | | |
| FR-CBT-16 | `cbt.attack {attackerId, targetId?, mode?, manual?}`: attacker = active, non-removed combatant of the started encounter (player: own PC); else `forbidden` / `conflict`. No attack → `conflict` "No weapon attack". Target (optional): active, non-removed, not hidden for a player sender, else `not_found`. Rolls to-hit (d20 + toHit, mode) and damage (`characterRolls(effectiveStats, "attack")`); natural 20 → damage dice count doubled ("critical"). | OQ-CBT-21 |
| FR-CBT-17 | Manual attack: two entries, to-hit first; the client shows the doubled damage expression if the entered d20 is 20; the server validates damage against the expression it implies. | FR-DICE-06 |
| FR-CBT-18 | Same transaction: rolls; **player sender** → one public `roll` entry (category attack, both rolls, `encounterId`) at roll time; `AttackRolled`; then `notify` kind `damage-card`: payload §8, action "Apply" for the DM; audience = rolling player, or `dm` for a DM attack; text "‹attacker› → ‹target or ?›: ‹to-hit› to hit, ‹damage› ‹type›". Result `{cardId, rollIds}`; DM client opens the popup on it. | OQ-DICE-16, OQ-NOTE-06, -11 |
| FR-CBT-19 | **Attack popup** (DM, Dialog; card `onAction`; open cards also listed in `cbt.initiative`): attacker, attack, target Select (default the card's target), to-hit dice + editable total, "vs AC N → Hit / Miss" computed (`natural 20` hit, `natural 1` miss, else total ≥ AC) with a Hit/Miss toggle, damage dice + editable total, multiplier Normal / Half / None / Double, preview "‹target› 7 → 4". **Apply**, **Later** (close, card stays pending), **Dismiss** (`note.dismiss`). | #74 |
| FR-CBT-20 | `cbt.applyCard {cardId, targetId, toHitTotal (−20…99), hit, damageTotal (0–999), multiplier}` (DM): target as FR-CBT-16; encounter still started. `raw = hit ? floor(damageTotal × {1, ½, 0, 2}) : 0`. Applies HP (FR-CBT-22), appends a `cbt.attack` entry, writes the HP-change row, emits `AttackApplied`, then `resolveNotification(card, {hpChangeId, hit, applied})`; card not pending → `conflict`, whole command rolls back. | FR-NOTE-08 |
| FR-CBT-21 | `cbt.applyHp {combatantId, kind: damage \| heal, amount 1–999}` (DM): direct change, `cbt.hp` entry (category damage / healing), HP-change row, `HpApplied`. | Traps, potions in combat |
| FR-CBT-22 | HP: monster → combatant `hpCurrent` clamped 0…hpMax. PC → `characters.adjustHp(ctx, tx, characterId, ∓raw)` ([FR-CHAR-13](character-sheet.md#6-functional-requirements)), its record change listed in our event. `applied = |hpBefore − hpAfter|`; damage `overkill = max(0, raw − hpBefore)`. | OQ-CBT-03, OQ-CBT-10 |
| FR-CBT-23 | Stats capture: every apply writes one HP-change row (§8) with all facts (rolled and final values, override flags `toHit`, `hit`, `damage`, target AC used); the domain event payload carries the same facts. | #54 |
| FR-CBT-24 | Log lines (dice kinds `cbt.attack`, `cbt.hp`, `encounterId` set): public text = actors, roll + modifier, outcome, damage ("Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage"); target AC, computed hit, overrides in `dmPayload`. `public` (passed to `gameLog.append`, DM is the roller): **false** if attacker or target is hidden; else true for a player-rolled card (#73); else the category setting (attack / damage / healing). One category per entry. | OQ-DICE-13, -17 |
| **Undo** | | |
| FR-CBT-25 | `cbt.undo {expectedHpChangeId}` (DM): the latest non-undone HP-change of the started encounter (by `seq`); none → `conflict` "Nothing to undo"; ≠ expected → `conflict`. Applies the inverse delta, clamped (monster: combatant; PC: `characters.adjustHp`); marks the row undone, `gameLog.markUndone(entry)`, `reopenNotification(card)` if from a card; `CombatEntryUndone`. Strict LIFO, one step per click. | OQ-CHAR-08, OQ-NOTE-07 |
| **Visibility and resilience** | | |
| FR-CBT-26 | Health band (players, monsters): `down` if hp = 0; `bloodied` if 2 × hp ≤ hpMax; else `healthy`. Computed in the visibility fn; HP numbers never sent. | OQ-CBT-02 |
| FR-CBT-27 | Visibility per §9; DM always full. Every command lists every record whose visibility changes. | ADR-0021 |
| FR-CBT-28 | No combat state in memory: after a hard kill + restart, snapshots equal pre-crash state (encounter, round, turn, combatants, HP, cards, log). | Vision |
| FR-CBT-29 | Controls disabled unless `live`; one intent in flight per control (double click = one intent); in-flight intent lost to a drop → Toast "Connection lost — check the log before retrying". Reject → Toast with message. | as FR-CHAR-12 |
| FR-CBT-30 | Client registrations: windows `cbt.initiative`, `cbt.encounters`; `creatureActions` New / Derive / Edit; token menu "Damage / heal…" and "Remove from combat" on tokens bound to an active combatant (DM); notification view `damage-card` (DM `onAction` = popup); dice kinds `cbt.attack`, `cbt.hp`. No canvas layer in MVP. | CON-33 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense; `hp.full` / `hp.bloodied` / `hp.down`, `visibility.hidden` tokens.

| Kind | Clients | Default open | Geometry | Launcher |
|---|---|---|---|---|
| `cbt.initiative` | both (player `available` iff a started encounter is in the store) | yes | right edge, 340×520, min 280×240 | "Initiative" |
| `cbt.encounters` | DM | no | centre-left, 460×560, min 360×320 | "Encounters" |

- **`cbt.encounters` (DM):** list (planned / started / ended Badges) + "New encounter". Editor: name, creature picker, entry rows (name, CR, − qty +, remove), party checkboxes (level), difficulty Card (base / adjusted XP, rating Badge, thresholds). **Start** (on the viewed scene; Dialog previews bindings) / **End** (confirm). Started / ended: read-only.
- **`cbt.initiative` (DM):** header: encounter, Round N, Prev / Next (round 0: "Start round 1"), **Undo** (Tooltip "Undo: Goblin → Mira, 6"), "Roll monsters". **Pending cards** section (open cards, click → popup). Rows by position: turn marker, portrait, name, initiative (roll button / number input), AC, HP `cur/max` (PCs from the character), band Badge, eye-off if hidden; row menu Attack (target = selected token's combatant), Damage / heal, Remove. Removed section with Restore.
- **`cbt.initiative` (player):** Round N; rows: turn marker, portrait / initials, name, band Badge (monsters), initiative (PCs). Own PC row: **Roll initiative** (until set), **Attack** with "Target: ‹name›" (selected token) or "No target — DM picks". Own open cards: "Waiting for DM" line. Hidden combatant's turn → no marker.
- **Attack popup:** FR-CBT-19. Numbers editable inline; changed values marked "edited".
- **States:** no encounter: DM "No encounter running — open Encounters"; player window unavailable. Loading: shell skeleton. Disconnected: last state + banner, controls disabled (FR-CBT-29). Errors: Toast.
- **Test IDs** (records add `data-record-id`): `cbt-enc-<list|row|new|name|picker|entry|entry-inc|entry-dec|entry-remove|party|xp-base|xp-adjusted|rating|start|start-confirm|binding|end>` (`row` + `data-status`); `cbt-init-<round|next|prev|undo|roll-monsters|row|card|target|empty>` (`row` + `data-turn`, `data-hidden`), `cbt-init-row-<init|roll|hp|band|attack|hp-adjust|remove|restore>`; `cbt-popup-<target|tohit|hit|damage|mult|preview|apply|later|dismiss>` (`mult` record id = multiplier); `cbt-hp-<amount|damage|heal>`; `cbt-form-<field|save|error>`. Window roots: `cbt-init`, `cbt-enc-list`, `cbt-popup`, `cbt-form`.

## 8. Data model

All rows per campaign; `seq` by the DB ([CON-20](../data-model/README.md#8-conflicts-log)); timestamps `ctx.clock`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Encounter | id, campaignId, seq, name | ID, ID, int, text 1–60 | |
| | status, sceneId | `planned` \| `started` \| `ended`, ID → Scene \| null (set null) | ≤ 1 `started` per campaign (partial unique). Scene set at start |
| | partyCharacterIds | **JSON leaf** ID[] \| null | null = all characters |
| | round, turnCombatantId | int ≥ 0, ID \| null | **Combat** state; round 0 = initiative phase |
| | startedAt, endedAt, createdAt, updatedAt | timestamp \| null ×2, timestamp ×2 | |
| Encounter entry | id, encounterId, seq, definitionId, quantity | ID, ID (cascade), int, ID → Entity, int 1–20 | Live link: definition edits flow through |
| Combatant | id, campaignId, encounterId, seq, kind | ID, ID, ID, int, `pc` \| `monster` | Instance ([ADR-0009](../architecture/adr/0009-entity-content-model.md)) |
| | entityId, tokenId | ID → Entity, ID → Token \| null (set null) | Character or definition; token per FR-CBT-08/09 |
| | name, imageAssetId, hidden | text 1–40, **asset ref** \| null, bool | Display copies from token (or definition / character) |
| | active, removed | bool, bool | `active` false after End |
| | initiative, initRollId, position | int \| null, ID \| null, int | `position` server-written (FR-CBT-13) |
| | hpCurrent, hpMax | int \| null ×2 | Monsters only (PC HP on the character, #92); `hpMax` = display copy |
| HP change *(server table, no record type)* | id, campaignId, encounterId, seq, at | ID, ID, ID, int, timestamp | Combat log entry; undo + stats source |
| | source, cardId, attackerId, attackerName, attackName, damageType, rollIds | `card` \| `direct`, ID \| null, …, ID[] (**JSON leaf**) | Names copied |
| | targetId, targetEntityId, targetName, targetAc | ID, ID, text, int | Effective values at the time (ADR-0009) |
| | toHitRolled, toHitTotal, natural, hitComputed, hit; damageRolled, damageTotal, multiplier, kind | int \| null ×3, bool ×2; int \| null, int, enum, `damage` \| `heal` | Overrides = rolled ≠ final |
| | raw, applied, overkill, hpBefore, hpAfter, entryId | int ×5, ID | |
| | undone, undoneAt | bool, timestamp \| null | Undo marker (OQ-CBT-20) |
| Damage card | `notification` row, kind `damage-card` | [notifications §8](notifications.md#8-data-model) | |
| | payload (player-safe, ≤ 2 KB) | **JSON leaf** | `{encounterId, attackerId, attackerName, attackName, damageType, mode, crit, toHit {rollId, dice, constant, total, natural, manual}, damage {rollId, dice, constant, total, manual}, targetId?, targetName?}` |
| | resolution | **JSON leaf** | `{hpChangeId, hit, applied}` |

- **Relations:** Campaign 1—* Encounter 1—* Entry, Combatant; Entry, Combatant → Entity; Combatant → Token (0..1); HP change → Combatant, card, rolls, log entry. Game-log entries carry `encounterId` (dice).
- **Derived:** difficulty (FR-CBT-03), order display, band (FR-CBT-26), eligible turns, hit hint (DM client from definitions).
- **Persisted runtime state:** status, round, turn, initiative, positions, monster HP, flags, HP changes, cards. Popup edits are client memory (lost on reload; card stays).

## 9. API & events

**REST (DM, `Authorization: Bearer`; prefix per OQ-CAMP-15):** `POST /api/encounters` → `201 {encounter}`; `PUT /api/encounters/:id` (whole replace) → `200`; `DELETE /api/encounters/:id` → `204`. Planned only (`conflict`). Creature form uses entities' routes.

**WS intents** (DM only unless stated; none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `cbt.start {encounterId, sceneId}` / `cbt.end {encounterId}` | DM | FR-CBT-07, -10 | — |
| `cbt.rollInitiative {combatantIds, mode?, manual?}` | DM, player | Player: exactly one id, own PC (`entity.ownerPlayerId = ctx.playerId`), else `forbidden`; invisible → `not_found` | `{rollIds}` |
| `cbt.setInitiative`, `cbt.nextTurn`, `cbt.prevTurn`, `cbt.setRemoved` | DM | FR-CBT-12–15 | — |
| `cbt.attack {attackerId, targetId?, mode?, manual?}` | DM, player | FR-CBT-16; player attacker = own PC | `{cardId, rollIds}` |
| `cbt.applyCard`, `cbt.applyHp`, `cbt.undo` | DM | FR-CBT-20, -21, -25 | `{hpChangeId}` |
| `note.dismiss {id}` (notifications) | DM | Dismisses a card | — |

**Record types** (scope `campaign`; DM full)

| Type | Player visibility | Snapshot |
|---|---|---|
| `encounter` | `started` → redacted `{id, status, round, turnCombatantId}`; else hidden | All of the campaign's |
| `encounter-entry` | `audience: dm` | Entries of non-ended encounters |
| `combatant` | `!active` or `removed` or `hidden` → hidden. PC → `{id, encounterId, kind, entityId, name, imageAssetId, position, initiative}`. Monster → `{id, encounterId, kind, name, imageAssetId, position, band}` (no HP, initiative, entity or token id) | Active combatants (DM may keep ended ones until the next snapshot; players converge) |
| `notification` `damage-card` | Notifications' audience rule (FR-NOTE-06): rolling player + DM, or DM only | Notifications' provider |

**Domain events** (all logged; WS = generic record changes, `cause.name` = event)

| Event | Changes | Player sees | Undoable |
|---|---|---|---|
| `EncounterCreated` / `Updated` / `Deleted` | `encounter` (+ entries) | nothing (planned hidden) | no |
| `EncounterStarted {encounterId, sceneId, combatantIds}` | `encounter`, `combatant` creates | encounter + visible combatants | no |
| `EncounterEnded {encounterId}` | `encounter`, every `combatant` | deletes | no |
| `InitiativeRolled` / `InitiativeSet` | `combatant`s (positions); `game-log-entry` | visible rows; entry if public | no |
| `TurnChanged {round, turnCombatantId, direction}`; `CombatantRemoved` / `Restored` | `encounter` / `combatant` | upsert; remove = delete | no |
| `AttackRolled {cardId, rollIds}` (+ `NotificationCreated`) | `game-log-entry` (player roll); card | entry (public); own card | no |
| `AttackApplied {hpChangeId, …facts}` (+ `NotificationResolved`) | target `combatant` or `entity` (via adjustHp); `game-log-entry`; card | band change; own PC full; entry per FR-CBT-24 | **yes** |
| `HpApplied {hpChangeId, …facts}` | target; `game-log-entry` | as above | **yes** |
| `CombatEntryUndone {hpChangeId}` (+ `NotificationReopened`) | target; entry (`undone`); card | band / own HP; struck entry if visible | compensating |
| `EntityUpdated` / token events (hooks) | + `combatant` copies | per rule (reveal = upsert, hide = delete) | no |

- **Hooks:** definition-changed (entities, FR-CBT-06); token-changed (scenes-map, FR-CBT-09; proposed). **Helpers used:** `dice.evaluate`, `gameLog.append` / `markUndone`, `notify` / `resolveNotification` / `reopenNotification`, `characters.adjustHp`, `characterRolls`, `effectiveStats`, `resolveDefinition`. **Listeners, signals:** none.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Encounter CRUD, start, end, creature form | ✓ | ✗ | DM credential / default-DM intents |
| Roll initiative | any combatant | own PC | FR-CBT-11, ownership |
| Set initiative, turns, remove, direct HP, undo | ✓ | ✗ | roles |
| Attack | any active combatant | own PC; target visible | FR-CBT-16 |
| Apply / dismiss card | ✓ | ✗ (sees own card's state) | roles; FR-NOTE-08 |
| Adjust own PC HP outside combat log | via sheet | own, via sheet (not undoable) | [FR-CHAR-09](character-sheet.md#6-functional-requirements) (OQ-CBT-04) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled; an attack in flight is never resent; if committed, the card and roll line are in the snapshot ("Waiting for DM"). Reconnect mid-turn → snapshot shows round, turn, order, bands.
- **DM disconnect / reconnect:** players keep rolling and attacking; cards pile up pending; summary toast on return (FR-NOTE-15). An open popup's unsaved edits are lost; the card is still pending.
- **Server crash mid-action:** each command is one transaction: card ⇔ rolls; apply ⇔ HP ⇔ log line ⇔ card resolved; undo ⇔ inverse ⇔ marks ⇔ reopen. Restart → identical snapshots (FR-CBT-28); next turn continues from the stored turn.
- **Concurrent edits:** two DM tabs apply one card → second `conflict` (FR-NOTE-08), nothing applied twice. Double Next → `expectedTurnId` guard. Double Undo → `expectedHpChangeId` guard. Sheet heal + combat damage at once → deltas in commit order; undo restores only its own delta (OQ-CHAR-08). Initiative edited mid-round → turn stays on the same combatant.
- **Combatant removed / defeated mid-round:** its turn is skipped from the next advance; it can't be attacked or targeted (`not_found` / `conflict`); its pending cards fail on apply → DM retargets or dismisses.
- **Token deleted / hidden / renamed mid-fight:** FR-CBT-09. Scene deleted: same restrict. Active scene switched: combat continues (combatants are campaign records).
- **Definition edited mid-fight:** FR-CBT-06; log keeps values used at the time. Character `hpMax` lowered: entities clamps.
- **Leaks accepted:** a hidden combatant's turn shows as "no marker" for players (timing hint); a band upsert with unchanged band shows "something hit it" (same as the public log).
- **Invalid / malicious input:** strict zod; player can't attack as another PC, target a hidden combatant, set initiative, or send `public`; ids from another campaign → `not_found`; names rendered as text.

## 12. Performance & bandwidth

- ≤ 50 monsters + ≤ 6 PCs per encounter; combatant ≈ 300 B → ≤ 17 KB in a snapshot; encounters ≈ 400 B × ≤ 50 ≈ 20 KB DM-only. Within live-sync's 512 KB beside scenes ≤ 300 KB, dice ≤ 100 KB, notifications.
- Human-paced: per attack 2–3 events ≤ 3 KB each × 7 connections. "Roll monsters" = one event with ≤ 50 rows ≈ 15 KB.
- Target: click → card on DM screen ≤ 1 s over the tunnel; apply → player band / sheet ≤ 1 s.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:`, port 0, seeded `ctx.dice`; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs.

**Fixtures** (`fixtures/units/combat-tracker/`; setups run as DM, FR-FIX-13; manual rolls where values must be exact)

| Key | Requires | Contents | `session-sim` |
|---|---|---|---|
| `goblin-2` | `battlemap` | Token "Goblin 2" (`enemy-1`, `token-goblin`) on Goblin Ambush (12, 8), visible | yes |
| `encounter-1` | `enemy-1`, `enemy-2`, `enemy-custom` | Planned "Goblin Ambush": Goblin × 2, Wolf × 1, Elite Goblin Warrior × 1; party `null` (all) | yes |
| `thorn-battlemap` | `battlemap`, `char-thorn` | Thorn token (owner `player-2`) on Goblin Ambush (2, 9) | no |
| `combat-1` | `encounter-1`, `goblin-2`, `thorn-battlemap` | Start on Goblin Ambush; set initiative Wolf 18, Mira 15, Goblin 12, Goblin 2 12, Thorn 10, Elite 8; next turn → round 1, Wolf | no |
| `combat-hit` | `combat-1` | Goblin attacks Mira, manual 15 / 4 → card; apply hit, normal → Mira 6/12 | no |
| `combat-pending` | `combat-hit` | Elite attacks Mira, manual 19 / 5, left pending | no |

- **Bundle `combat`** = `session-sim` + `player-2` + `char-thorn` + `thorn-battlemap` (planned encounter, mixed enemies, two players).
- **Bundle `mid-combat`** = `combat` + `combat-1` + `combat-hit` + `combat-pending` (answers [OQ-FIX-04](fixtures-adapters.md#15-open-questions)).
- **Leak strings** (player frames): "Elite Goblin Warrior", "Goblin Boss", "Goblin Ambush" (encounter name), Wolf / Elite combatant ids while hidden, monster `hpCurrent` / `hpMax` / `initiative` on `combatant`, `dmPayload`, `encounter-entry`.

| Level | What | Fixtures |
|---|---|---|
| Unit | `encounterDifficulty` (DMG examples, < 3 / ≥ 6 PCs, CR 0, no party); order + ties; turn eligibility, wrap, round 1 start; binding (seq order, token-less numbering); band thresholds; `raw` per multiplier (half rounds down); overkill; crit doubling; hit rule (nat 1 / 20); visibility matrix (encounter / combatant × DM / owner / other player × hidden / removed / ended); log `public` rule | In-code |
| Integration | Each command: rows + log + events, rollback → none. Start: bindings, hidden copy, conflict on second start. Hooks: hide/reveal token → combatant delete/upsert in the same event; token delete → `conflict` while started, set null after; definition hpMax edit → clamp/follow. Attack: player `forbidden` for Thorn as `player-1`; hidden target `not_found`; card audience; player roll line public. Apply: monster + PC paths (`characters.adjustHp` in our tx), double apply `conflict`, ended → `conflict`. Undo LIFO, `expected` guard, inverse after a sheet heal, card reopened, entry undone. **Crash-resume:** `mid-combat`, `restartServer()` → identical snapshots; next turn + apply pending card work. Leak scan; convergence per player | `combat`, `mid-combat` |
| E2E (thin) | DM + `player-1`: start, roll all, player attacks selected Goblin, DM applies half, band visible to player; undo; restart | `combat` |

**Browser walkthrough** — needs dice-roll-log, notifications, character-sheet built. `PP_TEST_MODE=1` (drop connection); `bun run build`; `fixtures:reset-load combat --profile verify`; `start --profile verify` in the test agent's Herdr pane. Contexts **A** DM (`pw-dm`), **B** `player-1`, **C** `player-2`; B, C frame logs via `page.on('websocket')`. Evidence + teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, "Show to players"; open Encounters, select "Goblin Ambush" | B, C open links | Entries Goblin ×2, Wolf, Elite; party Mira, Thorn; 250 XP base, 625 adjusted, **Deadly**. B, C: no Initiative launcher; no leak string |
| 2 | Picker: type "wo", add Wolf (×2); then −1. Creatures → Derive Goblin → "Goblin Boss", AC 17, HP 21, CR 1, Save | — | Rating updates live; Goblin Boss listed as Custom; not in B, C frames |
| 3 | Start → preview (all bound) → confirm | — | A: 6 rows, Wolf + Elite eye-off. B, C ≤ 1 s: Initiative opens with Mira, Thorn, Goblin, Goblin 2 only |
| 4 | Roll monsters | B: Shift+Roll initiative; C: manual 12 | A: 4 monster rolls; B, C never see Wolf / Elite rolls; B adv line; order sorted; A: Start round 1 → round 1, first in order marked |
| 5 | — | B: click Goblin token, Attack | B: public roll line, "Waiting for DM". A: sticky card toast; card in Pending |
| 6 | Open card: target Goblin, "vs AC 15" hit/miss shown (toggle to Hit if Miss); choose Double; Apply | — | Log outcome line (A, B, C); Goblin bloodied or down for B, C (no HP number in frames); card "Resolved" in B's history |
| 7 | Elite row → Ctrl+Attack Mira; set Hit if Miss; edit damage to 9; Apply | — | B's sheet HP −9 ≤ 1 s; outcome line hidden for B, C (hidden attacker) |
| 8 | Undo; then Undo | — | Mira HP back, Elite card pending again; then Goblin band back; both entries struck for A; B sees Goblin's struck line |
| 9 | Reveal Wolf token; then try to delete Goblin 2 token; Remove Goblin 2 from combat | — | Wolf appears for B, C ≤ 1 s; delete → Toast "Token is in a running encounter"; Goblin 2 disappears for B, C |
| 10 | Next while C is dropped | C back | C: banner, then current turn without reload |
| 11 | Hard-kill + restart | — | All rejoin; round, turn, HP, pending Elite card, log intact |
| 12 | End encounter; Undo | — | B, C Initiative unavailable; list shows Ended; Undo → "Nothing to undo". No leak string, no console errors throughout |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0016, 0021, 0022, 0024; #53–55, #74, #76–78, #84–85, #92 | Instances, events + undo, sync, seams, display copies | accepted |
| [entities](entities.md) | `resolveDefinition`, `effectiveStats`, XP table, routes, hook + `creatureActions` registries | complete |
| [scenes-map](scenes-map.md) | Tokens, **token-changed hooks** (proposed ADR), selected token id for players (OQ-CBT-07), token menu registry | complete; changes via OQ-CBT-17, -07 |
| [character-sheet](character-sheet.md) | `characters.adjustHp`, `characterRolls`; sheet buttons route in combat (OQ-CBT-18) | in-review |
| [dice-roll-log](dice-roll-log.md) | `ctx.dice`, `dice.evaluate`, `gameLog.append` / `markUndone`, kind registry, `encounterId`, `dmPayload` | in-review |
| [notifications](notifications.md) | `notify` / `resolveNotification` / `reopenNotification`, `note.dismiss`, view registry ([proposed ADR](../architecture/adr/0027-notification-creation.md)) | in-review |
| [live-sync](live-sync.md), [play-shell](play-shell.md), [fixtures-adapters](fixtures-adapters.md) | Registries, windows, bundles (`encounter-1` row per FIX §8; add the rest at merge) | complete |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CBT-02, 05, 10, 11, 14, 21, 22, 23, 25 | DM product picks | **02: healthy > 50 %, bloodied ≤ 50 %, down = 0. 05: individual monster rolls, one click. 10: record applied (capped) and overkill. 11: players get Shift / Ctrl / manual too. 14: party selectable, `null` = all. 21: nat 20 = hit + doubled damage dice, nat 1 = miss. 22: skip removed and monsters at 0 HP; PCs at 0 keep turns. 23: ≤ 1 started encounter per campaign. 25: auto-bind by definition in token `seq` order; unmatched → token-less, visible** / custom bands; one roll per kind; capped only; DM-only modifiers; all characters; no crit rule (DM fudges); skip removed only; several fights; DM binds by hand | no · owner: DM | stats, dice-roll-log, scenes-map |
| ~~OQ-CBT-03, 06~~ | ~~PC HP source; auto-create tokens~~ | **Decided:** the character (ADR-0009); no (#77) | — | — |
| OQ-CBT-04 | Who applies damage? | **DM applies all combat damage (undoable); player adjusts own PC only via the sheet (not a combat entry)** / DM only (no potions without DM) | no · owner: DM | character-sheet |
| OQ-CBT-07 | Damage-card target (also OQ-MAP-21) | **Player clicks a token (scenes-map exposes the selected token id; players may click-select any visible token); DM confirms or changes in the popup** / DM picks only (no scenes-map change) | **yes** | scenes-map |
| OQ-CBT-09 | Unapplied cards across turns / after End | **Persist until applied or dismissed; after End apply → `conflict`, DM dismisses** / auto-dismiss at End (needs a notifications helper) | no · owner: DM | notifications |
| OQ-CBT-12 | CR math | **2014 DMG (FR-CBT-03)** (matches Shieldmaiden) / CR sum (simpler, less accurate) | **yes** | entities |
| ~~OQ-CBT-15, -16~~ | ~~Picker contents; custom form~~ | **Decided:** one list, any source; Shieldmaiden-style form + duplicate. MVP fields = creature core (FR-CBT-05); search via Combobox filter (near-free) | — | — |
| OQ-CBT-17 | Token-changed hooks in scenes-map's token commands (hide/reveal, rename, image, delete, scene delete); AGENTS §9.9 registry | **Yes, mirror FR-ENT-19 ([proposed ADR](../architecture/adr/0028-token-changed-hooks.md))** / DM hides combatants separately (double work, leak risk) | **yes** | scenes-map, AGENTS |
| OQ-CBT-18 | Sheet buttons in combat (answers OQ-CHAR-07, -10) | **While the character is an active combatant, the sheet's Attack sends `cbt.attack` (target = selected token) and Initiative sends `cbt.rollInitiative`; otherwise `char.roll`** / sheet stays plain; combat only from `cbt.initiative` (two Attack buttons that differ) | no · owner: character-sheet | character-sheet |
| OQ-CBT-19 | How cards are created | **In `cbt.attack`'s transaction via `notify`** (crash-safe; [proposed ADR](../architecture/adr/0027-notification-creation.md) A) / listener on roll events (OQ-CHAR-07's pick; crash gap) | no · owner: integrator | notifications, character-sheet |
| OQ-CBT-20 | Undo marker | **Combat-owned HP-change table (`undone`); compensating event in the log** / event-log columns (shared change to live-sync's table) | no · owner: integrator | live-sync, data-model |
| OQ-CBT-24 | Undo of an applied card | **Reopens the card for a corrected apply** (answers OQ-NOTE-07) / stays resolved | no · owner: DM | notifications |
| OQ-CBT-26 | Glossary: add **Attack popup** (DM dialog confirming an attack), **Health band** (healthy / bloodied / down); Damage card: "notification kind `damage-card`" | **Add** / leave implicit | no · owner: integrator | glossary |
| OQ-CBT-27 | AGENTS §9.9 / CON-33: add the scenes-map token menu registry (second registrant) and notification view files to the append-only list | **Add** (canvas layer registry stays until it gets a registrant) / shared file via orchestrator | no · owner: orchestrator | AGENTS, protocol |

**Answers to other specs' questions** (picks; not decided)

| Asked by | Answer |
|---|---|
| OQ-MAP-03 | Token-delete rule: **`conflict` while bound to an active combatant; after End, set null** (FR-CBT-09) |
| OQ-MAP-11 | **Yes:** hide/reveal sets the combatant's `hidden` copy in the same transaction (FR-CBT-09) |
| OQ-MAP-21 | **scenes-map exposes the selected token id (both clients); combat-tracker reads it** (OQ-CBT-07) |
| OQ-ENT-10 | **Hook clamps HP and refreshes `hpMax`** (FR-CBT-06); untouched full HP follows the new max |
| OQ-ENT-11 | **CR 0 = 10 XP** (DMG table) |
| OQ-ENT-15 | **None in MVP:** players see other PCs' name + portrait in initiative, no HP (tier B party view) / band via entities' redacted character (small FR-ENT-15 change) |
| OQ-CHAR-04 | Decided already; initiative shows other PCs as name + portrait only |
| OQ-CHAR-07 | PC HP **only via `characters.adjustHp` in our transaction** ✓; cards **not** from a listener: from `cbt.attack` (OQ-CBT-18, -19); target from the selected token, no `targetTokenId` on `char.roll` |
| OQ-CHAR-08 | **Inverse delta, clamped** (FR-CBT-25) |
| OQ-CHAR-10 | Sheet Initiative **routes to `cbt.rollInitiative` in combat** (OQ-CBT-18), plain roll otherwise |
| OQ-DICE-13 | **Accepted:** roll + modifier + outcome public; AC and overrides in `dmPayload` |
| OQ-DICE-16 | **Accepted:** player roll line at roll time, outcome line at apply; DM attacks log only at apply |
| OQ-DICE-17 | **One category per entry** (attack outcome = attack; direct = damage / healing); hidden attacker or target → `public: false` |
| OQ-NOTE-06 | **Accepted:** combat-tracker owns `damage-card` (payload §8, popup `onAction`, `cbt.applyCard` calls `resolveNotification`) |
| OQ-NOTE-07 | **Undo reopens** (OQ-CBT-24) |
| OQ-NOTE-11 | **Audience = rolling player** (sees Pending → Resolved, no toast); DM attacks: `dm` |
| OQ-FIX-04 | **`mid-combat` bundle**, §13 |
| OQ-SHELL-06 | Confirm `cbt.initiative` (both, default open) and `cbt.encounters` (DM) |

## 16. Out of scope

- See §4. Conditions, concentration, durations, rule reminders → [combat-extras](post-mvp/combat-extras.md). Stats UI, kill feed → [stats](post-mvp/stats.md). Full monster editor, compendium import → [compendium](post-mvp/compendium.md). Current-turn token highlight (canvas layer slot reserved) → tier B.
