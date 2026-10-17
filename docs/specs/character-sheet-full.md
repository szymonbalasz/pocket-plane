---
title: Character sheet (full)
prefix: CHARX
status: complete
owner: spec-rules
phase: post-mvp-4
---

# Character sheet (full)

> **Sprint 3 (track V, DM decision [#201](../decisions-log.md)).** New stat-block **senses**: **vision** and **darkvision** radius (ft) and **"sees through magical darkness"** (Devil's Sight and similar). Owner and DM edit them; they drive [fog-of-war](fog-of-war.md) v2's dynamic vision. Added: FR-CHARX-49–53, §8.1 row, §9 key, tests, slice V5, OQ-CHARX-24 / -25. *Sprint-3 gate 1 (DM, 2026-10-16):* OQ-CHARX-24 / -25 decided (**#207**); new DM-only sense **Sees invisible** (**#210**, FR-CHARX-53) for FOG's Invisible tokens. *Review pass (rulings 2026-10-16):* senses ≤ 120 ft (A9), active-scene re-derive (A9), V5 right after V0 (A10), sheet-lock order (X2), imported definitions via `useDefinitions` (C5). Everything else is the built spec.

> **Sprint 4 (track V, #243 [1]).** Vision is **999 ft by default**: `visionFt` becomes optional (absent = Normal, 999 ft), stored 0–995; the Senses line reads "Vision normal" and edit mode gets a **Normal** button. Amended FR-CHARX-49 / -50, §8.1 row, fixtures, tests, OQ-CHARX-30. Build: in FOG's `fix/vision-s4-core` (V6) under the sheet lock, **before** R's sheet work (seams S5: sheet folder V6 → R S4-1a → R S4-2; `src/shared/entities/schemas.ts` V6 then R0). Blinded and party vision: [fog-of-war](fog-of-war.md) FR-FOG-48–52. **At a glance:** FR-CHARX-49 / -50 → V6 (sheet lock first) → test `FR-CHARX-49 vision default`, `FR-CHARX-50` line + Normal button → FOG walk step 30.
>
> **Sprint 4 (track R, DM [#243](../decisions-log.md) [14] [16] [19]; weapons, uses and trigger detail only; senses belong to track V).** Attack rows gain a magic **bonus** and up to two typed **extra damage parts** (Brakka's Flame Tongue greatsword +1: 2d6 slashing + 2d6 fire, +1 to hit, +1 damage); feature uses may go **below zero**. New FR-CHARX-54–58; amended FR-CHARX-17, §8.1, §8.2. Trigger detail in the sheet is MOD's Triggers block ([FR-MOD-60](effect-modifiers.md#6-functional-requirements)); test plan in [MOD §13.1](effect-modifiers.md#131-sprint-4-track-r-mod-cbt-cbtx-charx).
>
> **Sprint 4 at a glance:** FR-CHARX-54 weapon row schema → S4-0 zod + S4-1a `build/weapon-rows` → test `FR-CHARX-54`; FR-CHARX-55 rolls with parts → S4-1a → `FR-CHARX-55`; FR-CHARX-56 sheet UI → S4-1a → `FR-CHARX-56`; FR-CHARX-57 visibility → S4-1a → `FR-CHARX-57` (leak); FR-CHARX-58 negative uses → S4-0 zod + S4-2 `fix/uses-negative` → `FR-CHARX-58`.

> Five-minute read for §1–§7; §8 onwards is reference. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Extends [character-sheet](character-sheet.md) (CHAR, basics); every FR-CHAR stays in force unless amended here.

## 1. Summary

- **Player-owned sheets** (sprint 1, track S, #177): a player creates and fills in their own character by hand (no compendium, no class data). The DM approves it, edits any PC or NPC, and can lock a sheet.
- **Roll from any number** on the sheet: checks, saves, skills, initiative, every attack, every spell (to-hit, damage, save DC).
- **Derived with overrides** ([ADR-0012](../architecture/adr/0012-character-derived-values.md) option C, [ADR-0036](../architecture/adr/0036-full-sheet-derivation.md)): modifiers, proficiency, saves, skills, passives and spell numbers are computed; any of them can be overridden.
- **Storage split**: rules numbers stay in entities' `statBlock`. Long text, inventory, spells, counters, draft and lock state go in a new `creature-sheet` record, so a combat HP change never resends the whole sheet.
- **Other players see a summary only.** Combat-extras shows temp HP, death saves and conditions through a client **sheet sections** registry this spec owns ([§7.1](#71-sheet-sections-seam-combat-extras)).
- **Sprint 2 phase 1** (P2b; FR-CHARX-41–48): every attack has three buttons, **Attack / Damage / Attack + damage**, the same everywhere ([§6.1](#61-n7-sheet-buttons), N7); attacks live on the Actions tab only (N4); a player's new draft gives the DM a pending card and approval tells the player (G8); the picker remembers its character and the header stays put (report items 13, 16).

## 2. Scope

Scope accepted by the DM (#178), including the items beyond sprint-1's first proposal.

- Players create their own character as a **draft**; the DM approves it. The DM can also create one for a player, ready or as a draft.
- Edit, inline: identity (species, background, alignment, classes; multiclass in the model, basic UI), abilities, AC, HP max, initiative, speed, save and skill proficiencies (incl. expertise), other proficiencies (text), attacks (0–20), spellcasting + spells (hand-entered rows) + slots, features (with optional uses), inventory, notes. Plus overrides on derived values.
- Counters: spell slots used, hit dice used, feature uses. Owner and DM, also on a locked sheet.
- DM: approve, lock / unlock, reassign the owner, full editing of any PC and of **NPC sheets** (custom creature definitions opened in the sheet).
- Roll every number (§6 table); several attacks per character and spell attacks routed into combat (roll routes gain a row reference).
- Other players see a summary (name, portrait, owner, level + class, species, Down / `deathState`). Read-only wallet line from [party-loot](party-loot.md).
- Sheet sections registry (seam for [combat-extras](combat-extras.md)). Fixtures + bundle `character-sheet-full`.
- **Sprint 3:** senses (vision ft, darkvision ft, sees through magical darkness) on characters and custom monsters; stored, not derived; owner + DM; read by FOG's vision server-side only. *(#210)* **Sees invisible** (truesight, See Invisibility): same place, DM-only to edit.
- **Sprint 4 (track R):** attack rows (PC and NPC sheets) with a magic bonus 0–3 and 0–2 typed extra damage parts, rolled as parts of one damage roll and typed through to the combat card; feature uses below zero, down to a floor (FR-CHARX-54–58).
- **Sprint 2 phase 1:** the three attack buttons and `char.roll` kinds `toHit` / `spellToHit`; Main without attacks; notification kinds `charx-draft`, `charx-approved`; picker memory; pinned header. Track M's "Active effects" block registers through `sheetSections` (effect-modifiers spec, MOD, accepted #190); this spec adds no effects block.

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
- Automatic slot use on cast, cantrip scaling, upcasting, multi-term damage (`1d8+2 + 1d6 fire`): enter a second row or edit the expression. *(Sprint 4: attack rows take up to two typed extra parts, FR-CHARX-54; spell rows keep one damage part.)*

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

Terms: **creature** = a `character` or a custom `monster` definition; **NPC sheet** = the sheet opened on a custom monster definition (not the `npc` entity kind); **sheet** = its stat block + its `creature-sheet` record (§8). `env` = `CommandEnv`.

| ID | Requirement | Notes |
|---|---|---|
| **Data** | | |
| FR-CHARX-01 | Entities' creature core gains optional fields (§8.1): `skills`, `overrides`, `spellcasting`; character only `classes`, `species`. `attacks` becomes 0–20 rows, each with an optional `id`. Additive: stored rows stay valid, no backfill. | Entities' schema (OQ-CHARX-19) |
| FR-CHARX-02 | New record `creature-sheet` (§8.2), 1:1 with a campaign entity (character or custom monster; never imported): `status`, `locked`, `ownerPlayerId` copy, background, alignment, proficiency notes, spells, features, items, notes, counters. A missing row = defaults (`ready`, unlocked, empty). Created by `char.create` or by the first CHARX write to that creature. | ADR proposed |
| FR-CHARX-03 | Limits per §8 field tables. Serialized stat block ≤ 12 KB and `creature-sheet` ≤ 48 KB, else `invalid` "Sheet is full". | §12 |
| FR-CHARX-04 | Multiclass (model supports, UI basic): `classes` 1–4 rows `{name, level, hitDie, subclass?}`. When set, the server writes `level` = Σ levels (≤ 20, else `invalid`) and `className` = names joined "/" (≤ 40) in the same write; combat keeps reading `level`, `className`. Absent = legacy single class, no hit dice block. | #178 (OQ-CHARX-07) |
| **Derivation** ([ADR-0036](../architecture/adr/0036-full-sheet-derivation.md)) | | |
| FR-CHARX-05 | Derived, never stored, pure in `@shared/entities`, both kinds, taking the stat block: ability mod, proficiency bonus, check, save (FR-ENT-24); **skill** = mod + PB × {none 0, proficient 1, expertise 2}; **passive** Perception / Investigation / Insight = 10 + skill bonus; **spell attack** = PB + mod(spellcasting ability); **spell save DC** = 8 + PB + mod; **hit dice** = per die size, Σ class levels. Stored, not derived: AC, HP max, initiative bonus (#154), speed, attack to-hit and damage, slot maxima. | Option C, #178 (OQ-CHARX-01) |
| FR-CHARX-06 | `overrides[key] = {value, note?}` replaces the derived value everywhere: sheet labels, server rolls, combat's `cbt.rollAbility`. Keys: `proficiency`, `check.<ability>`, `save.<ability>`, `skill.<skill>`, `passive.<perception\|investigation\|insight>`, `spellAttack`, `spellDc`. A `proficiency` override feeds every PB-based value; the others are leaves. Clearing returns to derived. | Homebrew; #178 (OQ-CHARX-01) |
| FR-CHARX-07 | Helper signatures stay (stat block in, number out). Callers (combat FR-CBT-44, combat-extras) get overrides for free. | ADR-0032 deviation now fixable |
| **Creation and lifecycle** | | |
| FR-CHARX-08 | `char.create`. Player: `{name}`, owner = `env.actor.playerId`, `status: draft`; a player with an open draft → `conflict` "Finish your draft first: the DM approves it". DM: `{name, ownerPlayerId, draft?}` (default ready). Name per FR-ENT-08. Starting block: medium, AC 10, HP max 1, init +0, no attacks, level 1, class "", all six scores 10; `hpCurrent = hpMax`. Entity (entities' internal create) + `creature-sheet` row in one transaction; `CharacterCreated`. Result `{characterId}`. | #178 G5 (OQ-CHARX-03) |
| FR-CHARX-09 | Binding: the owner comes only from the connection's player (the link) or the DM's pick; the link token is never stored on or sent with a character. Renaming a player changes nothing. | ADR-0004 |
| FR-CHARX-10 | `char.approve {characterId}` (DM): draft → ready, `CharacterApproved`; already ready → success, no event. | #178 G5 (OQ-CHARX-03) |
| FR-CHARX-11 | A draft behaves as ready (edit, roll, HP, tokens) except: "Draft" badge (owner, DM) and **not** in an encounter's whole-party list (`partyCharacterIds: null`, FR-CBT-02). | #178 (OQ-CHARX-03, -13) |
| FR-CHARX-12 | `char.setLock {characterId, locked}` (DM); same value → no event. Locked: a player's edit intents (FR-CHARX-15/16) → `forbidden` "Locked by the DM". Rolls, HP (FR-CHAR-10) and counters (FR-CHARX-17) stay with the owner. The DM is never locked out. `CharacterLockSet`. | |
| FR-CHARX-13 | Owner change: DM only, `char.edit` key `ownerPlayerId` (player → `forbidden`) or entities' `PUT`. The `creature-sheet` owner copy changes in the same transaction (CHARX's definition-changed hook, FR-ENT-19); the event lists both records: old owner gets the redacted `entity` + `creature-sheet` delete, new owner both full. | FR-ENT-11 |
| FR-CHARX-14 | No delete: a stray draft is renamed and reused, or reassigned by the DM. | FR-ENT-14, OQ-CHARX-17 |
| **Editing** | | |
| FR-CHARX-15 | `char.edit {creatureId, set}`: `set` = strict partial object of the scalar fields in §9; each present key replaces that field (null clears an optional one); absent keys are untouched (last write wins **per field**). Server merges into the committed row, validates the whole stat block and sheet, writes the stat block through entities' internal update (FR-ENT-08 names, FR-ENT-11 clamp, definition-changed hooks so token / combatant copies follow) and the sheet row, one transaction; `CharacterSheetEdited {op: set, fields}`. Nothing changed → success, no event. **HP max change:** a draft's `hpCurrent` always becomes the new HP max; otherwise, if `hpCurrent` equalled the old HP max it follows the new one (FR-CBT-06's rule), else FR-ENT-11 clamps. CHARX passes the new `hpCurrent` to `updateIn`. | OQ-CHARX-19 |
| FR-CHARX-16 | Rows (`attacks`, `spells`, `features`, `items`): `char.putRow {creatureId, list, row}` (no `row.id` → create with `ctx.ids`, appended; full row limit → `conflict`; with `id` → replace that row; unknown id → `not_found` "Row was deleted"); `char.deleteRow {creatureId, list, rowId}`; `char.moveRow {creatureId, list, rowId, toIndex}` (clamped). `CharacterSheetEdited {op, list, rowId}`. Legacy attacks without `id` get one from `ctx.ids` on the first write to that stat block. | |
| FR-CHARX-17 | Counters, characters only: `char.useResource {characterId, resource, delta \| reset}`; `resource` = `{slot: 1–9}` \| `{hitDie: d6\|d8\|d10\|d12}` \| `{feature: rowId}`; `delta` int −9…9 ≠ 0; `used = clamp(used + delta, 0, max)`; `reset: true` → 0. Unchanged → no event. Lowering a maximum (edit, row change or `PUT`) clamps `used` in the same transaction. `CharacterResourceUsed {resource, before, after}`. Monster → `invalid` "No counters on NPC definitions". *(Sprint 4, [14]: feature uses may pass the maximum, FR-CHARX-58; slots and hit dice unchanged.)* | Deltas like FR-CHAR-10 |
| FR-CHARX-18 | Authorize every CHARX intent per §10. Unknown, other campaign, or (player) not own → `not_found` / `forbidden` as FR-CHAR-09; imported definition → `forbidden` "Imported definitions are read-only. Derive a custom one."; custom monster → DM only. Failure: no change, event or log entry. | ADR-0004 |
| FR-CHARX-19 | All CHARX events are logged, none undoable. | ADR-0016 |
| **Rolls** | | |
| FR-CHARX-20 | `char.roll` gains kinds `skill`, `damage`, `spellAttack`, `spellDamage` and fields `skill?`, `attackId?`, `spellId?`; wrong combinations → `invalid`. `attack` / `damage` without `attackId` = the first attack (MVP clients and combat keep working). | Amends FR-CHAR-05 |
| FR-CHARX-21 | Roll specs, built server-side from committed data by `characterRolls(stats, sheet, kind, ref)` (`@shared/character-sheet`), table below. Unknown row → `not_found`; `spellAttack` needs `roll: attack` and `spellDamage` needs `damage`, else `conflict` ("No attack roll for Shield"). Mode on the d20 only; manual count per table; public per FR-CHAR-17. | |
| FR-CHARX-22 | The DM may `char.roll` for a custom or imported monster definition (NPC sheet): actor name = definition name; always `public: false` (a `public` field → `invalid`; the NPC sheet shows no public switches), because the definition name can leak a renamed or hidden creature ([ADR-0024](../architecture/adr/0024-definition-visibility.md)). Players: monsters stay `not_found`. | Amends FR-CHAR-09; #178 (OQ-CHARX-06) |
| FR-CHARX-23 | Every rollable number on the sheet is a shared roll control ([FR-DICE-24](dice-roll-log.md#6-functional-requirements)): 6 checks, 6 saves, 18 skills, initiative, per attack ~~Attack + Damage~~ *(N7: Attack, Damage, Attack + damage, FR-CHARX-41)*, per spell its rolls. Passives, AC, DC and speed are display only. DM public switches: one per category in each block header (FR-CHAR-22's rule). | Tier A |
| FR-CHARX-24 | Roll routes: `RollRoute.claim(store, characterId, kind, ref?)`, `ref` = `{attackId}` \| `{spellId}`; `SheetRollKind` gains the new kinds. ~~Combat's route claims `initiative`, `attack` and (OQ-CHARX-12) `spellAttack` **only for a spell with `damage`**, passing `ref` to `cbt.attack`; a spell attack without damage rolls plainly via `char.roll`. `damage`, `spellDamage`, `skill` are never claimed.~~ *(Superseded by FR-CHARX-43 and [FR-CBT-74](combat-tracker.md#6-functional-requirements).)* FR-CHAR-16/24 otherwise unchanged. *(N7: `SheetRollKind` gains `toHit`, `spellToHit`; every attack button asks the routes (FR-CHARX-43), combat claims `toHit`, `damage`, `attack` and their spell forms per FR-CHARX-43 (settled S1); `skill` stays unclaimed.)* | Extends OQ-CHAR-13 registry; amended N7 |
| FR-CHARX-25 | A `char.roll` never changes a counter or HP. Slots are ticked by hand. (Other features' rolls may, e.g. CBTX's death save.) | OQ-CHARX-09 |
| **UI** | | |
| FR-CHARX-26 | Window `char.sheet` keeps its kind and CHAR §7 geometry (320×440, min 280×320): no layout-floor change (#162). The tab strip scrolls horizontally at 320 px; content scrolls; the player may enlarge the window. Tabs: **Main**, **Actions**, **Features**, **Inventory**, **Notes**, then section tabs (§7.1). Header as FR-CHAR-03 plus "Draft" / "Locked" badges, an **Edit** toggle (hidden while the viewer may not edit), DM **Approve** (drafts) and **Lock** toggle. Layout per §7. *(Sprint 2: Main has no attack row, FR-CHARX-44; header and tab strip pinned, FR-CHARX-48.)* | Amends CHAR §7 (content only) |
| FR-CHARX-27 | Edit mode: inputs in place. Scalars commit on blur / Enter; long text (notes, feature text) on Save. A client mirror of the zod rules blocks invalid input inline (nothing sent). Every edit control is disabled while not `live` and while its own intent is in flight. Leaving edit mode never discards a committed value. | FR-CHAR-12 |
| FR-CHARX-28 | Remote change: a committed change shows ≤ 1 s in every field not being edited. A focused field whose value changed remotely (an `event` not caused by this client's own intent) keeps the local draft and shows a hint (`charx-field-changed`); committing it overwrites (FR-CHARX-15). Frames carry no actor, so the hint is inferred: player client → "Changed by the DM" (only the DM and the owner edit); DM client → "Changed by ‹owner name›" (NPC sheet: "Changed in another tab"). The owner's own other tab also reads "Changed by the DM": accepted. | Concurrency; protocol §3.3 |
| FR-CHARX-29 | Picker. Player: own characters, then a "Party" group of other PCs (summary card, FR-CHARX-32), then "New character…" (hidden while they have a draft). DM: every character (owner name, Draft / Locked marks), "New character…" (name + owner Select + "Start as draft"), and the NPC last opened via FR-CHARX-31. Sort per FR-CHAR-02 within each group. *(Sprint 2: the selection survives a reload, FR-CHARX-47.)* | Amends FR-CHAR-02 |
| FR-CHARX-30 | Player with no character: FR-CHAR-04 text gains a **Create character** Button → name Dialog → the new draft opens in edit mode with the hint "Fill in class, ability scores, AC and HP. Your DM approves the sheet." | |
| FR-CHARX-31 | NPC sheet: entities' `creatureActions` gains "Sheet" (DM): opens `char.sheet` on that definition. Custom: editable as above, CR + XP instead of level, HP max only (no HP control, no counters, no hit dice). Imported: read-only, lock icon, "Derive to customise". | #178 (OQ-CHARX-06) |
| FR-CHARX-32 | Summary card (other players' PCs): portrait, name, owner, "Level N Class", species, Down badge (CBTX's `deathState` when present, §7.1). Nothing else: no temp HP, death-save counts or effects. | #178 G6 (OQ-CHARX-05, OQ-CBTX-09) |
| FR-CHARX-33 | Inventory tab shows the character's wallet read-only from party-loot's `wallet` record (missing = all zero), with "Move coin in Party loot". | OQ-LOOT-16 follow-up |
| FR-CHARX-34 | Sheet sections registry and rendering: [§7.1](#71-sheet-sections-seam-combat-extras). | Seam |
| **Visibility** | | |
| FR-CHARX-35 | Other players get a character redacted to **one whitelist** in entities' visibility fn (ENT-owned), defined in the [ADR-0036](../architecture/adr/0036-full-sheet-derivation.md) ("Refines ADR-0024"): base `id, kind, name, portraitAssetId, ownerPlayerId` + `down` (#154) + `level, className, species` (CHARX) + `deathState` (CBTX). No other field. Tests assert against that shared list. | Entities' visibility line; #178 G6 |
| FR-CHARX-36 | `creature-sheet`: DM full; player full iff `ownerPlayerId = ctx.playerId` (the row's copy); otherwise hidden (other players' sheets, every NPC sheet). | ADR-0021 |
| FR-CHARX-37 | Every CHARX command lists every record whose visibility changes (owner change: `entity` + `creature-sheet`). | FR-CBT-27 rule |
| **Robustness** | | |
| FR-CHARX-38 | In-flight intent lost to a disconnect: a `set` edit is idempotent, so its field keeps the draft marked "Not saved" (`charx-field-unsaved`) and re-commits on the next blur / Enter once `live`. Create, row create and counter deltas are not idempotent: Toast "Connection lost — check the sheet before trying again" (FR-CHAR-12). | FR-SYNC-05 |
| FR-CHARX-39 | One transaction per command: entity row, sheet row, hook-changed instances, rolls / log entry and event-log row commit together or not at all. No sheet state in server memory. | FR-CBT-28 rule |
| FR-CHARX-40 | Fixtures and bundle `character-sheet-full` per §13; `fixtures:reset-load character-sheet-full` works from empty and is deterministic. | ADR-0017 |
| **Sprint 2 phase 1** (P2b) | | |
| FR-CHARX-41 | **Three attack buttons** (N7, DM-specified #188): attack rows and spell rows show **Attack**, **Damage**, **Attack + damage** per §6.1 "Shows on" (every attack row: all three; spells: by `roll` and `damage`), in that order, with the meaning, labels and test IDs of [§6.1](#61-n7-sheet-buttons), for DM and player, on PC and NPC sheets. Out of combat each sends `char.roll` with the §6.1 kind. | N7 |
| FR-CHARX-42 | `char.roll` kinds **`toHit`** (`attackId?`; absent = first attack) and **`spellToHit`** (`spellId`; the spell needs `roll: attack`, else `conflict` "No attack roll for ‹spell›"): one roll `1d20 + toHit` / `1d20 + spell attack`, category `attack`, label "Light crossbow attack" / "Guiding Bolt attack", one `roll` entry, manual = 1, mode on the d20. `attack` and `spellAttack` keep their meaning (to-hit + damage, one entry). `CharacterRolled.kind` gains both. Wrong ref combinations → `invalid` (FR-CHARX-20 rules). | Amends FR-CHARX-20/21 |
| FR-CHARX-43 | Each of the three buttons asks the roll routes (FR-CHAR-16, FR-CHARX-24) with its kind and `ref`; no claim → `char.roll`. A route may claim, supply `critExpressions`, or hide a button (FR-CHAR-24). **In combat** (settled S1, OQ-CHARX-21; semantics are combat-tracker's): Attack (`toHit` / `spellToHit`) → `cbt.attack {rolls: "toHit"}`; Damage (`damage` / `spellDamage`) → `cbt.rollDamage` (healing never routes: plain `char.roll`); Attack + damage (`attack` / `spellAttack`) → `cbt.attack` as today. Build order: this spec's `fix/charx-buttons` merges first with `toHit` / `damage` unclaimed (plain rolls in combat meanwhile); P2a's `fix/combat2-split-attack` then claims them. | N7 seam with P2a; settled S1 |
| FR-CHARX-44 | **Attacks on the Actions tab only** (N4; amends FR-CHAR-03, CHAR §7, FR-CHARX-26 Main): the Main tab drops the first-attack row (and its DM public switch); it keeps AC, HP, Speed, Init + **Initiative**, Prof, vitals, abilities, skills, main sections. Why: Main's Attack duplicated the Actions row with a different button set (it rolled to-hit + damage under the label "Attack"), which is N7's confusion. | N4 |
| FR-CHARX-45 | **DM cue for a draft** (G8): a **player's** `char.create` also calls `notify` (FR-NOTE-02) in its transaction: kind `charx-draft`, audience `dm`, text "‹player› made a character: ‹name›. Awaiting your approval", payload `{characterId}`, action `{label: "Review", owner: dm}` (pending). DM client view (FR-NOTE-19): "Review" opens `char.sheet` on that character (`openSheetFor`, no intent). `char.approve` of a draft resolves its pending `charx-draft` row(s) in the same transaction, after `CharacterApproved` (`{outcome: "approved"}`); approving a ready character changes nothing (no resolve, so no `conflict`). DM-created drafts get no card. No end rule (not encounter-scoped). The DM's Dismiss closes the card; the draft stays a draft. | G8 |
| FR-CHARX-46 | **Player cue on approval** (G8): `char.approve` that turns a draft ready also notifies the owner: kind `charx-approved`, audience `player` (`audiencePlayerId` = owner), info, text "‹name› was approved by the DM: ready to play", payload `{characterId}`. The owner gets an info toast (FR-NOTE-13/14) and a history row; offline → history + unread badge on return (no toast from a snapshot). | G8 |
| FR-CHARX-47 | **Picker memory** (report item 13; amends FR-CHAR-02): the selected creature is stored per browser, `localStorage` `pp.sheet.v1.<campaignId>.<dm \| playerId>` = `{selectedId}` (zod; id ≤ 64 chars), written on every picker change, `openSheetFor` and create. Applied after the first snapshot of a page load: still eligible (FR-CHARX-29, incl. the DM's last NPC) → selected, else FR-CHAR-04's default. Invalid or unavailable storage → memory only, console warning (FR-SHELL-17's rule). Never sent. | Item 13 |
| FR-CHARX-48 | **Pinned header** (report item 16): the sheet header (name row, badges, Edit / Approve / Lock, picker, `header` sections) and the tab strip stay at the top of the window; only the tab content scrolls. If the pinned part would take more than half the window body (small window), only the name row and the tab strip stay pinned; badges, buttons, picker and `header` sections scroll with the content *(integrator, #192: the default 320×440 window hit the old "everything scrolls" fallback for real characters)*. Window size and geometry unchanged (FR-CHARX-26; growing the window for creation: OQ-CHARX-22). | Item 16 |
| **Sprint 3: senses** (FOG v2) | | |
| FR-CHARX-49 | **Senses** = stat-block field `senses {visionFt, darkvisionFt, seesMagicalDarkness, seesInvisible?}` (§8.1), both kinds *(#207, OQ-CHARX-25)*: `visionFt` = how far the creature sees in fog (light it carries, e.g. a torch 30 ft); `darkvisionFt` = how far it sees without light; ints 0–120 (5e's largest darkvision; #207, FOG OQ-FOG-35), step 5; bools; `seesInvisible` per FR-CHARX-53. **Stored, not derived** (ADR-0036: no class / species data). ~~Absent = 0, 0, false, false (every existing creature, so FOG v2 changes nothing until set).~~ *(Sprint 4, #243 [1], [FOG OQ-FOG-51](fog-of-war.md#15-open-questions), decided at sprint-4 gate 1, #245 G14)* **`visionFt` is optional, 0–995, step 5; absent (or `senses` absent) = Normal = 999 ft** (the sentinel: 999 is never stored or typed, FOG review A9); a stored value, 0 included, is kept as typed (no row rewrite); darkvision stays 0–120, absent 0; bools absent false. So every creature without senses now sees 999 ft (bounded by walls and the map, FR-FOG-32 / -33); reductions come from Blinded (FR-FOG-48) or a lower stored value (Mira's 30 ft torch). The compendium adapter stops writing `visionFt: 0` for SRD darkvision (V6, seams S5, OQ-CHARX-30). `char.edit` key `senses` (whole object, strict; `seesInvisible` optional, absent = the stored value). Who: DM any character or custom monster; owner of a character unless locked (FR-CHARX-12) *(#207, OQ-CHARX-24)*, except Sees invisible (DM only, FR-CHARX-53); imported definitions read-only (FR-CHARX-18): their `darkvisionFt` comes from compendium's adapter (SRD "darkvision N ft"; blindsight / truesight stay text; see-through false), seams S6. | #201 |
| FR-CHARX-50 | **Sheet UI:** Main tab, a "Senses" line under the stat row: "Vision 30 ft · Darkvision 60 ft · Sees through magical darkness · Sees invisible" (zero / false parts omitted; all default → "Senses —"). Edit mode: two number inputs (±5 nudges) + a Switch "Sees through magical darkness" with Tooltip "Devil's Sight and similar: see normally in magical darkness". NPC sheet the same (DM); an imported definition's Senses line (read-only) reads imported definitions via `useDefinitions` once compendium's C2 lands (rulings C5). Display only: no roll button. *(Sprint 4)* View: absent vision reads **"Vision normal"** (first part; "Senses —" is gone), a stored value "Vision 30 ft", a stored 0 "No vision". Edit: the vision input takes 0–995 with a **Normal** toggle button (`charx-senses-vision-normal`, `data-state`) that clears the stored value (sends `senses` without `visionFt`); the input is disabled while Normal is on. | s4 |
| FR-CHARX-51 | **Visibility:** `senses` is not on the other-players whitelist (FR-CHARX-35 unchanged), so only the DM and the owner receive it; tokens get **no** copy (FOG reads the definition server-side; players learn a radius only as their own sight polygon). | Leak test |
| FR-CHARX-52 | **Vision follows edits:** a `senses` change re-derives vision on the **active** scene in the same transaction through FOG's line in entities' definition-changed hooks (FR-ENT-19, FR-FOG-35); other scenes are marked stale and re-derive on activation; `CharacterSheetEdited {op: set, fields: ["senses"]}` lists the `vision`, `fog-explored` and flipped token / prop / door rows; each player gets their own part. | One event |
| FR-CHARX-53 | **Sees invisible** *(#210)*: `senses.seesInvisible` bool, default false: the creature sees tokens the DM set Invisible ([FR-FOG-45 / -46](fog-of-war.md#6-functional-requirements)) inside its sight. **DM only** to edit, unlike the other senses: a player's `char.edit {set: {senses}}` whose `seesInvisible` differs from the stored value → `forbidden` (nothing written; the other keys alone stay owner-editable). Edit mode: Switch **Sees invisible** with Tooltip "Truesight, See Invisibility and similar"; for the owner it is disabled with Tooltip "Only the DM sets this". Visibility as FR-CHARX-51 (DM + owner); vision follows as FR-CHARX-52. Imported definitions: false (truesight stays text, seams S6). | V5 |
| **Sprint 4: weapons and uses** (track R, #243) | | |
| FR-CHARX-54 | **Weapon row** ([16]; amends §8.1 `attacks`, both kinds; OQ-CHARX-26 decided #245): an attack row gains optional **`bonus`** int 0–3 (a magic +N weapon) and **`extraDamage`** 0–2 × `{damage, type}`: `damage` = `NdM[+K]` with N 1–6, M ∈ 4/6/8/10/12, K 0–10 (dice capped so a crit card fits 4 KB, [MOD §12](effect-modifiers.md#12-performance--bandwidth)); `type` = a damage type, **required** (an extra part exists to carry a second type). The row's `damage` + `damageType` stay the **base part**. Stored `toHit` and `damage` are the weapon's numbers without the bonus. Additive: old rows parse; a row with neither field behaves as today. `char.putRow` validates; `PUT /api/entities` carries the fields it read (FR-CBT-43's whole-replace rule). | Brakka: Flame Tongue greatsword |
| FR-CHARX-55 | **Rolls with parts** (amends FR-CHARX-21 table): to-hit = `1d20 + toHit + bonus`; damage = the **base part** `damage` with `bonus` added to its constant (`2d6+4` + 1 → `2d6+5`), typed `damageType`, then each extra part as **its own roll** in the same entry (FR-DICE-26), in row order, each typed; label "Flame Tongue greatsword damage (slashing)", the extra roll "… (fire)". Manual count: +1 per extra part (Damage 1 + n; Attack + damage 2 + n); physical entries in part order. Mods (Rage +2) attach to the base part (as today). Out of combat (no crit, FR-CHAR-05) one entry: "Brakka — Flame Tongue greatsword damage: 2d6+5 (3 + 5) slashing + 2d6 (2 + 6) fire = 21". In combat combat-tracker routes the same rolls ([FR-CBT-81](combat-tracker.md#6-functional-requirements)); a route's `critExpressions` doubles every part. `sheetAttack` returns `{name, toHit, damage, damageType, bonus, extraDamage}`. | Server builds from committed data |
| FR-CHARX-56 | **Sheet UI** (Actions tab, view and edit): row line 1 "Flame Tongue greatsword" + Badge "+1" when `bonus` > 0; line 2 "+8 · 2d6+5 slashing + 2d6 fire" (bonus folded into the shown numbers), then the three buttons (§6.1, unchanged). Edit mode: a **Magic** Select (none, +1, +2, +3) and "Add damage type" (≤ 2 rows: dice Input + type Select + delete); a client mirror of FR-CHARX-54 blocks bad input inline. NPC sheet the same (DM). Fits 280 px: the second line wraps after the base part. | |
| FR-CHARX-57 | **Visibility and copies** of weapon fields: inside `statBlock`, so as today: DM and owner (characters), DM only (definitions, ADR-0024); not on the other-players whitelist (FR-CHARX-35). Combat cards and lines carry the rolled parts ([FR-CBT-81, -84](combat-tracker.md#6-functional-requirements)), never the row. Imported definitions: read-only; compendium may map SRD "plus 2d6 poison" attacks into `extraDamage` later (OQ-CHARX-28). | Leak test |
| FR-CHARX-58 | **Negative feature uses** ([14]; amends FR-CHARX-17, §8.2): a feature row's `used` may exceed `usesMax` up to **`usesMax + 9`** (uses left down to −9; OQ-CHARX-27 decided #245). `char.useResource {feature}` clamps to 0 … `usesMax + 9` (at the floor: no change, no event); Reset → 0; lowering `usesMax` clamps `used` to the new `usesMax + 9`. Slots and hit dice keep `0 … max`. CHARX's `spendFeatureUse(env, characterId, rowId, {overspend?})` returns `ok` \| `missing` \| `none-left` \| `floor`: without `overspend` it refuses at 0 left (as today); with it, it spends to the floor; `refundFeatureUse` gives back one, from below zero too. **Display**: Features row "−1 / 3" (uses left / max) in `hp.down` with every pip filled and a "−1" Badge; Tooltip "1 use more than the maximum — check with your DM"; the same on the DM's sheet and in MOD's Toggles block. | Human error at the table |

**Roll specs** (FR-CHARX-21). Bonus strings per FR-CHAR-21 (`1d20`, `1d20+3`, `1d20-1`). *(Sprint 4: an attack row's `bonus` adds to to-hit and the base part's constant; `extraDamage` adds one roll per part, FR-CHARX-55.)*

| Kind | Ref | Rolls | Category | Label example | Manual |
|---|---|---|---|---|---|
| `skill` | `skill` | 1d20 + skill bonus | `skill-check` | "Stealth check" | 1 |
| `attack` | `attackId?` | 1d20 + toHit; damage | attack; damage | "Light crossbow attack", "Light crossbow damage (piercing)" | 2 |
| `damage` | `attackId?` | damage only | `damage` | "Light crossbow damage (piercing)" | 1 |
| `spellAttack` | `spellId` | 1d20 + spell attack; damage if set (one entry, FR-DICE-26) | attack; damage / `healing` | "Guiding Bolt attack", "Guiding Bolt damage (radiant)" | 1–2 |
| `spellDamage` | `spellId` | damage / healing only (any `roll`; DC appended iff `roll: save`) | `damage` / `healing` | "Sacred Flame damage (radiant), DC 13 DEX", "Cure Wounds healing" | 1 |
| `toHit` *(N7)* | `attackId?` | 1d20 + toHit only | attack | "Light crossbow attack" | 1 |
| `spellToHit` *(N7)* | `spellId` | 1d20 + spell attack only (`roll: attack`) | attack | "Guiding Bolt attack" | 1 |

### 6.1 N7 sheet buttons

DM-specified (#188): a third button **Attack + damage**, and the three behave the same everywhere. P2b owns where they show, labels, the out-of-combat roll and test IDs; P2a ([combat-tracker](combat-tracker.md)) owns what each does when routed into combat (settled S1, FR-CHARX-43).

| Button (order) | Shows on | Out of combat (`char.roll`) | Rolls → entry | Manual | Shift / Ctrl | Test ID (+ `data-record-id` = row id) |
|---|---|---|---|---|---|---|
| **Attack** | every attack row; spells with `roll: attack` | `toHit` / `spellToHit` | d20 + to-hit → one `attack` entry | 1 | adv / dis | `charx-roll-attack` / `charx-roll-spell-attack` *(meaning changes: to-hit only)* |
| **Damage** ("Healing" for `effect: healing`) | every attack row; spells with `damage` (any `roll`) | `damage` / `spellDamage` | damage only → one `damage` / `healing` entry (DC in the label iff `roll: save`) | 1 | ignored (no d20) | `charx-roll-damage` / `charx-roll-spell-damage` |
| **Attack + damage** | every attack row; spells with `roll: attack` **and** `damage` | `attack` / `spellAttack` | to-hit + damage → one entry (FR-DICE-26) | 2 | adv / dis on the d20 | `charx-roll-attack-damage` / `charx-roll-spell-attack-damage` *(new)* |
| *In combat* (S1) | same buttons | roll routes first (FR-CHARX-43): Attack → `cbt.attack {rolls: "toHit"}`; Damage → `cbt.rollDamage` (Healing: plain); Attack + damage → `cbt.attack` | combat-tracker | — | — | same IDs |

- **Where:** Actions tab only (FR-CHARX-44): attack rows and spell rows; the NPC sheet the same (DM-only rolls, FR-CHARX-22). A spell with `roll: attack` and no damage shows Attack only; `roll: save` / `none` spells only Damage / Healing (as today).
- **NPC sheet in combat (accepted, review P2b-9):** the NPC sheet is a definition, not an instance, so its buttons stay DM-only plain rolls in combat (no route claims a definition, FR-CHARX-22); cards for a monster come from its Initiative row (**Attack ▸**, combat-tracker). That is the one place the three buttons don't route, by design.
- **Crit:** out of combat none (FR-CHAR-05; [OQ-CHARX-20](#15-open-questions)). In combat a route may pass `critExpressions` to Attack + damage (or Damage) per combat-tracker.
- **Public:** DM public switch per category in the block header (FR-CHAR-22 rule): `charx-public-attack` for Attack and Attack + damage, `charx-public-damage` for Damage.
- **Layout:** name and numbers on the first line, the three buttons right-aligned on the second (fits 280 px min width).

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense. No custom styling.

| Kind | Clients | Default open | Default geometry | Launcher |
|---|---|---|---|---|
| `char.sheet` | DM, player | player yes; DM no | unchanged: CHAR §7, 320×440, min 280×320 (#162 floors kept) | unchanged |

- **Main**: stat row (AC, HP + control, Speed, Init, Prof), *(sprint 3)* the Senses line (FR-CHARX-50), then vitals sections (§7.1), Abilities block (FR-CHAR-22), **Skills** block (18 rows: proficiency dot / double dot for expertise, name, ability abbreviation, signed bonus = roll button; passives under it), main sections. No attack row (N4, FR-CHARX-44).
- **Pinned** (FR-CHARX-48): header + tab strip stay at the top; the tab content scrolls under them.
- **Actions**: Attacks (row: name, "+4 · 1d8+2 piercing", then **Attack**, **Damage**, **Attack + damage**, §6.1); Spellcasting header (ability, "Spell attack +5 · DC 13", slot pips per level 1–9 with max > 0, click = use, Shift+click = restore, "Reset"); Spells grouped by level (cantrips first): name, C / R / prepared marks, roll buttons per row.
- **Features**: rows: name, source, text, uses pips (+ Reset). **Inventory**: wallet line, items (name, qty, equipped mark, notes), proficiency notes. **Notes**: background, alignment, notes text.
- **Edit mode**: the same layout with inputs; rows get Add / delete / drag handle; overrides via a small "Override" popover on each derived number (value + note, "Clear"). Overridden numbers show a marker; Tooltip "Derived +3 · Override: Bracers of Defence".
- **Locked** (player): no Edit toggle; header Badge "Locked" with Tooltip "Locked by the DM". Counters, HP and rolls still work.
- **DM view**: any character or NPC sheet; Approve, Lock, owner Select in edit mode. **Player view**: own sheets full; others as summary cards; never a monster.
- **States**: loading skeleton; empty per FR-CHARX-30; reconnecting = last values, controls disabled, banner; error Toast; unsaved field marked (FR-CHARX-38); sheet full → inline "Sheet is full".
- **Test IDs** (prefix `charx-`, new parts only; CHAR's `char-sheet-*` stay): `charx-tab` (+ `data-value`), `charx-edit-toggle`, `charx-draft`, `charx-locked`, `charx-approve`, `charx-lock-toggle`, `charx-create`, `charx-create-name`, `charx-create-owner`, `charx-create-draft`, `charx-create-submit`, `charx-picker-new`, `charx-summary` (+ `data-record-id`), `charx-skill` (+ `data-value` = skill key), `charx-skill-bonus`, `charx-roll-skill`, `charx-passive` (+ `data-value`), `charx-attack` / `charx-spell` / `charx-feature` / `charx-item` (+ `data-record-id` = row id), `charx-roll-attack`, `charx-roll-damage`, `charx-roll-spell-attack`, `charx-roll-spell-damage`, `charx-row-add` / `charx-row-delete` / `charx-row-move` (+ `data-value` = list), `charx-slot` (+ `data-value` = level, `data-used`), `charx-hitdie` (+ `data-value`), `charx-feature-use`, `charx-resource-reset`, `charx-field` (+ `data-value` = field path), `charx-field-changed`, `charx-field-unsaved`, `charx-override` (+ `data-value` = key), `charx-overridden`, `charx-wallet`, `charx-public-skill`, `charx-public-attack` (Attack and Attack + damage, §6.1), `charx-public-damage`, `charx-section` (+ `data-record-id` = section id), `charx-full`. *(Sprint 2)* `charx-roll-attack-damage`, `charx-roll-spell-attack-damage` (+ `data-record-id`); `charx-roll-attack` / `charx-roll-spell-attack` now mean to-hit only (§6.1); `charx-header` (pinned part, `data-pinned` = `true` \| `false`). *(Sprint 3)* `charx-senses` (display line), `charx-field` with `data-value` = `senses.visionFt` / `senses.darkvisionFt`, *(s4)* `charx-senses-vision-normal` (`data-state`), `charx-senses-darkness` (Switch, `data-state`), `charx-senses-invisible` (Switch, `data-state`, `data-disabled` for the owner; #210). The G8 cards use notifications' IDs (`note-toast`, `note-toast-action`, `note-history-row` + `data-record-id`); walkthroughs match their text. *(Sprint 4, track R)* `charx-attack-bonus` (Badge; edit Select, `data-value` = 0–3), `charx-attack-extra` (+ `data-value` = index; edit row), `charx-attack-extra-add`, `charx-attack-extra-type`, `charx-attack-extra-delete`; `charx-feature-use` gains `data-left` (may be negative) and `charx-feature-overspent` (the "−1" Badge).

### 7.1 Sheet sections seam (combat-extras)

Combat-extras owns temp HP, death saves and conditions (data, rules, commands, events, visibility). This spec owns where they appear. Settled by the orchestrator (D/S seam) with [combat-extras](combat-extras.md); this contract supersedes CBTX's earlier `{id, render(store, characterId, client)}`.

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
- **CBTX's sections** (settled; kinds `["character"]`, both clients; permissions per [CBTX §7.1](combat-extras.md), OQ-CBTX-07):

| Section id | Slot | `available` | Shows |
|---|---|---|---|
| `cbtx.temp-hp` | `vitals` | always | Temp HP |
| `cbtx.death-saves` | `vitals` | `deathState != null` | Death-save successes / failures |
| `cbtx.effects` | `header` | always | Condition / effect chips; owner "Concentrate…", DM add / edit / end from the chip row's menu |

- **What CHARX exposes** for sections (pure, `@shared/entities`, overrides honoured): `abilityMod`, `proficiencyBonus`, `saveBonus(stats, ability)`, `checkBonus`, `spellSaveDc`, `spellAttackBonus`; record fields `hpCurrent`, `statBlock.hpMax`; on `creature-sheet` (owner + DM only) `spells[].concentration`.
- **Concentration save**: CBTX uses `saveBonus(stats, "con")`; a `save.con` override wins. That is exactly what the sheet's CON Save button rolls. The resolver lands in `fix/charx-core`, which merges before the CBTX build.
- **HP control**: the sheet keeps `char.adjustHp`. CBTX wires it through its `hpRules.apply`: temp HP absorbs first, a hit at 0 HP adds a death-save failure, concentration cards. The sheet UI does not change.
- **Play state vs sheet data**: `tempHp`, `deathSuccesses` and `deathFailures` are CBTX-owned play-state columns on `entity`, like `hpCurrent`. Effects live in CBTX's `effect` table. None of them is in `statBlock` or `creature-sheet`, and CHARX models no such field. The summary card (FR-CHARX-32) shows only Down / `deathState` from CBTX's data.

## 8. Data model

### 8.1 Stat block additions (entities' JSON leaf, zod only, no column)

| Field | Kinds | Type | Notes |
|---|---|---|---|
| attacks | both | 0–**20** × `{id?, name 1–40, toHit, damage, damageType?}` *(sprint 4: + `bonus?` int 0–3, `extraDamage?` 0–2 × `{damage: NdM[+K] N 1–6 M 4–12 K 0–10, type: DamageType}`)* | Was 0–1; `id` from `ctx.ids` (FR-CHARX-16); sprint 4: FR-CHARX-54. Max 110 B more per row (measured, MOD §12) |
| skills | both | `{<skill>: "proficient" \| "expertise"}`; absent = none | 18 SRD skills, keys camelCase (`sleightOfHand`); needs `abilities` |
| overrides | both | `{<key>: {value int −20…40, note? ≤ 60}}` | Keys FR-CHARX-06 |
| spellcasting | both | `{ability, slots: {1…9: int 0–9}}` | Slot maxima; needs `abilities` |
| classes | character | 1–4 × `{name 1–30, level 1–20, hitDie d6\|d8\|d10\|d12, subclass? ≤ 30}` | Server writes `level`, `className` (FR-CHARX-04) |
| species | character | text 0–40 | In the summary (FR-CHARX-35) |
| senses *(sprint 3; s4)* | both | `{visionFt? 0–995 step 5, darkvisionFt 0–120 step 5, seesMagicalDarkness bool, seesInvisible? bool}`; *(s4)* absent / no `visionFt` = Normal (999 ft), darkvision 0, false, false | FR-CHARX-49 / -53; not on the summary whitelist; `seesInvisible` DM-only to edit |

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
| spells | **JSON leaf**, 0–40 × `{id, name 1–60, level 0–9, prepared, concentration, ritual, roll: none\|attack\|save, saveAbility?, damage?, effect: damage\|healing, damageType?, notes ≤ 200}` | `damage` = entities' grammar; `saveAbility` iff `roll: save`; `roll: attack` ⇒ `effect: damage` |
| features | **JSON leaf**, 0–30 × `{id, name 1–60, source ≤ 40, text ≤ 600, usesMax? 1–20, used, reset?: short\|long}` | `reset` is a label only (no rest buttons). *Sprint 4:* `used` int 0 … `usesMax + 9` (was ≤ `usesMax`; FR-CHARX-58) |
| items | **JSON leaf**, 0–80 × `{id, name 1–60, qty 0–9999, equipped, notes ≤ 120}` | No weight |
| notes | text ≤ 4000 | Rendered as text |
| slotsUsed | **JSON leaf** `{1…9: int}` | ≤ slot max |
| hitDiceUsed | **JSON leaf** `{d6…d12: int}` | ≤ levels with that die |
| createdAt, updatedAt | timestamp | `ctx.clock` |

- **Relations**: Entity 1—0..1 creature-sheet; Player 1—* character (unchanged). Wallet: party-loot's derived `wallet` (read only).
- **Derived** (`@shared`, never stored): FR-CHARX-05 values, overridden flags, Draft / Locked display, roll specs, summary card.
- **Persisted runtime state**: `hpCurrent` (entity, CHAR), counters (sheet). Edit drafts: client memory only. ~~Picker selection: client memory only.~~ *(Sprint 2)* Picker selection: browser `localStorage` `pp.sheet.v1.<campaignId>.<dm \| playerId>` (FR-CHARX-47), never sent. G8 cards are `notification` rows (notifications' table, kinds `charx-draft`, `charx-approved`); no new field, table or record type.
- **Migration of MVP data**: none needed. New stat-block fields are optional; the attacks limit only grows; `creature_sheet` is a new table (drizzle push now, generated migration at release). Existing characters (char-mira etc., real data) have no sheet row → ready, unlocked, empty groups; legacy attacks get ids on first write. No backfill.

## 9. API & events

**REST**: none new. Sheet edits use WS intents for both roles, characters **and** NPC sheets: one per-field-merge path. That refines ADR-0021 D (prep CRUD over REST) for NPC sheet edits; the refinement is in the [ADR-0036](../architecture/adr/0036-full-sheet-derivation.md) (accepted #178). Entities' `POST` / `PUT /api/entities` stay for the creature form (FR-CBT-43): a whole replace that carries the new stat-block fields it read. **Coexistence:** both write the same row in commit order. `char.edit` overwrites only the fields it names; a later `PUT` overwrites the whole stat block with what the form loaded (last write wins per field vs whole). `PUT` never touches `creature-sheet`.

**WS intents** (default deny; none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `char.create {name, ownerPlayerId?, draft?}` | DM, player | FR-CHARX-08; player sending `ownerPlayerId` / `draft` → `invalid` | `{characterId}` |
| `char.approve {characterId}` | DM | FR-CHARX-10 | `{}` |
| `char.setLock {characterId, locked}` | DM | FR-CHARX-12 | `{}` |
| `char.edit {creatureId, set}` | DM, player (own, unlocked) | FR-CHARX-15, §10. `set` keys: `name, species, background, alignment, classes, ac, hpMax, initBonus, speed, abilities, saveProficiencies, skills, overrides, proficiencyNotes, spellcasting, notes`, *(sprint 3)* `senses` (FR-CHARX-49; a player changing `senses.seesInvisible` → `forbidden`, FR-CHARX-53); `level`, `className` only while `classes` is absent (else `invalid`); NPC `cr`. **DM only** (player → `forbidden`): `ownerPlayerId`; `size` (token footprints follow via hooks); `portraitAssetId` (via `assets.require`, FR-ENT-08; players have no asset library, ADR-0023) | `{}` |
| `char.putRow {creatureId, list, row}` / `char.deleteRow {…, rowId}` / `char.moveRow {…, rowId, toIndex}` | DM, player (own, unlocked) | FR-CHARX-16; *(sprint 4)* attack rows per FR-CHARX-54 | `{rowId}` / `{}` / `{}` |
| `char.useResource {characterId, resource, delta?, reset?}` | DM, player (own; locked ok) | FR-CHARX-17; exactly one of `delta`, `reset`; *(sprint 4)* feature rows clamp to `usesMax + 9` (FR-CHARX-58) | `{before, after}` |
| `char.roll {…, skill?, attackId?, spellId?}` | DM, player | FR-CHARX-20–22; *(N7)* kinds `toHit`, `spellToHit` (FR-CHARX-42) | `{rollIds, entryId}` |

**Record types**

| Type | Scope | Visibility | Snapshot |
|---|---|---|---|
| `creature-sheet` (new) | campaign | FR-CHARX-36 | the campaign's rows |
| `entity` (entities) | campaign | FR-ENT-15 + FR-CHARX-35 whitelist | unchanged |

`creature-sheet` registers in character-sheet's own feature `register` (`r.recordType`, `src/server/features/character-sheet/index.ts`); there is no central record-type file.

**Domain events** (WS: generic record changes, `cause.name` = event type)

| Event | Payload | Changes → visibility | Logged | Undoable |
|---|---|---|---|---|
| `CharacterCreated` | `{characterId, ownerPlayerId, status}` | `entity` + `creature-sheet` upserts → DM, owner full; others redacted `entity` only | yes | no |
| `CharacterApproved` | `{characterId}` | `creature-sheet` → DM, owner | yes | no |
| `CharacterLockSet` | `{characterId, locked}` | `creature-sheet` → DM, owner | yes | no |
| `CharacterSheetEdited` | `{creatureId, op: set \| putRow \| deleteRow \| moveRow, fields?, list?, rowId?}` (keys and ids, never values) | `entity` and / or `creature-sheet` + hook-changed instances (tokens, combatants) → each by its own rule | yes | no |
| `CharacterResourceUsed` | `{characterId, resource, before, after}` | `creature-sheet` → DM, owner | yes | no |
| `CharacterRolled` (CHAR) | gains `skill?`, `attackId?`, `spellId?`; `kind` gains the new kinds *(N7: + `toHit`, `spellToHit`)* | `game-log-entry` per FR-DICE-13/15 | yes | no |

**Sprint 2 (G8):** `char.create` by a player also lists the `charx-draft` `notification` upsert and emits `NotificationCreated` after `CharacterCreated`; `char.approve` of a draft lists the resolved `charx-draft` row(s) (`NotificationResolved`) and the new `charx-approved` row (`NotificationCreated`), after `CharacterApproved`. Same transaction each.

| Notification kind (server registry, FR-NOTE-03) | Payload | Action | DM | Owning player | Other players |
|---|---|---|---|---|---|
| `charx-draft` | `{characterId}` | "Review", owner DM (pending) | full; toast + bell Pending | hidden (audience `dm`) | hidden |
| `charx-approved` | `{characterId}` | none (info) | full (history; no toast) | full; info toast | hidden (audience = owner) |

- **Internal (new, needed from entities, OQ-CHARX-19):** `entities.createIn(env, body)` and `entities.updateIn(env, id, next) → RecordChange[]` (the `POST` / `PUT` path minus HTTP, hooks included). **CHARX provides:** `sheetAttack(env, creatureId, ref) → {name, toHit, damage, damageType}` for combat's `cbt.attack` (OQ-CHARX-12); a definition-changed hook (owner copy, counter clamp).
- **Client registries:** sheet sections (new, §7.1); roll routes (extended contract, FR-CHARX-24; *N7:* kinds `toHit`, `spellToHit`); `creatureActions` "Sheet" line (DM); *(G8)* notification views: DM `charx-draft` ("Review" handler) + `charx-approved`, player `charx-approved`.

## 10. Permissions

| Action | DM | Owner player | Other player | Server check |
|---|---|---|---|---|
| View | full, any creature | own sheet full | summary only; NPCs never | FR-ENT-15 + FR-CHARX-35/36 |
| Create character | for any player, ready or draft | own, draft, one open draft | — | FR-CHARX-08 |
| Approve, lock / unlock, change owner | ✓ | ✗ | ✗ | FR-CHARX-10/12/13 |
| Draft card: see, Review, Dismiss (G8) | ✓ | ✗ (never receives it) | ✗ | FR-NOTE-06/11; FR-CHARX-45 |
| Approval card (G8) | sees | sees (own) | ✗ | FR-NOTE-06; FR-CHARX-46 |
| Edit fields and rows | any character, custom NPC | own, **unless locked** | ✗ | FR-CHARX-15/16/18 |
| Counters, current HP | any character | own, also locked | ✗ | FR-CHARX-17, FR-CHAR-09 |
| Roll | any character (public override); any definition (always DM-only) | own; always public | ✗ | FR-CHAR-09/17, FR-CHARX-22 |
| Edit `size`, portrait | ✓ | ✗ | ✗ | FR-CHARX-15, §9 |
| Edit senses *(sprint 3)* | any character, custom NPC | own, **unless locked** | ✗ (never sees them) | FR-CHARX-49 / -51 |
| Edit Sees invisible *(#210)* | any character, custom NPC | ✗ (sees it, Switch disabled) | ✗ | FR-CHARX-53 |
| Edit imported definition | ✗ | ✗ | ✗ | `forbidden` |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** controls disabled; last values shown; FR-CHARX-38 for lost intents. Snapshot restores sheet, counters and lock state; selection kept if still eligible.
- **DM disconnect / reconnect:** same. Nothing waits on the DM; a draft stays playable until approved.
- **Server crash mid-action:** FR-CHARX-39. Unsaved field drafts (client memory) are lost on reload; committed edits survive.
- **Concurrent edits (player + DM):** different fields or rows both survive (per-field / per-row writes). Same field: last commit wins; the other editor sees FR-CHARX-28's hint. Row deleted while edited → `not_found` Toast, the row closes. Lock committed while the player edits → `forbidden` "Locked by the DM", edit mode closes, drafts dropped. Counter clicks are deltas, so DM and owner clicks both apply. Combat damage + sheet edit of HP max: FR-CHARX-15's HP rule at commit (full HP follows, else clamp).
- **Two tabs of one player creating:** the second `char.create` → `conflict` (one open draft).
- **Owner or campaign change while viewing:** FR-CHAR-04 (first eligible, else empty); the old owner's `creature-sheet` delete arrives in the same event.
- **Edit vs roll race:** rolls use values at commit; a deleted row → `not_found` Toast.
- **Creature form vs sheet (DM):** §9 coexistence: per field vs whole, commit order; `creature-sheet` untouched by `PUT`.
- **Invalid / malicious input:** strict zod on every intent (unknown keys, bounds, dice grammar, row limits, size caps); player sending `ownerPlayerId`, `draft`, `public`, `size` or `portraitAssetId` → `invalid` / `forbidden`; `public` on a definition roll → `invalid`; names and text rendered as text.
- **Sprint 2 (G8):** DM offline when a player makes a draft → the card waits (pending rows are pinned in the snapshot, FR-NOTE-12); on rejoin "1 pending action" (FR-NOTE-15). Player offline at approval → history row + unread badge, no toast. Crash: create + card, approve + resolve + approval card each commit together or not at all. Two DM tabs approve at once → the second is a no-op (already ready: no resolve, no second approval card). Draft renamed or re-owned before approval → the card's text keeps the old words; Review opens the current sheet. Drafts made before this build have no card (accepted). Character name in the text: only the DM (`charx-draft`) and the owner (`charx-approved`) receive it.
- **Sprint 3 (senses):** a senses edit and a token move commit in order; each re-derive reads the committed state, so the later commit's vision wins. Lock committed while the owner edits senses → `forbidden` as other fields. Disconnect mid-edit → FR-CHARX-38 (`set` is idempotent). Crash: the sheet edit and its vision rows commit together (FR-CHARX-39). A player toggling "sees through" on their own unlocked sheet sees inside darkness at once: by design, the DM locks sheets they want fixed (OQ-CHARX-24). Sees invisible can't be self-granted (FR-CHARX-53, #210): a crafted owner `char.edit` that flips it is `forbidden`, even on an unlocked sheet; one that leaves it unchanged (or omits it) passes.
- **Sprint 4 (weapons, uses):** a weapon row edited between an Attack and its Damage: the Damage rolls the row as committed then (parts may differ from the card's to-hit row; the DM sees the new parts). Disconnect mid-edit of a weapon row: row writes aren't idempotent → FR-CHARX-38's Toast. Pips past zero by DM and owner at once: both deltas apply (−2), the floor stops at −9. A crash between a toggle's spend and its effect: one transaction (MOD FR-MOD-30), both or neither. Lock: weapon rows locked like other rows; counters (incl. below zero) stay with the owner (FR-CHARX-12).
- **Sprint 2 (N7):** `toHit` on a row deleted meanwhile → `not_found` Toast (as other rolls). Physical dice: Attack and Damage ask for one entry, Attack + damage for two. Damage ignores Shift / Ctrl (no d20; FR-DICE-04 would refuse it). Picker memory (FR-CHARX-47): the stored character lost eligibility (reassigned, other campaign) → default, entry overwritten at the next change.

## 12. Performance & bandwidth

- `entity` stays small: ≤ 12 KB block cap, typical 2–4 KB, so a combat HP upsert stays ≈ CHAR §12. `creature-sheet` typical 5–15 KB, cap 48 KB; sent to the DM and the owner only.
- Snapshot growth: DM ≈ Σ sheets (6 PCs + 10 NPC sheets ≈ 150 KB typical); a player ≈ their own sheet(s). Against the DM ceiling of 768 KiB (protocol CON-44, #142): the heavy DM snapshot is ≈ 491 KB today, +150 KB ≈ 640 KB fits; caps bound the worst case. `snapshot-size.test.ts`'s heavy scenario gains `creature-sheet` rows (§13).
- Edits commit on blur / Save, not per keystroke: ≤ a few per minute. Event-log rows carry before / after of changed records (≤ 2 × 48 KB worst, typical ≤ 20 KB).
- Target: commit → other client ≤ 1 s over the tunnel.
- Sprint 3: `senses` on all 19 heavy-harness DM entity rows = **+1,349 B** (measured, FOG §12 probe; seams re-run: 21 stat-block rows, +1,491 B); a player gets only their own characters'. A senses edit's event adds FOG's re-derive rows (≈ 2–5 KB to the owner, FOG §12). *(#208)* DM ceiling now 1 MiB. *(#210)* `seesInvisible` adds ≈ 22 B to a stat-block row that sets it (absent = false, omitted); not re-measured.
- Sprint 4 (measured, [MOD §12](effect-modifiers.md#12-performance--bandwidth)): `bonus` + 2 max extra parts = +110 B per attack row (typical +57 B); heavy DM +7,590 B (69 rows), a player +440 … +660 B. Feature `used` below zero: 0 B (same field).
- Sprint 2: G8 adds ≤ 2 small `notification` rows (< 0.5 KB) per character's lifetime; pending `charx-draft` rows are pinned in the DM snapshot until approved or dismissed (a handful; CON-44 unaffected). `toHit` = one roll, one entry.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:`, port 0, seeded `ctx.ids` / `ctx.dice`; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs, e.g. `test("FR-CHARX-12 locked sheet rejects player edit", …)`.

**Fixtures** (setups run with DM authority, FR-FIX-13; owner `character-sheet-full`)

| Key | Requires | Contents | `session-sim` |
|---|---|---|---|
| `char-mira-full` | `char-mira` | Mira: classes Fighter 1 d10, species "Human", skills Athletics + Perception, override `passive.perception` 14 note "Alert (test)"; 2nd attack "Light crossbow" +4 / 1d8+2 piercing; features Second Wind (uses 1, short), Fighting Style; items Shortsword, Light crossbow, Bolts ×20; notes "MIRA-NOTE-7" | yes |
| `char-mira-locked` | `char-mira-full` | `char.setLock` Mira locked | no |
| `char-sela` | `player-2` | **Draft** "Sela" for `player-2` (as a player would make it): Cleric 1 d8, species "Dwarf", WIS 16, Medicine + Insight, spellcasting WIS, slots 1: 2; spells Sacred Flame (save DEX, 1d8 radiant), Guiding Bolt (attack, 4d6 radiant), Cure Wounds (`roll: none`, 1d8+3 healing), notes "SELA-NOTE-3" | no |
| `npc-elite-sheet` | `enemy-custom` | DM edits Elite Goblin Warrior: Stealth expertise, 2nd attack "Shortbow" +5 / 1d6+3 piercing, feature "Nimble Escape", notes "NPC-NOTE-9" | yes |
| `vision-senses` *(sprint 3)* | `char-mira`, `char-thorn` | **Patch** *(seams S10)*: one `char.edit {set: {senses}}` per character, no other field (composes with R's `trg-thorn` and any other unit on these sheets). Mira: vision 30 ft, darkvision 0 ("torch"). Thorn: darkvision 60 ft, sees through magical darkness (Devil's Sight). Used by FOG's bundle `vision` *(s4: unchanged; both store `visionFt` explicitly, so their sight stays sprint 3's under the 999 ft default)* | no |
| `vision-brakka` *(sprint 4, owner FOG)* | `char-brakka` | Patch: Brakka vision 30 ft, darkvision 60 ft. In **session-sim-8** (FOG review A14; session-sim-7 itself changes only through the 999 ft default: Brakka now sees Normal) | — |
| `vision-legacy` *(sprint 4, owner FOG)* | `char-mira`, `char-thorn` | Patch: senses all 0 / false, for bundles written before the default changed (FOG §13) | no |

**Bundle `character-sheet-full`** = bundle `character-sheet` + `enemy-1` + `enemy-custom` + `char-mira-full` + `char-mira-locked` + `char-sela` + `npc-elite-sheet` + `loot-1` + `loot-wallets`. Game-log settings at defaults (all hidden). *Sprint 2:* no new fixture or bundle; G8 cards come from players' creates in the walkthrough (fixture drafts are made as DM, so they carry no card).

| Level | What | Fixtures |
|---|---|---|
| Unit | Schemas: every §8 bound, row limits, size caps, `skills` / `spellcasting` need `abilities`, `saveAbility` iff `roll: save`, `roll: attack` with `effect: healing` → `invalid`, classes Σ ≤ 20 and `className` ≤ 40. Derivation: skill none / prof / expertise, passive, spell attack / DC, hit dice, each override key, `proficiency` override feeding saves and skills, clear → derived. `characterRolls` per kind (labels, categories, manual counts, `healing`, DC in label). Roll-route `ref` passed; `damage` / `skill` never claimed; a spell attack without damage not claimed. FR-CHARX-28 hint text per client. Sections: order, slot, `clients`, `kinds`, `available`, throwing section isolated. Field draft + "Changed by" logic; unsaved re-commit only for `set`. **Sprint 2:** `FR-CHARX-41 three buttons` (per attack row and per spell form (`attack` + damage, `attack` without damage, `save`, `none` + healing): which buttons render, order, labels, test IDs; NPC sheet the same, no public switch); `FR-CHARX-42 toHit specs` (labels, category, manual 1, `spellToHit` on a `save` spell → `conflict`, `toHit` with `spellId` → `invalid`); `FR-CHARX-43 routing` (each button asks the routes with its kind + ref; a test route claiming only `toHit` takes Attack, leaves the other two plain; `hidden` hides that button only); `FR-CHARX-44 Main has no attack` (no `char-sheet-roll-attack`; Actions lists every attack incl. legacy); `FR-CHARX-47 picker memory` (round trip per (campaign, owner); ineligible id → default; corrupt / throwing storage → memory); `FR-CHARX-48 pinned header` (content scrolls, header stays; pinned part > half the body → unpinned) | In-code |
| Integration | Each command: rows + event + log in one tx, IDs from `ctx`, rollback → none. **Permission matrix** (DM / owner / other player × character / draft / locked / custom NPC / imported / other campaign × every intent). Player `ownerPlayerId` / `draft` / `public` / `size` / `portraitAssetId` → rejected. DM roll on a definition: entry `public: false`; `public` → `invalid`. **FR-CHARX-15 HP:** new draft HP max 1 → 9 → `hpCurrent` 9; ready character at full HP 10 → 12 → 12; at 7/10 → 12 → 7; 10 → 6 → 6. One-open-draft `conflict`. Approve no-op. Lock: player edit `forbidden`, counters + HP + roll ok. Per-field merge: DM `ac` and player `hpMax` edits interleaved → both kept. Row put / delete / move; unknown id `not_found`; limits `conflict`. Counters clamp; lowering slot max clamps used. Owner change: old owner gets `creature-sheet` delete, new owner full. `PUT` keeps sheet data; hook clamps counters. Name edit refreshes token / combatant copies (FR-ENT-19). Draft excluded from whole-party start (with combat, OQ-CHARX-13). **Leak scan:** `player-2` frames never contain Mira's `statBlock` fields, "MIRA-NOTE-7", "NPC-NOTE-9", any `creature-sheet` row but Sela's; `player-1` never "SELA-NOTE-3"; redacted Mira has exactly the keys of entities' shared whitelist (FR-CHARX-35; the test imports the list, not a copy). Convergence; restart → identical snapshots. **Snapshot size:** `src/server/ws/snapshot-size.test.ts` heavy scenario gains 6 `creature-sheet` rows at typical size and stays under the CON-44 DM ceiling (768 KiB; 1 MiB from V0, #208). **Sprint 2:** `FR-CHARX-42 toHit` (one roll, one entry, `CharacterRolled {kind: toHit, attackId}`; player public, DM per category); `FR-CHARX-45 draft card` (player `char.create` → `charx-draft` pending, audience `dm`, in the same tx, rollback → neither; DM `char.create {draft: true}` → no card; `char.approve` → card `resolved {outcome: approved}` + `charx-approved` info to the owner in one tx; approve again → no event; DM Dismiss → draft unchanged); `FR-CHARX-46` (approval card audience = owner). **Leak scan (G8):** `player-1` and `player-2` frames never carry a `charx-draft` row; `player-1` never `player-2`'s `charx-approved`. Restart with a pending draft card → still pending in the DM snapshot | `character-sheet-full` |
| Unit / integration (sprint 4) | `FR-CHARX-49 vision default`: no `senses` / no `visionFt` → Normal (999) on the line and in FOG's sight; 995 ok, 999 and 1000 → `invalid` (Normal is only "absent"); stored 0 kept; darkvision 125 still `invalid`; a `char.edit` without `visionFt` clears a stored value. `FR-CHARX-50`: "Vision normal" / "Vision 30 ft" / "No vision"; Normal button toggles and disables the input; owner and DM both (lock applies). Walkthrough: FOG §13 sprint 4 (Mira's sheet → Normal, step 23's Blinded) | In-code / `vision-party` |
| Unit (sprint 3) | `FR-CHARX-49 senses schema` (bounds 0–120, 125 → `invalid`, step 5, strict keys, absent = defaults, both kinds); `FR-CHARX-50 senses line` (parts omitted at 0, "Senses —", edit inputs + Switch, NPC sheet, no roll button); `FR-CHARX-53` (Sees invisible part on the line; Switch disabled for the owner with its Tooltip, enabled for the DM; absent key = false) | In-code |
| Integration (sprint 3) | `FR-CHARX-49` permissions: owner sets Mira's senses; locked Mira → `forbidden`; `player-2` on Mira → `forbidden`; imported Goblin → `forbidden`; DM on a custom NPC ✓. `FR-CHARX-51` leak: `player-2` frames never contain Mira's `senses` / `visionFt`, `player-1` never Thorn's; no token carries senses. `FR-CHARX-52`: Thorn moved to (11, 9) (in `vision-crypt`'s darkness `[12.5, 9, 1.5]`), `seesMagicalDarkness` off → one `CharacterSheetEdited` with `player-2`'s `vision {blind: true}` and the deletes; with a second Thorn token placed on the inactive Cellar, only Goblin Ambush re-derives (Cellar marked stale). `FR-CHARX-53` (#210): owner `player-2` sets Thorn's `seesInvisible` true → `forbidden`, nothing written; owner sends senses with `seesInvisible` unchanged or omitted → ok; DM sets it → one `CharacterSheetEdited` whose re-derive gives `player-2` the invisible Goblin in Thorn's sight (FOG §13 invisible leak tests); `player-1` frames never carry Thorn's `seesInvisible` | `vision` |
| E2E (thin) | `player-1`: create "Brin", set DEX 16 + Stealth proficient, roll Stealth → line "+5"; DM ~~approves~~ *(G8)* gets the `charx-draft` toast, Review → Brin's sheet, Approve; `player-1` gets the approval toast; `player-2` sees Brin's summary card only. *(N7)* `player-1` Mira's Light crossbow: Attack → a to-hit-only line; Damage → damage line; Attack + damage → one line with both | `character-sheet-full` |

**Sprint 4 (track R):** fixtures `weapon-flame-tongue`, `uses-rage-spent`, bundle `rules-effects`, named tests `FR-CHARX-54 weapon row schema`, `FR-CHARX-55 +1 to hit and damage`, `FR-CHARX-58 negative uses` and walkthrough steps 1–3, 13 are in [MOD §13.1](effect-modifiers.md#131-sprint-4-track-r-mod-cbt-cbtx-charx). Leak: `player-2` frames never carry Brakka's `extraDamage` / `bonus` (stat block); no monster definition's attack rows reach a player.

**Browser walkthrough** — `bun run build`; `fixtures:reset-load character-sheet-full --profile verify`; `start --profile verify` (Herdr pane). Contexts A DM (`pw-dm`), B `player-1`, C `player-2`; B's and C's WS frames logged via `page.on('websocket')`. Teardown: stop, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, Sheets | B, C open links | A picker: Mira (Locked), Pip, Sela (Draft), Thorn. B: own Mira (Locked badge, no Edit) and Pip; Party group: Thorn, Sela. C: own Sela (Draft, editable) and Thorn; Party group: Mira, Pip |
| 2 | — | B: Mira, Skills: Shift+Athletics; Actions: Light crossbow **Attack + damage**; Features: use Second Wind | Log: "Mira — Athletics check (adv): … + 4"; one line "+4" to-hit and 1d8+2; Second Wind 1/1 used. Passive Perception shows 14 with override marker. Main tab: no attack row (N4) |
| 3 | *(G8)* Watch the toast region; then the bell | B: New character → "Brin"; edit: Rogue 1 d8, DEX 16, Stealth expertise, AC 14, HP max 9, Dagger +5 / 1d4+3, note "BRIN-NOTE-1"; override Stealth to +8 note "Test", then Clear; roll Stealth | Draft badge; HP 9 / 9 (draft follows HP max); override marker + Tooltip "Derived +7 · Override: Test", gone after Clear; Stealth +7 (3 + 2 × 2); line "Brin — Stealth check: … + 7". A ≤ 1 s after create: sticky toast "Player 1 made a character: Brin. Awaiting your approval" with **Review**; bell Pending lists it. B, C: no such toast or row (frames: no `charx-draft`) |
| 4 | — | C: picker → Brin | Summary card: name, "Level 1 Rogue", owner Player 1; no numbers. C frames: no Brin stat block, no "BRIN-NOTE-1", no Brin `creature-sheet` |
| 5 | Brin: Edit, AC 15, while B edits HP max 10 | B: commits HP max 10 | Both: AC 15, HP 10 / 10 (≤ 1 s each side) |
| 6 | Toast **Review** (opens Brin's sheet); Approve Brin, then Lock | B in edit mode | Draft badge gone; A's card "Resolved", toast gone. B: info toast "Brin was approved by the DM: ready to play" (G8); C: none. B's edit mode closes, Locked badge; B still rolls Stealth and uses HP Damage 2 → 8/10 |
| 7 | — | C: Sela: Guiding Bolt **Attack + damage**; Sacred Flame Damage; tick slot 1 | Lines "+5" (2 + 3) with 4d6 radiant; "Sacred Flame damage (radiant), DC 13 DEX"; slot pip 1/2 used |
| 8 | Creatures → Elite Goblin Warrior → Sheet; roll Stealth; edit Shortbow +6. Then Creatures → Goblin (SRD) → Sheet | — | Stealth row expertise; no public switch on the NPC sheet; DM-only line; edit committed. Goblin sheet read-only: lock icon, "Derive to customise", no Edit. B, C frames: no monster records |
| 9 | New character… "Kell", owner Player 2, not a draft; then edit Kell's owner → Player 1 | — | C sees Kell full, no Draft badge ≤ 1 s; after reassign C gets Kell as summary only, B gets Kell full; C frames end with a `creature-sheet` delete for Kell |
| 10 | Kill server, restart | B, C: controls disabled meanwhile | Banner; after rejoin state of steps 2–9 intact (lock, counters, rows, owners); no console errors |
| 11 | *(N7)* Elite Goblin Warrior NPC sheet: Shortbow Attack, Damage, Attack + damage | B: Mira's Light crossbow: Shift+**Attack**, **Damage**, **Attack + damage**; C: Sela's Guiding Bolt: **Attack**; Sacred Flame row | Every attack row and Guiding Bolt show Attack · Damage · Attack + damage in that order; Sacred Flame Damage only. Lines: "Mira — Light crossbow attack (adv): …" (to-hit only, no damage); "Light crossbow damage (piercing)"; one line with both. Guiding Bolt Attack: to-hit only. A's NPC lines DM-only. Screenshots of both rows |
| 12 | *(G8, draft card across a crash)* Close the toast, don't act; then hard-kill + restart | B: New character → "Quill" (Brin was approved in step 6, so B has no open draft) | After rejoin A: "1 pending action" toast; bell Pending: Quill's card. B, C frames: no `charx-draft` |
| 13 | *(items 13, 16)* — | C: picker → Thorn; reload. Then open Notes on Sela in edit mode with a long note; scroll | After reload C still on Thorn (was: jumped to Sela). While scrolling, name, badges and the tab strip stay at the top (`charx-header` `data-pinned="true"`) |
| 14 | *(Sprint 3; bundle `vision`, run inside FOG §13 steps 8–9)* Thorn's sheet: switch **Sees invisible** on (FOG step 8); then Edit, Darkvision 60 → 30, then back; switch "Sees through magical darkness" off and on | B: Mira's sheet: Senses line "Vision 30 ft"; opens Thorn → summary card only. C: Thorn's sheet in edit mode: `charx-senses-invisible` disabled before and after A's switch; Senses line gains "Sees invisible" | Senses line updates ≤ 1 s for A and C; Thorn at (11, 9): at 30 ft Goblin Lurker (17, 11) leaves C's view (d 6.3 > 6 cells), back at 60 ft it returns; C's screen dark while the switch is off (Thorn in darkness). B frames: no Thorn `senses` |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0004, 0009, 0012, 0016, 0021, 0022, 0024, 0025, 0029, 0032; #106, #139, #149, #154, #177 | Ownership, model, derivation, events, sync, seams, visibility, windows, log window | accepted |
| [ADR-0036](../architecture/adr/0036-full-sheet-derivation.md) | Option C + storage split; refines ADR-0021 D, ADR-0024 | accepted #178 (numbered at merge) |
| [character-sheet](character-sheet.md) | Window, roll routes, `char.roll`, `char.adjustHp`, `characters.adjustHp`, roll control usage | complete, built |
| [entities](entities.md) | New optional core fields, attacks 0–20, helpers + overrides, summary redaction, internal create / update API, hook + `creatureActions` lines (OQ-CHARX-19) | complete; changes needed |
| [combat-tracker](combat-tracker.md) | Route passes `ref`; `cbt.attack` gains `attackId?` / `spellId?` via `sheetAttack`; drafts out of whole-party (OQ-CHARX-12/13) | complete; changes needed |
| [combat-extras](combat-extras.md) | Registers `cbtx.temp-hp`, `cbtx.death-saves`, `cbtx.effects` (§7.1); wires `char.adjustHp` through `hpRules.apply`; consumes `saveBonus` | in spec; seam settled (D/S seam) |
| [dice-roll-log](dice-roll-log.md), [play-shell](play-shell.md), [party-loot](party-loot.md), [fixtures-adapters](fixtures-adapters.md) | Roll control, categories `skill-check` / `damage` / `healing`; window registry; `wallet` record; bundles. No change | complete |
| [combat-tracker](combat-tracker.md) (N7) | Claims `toHit` → `cbt.attack {rolls: "toHit"}`, `damage` → `cbt.rollDamage`, `attack` → `cbt.attack` (settled S1). The three existing e2e files move in `fix/charx-buttons` (this spec); P2a's new CBT e2e lands in `fix/combat2-split-attack` (X-5) | settled S1; P2a builds after `fix/charx-buttons` |
| [notifications](notifications.md) (G8) | Existing `notify` / `resolveNotification`, kind registry and client views (append-only lines). No notifications spec change | complete |
| [campaign-management](campaign-management.md) (N3) | Consumes `openSheetFor` and the passive helpers for the players panel (FR-CAMP-21/22) | decided #190 |
| effect-modifiers (M, accepted #190) | Registers "Active effects" through `sheetSections`; no CHARX change | decided #190 |
| [fog-of-war](fog-of-war.md) *(sprint 3)* | Reads `statBlock.senses` server-side (incl. `seesInvisible` for Invisible tokens, FR-FOG-46, #210); its definition-changed hook line re-derives vision on a senses edit (FR-CHARX-52); owns bundle `vision` | decided #207, #210 |
| [entities](entities.md) *(sprint 3)* | `senses` in the creature core zod (both kinds, optional, additive like FR-CHARX-01) and not on the summary whitelist; compendium (track C) maps SRD darkvision into it in C1, after V0 | change in `fix/vision-core`; seams S6 |

### Shared changes

Per AGENTS §9.9; the orchestrator routes each. Shared-branch-first changes marked ★, all in `fix/charx-core`. **Build order (fixed by the orchestrator):** P fixes → `fix/charx-core` → `fix/cbtx-core` → S build (a, b) ∥ D build → S slice 4 (combat routes) last. `fix/charx-core` and `fix/cbtx-core` both touch db, `src/shared/events/` and `src/shared/entities/`, so they never run at the same time ([sprint-1 boundaries](../agents/sprint-1.md#boundaries-and-hotspots-orchestrator-sequence-these)). Play-shell layout tests and protocol §24 are untouched (window geometry unchanged, FR-CHARX-26).

| Path | Change | Owner today |
|---|---|---|
| ★ `src/server/db/` | New table `creature_sheet` (§8.2). `entity` unchanged (JSON leaf) | shared |
| ★ `src/shared/entities/schemas.ts` | §8.1 fields, attacks 0–20 + `id`, skill / passive / spell helpers, override handling in all helpers; the redacted-character schema = the ADR's whitelist | entities (feature-owned) |
| ★ `src/server/features/entities/commands.ts` | Internal `createIn` / `updateIn` (with `hpCurrent` for FR-CHARX-15) | entities |
| ★ `src/server/features/entities/records.ts` | One whitelist in `redactCharacter` (ADR "Refines ADR-0024"; CBTX adds `deathState` to the same list) | entities |
| ★ `src/server/features/entities/definition-hooks.ts` | CHARX hook line (owner copy, counter clamp) | entities (append-only) |
| ★ `src/shared/events/character-sheet.ts` + `index.ts` | New events; `CharacterRolled` fields | shared |
| ★ `src/server/ws/snapshot-size.test.ts`, `src/server/ws/testing/snapshot-size.ts` | Heavy scenario gains `creature-sheet` rows | shared (server core) |
| `src/client/dm/features/entities/creature-actions.ts` | "Sheet" entry | entities (append-only) |
| `src/client/common/features/combat-tracker/roll-route.ts`, `src/server/features/combat-tracker/attack.ts` (`cbt.attack`), `src/shared/combat-tracker/schemas.ts` (`attackId?`, `spellId?`), `src/server/features/combat-tracker/lifecycle.ts` (party resolution) | `ref`, `spellAttack`, `sheetAttack` call, drafts excluded | combat-tracker; slice 4, last |
| `fixtures/bundles/index.ts`, `fixtures/bundles/session-sim.ts` | `character-sheet-full`; `char-mira-full`, `npc-elite-sheet` | append-only |
| New registry `src/client/common/features/character-sheet/sheet-sections.ts` | Created empty; AGENTS §9.9 list gains it | CHARX |
| Feature-owned CHAR folders (`src/{shared,server/features,client/common/features}/character-sheet/`) | CHARX's build inherits them (OQ-CHARX-15); `creature-sheet` registers in `src/server/features/character-sheet/index.ts`. CBTX's slice 1 also rewires `char.adjustHp` (`hp.ts`) in this folder: build order below keeps them apart | character-sheet |
| Docs (integrator) | Data model §11 + new table; protocol §5/§6/§8/§26 rows; FIX §8 rows; AGENTS §9.9; glossary (OQ-CHARX-16); CHAR FR-CHAR-02/05/09 amendments | — |

**Sprint 2 phase 1** (P2b; after DM gate 1; the orchestrator routes each per AGENTS §9.9)

| Path | Change | Owner today |
|---|---|---|
| `src/shared/events/character-sheet.ts` (shared) | `CharacterRolled.kind` + `toHit`, `spellToHit` | shared |
| `src/shared/character-sheet/{schemas,logic}.ts` | `char.roll` kinds, `characterRolls` specs | CHARX (feature-owned) |
| `src/client/common/features/character-sheet/{ActionsTab,MainTab,SheetView,CharacterSheet,routing,selection}.tsx/ts` | three buttons, Main without attack, pinned header, `SheetRollKind`, picker memory | CHARX (hotspot: one branch at a time) |
| `src/server/features/character-sheet/lifecycle.ts` (create, approve), new `draft-kinds.ts` | G8 cards in `char.create` / `char.approve` | CHARX |
| `src/server/features/notifications/kinds.ts`, `src/client/{dm,player}/notification-views.ts` | one line per kind | append-only |
| `src/client/common/features/combat-tracker/roll-route.ts` | claims `toHit` / `damage` per S1 | combat-tracker (P2a's `fix/combat2-split-attack`, after `fix/charx-buttons`) |
| `e2e/character-sheet.e2e.ts`, `e2e/combat-tracker.e2e.ts`, `e2e/combat-tracker-charx.e2e.ts` | clicks move to `charx-roll-attack-damage` (Main IDs retired; `charx-roll-attack` is to-hit only): `character-sheet.e2e.ts:34/56`, `combat-tracker.e2e.ts:144`, `combat-tracker-charx.e2e.ts:91` | **`fix/charx-buttons` owns all three moves** (else `main`'s e2e breaks on merge) |
| Docs (integrator) | protocol §21 / §22 (`char.roll` kinds, `CharacterRolled`), §23 (kinds `charx-draft`, `charx-approved`), §26 (roll routes: kinds). No data-model change | — |

- **None:** DB, record types, snapshot shape, window geometry (protocol §18 / §24 unchanged). Glossary: OQ-CHARX-23.
- **Build order (review plan):** character-sheet folder lock `fix/charx-buttons` (N4, N7, item 16, the three e2e moves) → `fix/charx-cues` (G8, item 13; N3 in campaign-management) → M slice 3 (`commands.ts`) → M slice 4 (`sheet-sections.ts`, append) → M tier 3 (`resources.ts`). `fix/charx-buttons` also precedes P2a's `fix/combat2-split-attack` (S1).

**Sprint 3** (track V; order in [FOG §14](fog-of-war.md#14-dependencies)): the `senses` zod lands in FOG's `fix/vision-core` (V0, `src/shared/entities/schemas.ts`, entities feature-owned) because the vision server reads it; this spec's slice is **V5 `build/sheet-senses`** (S, character-sheet folder lock, **first** in the sprint-3 order V5 → R3 → R6 → C2 → D4 → P4 / C4, seams S3 + rulings X2; right after V0 and before V1 / V2, which need its key and fixture, review A10): `char.edit` key, Senses line + edit controls incl. the DM-only Sees invisible switch and its `forbidden` check (#210; `seesInvisible` itself is in V0's zod), fixture `vision-senses`, tests above, walkthrough step 14. No DB, record-type or event change (`CharacterSheetEdited` already carries `fields`).

**Sprint 4** (track R; split and order in [MOD §14.3](effect-modifiers.md#143-build-split-sprint-4-track-r)): the zod changes (`Attack.bonus`, `Attack.extraDamage` in `src/shared/entities/schemas.ts`, entities-owned, granted to R; `FeatureRow.used` floor in `src/shared/character-sheet/sheet.ts`) land in **S4-0 `fix/rules4-core`**, after V6 (which takes the same entities file first for senses; C-search's `definitionOrder` edit there may run in parallel, the later merger rebases; seams S5, S14); the sheet work in **S4-1a** (weapon rows: `ActionsTab`, row editor, `logic.ts` roll specs, `sheetAttack`) and **S4-2** (uses: `counters.ts`, `resources.ts` with `overspend` + floor, `MoreTabs.tsx` pips and display), one at a time under the **sheet folder lock: V6 → S4-1a → S4-2** (S5). No DB change for CHARX (JSON leafs). The creature form's whole `PUT` carries the new attack fields (`dm/features/combat-tracker/creature-form.tsx`, in S4-1a, **before C-art's Type select**, S14).

**Suggested build slices**

| # | Branch | Does | Shared files |
|---|---|---|---|
| 1 | `fix/charx-core` ★ (after P fixes) | Table, stat-block fields + helpers, entities internal API + whitelist redaction, events, snapshot-size scenario | db, `src/shared/entities/schemas.ts`, entities `commands.ts` / `records.ts` / `definition-hooks.ts`, `src/shared/events/`, snapshot-size test |
| 2 | `build/character-sheet-full` (a), after `fix/cbtx-core`, parallel to the D build | Commands, `creature-sheet` record type, hook, fixtures + bundle | append-only bundle / session-sim lines |
| 3 | same (b) | Tabs, edit mode, picker, summary, creation, NPC sheet, wallet line, empty `sheet-sections.ts` | `creature-actions.ts` line |
| 4 | same (c), **last** (after the D build) | `char.roll` kinds, route `ref`, combat route + `cbt.attack` + drafts | combat-tracker `roll-route.ts`, `attack.ts`, `schemas.ts`, `lifecycle.ts` (lock) |

## 15. Open questions

All decided (#178, S1, #190, #207); OQ-CHARX-23 (glossary) stays for the integrator. **Sprint 4 (track R):** OQ-CHARX-26, -27 **decided** (DM, sprint-4 gate 1, #245); OQ-CHARX-28 settled at the gate (owner: compendium's importer bump); OQ-CHARX-29 settled by seams S5 / S14. IDs OQ-CHARX-26–29 stay R's (seams S10; V's sprint-4 row is OQ-CHARX-30). Sprint 3's OQ-CHARX-24 / -25 were decided at sprint-3 gate 1 (#207), with placement of senses (Main tab line, FR-CHARX-50) and defaults (0 / 0 / off, FOG OQ-FOG-35); #210 added Sees invisible (DM only, FR-CHARX-53).

| ID | Question | Decision | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CHARX-01 | ADR-0012 full-sheet derivation | **Decided #178:** C, derived with overrides, fixed key list ([ADR-0036](../architecture/adr/0036-full-sheet-derivation.md), accepted; A all-stored and D modifier-list rejected) | — | entities, combat-tracker, combat-extras, levelling |
| OQ-CHARX-02 | Where sheet data lives | **Decided #178** (same ADR): rules in `statBlock`, the rest in the new `creature-sheet` record | — | entities, live-sync |
| OQ-CHARX-03 | How a player gets a character | **Decided #178 (G5):** the player makes a draft, the DM approves; the DM can also create one | — | combat-tracker |
| OQ-CHARX-05 | What other players see | **Decided #178 (G6, with OQ-CBTX-09):** one whitelist: name, portrait, owner, Down, level, class, species, `deathState` | — | entities, combat-extras |
| OQ-CHARX-06 | What an "NPC sheet" is | **Decided #178:** the sheet opened by the DM on a custom creature definition (no new kind) | — | entities, glossary |
| OQ-CHARX-07 | Multiclassing | **Decided #178:** the model supports class rows; basic list UI | — | levelling |
| OQ-CHARX-08 | Rest buttons (tier C) | **Decided #178:** out; manual counters + per-block Reset | — | — |
| OQ-CHARX-09 | Casting uses a slot? | **Decided #178:** no; pips ticked by hand | — | — |
| OQ-CHARX-10 | Seam with combat-extras; CON save for concentration | **Decided (D/S seam):** `sheet-sections.ts` per §7.1; CBTX registers `cbtx.temp-hp`, `cbtx.death-saves` (`vitals`), `cbtx.effects` (`header`); concentration uses `saveBonus(stats, "con")` from `fix/charx-core`, overrides honoured | — | combat-extras |
| OQ-CHARX-11 | Sheet Damage vs temp HP | **Decided (D/S seam):** the sheet keeps `char.adjustHp`; CBTX wires it through `hpRules.apply`; CHARX models no temp HP, death-save or condition fields | — | character-sheet, combat-extras |
| OQ-CHARX-12 | Combat with several attacks and spell attacks | **Decided #178:** the route claims `attack` + `spellAttack` (spells with damage) with `ref`; `cbt.attack` gains `attackId?` / `spellId?` via `sheetAttack`; a DM attack picker for NPC rows is combat's | — | combat-tracker, combat-extras |
| OQ-CHARX-13 | Drafts in encounters | **Decided #178:** excluded from `partyCharacterIds: null`; explicit lists may include them | — | combat-tracker |
| OQ-CHARX-14 | Transport for sheet edits | **Decided #178** (ADR accepted, refines ADR-0021 D): WS `char.edit` for characters and NPC sheets; `PUT` stays for the creature form (§9) | — | protocol |
| OQ-CHARX-15 | Code ownership | **Decided #178:** CHARX's build inherits CHAR's feature folders | — | — |
| OQ-CHARX-16 | Glossary | **Decided #178:** add Draft (character), Sheet lock, Sheet section, NPC sheet (not the `npc` entity kind), Override; drop "Override (not supported)" from Modifier's avoid-column (integrator) | — | glossary |
| OQ-CHARX-17 | Deleting characters | **Decided #178:** no delete (FR-ENT-14); rename / reassign | — | entities |
| OQ-CHARX-19 | Entities changes | **Decided #178:** accepted; they land in `fix/charx-core` | — | entities |
| ~~OQ-CHARX-20~~ | ~~Crit damage out of combat (N7): a player rolls Attack (natural 20), then Damage~~ | **Decided (#190):** none, as FR-CHAR-05 (no crit rule outside combat; the DM rules it) | — | dice-roll-log |
| ~~OQ-CHARX-21~~ | **Combat-tracker (N7 seam):** in a running encounter, what does each sheet button do? The sheet sends kinds `toHit` / `damage` / `attack` (spell: `spellToHit` / `spellDamage` / `spellAttack`) with `ref` through the roll routes (FR-CHARX-43); combat answers per kind: claim + intent, `critExpressions`, or `hidden`. Same answer for the DM attack picker and NPC rows so the three behave the same everywhere | **Settled S1 (orchestrator):** sheet kind names stand (`attack` / `spellAttack` keep their stored meaning); Attack → `cbt.attack {rolls: "toHit"}`, Damage → `cbt.rollDamage` (healing never routes), Attack + damage → `cbt.attack`; FR-CHARX-43 | — | combat-tracker, combat-extras |
| ~~OQ-CHARX-22~~ | ~~Sheet window cramped for building a character (report item 16)~~ | **Decided (#190):** pinned header (FR-CHARX-48); the player resizes; no auto-grow | — | play-shell |
| OQ-CHARX-23 | Glossary: add "**Attack + damage**: the sheet button that rolls to-hit and damage as one action; **Attack** rolls to-hit only, **Damage** damage only" | **Add at merge** / none | no · owner: integrator | glossary |
| OQ-CHARX-24 *(sprint 3)* | Who edits senses, incl. "sees through magical darkness"? | **Decided (#207, G15): A owner + DM, sheet lock applies** (the DM locks to stop self-granted Devil's Sight). Rejected: ~~B DM only for the darkness switch~~, ~~C DM only for all senses~~. *(#210)* The new Sees invisible sense is the exception: DM only (FR-CHARX-53) | — | fog-of-war |
| OQ-CHARX-25 *(sprint 3)* | Monsters / NPCs too? | **Decided (#207, G15): A both kinds**; they matter only for tokens a player owns (familiar, summon). Rejected: ~~B characters only~~. The SRD part is settled by seams S6 (C's adapter fills `darkvisionFt`; see-through and Sees invisible false) | — | entities, compendium |
| OQ-CHARX-30 *(sprint 4; was V's OQ-CHARX-26, renumbered by seams S10)* | **compendium:** the Open5e adapter writes `visionFt: 0` with SRD darkvision, so an imported creature a player owns would be sightless beyond darkvision under the 999 ft default | **Settled by seams S5:** the adapter omits `visionFt` (Normal); **V6** makes the one-line change in `src/server/features/compendium/adapter/open5e.ts` and bumps `ADAPTER_VERSION` (C-art core bumps it again later), C is told and rebases its `ADAPTER_VERSION` bump on it (S14); a compendium Update rewrites imported definitions in place, healing old rows. Rejected: ~~fog treats an imported 0 as Normal~~ (special case), ~~leave it~~ | no · settled | compendium |

| OQ-CHARX-26 *(sprint 4)* | **Magic weapon model** ([16]: Flame Tongue greatsword +1, 2d6 slashing + 2d6 fire, +1 to hit, +1 damage) | **Decided** (DM, sprint-4 gate 1, #245; G36): on the weapon row, `bonus` 0–3 + 0–2 typed `extraDamage` parts (FR-CHARX-54); works out of combat and on monster rows. Rejected: ~~an attached effect~~, ~~type the +1 into the numbers~~ | — | combat-tracker, effect-modifiers, compendium |
| OQ-CHARX-27 *(sprint 4)* | **Negative uses** ([14]): how far below zero, which counters, and how it shows | **Decided** (DM, sprint-4 gate 1, #245; G38): feature uses only, down to −9; "−1 / 3" in red with a "−1" Badge and Tooltip; the Rage switch asks "Rage anyway?" before spending past zero (FR-CHARX-58, FR-MOD-59). Rejected: ~~floor at −usesMax~~, ~~no floor, slots and hit dice too~~ | — | effect-modifiers |
| OQ-CHARX-28 *(sprint 4)* | **compendium**: (1) map SRD monster attacks "… plus 2d6 poison" into `extraDamage` (C's adapter keeps the first die today and puts the rest in text, #213); (2) Add to sheet for a weapon / magic weapon item could also add an attack row (today `{name, qty}` only) | **Settled at sprint-4 gate 1 (#245, bulk):** (1) lands with compendium's importer bump (OQ-CMP-33); (2) stays later. Schema ready after S4-0 | no · owner: compendium's C-art core (`ADAPTER_VERSION` bump, OQ-CMP-33) | compendium |
| OQ-CHARX-29 *(sprint 4)* | **entities**: `Attack` zod (`src/shared/entities/schemas.ts`, entities-owned) gains `bonus` + `extraDamage`; the creature form (combat-tracker) passes them through | **Settled by seams S5 / S14:** granted to V6 (senses) then R0 `fix/rules4-core` (`Attack` fields), in that order; C-search's `definitionOrder` edit may run in parallel (later merger rebases); creature form S4-1a → C-art | — | entities, combat-tracker |

OQ-CHARX-04 and 18 are retired (merged into FR-CHARX-12 and FR-CHARX-33 while drafting).

## 16. Out of scope

- See §4. Levelling, builder, compendium lookups, rests, encumbrance, rest-time hit-die healing; temp HP / death saves / conditions data (combat-extras); party HP / AC view (tier B, play-shell); several sheet windows at once; DM-only notes on a PC; gems ([gems](post-mvp/gems.md)).
- *(Sprint 4)* Extra damage parts on spell rows; weapon properties (finesse, heavy, versatile) and a "magical" flag; mapping compendium weapons into attack rows (OQ-CHARX-28); counters below zero for slots and hit dice.
- A spell row's `concentration` mark does not start CBTX concentration; the player uses CBTX's "Concentrate…" in the effects chip row (§7.1).
