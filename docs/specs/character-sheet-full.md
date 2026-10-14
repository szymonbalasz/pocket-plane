---
title: Character sheet (full)
prefix: CHARX
status: draft
owner: spec-character-sheet-full
phase: post-mvp-1
---

# Character sheet (full)

> Five-minute read for §1–§7; §8 onwards is reference. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Extends [character-sheet](character-sheet.md) (CHAR, basics); every FR-CHAR stays in force unless amended here.

## 1. Summary

- **Player-owned sheets** (sprint 1, track S, #177): a player creates and fills in their own character by hand (no compendium, no class data). The DM approves it, edits any PC or NPC, and can lock a sheet.
- **Roll from any number** on the sheet: checks, saves, skills, initiative, every attack, every spell (to-hit, damage, save DC).
- **Derived with overrides** ([ADR-0012](../architecture/adr/0012-character-derived-values.md) option C, [proposed ADR](../architecture/adr/proposed-full-sheet-derivation.md)): modifiers, proficiency, saves, skills, passives and spell numbers are computed; any of them can be overridden.
- **Storage split**: rules numbers stay in entities' `statBlock`. Long text, inventory, spells, counters, draft and lock state go in a new `creature-sheet` record, so a combat HP change never resends the whole sheet.
- **Other players see a summary only.** Combat-extras shows temp HP, death saves and conditions through a client **sheet sections** registry this spec owns ([§7.1](#71-sheet-sections-seam-combat-extras)).

## 2. Scope

- Create a character: the player makes a **draft**; the DM approves it. The DM can also create one for a player, ready to play or as a draft. *(proposed, OQ-CHARX-03)*
- Edit, inline: identity (species, background, alignment, classes, so multiclass works), abilities, AC, HP max, initiative, speed, save and skill proficiencies (incl. expertise), other proficiencies (text), attacks (0–20), spellcasting + spells (hand-entered rows) + slots, features (with optional uses), inventory, notes. Plus overrides on derived values.
- Counters: spell slots used, hit dice used, feature uses. Owner and DM, also on a locked sheet.
- DM: approve, lock / unlock, reassign the owner, full editing of any PC and of **NPCs** (= custom creature definitions, *proposed* OQ-CHARX-06).
- Roll every number (§6 table). Roll routes extended with a row reference (multiple attacks, spell attacks in combat; OQ-CHARX-12).
- Summary of other PCs for players. Read-only wallet line from [party-loot](party-loot.md).
- Sheet sections registry (seam for [combat-extras](combat-extras.md)). Fixtures + bundle `character-sheet-full`.

## 3. Goals

- A new player gets from link to a playable, rollable character without the DM typing anything; the DM stays in control (approve, lock).
- No number is typed twice: change DEX and every DEX skill, save and button label follows. Homebrew and odd features still fit (overrides).
- The server, not the client, decides what is rolled. Bonuses come from committed data.
- No other player ever receives a sheet's numbers, text or counters. A DM edit and a player edit never silently lose each other's other fields.

## 4. Non-goals

- Guided builder, level-up, class / species data, multiclass slot tables → [levelling](post-mvp/levelling.md). Spell / item lookup → [compendium](post-mvp/compendium.md).
- Encumbrance / weight (tier C). Rest buttons (tier C, OQ-CHARX-08). Inspiration (tier D), D&D Beyond import (tier F).
- Temp HP, death saves, conditions, concentration tracking: data, rules, commands, events → [combat-extras](combat-extras.md). This spec only gives them a place on the sheet (§7.1).
- Currency as a sheet field: coin is [party-loot](party-loot.md)'s wallet (derived). Party inventory → [party-board](post-mvp/party-board.md).
- Undo of sheet edits ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md): combat-only). Deleting characters (FR-ENT-14 stands, OQ-CHARX-17).
- Automatic slot use on cast, cantrip scaling, upcasting, multi-term damage (`1d8+2 + 1d6 fire`): enter a second row or edit the expression.

## 5. User stories

**DM**
- As the DM, I want new players to build their own character and send it to me for approval, so that I don't type sheets.
- As the DM, I want to lock a finished sheet, so that numbers only change when I agree.
- As the DM, I want to edit an NPC's skills, spells and notes on the same sheet, so that I can run a named villain without a monster editor.

**Player**
- As a player, I want to fill in my sheet once and have every bonus computed, so that I don't keep 30 numbers in sync.
- As a player, I want to click Stealth, my Light crossbow or Guiding Bolt and have the right roll made, so that I never type a roll.
- As a player, I want to tick off spell slots and feature uses, even when the DM locked my sheet.
- As a player, I want to see who else is in the party (name, class, level), not their numbers.

## 6. Functional requirements

Terms: **creature** = a `character` or a custom `monster` definition (NPC); **sheet** = its stat block + its `creature-sheet` record (§8). `env` = `CommandEnv`.

| ID | Requirement | Notes |
|---|---|---|
| **Data** | | |
| FR-CHARX-01 | Entities' creature core gains optional fields (§8.1): `skills`, `overrides`, `spellcasting`; character only `classes`, `species`. `attacks` becomes 0–20 rows, each with an optional `id`. Additive: stored rows stay valid, no backfill. | Entities' schema (OQ-CHARX-19) |
| FR-CHARX-02 | New record `creature-sheet` (§8.2), 1:1 with a campaign entity (character or custom monster; never imported): `status`, `locked`, `ownerPlayerId` copy, background, alignment, proficiency notes, spells, features, items, notes, counters. A missing row = defaults (`ready`, unlocked, empty). Created by `char.create` or by the first CHARX write to that creature. | ADR proposed |
| FR-CHARX-03 | Limits per §8 field tables. Serialized stat block ≤ 12 KB and `creature-sheet` ≤ 48 KB, else `invalid` "Sheet is full". | §12 |
| FR-CHARX-04 | Multiclass (model supports, UI basic): `classes` 1–4 rows `{name, level, hitDie, subclass?}`. When set, the server writes `level` = Σ levels (≤ 20, else `invalid`) and `className` = names joined "/" (≤ 40) in the same write; combat keeps reading `level`, `className`. Absent = legacy single class, no hit dice block. | Carried-over pick |
| **Derivation** ([proposed ADR](../architecture/adr/proposed-full-sheet-derivation.md)) | | |
| FR-CHARX-05 | Derived, never stored, pure in `@shared/entities`, both kinds, taking the stat block: ability mod, proficiency bonus, check, save (FR-ENT-24); **skill** = mod + PB × {none 0, proficient 1, expertise 2}; **passive** Perception / Investigation / Insight = 10 + skill bonus; **spell attack** = PB + mod(spellcasting ability); **spell save DC** = 8 + PB + mod; **hit dice** = per die size, Σ class levels. Stored, not derived: AC, HP max, initiative bonus (#154), speed, attack to-hit and damage, slot maxima. | Option C |
| FR-CHARX-06 | `overrides[key] = {value, note?}` replaces the derived value everywhere: sheet labels, server rolls, combat's `cbt.rollAbility`. Keys: `proficiency`, `check.<ability>`, `save.<ability>`, `skill.<skill>`, `passive.<perception\|investigation\|insight>`, `spellAttack`, `spellDc`. A `proficiency` override feeds every PB-based value; the others are leaves. Clearing returns to derived. | Homebrew |
| FR-CHARX-07 | Helper signatures stay (stat block in, number out). Callers (combat FR-CBT-44, combat-extras) get overrides for free. | ADR-0032 deviation now fixable |
| **Creation and lifecycle** | | |
| FR-CHARX-08 | `char.create`. Player: `{name}`, owner = `env.actor.playerId`, `status: draft`; a player with an open draft → `conflict` "Finish your draft first: the DM approves it". DM: `{name, ownerPlayerId, draft?}` (default ready). Name per FR-ENT-08. Starting block: medium, AC 10, HP max 1, init +0, no attacks, level 1, class "", all six scores 10; `hpCurrent = hpMax`. Entity (entities' internal create) + `creature-sheet` row in one transaction; `CharacterCreated`. Result `{characterId}`. | OQ-CHARX-03 |
| FR-CHARX-09 | Binding: the owner comes only from the connection's player (the link) or the DM's pick; the link token is never stored on or sent with a character. Renaming a player changes nothing. | ADR-0004 |
| FR-CHARX-10 | `char.approve {characterId}` (DM): draft → ready, `CharacterApproved`; already ready → success, no event. | |
| FR-CHARX-11 | A draft behaves as ready (edit, roll, HP, tokens) except: "Draft" badge (owner, DM) and **not** in an encounter's whole-party list (`partyCharacterIds: null`, FR-CBT-02). | OQ-CHARX-13 (combat) |
| FR-CHARX-12 | `char.setLock {characterId, locked}` (DM); same value → no event. Locked: a player's edit intents (FR-CHARX-15/16) → `forbidden` "Locked by the DM". Rolls, HP (FR-CHAR-10) and counters (FR-CHARX-17) stay with the owner. The DM is never locked out. `CharacterLockSet`. | |
| FR-CHARX-13 | Owner change: DM only, `char.edit` key `ownerPlayerId` (player → `forbidden`) or entities' `PUT`. The `creature-sheet` owner copy changes in the same transaction (CHARX's definition-changed hook, FR-ENT-19); the event lists both records: old owner gets the redacted `entity` + `creature-sheet` delete, new owner both full. | FR-ENT-11 |
| FR-CHARX-14 | No delete: a stray draft is renamed and reused, or reassigned by the DM. | FR-ENT-14, OQ-CHARX-17 |
| **Editing** | | |
| FR-CHARX-15 | `char.edit {creatureId, set}`: `set` = strict partial object of the scalar fields in §9; each present key replaces that field (null clears an optional one); absent keys are untouched (last write wins **per field**). Server merges into the committed row, validates the whole stat block and sheet, writes the stat block through entities' internal update (FR-ENT-08 names, FR-ENT-11 clamp, definition-changed hooks so token / combatant copies follow) and the sheet row, one transaction; `CharacterSheetEdited {op: set, fields}`. Nothing changed → success, no event. | OQ-CHARX-19 |
| FR-CHARX-16 | Rows (`attacks`, `spells`, `features`, `items`): `char.putRow {creatureId, list, row}` (no `row.id` → create with `ctx.ids`, appended; full row limit → `conflict`; with `id` → replace that row; unknown id → `not_found` "Row was deleted"); `char.deleteRow {creatureId, list, rowId}`; `char.moveRow {creatureId, list, rowId, toIndex}` (clamped). `CharacterSheetEdited {op, list, rowId}`. Legacy attacks without `id` get one from `ctx.ids` on the first write to that stat block. | |
| FR-CHARX-17 | Counters, characters only: `char.useResource {characterId, resource, delta \| reset}`; `resource` = `{slot: 1–9}` \| `{hitDie: d6\|d8\|d10\|d12}` \| `{feature: rowId}`; `delta` int −9…9 ≠ 0; `used = clamp(used + delta, 0, max)`; `reset: true` → 0. Unchanged → no event. Lowering a maximum (edit, row change or `PUT`) clamps `used` in the same transaction. `CharacterResourceUsed {resource, before, after}`. Monster → `invalid` "No counters on NPC definitions". | Deltas like FR-CHAR-10 |
| FR-CHARX-18 | Authorize every CHARX intent per §10. Unknown, other campaign, or (player) not own → `not_found` / `forbidden` as FR-CHAR-09; imported definition → `forbidden` "Imported definitions are read-only. Derive a custom one."; custom monster → DM only. Failure: no change, event or log entry. | ADR-0004 |
| FR-CHARX-19 | All CHARX events are logged, none undoable. | ADR-0016 |
| **Rolls** | | |
| FR-CHARX-20 | `char.roll` gains kinds `skill`, `damage`, `spellAttack`, `spellDamage` and fields `skill?`, `attackId?`, `spellId?`; wrong combinations → `invalid`. `attack` / `damage` without `attackId` = the first attack (MVP clients and combat keep working). | Amends FR-CHAR-05 |
| FR-CHARX-21 | Roll specs, built server-side from committed data by `characterRolls(stats, sheet, kind, ref)` (`@shared/character-sheet`), table below. Unknown row → `not_found`; `spellAttack` needs `roll: attack` and `spellDamage` needs `damage`, else `conflict` ("No attack roll for Shield"). Mode on the d20 only; manual count per table; public per FR-CHAR-17. | |
| FR-CHARX-22 | The DM may `char.roll` for a custom or imported monster definition (NPC sheet): actor name = definition name; public per category / override. Players: monsters stay `not_found`. | Amends FR-CHAR-09 |
| FR-CHARX-23 | Every rollable number on the sheet is a shared roll control ([FR-DICE-24](dice-roll-log.md#6-functional-requirements)): 6 checks, 6 saves, 18 skills, initiative, per attack Attack + Damage, per spell its rolls. Passives, AC, DC and speed are display only. DM public switches: one per category in each block header (FR-CHAR-22's rule). | Tier A |
| FR-CHARX-24 | Roll routes: `RollRoute.claim(store, characterId, kind, ref?)`, `ref` = `{attackId}` \| `{spellId}`; `SheetRollKind` gains the new kinds. Combat's route claims `initiative`, `attack` and (OQ-CHARX-12) `spellAttack`, passing `ref` to `cbt.attack`. `damage`, `spellDamage`, `skill` are never claimed. FR-CHAR-16/24 otherwise unchanged. | Extends OQ-CHAR-13 registry |
| FR-CHARX-25 | A roll never changes a counter or HP. Slots are ticked by hand. | OQ-CHARX-09 |
| **UI** | | |
| FR-CHARX-26 | Window `char.sheet` keeps its kind; default 400×600, min 320×360 (both clients). Tabs: **Main**, **Actions**, **Features**, **Inventory**, **Notes**, then section tabs (§7.1). Header as FR-CHAR-03 plus "Draft" / "Locked" badges, an **Edit** toggle (hidden while the viewer may not edit), DM **Approve** (drafts) and **Lock** toggle. Layout per §7. | Amends CHAR §7 |
| FR-CHARX-27 | Edit mode: inputs in place. Scalars commit on blur / Enter; long text (notes, feature text) on Save. A client mirror of the zod rules blocks invalid input inline (nothing sent). Every edit control is disabled while not `live` and while its own intent is in flight. Leaving edit mode never discards a committed value. | FR-CHAR-12 |
| FR-CHARX-28 | Remote change: a committed change shows ≤ 1 s in every field not being edited. A focused field whose value changed remotely keeps the local draft and shows "Changed by ‹DM \| player name›" (`charx-field-changed`); committing it overwrites (FR-CHARX-15). | Concurrency |
| FR-CHARX-29 | Picker. Player: own characters, then a "Party" group of other PCs (summary card, FR-CHARX-32), then "New character…" (hidden while they have a draft). DM: every character (owner name, Draft / Locked marks), "New character…" (name + owner Select + "Start as draft"), and the NPC last opened via FR-CHARX-31. Sort per FR-CHAR-02 within each group. | Amends FR-CHAR-02 |
| FR-CHARX-30 | Player with no character: FR-CHAR-04 text gains a **Create character** Button → name Dialog → the new draft opens in edit mode with the hint "Fill in class, ability scores, AC and HP. Your DM approves the sheet." | |
| FR-CHARX-31 | NPC sheet: entities' `creatureActions` gains "Sheet" (DM): opens `char.sheet` on that definition. Custom: editable as above, CR + XP instead of level, HP max only (no HP control, no counters, no hit dice). Imported: read-only, lock icon, "Derive to customise". | OQ-CHARX-06 |
| FR-CHARX-32 | Summary card (other players' PCs): portrait, name, owner, "Level N Class", species, Down badge. Nothing else. | OQ-CHARX-05 |
| FR-CHARX-33 | Inventory tab shows the character's wallet read-only from party-loot's `wallet` record (missing = all zero), with "Move coin in Party loot". | OQ-LOOT-16 follow-up |
| FR-CHARX-34 | Sheet sections registry and rendering: [§7.1](#71-sheet-sections-seam-combat-extras). | Seam |
| **Visibility** | | |
| FR-CHARX-35 | `entity` redaction for other players ([FR-ENT-15](entities.md#6-functional-requirements)) adds `level`, `className`, `species` to `{id, kind, name, portraitAssetId, ownerPlayerId, down}`. No other stat-block field. | Entities' visibility line |
| FR-CHARX-36 | `creature-sheet`: DM full; player full iff `ownerPlayerId = ctx.playerId` (the row's copy); otherwise hidden (other players' sheets, every NPC sheet). | ADR-0021 |
| FR-CHARX-37 | Every CHARX command lists every record whose visibility changes (owner change: `entity` + `creature-sheet`). | FR-CBT-27 rule |
| **Robustness** | | |
| FR-CHARX-38 | In-flight intent lost to a disconnect: a `set` edit is idempotent, so its field keeps the draft marked "Not saved" (`charx-field-unsaved`) and re-commits on the next blur / Enter once `live`. Create, row create and counter deltas are not idempotent: Toast "Connection lost — check the sheet before trying again" (FR-CHAR-12). | FR-SYNC-05 |
| FR-CHARX-39 | One transaction per command: entity row, sheet row, hook-changed instances, rolls / log entry and event-log row commit together or not at all. No sheet state in server memory. | FR-CBT-28 rule |
| FR-CHARX-40 | Fixtures and bundle `character-sheet-full` per §13; `fixtures:reset-load character-sheet-full` works from empty and is deterministic. | ADR-0017 |

**Roll specs** (FR-CHARX-21). Bonus strings per FR-CHAR-21 (`1d20`, `1d20+3`, `1d20-1`).

| Kind | Ref | Rolls | Category | Label example | Manual |
|---|---|---|---|---|---|
| `skill` | `skill` | 1d20 + skill bonus | `skill-check` | "Stealth check" | 1 |
| `attack` | `attackId?` | 1d20 + toHit; damage | attack; damage | "Light crossbow attack", "Light crossbow damage (piercing)" | 2 |
| `damage` | `attackId?` | damage only | `damage` | "Light crossbow damage (piercing)" | 1 |
| `spellAttack` | `spellId` | 1d20 + spell attack; damage if set (one entry, FR-DICE-26) | attack; damage / `healing` | "Guiding Bolt attack", "Guiding Bolt damage (radiant)" | 1–2 |
| `spellDamage` | `spellId` | damage / healing only (any `roll`; DC appended iff `roll: save`) | `damage` / `healing` | "Sacred Flame damage (radiant), DC 13 DEX", "Cure Wounds healing" | 1 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense. No custom styling.

| Kind | Clients | Default open | Default geometry | Launcher |
|---|---|---|---|---|
| `char.sheet` | DM, player | player yes; DM no | as CHAR §7; **400×600**, min 320×360 | unchanged |

- **Main**: stat row (AC, HP + control, Speed, Init, Prof), then vitals sections (§7.1), Abilities block (FR-CHAR-22), **Skills** block (18 rows: proficiency dot / double dot for expertise, name, ability abbreviation, signed bonus = roll button; passives under it), main sections.
- **Actions**: Attacks (row: name, "+4 · 1d8+2 piercing", **Attack**, **Damage**); Spellcasting header (ability, "Spell attack +5 · DC 13", slot pips per level 1–9 with max > 0, click = use, Shift+click = restore, "Reset"); Spells grouped by level (cantrips first): name, C / R / prepared marks, roll buttons per row.
- **Features**: rows: name, source, text, uses pips (+ Reset). **Inventory**: wallet line, items (name, qty, equipped mark, notes), proficiency notes. **Notes**: background, alignment, notes text.
- **Edit mode**: the same layout with inputs; rows get Add / delete / drag handle; overrides via a small "Override" popover on each derived number (value + note, "Clear"). Overridden numbers show a marker; Tooltip "Derived +3 · Override: Bracers of Defence".
- **Locked** (player): no Edit toggle; header Badge "Locked" with Tooltip "Locked by the DM". Counters, HP and rolls still work.
- **DM view**: any character or NPC; Approve, Lock, owner Select in edit mode. **Player view**: own sheets full; others as summary cards; never a monster.
- **States**: loading skeleton; empty per FR-CHARX-30; reconnecting = last values, controls disabled, banner; error Toast; unsaved field marked (FR-CHARX-38); sheet full → inline "Sheet is full".
- **Test IDs** (prefix `charx-`, new parts only; CHAR's `char-sheet-*` stay): `charx-tab` (+ `data-value`), `charx-edit-toggle`, `charx-draft`, `charx-locked`, `charx-approve`, `charx-lock-toggle`, `charx-create`, `charx-create-name`, `charx-create-owner`, `charx-create-draft`, `charx-create-submit`, `charx-picker-new`, `charx-summary` (+ `data-record-id`), `charx-skill` (+ `data-value` = skill key), `charx-skill-bonus`, `charx-roll-skill`, `charx-passive` (+ `data-value`), `charx-attack` / `charx-spell` / `charx-feature` / `charx-item` (+ `data-record-id` = row id), `charx-roll-attack`, `charx-roll-damage`, `charx-roll-spell-attack`, `charx-roll-spell-damage`, `charx-row-add` / `charx-row-delete` / `charx-row-move` (+ `data-value` = list), `charx-slot` (+ `data-value` = level, `data-used`), `charx-hitdie` (+ `data-value`), `charx-feature-use`, `charx-resource-reset`, `charx-field` (+ `data-value` = field path), `charx-field-changed`, `charx-field-unsaved`, `charx-override` (+ `data-value` = key), `charx-overridden`, `charx-wallet`, `charx-public-skill`, `charx-public-damage`, `charx-section` (+ `data-record-id` = section id), `charx-full`.

### 7.1 Sheet sections seam (combat-extras)

Combat-extras owns temp HP, death saves and conditions (data, rules, commands, events, visibility). This spec owns where they appear. Settled with [combat-extras](combat-extras.md) via OQ-CHARX-10.

- **Registry** (append-only, created empty by the CHARX build, add to AGENTS §9.9): `src/client/common/features/character-sheet/sheet-sections.ts`, `export const sheetSections: readonly SheetSection[]`. Contract in `./sections.ts` (feature-owned).
- **Entry shape**

```ts
type SheetSlot = "header" | "vitals" | "main" | "tab";
interface SheetSection {
  id: string;                         // "<prefix>.<name>", e.g. "cbtx.death-saves"; test ID charx-section + data-record-id
  slot: SheetSlot;
  order: number;                      // ascending within the slot; ties by id
  title?: string;                     // required for slot "tab" (tab label)
  clients?: readonly ("dm" | "player")[];          // default both
  kinds?: readonly ("character" | "monster")[];    // default ["character"]
  available?(store: RecordStore, creatureId: string): boolean;  // false → not rendered
  component: ComponentType<{ creatureId: string; client: "dm" | "player" }>;
}
```

- **Slots**: `header` = chip row under the name (e.g. condition chips); `vitals` = directly under the HP row (temp HP, death saves); `main` = end of the Main tab; `tab` = own tab after Notes.
- **Rules**: the sheet passes identity only; components read the synced store and send their own intents, with their own test IDs and prefix. Rendered in view and edit mode alike; a section owns its own editing and lock rule. A throwing section renders nothing and logs a console warning; the sheet keeps working. Summary cards and imported-definition sheets render no sections.
- **What CHARX exposes** for sections (pure, `@shared/entities`, overrides honoured): `abilityMod`, `proficiencyBonus`, `saveBonus(stats, "con")` (concentration), `checkBonus`, `spellSaveDc`, `spellAttackBonus`; record fields `hpCurrent`, `statBlock.hpMax`; on `creature-sheet` (owner + DM only) `spells[].concentration`.
- **Not here**: no temp HP, death-save or condition fields in CHARX's schema. The HP control stays CHAR's `char.adjustHp`; whether temp HP absorbs sheet damage is combat-extras' rule (OQ-CHARX-11).

## 8. Data model

### 8.1 Stat block additions (entities' JSON leaf, zod only, no column)

| Field | Kinds | Type | Notes |
|---|---|---|---|
| attacks | both | 0–**20** × `{id?, name 1–40, toHit, damage, damageType?}` | Was 0–1; `id` from `ctx.ids` (FR-CHARX-16) |
| skills | both | `{<skill>: "proficient" \| "expertise"}`; absent = none | 18 SRD skills, keys camelCase (`sleightOfHand`); needs `abilities` |
| overrides | both | `{<key>: {value int −20…40, note? ≤ 60}}` | Keys FR-CHARX-06 |
| spellcasting | both | `{ability, slots: {1…9: int 0–9}}` | Slot maxima; needs `abilities` |
| classes | character | 1–4 × `{name 1–30, level 1–20, hitDie d6\|d8\|d10\|d12, subclass? ≤ 30}` | Server writes `level`, `className` (FR-CHARX-04) |
| species | character | text 0–40 | In the summary (FR-CHARX-35) |

### 8.2 `creature-sheet` (new table `creature_sheet`, CHARX)

| Field | Type | Notes |
|---|---|---|
| entityId | ID → Entity, PK | Campaign entity only |
| campaignId | ID → Campaign | Scope |
| ownerPlayerId | ID → Player \| null | Copy of the entity's; null for monsters; written only with the entity's owner |
| status | `draft` \| `ready` | Character only; monsters `ready` |
| locked | bool | Default false |
| background, alignment | text 0–40 each | |
| proficiencyNotes | **JSON leaf** `{armor, weapons, tools, languages}` text ≤ 200 each | Display only |
| spells | **JSON leaf**, 0–40 × `{id, name 1–60, level 0–9, prepared, concentration, ritual, roll: none\|attack\|save, saveAbility?, damage?, effect: damage\|healing, damageType?, notes ≤ 200}` | `damage` = entities' grammar; `saveAbility` iff `roll: save` |
| features | **JSON leaf**, 0–30 × `{id, name 1–60, source ≤ 40, text ≤ 600, usesMax? 1–20, used, reset?: short\|long}` | `reset` is a label only (no rest buttons) |
| items | **JSON leaf**, 0–80 × `{id, name 1–60, qty 0–9999, equipped, notes ≤ 120}` | No weight |
| notes | text ≤ 4000 | Rendered as text |
| slotsUsed | **JSON leaf** `{1…9: int}` | ≤ slot max |
| hitDiceUsed | **JSON leaf** `{d6…d12: int}` | ≤ levels with that die |
| createdAt, updatedAt | timestamp | `ctx.clock` |

- **Relations**: Entity 1—0..1 creature-sheet; Player 1—* character (unchanged). Wallet: party-loot's derived `wallet` (read only).
- **Derived** (`@shared`, never stored): FR-CHARX-05 values, overridden flags, Draft / Locked display, roll specs, summary card.
- **Persisted runtime state**: `hpCurrent` (entity, CHAR), counters (sheet). Edit drafts and picker selection: client memory only.
- **Migration of MVP data**: none needed. New stat-block fields are optional; the attacks limit only grows; `creature_sheet` is a new table (drizzle push now, generated migration at release). Existing characters (char-mira etc., real data) have no sheet row → ready, unlocked, empty groups; legacy attacks get ids on first write. No backfill.

## 9. API & events

**REST**: none new. Entities' `POST` / `PUT /api/entities` keep working; their whole-replace carries the new stat-block fields (combat's form sends the whole block, FR-CBT-43). Sheet edits use WS intents for both roles (players have no REST write path; precedent party-loot; OQ-CHARX-14).

**WS intents** (default deny; none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `char.create {name, ownerPlayerId?, draft?}` | DM, player | FR-CHARX-08; player sending `ownerPlayerId` / `draft` → `invalid` | `{characterId}` |
| `char.approve {characterId}` | DM | FR-CHARX-10 | `{}` |
| `char.setLock {characterId, locked}` | DM | FR-CHARX-12 | `{}` |
| `char.edit {creatureId, set}` | DM, player (own, unlocked) | FR-CHARX-15, §10. `set` keys: `name, portraitAssetId, size, species, background, alignment, classes, ac, hpMax, initBonus, speed, abilities, saveProficiencies, skills, overrides, proficiencyNotes, spellcasting, notes`; `level`, `className` only while `classes` is absent (else `invalid`); NPC `cr`; DM only `ownerPlayerId` | `{}` |
| `char.putRow {creatureId, list, row}` / `char.deleteRow {…, rowId}` / `char.moveRow {…, rowId, toIndex}` | DM, player (own, unlocked) | FR-CHARX-16 | `{rowId}` / `{}` / `{}` |
| `char.useResource {characterId, resource, delta?, reset?}` | DM, player (own; locked ok) | FR-CHARX-17; exactly one of `delta`, `reset` | `{before, after}` |
| `char.roll {…, skill?, attackId?, spellId?}` | DM, player | FR-CHARX-20–22 | `{rollIds, entryId}` |

**Record types**

| Type | Scope | Visibility | Snapshot |
|---|---|---|---|
| `creature-sheet` (new) | campaign | FR-CHARX-36 | the campaign's rows |
| `entity` (entities) | campaign | FR-ENT-15 + FR-CHARX-35 summary | unchanged |

**Domain events** (WS: generic record changes, `cause.name` = event type)

| Event | Payload | Changes → visibility | Logged | Undoable |
|---|---|---|---|---|
| `CharacterCreated` | `{characterId, ownerPlayerId, status}` | `entity` + `creature-sheet` upserts → DM, owner full; others redacted `entity` only | yes | no |
| `CharacterApproved` | `{characterId}` | `creature-sheet` → DM, owner | yes | no |
| `CharacterLockSet` | `{characterId, locked}` | `creature-sheet` → DM, owner | yes | no |
| `CharacterSheetEdited` | `{creatureId, op: set \| putRow \| deleteRow \| moveRow, fields?, list?, rowId?}` (keys and ids, never values) | `entity` and / or `creature-sheet` + hook-changed instances (tokens, combatants) → each by its own rule | yes | no |
| `CharacterResourceUsed` | `{characterId, resource, before, after}` | `creature-sheet` → DM, owner | yes | no |
| `CharacterRolled` (CHAR) | gains `skill?`, `attackId?`, `spellId?`; `kind` gains the new kinds | `game-log-entry` per FR-DICE-13/15 | yes | no |

- **Internal (new, needed from entities, OQ-CHARX-19):** `entities.createIn(env, body)` and `entities.updateIn(env, id, next) → RecordChange[]` (the `POST` / `PUT` path minus HTTP, hooks included). **CHARX provides:** `sheetAttack(env, creatureId, ref) → {name, toHit, damage, damageType}` for combat's `cbt.attack` (OQ-CHARX-12); a definition-changed hook (owner copy, counter clamp).
- **Client registries:** sheet sections (new, §7.1); roll routes (extended contract, FR-CHARX-24); `creatureActions` "Sheet" line (DM).

## 10. Permissions

| Action | DM | Owner player | Other player | Server check |
|---|---|---|---|---|
| View | full, any creature | own sheet full | summary only; NPCs never | FR-ENT-15 + FR-CHARX-35/36 |
| Create character | for any player, ready or draft | own, draft, one open draft | — | FR-CHARX-08 |
| Approve, lock / unlock, change owner | ✓ | ✗ | ✗ | FR-CHARX-10/12/13 |
| Edit fields and rows | any character, custom NPC | own, **unless locked** | ✗ | FR-CHARX-15/16/18 |
| Counters, current HP | any character | own, also locked | ✗ | FR-CHARX-17, FR-CHAR-09 |
| Roll | any character or definition; public override | own; always public | ✗ | FR-CHAR-09/17, FR-CHARX-22 |
| Edit imported definition | ✗ | ✗ | ✗ | `forbidden` |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled; last values shown; FR-CHARX-38 for lost intents. Snapshot restores sheet, counters and lock state; selection kept if still eligible.
- **DM disconnect / reconnect:** same. Nothing waits on the DM; a draft stays playable until approved.
- **Server crash mid-action:** FR-CHARX-39. Unsaved field drafts (client memory) are lost on reload; committed edits survive.
- **Concurrent edits (player + DM):** different fields or rows both survive (per-field / per-row writes). Same field: last commit wins; the other editor sees FR-CHARX-28's hint. Row deleted while edited → `not_found` Toast, the row closes. Lock committed while the player edits → `forbidden` "Locked by the DM", edit mode closes, drafts dropped. Counter clicks are deltas, so DM and owner clicks both apply. Combat damage + sheet edit of HP max: entities clamps `hpCurrent` (FR-ENT-11).
- **Two tabs of one player creating:** the second `char.create` → `conflict` (one open draft).
- **Owner or campaign change while viewing:** FR-CHAR-04 (first eligible, else empty); the old owner's `creature-sheet` delete arrives in the same event.
- **Edit vs roll race:** rolls use values at commit; a deleted row → `not_found` Toast.
- **Creature form vs sheet (DM):** the form's whole-replace `PUT` is last-write-wins over the block (FR-ENT-11, as today); sheet-only data (`creature-sheet`) is untouched by it.
- **Invalid / malicious input:** strict zod on every intent (unknown keys, bounds, dice grammar, row limits, size caps); player sending `ownerPlayerId`, `draft` or `public` → `invalid` / `forbidden`; names and text rendered as text.

## 12. Performance & bandwidth

- `entity` stays small: ≤ 12 KB block cap, typical 2–4 KB, so a combat HP upsert stays ≈ CHAR §12. `creature-sheet` typical 5–15 KB, cap 48 KB; sent to the DM and the owner only.
- Snapshot growth: DM ≈ Σ sheets (6 PCs + 10 NPC sheets ≈ 150 KB typical); a player ≈ their own sheet(s). Within live-sync §12's 512 KB; caps bound the worst case.
- Edits commit on blur / Save, not per keystroke: ≤ a few per minute. Event-log rows carry before / after of changed records (≤ 2 × 48 KB worst, typical ≤ 20 KB).
- Target: commit → other client ≤ 1 s over the tunnel.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:`, port 0, seeded `ctx.ids` / `ctx.dice`; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs, e.g. `test("FR-CHARX-12 locked sheet rejects player edit", …)`.

**Fixtures** (setups run with DM authority, FR-FIX-13; owner `character-sheet-full`)

| Key | Requires | Contents | `session-sim` |
|---|---|---|---|
| `char-mira-full` | `char-mira` | Mira: classes Fighter 1 d10, species "Human", skills Athletics + Perception, override `passive.perception` 14 note "Alert (test)"; 2nd attack "Light crossbow" +4 / 1d8+2 piercing; features Second Wind (uses 1, short), Fighting Style; items Shortsword, Light crossbow, Bolts ×20; notes "MIRA-NOTE-7" | yes |
| `char-mira-locked` | `char-mira-full` | `char.setLock` Mira locked | no |
| `char-sela` | `player-2` | **Draft** "Sela" for `player-2` (as a player would make it): Cleric 1 d8, species "Dwarf", WIS 16, Medicine + Insight, spellcasting WIS, slots 1: 2; spells Sacred Flame (save DEX, 1d8 radiant), Guiding Bolt (attack, 4d6 radiant), Cure Wounds (`roll: none`, 1d8+3 healing), notes "SELA-NOTE-3" | no |
| `npc-elite-sheet` | `enemy-custom` | DM edits Elite Goblin Warrior: Stealth expertise, 2nd attack "Shortbow" +5 / 1d6+3 piercing, feature "Nimble Escape", notes "NPC-NOTE-9" | yes |

**Bundle `character-sheet-full`** = bundle `character-sheet` + `enemy-1` + `enemy-custom` + `char-mira-full` + `char-mira-locked` + `char-sela` + `npc-elite-sheet` + `loot-1` + `loot-wallets`. Game-log settings at defaults (all hidden).

| Level | What | Fixtures |
|---|---|---|
| Unit | Schemas: every §8 bound, row limits, size caps, `skills` / `spellcasting` need `abilities`, `saveAbility` iff `roll: save`, classes Σ ≤ 20 and `className` ≤ 40. Derivation: skill none / prof / expertise, passive, spell attack / DC, hit dice, each override key, `proficiency` override feeding saves and skills, clear → derived. `characterRolls` per kind (labels, categories, manual counts, `healing`, DC in label). Roll-route `ref` passed; `damage` / `skill` never claimed. Sections: order, slot, `clients`, `kinds`, `available`, throwing section isolated. Field draft + "Changed by" logic; unsaved re-commit only for `set` | In-code |
| Integration | Each command: rows + event + log in one tx, IDs from `ctx`, rollback → none. **Permission matrix** (DM / owner / other player × character / draft / locked / custom NPC / imported / other campaign × every intent). Player `ownerPlayerId` / `draft` / `public` → rejected. One-open-draft `conflict`. Approve no-op. Lock: player edit `forbidden`, counters + HP + roll ok. Per-field merge: DM `ac` and player `hpMax` edits interleaved → both kept. Row put / delete / move; unknown id `not_found`; limits `conflict`. Counters clamp; lowering slot max clamps used. Owner change: old owner gets `creature-sheet` delete, new owner full. `PUT` keeps sheet data; hook clamps counters. Name edit refreshes token / combatant copies (FR-ENT-19). Draft excluded from whole-party start (with combat, OQ-CHARX-13). **Leak scan:** `player-2` frames never contain Mira's `statBlock` fields, "MIRA-NOTE-7", "NPC-NOTE-9", any `creature-sheet` row but Sela's; `player-1` never "SELA-NOTE-3"; redacted Mira has exactly the FR-CHARX-35 keys. Convergence; restart → identical snapshots | `character-sheet-full` |
| E2E (thin) | `player-1`: create "Brin", set DEX 16 + Stealth proficient, roll Stealth → line "+5"; DM approves; `player-2` sees Brin's summary card only | `character-sheet-full` |

**Browser walkthrough** — `bun run build`; `fixtures:reset-load character-sheet-full --profile verify`; `start --profile verify` (Herdr pane). Contexts A DM (`pw-dm`), B `player-1`, C `player-2`; B's and C's WS frames logged via `page.on('websocket')`. Teardown: stop, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, Sheets | B, C open links | A picker: Mira (Locked), Pip, Sela (Draft), Thorn. B: Mira, Locked badge, no Edit; Party group: Thorn, Sela. C: Sela (Draft, editable), Thorn |
| 2 | — | B: Mira, Skills: Shift+Athletics; Actions: Light crossbow Attack; Features: use Second Wind | Log: "Mira — Athletics check (adv): … + 4"; one line "+4" to-hit and 1d8+2; Second Wind 1/1 used. Passive Perception shows 14 with override marker |
| 3 | — | B: New character → "Brin"; edit: Rogue 1 d8, DEX 16, Stealth expertise, AC 14, HP max 9, Dagger +5 / 1d4+3, note "BRIN-NOTE-1"; roll Stealth | Draft badge; Stealth +7 (3 + 2 × 2); line "Brin — Stealth check: … + 7" |
| 4 | — | C: picker → Brin | Summary card: name, "Level 1 Rogue", owner Player 1; no numbers. C frames: no Brin stat block, no "BRIN-NOTE-1", no Brin `creature-sheet` |
| 5 | Brin: Edit, AC 15, while B edits HP max 10 | B: commits HP max 10 | Both: AC 15, HP max 10 (≤ 1 s each side) |
| 6 | Approve Brin, then Lock | B in edit mode | Draft badge gone; B's edit mode closes, Locked badge; B still rolls Stealth and uses HP Damage 2 → 8/10 |
| 7 | — | C: Sela: Guiding Bolt Attack; Sacred Flame Damage; tick slot 1 | Lines "+5" (2 + 3) with 4d6 radiant; "Sacred Flame damage (radiant), DC 13 DEX"; slot pip 1/2 used |
| 8 | Creatures → Elite Goblin Warrior → Sheet; roll Stealth; edit Shortbow +6 | — | Stealth row expertise; DM-only line (category hidden); edit committed; B, C frames: no monster records |
| 9 | Kill server, restart | B, C: controls disabled meanwhile | Banner; after rejoin state of steps 2–8 intact (lock, counters, rows); no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0004, 0009, 0012, 0016, 0021, 0022, 0024, 0025, 0029, 0032; #106, #139, #149, #154, #177 | Ownership, model, derivation, events, sync, seams, visibility, windows, log window | accepted |
| [proposed ADR full-sheet derivation](../architecture/adr/proposed-full-sheet-derivation.md) | Option C + storage split | **proposed** |
| [character-sheet](character-sheet.md) | Window, roll routes, `char.roll`, `char.adjustHp`, `characters.adjustHp`, roll control usage | complete, built |
| [entities](entities.md) | New optional core fields, attacks 0–20, helpers + overrides, summary redaction, internal create / update API, hook + `creatureActions` lines (OQ-CHARX-19) | complete; changes needed |
| [combat-tracker](combat-tracker.md) | Route passes `ref`; `cbt.attack` gains `attackId?` / `spellId?` via `sheetAttack`; drafts out of whole-party (OQ-CHARX-12/13) | complete; changes needed |
| [combat-extras](combat-extras.md) | Uses §7.1; decides temp HP vs sheet damage (OQ-CHARX-10/11) | in spec (parallel) |
| [dice-roll-log](dice-roll-log.md), [play-shell](play-shell.md), [party-loot](party-loot.md), [fixtures-adapters](fixtures-adapters.md) | Roll control, categories `skill-check` / `damage` / `healing`; window registry; `wallet` record; bundles. No change | complete |

### Shared changes

Per AGENTS §9.9; the orchestrator routes each. Shared-branch-first candidates marked ★ (never at the same time as combat-extras' schema work, [sprint-1 boundaries](../agents/sprint-1.md#boundaries-and-hotspots-orchestrator-sequence-these)).

| Path | Change | Owner today |
|---|---|---|
| ★ `src/server/db/` | New table `creature_sheet` (§8.2). `entity` unchanged (JSON leaf) | shared |
| ★ `src/shared/entities/` | §8.1 fields, attacks 0–20 + `id`, skill / passive / spell helpers, override handling in all helpers | entities (feature-owned) |
| ★ `src/server/features/entities/` | Internal `createIn` / `updateIn`; redaction adds `level`, `className`, `species`; `creatureActions` "Sheet" line; definition-changed hook line (CHARX hook) | entities |
| ★ `src/shared/events/character-sheet.ts` + `index.ts` | New events; `CharacterRolled` fields | shared |
| ★ Record-type registry (`src/server/ws/`, `src/shared/protocol/`) | `creature-sheet` line | shared (append-only) |
| `src/client/common/features/combat-tracker/roll-route.ts`, combat's `cbt.attack`, party resolution | `ref`, `spellAttack`, `sheetAttack` call, drafts excluded | combat-tracker; lock after track P's combat fixes |
| `fixtures/bundles/index.ts`, `fixtures/bundles/session-sim.ts` | `character-sheet-full`; `char-mira-full`, `npc-elite-sheet` | append-only |
| New registry `src/client/common/features/character-sheet/sheet-sections.ts` | Created empty; AGENTS §9.9 list gains it | CHARX |
| Feature-owned CHAR folders (`src/{shared,server/features,client/common/features}/character-sheet/`) | CHARX's build inherits them (OQ-CHARX-15) | character-sheet |
| Docs (integrator) | Data model §11 + new table; protocol §5/§6/§8/§26 rows; FIX §8 rows; AGENTS §9.9; glossary (OQ-CHARX-16); CHAR FR-CHAR-02/05/09 amendments | — |

**Suggested build slices**

| # | Branch | Does | Shared files |
|---|---|---|---|
| 1 | `fix/charx-core` ★ | Table, stat-block fields + helpers, entities internal API + redaction, events, record type | db, `@shared/entities`, entities server, events, record-type registry |
| 2 | `build/character-sheet-full` (a) | Commands, visibility, hook, fixtures + bundle | append-only bundle / session-sim lines, entities hook line |
| 3 | same (b) | Tabs, edit mode, picker, summary, creation, NPC sheet, wallet line, empty `sheet-sections.ts` | `creatureActions` line |
| 4 | same (c), after track P's combat fixes | `char.roll` kinds, route `ref`, combat route + `cbt.attack` + drafts | combat-tracker files (lock) |

## 15. Open questions

**Bold** = suggested pick (not decided). "DM" = needs the DM at the gate.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CHARX-01 | ADR-0012 full-sheet derivation (DM) | **C: derived with overrides, fixed key list** (automation + homebrew escape; overrides can go stale) / A: all stored (typing, drift) / D: modifier list (needs a modifier vocabulary; items not modelled) → [proposed ADR](../architecture/adr/proposed-full-sheet-derivation.md) | yes | entities, combat-tracker, combat-extras, levelling |
| OQ-CHARX-02 | Where sheet data lives | **Rules in `statBlock`, rest in new `creature-sheet`** (small HP upserts; one more record type) / all in `statBlock` (simplest; 10–48 KB per HP change) / all in a new table (combat reads two places for numbers). In the same ADR | yes (ADR) | entities, live-sync |
| OQ-CHARX-03 | How a player gets a character (DM) | **Player makes a draft; DM approves; DM can also create** (self-serve, DM keeps control; one more state) / live at once (junk joins "whole party") / DM creates only, player fills (no self-serve) | yes | combat-tracker |
| OQ-CHARX-05 | What other players see (DM; carried-over "summary only") | **Name, portrait, owner, level + class, species, Down** (party feel, no numbers) / as today: name, portrait, Down / full read-only | no · owner: spec-character-sheet-full | entities |
| OQ-CHARX-06 | What "NPC" means for full editing (DM) | **A custom creature definition, opened in the sheet by the DM** (no new kind; reuses visibility) / owner-less `character` (joins "whole party", touches combat) / new `npc` kind (world-builder's) | no · owner: spec-character-sheet-full | entities, glossary |
| OQ-CHARX-07 | Multiclassing (DM; carried-over) | **Model supports class rows; UI basic (list)** / single class only | no · owner: spec-character-sheet-full | levelling |
| OQ-CHARX-08 | Rest buttons (tier C) (DM) | **Out: manual counters + per-block Reset** (no rest rules) / short + long rest buttons (hit-die heal, slot reset: ~1 slice) | no · owner: spec-character-sheet-full | — |
| OQ-CHARX-09 | Casting uses a slot? | **No: pips ticked by hand** (no upcast rules) / roll asks for a slot level | no · owner: spec-character-sheet-full | — |
| OQ-CHARX-10 | Seam with combat-extras: temp HP, death saves, conditions on the sheet | **`sheet-sections.ts` registry, slots `header` / `vitals` / `main` / `tab` (§7.1); CBTX registers its sections** / CHARX renders CBTX fields itself (two specs own one UI) | yes (orchestrator settles with CBTX) | combat-extras |
| OQ-CHARX-11 | Sheet Damage vs temp HP | **Combat-extras decides; if temp HP absorbs sheet damage it amends `characters.adjustHp`** / sheet damage bypasses temp HP | no · owner: combat-extras | character-sheet, combat-extras |
| OQ-CHARX-12 | Combat with several attacks and spell attacks | **Route claims `attack` + `spellAttack` with `ref`; `cbt.attack` gains `attackId?` / `spellId?`, resolved by `sheetAttack`; DM row picker for NPC attacks is combat's** / only weapon attacks route, spells roll plain (DM applies HP by hand) | no · owner: combat-tracker | combat-tracker, combat-extras |
| OQ-CHARX-13 | Drafts in encounters | **Excluded from `partyCharacterIds: null`; explicit lists may include them** / no difference | no · owner: combat-tracker | combat-tracker |
| OQ-CHARX-14 | Transport for DM sheet edits (ADR-0021 D: prep CRUD over REST) | **WS intents for both roles** (one path, live; as party-loot) / REST for DM, WS for players | no · owner: integrator | protocol |
| OQ-CHARX-15 | Code ownership | **CHARX's build inherits CHAR's feature folders** / new `character-sheet-full` folders (two features in one window) | no · owner: orchestrator | — |
| OQ-CHARX-16 | Glossary | **Add: Draft (character), Sheet lock, Override, Sheet section; "NPC" = custom creature definition used as a named NPC** | no · owner: integrator | glossary |
| OQ-CHARX-17 | Deleting characters (DM) | **No delete (FR-ENT-14); rename / reassign** / owner discards an unreferenced draft | no · owner: spec-character-sheet-full | entities |
| OQ-CHARX-19 | Entities changes (§8.1, attacks 0–20, summary redaction, internal `createIn` / `updateIn`, hook + `creatureActions` lines) | **Accept; land in `fix/charx-core`** / CHARX keeps its own copy of the rules (two schemas) | no · owner: integrator | entities |

OQ-CHARX-04 and 18 are retired (merged into FR-CHARX-12 and FR-CHARX-33 while drafting).

## 16. Out of scope

- See §4. Levelling, builder, compendium lookups, rests, encumbrance, rest-time hit-die healing; temp HP / death saves / conditions data (combat-extras); party HP / AC view (tier B, play-shell); several sheet windows at once; DM-only notes on a PC; gems ([gems](post-mvp/gems.md)).
