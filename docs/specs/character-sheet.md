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

- MVP sheet: just enough for a fight ([ADR-0014](../architecture/adr/0014-mvp-scope.md), #32). A **view and controls** over the `character` entity that [entities](entities.md) owns. No new table, field or record type.
- Player sees their own character; click-to-roll initiative, attack (to-hit + damage, one click) and damage through [dice-roll-log](dice-roll-log.md). Owner and DM adjust current HP.
- Stored values, no derivation ([ADR-0012](../architecture/adr/0012-character-derived-values.md), #106). Characters come from fixtures (#100). Full 5e sheet → [character-sheet-full](post-mvp/character-sheet-full.md); nothing here blocks it.

## 2. Scope

- Window `char.sheet` (both clients): name, portrait, level + class, AC, HP current / max, initiative bonus, the one weapon attack.
- Click-to-roll: initiative, attack (to-hit + damage), damage. Advantage/disadvantage (Shift / Ctrl or toggle) and manual entry on every roll, per [dice-roll-log](dice-roll-log.md).
- Adjust current HP: damage / heal by an amount; owner and DM *(proposed, OQ-CHAR-03)*.
- Character picker when a client may view several characters *(proposed)*.
- Internal server API for HP writes, used by [combat-tracker](combat-tracker.md) *(proposed, OQ-CHAR-07)*. Fixtures + bundle `character-sheet`.

## 3. Goals

- A player runs their part of a fight from one window: sees AC / HP, rolls initiative and attacks with the right bonuses, no typing.
- The server, not the client, decides what is rolled: bonuses and dice come from the stored character.
- HP on the sheet is always the true HP: combat damage shows ≤ 1 s, survives a crash (PC HP lives on the character, [ADR-0009](../architecture/adr/0009-entity-content-model.md), #92).
- No other player learns a character's numbers ([ADR-0024](../architecture/adr/0024-definition-visibility.md)).

## 4. Non-goals

- Spells, saves, skills, features, inventory, currency, proficiencies, hit dice, notes, ability scores (OQ-CHAR-05); roll from any number (tier A) → [character-sheet-full](post-mvp/character-sheet-full.md), [feature tiers](../feature-tiers.md#3-character-sheet-and-dice).
- Temp HP, death saves, conditions → [combat-extras](post-mvp/combat-extras.md) (tier A).
- Character creation / builder, levelling, editing basics in the UI (OQ-CHAR-12) → [levelling](post-mvp/levelling.md); import via once-off scripts later.
- Damage cards, targets, hit/miss, initiative order → [combat-tracker](combat-tracker.md), [notifications](notifications.md). Dice notation, game log → [dice-roll-log](dice-roll-log.md).
- Party HP / portrait strip for players (tier A/B) → OQ-ENT-15, [play-shell](play-shell.md).

## 5. User stories

**DM**
- As the DM, I want any PC's sheet one click away, so that I can check AC and HP mid-fight.
- As the DM, I want to heal or damage a PC from the sheet, so that out-of-combat changes (potion, trap) don't need a combat.

**Player**
- As a player, I want to click Attack (Shift for advantage) and have to-hit and damage rolled with my bonuses, so that I stop reading numbers out loud.
- As a player, I want my HP to change on my sheet the moment the DM applies damage, and to adjust it myself when I drink a potion.
- As a player, I want to enter physical dice results instead, so that I can still roll real dice.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-CHAR-01 | The sheet reads only the `entity` record of kind `character` ([entities §8](entities.md#8-data-model)): `name`, `portraitAssetId`, `statBlock.{level, className, ac, hpMax, initBonus, attacks[0]}`, `hpCurrent`. No new field, table or record type. | ADR-0012 |
| FR-CHAR-02 | Eligible characters: player = full `entity` records of kind `character` with `ownerPlayerId = you.playerId`; DM = every character of the campaign. Picker shown iff > 1 eligible; sorted by name (case-insensitive), then id; default the first. Selection is client memory only. | |
| FR-CHAR-03 | Shows name, portrait (asset `thumb`, else initials), "Level N Class" (class omitted if empty), AC, HP `current / max`, initiative bonus signed (`+2`, `−1`), attack row `name  +toHit  ·  damage damageType`. `hpCurrent = 0` → "Down" badge. Any committed change to the record shows ≤ 1 s, whatever caused it (sheet, combat, entities edit). | |
| FR-CHAR-04 | Empty states: player with no eligible character "No character yet — ask your DM"; DM with none "No characters in this campaign". If the selected character stops being eligible (owner change, campaign switch), select the first eligible, else the empty state. | |
| FR-CHAR-05 | Intent `char.roll {characterId, kind: initiative \| attack \| damage, mode?: normal \| advantage \| disadvantage, manual?: ManualEntry[]}`, strict (no expression or bonus field). The server builds each roll from the stored stat block with the pure `characterRolls(statBlock, kind)` in `@shared/character-sheet`: initiative = d20 + `initBonus` (category initiative); attack = d20 + `toHit` (attack) **then** the attack's `damage` (damage), two linked rolls, one action (#53); damage = `damage` alone. | combat-tracker may reuse the fn |
| FR-CHAR-06 | `mode` applies to d20 rolls only (initiative, attack to-hit); ignored for damage. Default `normal`. Adv/dis notation: dice-roll-log. | Tier S adv/dis |
| FR-CHAR-07 | `manual`: one entry per roll of the action (1, or 2 for attack), shape owned by dice-roll-log (OQ-DICE-07); wrong count → `invalid`. The rolls are logged as manual. | #43 |
| FR-CHAR-08 | Each roll goes through dice-roll-log's internal roll API in the command's transaction (OQ-CHAR-06) with context: `characterId`, actor name, label ("Initiative", "Shortsword attack", "Shortsword damage"), category, weapon name, damage type, a link id shared by to-hit and damage, roller from `ctx`. All rolls of one action commit together or not at all. Result `{rollIds}`. | Stats capture #54 |
| FR-CHAR-09 | Authorize (`char.roll`, `char.adjustHp`): DM → character in `ctx.campaignId`. Player → `ownerPlayerId = ctx.playerId`. Unknown id, monster, other campaign → `not_found`; another player's character → `forbidden`. `attack` / `damage` with no attack → `conflict` "No weapon attack". Failure: no change, event or log entry. | ADR-0004 |
| FR-CHAR-10 | Intent `char.adjustHp {characterId, delta}`: int −999…999, ≠ 0. `hpAfter = clamp(hpBefore + delta, 0, hpMax)`. Row + event-log entry in one transaction, then `CharacterHpAdjusted`. `hpAfter = hpBefore` (e.g. heal at full) → success, no change, no event, no log entry. Result `{hpBefore, hpAfter}`. Not optimistic. | |
| FR-CHAR-11 | HP control: integer input 1–999 + **Damage** (delta −n) and **Heal** (+n) buttons. Out-of-range input disables both. | Shieldmaiden-style |
| FR-CHAR-12 | Roll and HP controls are disabled while the connection is not `live` ([FR-SHELL-05](play-shell.md#6-functional-requirements)) and while their own intent is in flight (until `ack` / `reject`): a double click sends one intent. `reject` → Toast with its message. In-flight intent lost to a disconnect (FR-SYNC-05: never resent) → Toast "Connection lost — check the game log / HP before trying again". | No double rolls |
| FR-CHAR-13 | Internal server API `characters.adjustHp(ctx, tx, characterId, delta) → {hpBefore, hpAfter, change}` applies FR-CHAR-10's clamp inside the caller's transaction and returns the `entity` record change for the caller's event. Apart from entities' create / update clamp ([FR-ENT-10/11](entities.md#6-functional-requirements)), it is the only writer of `hpCurrent`. | OQ-CHAR-07, OQ-ENT-08 |
| FR-CHAR-14 | Visibility: no new record type. Character data travels as `entity` under [FR-ENT-15](entities.md#6-functional-requirements) (DM and owner full; other players redacted, no stats or HP). Rolls follow dice-roll-log's rules (player rolls always public, #73). | |
| FR-CHAR-15 | Window `char.sheet` registered in both client registries per §7. | ADR-0025 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense; HP state via semantic tokens (`hp.*` placeholders), no custom styling.

| Kind | Clients | Default open | Default geometry | Launcher |
|---|---|---|---|---|
| `char.sheet` | DM, player | player **yes**; DM no | player top-left; DM right, below `camp.players`; 320×460, min 280×320 | "Sheet" (player), "Sheets" (DM) |

- **Layout** (one Card): header = portrait Avatar, name, "Level 1 Fighter", picker Select (if FR-CHAR-02). Stat row = AC, HP `12 / 12` (+ "Down" Badge), Init `+2` with a roll Button. Attack row = "Shortsword +4 · 1d6+2 piercing" with **Attack** and **Damage** Buttons; hidden if no attack. HP row = number Input + Damage / Heal Buttons.
- **Roll buttons** use dice-roll-log's shared roll control (Shift = advantage, Ctrl = disadvantage, toggle, manual entry) (OQ-CHAR-06). Results appear in the game log (`dice.log`), not on the sheet.
- **DM view:** any character (picker shows owner name). **Player view:** own characters only; others never listed.
- **States:** loading = skeleton until first snapshot; empty per FR-CHAR-04; reconnecting = last values + shell banner, controls disabled; error = Toast (FR-CHAR-12).
- **Test IDs:** `char-sheet` (+ `data-record-id` = character id), `char-sheet-picker`, `char-sheet-name`, `char-sheet-portrait`, `char-sheet-level`, `char-sheet-ac`, `char-sheet-hp`, `char-sheet-down`, `char-sheet-init`, `char-sheet-roll-init`, `char-sheet-attack`, `char-sheet-roll-attack`, `char-sheet-roll-damage`, `char-sheet-hp-input`, `char-sheet-hp-damage`, `char-sheet-hp-heal`, `char-sheet-empty`.
- **Later:** open a sheet from a token double-click ([FR-MAP-29](scenes-map.md#6-functional-requirements) registry); one window per character (`instance` = character id).

## 8. Data model

No new entity, field or migration. Reads and writes (via FR-CHAR-10/13) the [entities](entities.md#8-data-model) `entity` row:

| Entity | Field | Type | Sheet use |
|---|---|---|---|
| Entity (kind `character`) | name, portraitAssetId, ownerPlayerId | text, asset ref, ID → Player | Header; eligibility (FR-CHAR-02) |
| | statBlock.level, className | int 1–20, text 0–40 | "Level N Class"; level feeds combat-tracker's difficulty |
| | statBlock.ac, hpMax, initBonus | int | Display; init roll |
| | statBlock.attacks[0] `{name, toHit, damage, damageType?}` | JSON leaf (entities) | Attack row; attack / damage rolls |
| | hpCurrent | int 0…hpMax | Display; written only per FR-CHAR-13 |

- **Relations:** Player 1—* character (entities); rolls reference the character by id in their context (dice-roll-log).
- **Derived values** (client, `@shared/character-sheet`, never stored): signed bonuses, "Down" (`hpCurrent = 0`), roll expressions (`characterRolls`).
- **Persisted runtime state:** `hpCurrent`. Picker selection: client memory only.

## 9. API & events

**REST:** none (character create/update: `entities` routes, DM; no UI in MVP).

**WS intents** (default deny, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md); neither optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `char.roll {characterId, kind, mode?, manual?}` | DM, player | Strict zod; FR-CHAR-05–09 | `{rollIds}` |
| `char.adjustHp {characterId, delta}` | DM, player | Strict zod; FR-CHAR-09, FR-CHAR-10 | `{hpBefore, hpAfter}` |

**Record types:** none new. `entity` (entities) — visibility [FR-ENT-15](entities.md#6-functional-requirements). Roll / game-log records (dice-roll-log) — its rule.

**Domain events** (WS: generic record changes, `cause.name` = event type)

| Event | Payload | Changes → visibility rule | Logged | Undoable |
|---|---|---|---|---|
| `CharacterHpAdjusted` | `{entityId, delta, hpBefore, hpAfter}` | `entity` upsert → DM + owner full; other players at most a redacted upsert without HP (FR-ENT-15) | yes | no (not a combat log entry, ADR-0016) |
| Roll event(s) from `char.roll` | dice-roll-log's | dice-roll-log's (player rolls public, #73; DM rolls for a PC: OQ-CHAR-09) | dice-roll-log | no (#67) |

- **Internal:** `characters.adjustHp` (FR-CHAR-13); `characterRolls` (FR-CHAR-05). **Listeners, hooks, signals:** none.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| View sheet | any character | own (full); others never shown | FR-ENT-15 filter |
| Roll from sheet | any character | own | FR-CHAR-09 |
| Adjust current HP | any character | own | FR-CHAR-09 |
| Edit other basics, max HP, owner | `PUT /api/entities/:id` only, no UI (OQ-CHAR-12) | ✗ | entities (DM credential) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled, last values shown; in-flight intent rejects → Toast (FR-CHAR-12), the server may still have committed it. Snapshot on reconnect restores the true HP and log; selection kept if still eligible.
- **DM disconnect / reconnect:** same; nothing server-side waits on the DM. Players keep rolling and adjusting.
- **Server crash mid-action:** one transaction per command: an attack's to-hit and damage both exist or neither; HP change + log entry together. After restart, sheets show committed HP (vision success criterion).
- **Concurrent edits:** deltas, not absolute values, so a sheet heal and combat damage at the same moment both apply in commit order, each clamped. Two tabs of one player: each intent applies once. Stat block edited between click and commit: the server rolls with values at commit; the log shows them. `hpMax` lowered: entities clamps (FR-ENT-11). Owner change or campaign switch: FR-CHAR-04.
- **Undo interplay:** a combat damage undo after a sheet heal must not erase the heal (OQ-CHAR-08, combat-tracker).
- **Invalid / malicious input:** strict schemas (a sent `expression`, `toHit` or `hp` → `invalid`); delta bounds; ownership per FR-CHAR-09; names rendered as text.

## 12. Performance & bandwidth

- No snapshot growth (characters already in it). `char.adjustHp`: one `entity` upsert ≤ 2 KB per connection. `char.roll`: ≤ 2 rolls; payloads per dice-roll-log. Human click rate only; FR-CHAR-12 caps one in flight per control.
- Target: click → own sheet / game log updated ≤ 1 s over the tunnel; ≤ 50 ms commit → frame locally (SYNC §12).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:` DB, port 0; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs. Seeded dice via dice-roll-log's seam (OQ-DICE-03) in `bun test` only.

**Fixtures** (setups run as DM, FR-FIX-13; names per [fixtures-adapters §8](fixtures-adapters.md#8-data-model))

| Key | Kind | Requires | Contents | Owner | `session-sim` |
|---|---|---|---|---|---|
| `char-mira` | setup | `player-1` | as [entities §13](entities.md#13-test-plan): L1 fighter, AC 16, HP 12/12, init +2, shortsword +4 / 1d6+2 piercing | entities | yes (already) |
| `char-thorn` | setup | `player-2` | as entities §13: L1 rogue, AC 14, HP 10/10, init +3, dagger +5 / 1d4+3 | entities | no |
| `char-pip` *(new)* | setup | `player-1` | "Pip", owner `player-1`, small, L1 wizard, AC 12, HP 8/8, init +2, **no attack** | character-sheet | no |
| `char-wounds` *(new)* | setup | `char-thorn` | `char.adjustHp` Thorn −7 → 3/10 | character-sheet | no |

**Bundle `character-sheet`** = `base` + `player-2` + `char-mira` + `char-thorn` + `char-pip` + `char-wounds`. No scenes needed (base layer shows its empty state).

| Level | What | Fixtures |
|---|---|---|
| Unit | `characterRolls` per kind (signs, negative bonus `1d20-1`, damage `1d4-1`); mode only on d20; manual count; clamp math; eligibility + sort; formatting; FR-CHAR-12 in-flight lock | In-code |
| Integration | `char.roll`: each kind's rolls, categories, context, link id; attack = 2 rolls in one tx, dice failure → neither. Authorize matrix (DM / owner / other player / monster / other campaign / no attack). Strict schema rejects `expression`, `toHit`. `char.adjustHp`: clamp at 0 and `hpMax`, no-op → no event, event + log entry, before/after. `characters.adjustHp` rolls back with its caller's tx. **Leak scan:** `player-2` frames never contain Mira's `hpCurrent`, `ac`, `1d6+2`; restart → identical snapshots | `character-sheet` |
| E2E (thin) | `player-1`: Damage 3 → DM's sheet shows 9/12; Attack → two linked lines in `dice.log` for DM and `player-2` | `character-sheet` |

**Browser walkthrough** — `bun run build`; `fixtures:reset-load character-sheet --profile verify`; `start --profile verify` (Herdr pane). Contexts A DM (`pw-dm`), B `player-1`, C `player-2`; C's WS frames logged via `page.on('websocket')`. Needs `dice.log` (dice-roll-log built). Teardown: stop, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, open Sheets | — | Picker: Mira (Player 1), Pip (Player 1), Thorn (Player 2). Thorn: 3 / 10, AC 14, Dagger +5 · 1d4+3 piercing |
| 2 | — | B, C open links | B: sheet open by default, Mira: Level 1 Fighter, AC 16, 12 / 12, Init +2, Shortsword +4 · 1d6+2 piercing; picker Mira, Pip only. C: Thorn 3 / 10, no picker. C frames: no Mira stats |
| 3 | — | B: Initiative; then Shift+Attack | Game log (A, B, C): initiative d20+2; attack with advantage (two d20, higher kept) +4 and linked damage 1d6+2, totals in range |
| 4 | — | B: Attack with manual entry (to-hit and damage values) | Two lines marked manual with the entered values |
| 5 | — | B: pick Pip | No attack row; Initiative works |
| 6 | — | B on Mira: Damage 5; Heal 20; Damage 15 | A and B ≤ 1 s: 7 / 12, then 12 / 12 (clamped), then 0 / 12 + "Down". C frames: no Mira HP |
| 7 | Thorn: Heal 2 | — | C shows 5 / 10 ≤ 1 s |
| 8 | — | B: double-click Initiative | Exactly one new log line |
| 9 | Kill server, restart | B: during outage controls disabled | Banner; after rejoin Mira 0 / 12, Thorn 5 / 10, log intact; no console errors throughout |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0004, 0009, 0012, 0016, 0021, 0024, 0025; #53, #73, #92, #100, #106 | Ownership, PC HP on character, stored basics, events, sync, visibility, windows | accepted |
| [entities](entities.md) | `character` kind, `hpCurrent`, FR-ENT-15 visibility, fixtures `char-mira`, `char-thorn` | complete |
| [play-shell](play-shell.md), [live-sync](live-sync.md), [fixtures-adapters](fixtures-adapters.md) | Window registry, disabled-when-not-live; intents, rejects; bundles, add `char-pip`, `char-wounds`, bundle `character-sheet` to FIX §8 at merge (integrator) | complete |
| [dice-roll-log](dice-roll-log.md) | Internal roll API, ManualEntry, adv/dis, shared roll control, seeded RNG, `dice.log` (OQ-CHAR-06, -09) | Combat, in spec |
| [combat-tracker](combat-tracker.md) | Uses `characters.adjustHp`; damage cards from sheet attacks; initiative (OQ-CHAR-07, -08, -10) | Combat, not started |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-CHAR-01~~ | ~~Basics stored or derived?~~ | **Decided (#106, [ADR-0012](../architecture/adr/0012-character-derived-values.md)):** stored | — | — |
| ~~OQ-CHAR-02~~ | ~~Source of truth for PC HP~~ | **Decided (#92):** the character | — | — |
| OQ-CHAR-03 | Player edits to own sheet in MVP | **Current HP only (damage / heal), owner + DM** (covers potions; trusted table) / none (DM does all HP) / all basics (needs a form) | no (owner: DM) | entities, combat-tracker |
| ~~OQ-CHAR-04~~ | ~~Players see each other's sheets?~~ | **Decided ([ADR-0024](../architecture/adr/0024-definition-visibility.md)):** no; party HP → [OQ-ENT-15](entities.md#15-open-questions) | — | — |
| OQ-CHAR-05 | Ability scores in MVP | **No: not tier S; later an optional, additive character field** / display-only field now (schema, fixture, UI cost) | no (owner: DM) | entities |
| OQ-CHAR-06 | Roll contract with [dice-roll-log](dice-roll-log.md) | **Internal server roll API callable inside a feature command's transaction (expression, category, mode, manual, context); dice-roll-log owns notation, ManualEntry, events, RNG seam, plus a shared `@ui` roll control** / client builds the expression and sends dice's generic roll intent (bonuses and labels client-trusted) | **yes** | dice-roll-log, combat-tracker |
| OQ-CHAR-07 | [combat-tracker](combat-tracker.md): PC HP writes and player attacks | **Combat writes PC HP only via `characters.adjustHp` in its own tx; damage cards come from a combat-tracker listener on sheet attack rolls (link id); a player-picked target (OQ-CBT-07) adds optional `targetTokenId` to `char.roll`** / combat-tracker has its own player attack button | no (owner: combat-tracker) | combat-tracker, notifications |
| OQ-CHAR-08 | Undo of a PC's damage after a sheet HP change | **Compensating event applies the inverse delta, clamped** / restores `hpBefore` (erases the sheet change) | no (owner: combat-tracker) | combat-tracker |
| OQ-CHAR-09 | DM rolls from a PC's sheet: public-log rule | **Counted as the character's roll: always public (#73)** / DM roll: category toggles apply | no (owner: dice-roll-log) | dice-roll-log |
| OQ-CHAR-10 | Sheet initiative roll during a combat | **Plain logged roll; combat-tracker's initiative UI sets combatant initiative (may reuse `characterRolls`)** / the sheet roll fills the combatant (needs a combat intent, listeners can't mutate) | no (owner: combat-tracker) | combat-tracker |
| OQ-CHAR-11 | Sheet HP adjustments in the game log | **No in MVP: DM sees HP live; event log keeps it for stats** / a log line "Mira −5 HP" (new entry type) | no (owner: DM) | dice-roll-log |
| OQ-CHAR-12 | DM edits basics in the UI | **No: fixtures + `PUT /api/entities/:id` (#100)** / small DM form on the sheet (near-free over `entities.update`) | no (owner: DM) | entities |

## 16. Out of scope

- See §4. Token double-click → sheet, several sheet windows (§7 later). Party portrait strip → [theme-system](post-mvp/theme-system.md). Stats UI → [stats](post-mvp/stats.md).
