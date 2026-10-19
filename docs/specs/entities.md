---
title: Entities (core)
prefix: ENT
status: in-review
owner: spec-companions
wave: 2
phase: post-mvp-6
---

# Entities (core)

### Sprint 4 at a glance

| FR | What | Slice | Named test (§13) |
|---|---|---|---|
| FR-ENT-18 (S4) | Creatures order: source rank; search per FR-CMP-37 | C-search | `FR-ENT-18 order`; CMP `FR-CMP-38 SRD Goblin above fixture Goblin` |
| FR-ENT-26 | Monster `type` (14 SRD types) | C-art core | `FR-ENT-26 type` |
| FR-ENT-27 | Token `creatureType`: placement, duplicate, menu, fill (null only) | C-art core (server), C-art (menu) | `FR-ENT-27 art per creature type`, `FR-ENT-27 fill`; walkthrough U1–U3 |
| FR-ENT-28 | Glyph set, colours, draw, Art menu | C-art | `FR-ENT-28 art per creature type`; T1, T4 |
| FR-ENT-29 | Licence, `ATTRIBUTION.md`, Credits in both clients | C-art | `FR-ENT-29 licence`; T6 |
| FR-ENT-30 | Visibility (players: visible tokens only) | C-art core | `FR-ENT-30 players never see hidden tokens' art`; T2 |

### Sprint 6 at a glance (track CP, companions)

| FR | What | Slice ([CBT §14.2](combat-tracker.md#142-build-split-sprint-6-track-cp)) | Named test ([CBT §13.2](combat-tracker.md#132-sprint-6-track-cp-cbt-ent-charx-party-map)) |
|---|---|---|---|
| FR-ENT-31, -33, -34 | Pet = an owned custom monster; edit / release; owner copies | CP0 core | `FR-ENT-31 pet fields`, `FR-ENT-34 owner change rewrites copies` |
| FR-ENT-32, -35, -39 | Make pet (server copy), caps, Creatures badge | CP1 | `FR-ENT-32 make pet` |
| FR-ENT-36 | Pet HP outside a fight | CP1 | `FR-ENT-36 pet HP` |
| FR-ENT-37, -38 | Visibility: owner full, others band; DM edits stats | CP0 | `FR-ENT-37 pet visibility` (leak scan) |

## 1. Summary

- The **creature definition** contract that tokens, combatants and encounter entries point at. MVP kinds: `character`, `monster` ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). One `entity` table, one shared zod creature core, same shape for SRD, custom and fixture ([ADR-0009](../architecture/adr/0009-entity-content-model.md), #124). Imported definitions are global and read-only; customs and characters belong to one campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md)).
- **Schema ownership:** entities owns the creature core for both kinds. [character-sheet](character-sheet.md) may only add optional character fields; [combat-tracker](combat-tracker.md)'s creature form edits this schema and may show a subset.
- Players never see monster definitions; instances carry read-only display copies, refreshed inside the edit's transaction (#120, [ADR-0024](../architecture/adr/0024-definition-visibility.md)).
- **Sprint 4 (track C, [#244](../decisions-log.md), session-sim-7 glitch 9: tokens of compendium monsters show "GS", "O", "H"):** monsters gain an optional **creature type**, and a token without an image is drawn with **token art** for its type instead of initials (FR-ENT-26–30). The Creatures window orders equal names by source rank ([compendium FR-CMP-38](compendium.md#6-functional-requirements)). Decided at sprint-4 DM gate 1 ([#245](../decisions-log.md); G3, G4, G44; G7 puts token art first in the cut order if the sprint runs late).
- **Sprint 6 (track CP, DM [#252](../decisions-log.md) / BL-30):** a **pet** is the player's **own copy** of a creature definition: a custom monster with an owner PC (`companionOf`) and that PC's player, a default turn mode and **HP kept between fights** (FR-ENT-31–40). The owner sees it full; other players a band ([proposed companion visibility ADR](../architecture/adr/proposed-s6-cp-companion-visibility.md), amends ADR-0024). Summons are combat's ([combat-tracker §6.4](combat-tracker.md#64-sprint-6-companions)); the card is CHARX's.

## 2. Scope

- `entity` record, XP from CR, record types + visibility fns; create / derive / update, internal import, definition-changed hooks, `resolveDefinition`; DM **Creatures** window *(proposed, OQ-ENT-03)*; fixtures + bundle `entities`.
- **Feedback pass** ([feature-tiers §8](../feature-tiers.md#8-dm-feedback-after-the-combat-build-145), #148): optional **speed** in the creature core (movement tracker, F3) and an optional **default token shape** on the definition (F4). Both additive.
- **#149:** optional **ability scores** and **save proficiencies** in the creature core (both kinds), plus pure derivation helpers (modifier, proficiency bonus, check / save bonus) for the sheet's and combat's check / save buttons.
- **#154:** redacted characters carry a derived `down` flag (combat's PC Down indicator for everyone). Character speed, scores and saves come from fixtures / `PUT /api/entities` in MVP; full PC / NPC editing and player-filled sheets are design-for-later.
- **Sprint 2 (N5, #188; FR-ENT-25):** optional **HP formula** on the stat block, so combat can add a creature with **average** (the stat block's HP max) or **rolled** HP.
- **Sprint 4 (S4; FR-ENT-26–30):** optional monster `type` (14 SRD creature types); token `creatureType`; one bundled glyph per type drawn on a type colour; DM token menu **Art**; licence + attribution. Creatures window: source rank and the shared matcher (FR-ENT-18 amended). **Not in S4:** art per individual monster, art for characters (Brakka stays "B" until the DM sets a portrait), Initiative-row portraits (OQ-ENT-24).
- **Sprint 6 (CP; FR-ENT-31–40):** pet fields on `entity` (`companionOf`, `turnMode`; `ownerPlayerId`, `hpCurrent` reused for monsters); `POST /api/pets` (server-side copy of any monster, imported included); release via `PUT`; `pet.adjustHp`; owner copies follow a character's owner change; visibility owner full / others band; Creatures "Pet of Mira" badge and **Make pet…**. **Not in S6:** a pet sheet for the player, player-made pets, pet levelling.

## 3. Goals

- Encounter builder, tokens and combat never branch on where a definition came from; no code path changes an imported one. Later kinds, sheet fields and modifiers are additive.
- Players never learn prepared monsters or other players' stats. An edit to a custom definition reaches every instance in the same commit.

## 4. Non-goals

- World-builder kinds, cross-references (→ [world-builder](post-mvp/world-builder.md)); compendium browse, clone, adapters, re-import (→ [compendium](post-mvp/compendium.md)); character builder (→ [levelling](post-mvp/levelling.md)); full sheet (→ [character-sheet-full](character-sheet-full.md)).
- Creature form UI (→ combat-tracker, tier S). Full monster editor (tier A). Stat block view on token click (tier B). Deleting definitions (OQ-ENT-07). Instance state and modifiers (→ scenes-map, combat-tracker, [combat-extras](combat-extras.md)).

## 5. User stories

- **DM:** As the DM, I want to derive "Elite Goblin Warrior" from the SRD goblin and fix it mid-session, so every token and combatant uses the new stats; and I want SRD creatures locked and my prepared monsters invisible to players.
- **Player:** As a player, I want my character's numbers (incl. current HP) always current and private from other players.
- *(S4)* **DM:** As the DM, I want the goblins and the ogre I drop from the compendium to look like a humanoid and a giant, not "G" and "O", and I want to switch a disguised fiend back to initials.
- *(S4)* **Player:** As a player, I want to tell the dragon from the wolves at a glance.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-ENT-01 | Kind registry in `@shared/entities`: `character`, `monster`, each a strict zod schema (§8). Every write validates; unknown kind or key → `invalid` with field path. Reads re-validate: the snapshot provider omits an invalid stored row and logs an error with its id; a command touching it → `internal`. | One schema for pipeline, commands, fixtures (FR-FIX-18) |
| FR-ENT-02 | Both kinds share the creature core (§8). Monster adds `cr`; character adds `level`, `className`. | ADR-0009, #124 |
| FR-ENT-03 | XP is derived from CR by the SRD table in `@shared/entities`, never stored. CR 0 → 10 XP *(proposed, OQ-ENT-11)*. | |
| FR-ENT-04 | Imported definitions have `campaignId = null`. Customs and characters get `ctx.campaignId`; for DM REST that is resolved at request authentication (as FR-ASSET-09; CON-21); none → `conflict` "No active campaign". No request field sets a campaign. | ADR-0018 |
| FR-ENT-05 | Provenance inline on the row: `source, sourceKey, licence, attribution, importedAt`; unique `(source, sourceKey)`; all null for customs. `readOnly = source != null`. *(proposed, OQ-FIX-15)* | |
| FR-ENT-06 | Only the internal `entities.import` writes rows with a source; it implements the pipeline insert interface (data-model CON-03, #118). Batch record `{kind, sourceKey, data}` → `data = {name, statBlock}`; `source` = descriptor key; `licence`, `attribution` from the descriptor. One `EntityImported` per created row. No route reaches it. | FR-FIX-18–24 |
| FR-ENT-07 | Update of an imported definition → `forbidden` (403) "Imported definitions are read-only. Derive a custom one."; no change, event or log entry. | |
| FR-ENT-08 | Name (all kinds, create and rename): trimmed, 1–60 chars, no control chars, unique case-insensitive among the campaign's entities of that kind, else `conflict`. May equal an imported name (e.g. "Goblin"). Optional portrait: `assets.require(ctx, id)` ([FR-ASSET-15](assets-pipeline.md#6-functional-requirements)), else `not_found`. | |
| FR-ENT-09 | Derive = create with `derivedFromId`: a monster that is global or in `ctx.campaignId`, else `not_found`. The request carries the full stat block; the server copies nothing. Later base edits never change the result. | ADR-0009 |
| FR-ENT-10 | Create character: `ownerPlayerId` must be a player of `ctx.campaignId`, else `invalid`; `hpCurrent = hpMax`. MVP callers: fixtures only (decisions #100). Character fields (incl. speed, scores, saves) are set by fixtures or `PUT /api/entities/:id`; no character edit UI in MVP (#154). | |
| FR-ENT-11 | Update replaces name, portrait, `tokenShape`, stat block and (characters) owner as a whole (an omitted optional field becomes null / absent); name and portrait as FR-ENT-08, owner as FR-ENT-10. Kind, campaign, provenance, `derivedFromId` are immutable. `hpCurrent > hpMax` after update → clamped in the same transaction. | |
| FR-ENT-12 | `resolveDefinition(env, id)` (server) returns a definition that is global or in `env.actor.campaignId`, else `not_found`. Every command storing a definition reference uses it. | ADR-0018 |
| FR-ENT-13 | Instances store the definition id plus only the display copies listed in the [ADR-0024](../architecture/adr/0024-definition-visibility.md); no other stat-block fields. `effectiveStats(def, inst)` in `@shared/entities` returns `def.statBlock` in MVP. | Modifiers hook, tier A |
| FR-ENT-14 | No delete in MVP: no route or command deletes a definition. Typos are fixed by rename. *(proposed, OQ-ENT-07)* | ADR-0009 open row |
| FR-ENT-15 | Visibility `entity`: DM full. Player: own character (`ownerPlayerId = ctx.playerId`) full; other characters redacted to `{id, kind, name, portraitAssetId, ownerPlayerId, down}`, `down` = `hpCurrent = 0` derived in the visibility fn (no HP number; #154, combat [FR-CBT-38](combat-tracker.md#6-functional-requirements)); monsters hidden. | #120, #154 |
| FR-ENT-16 | Visibility `imported-entity`: DM full; players hidden. | #120 |
| FR-ENT-17 | Every command commits row + event-log entry in one transaction, then emits its domain event (§9). IDs and timestamps only from `ctx.ids` / `ctx.clock`. | ADR-0016, 0022 |
| FR-ENT-18 | DM Creatures window lists every definition the campaign can use, sorted by name (case-insensitive), then custom before imported, *(S4)* then imported by source rank ([FR-CMP-38](compendium.md#6-functional-requirements): `srd-5.1` before `fixture`), then id. *(S4)* Its search box (`ent-list-search`) keeps the store rows that match per the shared matcher's `nameTier` 0–3 ([FR-CMP-37](compendium.md#6-functional-requirements): every word starts a name word, or lies inside the name) and lists them by tier, then in the FR-ENT-18 order above. Live ≤ 1 s after commit. Each row is an HTML5 drag source: MIME `application/x-pp-definition`, data JSON `{definitionId}`. *(proposed, OQ-ENT-03)* | scenes-map FR-MAP-13 |
| FR-ENT-19 | `entities.update` runs every registered **definition-changed hook** `(env, before, after) → RecordChange[]` inside its own transaction. Each instance row a hook changes is listed in `EntityUpdated.changes`. A hook error rolls back the whole update. Listeners never mutate state. | #120, ADR-0016, 0021 |
| FR-ENT-20 | The Creatures window renders toolbar and row actions from an append-only `creatureActions` registry; entities ships none. *(proposed, OQ-ENT-14)* | combat-tracker form |
| FR-ENT-21 | The creature core gains optional `speed` (walking speed, ft): int 0–200, a multiple of 5, both kinds (OQ-ENT-16). Absent = unknown: no movement indicator. Stored rows without it stay valid; no backfill. Tokens carry a display copy, refreshed by scenes-map's definition-changed hook ([FR-MAP-36](scenes-map.md#6-functional-requirements)). | F3, additive |
| FR-ENT-22 | Every entity gains optional `tokenShape`: `round` \| `square` \| `none`, null = `round` (OQ-ENT-17). It is the default for **new** tokens only ([FR-MAP-35](scenes-map.md#6-functional-requirements)); a token owns its shape after placement, so an edit never changes placed tokens (as the name, #126). Set by create / update; FR-ENT-11's whole replace includes it, so a `PUT` without `tokenShape` sets null (callers send it, combat FR-CBT-43). Imported rows null. Redacted characters omit it. | F4 |
| FR-ENT-23 | Creature core gains optional `abilities {str, dex, con, int, wis, cha}` (all six together, int 1–30) and optional `saveProficiencies` (unique subset of the six; absent = none), **both kinds** (#149, #154). `saveProficiencies` without `abilities` → `invalid`. Stored rows without them stay valid. Visibility unchanged: part of the stat block (owner + DM full; redacted characters and monsters never reach other players). | #149, additive |
| FR-ENT-24 | Pure helpers in `@shared/entities` ([ADR-0032](../architecture/adr/0032-ability-derivation.md), amends ADR-0012), all taking the **stat block** (`level` present → character, `cr` → monster): `abilityMod(score) = floor((score − 10) / 2)`; `proficiencyBonus(stats)` = 2 + floor((level − 1) / 4) for characters, SRD CR table for monsters (CR 0–4 +2, 5–8 +3, 9–12 +4, 13–16 +5, 17–20 +6, 21–24 +7, 25–28 +8, 29–30 +9); `checkBonus(stats, ability)`, `saveBonus(stats, ability)` (+ proficiency if listed). Callers pass `effectiveStats(def, inst)` (FR-ENT-13). Never stored. Known deviation: SRD monster save bonuses that differ from mod + PB are not reproduced (accepted, ADR-0032). | Sheet FR-CHAR-20, combat FR-CBT-44 |
| **Sprint 2** (N5, #188) | | |
| FR-ENT-25 | **HP formula** (OQ-ENT-20): the creature core gains optional `hpFormula`, a string `NdM` optionally `+K` / `−K` (N 1–50, M ∈ 4/6/8/10/12/20, K 0–999; e.g. `2d8+2`), both kinds (combat uses it for monsters only). Pure helpers in `@shared/entities`: `hpAverage(formula) = max(1, floor(N × (M + 1) / 2) + K)` (5e "average", capped 999) and `hpRollSpec(formula)` (the expression `dice.evaluate` rolls; the caller clamps the result to 1–999). **Average HP = `statBlock.hpMax`** (the stat block's standard value), never recomputed; `hpAverage` is a form hint only. **No formula** → only Average is offered; a "rolled" request is the caller's `invalid` ("‹name› has no HP formula", [FR-CBT-62](combat-tracker.md#6-functional-requirements)). Stored rows without it stay valid; no backfill. Visibility unchanged (stat block). | N5; additive, zod only |
| **Sprint 4** (S4, token art) | | |
| FR-ENT-26 | **Creature type.** The monster stat block gains optional `type`: one of the 14 SRD types (`aberration`, `beast`, `celestial`, `construct`, `dragon`, `elemental`, `fey`, `fiend`, `giant`, `humanoid`, `monstrosity`, `ooze`, `plant`, `undead`), `CREATURE_TYPES` in `@shared/entities`. Characters have none (`invalid`). Stored rows without it stay valid. Filled by: the Open5e adapter ([FR-CMP-39](compendium.md#6-functional-requirements)); fixtures (§13); derive, which copies the whole stat block (FR-ENT-09); the creature form's **Type** Select (combat-tracker FR-CBT-43, OQ-ENT-25; the form already keeps fields it doesn't show). Visibility unchanged (stat block: DM only for monsters). | Additive, zod only |
| FR-ENT-27 | **Token `creatureType`**: one of the 14 types \| `"initials"` (the DM chose initials) \| null (no type known yet). A display copy written at placement and owned by the token afterwards, like its shape ([FR-MAP-35](scenes-map.md#6-functional-requirements); ADR-0024 refinement: [token creature type ADR](../architecture/adr/0050-token-creature-type.md), accepted #245): placement (`placeTokenIn`, so also combat's Start and Add, FR-MAP-48) sets it from the definition's `statBlock.type` (characters, no type: null); duplicate copies it; the DM changes it in the token menu **Art** (`map.updateToken {creatureType}`, FR-ENT-28). A definition edit never changes it, with one exception, **fill**: an update that gives a definition a type it didn't have (absent → present: the SRD Update, a form edit) sets that type on the definition's tokens whose `creatureType` is **null**, inside the update's transaction (one append-only line in scenes-map's definition-changed hook registry, FR-ENT-19; for imported definitions in every campaign, [FR-CMP-08](compendium.md#6-functional-requirements)); those tokens are listed in the event's `changes`. A token set to `"initials"` is never filled (review B7). Draw precedence: token image (portrait or DM-chosen) > creature-type art > initials (`"initials"` and null both draw initials). | OQ-ENT-23, OQ-ENT-29 (decided #245) |
| FR-ENT-28 | **Art set and menu.** One bundled glyph per creature type (14), SVG path data in `src/client/common/features/entities/creature-art/` (`index.ts`: type → `{path, viewBox}`), drawn by the tokens layer as the glyph (≈ 65 % of the footprint) on a backdrop that follows the token shape (round: disc; square: rounded square; none: glyph only), filled with the type's colour (one canvas colour token per type, `creature.<type>`, proposed values in §7, contrast-checked; visual-direction defines no such tokens yet: OQ-ENT-30; no hard-coded colours in components); the glyph is white; the name stays on the label layer (FR-MAP-42). DM token menu **Art** (token-menu registry, FR-MAP-29, append-only): "Creature type" (sets the definition's current type; disabled without one) and "Initials" (`"initials"`); the current one is checked (null shows neither checked). Players: no menu. | OQ-ENT-22 (decided #245) |
| FR-ENT-29 | **Licence and attribution.** Glyphs: 14 icons from game-icons.net, CC BY 3.0, authors Lorc and Delapouite (OQ-ENT-22, decided #245). `creature-art/ATTRIBUTION.md` lists per type: icon name, author, licence, url (the 14 in OQ-ENT-22). The credit is **always reachable in both clients** (review B13): the Compendium window's footer link **Credits** (both clients, also with nothing imported, [FR-CMP-19](compendium.md#6-functional-requirements)) opens the About dialog with a "Token art" section listing the 14 icons, authors (Lorc, Delapouite), "CC BY 3.0" and game-icons.net; the DM's Creatures window footer has the same **Credits** link (`ent-list-credits`). The play shell has no About of its own. Files are copied by hand once (no network at runtime or in tests); a licence test checks one glyph per type, one attribution row per glyph, and that the module holds path strings only (no markup, no `href`). | As the SRD credit (FR-CMP-04, -19) |
| FR-ENT-30 | **Visibility.** `creatureType` is a field of the `token` record, so it follows scenes-map's token visibility fn: a player receives it only on tokens they receive (never on hidden, fogged-out or invisible ones). No definition field reaches players. The art set ships in both clients (not secret). `creatureType` copies a stat-block value that players otherwise never see (FR-ENT-26), so this is a new player-visible display copy: players see the type art on every **visible** monster token by default; the DM sets Art ▸ Initials per token to hide it, e.g. a disguised fiend (OQ-ENT-29, decided #245). The [token creature type ADR](../architecture/adr/0050-token-creature-type.md) (accepted #245) adds `creatureType` to ADR-0024's token display copies. | ADR-0024 (refined) |
| **Sprint 6** (CP, #252 / BL-30; pets) | | |
| FR-ENT-31 | **Pet** (amends FR-ENT-10, §8 "character only"): a campaign `monster` entity with **`companionOf`** = a character of the campaign (its owner PC, [OQ-CBT-77](combat-tracker.md#15-open-questions)) and **`ownerPlayerId`** = that character's owner (a copy, written with it; the field visibility reads), **`turnMode`** (`after-owner` default \| `in-owner-turn` \| `own`; copied to its combatant at join, [FR-CBT-106](combat-tracker.md#6-functional-requirements)) and **`hpCurrent`** (kept HP, 0…`statBlock.hpMax`). A non-pet monster has all four null; imported definitions are never pets (global rows). Kind stays `monster`: tokens, combat, the creature form and the NPC sheet treat a pet as a custom monster. | #252 |
| FR-ENT-32 | **Make a pet**: `POST /api/pets {baseDefinitionId, companionOf, name?, turnMode?}` (DM; REST prep, ADR-0021 D). Base = any monster via `resolveDefinition` (imported, custom or another pet; a character → `invalid`); `companionOf` a character of the campaign (else `invalid`); caps FR-ENT-35. The **server copies** the base's stat block, portrait and `tokenShape` (unlike FR-ENT-09's client-sent block: imported blocks aren't in the DM store), `derivedFromId` = base; name = `name`, else the base's; taken (FR-ENT-08) → "‹Base› (‹PC›)", then " 2", " 3"; `hpCurrent = hpMax`. One transaction; `EntityCreated {entityId, kind, derivedFromId, companionOf}`. Result `201 {entity}`. UI: Creatures row action **Make pet…** (`creatureActions`, append) and Party **New pet…** ([FR-PARTY-43](party-board.md#6-functional-requirements)): one dialog: creature lookup (combat's autocomplete, the shared matcher, FR-CBT-63), owner PC Select, name (prefilled), turn mode. | #252 "its own copy" |
| FR-ENT-33 | **Edit and release** (amends FR-ENT-11): `PUT /api/entities/:id`'s whole replace carries `companionOf` and `turnMode` (omitted = null, so callers send what they loaded, as `tokenShape`; the creature form keeps them, FR-CBT-43). `companionOf: null` **releases** a pet: `ownerPlayerId`, `turnMode`, `hpCurrent` → null; it stays a plain custom monster (no delete, FR-ENT-14). Setting `companionOf` on a custom monster makes it a pet (`hpCurrent = hpMax`). Release or owner change while the pet is an active combatant → `conflict` "Dismiss it from the fight first". A character with `companionOf` → `invalid`. | |
| FR-ENT-34 | **Owner copies** (one append-only line in the definition-changed hook registry, FR-ENT-19): a character's owner change (`PUT`, CHARX `char.edit ownerPlayerId`, FR-CHARX-13) rewrites `ownerPlayerId` on its pets and on its active companion combatants ([FR-CBT-105](combat-tracker.md#6-functional-requirements)) in that transaction, all listed in `EntityUpdated.changes`. Tokens keep their own owner (#124; the DM reassigns). | Copy rule as CHARX's sheet owner |
| FR-ENT-35 | **Caps** ([OQ-CBT-83](combat-tracker.md#15-open-questions)): ≤ **3 pets per PC** (a 4th → `conflict` "Mira already has 3 pets"); ≤ 60 pets per campaign. | Measured within CON-44 (§12) |
| FR-ENT-36 | **Pet HP outside a fight**: `pet.adjustHp {petId, delta}` (WS; DM, and the owner `ownerPlayerId = actor`): `delta` int −999…999, ≠ 0; `hpCurrent` clamped 0…`hpMax`; unchanged → ack, no event. While the pet is an active combatant → `conflict` "In a fight the DM applies damage" (its HP lives on the combatant, [FR-CBT-113](combat-tracker.md#6-functional-requirements)). One transaction; `PetHpAdjusted {petId, before, after}` (logged, not undoable). The card's HP control sends it ([FR-CHARX-63](character-sheet-full.md#6-functional-requirements)). Lowering `hpMax` clamps `hpCurrent` (FR-ENT-11). | Heal the owlbear after a rest |
| FR-ENT-37 | **Visibility** (amends FR-ENT-15; [proposed ADR](../architecture/adr/proposed-s6-cp-companion-visibility.md)): a pet → DM full; **owner** (`ownerPlayerId = ctx.playerId`) **full**; other players redacted to `{id, kind, name, portraitAssetId, ownerPlayerId, companionOf, band}`, `band` = FR-CBT-26 on `hpCurrent` / `statBlock.hpMax`, derived in the fn ([OQ-CBT-80](combat-tracker.md#15-open-questions)). Every other monster stays hidden. A release or owner change lists the row: the old owner gets the redacted row (release: a delete, it's a plain monster again), the new owner the full one. | ADR-0024 amended |
| FR-ENT-38 | **Who edits a pet's stats** (OQ-ENT-31): the DM only, with the creature form or the NPC sheet (FR-CHARX-31); the owner's card shows stats read-only and sends only HP (FR-ENT-36). | |
| FR-ENT-39 | **Creatures window**: pet rows carry a Badge "Pet of Mira" (`ent-list-row-pet`, Tooltip owner player) and list with the customs; dropping a pet row on the map places its token owned by its player ([FR-MAP-74](scenes-map.md#6-functional-requirements)). | |
| FR-ENT-40 | **Fixtures**: `cp-srd`, `pet-owlbear`, `pet-drake`; bundles `companions-prep`, `companions` ([CBT §13.2](combat-tracker.md#132-sprint-6-track-cp-cbt-ent-charx-party-map)). | ADR-0017 |

## 7. UI/UX notes

- **DM view — window `ent.creatures`** (per [visual-direction](../design/visual-direction.md), [play-shell](play-shell.md) registry): DM only, default closed, 420×520 at top-left below `map.scenes`, launcher "Creatures".
- shadcn Table + Tabs (All / Characters / Monsters). Row: portrait thumb, name, kind, source Badge (`SRD` / `Custom` / owner name), CR + XP (monsters). Imported rows: lock icon, Tooltip "Read-only — derive to customise". Derived customs: "derived from Goblin" (muted), or "derived from (unknown)" if the base can't be resolved. New / Derive / Edit come from `creatureActions` (combat-tracker, Combat phase); drop onto the canvas: scenes-map.
- **States:** empty "No creatures yet"; loading skeleton; disconnected: last list stays + live-sync banner; error: invalid rows omitted (FR-ENT-01), REST errors as Toast. **Test IDs:** `ent-list`, `ent-list-tab-<all|character|monster>`, `ent-list-row` + `data-record-id`, `ent-list-row-lock`, `ent-list-empty`, `ent-list-search` (search box, built in C2; *S4*: FR-CMP-37 matching), *(S4)* `ent-list-credits` (footer link, FR-ENT-29).
- **Player view:** no entities UI. Own character: [character-sheet](character-sheet.md); token labels from instances ([scenes-map](scenes-map.md)).
- *(S4)* **Token art** (FR-ENT-27, -28), same for DM and players on every token they see: a goblin without a portrait is a humanoid glyph on the humanoid colour, the ogre a giant glyph, the wolf a beast glyph; the name label stays below. DM's hidden tokens keep their translucent styling; selection / target rings, bars and badges draw over the art as over an image. DM token menu: **Art ▸ Creature type / Initials** (checked item = current). A token with an image never shows art. Test hooks: the token node (`map-token`) gains attr `art` = `image` \| `<type>` \| `initials`; menu items `ent-token-menu-art-type`, `ent-token-menu-art-initials`. Visual check in the walkthrough: glyph legible at 1 cell (70 px) and at Fit zoom, contrast against both the type colour and a dark map.
- *(S4, review B39)* **Proposed type colours** (OQ-ENT-30; canvas tokens `creature.<type>`, dark mode). White glyph contrast measured with the WCAG formula (throwaway script): every value ≥ 4.99 : 1 (AA text 4.5, non-text 3). Against the app background `oklch(0.145 0 0)` ≈ `#09090b` the backdrops reach 2.2–4.0 : 1; the token's existing outline (FR-MAP-35, `colors.background` stroke) separates them from the map.

| Type | Colour | White on it | | Type | Colour | White on it |
|---|---|---|---|---|---|---|
| aberration | `#6d3fa3` | 7.27 | | giant | `#7a4f2c` | 7.04 |
| beast | `#5c6f2b` | 5.58 | | humanoid | `#355f9e` | 6.40 |
| celestial | `#8a6a00` | 5.07 | | monstrosity | `#8a3f8f` | 6.59 |
| construct | `#56636c` | 6.18 | | ooze | `#1f7a78` | 5.11 |
| dragon | `#b3261e` | 6.54 | | plant | `#3b7a32` | 5.23 |
| elemental | `#b4530f` | 5.02 | | undead | `#4b4f63` | 8.08 |
| fey | `#2f7d5b` | 4.99 | | fiend | `#8c1d40` | 8.88 |

- *(S6)* **Pets** (FR-ENT-32, -39): DM Creatures row action **Make pet…** and Party **New pet…** open one Dialog: creature lookup (prefilled with the row's creature), "Pet of" PC Select (owner name beside each), name Input (prefilled; inline "Name taken" per FR-ENT-08 before sending), turn mode RadioGroup (After the owner / In the owner's turn / Own initiative), Create. Pet rows: Badge "Pet of Mira". **Player view:** no entities UI; pets show in the Party window and the card. **Test IDs:** `ent-list-row-pet` (+ `data-record-id`), `ent-pet-dialog`, `ent-pet-<lookup|owner|name|mode|submit|error>` (`mode` + `data-value`).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Entity | id, kind | ID, `character` \| `monster` | `ctx.ids`; kind immutable |
| | campaignId | ID → Campaign \| null | Null iff imported (FR-ENT-04) |
| | name | text 1–60 | Unique index (`campaignId`, `kind`, lower(`name`)) where `campaignId` not null |
| | portraitAssetId | ID → Asset \| null | Asset reference, same campaign; null for imported ([OQ-ASSET-04](assets-pipeline.md#15-open-questions)) |
| | tokenShape | `round` \| `square` \| `none` \| null | Default shape for new tokens (FR-ENT-22); null = round |
| | statBlock | **JSON leaf** | Per-kind schema below |
| | ownerPlayerId | ID → Player \| null | Required for character, null for monster |
| | hpCurrent | int \| null | Character only: PC HP lives on the character (ADR-0009, OQ-ENT-08) |
| | derivedFromId | ID \| null | Plain id, no FK (informational) |
| | source, sourceKey, licence, attribution | text \| null | Provenance; unique `(source, sourceKey)` |
| | importedAt, createdAt, updatedAt | timestamp | `ctx.clock`; `importedAt` null for customs |

**Stat block** (strict; new fields only ever added as optional, so raising limits later is additive)

| Field | Kinds | Type |
|---|---|---|
| size | both | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan` |
| ac, hpMax, initBonus | both | int 0–30; int 1–999; int −10…+20 |
| hpFormula *(optional)* | both | `NdM[±K]`, N 1–50, M ∈ 4/6/8/10/12/20, K 0–999 (FR-ENT-25); `hpMax` stays the average |
| speed *(optional)* | both | int 0–200, multiple of 5 (ft, walking; FR-ENT-21) |
| abilities *(optional)* | both | `{str, dex, con, int, wis, cha}` int 1–30 (FR-ENT-23) |
| saveProficiencies *(optional)* | both | `("str" \| "dex" \| "con" \| "int" \| "wis" \| "cha")[]`, unique; needs `abilities` |
| attacks | both | 0–1 × `{name 1–40, toHit int −10…+30, damage, damageType?}` (MVP: one weapon attack, ADR-0012) |
| cr / level, className | monster / character | `"0"`, `"1/8"`, `"1/4"`, `"1/2"`, `"1"`…`"30"` / int 1–20, text 0–40 |
| type *(optional, S4)* | monster | one of the 14 SRD creature types, lower-case (FR-ENT-26) |

- *(S4)* **Token** (scenes-map's table, written by this track's core slice): `creatureType` text \| null (zod: the 14 types or `"initials"`), a display copy owned by the token after placement like `shape`; set at placement / duplicate / menu, filled once by FR-ENT-27 (null only). One nullable column `token.creature_type`. **Derived:** the art drawn = image > type > initials (client). **Not stored:** glyphs and colours (client bundle).

- *(S6)* **Pet** fields on `entity` (FR-ENT-31): `companionOf` ID → Entity (character, same campaign) \| null, FK set null (characters are never deleted, FR-ENT-14); `turnMode` text \| null (`after-owner` \| `in-owner-turn` \| `own`); `ownerPlayerId` and `hpCurrent` now also set on pets (were character-only). Two nullable columns `entity.companion_of`, `entity.turn_mode`; no backfill. **Derived:** `isPet = companionOf ≠ null`; the redacted `band` (FR-ENT-37). **Persisted runtime state:** a pet's `hpCurrent` (written by `pet.adjustHp` and combat's write-back).
- `damage` = `NdM` optionally `+K` or `−K`: N 1–20, M ∈ 4/6/8/10/12/20/100, K 0–30 (e.g. `1d4-1`); a subset of [dice-roll-log](dice-roll-log.md)'s grammar. `damageType` = a 5e damage type.
- **Relations:** Campaign 1—* Entity (custom, character); Player 1—* character; Entity 1—* instances (token, combatant, encounter entry; FK owned by scenes-map / combat-tracker); derived → base (informational).
- **Derived values:** `readOnly`, `xp`, `effectiveStats`, ability helpers (FR-ENT-03, 05, 13, 24), `hpAverage` (FR-ENT-25), computed in `@shared`, not sent; redacted character `down` (FR-ENT-15), computed in the visibility fn. **Persisted runtime state:** character `hpCurrent`; the rest is prep data. **Later:** non-creature kinds register their own schema; modifiers on instances; delete per ADR-0009 open row.

## 9. API & events

**REST (Hono RPC)** — prep CRUD ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D), DM secret (`Authorization: Bearer`); prefix per [OQ-CAMP-15](campaign-management.md#15-open-questions). No GET: the snapshot carries the records. **WS intents / signals:** none. **Internal:** `entities.import` (FR-ENT-06), `resolveDefinition` (FR-ENT-12), hook registry (FR-ENT-19). Errors `{code, message, issues?}`: `invalid` 400, `forbidden` 403, `not_found` 404, `conflict` 409 (protocol CON-09); player token or no secret → 401.

| Method | Path | Purpose | Success |
|---|---|---|---|
| POST | `/api/entities` | `entities.create {kind, name, portraitAssetId?, tokenShape?, statBlock, derivedFromId?, ownerPlayerId?}` | `201 {entity}` |
| PUT | `/api/entities/:id` | `entities.update` (FR-ENT-11; `tokenShape?` as create) | `200 {entity}` |

**Record types** (generic record changes `{type, id, op, data}` + `cause`) *(proposed, OQ-ENT-06)*

| Type | Scope | Data | Visibility rule | Snapshot |
|---|---|---|---|---|
| `entity` | campaign | Row minus provenance (always null); asset reference `portraitAssetId` (a redacted character keeps it, so other players can fetch that portrait, #123; intended); redacted character + derived `down` | FR-ENT-15 | Campaign's characters + customs |
| `imported-entity` | global | Row incl. provenance | FR-ENT-16 | All imported definitions |

**Domain events** (all logged, none transient or undoable; entities adds no listeners)

| Event | Changes |
|---|---|
| `EntityImported {entityId, source, sourceKey}` | `imported-entity` upsert; log `campaignId` null |
| `EntityCreated {entityId, kind, derivedFromId?}` | `entity` upsert |
| `EntityUpdated {entityId}` | `entity` upsert (before/after; an owner change flips who sees it full) + every hook-changed instance row (FR-ENT-19) |

*(S4)* No new event, intent or record type. `token` gains `creatureType` (visibility: the token's own rule, FR-ENT-30); `map.updateToken` gains `creatureType?: type | "initials"` (DM; null is never sent, it only means "not known yet"); `EntityUpdated` / `ImportedEntityUpdated` `changes` may list tokens filled by FR-ENT-27.

*(S6, pets)* REST `POST /api/pets {baseDefinitionId, companionOf, name?, turnMode?}` → `201 {entity}` (DM; FR-ENT-32); `PUT /api/entities/:id` gains `companionOf?`, `turnMode?` (FR-ENT-33). WS intent `pet.adjustHp {petId, delta}` (DM; player: own pet, else `forbidden`; FR-ENT-36). Events: `EntityCreated` gains `companionOf?`; new **`PetHpAdjusted {petId, before, after}`** (logged; `entity` upsert: owner full, other players the redacted row, whose `band` may change); `EntityUpdated` on a character owner change also lists its pets and companion combatants (FR-ENT-34). Record type `entity`: visibility per FR-ENT-37 (pets: owner full, other players redacted with `band`).

Other writers of a character's `hpCurrent` (character-sheet's `CharacterHpAdjusted`; combat via `characters.adjustHp`) upsert `entity`; other players' redacted copy changes only when `down` flips, else it is the same redacted upsert (timing tell accepted, character-sheet §9).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create / derive / update custom monster; create (fixtures) / update character | ✓ | ✗ (own-sheet edits: [OQ-CHAR-03](character-sheet.md#15-open-questions)) | DM credential; FR-ENT-04, 07–11; `resolveDefinition` |
| Update imported; delete anything | ✗ | ✗ | `forbidden` / no route |
| Receive records | full | own character full; others redacted (+ `down`); monsters hidden | FR-ENT-15, 16 |
| *(S4)* Set a token's art (menu) | ✓ | ✗ | `map.updateToken`: DM only (scenes-map) |
| *(S4)* See a token's art | every token | tokens they receive only | FR-ENT-30 |
| *(S6)* Make, edit, release a pet; edit its stats | ✓ | ✗ (OQ-ENT-31) | DM credential; FR-ENT-32, -33, -38 |
| *(S6)* Adjust a pet's HP outside a fight | ✓ | own pets | `pet.adjustHp`: `ownerPlayerId = actor`; not in a fight (FR-ENT-36) |
| *(S6)* Receive a pet | full | own: full; others: name, portrait, owner, band | FR-ENT-37 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** fresh snapshot; own character incl. `hpCurrent` current; an owner change meanwhile is reflected. Existing tokens keep their own owner; the DM reassigns them (#124, scenes-map).
- **DM disconnect / reconnect:** REST doesn't depend on the WS. Lost create response → retry hits the unique name index (`conflict`), never a duplicate.
- **Server crash mid-action:** one transaction per command (row + hook-changed instances + log): all or nothing, so no stale display copies. Import batch all-or-nothing (FR-FIX-19). After restart, snapshots equal pre-crash state.
- **Concurrent edits:** two DM tabs update one definition → last commit wins (whole replace). Campaign switch: old customs leave the DM store with the resync; `resolveDefinition` rejects them. Edit during combat: instances follow at once (FR-ENT-19); the combat log keeps values used at the time (ADR-0009).
- **Invalid / malicious input:** strict zod (unknown keys, bounds, dice grammar); names rendered as text; spoofed `campaignId` / `source` → `invalid` (not in schema).
- **No backfill (feedback, #149):** columns are additive and nullable; existing characters have no speed, scores or saves until a fixture reload or a DM `PUT /api/entities/:id` (#154: fixtures / API in MVP; character editing UI is design-for-later, [levelling](post-mvp/levelling.md)). The sheet shows "Speed —" and "No ability scores" meanwhile.
- **Leak accepted (#154):** other players learn that a PC is at 0 HP (`down`), never the number.
- *(S4)* **Token art:** existing tokens of definitions without a type stay initials until the definition gains one (the SRD **Update** fills every campaign's tokens of those definitions, FR-ENT-27) or the DM picks Art ▸ Creature type. A custom created from scratch has no type until the DM sets it in the form. Type changed later (humanoid → fiend): placed tokens keep theirs (token-owned; the DM uses the menu). A token the DM set to Initials stays initials, even when its definition gains a type later (`"initials"` is never filled). Disconnect / reconnect: the art is drawn from the token record in the snapshot; no image load, so no loading or error state. Server crash: placement, menu change and fill are each one transaction with their command.
- *(S6)* **Pets:** *player disconnect / reconnect:* the snapshot carries the pet (owner full, others redacted); a `pet.adjustHp` in flight is not idempotent → Toast "Connection lost — check the HP before trying again". *DM disconnect:* REST independent; a lost create retried hits the name rule (`conflict`) or makes "Owlbear (Mira) 2": the DM renames or releases one. *Crash:* create, release, owner change (+ copies) and HP adjust are one transaction each. *Concurrency:* owner and DM adjusting HP at once → deltas in commit order; an adjust racing combat's join → serialised: before → the combatant takes the new HP; after → `conflict`. *The owner PC is reassigned to another player* → pets follow (FR-ENT-34); their tokens keep their owner until the DM changes them. *Base edited later:* the pet is a copy, nothing follows (FR-ENT-09's rule). *Invalid input:* `companionOf` of another campaign or a monster → `invalid`; a player calling `POST /api/pets` → 401 (no DM secret). *Leaks accepted:* every player sees that Mira has an owlbear and how hurt it is (band), never its numbers.
- **HP formula (sprint 2):** a formula whose average differs from `hpMax` is allowed (homebrew); Average still means `hpMax`, the form shows "Formula average 15" beside HP max. Existing customs and imported rows without a formula offer Average only until the DM adds one (imported: derive first, FR-ENT-07).

## 12. Performance & bandwidth

- *(S6, measured; throwaway probe on the realistic-heavy harness, deleted; figures with combat's in [CBT §12](combat-tracker.md#12-performance--bandwidth))*: a max pet row (8 max-length attacks, every optional block) is **2,896 B** full (DM, owner) and **285 B** redacted (other players). Worst 3 pets × 6 players: DM +52 KB, each player +8.7 KB (own 3 full) + 4.3 KB (15 redacted); inside CP's total DM +106,026 B → 787,886 B, players +25,337 B → ≤ 311,952 B. `pet.adjustHp`: one `entity` upsert per viewer (≤ 2.9 KB owner / DM, ≤ 285 B others).
- *(S4, measured; throwaway probe on `session-sim` + realistic-heavy harness, deleted)*: 60 tokens per snapshot frame (active scene). `creatureType` adds 20 B per token as `null` (+1,200 B) and at most 29 B with the longest value `monstrosity` (+1,740 B; `"initials"` is shorter), per viewer. DM 670,394 → ≤ 672,134 B (1 MiB ceiling, #208); players 277,334–280,394 → ≤ 282,134 B (512 KiB). A scene load at the 200-token cap: ≤ +5,800 B. Each placement / menu event: ≤ +29 B. Monster `type` lives in `imported-entity` / `entity` rows (DM only; `imported-entity` is lazy, 0 B in any snapshot). Totals move with V6's own CON-44 change; C-art core re-baselines after V6 (seams S14).
- *(S4, review B38, measured)* **Client bundle:** the 14 picked glyphs (OQ-ENT-22, fetched once from the game-icons repo to measure) hold **26,606 B** of path data, **12,653 B** gzip -9, in each client. Each SVG is one 512 × 512 viewBox, one background path (dropped) + one glyph path (kept).
- *(S4, review B38, measured)* **Update with hooks:** see [compendium §12](compendium.md#12-performance--bandwidth): 317 updated definitions in 403 ms (FR-CMP-31 target 2 s).
- MVP: ≤ ~20 definitions per campaign, ≤ 2 KB each → ≤ 40 KB of snapshot; edits are rare (prep); events ≤ 2 KB plus hook-changed instances. Hundreds of imported definitions (post-MVP compendium) would bloat the DM snapshot: move `imported-entity` to on-demand REST then.

## 13. Test plan

*(S6)* **Companions:** fixtures (`cp-srd`, `pet-owlbear`, `pet-drake`), bundles `companions-prep` / `companions`, the walkthrough (C1, C2, C10) and the leak strings are in [CBT §13.2](combat-tracker.md#132-sprint-6-track-cp-cbt-ent-charx-party-map). Entities' named tests: `FR-ENT-31 pet fields` (unit: zod, a monster with `companionOf` + `hpCurrent` parses, a character with `companionOf` → `invalid`); `FR-ENT-32 make pet` (integration: copies the imported Owlbear's block, portrait, shape; `derivedFromId`; "Owlbear" taken → "Owlbear (Mira)"; 4th pet → `conflict`; a character base → `invalid`; player → 401); `FR-ENT-33 release` (fields null, a monster again; in a fight → `conflict`); `FR-ENT-34 owner change rewrites copies` (Mira → `player-2`: pets and the active Owlbear combatant follow in `EntityUpdated.changes`; `player-1` gets a redacted pet, `player-2` the full one); `FR-ENT-36 pet HP` (owner −14 → 45; in a fight → `conflict`; another player → `forbidden`); `FR-ENT-37 pet visibility` (matrix DM / owner / other player; `band` at 59, 29, 0; no `statBlock`, `hpCurrent`, `turnMode` in other players' frames; leak scan).

**Fixtures** (owner entities; values per [fixtures-adapters §8](fixtures-adapters.md#8-data-model); setups run as DM, FR-FIX-13). Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). **Bundle `entities`** = `base` + `player-2` + `campaign-second` + all six below; `enemy-1`, `enemy-2`, `enemy-custom`, `char-mira` also join `session-sim` (FR-FIX-25).

| Key | Kind | Requires | Contents |
|---|---|---|---|
| `enemy-1` | reference | — | `srd/monster/goblin.ts`: small, AC 15, HP 7 (*sprint 2:* `hpFormula` `2d6`), init +2, speed 30, STR 8 DEX 14 CON 10 INT 10 WIS 8 CHA 8, scimitar +4 / 1d6+2 slashing, CR 1/4. Source `fixture`, SRD 5.1 CC BY 4.0 attribution |
| `enemy-2` | reference | — | `srd/monster/wolf.ts`: medium, AC 13, HP 11 (*sprint 2:* `2d8+2`), init +2, speed 40, STR 12 DEX 15 CON 12 INT 3 WIS 12 CHA 6, bite +4 / 2d4+2 piercing, CR 1/4 |
| `enemy-custom` | setup | `enemy-1` | Derived from `enemy-1`: "Elite Goblin Warrior", AC 16, HP 15, scimitar +5 / 1d6+3, CR 1/2, `tokenShape` square, save proficiency DEX; other fields as `enemy-1` (*sprint 2:* **no** `hpFormula`: the "no formula" case) |
| `char-mira` | setup | `player-1` | "Mira", owner `player-1`, medium, L1 fighter, AC 16, HP 12/12, init +2, speed 30, STR 14 DEX 14 CON 14 INT 10 WIS 12 CHA 10, saves STR + CON, shortsword +4 / 1d6+2 piercing |
| `char-thorn` | setup | `player-2` | "Thorn", owner `player-2`, medium, L1 rogue, AC 14, HP 10/10, init +3, speed 30, STR 8 DEX 16 CON 14 INT 12 WIS 10 CHA 13, saves DEX + INT, dagger +5 / 1d4+3 piercing |
| `enemy-custom-second` | setup | `campaign-second` | Activate it; create "Marsh Troll" (large, AC 15, HP 59, init +1, speed 30, claw +7 / 2d6+4 slashing, CR 5); re-activate Fixture Campaign |

| Level | What | Fixtures |
|---|---|---|
| Unit | Schemas: bounds, strict keys, 0–1 attacks, dice grammar incl. `−K`, CR enum; `speed` optional (0, 35, 200 ok; 33, 205, −5 `invalid`), a stored block without it still parses; `tokenShape` enum or null; `abilities` all six or none, 0 / 31 `invalid`; `saveProficiencies` duplicate or without `abilities` `invalid`; helpers take a stat block: `abilityMod` table ends, proficiency by level and CR (1/4 → +2, 5 → +3, 30 → +9), save bonus with / without proficiency; *(sprint 2)* `FR-ENT-25 hpFormula` (`2d6`, `2d8+2`, `33d20+330` ok; `51d6`, `2d7`, `d6`, `2d6+1000` `invalid`; a block without it parses) and `hpAverage` (`2d6` → 7, `2d8+2` → 11, `1d4-3` → 1); XP table; `effectiveStats` identity; visibility matrix (DM / owner / other player × character / custom / imported; redacted `down` true at 0 HP, false above, no HP field); list sort. **Review check:** only `effectiveStats` reads instance stats; no listener mutates state | In-code |
| Integration | Each command: row + log + event, IDs from `ctx`; rollback → none. Read-only `forbidden`, no event. No active campaign → `conflict`. Derive cross-campaign → `not_found`; base edit leaves derived unchanged. Name `conflict` (create, rename, character); custom "Goblin" allowed. Bad owner → `invalid`. `hpCurrent` clamp. `PUT` without `tokenShape` → null. Owner change: old owner gets redacted upsert, new owner full. **Hook:** a test-registered hook's row is in the same commit and in `EntityUpdated.changes`; a throwing hook rolls back the update. Bad stored JSON row → DM snapshot omits it, log line present. **Leak scan:** `player-1` frames never contain "Elite Goblin Warrior", "Marsh Troll", "Goblin" or Thorn's `1d4+3`; restart → identical snapshots | `entities` |
| E2E (thin) | DM list rows; dropping a row on a test drop target yields its `definitionId`; `player-1` WS frames hold Mira full, no monster records; restart | `entities` |
| Unit *(S4)* | `FR-ENT-26 type`: the 14 types parse, `swarm` / `Humanoid` → `invalid` (path `statBlock.type`), a character with `type` → `invalid`, a block without it parses. `FR-ENT-28 art per creature type`: `creature-art` has exactly one glyph per `CREATURE_TYPES` entry, each a non-empty path + viewBox; `tokenArtOf(token)` → `image` when `imageAssetId` is set, else the type, else `initials` (for `"initials"` and null alike). `FR-ENT-29 licence`: one `ATTRIBUTION.md` row per glyph (name, author, licence, url); the module exports strings only (no `<`, no `href`). `FR-ENT-18 order`: equal names → custom, then `srd-5.1`, then `fixture`, then id | In-code |
| Integration *(S4)* | **`FR-ENT-27 art per creature type`**: placing SRD Goblin → `humanoid`, Ogre → `giant`, Wolf → `beast`, Adult Red Dragon → `dragon`, Elite Goblin Warrior (derived) → `humanoid`, Mira → null; combat Start places its tokens with the type; Ctrl-D duplicate copies it; `map.updateToken {creatureType: "initials"}` then `{creatureType: "giant"}` (DM) → stored, `{creatureType: null}` → `invalid`, player → `forbidden`; a definition edit humanoid → fiend leaves placed tokens unchanged. **`FR-ENT-27 fill`**: a custom without type + 2 tokens (one left null, one set to Initials = `"initials"`) → update adds `fiend` → the null token becomes `fiend` in the same commit and is listed in `EntityUpdated.changes`; the Initials token stays `"initials"` and is not listed (review B7); `cmp.importRecorded` with recorded goblin lacking `type`, then with it → `ImportedEntityUpdated.changes` lists goblin tokens of both campaigns, frames only to the active one. **`FR-ENT-30 players never see hidden tokens' art`**: leak scan over `player-1` / `player-2` frames: hidden Ogre's token never appears (so neither does its `creatureType`); visible tokens carry theirs. CON-44: `snapshot-size.test.ts`, fog and compendium `con44` baselines + the §12 figures | `compendium-full` |
| E2E (thin) *(S4)* | DM and `player-1`: the Goblin token node has `art = humanoid`; after Art ▸ Initials both see `art = initials` | `compendium-full` |

**Existing tests S4 updates** (review B36; assertions change, names keep their FR IDs):
- `src/shared/entities/schemas.test.ts` "FR-ENT-18 list sort: name ci, then custom before imported, then id" and `src/client/dm/features/entities/list.test.ts` "FR-ENT-18 sorted by name ci, custom before imported, then id…" → then source rank (`srd-5.1` before `fixture`), then id.
- `src/server/features/scenes-map/commands.test.ts` "FR-MAP-13 / -16 place…" and `feedback.test.ts` "FR-MAP-35 / -36 place copies the definition's tokenShape and speed…" → the placed token also carries `creatureType`; "FR-MAP-35 map.updateToken {shape}…" gains the `creatureType` cases (or a sibling test); `src/shared/scenes-map/schemas.test.ts` "FR-MAP-13 place…" → token schema with `creatureType`.
- `src/server/features/scenes-map/commands.test.ts` "FR-MAP-20 definition edit: size follows…" → also the fill (null only).
- `src/server/ws/snapshot-size.test.ts`, `src/server/features/fog-of-war/con44.test.ts`, `src/server/features/compendium/con44.test.ts`: token bytes in the baselines (after V6, seams S14).
- Fixture manifests (`fixtures/units/entities/entities.fixtures.test.ts`): `enemy-*` stat blocks gain `type`; IDs unchanged.

**Browser walkthrough** — `bun run build`, `fixtures:reset-load entities --profile verify`, `start --profile verify`. Contexts: A + A2 DM, B `player-1`, C `player-2`. The form ships in Combat, so DM edits are `fetch` calls from A's page with the stored secret. Player evidence: WS frame log captured with `page.on('websocket')`. Teardown: stop server, `fixtures:reset --profile verify`.

| # | DM (A, A2) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in; open Creatures | — | Mira (Player 1), Thorn (Player 2), Goblin + Wolf (SRD, lock, CR 1/4, 50 XP), Elite Goblin Warrior (Custom, derived from Goblin, CR 1/2, 100 XP). No Marsh Troll |
| 2 | — | B, C open links | From B/C frame log: B has Mira full, Thorn name only, no monsters; C the reverse |
| 3 | PUT Goblin; PUT Elite Goblin Warrior HP 20, speed 40, `tokenShape` none, saves DEX + WIS; same with speed 33; POST derive "Goblin Boss" from Goblin | — | Goblin: 403 read-only message, unchanged. Speed 33: 400, issue path `statBlock.speed`. Others: A2 updates ≤ 1 s; B, C get no `event` frame |
| 3a | *(sprint 2)* PUT Goblin Boss with `hpFormula` `4d6+3`, HP max 17; then `hpFormula` `2d7` | — | First: 200, A2's record has the formula; B, C no frame. Second: 400, issue path `statBlock.hpFormula`. The roll itself is walked in [combat-tracker §13](combat-tracker.md#13-test-plan) step 2a |
| 4 | PUT Mira name "Mira Vale"; then bring Mira to HP 0 with `char.adjustHp` (the PUT body has no `hpCurrent`) | — | From frame logs: B full upsert, C redacted upsert, ≤ 1 s. HP 0: C's redacted upsert has `down: true`, no `hpCurrent` |
| 5 | Reload all; then kill + restart server | — | All reconnect; state includes steps 3–4 |
| 6 | Switch to Second Campaign, then back | — | List: Marsh Troll + SRD only, then step-5 list. No console errors throughout |

**Fixtures (S4).** Existing units gain `type` (FIX §8, integrator; IDs unchanged): `enemy-1` `humanoid`, `enemy-2` `beast`, `enemy-custom` `humanoid` (from its base), `enemy-custom-second` `giant`. New:

| Key | Kind | Requires | Contents |
|---|---|---|---|
| `ent-art-tokens` | setup | `battlemap`, `images`, `cmp-srd-mini`, `enemy-custom` | Custom monster "Plain Brute" (no `type`, no portrait, medium, AC 12, HP 20); on scene `battlemap` (cells per FIX §8): SRD Goblin, fixture Goblin (`enemy-1`), Elite Goblin Warrior, SRD Adult Red Dragon, SRD Wolf with the `images` wolf token image (precedence), Plain Brute, SRD Ogre **hidden** |
| `cmp-srd-mini-s3` *(review B37)* | setup | — | Like `cmp-srd-mini` (same recorded mini set, same source `srd-5.1`) but with each monster's Open5e `type` removed before `cmp.importRecorded` and version `mini-s3`: the definitions a sprint-3 database holds (no `type`). Alternative to `cmp-srd-mini`, never in the same bundle |
| `art-update-tokens` *(review B37)* | setup | `battlemap`, `cmp-srd-mini-s3` | On `battlemap`: SRD Goblin, SRD Ogre, SRD Wolf (all `creatureType` null, they have no type yet); then Wolf → Art ▸ Initials (`"initials"`) |

Joins **bundle `compendium-full`** ([compendium §13](compendium.md#13-test-plan)): `ent-art-tokens`. **Bundle `token-art-update`** = `base` + `player-2` + `images` + `battlemap` + `cmp-srd-mini-s3` + `art-update-tokens` (a sprint-3 database before its first Update). Composes: both units write only their own custom / tokens on `battlemap` (and the mini import); they load inside session-sim-8.

**Browser walkthrough (S4, token art)**: `bun run build`, `fixtures:reset-load compendium-full --profile verify`, `start --profile verify`. Contexts: A DM, B `player-1`. B's evidence: WS frame log (`page.on('websocket')`). Teardown as above.

| # | DM (A) | Player (B) | Expected |
|---|---|---|---|
| T1 | Open `battlemap`, Show to players | — | Goblin (SRD), Goblin (Fixture), Elite Goblin Warrior: humanoid glyph on the humanoid colour; Adult Red Dragon: dragon glyph on its huge footprint; Wolf: its image, no glyph; Plain Brute: "PB"; Ogre: giant glyph, translucent (hidden). Names on labels below. Legible at Fit and at 1 cell = 70 px |
| T2 | — | B views the scene | Same art for the six visible tokens; no Ogre. B's frames: no token record or `creatureType` for the Ogre |
| T3 | Creatures → Edit Plain Brute: Type = Fiend, save; then Type = Undead | B watches | First save: Plain Brute's token turns into the fiend glyph for A and B ≤ 1 s (fill). Second: the token stays fiend |
| T4 | Token menu on Goblin (SRD): Art ▸ Initials, then Art ▸ Creature type | B watches | "G" for A and B, then the humanoid glyph again; the checked item follows |
| T5 | Compendium: drag Hobgoblin onto the map; Encounters: start an encounter with Ogre × 1 (Add hidden off) | B watches | Hobgoblin: humanoid glyph; the encounter's Ogre token: giant glyph, visible to B |
| T6 | Open the Compendium window (list view) → footer **Credits**; then Creatures → footer **Credits** | B: Compendium → footer **Credits** | About dialog with the "Token art" section: 14 icons, Lorc / Delapouite, CC BY 3.0, game-icons.net; the SRD attribution beside it. Same for B (player client) |
| T7 | Reload all; kill + restart the server | All rejoin | Same art on every token; no console errors |

**Walkthrough (S4, real-DB Update path, review B37)**: `fixtures:reset-load token-art-update --profile verify`, `start --profile verify`; contexts A DM, B `player-1`, B's WS frames logged.

| # | DM (A) | Player (B) | Expected |
|---|---|---|---|
| U1 | Open `battlemap`, Show to players; open Compendium | B views the scene | Goblin "G", Ogre "O", Wolf "W" for A and B (no types yet); Compendium shows **Update** (bundled version ≠ `mini-s3`) |
| U2 | Update → confirm | B watches | Toast with counts (the mini monsters `updated`); ≤ 1 s later Goblin = humanoid glyph, Ogre = giant glyph for A and B; Wolf stays "W" (Initials kept, FR-ENT-27); B's frames: token upserts for Goblin and Ogre only |
| U3 | Reload all | All rejoin | Same as U2 |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0012, 0015, 0016, 0018, 0021, 0022; #120–124 | Model, basics, pipeline, events, scope, sync, seams, Scenes decisions | accepted |
| [live-sync](live-sync.md), [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | `global` scope, visibility fns, REST → same events; players, active campaign; pipeline insert interface | complete |
| [assets-pipeline](assets-pipeline.md), [play-shell](play-shell.md) | `assets.require` (FR-ASSET-15), campaign-scoped assets; window registry for `ent.creatures`, HTML5 drag events from a window reach the base layer (FR-SHELL-13) | in-review |
| [scenes-map](scenes-map.md) | Drop handler (FR-MAP-13); `resolveDefinition`; definition-changed hook refreshing token copies (#120; replaces OQ-MAP-14's copy-at-placement pick) | in-review |
| [combat-tracker](combat-tracker.md), [character-sheet](character-sheet.md), [dice-roll-log](dice-roll-log.md) | Form via `creatureActions`, combatant hook (OQ-ENT-10); optional character fields only + `hpCurrent` commands; dice grammar ⊇ ours | Combat |
| Feedback pass, #149, #154 | scenes-map copies `speed` onto tokens and reads `tokenShape` at placement (FR-MAP-35/36); character-sheet shows speed and the abilities block (FR-CHAR-18–22); combat-tracker's form edits the new fields (FR-CBT-43), rolls monster checks / saves (FR-CBT-44) and reads `down` (FR-CBT-38) | complete |
| Sprint 2 (N5) | combat-tracker's builder / Start and combat-extras' Add dialog read `hpFormula` (FR-CBT-62/63, FR-CBTX-44); the creature form edits it | in-review (P2a) |

**Shared changes** (feedback pass; the consolidation agent writes data-model / protocol):
- `src/server/db/`: `entity.token_shape` text, nullable (values checked by zod). `speed` lives in the `statBlock` JSON leaf: zod only (`@shared/entities`), no column.
- Protocol §13: `POST` / `PUT /api/entities` gain `tokenShape?`. Data model §11: `tokenShape` row, stat block `speed`. Record types, events, visibility: unchanged.
- `entity` visibility fn (record-type registry, entities' line): redacted character gains derived `down` (#154).
- FIX §8 (integrator): speeds as §13 (`enemy-custom` inherits 30); `enemy-custom` `tokenShape` square.
- **#149:** `abilities`, `saveProficiencies` live in the `statBlock` JSON leaf: zod only (`@shared/entities`), no column, no migration. Helpers (FR-ENT-24) in `@shared/entities` (entities-owned). Data model §11 stat block rows; FIX §8 scores on `enemy-1`, `enemy-2`, `enemy-custom` (DEX save), `char-mira`, `char-thorn`. [ADR-0032](../architecture/adr/0032-ability-derivation.md) amends ADR-0012.
- **Existing common files this build edits:** none (entities has no `src/client/common/features/entities/` files; its `@shared/entities` and server folder are feature-owned).

**Shared changes — sprint 2** (N5, track P2a; builders report `shared change needed:`):
- `@shared/entities` (entities-owned, in P2a's shared-first branch): `hpFormula` in the stat block zod, `hpAverage`, `hpRollSpec`. **No DB column** (JSON leaf), no event, record type or visibility change.
- Combat's creature form (FR-CBT-43) shows the field: [FR-CBT-62](combat-tracker.md#6-functional-requirements).
- FIX §8 (integrator): `enemy-1` `2d6`, `enemy-2` `2d8+2` (SRD values); `enemy-custom` none. Data model §11 stat block row; protocol §13 bodies (stat block is zod-validated, no route change).

**Sprint 4 (S4, token art): dependencies**

| On | What we need | Status |
|---|---|---|
| [scenes-map](scenes-map.md) | Token field `creatureType` (FR-MAP-13 placement / FR-MAP-48 `placeTokenIn`, FR-MAP-17 duplicate, `map.updateToken`), the fill in its definition-changed hook (FR-MAP-20), the Art menu entries (FR-MAP-29 registry), the draw in the tokens layer (FR-MAP-35 shapes) | settled by seams S14 (OQ-ENT-26) |
| [combat-tracker](combat-tracker.md) | Creature form **Type** Select (FR-CBT-43); combat Start / Add place through `placeTokenIn` (unchanged) | settled by seams S14 (OQ-ENT-25): after R S4-1a |
| [compendium](compendium.md) | FR-CMP-39 (adapter `type`), Credits link + About "Token art" section (FR-CMP-19), FR-CMP-37 / -38 for FR-ENT-18 | same track |
| [ADR-0024](../architecture/adr/0024-definition-visibility.md) | `creatureType` as a new token display copy: [token creature type ADR](../architecture/adr/0050-token-creature-type.md) (review B6) | accepted (#245); integrator numbers it |
| [visual-direction](../design/visual-direction.md) | 14 `creature.<type>` colour tokens (§7 values) | OQ-ENT-30 |
| Packages | **None.** Glyphs are committed path data; no icon package (lucide-react's icons are UI-style and miss dragon / giant) | — |

**Build split (S4)** (seams S5, S14: schema **V6 → R0 → Mc → C-art core** (D has no schema slot); canvas **V7 → V8 → M2 → M5 → C-art**; build wave 5)

| Slice | Branch | Delivers | Shared files (AGENTS §9.9) |
|---|---|---|---|
| C-art core | `fix/cmp-art-core` | Last schema core, after Mc (seams S14). `token.creature_type` + token zod; placement / duplicate copy; `map.updateToken {creatureType}`; the fill in scenes-map's definition-changed hook; `type` + `CREATURE_TYPES` (FR-ENT-26); adapter FR-CMP-39 + `ADAPTER_VERSION` (rebased on V6's `visionFt: 0` adapter line, seams S5); fixture `type`s + `ent-art-tokens`, bundle `compendium-full` gains it; `cmp-srd-mini-s3`, `art-update-tokens`, bundle `token-art-update`; SRD second damage dice → `extraDamage` (OQ-CMP-33, after R0); CON-44 baselines; FR-ENT-26, -27, -30 | `src/server/db/`; `@shared/scenes-map` token schemas + `src/server/features/scenes-map/` commands (placement, duplicate, `updateToken`: scenes-map's files, orchestrator assigns, after Mc) and one **append-only** line in scenes-map's definition-changed hook registry (seams S14); `src/server/ws/snapshot-size.test.ts` + fog / compendium `con44` baselines (only after V6 merged, seams S14); `fixtures/bundles/index.ts` (append); data-model (token, stat block), protocol (token record, `map.updateToken`) |
| C-art | `build/cmp-token-art` | `creature-art/` glyphs + `ATTRIBUTION.md` + licence test; draw in the tokens layer + `art` node attr; canvas colour tokens; token menu Art; creature form Type; Credits links (Compendium + Creatures footers) and the About "Token art" section; thin e2e; T1–T7, U1–U3; FR-ENT-28, -29 | **Canvas lock, after M5 (V7 → V8 → M2 → M5 → C-art, seams S14):** `src/client/common/features/scenes-map/layers/TokensLayer.tsx`, `shape.ts`, canvas colours (`canvas-context`); token menu registry (append-only); `src/client/dm/features/combat-tracker/creature-form.tsx` (combat-tracker's: **after R S4-1a** (attack bonus / extra damage passthrough), one holder at a time, seams S14) |

**Sprint 6 (CP): dependencies and build.** On [combat-tracker](combat-tracker.md) (companion combatants, write-back, OQ-CBT-77 / -80 / -83), [character-sheet-full](character-sheet-full.md) (card reads the pet; NPC sheet for edits; owner change hook order with FR-CHARX-13), [party-board](party-board.md) (New pet…, the list), [scenes-map](scenes-map.md) (owner default at placement, FR-MAP-74), IM's shared matcher (the lookup). Slices: **CP0** (schema `entity.companion_of`, `entity.turn_mode`; zod; visibility fn; owner-copy hook line) and **CP1** (`POST /api/pets`, `pet.adjustHp`, Make pet dialog, badge): shared files in [CBT §14.2](combat-tracker.md#142-build-split-sprint-6-track-cp). No new package.

- C-art core needs no client change; until C-art merges, tokens carry `creatureType` and still draw initials (no visible change).
- Cut order if the sprint runs late (gate G7, #245): token art (C-art core + C-art) goes first; C-search and C-all stay.

## 15. Open questions

| ID | Question | Options (pick **bold**, not decided unless struck) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ENT-31 *(S6)* | **Who edits a pet's stats?** (#252: "not a second character sheet") | **A. DM only** (creature form / NPC sheet); the owner's card is read-only except HP: no new edit UI, the DM keeps balance / B. The owner edits AC, HP max and attacks on the card unless the DM locks it (needs a pet lock and edit UI) / C. The owner gets the NPC sheet for their pet (a second sheet in all but name) | **yes** (DM) | character-sheet-full |
| OQ-ENT-32 *(S6)* | Where a pet's stat block comes from | **Server copies the base (any source, imported included)** (FR-ENT-32) / the client sends the block as FR-ENT-09 (fails for imported monsters, not in the DM store) | no · owner: CP1 | compendium |
| OQ-ENT-33 *(S6)* | Where a pet's HP lives during a fight | **On its combatant (monster path), written back at End / Dismiss** ([FR-CBT-113](combat-tracker.md#6-functional-requirements)): combat code unchanged, one concept with summons / on the entity always, like a PC (every HP path learns a third home) | no · owner: CP0 | combat-tracker, combat-extras |
| OQ-ENT-34 *(S6)* | **character-sheet-full:** a pet's NPC sheet (`creature-sheet` row) keeps `ownerPlayerId` null, so its notes stay DM-only (CHARX's copy rule applies to characters only) | **Keep it null** ([FR-CHARX-70](character-sheet-full.md#6-functional-requirements)) / copy the owner (the owner would read the DM's notes) | no · settled in CHARX (same track) | character-sheet-full |
| OQ-ENT-35 *(S6)* | **compendium:** a **Make pet…** action on a compendium monster entry (DM) | **Later**: the Creatures row and the Party dialog's lookup cover it this sprint / add it now (compendium's entry actions, IM's files this sprint) | no · owner: orchestrator | compendium |
| OQ-ENT-36 *(S6)* | **Glossary:** add **Companion** (a creature with an owner PC and its player; a pet or a summon), **Pet** (the player's own copy of a definition, HP kept), **Summon** (a companion of any definition for one fight; Dismiss), **Turn mode** (after the owner / in the owner's turn / own initiative), **Companion card** (the owner's read-only card with Roll); amend **Token owner** ("also a companion's player") | **Add as worded** / reuse "Ally" (an ally has no owner) | no · owner: integrator | glossary |
| OQ-ENT-03 | Entities UI in MVP | **Read-only DM Creatures window (drag source, `creatureActions`)** / each feature builds its own picker | no (owner: spec-entities) | scenes-map, combat-tracker, play-shell |
| OQ-ENT-04 | ~~Shared basics shape~~ | **Decided (#124):** one creature core (ADR-0009 storage A, #93) | — | — |
| OQ-ENT-05 | ~~What players see of definitions~~ | **Decided (#120):** monsters hidden; own character full; others name, portrait, owner; instances carry display copies ([ADR-0024](../architecture/adr/0024-definition-visibility.md)) | — | — |
| OQ-ENT-06 | Record types for two scopes | **Two types, one schema: `entity` (campaign), `imported-entity` (global)** / one type with per-record scope (registry change) | no (owner: spec-entities) | live-sync |
| OQ-ENT-07 | Delete a custom definition (ADR-0009 open row) | **No delete in MVP** (rename covers typos; no FK coordination) / block while referenced / cascade | no (owner: spec-entities) | scenes-map, combat-tracker |
| OQ-ENT-08 | Where PC current HP lives | **`hpCurrent` on `entity`; HP commands by combat-tracker / character-sheet** / separate state table | no (owner: character-sheet) | character-sheet, combat-tracker |
| OQ-ENT-09 | ~~Player-visible instance data~~ | **Decided (#120):** tokens carry read-only name, image, size copies, refreshed by an in-transaction hook (FR-ENT-19). Which renamed tokens keep their name: scenes-map | — | — |
| OQ-ENT-10 | Combatant HP above a lowered `hpMax`; combatant display copies | **Combat-tracker clamps and refreshes copies in an in-transaction hook (FR-ENT-19)** / leave until healed | no (owner: combat-tracker) | combat-tracker |
| OQ-ENT-11 | XP for CR 0 (SRD: "0 or 10") | **10** (DMG table) / 0 | no (owner: combat-tracker) | combat-tracker |
| OQ-ENT-12 | Answers to fixtures-adapters | **OQ-FIX-15: inline; OQ-FIX-19: entities ships create/derive + `enemy-custom` in Scenes, form in Combat; `char-mira` record + basics = entities, extra sheet fields = character-sheet** | no (owner: spec-entities) | fixtures-adapters |
| OQ-ENT-13 | ~~Glossary: **Instance**; **Combatant**~~ | **Decided (integrator, Scenes consolidation):** [glossary](../glossary.md) updated. Instance holds its own display name (#126), read-only copies of image and size, play state and modifiers; Combatant adds "for PCs, HP lives on the character" | — | — |
| OQ-ENT-14 | AGENTS §9.9: add append-only registries (server definition-changed hooks; DM `creatureActions`) | **Add both** (other specs add lines, never edit entities' code) / combat-tracker edits entities' folder | no (owner: integrator) | AGENTS, scenes-map, combat-tracker |
| OQ-ENT-15 | Other PCs' HP for players (party view) | **Combat-phase call: nothing in Scenes; combat-tracker picks** (combatant copy / band only / redacted character adds HP) | no (owner: combat-tracker) | combat-tracker, character-sheet |
| OQ-ENT-16, 17 | `speed` shape (F3); where the default token shape lives (F4) | **16: one optional walking speed, int 0–200, multiple of 5** (fly / swim / climb later as more optional fields) / object `{walk, fly?, swim?}` now. **17: nullable `tokenShape` column on `entity`** (presentation, beside the portrait) / optional field in `statBlock` | no (owner: spec-feedback) | scenes-map, combat-tracker, character-sheet |
| ~~OQ-ENT-18~~ | ~~Monsters get abilities and save proficiencies now too? (#149)~~ | **Decided (#154):** yes, same optional core fields for both kinds; the DM rolls monster checks / saves from the initiative row ([FR-CBT-44](combat-tracker.md#6-functional-requirements)) | — | combat-tracker |
| ~~OQ-ENT-20~~ | ~~HP formula shape (N5)~~ | **Decided (#190):** optional string `hpFormula` in the stat block (`2d8+2`, entities' dice subset); `hpMax` stays the Average value. Rejected: structured `{count, die, bonus}`; deriving `hpMax` from the formula | — | combat-tracker, combat-extras, fixtures-adapters |
| OQ-ENT-21 | Glossary: **HP formula** ("dice expression for a creature's hit points; Average = the stat block's HP max, Rolled = the formula rolled when the creature joins combat") | **Add** | no · owner: integrator | glossary |
| OQ-ENT-22 | *(S4)* Token art source and licence | **Decided** (DM, sprint-4 gate 1, #245; G3): **14 glyphs from game-icons.net, CC BY 3.0 (Lorc, Delapouite), white on the type's colour; 26.6 KB path data, 12.7 KB gzip per client; credit behind an always-reachable "Credits" link + `ATTRIBUTION.md`** (FR-ENT-29). Rejected: monogram on a type colour, own-drawn SVGs, lucide icons. **The 14 icons** (checked against the game-icons repo): aberration `tentacle-strike` (Lorc), beast `wolf-head` (Lorc), celestial `angel-wings` (Lorc), construct `golem-head` (Delapouite), dragon `dragon-head` (Lorc), elemental `fire-silhouette` (Lorc), fey `fairy` (Lorc), fiend `devil-mask` (Delapouite), giant `giant` (Delapouite), humanoid `visored-helm` (Lorc), monstrosity `hydra` (Lorc), ooze `slime` (Delapouite), plant `carnivorous-plant` (Delapouite), undead `dread-skull` (Lorc). Third-party content with attribution, not a package dependency (seams S14). The integrator logs the decision in the decisions log (review B41); no ADR-0018 change. ADR-0017's "no copyrighted art" concerns fixture images; these icons are licensed product art with credit, shown on fixture tokens only through the product's renderer | — | scenes-map, compendium |
| OQ-ENT-23 | *(S4)* Art granularity | **Decided** (DM, sprint-4 gate 1, #245; G44): **per creature type (14 types cover all 322 SRD monsters)**. Rejected: per type × size, per monster for ~30 | — | — |
| OQ-ENT-24 | *(S4)* Initiative-row portraits (combat-tracker parts) | **A. Tokens only this sprint** (R owns combat UI; Initiative keeps image or initials) / B. the row reads its token's `creatureType` when the client has that token (no new data; touches combat files) | no (owner: C-art `build/cmp-token-art`) | combat-tracker |
| OQ-ENT-25 | *(S4)* **combat-tracker**: creature form Type | Settled by seams S14 and rulings B8 (replacement text in C's summary, applied by the integrator at merge): **amend FR-CBT-43: optional Type Select (14 types + "None"), kept on derive; C-art edits `creature-form.tsx` after R S4-1a, one holder at a time**. Rejected: no field (customs from scratch never get art) | no (settled) | combat-tracker |
| OQ-ENT-26 | *(S4)* **scenes-map**: token `creatureType` | Settled by seams S14: **amend FR-MAP-13 / -17 / -20 / -29 / -35 / -48 per FR-ENT-27, -28 (field, placement, duplicate, fill hook, Art menu, draw); token-owned like `shape` after placement; *(review B6: it is a new player-visible display copy, so the [token creature type ADR](../architecture/adr/0050-token-creature-type.md), accepted #245, refines ADR-0024; B8: the integrator applies C's FR-MAP replacement text at merge, M and V don't edit for it)*; the fill is one append-only definition-changed hook line, the Art entry one append-only token menu line; C-art core after Mc, C-art draws in `TokensLayer.tsx` after M5**. Rejected: scenes-map's own builder does it (no scenes-map slice this sprint) | no (settled) | scenes-map |
| OQ-ENT-27 | *(S4)* Art on tokens placed before the definition had a type | **Fill once when the definition gains a type, null tokens only; a DM's Initials (`"initials"`) is kept (FR-ENT-27, review B7): the SRD Update gives existing tokens art** / new placements only (old tokens stay initials until the menu) / always follow the definition's type (overrides the DM's Initials choice). *(Gate 1 bulk-accept, #245: fill once, never over the DM's Initials.)* | no (owner: C-art core `fix/cmp-art-core`) | scenes-map |
| OQ-ENT-28 | *(S4)* Glossary | **Add "Creature type"** (a monster's SRD type, e.g. humanoid; picks its token art) and **"Token art"** (the glyph on a type colour drawn for a token without an image) | no (owner: integrator) · **Glossary: applied (#246)** | glossary |
| OQ-ENT-29 | *(S4, review B6)* Type art visible to players | **Decided** (DM, sprint-4 gate 1, #245; G44): **players see the type art on visible monster tokens by default; the DM sets Art ▸ Initials per token to hide it** (a disguised fiend). The [token creature type ADR](../architecture/adr/0050-token-creature-type.md) (accepted, G4) adds `creatureType` to ADR-0024's display copies. Rejected: DM opt-in per token | — | ADR-0024, scenes-map |
| OQ-ENT-30 | *(S4, review B39)* **visual-direction**: 14 `creature.<type>` canvas colour tokens | **Add them as theme placeholders with the §7 values (white glyph ≥ 4.99 : 1, measured)**; the theme system may restyle later / pick per-type colours from shadcn's chart palette (5 colours, too few) / one neutral colour for all types (glyph only tells them apart) | no (owner: integrator) · **Visual-direction: applied (#246)** | visual-direction |
| ~~OQ-ENT-19~~ | ~~Character data without an edit UI (review #11)~~ | **Decided (#154):** fixtures / `PUT /api/entities` in MVP; full PC / NPC editing and player-filled sheets design-for-later | — | character-sheet |

## 16. Out of scope

- *(S4)* Art per individual monster, character token art (class glyphs), Initiative-row art (OQ-ENT-24), animated or layered token frames (theme-system).
- *(S6)* Player-made pets; pet levelling or stat scaling; deleting a pet (release instead); a Make pet action in the compendium window (OQ-ENT-35).
- See §4. Instance records → [scenes-map](scenes-map.md), [combat-tracker](combat-tracker.md). Modifiers → [combat-extras](combat-extras.md). Re-import ([OQ-FIX-18](fixtures-adapters.md#15-open-questions)) → [compendium](post-mvp/compendium.md).
