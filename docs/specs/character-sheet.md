---
title: Character sheet (basics)
prefix: CHAR
status: in-review
owner: spec-character-sheet
wave: 2
---

# Character sheet (basics)

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- MVP sheet: just enough for a fight ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #32). A **view and controls** over the `character` entity that [entities](entities.md) owns. No new table or record type; the fields it reads are entities' (incl. optional ability scores, FR-ENT-23).
- Player sees their own character; click-to-roll initiative, attack (to-hit + damage, one click), and the **6 ability checks and 6 saving throws** (#149). Owner and DM adjust current HP.
- In a running encounter the sheet's buttons send combat intents (#135); outside combat it rolls via `char.roll` and [dice-roll-log](dice-roll-log.md)'s helpers.
- Stored values ([ADR-0012](../architecture/adr/0012-character-derived-values.md), #106); since #149 ability modifiers, proficiency bonus and save bonuses are derived by fixed 5e formulas ([ADR-0032](../architecture/adr/0032-ability-derivation.md)). Characters come from fixtures (#100). Full 5e sheet → [character-sheet-full](character-sheet-full.md).
- **Playtest pass** (#171; FR-CHAR-24, 25): a roll route may **hide** a button: from round 1 combat hides Initiative once the PC has initiative, so nobody re-rolls (P4, amended #172); roll hints are shared Tooltips that stay shut while the roll popover is open (P1).
- **Sprint 2 phase 1** (P2b; amendments only, new FRs in [character-sheet-full](character-sheet-full.md#6-functional-requirements)): the attack row leaves the Main tab, attacks live on the Actions tab only (N4, FR-CHARX-44); every attack has **Attack / Damage / Attack + damage** (N7, FR-CHARX-41); the picker remembers its character across reloads (FR-CHARX-47).

## 2. Scope

- Window `char.sheet` (both clients): name, portrait, level + class, AC, HP current / max, initiative bonus, speed (feedback F3, #148), the one weapon attack, **ability scores, proficiency bonus, save proficiencies** (#149).
- Click-to-roll initiative, attack, **ability checks and saving throws** (#149). Roll mode (Shift / Ctrl or toggle) and manual entry on every roll, via dice-roll-log's shared roll control.
- Adjust current HP: damage / heal by an amount; owner and DM (#139 P5). Not undoable.
- Character picker when a client may view several characters.
- Roll-route registry so combat-tracker can take over the buttons in combat (#135).
- Internal server API `characters.adjustHp` for combat-tracker. Fixtures + bundle `character-sheet`.

## 3. Goals

- A player runs their part of a fight from one window: sees AC / HP, rolls initiative, attacks, checks and saves with the right bonuses, no typing (F9, #149).
- The server, not the client, decides what is rolled: bonuses and dice come from the stored character.
- HP on the sheet is always the true HP: combat damage shows ≤ 1 s, survives a crash (PC HP lives on the character, [ADR-0009](../architecture/adr/0009-entity-content-model.md), #92).
- No other player receives a character's **sheet data** (stat block, HP) ([ADR-0024](../architecture/adr/0024-definition-visibility.md)). Roll lines are public by #73 (I16).

## 4. Non-goals

- Spells, skills (tier A), features, inventory, currency, proficiencies other than saves, hit dice, notes (#139 P18; saves and ability scores are in since #149); roll from any number, incl. a standalone damage roll (tier A) → [character-sheet-full](character-sheet-full.md).
- Temp HP, death saves, conditions → [combat-extras](combat-extras.md). Crit rule: combat only ([combat-tracker](combat-tracker.md) FR-CBT-16).
- Character creation, levelling, editing basics in the UI (#139 P20) → [levelling](post-mvp/levelling.md). Speed, scores and saves come from fixtures / `PUT /api/entities` in MVP; full PC / NPC editing and player-filled sheets are design-for-later (#154).
- Damage cards, targets, hit/miss, initiative order → [combat-tracker](combat-tracker.md). Notation, game log → [dice-roll-log](dice-roll-log.md).
- Other PCs' HP for players (#139 P7); [gems](post-mvp/gems.md) (#140, tier A).

## 5. User stories

**DM**
- As the DM, I want any PC's sheet one click away, so that I can check AC and HP mid-fight.
- As the DM, I want to heal or damage a PC from the sheet, so that out-of-combat changes (potion, trap) don't need a combat.

**Player**
- As a player, I want to click Attack (Shift for advantage) and have to-hit and damage rolled with my bonuses, so that I stop reading numbers out loud. In a fight the DM then applies it.
- As a player, I want my HP to change on my sheet the moment the DM applies damage, and to adjust it myself when I drink a potion.
- As a player, I want to enter physical dice results instead, so that I can still roll real dice.
- As a player, when the DM calls for a Dexterity save, I want one click (Shift for advantage) with my bonus applied, so that I never type a roll into the log (F9, #149).

## 6. Functional requirements

`env` = `CommandEnv`; campaign and player come from `env.actor` (I14).

| ID | Requirement | Notes |
|---|---|---|
| FR-CHAR-01 | The sheet reads only the `entity` record of kind `character` ([entities §8](entities.md#8-data-model)): `name`, `portraitAssetId`, `statBlock.{level, className, ac, hpMax, initBonus, attacks[0]}`, `hpCurrent`; feedback pass adds optional `statBlock.speed` (FR-CHAR-18). No new field, table or record type. | ADR-0012 |
| FR-CHAR-02 | Eligible characters: player = `character` entities with `ownerPlayerId` = own player id; DM = every character of the campaign. Picker shown iff > 1 eligible; sorted by name (case-insensitive), then id; default the first. ~~Selection is client memory only.~~ *(Sprint 2: remembered per browser, [FR-CHARX-47](character-sheet-full.md#6-functional-requirements); report item 13.)* | Amended sprint 2 |
| FR-CHAR-03 | Shows name, portrait (asset `thumb`, else initials), "Level N Class" (class omitted if empty), AC, HP `current / max`, initiative bonus signed (`+2`, `−1`), ~~attack row `name  +toHit  ·  damage damageType`~~ *(N4: attack rows only on the Actions tab, [FR-CHARX-44](character-sheet-full.md#6-functional-requirements))*. `hpCurrent = 0` → "Down" badge. Any committed change to the record shows ≤ 1 s, whatever caused it. | |
| FR-CHAR-04 | Empty states: player with none "No character yet — ask your DM"; DM with none "No characters in this campaign". Selected character no longer eligible (owner change, campaign switch) → first eligible, else empty state. | |
| FR-CHAR-05 | Intent `char.roll {characterId, kind: initiative \| attack \| check \| save, ability?, mode?, manual?, public?}` (check / save: FR-CHAR-21), strict (no expression or bonus field). The server builds the rolls with the pure `characterRolls(statBlock, kind, ability?)` in `@shared/character-sheet` (takes the stat block, like FR-ENT-24's helpers): initiative = d20 + `initBonus` (category initiative); attack = d20 + `toHit` (attack) **and** the attack's `damage` (damage), one action (#53). No crit rule. *(N7: `attack` keeps this meaning; its button is labelled "Attack + damage"; to-hit only is the new kind `toHit`, [FR-CHARX-42](character-sheet-full.md#6-functional-requirements).)* | combat-tracker reuses the fn |
| FR-CHAR-06 | `mode` (normal / advantage / disadvantage, default normal) applies to the d20 only. | Tier S adv/dis |
| FR-CHAR-07 | `manual`: dice-roll-log's manual entry ([FR-DICE-06](dice-roll-log.md#6-functional-requirements), dice total, per-die optional), one per roll: 1 for initiative, check and save, 2 for attack; wrong count → `invalid`. Logged as manual. | #43, I3 |
| FR-CHAR-08 | One transaction: per roll `dice.evaluate(env, …)`, then one `gameLog.append(env, {kind: roll, category, actorName, payload, rollIds})` per action (attack: one entry, category attack, both rolls, [FR-DICE-26](dice-roll-log.md#6-functional-requirements), I4), then emit `CharacterRolled`. Per-roll payload labels: "Initiative", "Shortsword attack", "Shortsword damage (piercing)". Any failure → no roll, entry or event. Result `{rollIds, entryId}`. | I1 |
| FR-CHAR-09 | Authorize `char.roll`, `char.adjustHp`: DM → character in `env.actor.campaignId`; player → `ownerPlayerId = env.actor.playerId`. Unknown id, monster, other campaign → `not_found`; another player's character → `forbidden`. `attack` with no attack → `conflict` "No weapon attack"; `check` / `save` with no ability scores → `conflict` "No ability scores". Failure: no change, event or log entry. | ADR-0004 |
| FR-CHAR-10 | Intent `char.adjustHp {characterId, delta}`: int −999…999, ≠ 0. `hpAfter = clamp(hpBefore + delta, 0, hpMax)`. Row + event-log entry in one transaction, `CharacterHpAdjusted`. `hpAfter = hpBefore` → success, no change, no event. Result `{hpBefore, hpAfter}`. Not optimistic, not undoable. | #139 P5 |
| FR-CHAR-11 | HP control: integer input 1–999 + **Damage** (delta −n) and **Heal** (+n) buttons; out-of-range input disables both. Caption: "Not undoable — in combat the DM applies damage". | |
| FR-CHAR-12 | Every roll and HP control is disabled while the connection is not `live` ([FR-SHELL-05](play-shell.md#6-functional-requirements)) and while its own intent is in flight (until `ack` / `reject`): a double click sends one intent. `reject` → Toast with its message. In-flight intent lost to a disconnect (FR-SYNC-05: never resent) → Toast "Connection lost — check the game log / HP before trying again". Applies to routed intents (FR-CHAR-16) too. | |
| FR-CHAR-13 | Internal API `characters.adjustHp(env, characterId, delta) → {hpBefore, hpAfter, change}`: FR-CHAR-10's clamp in the caller's transaction; returns the `entity` record change for the caller's event (I15), emits nothing. Apart from entities' create / update clamp ([FR-ENT-10/11](entities.md#6-functional-requirements)) it is the only writer of `hpCurrent`. Combat's apply and undo (inverse delta, clamped, I2) use it. | OQ-ENT-08 |
| FR-CHAR-14 | Visibility: no new record type. Character data travels as `entity` under [FR-ENT-15](entities.md#6-functional-requirements) (DM and owner full; other players redacted: no stats or HP, only a derived `down` flag, #154). Log entries follow dice-roll-log's rules (FR-CHAR-17). | |
| FR-CHAR-15 | Window `char.sheet` registered in both client registries per §7. | ADR-0025 |
| FR-CHAR-16 | **Roll routing** (#135): every sheet roll button (Initiative, Attack, Check, Save) first asks the client roll-route registry; the first route that claims `(store, characterId, kind)` sends its own intent built from the same `{mode, manual, public}` input, dropping fields its intent doesn't take, and may supply `critExpressions` to the roll control (combat-tracker: `cbt.rollInitiative` / `cbt.attack` per [FR-CBT-30](combat-tracker.md#6-functional-requirements); no target, the DM picks it, #134). No claim → `char.roll`. The header shows the route's badge ("In combat") iff a route claims at least one kind for this character (combat: Initiative and Attack); Check / Save buttons never carry it. Empty registry = plain sheet. A claiming route may also hide its button (FR-CHAR-24, #171). | [ADR-0027](../architecture/adr/0027-notification-creation.md) |
| FR-CHAR-17 | Public stamping per [FR-DICE-13](dice-roll-log.md#6-functional-requirements): player roll → public (#73); DM roll for a PC → category setting, or `public` (DM-only per-roll override, preset from the category). Player sending `public` → `forbidden`. | #139 P1, P22 |
| FR-CHAR-18 | Speed: the stat row shows `statBlock.speed` as "Speed 30 ft"; absent → "Speed —". Read-only, like the other basics. Movement used this turn is **not** on the sheet: the map's drag overlay ([FR-MAP-37](scenes-map.md#6-functional-requirements)) and the DM's initiative row ([FR-CBT-39](combat-tracker.md#6-functional-requirements)) show it (OQ-CHAR-15). | F3, [FR-ENT-21](entities.md#6-functional-requirements) |
| **Checks and saves** (#149) | | |
| FR-CHAR-19 | The sheet reads entities' optional `statBlock.abilities {str, dex, con, int, wis, cha}` (int 1–30) and `statBlock.saveProficiencies` (subset of the six) ([FR-ENT-23](entities.md#6-functional-requirements)). Abilities absent → the block shows "No ability scores" and no check / save buttons. | #149 |
| FR-CHAR-20 | Derived, never stored, pure in `@shared/entities` ([FR-ENT-24](entities.md#6-functional-requirements)): modifier = floor((score − 10) / 2); proficiency bonus = 2 + floor((level − 1) / 4) (#154); check bonus = modifier; save bonus = modifier + (proficient ? proficiency bonus : 0). Initiative bonus and the attack stay stored (FR-CHAR-01), even if they disagree with DEX (#154). | [ADR-0032](../architecture/adr/0032-ability-derivation.md) |
| FR-CHAR-21 | `char.roll` with `kind: check \| save` needs `ability` (`str` … `cha`; missing, or given for initiative / attack → `invalid`). One roll `1d20 + bonus` (`1d20` when 0, `1d20-1` when negative) via `characterRolls(statBlock, kind, ability)`; category `ability-check` / `saving-throw`; label "Dexterity check" / "Dexterity save"; one `roll` entry; `CharacterRolled` with `ability`. Mode per FR-CHAR-06 ([FR-DICE-04/05](dice-roll-log.md#6-functional-requirements)); manual = 1 entry. Public per FR-CHAR-17: a DM roll follows the existing "Ability check" / "Saving throw" tickboxes ([FR-DICE-12](dice-roll-log.md#6-functional-requirements)). Line by the `roll` kind (FR-DICE-20): "Mira — Dexterity save: 14 + 2 = 16", natural 20 / 1 marked. | #149; no dice-roll-log change |
| FR-CHAR-22 | **Abilities block** below the stat row: six cells (3 × 2) with abbreviation, score, signed modifier, a **Check** button (signed check bonus) and a **Save** button (signed save bonus; a dot marks proficiency). Header shows "Prof +2". Each button is a shared roll control (FR-DICE-24) over one expression: Shift / Ctrl modes, physical-dice popover, DM public toggle: one switch per category (check, save) in the block header, preset from the game-log setting and applied to the next roll of that category (12 per-button switches do not fit a 320 px window). | |
| FR-CHAR-23 | In combat, checks and saves still go through `char.roll`: combat-tracker's route claims only `initiative` and `attack` ([FR-CBT-45](combat-tracker.md#6-functional-requirements)). No card, no combat state. | |
| **Playtest pass** (#171) | | |
| FR-CHAR-24 | **Hidden routed button** (P4; extends FR-CHAR-16): a route that claims `(store, characterId, kind)` may answer `hidden`. The sheet then renders no button for that kind (nor its DM public switch) and, for Initiative, a muted "Initiative set" in its place (`char-sheet-init-locked`); the "In combat" badge stays. Combat answers `hidden` for `initiative` only while the started encounter's `round ≥ 1` **and** the PC's combatant already has initiative (#172, [FR-CBT-46](combat-tracker.md#6-functional-requirements)); a PC without initiative (restored, later added mid-fight) keeps the routed button and rolls once. Re-evaluated on every store change, so the button goes ≤ 1 s after "Start round 1" (or after the PC's roll commits) and returns after End. Unclaimed characters keep a plain `char.roll` Initiative button after round 1 (decided #172, OQ-CHAR-19): one not in the started encounter, a PC hidden from its owner (#141: the player's store has no combatant), a removed PC. | P4 |
| FR-CHAR-25 | **Roll hints** (P1): the "Shift: advantage · Ctrl: disadvantage" hint on Initiative, Attack, Check and Save (and the "Proficient" mark) is the shared Tooltip ([FR-SHELL-30/31](play-shell.md#6-functional-requirements)), not a native `title`: it opens after the shared delay and never while that button's physical-dice popover is open. | P1 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense; HP state via semantic tokens (`hp.*` placeholders), no custom styling.

| Kind | Clients | Default open | Default geometry | Launcher |
|---|---|---|---|---|
| `char.sheet` | DM, player | player **yes**; DM no | player top-right below the top bar (clear of tool rail, `dice.log` bottom-left, toasts); DM right, below `camp.players`; 320×440, min 280×320 | "Sheet" (player), "Sheets" (DM) |

- **Layout** (one Card): header = portrait Avatar, name, "Level 1 Fighter", "In combat" Badge (FR-CHAR-16; only while combat claims a kind), picker Select. Stat row = AC, HP `12 / 12` (+ "Down" Badge), Speed `30 ft`, Init `+2` with **Initiative** Button. ~~Attack row = "Shortsword +4 · 1d6+2 piercing" with **Attack** Button; hidden if no attack.~~ *(N4: moved to the Actions tab, FR-CHARX-44.)* **Abilities block** (FR-CHAR-22): "Prof +2" in the header; cells e.g. "DEX 14 (+2) · Check +2 · Save +2", proficient saves dotted. HP row = number Input + Damage / Heal Buttons + caption. Default size unchanged; the body scrolls.
- **Roll buttons** use dice-roll-log's shared roll control (roll mode keys / toggle, physical-dice popover over N expressions, DM public override) with an `onRoll` callback ([FR-DICE-24](dice-roll-log.md#6-functional-requirements)). Results appear in the game log (`dice.log`), not on the sheet.
- **DM view:** any character (picker shows owner name); DM public override on rolls. **Player view:** own characters only; others never listed.
- **States:** loading = skeleton until first snapshot; empty per FR-CHAR-04; reconnecting = last values + shell banner, controls disabled; error = Toast (FR-CHAR-12).
- **Test IDs:** `char-sheet` (+ `data-record-id` = character id), `char-sheet-picker`, `-name`, `-portrait`, `-level`, `-ac`, `-hp`, `-down`, `-speed`, `-combat`, `-init`, `-roll-init`, ~~`-attack`, `-roll-attack`, `-public-attack`~~ (retired by N4; Actions tab IDs per CHARX §7), `-prof`, `-ability` (+ `data-value` = `str` … `cha`), `-ability-score`, `-ability-mod`, `-roll-check`, `-roll-save`, `-save-prof` (each + `data-value`; `-save-prof` also `data-proficient`), `-public-init`, `-public-check`, `-public-save` (DM), `-abilities-empty`, `-hp-input`, `-hp-damage`, `-hp-heal`, `-empty`, `-init-locked` (#171) (all prefixed `char-sheet`). Hints: play-shell's `ui-tooltip`.
- **Later:** open from a token double-click ([FR-MAP-29](scenes-map.md#6-functional-requirements)); one window per character; a gem counter block in the header ([gems](post-mvp/gems.md), #140; no MVP UI or field).

## 8. Data model

No new entity, table or migration; the ability fields are entities' (JSON leaf, FR-ENT-23). Reads and writes (via FR-CHAR-10/13) the [entities](entities.md#8-data-model) `entity` row:

| Entity | Field | Type | Sheet use |
|---|---|---|---|
| Entity (kind `character`) | name, portraitAssetId, ownerPlayerId | text, asset ref, ID → Player | Header; eligibility (FR-CHAR-02) |
| | statBlock.level, className | int 1–20, text 0–40 | "Level N Class"; combat's difficulty |
| | statBlock.ac, hpMax, initBonus | int | Display; initiative roll |
| | statBlock.speed *(optional)* | int 0–200, multiple of 5 (entities, FR-ENT-21) | Display only (FR-CHAR-18) |
| | statBlock.abilities, saveProficiencies *(optional)* | `{str … cha}` int 1–30; ability[] (entities, FR-ENT-23) | Abilities block; check / save rolls (FR-CHAR-19–22) |
| | statBlock.attacks[0] `{name, toHit, damage, damageType?}` | JSON leaf (entities) | Attack row and roll |
| | hpCurrent | int 0…hpMax | Display; written only per FR-CHAR-13 |

- **Relations:** Player 1—* character (entities). Rolls and entries are dice-roll-log's rows; the `CharacterRolled` event-log row links an action's rolls (no `actionId` on dice rows, I18).
- **Derived values** (`@shared/character-sheet`, never stored): signed bonuses, "Down" (`hpCurrent = 0`), roll specs (`characterRolls`); from `@shared/entities`: modifiers, proficiency bonus, check / save bonuses (FR-CHAR-20).
- **Persisted runtime state:** `hpCurrent`. Picker selection: client memory only.
- **Design for later** (#140): gems = an optional additive character field (entities owns the schema); rerolls and modified dice are dice-roll-log's / combat's. Nothing here blocks them.

## 9. API & events

**REST:** none (character create/update: `entities` routes, DM; no UI in MVP).

**WS intents** (default deny, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md); neither optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `char.roll {characterId, kind, ability?, mode?, manual?, public?}` | DM, player | Strict zod; FR-CHAR-05–09, -17, -21 | `{rollIds, entryId}` |
| `char.adjustHp {characterId, delta}` | DM, player | Strict zod; FR-CHAR-09, -10 | `{hpBefore, hpAfter}` |

**Record types:** none new. `entity` (entities, FR-ENT-15); `game-log-entry` (dice-roll-log, window per [ADR-0029](../architecture/adr/0029-windowed-record-types.md)).

**Domain events** (WS: generic record changes, `cause.name` = event type)

| Event | Payload | Changes → visibility rule | Logged | Undoable |
|---|---|---|---|---|
| `CharacterHpAdjusted` | `{entityId, delta, hpBefore, hpAfter}` | `entity` upsert → DM + owner full; other players a redacted upsert without HP, `down` = `hpCurrent = 0` (FR-ENT-15, #154). The otherwise unchanged redacted upsert is a timing tell "Mira's HP changed": accepted | yes | no (not a combat log entry) |
| `CharacterRolled` | `{characterId, kind, mode, manual, attackName?, damageType?, ability?, rollIds, entryId}` (`kind` gains `check`, `save`) | `game-log-entry` upsert from `gameLog.append` → entry rule (FR-DICE-13/15): player rolls public; DM rolls per category / override | yes | no (#67) |

- **Internal:** `characters.adjustHp` (FR-CHAR-13); `characterRolls` (FR-CHAR-05). Uses `dice.evaluate`, `gameLog.append`.
- **Client registry:** roll routes (FR-CHAR-16). **Listeners, hooks, signals:** none. No listener creates damage cards ([ADR-0027](../architecture/adr/0027-notification-creation.md)).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| View sheet | any character | own (full); others never shown | FR-ENT-15 filter |
| Roll from sheet | any character; public override | own; always public | FR-CHAR-09, -17 (in combat: combat-tracker's checks) |
| Adjust current HP | any character | own | FR-CHAR-09 |
| Edit other basics, max HP, owner | `PUT /api/entities/:id` only, no UI | ✗ | entities (DM credential) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled, last values shown; in-flight intent rejects → Toast (FR-CHAR-12), the server may still have committed it. Reconnect snapshot restores true HP and the log window; selection kept if still eligible.
- **DM disconnect / reconnect:** same; nothing server-side waits on the DM. Players keep rolling and adjusting.
- **Server crash mid-action:** one transaction per command: an attack's rolls, entries and event all exist or none; HP change + event-log entry together. After restart sheets show committed HP.
- **Initiative races a set value (#171, #172):** the PC got initiative meanwhile (the DM typed it, or a second tab rolled) → combat answers `conflict` ([FR-CBT-47](combat-tracker.md#6-functional-requirements)) → Toast (FR-CHAR-12); the button is gone with the `combatant` upsert. Reconnect / snapshot: hidden state re-derived from the store, nothing stored.
- **Combat race:** encounter starts between click and commit → `char.roll` commits a plain roll, no card; the DM sees it in the log. Checks and saves never route to combat (FR-CHAR-23). Store says "in combat" but the encounter ended → combat's `conflict` / `not_found` → Toast; the next click routes to `char.roll`. `char.roll` never reads combat state.
- **Concurrent edits:** deltas, not absolute values: a sheet heal and combat damage at once both apply in commit order, each clamped. Two tabs of one player: each intent applies once. Stat block edited between click and commit: rolled with values at commit (scores removed meanwhile → `conflict`, Toast). `hpMax` lowered: entities clamps (FR-ENT-11). Owner change or campaign switch: FR-CHAR-04.
- **Character data (#154):** characters without speed, scores or saves (no backfill) show "Speed —" and "No ability scores" until a fixture reload or a DM `PUT /api/entities/:id`. No character edit UI in MVP; full PC / NPC editing and player-filled sheets are design-for-later ([levelling](post-mvp/levelling.md)).
- **Undo interplay:** combat undo applies the inverse delta, clamped (I2), so it never erases a sheet heal. Sheet changes themselves aren't undoable; in combat the DM uses cards or direct HP (#139 P5).
- **Invalid / malicious input:** strict schemas (`expression`, `toHit`, `hp`, `bonus`, `kind: damage`, unknown `ability`, `ability` on initiative / attack, check / save without it → `invalid`); delta bounds; ownership per FR-CHAR-09; player `public` → `forbidden`; names rendered as text.

## 12. Performance & bandwidth

- No snapshot growth (characters already in it; log window per ADR-0029). `char.adjustHp`: one `entity` upsert ≤ 2 KB per connection. `char.roll`: ≤ 2 rolls, 1 entry. Human click rate; FR-CHAR-12 caps one in flight per control.
- Target: click → own sheet / game log updated ≤ 1 s over the tunnel; ≤ 50 ms commit → frame locally (SYNC §12).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:` DB, port 0; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs. Seeded `ctx.dice` (#137) in `bun test`; the running server uses real dice.

**Fixtures** (setups run as DM, FR-FIX-13; names per [fixtures-adapters §8](fixtures-adapters.md#8-data-model))

| Key | Kind | Requires | Contents | Owner | `session-sim` |
|---|---|---|---|---|---|
| `char-mira` | setup | `player-1` | per [entities §13](entities.md#13-test-plan): L1 fighter, AC 16, HP 12/12, init +2, shortsword +4 / 1d6+2 piercing; STR 14 DEX 14 CON 14 INT 10 WIS 12 CHA 10, saves STR, CON | entities | yes (already) |
| `char-thorn` | setup | `player-2` | per entities §13: L1 rogue, AC 14, HP 10/10, init +3, dagger +5 / 1d4+3; STR 8 DEX 16 CON 14 INT 12 WIS 10 CHA 13, saves DEX, INT | entities | no |
| `char-pip` *(new)* | setup | `player-1` | "Pip", owner `player-1`, L1 wizard, AC 12, HP 8/8, init +2, **no attack, no speed, no ability scores** | character-sheet | no |
| `char-wounds` *(new)* | setup | `char-thorn` | `char.adjustHp` Thorn −7 → 3/10 | character-sheet | no |

**Bundle `character-sheet`** = `base` + `player-2` + `char-mira` + `char-thorn` + `char-pip` + `char-wounds`. Game-log settings at defaults (all hidden, #139 P23). No scenes.

| Level | What | Fixtures |
|---|---|---|
| Unit | `characterRolls` per kind (signs, `1d20-1`, damage `1d4-1`; check / save `1d20+2`, `1d20`, `1d20-1`); modifier (1 → −5, 10, 11 → 0, 30 → +10); proficiency bonus by level (1, 4 → +2; 5 → +3; 17, 20 → +6); save bonus with / without proficiency; mode only on d20; manual count; clamp math; eligibility + sort; formatting (incl. speed "30 ft" / "—"); in-flight lock; roll routing (empty registry → `char.roll`; test route claims → its intent + badge; a route claiming only initiative leaves check / save to `char.roll`). **Playtest (#171):** `FR-CHAR-24` test route answering `hidden` → no Initiative button, "Initiative set", badge kept, public switch gone; flip back → button returns; unclaimed characters keep their button (not in the encounter; PC hidden from its owner, no combatant in the store; removed PC); with combat's route: round ≥ 1 and initiative set → hidden, round ≥ 1 and initiative null → routed button shown. `FR-CHAR-25`: roll buttons carry no `title`; hint is a `Tooltip` | In-code |
| Integration (#149) | Check / save: category `ability-check` / `saving-throw`, label, bonus from stored scores, one roll + entry + `CharacterRolled {ability}`. DM save hidden with defaults, public after `dice.setCategoryPublic saving-throw`; player save public. Pip → `conflict` "No ability scores". `ability` missing / on attack / unknown → `invalid` | `character-sheet` |
| Integration | `char.roll`: rolls, categories, labels; attack = 2 rolls + 1 entry + one `CharacterRolled` in one tx, dice failure → none. Public: player → public; DM → category, override both ways; player `public` → `forbidden`. Authorize matrix (DM / owner / other player / monster / other campaign / no attack). Strict schema rejects `expression`, `toHit`, `kind: damage`. `char.adjustHp`: clamps, no-op → no event, event + log row. `characters.adjustHp` rolls back with its caller's tx. **Leak scan:** `player-2` frames never contain Mira's `hpCurrent`, `hpMax`, `ac` or stat block in `entity` records (roll lines excluded, #73); restart → identical snapshots | `character-sheet` |
| E2E (thin) | `player-1`: Damage 3 → DM's sheet shows 9/12; Actions → Shortsword **Attack + damage** (`charx-roll-attack-damage`, N7) → one line (to-hit + damage) in `dice.log` for DM and `player-2` (was the Main tab's `char-sheet-roll-attack`, retired by N4) | `character-sheet` |

**Browser walkthrough** — needs dice-roll-log built. `bun run build`; `fixtures:reset-load character-sheet --profile verify`; `start --profile verify` (Herdr pane). Contexts A DM (`pw-dm`), B `player-1`, C `player-2`; C's WS frames logged via `page.on('websocket')`. In-combat routing is walked in combat-tracker §13. Teardown: stop, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, open Sheets | — | Picker: Mira (Player 1), Pip (Player 1), Thorn (Player 2). Thorn: 3 / 10, AC 14, Dagger +5 · 1d4+3 piercing |
| 2 | — | B, C open links | B: sheet open, Mira: Level 1 Fighter, AC 16, 12 / 12, Speed 30 ft, Init +2, Shortsword +4 · 1d6+2 piercing; "Prof +2"; STR 14 (+2) Save +4 dotted, CON Save +4 dotted, DEX Save +2, WIS Check +1; picker Mira, Pip only; no "In combat" badge. C: Thorn 3 / 10, DEX Save +5, no picker. C frames: no Mira `entity` stats or HP |
| 3 | — | B: Initiative; then Actions → Shortsword Shift+**Attack + damage** (N7; Main has no attack row, N4); Shift+DEX Save; Ctrl+STR Check | Log (A, B, C): initiative d20+2; one attack line: to-hit with advantage (two d20, higher kept) +4 and damage 1d6+2; "Mira — Dexterity save (adv): … + 2"; "Mira — Strength check (dis): … + 2"; totals in range |
| 4 | — | B: Physical dice on (game log), Actions → Attack + damage, enter two values; WIS Save, enter 15 | One line, both rolls marked manual with the entered values; "Mira — Wisdom save: 15 + 1 = 16", physical |
| 5 | — | B: pick Pip | Actions: "No attacks"; "Speed —"; "No ability scores", no Check / Save buttons; Initiative works |
| 6 | Thorn: Initiative and WIS Save (no override); gear → tick "Saving throw"; Thorn: DEX Save | — | First two: A sees the lines; B, C see nothing (categories hidden). Then B, C see "Thorn — Dexterity save: … + 5" |
| 7 | — | B on Mira: Damage 5; Heal 20; Damage 15 | A and B ≤ 1 s: 7 / 12, 12 / 12 (clamped), 0 / 12 + "Down". C frames: no Mira HP; last redacted Mira upsert has `down: true` |
| 8 | Thorn: Heal 2 | — | C shows 5 / 10 ≤ 1 s |
| 9 | — | B: double-click Initiative | Exactly one new log line |
| 10 | Kill server, restart | B: controls disabled during outage | Banner; after rejoin Mira 0 / 12, Thorn 5 / 10, log intact; no console errors throughout |
| 11 | — | B: Physical dice on; `browser_evaluate` on Initiative: dispatch `pointerenter` / `pointermove`, sample `[data-testid=ui-tooltip]` at 200 ms and 600 ms via `setTimeout`, return the booleans; then click it, keep the pointer on it 2 s, sample again; Esc, sample again | `false` at 200 ms, `true` at 600 ms; after the click the popover is open and the hint is `false` while hovering; after Esc (focus back on the button) still `false` until the pointer leaves and returns (FR-CHAR-25, FR-SHELL-31). Exact timing is the fake-timer unit test's job |

In-combat hiding (FR-CHAR-24) is walked in [combat-tracker §13](combat-tracker.md#13-test-plan) step 4.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0004, 0009, 0012, 0016, 0021, 0024, 0025, [0027](../architecture/adr/0027-notification-creation.md), [0029](../architecture/adr/0029-windowed-record-types.md); #53, #73, #92, #100, #106, #134–#140 | Ownership, PC HP on character, stored basics, events, sync, visibility, windows, no-listener cards, log window | accepted |
| [play-shell](play-shell.md), [live-sync](live-sync.md), [fixtures-adapters](fixtures-adapters.md) | Window registry, disabled-when-not-live; intents, rejects; bundles; FIX §8 rows `char-pip`, `char-wounds`, `character-sheet` (integrator, at merge) | complete |
| [dice-roll-log](dice-roll-log.md) | `ctx.dice`, `dice.evaluate(env, …)`, `gameLog.append(env, …)` with `public` override, kind `roll`, manual entry, shared roll control with `onRoll` + N expressions (FR-DICE-24), `dice.log`; categories `ability-check`, `saving-throw` | complete |
| [combat-tracker](combat-tracker.md) | Registers roll routes (`cbt.rollInitiative`, `cbt.attack` only, FR-CBT-45); uses `characters.adjustHp`, `characterRolls` | complete |
| [entities](entities.md) | `character` kind, `hpCurrent`, FR-ENT-15 (+ `down`), fixtures `char-mira`, `char-thorn`; optional `statBlock.speed`, `abilities`, `saveProficiencies` and the helpers ([FR-ENT-21/23/24](entities.md#6-functional-requirements)); [ADR-0032](../architecture/adr/0032-ability-derivation.md) | complete |

**Shared changes needed** (AGENTS §9.9; gate §4):
- `src/shared/events/` — `character-sheet.ts` (`CharacterHpAdjusted`, `CharacterRolled`) + its line in `index.ts`. `src/server/db/`: none. Record types: none.
- Existing append-only registries: `char.sheet` in `src/client/{dm,player}/windows.ts`; `characterSheet` in `src/server/features/index.ts`; `character-sheet` in `fixtures/bundles/index.ts`.
- New append-only registry (created empty by this build; on the AGENTS §9.9 list): `src/client/common/features/character-sheet/roll-routes.ts`; combat-tracker adds one line (OQ-CHAR-13).
- Docs (integrator): protocol rows for `char.roll`, `char.adjustHp`, both events; FIX §8 rows.
- **Feedback pass:** none. Speed is entities' field (FR-ENT-21); the sheet only reads it. No schema, event, protocol or registry change; `char-pip` stays without speed.
- **#149 (checks and saves):**
  - `src/shared/events/character-sheet.ts`: `CharacterRolled` gains `ability?`; its `kind` enum gains `check`, `save`.
  - `@shared/character-sheet` (feature-owned): `char.roll` zod (`kind`, `ability`), `characterRolls(statBlock, kind, ability?)`. `CharRollKind` (roll-route contract) gains `check`, `save`; combat's route must claim only `initiative` / `attack` (today it treats every non-initiative kind as an attack).
  - DB, record types, visibility: none. dice-roll-log: none (categories `ability-check`, `saving-throw` and their tickboxes exist).
  - Docs: protocol §21 (`char.roll`), §22 (`CharacterRolled`); FIX §8 `char-mira`, `char-thorn` scores (entities' rows), `char-pip` "no ability scores".
- **Existing common files this build edits** (feature-owned since #154, AGENTS §9.9): `src/client/common/features/character-sheet/{CharacterSheet.tsx, routing.ts, roll-routes.ts}` (abilities block, `CharRollKind` + `check` / `save`, badge rule). Must merge together with combat's route fix (FR-CBT-45).
- **Sprint 2 phase 1 (P2b):** see [character-sheet-full §14](character-sheet-full.md#shared-changes) (N4, N7, picker memory). This spec only marks the amended rows; the `char-sheet-attack` / `-roll-attack` / `-public-attack` IDs are retired, so `e2e/character-sheet.e2e.ts` and `e2e/combat-tracker.e2e.ts` move to the Actions tab IDs in the same build.
- **Playtest pass (#171):** no schema, event, protocol or record change. Feature-owned: the roll-route contract in `routing.ts` / `roll-routes.ts` gains an optional `hidden` answer (combat's line uses it, [FR-CBT-46](combat-tracker.md#6-functional-requirements): this change merges first or in the same build); `CharacterSheet.tsx` renders "Initiative set" and moves its `title` hints to the shared Tooltip (play-shell's shared `overlays.tsx` change lands first, FR-SHELL-30). Docs: protocol §26 roll-routes row ("may answer `hidden`").

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-CHAR-01, 02, 04~~ | ~~Basics stored? PC HP source? Players see each other's sheets?~~ | Decided: stored (#106, ADR-0012); the character (#92); no (ADR-0024), party HP no in MVP (#139 P7) | — | — |
| ~~OQ-CHAR-03~~ | ~~Player edits to own sheet~~ | Decided (#139 P5): current HP only (damage / heal), owner + DM, not undoable | — | combat-tracker |
| ~~OQ-CHAR-05, 11, 12~~ | ~~Ability scores; HP changes in the game log; DM edits basics in UI~~ | Decided (#139 P18–P20): ~~no~~ → **ability scores + save proficiencies in MVP (#149)**; no (event log keeps it); no (fixtures + `PUT /api/entities`) | — | entities, dice-roll-log |
| ~~OQ-CHAR-06~~ | ~~Roll contract with dice-roll-log~~ | Decided (I1): `dice.evaluate` + `gameLog.append` in `char.roll`'s transaction; own event `CharacterRolled` | — | dice-roll-log |
| ~~OQ-CHAR-07, 10~~ | ~~Combat: PC HP writes, player attacks, sheet initiative~~ | Decided (#134, #135): combat writes PC HP only via `characters.adjustHp`; in a running encounter the sheet sends `cbt.attack` / `cbt.rollInitiative` (card in the same tx, no target; DM picks); else `char.roll`. No listener, no `targetTokenId` | — | combat-tracker |
| ~~OQ-CHAR-08~~ | ~~Undo after a sheet HP change~~ | Decided (I2): inverse delta, clamped | — | combat-tracker |
| ~~OQ-CHAR-09~~ | ~~DM rolls for a PC: public?~~ | Decided (#139 P1): category setting + per-roll override (P22), like any DM roll | — | dice-roll-log |
| ~~OQ-CHAR-13~~ | ~~How combat takes over the sheet buttons~~ | Decided (integrator): new client registry `roll-routes.ts`, CHAR creates it empty, combat adds a line; on the AGENTS §9.9 append-only list | — | combat-tracker |
| ~~OQ-CHAR-14~~ | ~~Shared roll control~~ | Decided ([FR-DICE-24](dice-roll-log.md#6-functional-requirements)): dice-roll-log's control, `expressions[]`, `onRoll({mode, manual?, public?})`; the caller sends its own intent | — | — |
| ~~OQ-CHAR-16, 17, 18~~ | ~~Store scores or modifiers; proficiency bonus; initiative vs DEX (#149)~~ | **Decided (#154):** scores stored, modifiers derived ([ADR-0032](../architecture/adr/0032-ability-derivation.md)); proficiency bonus derived from level / CR; initiative bonus stays stored | — | entities, combat-tracker |
| ~~OQ-CHAR-19~~ | ~~Initiative buttons still visible after round 1 (P4: "hide every roll-initiative button"). Combat's route doesn't claim, so a plain `char.roll` Initiative button stays for: (a) a character **not in** the started encounter; (b) a PC in the encounter but **hidden from its owner** (#141: the player's store has no combatant); (c) a **removed** PC~~ | **Decided (#172):** keep them: (a) characters not in the encounter, (b) a PC hidden from its owner (#141), (c) a removed PC keep a plain `char.roll` Initiative button (FR-CHAR-24) | — | combat-tracker |
| OQ-CHAR-15 | Show movement used this turn on the sheet? (F3) | **No: the drag overlay and the DM's initiative row show it; the sheet stays basics** / "Moved 20 / 30 ft" under Speed while in combat | no · owner: spec-feedback | combat-tracker |

## 16. Out of scope

- See §4. Token double-click → sheet, several sheet windows, gem counters (§7 later). Stats UI → [stats](post-mvp/stats.md).
