---
title: Entities (core)
prefix: ENT
status: in-review
owner: spec-compendium
wave: 2
phase: post-mvp-4
---

# Entities (core)

## 1. Summary

- The **creature definition** contract that tokens, combatants and encounter entries point at. MVP kinds: `character`, `monster` ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). One `entity` table, one shared zod creature core, same shape for SRD, custom and fixture ([ADR-0009](../architecture/adr/0009-entity-content-model.md), #124). Imported definitions are global and read-only; customs and characters belong to one campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md)).
- **Schema ownership:** entities owns the creature core for both kinds. [character-sheet](character-sheet.md) may only add optional character fields; [combat-tracker](combat-tracker.md)'s creature form edits this schema and may show a subset.
- Players never see monster definitions; instances carry read-only display copies, refreshed inside the edit's transaction (#120, [ADR-0024](../architecture/adr/0024-definition-visibility.md)).
- **Sprint 4 (track C, [#244](../decisions-log.md), session-sim-7 glitch 9: tokens of compendium monsters show "GS", "O", "H"):** monsters gain an optional **creature type**, and a token without an image is drawn with **token art** for its type instead of initials (FR-ENT-26–30). The Creatures window orders equal names by source rank ([compendium FR-CMP-38](compendium.md#6-functional-requirements)). Picks marked **(DM)** in §15 wait for DM gate 1.

## 2. Scope

- `entity` record, XP from CR, record types + visibility fns; create / derive / update, internal import, definition-changed hooks, `resolveDefinition`; DM **Creatures** window *(proposed, OQ-ENT-03)*; fixtures + bundle `entities`.
- **Feedback pass** ([feature-tiers §8](../feature-tiers.md#8-dm-feedback-after-the-combat-build-145), #148): optional **speed** in the creature core (movement tracker, F3) and an optional **default token shape** on the definition (F4). Both additive.
- **#149:** optional **ability scores** and **save proficiencies** in the creature core (both kinds), plus pure derivation helpers (modifier, proficiency bonus, check / save bonus) for the sheet's and combat's check / save buttons.
- **#154:** redacted characters carry a derived `down` flag (combat's PC Down indicator for everyone). Character speed, scores and saves come from fixtures / `PUT /api/entities` in MVP; full PC / NPC editing and player-filled sheets are design-for-later.
- **Sprint 2 (N5, #188; FR-ENT-25):** optional **HP formula** on the stat block, so combat can add a creature with **average** (the stat block's HP max) or **rolled** HP.
- **Sprint 4 (S4; FR-ENT-26–30):** optional monster `type` (14 SRD creature types); token `creatureType`; one bundled glyph per type drawn on a type colour; DM token menu **Art**; licence + attribution. Creatures window: source rank and the shared matcher (FR-ENT-18 amended). **Not in S4:** art per individual monster, art for characters (Brakka stays "B" until the DM sets a portrait), Initiative-row portraits (OQ-ENT-24).

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
| FR-ENT-18 | DM Creatures window lists every definition the campaign can use, sorted by name (case-insensitive), then custom before imported, *(S4)* then imported by source rank ([FR-CMP-38](compendium.md#6-functional-requirements): `srd-5.1` before `fixture`), then id. *(S4)* Its search box filters store rows with the shared matcher ([FR-CMP-37](compendium.md#6-functional-requirements): every word must match a name word). Live ≤ 1 s after commit. Each row is an HTML5 drag source: MIME `application/x-pp-definition`, data JSON `{definitionId}`. *(proposed, OQ-ENT-03)* | scenes-map FR-MAP-13 |
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
| FR-ENT-27 | **Token `creatureType`** (type \| null), owned by the token like its shape ([FR-MAP-35](scenes-map.md#6-functional-requirements)): placement (`placeTokenIn`, so also combat's Start and Add, FR-MAP-48) sets it from the definition's `statBlock.type` (characters, no type: null); duplicate copies it; the DM changes it in the token menu **Art** (`map.updateToken {creatureType}`, FR-ENT-28). A definition edit never changes it, with one exception, **fill**: an update that gives a definition a type it didn't have (absent → present: the SRD Update, a form edit) sets that type on the definition's tokens whose `creatureType` is null, inside the update's transaction (scenes-map's definition-changed hook, FR-ENT-19; for imported definitions in every campaign, [FR-CMP-08](compendium.md#6-functional-requirements)); those tokens are listed in the event's `changes`. Draw precedence: token image (portrait or DM-chosen) > creature-type art > initials. | **(DM)** OQ-ENT-23 |
| FR-ENT-28 | **Art set and menu.** One bundled glyph per creature type (14), SVG path data in `src/client/common/features/entities/creature-art/` (`index.ts`: type → `{path, viewBox}`), drawn by the tokens layer as the glyph (≈ 65 % of the footprint) on a backdrop that follows the token shape (round: disc; square: rounded square; none: glyph only), filled with the type's colour (one canvas colour token per type, `creature.<type>`, per [visual-direction](../design/visual-direction.md) placeholders; no hard-coded colours in components); the name stays on the label layer (FR-MAP-42). DM token menu **Art** (token-menu registry, FR-MAP-29): "Creature type" (sets the definition's current type; disabled without one) and "Initials" (null); the current one is checked. Players: no menu. | **(DM)** OQ-ENT-22 |
| FR-ENT-29 | **Licence and attribution.** Glyph source per OQ-ENT-22 (pick: game-icons.net, CC BY 3.0). `creature-art/ATTRIBUTION.md` lists per type: icon name, author, licence, url; the compendium's **About** dialog ([FR-CMP-19](compendium.md#6-functional-requirements)) adds a "Token art" line with the same credit. Files are copied by hand once (no network at runtime or in tests); a licence test checks one glyph per type, one attribution row per glyph, and that the module holds path strings only (no markup, no `href`). | As the SRD credit (FR-CMP-04, -19) |
| FR-ENT-30 | **Visibility.** `creatureType` is a field of the `token` record, so it follows scenes-map's token visibility fn: a player receives it only on tokens they receive (never on hidden, fogged-out or invisible ones). No definition field reaches players. The art set ships in both clients (not secret). Accepted leak: a **visible** token's art shows its type, as a portrait would; the DM picks **Initials** to hide it (a disguised fiend). | ADR-0024 |

## 7. UI/UX notes

- **DM view — window `ent.creatures`** (per [visual-direction](../design/visual-direction.md), [play-shell](play-shell.md) registry): DM only, default closed, 420×520 at top-left below `map.scenes`, launcher "Creatures".
- shadcn Table + Tabs (All / Characters / Monsters). Row: portrait thumb, name, kind, source Badge (`SRD` / `Custom` / owner name), CR + XP (monsters). Imported rows: lock icon, Tooltip "Read-only — derive to customise". Derived customs: "derived from Goblin" (muted), or "derived from (unknown)" if the base can't be resolved. New / Derive / Edit come from `creatureActions` (combat-tracker, Combat phase); drop onto the canvas: scenes-map.
- **States:** empty "No creatures yet"; loading skeleton; disconnected: last list stays + live-sync banner; error: invalid rows omitted (FR-ENT-01), REST errors as Toast. **Test IDs:** `ent-list`, `ent-list-tab-<all|character|monster>`, `ent-list-row` + `data-record-id`, `ent-list-row-lock`, `ent-list-empty`.
- **Player view:** no entities UI. Own character: [character-sheet](character-sheet.md); token labels from instances ([scenes-map](scenes-map.md)).
- *(S4)* **Token art** (FR-ENT-27, -28), same for DM and players on every token they see: a goblin without a portrait is a humanoid glyph on the humanoid colour, the ogre a giant glyph, the wolf a beast glyph; the name label stays below. DM's hidden tokens keep their translucent styling; selection / target rings, bars and badges draw over the art as over an image. DM token menu: **Art ▸ Creature type / Initials** (checked item = current). A token with an image never shows art. Test hooks: the token node (`map-token`) gains attr `art` = `image` \| `<type>` \| `initials`; menu items `ent-token-menu-art-type`, `ent-token-menu-art-initials`. Visual check in the walkthrough: glyph legible at 1 cell (70 px) and at Fit zoom, contrast against both the type colour and a dark map.

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

- *(S4)* **Token** (scenes-map's table, written by this track's core slice): `creatureType` text \| null (zod: the 14 types), token-owned presentation like `shape`; set at placement / duplicate / menu, filled once by FR-ENT-27. One nullable column `token.creature_type`. **Derived:** the art drawn = image > type > initials (client). **Not stored:** glyphs and colours (client bundle).

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

*(S4)* No new event, intent or record type. `token` gains `creatureType` (visibility: the token's own rule, FR-ENT-30); `map.updateToken` gains `creatureType?: type | null` (DM); `EntityUpdated` / `ImportedEntityUpdated` `changes` may list tokens filled by FR-ENT-27.

Other writers of a character's `hpCurrent` (character-sheet's `CharacterHpAdjusted`; combat via `characters.adjustHp`) upsert `entity`; other players' redacted copy changes only when `down` flips, else it is the same redacted upsert (timing tell accepted, character-sheet §9).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create / derive / update custom monster; create (fixtures) / update character | ✓ | ✗ (own-sheet edits: [OQ-CHAR-03](character-sheet.md#15-open-questions)) | DM credential; FR-ENT-04, 07–11; `resolveDefinition` |
| Update imported; delete anything | ✗ | ✗ | `forbidden` / no route |
| Receive records | full | own character full; others redacted (+ `down`); monsters hidden | FR-ENT-15, 16 |
| *(S4)* Set a token's art (menu) | ✓ | ✗ | `map.updateToken`: DM only (scenes-map) |
| *(S4)* See a token's art | every token | tokens they receive only | FR-ENT-30 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** fresh snapshot; own character incl. `hpCurrent` current; an owner change meanwhile is reflected. Existing tokens keep their own owner; the DM reassigns them (#124, scenes-map).
- **DM disconnect / reconnect:** REST doesn't depend on the WS. Lost create response → retry hits the unique name index (`conflict`), never a duplicate.
- **Server crash mid-action:** one transaction per command (row + hook-changed instances + log): all or nothing, so no stale display copies. Import batch all-or-nothing (FR-FIX-19). After restart, snapshots equal pre-crash state.
- **Concurrent edits:** two DM tabs update one definition → last commit wins (whole replace). Campaign switch: old customs leave the DM store with the resync; `resolveDefinition` rejects them. Edit during combat: instances follow at once (FR-ENT-19); the combat log keeps values used at the time (ADR-0009).
- **Invalid / malicious input:** strict zod (unknown keys, bounds, dice grammar); names rendered as text; spoofed `campaignId` / `source` → `invalid` (not in schema).
- **No backfill (feedback, #149):** columns are additive and nullable; existing characters have no speed, scores or saves until a fixture reload or a DM `PUT /api/entities/:id` (#154: fixtures / API in MVP; character editing UI is design-for-later, [levelling](post-mvp/levelling.md)). The sheet shows "Speed —" and "No ability scores" meanwhile.
- **Leak accepted (#154):** other players learn that a PC is at 0 HP (`down`), never the number.
- *(S4)* **Token art:** existing tokens of definitions without a type stay initials until the definition gains one (the SRD **Update** fills every campaign's tokens of those definitions, FR-ENT-27) or the DM picks Art ▸ Creature type. A custom created from scratch has no type until the DM sets it in the form. Type changed later (humanoid → fiend): placed tokens keep theirs (token-owned; the DM uses the menu). Disconnect / reconnect: the art is drawn from the token record in the snapshot; no image load, so no loading or error state. Server crash: placement, menu change and fill are each one transaction with their command.
- **HP formula (sprint 2):** a formula whose average differs from `hpMax` is allowed (homebrew); Average still means `hpMax`, the form shows "Formula average 15" beside HP max. Existing customs and imported rows without a formula offer Average only until the DM adds one (imported: derive first, FR-ENT-07).

## 12. Performance & bandwidth

- *(S4, measured; throwaway probe on `session-sim` + realistic-heavy harness, deleted)*: 60 tokens per snapshot frame (active scene). `creatureType` adds 20 B per token as `null` (+1,200 B) and at most 29 B with the longest type `monstrosity` (+1,740 B), per viewer. DM 670,394 → ≤ 672,134 B (1 MiB ceiling, #208); players 277,334–280,394 → ≤ 282,134 B (512 KiB). A scene load at the 200-token cap: ≤ +5,800 B. Each placement / menu event: ≤ +29 B. Monster `type` lives in `imported-entity` / `entity` rows (DM only; `imported-entity` is lazy, 0 B in any snapshot). **Client bundle:** 14 glyphs as path data, estimated ≤ 60 KB before gzip in each client (C-art logs the measured `bun run build` size).
- MVP: ≤ ~20 definitions per campaign, ≤ 2 KB each → ≤ 40 KB of snapshot; edits are rare (prep); events ≤ 2 KB plus hook-changed instances. Hundreds of imported definitions (post-MVP compendium) would bloat the DM snapshot: move `imported-entity` to on-demand REST then.

## 13. Test plan

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
| Unit *(S4)* | `FR-ENT-26 type`: the 14 types parse, `swarm` / `Humanoid` → `invalid` (path `statBlock.type`), a character with `type` → `invalid`, a block without it parses. `FR-ENT-28 art per creature type`: `creature-art` has exactly one glyph per `CREATURE_TYPES` entry, each a non-empty path + viewBox; `tokenArtOf(token)` → `image` when `imageAssetId` is set, else the type, else `initials`. `FR-ENT-29 licence`: one `ATTRIBUTION.md` row per glyph (name, author, licence, url); the module exports strings only (no `<`, no `href`). `FR-ENT-18 order`: equal names → custom, then `srd-5.1`, then `fixture`, then id | In-code |
| Integration *(S4)* | **`FR-ENT-27 art per creature type`**: placing SRD Goblin → `humanoid`, Ogre → `giant`, Wolf → `beast`, Adult Red Dragon → `dragon`, Elite Goblin Warrior (derived) → `humanoid`, Mira → null; combat Start places its tokens with the type; Ctrl-D duplicate copies it; `map.updateToken {creatureType: null}` then `{creatureType: "giant"}` (DM) → stored, player → `forbidden`; a definition edit humanoid → fiend leaves placed tokens unchanged. **`FR-ENT-27 fill`**: a custom without type + 2 tokens (one set to Initials, still null) → update adds `fiend` → both tokens `fiend` in the same commit, listed in `EntityUpdated.changes`; `cmp.importRecorded` with recorded goblin lacking `type`, then with it → `ImportedEntityUpdated.changes` lists goblin tokens of both campaigns, frames only to the active one. **`FR-ENT-30 players never see hidden tokens' art`**: leak scan over `player-1` / `player-2` frames: hidden Ogre's token never appears (so neither does its `creatureType`); visible tokens carry theirs. CON-44: `snapshot-size.test.ts`, fog and compendium `con44` baselines + the §12 figures | `compendium-full` |
| E2E (thin) *(S4)* | DM and `player-1`: the Goblin token node has `art = humanoid`; after Art ▸ Initials both see `art = initials` | `compendium-full` |

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

Joins **bundle `compendium-full`** ([compendium §13](compendium.md#13-test-plan)). Composes: writes only its own custom and tokens on `battlemap`; loads inside session-sim-8.

**Browser walkthrough (S4, token art)**: `bun run build`, `fixtures:reset-load compendium-full --profile verify`, `start --profile verify`. Contexts: A DM, B `player-1`. B's evidence: WS frame log (`page.on('websocket')`). Teardown as above.

| # | DM (A) | Player (B) | Expected |
|---|---|---|---|
| T1 | Open `battlemap`, Show to players | — | Goblin (SRD), Goblin (Fixture), Elite Goblin Warrior: humanoid glyph on the humanoid colour; Adult Red Dragon: dragon glyph on its huge footprint; Wolf: its image, no glyph; Plain Brute: "PB"; Ogre: giant glyph, translucent (hidden). Names on labels below. Legible at Fit and at 1 cell = 70 px |
| T2 | — | B views the scene | Same art for the six visible tokens; no Ogre. B's frames: no token record or `creatureType` for the Ogre |
| T3 | Creatures → Edit Plain Brute: Type = Fiend, save; then Type = Undead | B watches | First save: Plain Brute's token turns into the fiend glyph for A and B ≤ 1 s (fill). Second: the token stays fiend |
| T4 | Token menu on Goblin (SRD): Art ▸ Initials, then Art ▸ Creature type | B watches | "G" for A and B, then the humanoid glyph again; the checked item follows |
| T5 | Compendium: drag Hobgoblin onto the map; Encounters: start an encounter with Ogre × 1 (Add hidden off) | B watches | Hobgoblin: humanoid glyph; the encounter's Ogre token: giant glyph, visible to B |
| T6 | Compendium → About | — | "Token art" credit line beside the SRD attribution |
| T7 | Reload all; kill + restart the server | All rejoin | Same art on every token; no console errors |

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
| [scenes-map](scenes-map.md) | Token field `creatureType` (FR-MAP-13 placement / FR-MAP-48 `placeTokenIn`, FR-MAP-17 duplicate, `map.updateToken`), the fill in its definition-changed hook (FR-MAP-20), the Art menu entries (FR-MAP-29 registry), the draw in the tokens layer (FR-MAP-35 shapes) | OQ-ENT-26 |
| [combat-tracker](combat-tracker.md) | Creature form **Type** Select (FR-CBT-43); combat Start / Add place through `placeTokenIn` (unchanged) | OQ-ENT-25 |
| [compendium](compendium.md) | FR-CMP-39 (adapter `type`), About line (FR-CMP-19), FR-CMP-37 / -38 for FR-ENT-18 | same track |
| Packages | **None.** Glyphs are committed path data; no icon package (lucide-react's icons are UI-style and miss dragon / giant) | — |

**Build split (S4)** (hotspots per [sprint-4](../agents/sprint-4.md#boundaries-and-hotspots-sequence-these): schema cores V → R → D → M → **C last**; canvas V → M → C)

| Slice | Branch | Delivers | Shared files (AGENTS §9.9) |
|---|---|---|---|
| C-art core | `fix/cmp-art-core` | Last schema core. `token.creature_type` + token zod; placement / duplicate copy; `map.updateToken {creatureType}`; the fill in scenes-map's definition-changed hook; `type` + `CREATURE_TYPES` (FR-ENT-26); adapter FR-CMP-39 + `ADAPTER_VERSION`; fixture `type`s + `ent-art-tokens`, bundle `compendium-full` gains it; CON-44 baselines; FR-ENT-26, -27, -30 | `src/server/db/`; `@shared/scenes-map` token schemas + `src/server/features/scenes-map/` commands and hook (scenes-map's files: orchestrator assigns); `src/server/ws/snapshot-size.test.ts` + fog / compendium `con44` baselines (after V's ws lock); `fixtures/bundles/index.ts` (append); data-model (token, stat block), protocol (token record, `map.updateToken`) |
| C-art | `build/cmp-token-art` | `creature-art/` glyphs + `ATTRIBUTION.md` + licence test; draw in the tokens layer + `art` node attr; canvas colour tokens; token menu Art; creature form Type; About line; thin e2e; T1–T7; FR-ENT-28, -29 | **Canvas lock, after V's and M's canvas slices:** `src/client/common/features/scenes-map/layers/TokensLayer.tsx`, `shape.ts`, canvas colours (`canvas-context`); token menu registry (append); `src/client/dm/features/combat-tracker/creature-form.tsx` (combat-tracker's: assigned; R doesn't edit the form) |

- C-art core needs no client change; until C-art merges, tokens carry `creatureType` and still draw initials (no visible change).

## 15. Open questions

| ID | Question | Options (pick **bold**, not decided unless struck) | Blocking? | Affects |
|---|---|---|---|---|
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
| OQ-ENT-22 | *(S4, DM)* Token art source and licence | A. Monogram (initials) on the type's colour: no files, no licence, weakest look / **B. One glyph per creature type from game-icons.net (CC BY 3.0), white on the type's colour**: fantasy look, 14 files, one credit line in About + `ATTRIBUTION.md` (FR-ENT-29) / C. Own-drawn SVG glyphs (our licence): no credit, builder's drawing effort, uneven quality / D. lucide icons (ISC, already a dependency): UI look, no dragon / giant / ooze icon | no (DM gate 1; owner: spec-compendium) | scenes-map, compendium |
| OQ-ENT-23 | *(S4, DM)* Art granularity | **A. Per creature type (14)**: covers 322 / 322 SRD monsters; the footprint already shows size / B. per type × size (adds nothing the footprint doesn't) / C. per monster for the ~30 most used SRD monsters + type fallback (more curation; later, additive) | no (DM gate 1; owner: spec-compendium) | — |
| OQ-ENT-24 | *(S4)* Initiative-row portraits (combat-tracker parts) | **A. Tokens only this sprint** (R owns combat UI; Initiative keeps image or initials) / B. the row reads its token's `creatureType` when the client has that token (no new data; touches combat files) | no (owner: spec-compendium) | combat-tracker |
| OQ-ENT-25 | *(S4)* **combat-tracker**: creature form Type | **Amend FR-CBT-43: optional Type Select (14 types + "None"), kept on derive; C-art edits `creature-form.tsx` (assigned)** / no field (customs from scratch never get art) | no (owner: integrator) | combat-tracker |
| OQ-ENT-26 | *(S4)* **scenes-map**: token `creatureType` | **Amend FR-MAP-13 / -17 / -20 / -29 / -35 / -48 per FR-ENT-27, -28 (field, placement, duplicate, fill hook, Art menu, draw); token-owned presentation like `shape`, not a stat copy, so ADR-0024 is unchanged; C-art core and C-art edit scenes-map's files (assigned, after V and M)** / scenes-map's own builder does it (no scenes-map slice this sprint) | no (owner: integrator) | scenes-map |
| OQ-ENT-27 | *(S4)* Art on tokens placed before the definition had a type | **Fill once when the definition gains a type (FR-ENT-27): the SRD Update gives existing tokens art** / new placements only (old tokens stay initials until the menu) / always follow the definition's type (overrides the DM's Initials choice) | no (owner: spec-compendium) | scenes-map |
| OQ-ENT-28 | *(S4)* Glossary | **Add "Creature type"** (a monster's SRD type, e.g. humanoid; picks its token art) and **"Token art"** (the glyph on a type colour drawn for a token without an image) | no (owner: integrator) | glossary |
| ~~OQ-ENT-19~~ | ~~Character data without an edit UI (review #11)~~ | **Decided (#154):** fixtures / `PUT /api/entities` in MVP; full PC / NPC editing and player-filled sheets design-for-later | — | character-sheet |

## 16. Out of scope

- *(S4)* Art per individual monster, character token art (class glyphs), Initiative-row art (OQ-ENT-24), animated or layered token frames (theme-system).
- See §4. Instance records → [scenes-map](scenes-map.md), [combat-tracker](combat-tracker.md). Modifiers → [combat-extras](combat-extras.md). Re-import ([OQ-FIX-18](fixtures-adapters.md#15-open-questions)) → [compendium](post-mvp/compendium.md).
