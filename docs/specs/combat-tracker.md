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
- Every attack is a **damage card** (notification kind `damage-card`), created in the attack command's transaction ([ADR-0027](../architecture/adr/0027-notification-creation.md)). The card has no target; **the DM picks the targets** (one or more; the map selection preselects them, #148) and applies (#134, #135). Apply = HP changes + game-log lines + card resolved, in one transaction. Server-side only: commands, in-transaction hooks and helpers. **No listener writes state.** All combat state is in the DB, so a crash mid-turn loses nothing.

## 2. Scope

MVP = tier S ([feature tiers §2, §5, §7](../feature-tiers.md#2-combat)).

- **Encounter builder:** name, creatures × quantity from **one picker** over every monster definition (any source, #84; type-to-filter), party (default all characters), live XP, rating and total CR. Lifecycle planned → started → ended (#78).
- **Custom creature form** (Shieldmaiden-style, #85): New / Derive / Edit, from the Creatures window ([FR-ENT-20](entities.md#6-functional-requirements)). **Start** binds combatants to tokens the DM placed (some hidden, #77; hidden tokens → hidden combatants, #76). **End.**
- Initiative: roll (one click for all monsters, individual rolls) or enter; deterministic ties. Next / previous turn; rounds.
- **Attack** (DM from the initiative list; player from the sheet while in combat, #135): to-hit + damage rolled server-side (Shift adv / Ctrl dis, manual entry) → card → **attack popup** (DM picks ~~target~~ targets: map selection preselected, Ctrl/Shift and box select on the map; per target hit vs AC and normal / half / none / double; override any value) → apply.
- **Feedback pass** (#145, #148; FR-CBT-33–43): multi-target apply with per-target section, one undo step per apply; token indicators Out (removed) and Down (0 HP); movement used this turn; player **turn alert** (flash + ping via play-shell).
- Direct damage / heal (DM). Remove / restore a combatant. **Undo** (DM, strict LIFO, damage/heal only, [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).
- Player initiative view with **monster health band** (healthy / bloodied / down). **Stats capture** (#54): every HP change stores source, target, attack, rolls, overrides, applied, overkill, HP before/after.

## 3. Goals

- One full fight vs mixed enemies runs from the play page: no one reads numbers aloud, the DM confirms every hit ([roadmap](../roadmap.md) Combat exit).
- Players never learn a hidden combatant (name, ID, rank, turn; except a hidden PC's own sheet rolls, OQ-CBT-28), a monster's AC, stats or HP number (only the band, and the damage their own hit applied, #138), or a planned encounter.
- Hard kill mid-turn → restart → round, turn, initiative, HP, pending cards and game log intact ([vision](../vision.md#success-criteria)).
- A wrong damage is fixed in two clicks (Undo, re-apply the reopened card), also for a multi-target card.
- A player notices their turn without watching the screen; everyone sees who is down or out on the map.

## 4. Non-goals

- Conditions, concentration, durations, temp HP, death saves, add combatants mid-fight, token-less hidden combatants, legendary / lair / reactions → [combat-extras](post-mvp/combat-extras.md).
- Drag-to-reorder initiative, current-turn token highlight, end-of-combat summary (tier B); player target selection, stat block on token click (later, unranked; #134). Rules automation beyond the hit hint.
- Redo (re-apply the reopened card). Undo of initiative, turns, removals (#70). Undo after End. ~~Multi-target~~ (in, #148), custom actions, spells (tier A). Party HP for players (tier B). Stats UI → [stats](post-mvp/stats.md). Gems → [gems](post-mvp/gems.md) (design-for-later only, FR-CBT-32).
- Multi-target direct damage / heal (`cbt.applyHp` stays one combatant); blocking or correcting movement (indicators only; the next turn resets); DM-added alert sounds (tier A, [ADR-0030](../architecture/adr/0030-ui-notification-sounds.md)); player targeting (#134, #148).

## 5. User stories

- **DM:** As the DM, I want to pick goblins, a wolf and my Elite Goblin Warrior from one list and see "Deadly", and have Start pick up the tokens I placed (hidden stay hidden), so that prep is done before the session.
- **DM:** As the DM, I want each attack in a popup where I pick the target, see hit/miss vs AC and fudge numbers, and undo a wrong apply, so that I stay in control and mistakes cost seconds.
- **Player:** As a player, I want to press Attack on my sheet (Shift for advantage), see the damage my hit did, the turn order and whether a monster is bloodied, so that nobody reads numbers aloud and I can plan.
- **DM:** As the DM, I want to box-select the three goblins in the blast, apply 20 to all with one at half, and undo it in one click, so that area damage is as quick as a single hit.
- **Player:** As a player, I want a flash and a ping when my turn starts and my drag to turn amber when I dash, so that I don't stall the table or overrun my speed.

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
| FR-CBT-15 | `cbt.setRemoved {combatantId, removed}` (DM): removed combatants skip turns, ~~are hidden from players~~ reach players redacted as removed (FR-CBT-37) and leave the player initiative list; DM sees a "Removed" section with Restore. | Amended #148 |
| **Attacks and damage cards** | | |
| FR-CBT-16 | `cbt.attack {attackerId, mode?, manual?}` (no target, #135): attacker = active, non-removed combatant of the started encounter; player: own PC only (`forbidden`), visible to them (`not_found`). No attack → `conflict` "No weapon attack". Rolls to-hit (d20 + toHit, mode) then damage (`characterRolls(effectiveStats, "attack")`); natural 20 → damage dice count doubled ("critical"). | #139 (P13) |
| FR-CBT-17 | Manual attack: two entries, to-hit first (dice total, per-die optional); the client shows the doubled damage expression if the d20 is 20; the server validates against the expression it implies. | I3 |
| FR-CBT-18 | Same transaction: rolls; **player sender** → one public `roll` entry (category attack, both rolls, `encounterId`); DM sender → no entry until apply. `AttackRolled`, then `notify(env, …)` kind `damage-card`, action "Apply" (DM only, #136), payload §8, audience = the rolling player, or `dm`; text "‹attacker›: ‹to-hit› to hit, ‹damage› ‹type›". Result `{cardId, rollIds}`; the DM client opens the popup on its own attacks. | ADR-0027, I4 |
| FR-CBT-19 | ***Superseded by FR-CBT-33** (multi-target, #148).* **Attack popup** (DM Dialog; card `onAction`; open cards also listed in `cbt.initiative`): attacker, attack, ~~**target Select** (active, non-removed combatants incl. hidden; empty until picked)~~, to-hit dice + editable total, "vs AC N → Hit / Miss" (nat 20 hit, nat 1 miss, else total ≥ AC) with a Hit / Miss toggle, damage dice + editable total, multiplier Normal / Half / None / Double, preview "‹target› 7 → 4". **Apply** (needs a target), **Later** (card stays pending), **Dismiss** (`note.dismiss`). | #74, #134 |
| FR-CBT-20 | ***Superseded by FR-CBT-34** (`targets[]`, #148).* `cbt.applyCard {cardId, targetId, toHitTotal (−20…99), hit, damageTotal (0–999), multiplier, public?}` (DM): target active, non-removed (else `not_found`); encounter started. Rolled values come from the card's roll rows, never the client. `raw = hit ? floor(damageTotal × {1, ½, 0, 2}) : 0`. Applies HP (FR-CBT-22), appends a `cbt.attack` entry, writes the combat log entry, emits `AttackApplied`, then `resolveNotification(env, cardId, resolution §8)`; card not pending → `conflict`, all rolls back. | FR-NOTE-08 |
| FR-CBT-21 | `cbt.applyHp {combatantId, kind: damage \| heal, amount 1–999, public?}` (DM): direct change, `cbt.hp` entry (category damage / healing), combat log entry, `HpApplied`. | Traps, potions |
| FR-CBT-22 | HP: monster → `hpCurrent` clamped 0…hpMax. PC → `characters.adjustHp(env, characterId, ∓raw)` ([FR-CHAR-13](character-sheet.md#6-functional-requirements)); its change listed in our event. `applied = \|hpBefore − hpAfter\|`; damage `overkill = max(0, raw − hpBefore)`. | #139 (P11) |
| FR-CBT-23 | Stats capture: every apply writes one combat log entry (§8): rolled and final values, override flags (to-hit, hit, damage), target AC used; the event payload carries the same facts. | #54 |
| FR-CBT-24 | Log lines (kinds `cbt.attack`, `cbt.hp`, `encounterId` set; one `cbt.attack` line per target, FR-CBT-36): public text = actors, roll + modifier, outcome, damage ("Goblin attacks Mira: 12 + 4 = 16 — hit! 6 slashing damage"); AC, computed hit, overrides in `dmPayload`. One category per entry. `public`: **false** if attacker or target is hidden; else true for a player-rolled card (#73); else the DM's `public` if sent, else the category setting. DM rolls for a PC follow the same rule. | #139 (P1, P6), I4 |
| FR-CBT-32 | **Design for later (gems, #140):** apply reads the card's current to-hit and damage rolls; a later gem intent may replace either (per-die results in the payload) before apply. No MVP intent or UI. | Tier A |
| **Undo** | | |
| FR-CBT-25 | `cbt.undo {expectedHpChangeId}` (DM): the latest non-undone combat log entry of the started encounter (by `seq`); none → `conflict` "Nothing to undo"; ≠ expected → `conflict`. Applies the inverse delta, clamped (monster or `characters.adjustHp`); marks the row undone, `gameLog.markUndone`; emits `CombatEntryUndone`, **then** `reopenNotification` if from a card. One step per click; a step covers a whole card apply (FR-CBT-35). | I2, I28, #139 (P4) |
| **Visibility and resilience** | | |
| FR-CBT-26 | Health band (players, monsters): `down` if hp = 0; `bloodied` if 2 × hp ≤ hpMax; else `healthy`. Computed in the visibility fn; HP numbers never sent. | #139 (P9) |
| FR-CBT-27 | Visibility per §9; DM always full. Visibility fns read only the record and the connection context; every command lists every record whose visibility changes. | ADR-0021 |
| FR-CBT-28 | No combat state in memory: after a hard kill + restart, snapshots equal pre-crash state. | Vision |
| FR-CBT-29 | Controls disabled unless `live`; one intent in flight per control; an in-flight intent lost to a drop → Toast "Connection lost — check the game log / HP before trying again". Reject → Toast with message. | as FR-CHAR-12 |
| FR-CBT-30 | Client registrations (feedback additions: FR-CBT-42): windows `cbt.initiative`, `cbt.encounters`; `creatureActions` New / Derive / Edit; token menu "Damage / heal…", "Remove from combat" on tokens bound to an active combatant (DM); notification views `damage-card` (DM `onAction` = popup; player: pending "Waiting for DM", resolved "Hit ‹target›: N damage" ("Hit: N damage" if `targetName` is null) / "Miss"); dice kinds `cbt.attack`, `cbt.hp`; **sheet roll routing**: while the character is an active, non-removed combatant of the started encounter (store), its sheet Attack sends `cbt.attack` (no `public`; supplies the doubled-damage `critExpressions`) and Initiative `cbt.rollInitiative`, else the sheet's own `char.roll`. | #135 |
| **Feedback pass** (#145, #148) | | |
| FR-CBT-33 | **Multi-target popup** (supersedes FR-CBT-19): DM, **non-modal** (no overlay; the canvas stays usable). Shared: attacker, attack, to-hit dice + editable total, damage dice + editable total. **Targets** on open (card, toast, Pending list, own attack): combatants of the started encounter, active, non-removed, bound to a token in the map selection ([FR-MAP-33](scenes-map.md#6-functional-requirements)), attacker excluded. While open: `setTargeting(true)`; click, Ctrl/Shift-click and box on the map edit the selection and the list follows (other selected tokens ignored, note "N selected not in combat"). "Add target" Combobox: every eligible combatant incl. hidden and token-less; adding one whose token is on the viewed scene selects it; removing a row deselects it. **Per-target row:** name (eye-off if hidden), AC, "vs AC N → Hit / Miss" toggle (preset nat 20 hit, nat 1 miss, else total ≥ AC; follows to-hit edits until toggled), multiplier Normal / Half / None / Double, preview "Goblin 7 → 1". **Apply** (≥ 1 target), **Later**, **Dismiss**. Close → targeting off; selection kept. | F7, #134 DM only |
| FR-CBT-34 | `cbt.applyCard {cardId, toHitTotal (−20…99), damageTotal (0–999), targets [{targetId, hit, multiplier}] (1–20, unique ids, else `invalid`), public?}` (DM; supersedes FR-CBT-20). Each target active, non-removed (`not_found`); encounter started, card pending (`conflict`); rolled values from the card's roll rows. Per target, in list order: `raw = hit ? floor(damageTotal × {1, ½, 0, 2}) : 0`, HP (FR-CBT-22), one combat log entry, one log line (FR-CBT-36), one `AttackApplied` (payload unchanged, per row). Then one `resolveNotification` with resolution `{targets […]}` (§8). All or nothing. | F7 |
| FR-CBT-35 | **Undo unit = one apply** *(proposed, OQ-CBT-29)*: the latest non-undone combat log entry **plus every non-undone entry of the same card** (a card has at most one live apply: applying resolves it, undo reopens it). `expectedHpChangeId` = the latest entry. Each row: inverse delta, undone, `markUndone`, its own `CombatEntryUndone {hpChangeId}` (latest first); then one `reopenNotification`. Direct HP = one row. Undo Tooltip "Undo: Goblin → Goblin, Goblin 2 (2 targets)". | F7 |
| FR-CBT-36 | **Outcome line per target:** one `cbt.attack` entry per target, same `rollIds` and text as FR-CBT-24; `public` per entry: false if the attacker or **that** target is hidden, else FR-CBT-24's rule. Undo strikes each. | F7; OQ-CBT-33 (dice-roll-log) |
| FR-CBT-37 | **Removed, for players** (amends FR-CBT-15, §9): an active, removed, non-hidden combatant reaches players redacted `{id, encounterId, kind, tokenId, name, imageAssetId, removed: true, movedFt}` (no rank, band or initiative). Remove and restore are upserts; the player list omits removed rows. Hidden or ended → hidden as before *(proposed, OQ-CBT-31)*. | F6 |
| FR-CBT-38 | **Token indicators** (both clients; `tokenOverlays` line, [FR-MAP-34](scenes-map.md#6-functional-requirements)) for a token bound to an active combatant of the started encounter: **Out** (`removed`): dim + badge "Out" (`cbt-token-out`); **Down**: monster `hpCurrent = 0` (players: band `down`), PC: its character's `hpCurrent = 0`, seen by the DM and the owner only *(proposed, OQ-CBT-32)* → badge "Down" in `hp.down` (`cbt-token-down`); **Target**: while targeting, a selected token bound to an eligible combatant → `ring: "target"`. Players see a badge only on tokens and combatants they receive. Nothing after End. | F6, F7, F8 |
| FR-CBT-39 | **Movement used:** combatant `movedFt` (int ≥ 0, 0 at Start). Combat's token-changed hook on a move ([FR-MAP-38](scenes-map.md#6-functional-requirements), [ADR-0031](../architecture/adr/0031-token-move-hooks.md)) of a token bound to an active, non-removed combatant adds the move's 5/10/5 distance (FR-MAP-22), cap 9,999, whoever moved it *(proposed, OQ-CBT-34)*; it never rejects. Overlay `movedFt(token)` returns it (FR-MAP-37). DM row: "Moved 40 / 30 ft" in the tone of FR-MAP-37 ("Moved 40 ft" without speed). | F3 |
| FR-CBT-40 | **Reset on turn start:** `cbt.nextTurn` / `cbt.prevTurn` set the new turn combatant's `movedFt` to 0 in their transaction (listed in `TurnChanged`'s changes), round 1's first included. So movement counts from the token's position at turn start. | F3 |
| FR-CBT-41 | **Turn alert** (player client): an `event` with `cause.name = TurnChanged` whose `encounter` upsert has `playerTurnCombatantId` = a PC combatant whose `entityId` is a character with `ownerPlayerId = you.playerId` → `alert({id: "cbt.turn", title: "Your turn", detail: ‹PC name›, sound: "ping"})` ([FR-SHELL-22](play-shell.md#6-functional-requirements)). Never from a snapshot, resync or other cause (reveal, restore); none for a hidden PC (owner gets null, #141); none on the DM client. No new event: whose turn it is is already public *(proposed, OQ-CBT-30)*. | F1, [ADR-0030](../architecture/adr/0030-ui-notification-sounds.md) |
| FR-CBT-42 | Client registrations (adds to FR-CBT-30): `tokenOverlays` line `cbt` (FR-CBT-38, FR-CBT-39); the popup uses the selection API; player `damage-card` resolved view, one part per target: "Hit Goblin: 6 · Goblin 2: 3 (half)", "Hit: N" for a null name, "Miss"; the turn alert handler (FR-CBT-41). | |
| FR-CBT-43 | Creature form (amends FR-CBT-05) adds **Speed** (number, optional, step 5) and **Token shape** (Default / Round / Square / None) ([FR-ENT-21/22](entities.md#6-functional-requirements)); since #149 also the six **ability scores** (all or none) and **save proficiencies** (checkboxes) ([FR-ENT-23](entities.md#6-functional-requirements)). | F3, F4, #149 |
| **Checks and saves** (#149) | | |
| FR-CBT-44 | `cbt.rollAbility {combatantId, kind: check \| save, ability, mode?, manual?, public?}` (DM): active combatant of the started encounter (removed ones too). Stats via `effectiveStats` of its entity (monster definition or character); bonus per [FR-ENT-24](entities.md#6-functional-requirements); no ability scores → `conflict` "No ability scores". One roll `1d20 + bonus` via `characterRolls` ([FR-CHAR-21](character-sheet.md#6-functional-requirements)), one `roll` entry: category `ability-check` / `saving-throw`, label "Dexterity save", actor = combatant name, `encounterId`; `public` false if the combatant is hidden, else the DM's override, else the category setting. Emits `CombatantRolled`. UI: row menu **Check ▸ / Save ▸** with six items showing signed bonuses (shared roll control: Shift / Ctrl, physical-dice popover, public toggle) *(proposed, OQ-CBT-38)*. | #149; DM rolls monster saves |
| FR-CBT-45 | **Routing** (amends FR-CBT-30): combat's sheet roll route claims only `initiative` and `attack`; `check` / `save` fall through to `char.roll` ([FR-CHAR-23](character-sheet.md#6-functional-requirements)). | #149; built route claims every non-initiative kind |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense; `hp.full` / `hp.bloodied` / `hp.down`, `visibility.hidden` tokens.

| Kind | Clients | Default open | Geometry | Launcher |
|---|---|---|---|---|
| `cbt.initiative` | both (player `available` iff a started encounter is in the store) | yes | DM: right edge; player: top-left below the top bar, clear of the tool rail; 340×520, min 280×240 | "Initiative" |
| `cbt.encounters` | DM | no | centre-left, 460×560, min 360×320 | "Encounters" |

- **`cbt.encounters` (DM):** list (planned / started / ended Badges) + "New encounter". Editor: name, picker, entry rows (name, CR, − qty +, remove), party checkboxes (level), difficulty Card (rating Badge, base / adjusted XP, thresholds, total CR). **Start** (viewed scene; Dialog previews bindings) / **End** (confirm). Started / ended: read-only.
- **`cbt.initiative` (DM):** header: encounter, Round N, Prev / Next (round 0: "Start round 1"), **Undo** (Tooltip "Undo: Goblin → Mira, 6"), "Roll monsters". **Pending cards** (click → popup). Rows by `position`: turn marker, portrait, name, initiative (roll button / number input), AC, HP `cur/max`, band Badge, moved (FR-CBT-39), eye-off if hidden; row menu Attack, Check ▸, Save ▸ (FR-CBT-44; hidden without scores), Damage / heal, Remove. Removed section with Restore.
- **`cbt.initiative` (player), read-only:** Round N; rows by `playerPosition`: turn marker (`playerTurnCombatantId`), portrait / initials, name, band Badge (monsters), initiative (PCs). Own PC without initiative: "Roll initiative on your sheet". Attacks start from the sheet (one Attack button).
- **Attack popup:** ~~FR-CBT-19~~ FR-CBT-33: a non-modal panel (visual-direction prefers panels to modals), target rows as a compact table; changed numbers marked "edited".
- **Map** (FR-CBT-38): Out = dimmed token + "Out" badge; Down = "Down" badge in `hp.down`; target ring + crosshair while the popup is open. **Player:** same badges on what they receive; turn alert = shell flash + ping + Toast "Your turn — Mira" (FR-CBT-41).
- **States:** no encounter: DM "No encounter running — open Encounters"; player window unavailable. Loading: shell skeleton. Disconnected: last state + banner, controls disabled. Errors: Toast.
- **Test IDs** (records add `data-record-id`; option values use `data-value`): `cbt-enc-<list|row|new|name|picker|entry|entry-inc|entry-dec|entry-remove|party|xp-base|xp-adjusted|rating|total-cr|start|start-confirm|binding|end>` (`row` + `data-status`); `cbt-init-<round|next|prev|undo|roll-monsters|row|card|hint|empty>` (`row` + `data-turn`, `data-hidden`), `cbt-init-row-<init|roll|hp|band|moved|attack|check|save|hp-adjust|remove|restore>` (`moved` + `data-tone`); `cbt-popup-<tohit|damage|apply|later|dismiss>`, ~~`cbt-popup-<target|hit|mult|preview>`~~ → `cbt-popup-target-<add|row|hit|mult|preview|remove>` (`row` + `data-record-id` = combatant id), `cbt-popup-not-in-combat`; `cbt-hp-<amount|damage|heal>`; `cbt-form-<field|save|error>` (`field` + `data-field`, incl. `speed`, `tokenShape`). Konva (overlay badges): `cbt-token-out`, `cbt-token-down` (id = token id). Roots: `cbt-init`, `cbt-enc-list`, `cbt-popup`, `cbt-form`.

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
| | movedFt | int 0–9,999, default 0 | Movement used this turn (FR-CBT-39/40) |
| **Combat log entry** (`hp_change`) | id, campaignId, encounterId, seq, at, kind | ID, ID, ID, int, timestamp, `damage` \| `heal` | Undo + stats source (I9) |
| | source, cardId, rollIds | `card` \| `direct`, ID \| null, **JSON leaf** ID[] | |
| | attackerId, attackerName, attackName, damageType | ID \| null, text \| null ×3 | Copies at the time |
| | targetId, targetEntityId, targetName, targetAc | ID, ID, text, int | Effective values (ADR-0009) |
| | toHitRolled, toHitTotal, natural, hitComputed, hit | int \| null ×3, bool \| null ×2 | Override = rolled ≠ final |
| | damageRolled, damageTotal, multiplier | int \| null, int, `normal` \| `half` \| `none` \| `double` \| null | |
| | raw, applied, overkill, hpBefore, hpAfter, entryId, undone, undoneAt | int ×5, ID → game-log entry, bool, timestamp \| null | Undo marker on this row. One row per target; rows sharing a non-null `cardId` and not undone = one apply (FR-CBT-35), no new column |
| Damage card | `notification` row, kind `damage-card` | [notifications §8](notifications.md#8-data-model) | |
| | payload (player-safe, ≤ 1 KB) | **JSON leaf** | `{encounterId, attackerId, attackerName, attackName, damageType, mode, crit, toHit {rollId, dice[], constant, total, natural, manual}, damage {rollId, dice[], constant, total, manual}}`; `dice[]` = per-die results as compact `[value, kept]` pairs (#140); test: payload ≤ 1 KB at 50 dice |
| | resolution | **JSON leaf** | ~~`{targetName \| null (null if hidden), hit, multiplier, applied}`~~ → `{targets: [{targetName \| null (null if hidden), hit, multiplier, applied}]}` (1–20, apply order; FR-CBT-34). Readers also accept the old single-target shape (rows from before). hp_change links back via `cardId`; seen by the rolling player (#138) |

- **Relations:** Campaign 1—* Encounter 1—* Entry, Combatant; Entry, Combatant → Entity; Combatant → Token (0..1); combat log entry → Combatant, card, rolls, game-log entry. Game-log entries carry `encounterId`; rolls are linked from entries via `rollIds` (I24).
- **Derived:** difficulty and total CR (FR-CBT-03), band (FR-CBT-26), eligible turns, hit hint.
- **Persisted runtime state:** status, round, turns, initiative, positions, monster HP, flags, `movedFt`, combat log, cards. Popup edits and targets are client memory (lost on reload; card stays).

## 9. API & events

**REST (DM, `Authorization: Bearer`):** `POST /api/encounters` → `201 {encounter}`; `PUT /api/encounters/:id` (whole replace) → `200`; `DELETE /api/encounters/:id` → `204` *(prefix proposed, [OQ-CAMP-15](campaign-management.md#15-open-questions))*. Creature form uses entities' routes.

**WS intents** (strict zod; none optimistic)

| Intent | Who | Validation | Result |
|---|---|---|---|
| `cbt.start` / `cbt.end` | DM | FR-CBT-07, -10 | — |
| `cbt.rollInitiative {combatantIds, mode?, manual?, public?}` | DM, player | FR-CBT-11; invisible → `not_found` | `{rollIds}` |
| `cbt.setInitiative`, `cbt.nextTurn`, `cbt.prevTurn`, `cbt.setRemoved` | DM | FR-CBT-12, -14, -15 | — |
| `cbt.attack {attackerId, mode?, manual?}` | DM, player | FR-CBT-16, -17 | `{cardId, rollIds}` |
| `cbt.applyCard {cardId, toHitTotal, damageTotal, targets [{targetId, hit, multiplier}], public?}` | DM | FR-CBT-34 | `{hpChangeIds}` |
| `cbt.applyHp`, `cbt.undo` | DM | FR-CBT-21, -25, -35 | `{hpChangeId}` / `{hpChangeIds}` |
| `cbt.rollAbility {combatantId, kind, ability, mode?, manual?, public?}` | DM | FR-CBT-44 | `{rollId, entryId}` |
| `note.dismiss {id}` (notifications) | DM | Dismisses a card (#136) | — |

**Record types** (scope `campaign`; DM full)

| Type | Player visibility | Snapshot ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)) |
|---|---|---|
| `encounter` | `started` → `{id, status, round, playerTurnCombatantId}`; else hidden | `window {orderBy: seq, size: 20, pin: status ≠ ended}` (I26) |
| `encounter-entry` | `audience: dm` | Entries of encounters in the `encounter` snapshot |
| `combatant` | `!active` ~~, `removed`~~ or `hidden` → hidden. Removed → `{id, encounterId, kind, tokenId, name, imageAssetId, removed, movedFt}` (FR-CBT-37). PC → `{id, encounterId, kind, entityId, tokenId, name, imageAssetId, playerPosition, initiative, removed, movedFt}`. Monster → `{id, encounterId, kind, tokenId, name, imageAssetId, playerPosition, band, removed, movedFt}` | Combatants of the started encounter |
| `hp-change` (combat log entry) | `audience: dm` | Started encounter's rows, `window {orderBy: seq, size: 50}` (I22) |
| `notification` `damage-card` | Notifications' audience rule: rolling player + DM, or DM | `pin` pending, newest 100 closed |

**Domain events** (all logged; WS = generic record changes, `cause.name` = event)

| Event | Changes | Player sees | Undoable |
|---|---|---|---|
| `EncounterCreated` / `Updated` / `Deleted` | `encounter` (+ entries) | nothing | no |
| `EncounterStarted {encounterId, sceneId, combatantIds}` | `encounter`, `combatant` creates | encounter + visible combatants | no |
| `EncounterEnded {encounterId}` | `encounter`, every `combatant` | deletes | no |
| `InitiativeRolled` / `InitiativeSet` | `combatant`s (positions); `game-log-entry` | visible rows whose rank or value changed; entry if public | no |
| `TurnChanged {round, turnCombatantId, direction}`; `CombatantRemoved` / `Restored` | `encounter` / `combatant`s; `TurnChanged` + the new turn combatant's `movedFt` reset (FR-CBT-40) | upsert; ~~removed = delete~~ removed = upsert `removed: true` (FR-CBT-37); owner's client alerts (FR-CBT-41) | no |
| `AttackRolled {cardId, rollIds}` (+ `NotificationCreated`) | `game-log-entry` (player roll); card | entry; own card | no |
| `AttackApplied {hpChangeId, …facts}` × targets (+ one `NotificationResolved`) | per target: `combatant` or `entity` (adjustHp); `hp-change`; `game-log-entry`; card on the last | band; own PC full; entry per FR-CBT-36; own card resolution | **yes** (per apply, FR-CBT-35) |
| `HpApplied {hpChangeId, …facts}` | target; `hp-change`; `game-log-entry` | as above | **yes** |
| `CombatantRolled {encounterId, combatantId, kind, ability, rollIds, entryId}` | `game-log-entry` | entry iff public (hidden combatant → never) | no |
| `CombatEntryUndone {hpChangeId}` × rows of the apply (+ one `NotificationReopened`) | target; `hp-change`; entry (`undone`); card | band / own HP; struck entry if visible; card pending | compensating |
| `EntityUpdated` / token events (hooks) | + `combatant`, `encounter` copies | per rule (reveal = upsert, hide = delete) | no |
| `TokenMoved` (scenes-map, unlogged; hook FR-CBT-39) | + bound `combatant` `movedFt` | upsert | no |

- **Hooks:** definition-changed (FR-CBT-06), token-changed (FR-CBT-09; on moves FR-CBT-39). **Helpers used:** `dice.evaluate`, `gameLog.append` / `markUndone`, `notify` / `resolveNotification` / `reopenNotification`, `characters.adjustHp`, `characterRolls`, `effectiveStats`, `resolveDefinition`. **Listeners, signals:** none.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Encounter CRUD, start, end, creature form | ✓ | ✗ | DM credential / DM-only intents |
| Roll initiative | any combatant, overwrite | own PC, once | FR-CBT-11 |
| Set initiative, turns, remove, direct HP, undo | ✓ | ✗ | role |
| Attack | any active combatant | own visible PC (from the sheet) | FR-CBT-16 |
| Pick targets (map selection, popup), apply / dismiss card | ✓ | ✗ (sees own card and resolution) | role; FR-NOTE-08 (#136); selection is DM-client only |
| Turn alert | — | own PCs | client only (FR-CBT-41) |
| Own PC HP outside combat | via sheet | own, via sheet; not undoable, not a combat log entry | [FR-CHAR-09](character-sheet.md#6-functional-requirements) (#139, P5) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled; an attack in flight is never resent; if committed, the card and roll line are in the snapshot. Reconnect mid-turn → round, turn, order, bands.
- **DM disconnect:** players keep attacking; cards pile up pending; summary toast on return. An open popup's edits are lost; the card stays pending.
- **Server crash mid-action:** one transaction each: card ⇔ rolls; apply ⇔ HP ⇔ log line ⇔ card resolved; undo ⇔ inverse ⇔ marks ⇔ reopen. Restart → identical snapshots. **Concurrency:** two DM tabs apply one card → second `conflict`. Double Next / Undo → `expected*` guards. Sheet heal + combat damage → deltas in commit order; undo restores only its own delta.
- **Removed target** can't be picked or applied (`not_found`). **After End:** pending cards can only be dismissed; Undo → "Nothing to undo" (combat log entries stay for stats). **Hidden PC** (its token hidden): hidden from every player incl. the owner, so the sheet falls back to `char.roll` (no card); the DM rolls for it or reveals (OQ-CBT-28, #141).
- **Definition edited mid-fight:** FR-CBT-06; log keeps the values used. Active scene switched: combat continues. **Windowed log:** undoing an entry older than the newest 100 still delivers the struck entry live; a fresh snapshot omits it ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)).
- **Leaks accepted:** the rolling player's resolution shows `applied`, so a killing blow reveals the monster's last HP, and `multiplier` hints at resistances (#138); a band upsert with unchanged band hints "something hit it" (as the public log); a hidden combatant's turn shows no marker (timing hint).
- **Invalid input:** strict zod; a player can't attack as another PC, send `public` or a target, or re-roll set initiative; ids of another campaign → `not_found`; names rendered as text. `targets` empty, > 20 or with a duplicate id → `invalid`.
- **Feedback pass.** *Multi-target:* one bad target (removed, gone) fails the whole apply, nothing applied; the DM fixes the list. A viewed-scene switch clears the selection, so token-bound targets leave the list (re-add from the Combobox). Two DM tabs: own selection each. *Undo* reverts every row of the apply, each inverse clamped. *Movement:* a move and its `movedFt` commit together (crash-safe); DM corrections count too (the next turn resets); a removed or token-less combatant gains nothing. *Turn alert:* a player offline at their turn start gets no alert on rejoin (the snapshot shows the turn marker); a crash between commit and send loses that alert (accepted). Tab hidden: the sound plays if unlocked, the title marks the turn (FR-SHELL-23). *Indicators* rebuild from the snapshot. **Leaks accepted:** a removed, non-hidden combatant's name and token to players (they saw it before); monster `movedFt` (they saw the move); the rolling player sees how many targets, incl. hidden ones (null names, as #138).

## 12. Performance & bandwidth

- Feedback pass: an apply sends one `AttackApplied` frame per target (≤ 20 × ≤ 3 KB per connection, typ. 2–4); an in-combat move adds one `combatant` upsert ≤ 300 B; removed combatants now reach players (+≤ 200 B each).
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
| `combat-hit` | `combat-1` | Goblin attacks, manual 15 / 4 → card; apply targets `[{Mira, hit, normal}]` → Mira 6/12 | no |
| `combat-pending` | `combat-hit` | Elite attacks, manual 19 / 5, left pending | no |

- **Bundle `combat`** = `session-sim` + `player-2` + `char-thorn` + `thorn-battlemap`. **Bundle `mid-combat`** = `combat` + `combat-1` + `combat-hit` + `combat-pending` (answers OQ-FIX-04).
- **Leak strings** (player frames): "Elite Goblin Warrior", "Goblin Boss", "Ambush at the Ford", Wolf / Elite combatant ids while hidden, `"position"`, `"turnCombatantId"`, monster `hpCurrent` / `hpMax` / `initiative` on `combatant`, `dmPayload`, `encounter-entry`, `hp-change`.

| Level | What | Fixtures |
|---|---|---|
| Unit | `dmg-2014` (DMG examples, ladder ends ×0.5 / ×5, CR 0, no party), total CR; order + ties; `playerPosition` with hidden / removed; turn eligibility, wrap, round 1; binding (seq order, FR-MAP-16 numbering); band; `raw` per multiplier (half rounds down); overkill; crit doubling; hit rule; visibility matrix (encounter / combatant × DM / owner / other player × hidden / removed / ended); log `public` rule. **Feedback:** targets from a selection (eligible only, attacker excluded); per-target hit preset per AC; resolution parse (new + legacy); undo group (latest + same card); overlay decorate (Out, Down × DM / owner / other player; target ring only while targeting); `movedFt` sum and cap; turn-alert predicate (TurnChanged + own PC → alert; snapshot, other cause, other PC, null → none) | In-code |
| Integration (#149) | `cbt.rollAbility`: Goblin DEX save = `1d20+2`, category `saving-throw`, `encounterId`, `CombatantRolled`; Wolf (hidden) entry never public even with `public: true`; Elite DEX save adds +2 proficiency; a definition without scores → `conflict`; player sending it → `forbidden`. Sheet route: `check` / `save` not claimed while in combat | `combat` |
| Integration (feedback) | `applyCard` 2 targets (one hidden) → 2 rows, 2 entries (hidden one DM-only), 2 `AttackApplied` + 1 `NotificationResolved`, one tx; a removed target or duplicate id → nothing. Undo → both rows, 2 `CombatEntryUndone`, 1 reopen. Remove → player upsert `removed: true`, restore upsert, End delete. Move hook: `movedFt` in `TokenMoved.changes` (5/10/5), removed / inactive unchanged; `nextTurn` resets; `mid-combat` restart keeps `movedFt` | `combat`, `mid-combat` |
| Integration | Each command: rows + log + events, rollback → none. Start: bindings, hidden copy, second start `conflict`. Hooks: hide / reveal → combatant delete / upsert, ranks and `playerTurnCombatantId` in the same event; token delete `conflict` while started, set null after; portrait + hpMax edit follow. Attack: player as Thorn `forbidden`; player with a target field `invalid`; player initiative re-roll `conflict`; card audience; player roll line public. Apply: monster + PC paths, rolled values from rows, double apply `conflict`, ended `conflict`; resolution `targetName` null for a hidden target. Undo LIFO, `expected` guard, inverse after a sheet heal, event order, card reopened. **Crash-resume:** `mid-combat`, `restartServer()` → identical snapshots; next turn + apply pending card work. Leak scan; convergence per player | `combat`, `mid-combat` |
| E2E (thin) | DM + `player-1`: start, roll all, Mira attacks from the sheet, DM targets Goblin, applies half, band shown to player; undo; restart | `combat` |

**Browser walkthrough** — needs dice-roll-log, notifications, character-sheet built; feedback steps (4–11, 13–14) also the scenes-map and play-shell feedback builds. `PP_TEST_MODE=1` (also exposes `data-test-last-sound`, FR-SHELL-27); `bun run build`; `fixtures:reset-load combat --profile verify`; `start --profile verify` in the test agent's Herdr pane. Contexts **A** DM (`pw-dm`), **B** `player-1`, **C** `player-2`; B, C frame logs via `page.on('websocket')`. Evidence + teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | View Goblin Ambush, "Show to players"; Encounters → "Ambush at the Ford" | B, C open links | Goblin ×2, Wolf, Elite; party Mira, Thorn; 250 XP base, 625 adjusted, **Deadly**, total CR 1.25. B, C: no Initiative launcher; no leak string |
| 2 | Picker "wo" → Wolf ×2, then −1. Creatures → Derive Goblin → "Goblin Boss", AC 17, HP 21, CR 1, Save | — | Rating updates live; Goblin Boss listed as Custom; not in B, C frames |
| 3 | Start → preview (all bound) → confirm | — | A: 6 rows, Wolf + Elite eye-off. B, C ≤ 1 s: Thorn, Mira, Goblin, Goblin 2 ranked 1…4 |
| 4 | Roll monsters; Start round 1 | B: click the page (unlocks audio), sheet Shift+Initiative; C: speaker → Mute, sheet manual 12 | B, C never see Wolf / Elite rolls; B adv line; order sorted; A: first marked; B, C: no marker if it is Wolf / Elite. No alert unless the first turn is Mira's / Thorn's (then as step 5) |
| 4a | Goblin row → Save ▸ Dexterity; Wolf row → Save ▸ Wisdom | B: sheet DEX Save | A sees "Goblin — Dexterity save: … + 2" and the Wolf line; B, C see neither (saving throw hidden by default; Wolf hidden). B's save: a plain public line, no card, no "In combat" route (FR-CBT-45) |
| 5 | Next until Mira's turn | B: drag Mira (2, 7) → (6, 7), drop; drag on to (10, 7), drop | B: flash + Toast "Your turn — Mira", sound `played` (`data-test-last-sound`); C: no alert. B's labels "move 20 · 20 / 30 ft" normal, then "move 20 · 40 / 30 ft" amber. A: Mira row "Moved 40 / 30 ft" amber |
| 6 | Next until Thorn's turn | B: sheet Attack | C: flash, sound `muted`; B: none. B: public roll line; card "Waiting for DM" (no toast, FR-NOTE-13). A: sticky card toast; card in Pending |
| 7 | Click Goblin's token, Ctrl+click Goblin 2's; open B's card. Goblin: Hit, Normal; Goblin 2: Hit, Half; Apply | — | Popup opens with both rows, target rings, crosshair. Two outcome lines (A, B, C); bands for B, C (no HP in frames); B's card "Hit Goblin: N · Goblin 2: M (half)" |
| 8 | Elite row → Ctrl+Attack; in the popup click empty canvas, Shift+drag a box over Mira and Thorn, remove Thorn's row; Mira: Hit, damage 9; Apply | — | Rows follow the map: Goblin, Goblin 2 (selection kept from step 7) → none → Mira, Thorn → Mira. B's sheet HP −9 ≤ 1 s; no outcome line for B, C (hidden attacker) |
| 9 | Undo; Undo | — | First: Mira HP back, Elite card pending. Second (one click): both Goblins back, two entries struck; B's card pending again |
| 10 | Goblin 2 token menu → Damage / heal… 99; Mira's token → Damage / heal… 99 | — | Goblin 2 "Down" badge for A, B, C; Mira "Down" for A and B, not C (C's frames: no Mira HP) |
| 11 | Reveal Wolf; try to delete Goblin 2's token; Remove Goblin 2 | — | Wolf appears, ranks shift, for B, C ≤ 1 s; delete → Toast "Token is in a running encounter"; Goblin 2 dimmed + "Out" for A, B, C, gone from B, C's Initiative |
| 12 | Next while C is dropped | C back | C: banner, then current turn without reload; no alert on rejoin |
| 13 | Hard-kill + restart | — | All rejoin; round, turn, HP, pending cards, log, `Moved`, Out / Down badges intact |
| 14 | End | — | Badges gone; B, C Initiative unavailable; Ended in list; DM Initiative shows "No encounter running", no Undo (server answers "Nothing to undo"). No leak string; no app console errors (network errors from deliberate outages are expected) |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0016, 0021, 0022, 0024, 0027, 0028, 0029; #53–55, #74, #76–78, #84–85, #92, #134–140 | Instances, events + undo, sync, seams, cards in-tx, token hooks, windows | accepted |
| [entities](entities.md) | `resolveDefinition`, `effectiveStats`, XP table, routes, definition hook + `creatureActions` registries | complete |
| [scenes-map](scenes-map.md) | Tokens; token-changed hook registry (ADR-0028, in `build/scenes-map`); token menu registry (FR-MAP-29). Feedback: selection + targeting API (FR-MAP-33), `tokenOverlays` (FR-MAP-34), hooks on moves (FR-MAP-38, [ADR-0031](../architecture/adr/0031-token-move-hooks.md)) | in-review (feedback pass) |
| [play-shell](play-shell.md) (feedback) | `alert()` with flash + sound, mute / volume, audio unlock ([FR-SHELL-22–27](play-shell.md#6-functional-requirements)) | in-review |
| [entities](entities.md) (feedback) | `statBlock.speed`, `tokenShape` for the form (FR-ENT-21/22) | in-review |
| [character-sheet](character-sheet.md) | `characters.adjustHp(env, …)`, `characterRolls`; client roll-action routing registry (FR-CBT-30) | in revision |
| [dice-roll-log](dice-roll-log.md) | `ctx.dice`, `dice.evaluate` (per-die results), `gameLog.append` / `markUndone`, kind registry, `encounterId`, `dmPayload`, N-expression manual popover | in revision |
| [notifications](notifications.md) | `notify` / `resolveNotification` / `reopenNotification`, `note.dismiss`, kind + view registries, resolution visible to the audience (#138); post-MVP payload update for gems | in revision |
| [live-sync](live-sync.md), [play-shell](play-shell.md), [fixtures-adapters](fixtures-adapters.md) | Registries incl. `window`, windows, bundles | complete |

**Shared-file changes** ([AGENTS §9.9](../../AGENTS.md#99-shared-files), gate §4); `shared change needed:` each line, orchestrator picks the route:
- `src/server/db/` — tables `encounter` (partial unique one `started` per campaign), `encounter_entry`, `combatant`, `hp_change`. `src/shared/events/` — `EncounterCreated` / `Updated` / `Deleted` / `Started` / `Ended`, `InitiativeRolled` / `Set`, `TurnChanged`, `CombatantRemoved` / `Restored`, `AttackRolled`, `AttackApplied`, `HpApplied`, `CombatEntryUndone`.
- Record-type registry (append) — `encounter`, `encounter-entry`, `combatant`, `hp-change`; needs ADR-0029 `window` in `src/server/ws/` first (gate item 4). `src/server/app.ts` (append) — mount `/api/encounters`.
- Registries (append lines): `combatTracker` in `src/server/features/index.ts`; `src/shared/dice-roll-log/kinds.ts` (`cbt.attack`, `cbt.hp`); server notification kind registry + `src/client/{dm,player}/notification-views.ts` (`damage-card`); scenes-map token-changed hooks; scenes-map token menu; character-sheet client roll-action routing; `src/client/{dm,player}/windows.ts`; entities' definition hooks; `creatureActions`; `fixtures/bundles/index.ts` (`combat`, `mid-combat`). All on the AGENTS §9.9 list; paths in [protocol §26](../protocol/README.md#26-combat-registries-and-seams).
- Docs (integrator): protocol rows, data-model rows (+ undo note, I9), glossary (I13), ADR-0016 "MVP use" (I30), ADR-0014 / feature-tiers hit-miss line (I29), FIX §8 rows (I11).

**Shared changes — feedback pass** (consolidation writes data-model / protocol; builders report `shared change needed:`):
- `src/server/db/` — `combatant.moved_ft` int not null default 0. No new table; `hp_change` unchanged (apply group = `cardId`).
- `combatant` visibility fn (record-type registry, combat's line): removed → redacted with `removed: true`; `removed`, `movedFt` in both redactions.
- Combat zod (`@shared/combat-tracker`): `cbt.applyCard` `targets[]` (replaces `targetId`, `hit`, `multiplier`); result `{hpChangeIds}`; `damage-card` resolution `{targets […]}` (+ legacy parse); `cbt.undo` result `{hpChangeIds}`.
- `src/shared/events/combat-tracker.ts`: payloads unchanged; `AttackApplied` / `CombatEntryUndone` emitted once per row (protocol §22 note).
- Append-only lines: `tokenOverlays` (`cbt`); token-changed hook now also on moves (needs the proposed ADR).
- Docs: protocol §20 (`combatant` row), §21 (`cbt.applyCard`, results), §22 (multiplicity, `TokenMoved` row), §23 (resolution, player view), §25 (move); data model §17 (`movedFt`, apply group note, resolution); glossary (OQ-CBT-37); FIX §8 `combat-hit` input (`targets`).

**Shared changes — #149** (checks and saves):
- `src/shared/events/combat-tracker.ts`: new `CombatantRolled {encounterId, combatantId, kind, ability, rollIds, entryId}` (+ `domainEvents` line).
- Combat zod (`@shared/combat-tracker`): `cbt.rollAbility`. Roll route (`@ui/features/combat-tracker/roll-route.ts`, combat's line): claim only `initiative` / `attack`.
- DB, record types, visibility: none. dice-roll-log: none (existing categories and tickboxes). Docs: protocol §21 (`cbt.rollAbility`), §22 (`CombatantRolled`).

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-CBT-02, 04, 05, 09, 10, 14, 21, 22, 23, 24, 25~~ | ~~DM product picks~~ | **Decided (#139):** bold picks P4, P5, P9–P17 (band; DM applies combat damage, sheet HP not undoable; individual rolls; cards persist after End; applied + overkill; selectable party; crits; skip rules; one started; undo reopens the card, no Redo; auto-bind) | — | — |
| ~~OQ-CBT-07, 17~~ | ~~Card target; token hooks~~ | **Decided (#134):** the DM picks the target in the popup, no scenes-map click change; [ADR-0028](../architecture/adr/0028-token-changed-hooks.md) | — | — |
| ~~OQ-CBT-12, 18, 19~~ | ~~CR maths; sheet buttons in combat; card creation~~ | **Decided (#136):** derived label, method registry, MVP 2014 DMG + total CR. **(#135):** sheet routes to `cbt.*` in combat; `notify` in `cbt.attack`'s tx ([ADR-0027](../architecture/adr/0027-notification-creation.md)) | — | — |
| ~~OQ-CBT-03, 06, 11, 15, 16, 20, 26, 27~~ | ~~HP source; auto tokens; roll modes; picker; form; undo marker; glossary; registries~~ | **Decided:** character (ADR-0009); no (#77); everyone (I8); one list, Shieldmaiden form (#84–85); own table (I9); I13; §14 (gate §4) | — | — |
| ~~OQ-CBT-28~~ | ~~A PC whose token is hidden is hidden from its owner too, so its sheet rolls via `char.roll` (no card) and the roll line is public to every player (#73), naming the hidden PC~~ | **Decided (#141):** accepted; the DM rolls for it or reveals it | — | character-sheet |
| OQ-CBT-29 | Undo granularity for a multi-target apply (F7) | **One step per apply: every row of the card, one click; the card reopens once** (matches "fix it in two clicks"; the card is what the DM confirmed) / one step per target row (Fireball on 4 = 4 clicks; card reopens after the last) | no · owner: DM | ADR-0016 (unit wording), glossary |
| OQ-CBT-30 | How the turn alert is addressed (F1) | **Derived on the owner's client from `TurnChanged`'s encounter upsert** (no new event; whose turn it is is already public; nothing to leak) / `turn-start` notification to the owner (persisted, a history row per turn) / a server push frame (new protocol frame for one use) | no · owner: spec-feedback | play-shell, notifications |
| OQ-CBT-31 | Removed combatants for players (F6) | **Redacted with `removed: true`, so their visible token shows Out; not in the player list** / stay hidden (no Out badge for players; contradicts F6) | no · owner: DM (confirms #148's note "players if the token is visible") | — |
| OQ-CBT-32 | Who sees a **PC** down on the map (F8) | **DM + the owner** (party HP is tier B, #139 P7; monsters per band for all) / every player (needs a `down` copy on the PC combatant, written by every HP change incl. the sheet's) | no · owner: DM | character-sheet |
| OQ-CBT-33 | dice-roll-log: per-target outcome entries share the card's `rollIds` | **Allowed as is; FR-DICE-26 gains a note at consolidation; stats count distinct roll ids** / one entry for all targets (can't hide one target's line) | no · owner: dice-roll-log | [dice-roll-log](dice-roll-log.md), stats |
| OQ-CBT-34 | Which moves count as movement used (F3) | **Every committed move of a bound, active, non-removed combatant's token, by anyone; reset at its turn start (next or prev)** / only moves during its own turn / only moves by the token's owner (DM moves for monsters wouldn't count) | no · owner: DM | scenes-map |
| OQ-CBT-35, 36 | Spec-local picks | **35: hit per target (each AC)** / one hit for all. **36: non-modal popup; the map selection drives token-bound targets while open** / modal popup with its own picker (no map picking; misses F7) | no · owner: spec-feedback | scenes-map |
| OQ-CBT-37 | Glossary: **Damage card** "to a target" → "to one or more targets, each with a multiplier"; **Attack popup** "pick a damage card's targets"; **Undo** "the latest entry" → "the latest apply (all its entries)"; add **Turn alert**, **Movement used** | **Reword / add as here** | no · owner: integrator | glossary |
| OQ-CBT-38 | How the DM rolls a monster's check / save (#149) | **Initiative row menu Check ▸ / Save ▸ (`cbt.rollAbility`)** (in combat, where monster saves happen; no new window) / none in MVP, DM types into the roll bar / a stat-block window per monster (tier B) | no · owner: DM | entities, character-sheet |

Answers to other specs' questions: recorded in the [gate](../agents/gate-phase3-combat.md) (§1–3) and decisions #134–140.

## 16. Out of scope

- See §4. Full monster editor, compendium import → [compendium](post-mvp/compendium.md); gems → [gems](post-mvp/gems.md).
