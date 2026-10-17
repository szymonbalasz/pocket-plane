---
title: Compendium
prefix: CMP
status: complete
owner: spec-compendium
phase: post-mvp-4
---

# Compendium

> **Guideline:** five-minute read. Decided at sprint-3 DM gate 1 ([#207](../decisions-log.md); changes #208 snapshot ceilings, #209 class features as trigger data). Measured figures come from a throwaway probe on the realistic-heavy harness and real SRD 5.1 data (Open5e v1, document `wotc-srd`), deleted before commit. Sprint-3 seams ruling applied (S1, S3, S5–S8, S10, S11; cited as "seams S<n>"), then the review rulings (C1–C15, X2).
>
> **Sprint 4 revision (track C, [#243](../decisions-log.md) [20], [#244](../decisions-log.md), session-sim-7 glitch 4):** search splits on whitespace and every word must match ("potion heal" → Potion of Healing), with a ranking that puts the SRD Goblin above the thin fixture one; duplicate names (12 × "Ability Score Improvement") collapse into one row. Token art for compendium / derived monsters is specified in [entities §6](entities.md#6-functional-requirements) (FR-ENT-26–30). New FRs: FR-CMP-32–39; amended: FR-CMP-10, -17, -18. Figures in §12 from a throwaway probe on the realistic-heavy harness + the full bundled `srd-5.1` import (deleted before commit). Decided at sprint-4 DM gate 1 ([#245](../decisions-log.md); G41–G43, G3, G44, G7).

### Sprint 4 at a glance

| FR | What | Slice | Named test (§13) |
|---|---|---|---|
| FR-CMP-32, -33 | Fold, AND words, tiers 0–5, ties | C-search | `FR-CMP-32 fold`, `FR-CMP-33 tiers`, `"potion heal" → Potion of Healing first`, `word order`, `ranking table` |
| FR-CMP-34 | In-memory index, dropped on writes | C-search | `FR-CMP-34 index freshness` (+ timing) |
| FR-CMP-35, -36 | Groups, `sameAs`, default list | C-search (server), C-all (window) | `FR-CMP-35/36 All tab default`, `group count = expanded rows`, `paging across a group` |
| FR-CMP-37 | Shared matcher (Creatures, lookups) | C-search | `FR-CMP-37 matcher parity` |
| FR-CMP-38 | Source rank | C-search | `FR-CMP-38 SRD Goblin above fixture Goblin` |
| FR-CMP-14 (S4 use) | Players never see hidden entries in pages, groups, `sameAs` | C-search | `FR-CMP-14 player search never returns hidden entries` |
| FR-CMP-39 | Adapter `type` + `ADAPTER_VERSION` | C-art core ([entities](entities.md#sprint-4-at-a-glance)) | `FR-CMP-39 adapter type` |
| FR-CMP-19 (S4) | Credits link (token art) | C-art | ENT `FR-ENT-29 licence`, walkthrough T6 |

## 1. Summary

- A searchable library of SRD 5.1 rules content (**monsters, spells, items, conditions, class features**), imported offline from data bundled in the repo, plus per-campaign **homebrew**. DM decision [#203](../decisions-log.md); system = 5e 2014 SRD ([#23](../decisions-log.md)).
- Imported entries are **global and read-only**; the DM edits by **cloning** (other kinds) or **deriving** (monsters) into the campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md), [ADR-0010](../architecture/adr/0010-compendium-design.md) option i). Completes ADR-0010's scope as option A: [ADR-0046](../architecture/adr/0046-compendium-scope.md).
- **Nothing from the compendium is in a snapshot.** Entries are read on demand over REST; imported creature definitions become a lazy record type (CON-44: all 322 SRD monsters would add 341 KB to the heavy DM snapshot).

## 2. Scope

- **C1 core:** tables, kind schemas, Open5e adapter over recorded responses, bundled source `srd-5.1`, import command (atomic, idempotent, in-place update), fixtures.
- **C2 read:** REST search / get for DM and players with per-role visibility; `imported-entity` loads on demand; creature lookups search the server.
- **C3 window:** Compendium window (both clients), entry views, DM import button, DM token menu **Stat block** (OQ-CMP-10).
- **C4 homebrew:** homebrew entries (spells, items, conditions, features), clone, derive a monster from an entry (traits copied to the NPC sheet), **Add to sheet**, class-feature seam for rule-trigger presets.
- **Sprint 4 (S4):** word search with AND and a tier ranking (FR-CMP-32–34), source rank (FR-CMP-38), duplicate-name groups and the All tab's default list (FR-CMP-35, -36), one shared matcher for the window, the creature lookups and the Creatures window (FR-CMP-37), the adapter's creature `type` for token art (FR-CMP-39; art itself: entities FR-ENT-26–30).
- **Not in S4:** typo-tolerant (fuzzy) search, search syntax beyond plain words (OQ-CMP-26), 5etools class import ([compendium-expansion](post-mvp/compendium-expansion.md), #244).

## 3. Goals

- The DM finds any SRD monster or spell in ≤ 2 keystrokes' worth of typing and drops it into play without cloning.
- One click imports the whole SRD offline in ≤ 2 s; re-import never touches DM work.
- Players can read rules (spells, items, conditions, features) and never learn monsters or unshared homebrew.
- Zero bytes added to any snapshot.
- *(S4)* Typing the words you remember, in any order, finds the entry: "potion heal", "heal potion", "hunters mark". The real SRD entry beats a thin fixture copy with the same name. Search answers in ≤ 5 ms on the server over the full import.

## 4. Non-goals

- Open5e download at runtime, SRD 5.2 (2024), 5etools (→ [compendium-expansion](post-mvp/compendium-expansion.md)), homebrew **files**, Griffon's Saddlebag, AI paste ([ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md)): each is a later adapter or form helper.
- Races, backgrounds, feats, rules chapters (rules quick reference, tier B); structured editors per kind (homebrew is one text form).
- A rules engine: entries never change rolls or effects by themselves; presets are [effect-modifiers](effect-modifiers.md)' (OQ-CMP-14).
- Overlays / patches on imported entries (ADR-0010 option C); per-campaign imports (option B). Deleting imported entries.

## 5. User stories

**DM**
- As the DM, I want to search "goblin", see the full SRD stat block and drag it onto the map or into an encounter as is.
- As the DM, I want to derive "Goblin Sneak" from the SRD goblin with its traits copied, so my NPC keeps Nimble Escape.
- As the DM, I want my homebrew items hidden from players until I tick "Shared".
- As the DM, I want "Stat block" on a monster token's menu.
- *(S4)* As the DM, I want "potion heal" to find Potion of Healing, and "goblin" to give me the SRD Goblin first.
- *(S4)* As the DM, I want the All tab to show one "Ability Score Improvement" row I can expand, not twelve.

**Player**
- As a player, I want to look up Fireball or Poisoned mid-session without leaving the app.
- As a player, I want to add Sneak Attack from the compendium to my sheet's Features.
- *(S4)* As a player, I want "cure wound" to find Cure Wounds, without ever seeing the DM's unshared homebrew.

## 6. Functional requirements

All writes: one transaction (rows + event-log entry), then the domain event ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)); IDs and time from `ctx` ([AGENTS §9.3](../../AGENTS.md#93-fixtures)). REST errors `{code, message, issues?}` (protocol CON-09).

| ID | Requirement | Notes |
|---|---|---|
| **C1 core** | | |
| FR-CMP-01 | Kind registry in `@shared/compendium`: `monster`, `spell`, `item`, `condition`, `feature`, each a strict zod body + facets schema (§8.1). Entry JSON ≤ 32 KB. Text fields are **markdown-lite** strings (FR-CMP-26). | |
| FR-CMP-02 | **Imported** entry: `campaignId` null, `source` + `sourceKey` set, read-only; unique `(source, sourceKey)`. **Homebrew** entry: `campaignId` = `ctx.campaignId`, `source` null, kind ≠ `monster`; name unique case-insensitive per campaign and kind (`conflict`). | ADR-0018 |
| FR-CMP-03 | A `monster` entry holds only reference text (traits, actions text, legendary, senses…). Its playable stat block is an imported **creature definition** (`entity`, same `(source, sourceKey)`) written in the same transaction; the entry links it as `definitionId`. | One creature contract ([ADR-0009](../architecture/adr/0009-entity-content-model.md)) |
| FR-CMP-04 | Source row per imported source: key, name, licence, attribution, url, `version` (SHA-256 over its bundled files + the adapter's `ADAPTER_VERSION` constant, bumped on any mapping change, so a new mapping also shows **Update**), `importedAt`, counts. Attribution is stored once here; entries carry the source key. | CC BY 4.0 |
| FR-CMP-05 | **Open5e adapter** (pure, server): recorded Open5e v1 responses → import batch. Keeps only `document__slug = wotc-srd` (also for class archetypes: Open5e mixes in non-SRD subclasses). Monster → creature core: size, AC (≤ 30), HP, `hpFormula` when it fits FR-ENT-25, init = DEX mod, walking speed, six scores, save proficiencies, attacks = actions with an attack bonus and damage dice (≤ 20; damage type from text), CR; `senses.darkvisionFt` from "darkvision N ft" into the creature core's `senses` (V0, seams S6; see-through-magical-darkness stays false; blindsight / truesight stay text); everything else → reference text. Class `desc` / SRD subclass split at headings into one `feature` per heading; `level` parsed from "At / Beginning at / Starting at Nth level" or "reach Nth level", else from the class table's Features column, else absent (#213: Rage = 1). Attacks with two damage dice (44 SRD monsters, e.g. 2d10+2d6) keep the first die + bonus; the extra damage stays in the action text with a warning (#213). A field that doesn't fit is dropped and counted as a warning; the record stays. *(S4: V6 adds `visionFt: 0` to the mapping, V's OQ-CHARX-30, seams S5; C-art core adds `type`, FR-CMP-39.)* | Measured: 322 / 322 SRD monsters map; seams S6 |
| FR-CMP-06 | **Bundled source** `srd-5.1`: the recorded responses (monsters, spells, magic items, weapons, armor, conditions, classes; 2.2 MB) + attribution file under `src/server/features/compendium/sources/srd-5.1/`. **Filtered at recording time**: the recorder (`sources/srd-5.1/record.ts`, run by hand with `bun`, the only network use) writes only `document__slug = wotc-srd` records, nested class `archetypes` included, so the repo never holds non-SRD text. The attribution file quotes the exact SRD 5.1 CC BY 4.0 statement (as `fixtures/srd/source.ts`) and names Open5e v1 (url) as provenance (transcription only; we rely on CC BY 4.0, not Open5e's OGL label). No network at runtime or in tests. | OQ-CMP-01; ADR-0018 |
| FR-CMP-07 | `cmp.import {source}` (DM): adapter → pipeline core, **one transaction**: validate all → upsert by `(source, sourceKey)` → per record `created` \| `updated` (stored data hash differs) \| `existing`. Any error → nothing written, every issue returned. Result: counts per kind × outcome, warnings. Refused while an encounter is started in the active campaign (`conflict` "End combat first"): the write blocks every command for its duration. Internal twin `cmp.importRecorded {source descriptor, responses}` (fixtures, tests; no encounter check). | OQ-CMP-11, OQ-FIX-18 |
| FR-CMP-08 | Events: created monster definition → `EntityImported` (FR-FIX-23); updated imported definition → `ImportedEntityUpdated`, running entities' definition-changed hooks ([FR-ENT-19](entities.md#6-functional-requirements)) over instances in **every** campaign that uses it; then one `CompendiumImported {source, version, counts}` (log `campaignId` null). Logging: the definition upserts go in a `campaignId` null row; hook-changed instances go in **one log row per affected campaign** with that campaign's changes. Broadcast: definition upserts to DM connections; instance changes only to the active campaign (inactive campaigns pick them up from the DB at their next snapshot). Nothing created or updated → no event, no log entry. | |
| FR-CMP-09 | Re-import never touches homebrew, clones, derived customs or NPC sheets (independent copies, ADR-0010 i). Entries missing from a newer source stay unchanged. | OQ-CMP-16 |
| **C2 read** | | |
| FR-CMP-10 | `GET /api/compendium/search` `{q ≤ 100, kind?, filters?, cursor?, sameAs?}` → ≤ 50 summaries `{id, kind, name, sourceLabel, line, definitionId?, group?}` + `nextCursor`. ~~Order: name prefix, word start, substring, then (q ≥ 3 chars) text match; ties by name, id.~~ *(S4: matching and order per FR-CMP-32–35, 38; `sameAs` and `group` per FR-CMP-35.)* Empty `q` lists by name (groups collapsed, FR-CMP-36). | OQ-CMP-09 |
| FR-CMP-11 | Filters: monster `crMin`/`crMax`, `type`; spell `level`, `school`, `className`; item `category`, `rarity`; feature `className`, `subclass`. Unknown key or value → `invalid`. | |
| FR-CMP-12 | `GET /api/compendium/entries/:id` → the entry + its source attribution; a monster also carries its definition's stat block. `ETag` = entry `updatedAt` + source `version`. Order: auth → visibility (FR-CMP-14: not visible → `404` before any conditional check) → `If-None-Match` → `304`. Every compendium response (incl. errors and search) sends `Cache-Control: private, no-cache`. | |
| FR-CMP-13 | Auth: DM secret, or the player's link token as `Authorization: Player <token>` (CAMP's `resolvePlayerLink`); player of an inactive campaign → `409`. Campaign = the credential's (DM: active campaign). The `Authorization: Player` check is route-local middleware in `src/server/features/compendium/`, not server core. | OQ-CMP-20 |
| FR-CMP-14 | **Visibility** `entryVisibleTo(entry, viewer)`, one pure fn for both routes: DM: imported + own campaign's homebrew. Player: imported non-monster + own campaign's homebrew with `shared`. Other campaigns: never. Not visible = absent from search; GET → `404 not_found`, same as an unknown id. A player's `kind=monster` → empty page. | OQ-CMP-07; [ADR-0024](../architecture/adr/0024-definition-visibility.md) |
| FR-CMP-15 | `imported-entity` registers as a **lazy** record type, global scope, ids mode ([ADR-0045](../architecture/adr/0045-lazy-record-types.md), party-board; the one on-demand path, seams S1): in no snapshot; DM loads by ids with `sync.load`; players never (audience `dm` unchanged). Live upserts still reach DM connections. | OQ-CMP-04 |
| FR-CMP-16 | Client hook `useDefinitions(ids)` (`src/client/common/features/compendium/`, on `fix/lazy-records`' client API; no ws / store edit, seams S3) returns campaign `entity` rows from the store and imported ones loaded on demand (missing ids in one `sync.load`, ≤ 50 per call, reloaded after each snapshot; `loading` / `ready` / `error`). Player client: store only, never loads. It replaces every `useRecords("imported-entity")` call (§14). A boundary-style `bun test` forbids reading `imported-entity` from the store anywhere outside `useDefinitions`, so sprint-3 code built before C2 (R's trigger editor, V's `senses` reads) fails loudly instead of silently seeing nothing. | |
| FR-CMP-17 | Creature lookups ([FR-CBT-63](combat-tracker.md#6-functional-requirements): builder, Add dialog) and the Creatures window ([FR-ENT-18](entities.md#6-functional-requirements)) take customs from the store and imported monsters from FR-CMP-10 (`kind=monster`, debounced 150 ms); merged with FR-CBT-63's ranking *(S4: merged per FR-CMP-37: shared tiers, then store before imported, then the server's order, so the SRD Goblin precedes the fixture Goblin)*, ≤ 8 suggestions, row and drag data (`{definitionId}`) unchanged. For the DM, with kind absent or `monster`, search results also include imported creature definitions that have no compendium entry (e.g. the fixture Goblin and Wolf) as monster summaries with id = `definitionId`; they match on name only (no text tier, no type filter), `GET /entries/:id` on such an id returns `404`; players never get them (#236). | |
| **C3 window** | | |
| FR-CMP-18 | Window `cmp.compendium` in both clients' registries: default closed, launcher "Compendium", 440×560, min 320×360. Search input (debounced 200 ms), kind Tabs (DM: All, Monsters, Spells, Items, Conditions, Features; player: no Monsters), Filters popover, results with **More** *(S4: group rows expand in place, FR-CMP-35)*, entry view with Back. Passes the registry-driven layout tests (fits at 1280×720, no product overlap at 1600×900). | [play-shell](play-shell.md); seams S8 |
| FR-CMP-19 | Entry views: monster stat block (core from the definition + reference sections), spell, item, condition, feature. Footer: "SRD 5.1 · CC BY 4.0" + **About** dialog with the full attribution; homebrew shows "Homebrew" (+ "Shared" / "DM only" for the DM). *(S4, review B13)* The window's list view also has a footer link **Credits**, always shown in both clients (also with nothing imported or a player's empty state); it opens the same About dialog, which lists the SRD attribution (when a source is imported) and the **token art** credits ([FR-ENT-29](entities.md#6-functional-requirements)). | CC BY 4.0, CC BY 3.0 |
| FR-CMP-20 | DM import panel: no source imported → empty state with **Import SRD 5.1**; imported → "SRD 5.1 · N entries · imported ‹date›" and **Update** when the bundled `version` differs. Click → confirm AlertDialog "Players will pause for ~2 s" → `POST /api/compendium/import` → Toast with counts, or the error ("End combat first" while an encounter is started). Button disabled while running. | |
| FR-CMP-21 | DM: monster result rows are HTML5 drag sources with entities' MIME `{definitionId}` (map drop FR-MAP-13, unchanged). | |
| FR-CMP-22 | DM token menu entry **Stat block** (registry, [FR-MAP-29](scenes-map.md#6-functional-requirements)) on monster tokens: imported definition → opens `cmp.compendium` on its entry; custom → the NPC sheet ([character-sheet-full](character-sheet-full.md)). Players: no entry. | OQ-CMP-10 |
| FR-CMP-23 | Results and views read on demand; no live push. A window refetches on open, search and Back; the DM's own writes refetch at once. | OQ-CMP-15 |
| **C4 homebrew** | | |
| FR-CMP-24 | `POST` / `PUT /api/compendium/entries[/:id]` (DM) `cmp.putEntry`: homebrew create / whole replace: kind (≠ monster, immutable), name (as [FR-ENT-08](entities.md#6-functional-requirements)), facets, body text ≤ 8,000 chars, `shared` (default false), `derivedFromId?` (a visible entry; informational). Imported id → `forbidden` "Imported entries are read-only. Clone to edit.". `CompendiumEntrySaved`. | |
| FR-CMP-25 | **Clone** = the homebrew form prefilled from a visible non-monster entry; saving creates an independent entry (no link). `DELETE /api/compendium/entries/:id` (DM): homebrew only (`forbidden` on imported). `CompendiumEntryDeleted`. Sheet rows added from it stay (copies). | ADR-0010 i |
| FR-CMP-26 | **Markdown-lite**: paragraphs, `**bold**`, `*italic*`, `- ` lists, pipe tables. One client renderer outputs text nodes only, never HTML; the adapter normalises Open5e text to it. Text runs go through dice-extras' `DiceText` (`src/client/common/features/dice-extras/DiceText.tsx`) once D1 is on `main`, so dice terms ("1d6 + 2", "2d6") are clickable (to-hit bonuses are not notation, FR-DICEX-28); until then plain text. Context: monster view `{creature: definitionId, label: action / trait name, category: attack \| damage}` (attack when the expression has a `1d20`, else damage); spells, items, conditions, features: `{label: entry name}`, no actor (default). No second parser. | OQ-CMP-13; seams S7 |
| FR-CMP-27 | **Derive from a monster entry** (DM): "Derive…" opens the creature form ([FR-CBT-43](combat-tracker.md#6-functional-requirements)) prefilled from the definition; `POST /api/compendium/derive-monster {entryId, entity, copyText}` runs, in one transaction, entities' `createIn` (derive, [FR-ENT-09](entities.md#6-functional-requirements)) and, if `copyText`, the NPC sheet's `features` rows: traits, then actions and bonus actions without a mapped attack (#239), reactions, legendary actions (name ≤ 60, source "SRD 5.1", text clipped to 600 with "…", ≤ 30 rows). `EntityCreated` + the sheet change. "Duplicate NPC" = derive from a custom (exists). | OQ-CMP-08 |
| FR-CMP-28 | **Add to sheet** (spell, item, feature views): DM picks a campaign character; a player only their own. Intent `cmp.addToSheet {entryId, characterId}` (feature-local command, `intent: true`), **one transaction**: entry visible to the caller (FR-CMP-14, else `not_found`); authorisation as `char.putRow` (DM any campaign character; owner unless locked, [FR-CHARX-12](character-sheet-full.md#6-functional-requirements), `forbidden` "Locked by the DM"); CHARX internal row insert: spell → `{name, level, concentration, ritual, roll: none, effect: damage}`; item → `{name, qty 1}`; feature → `{name, source (≤ 40), text (clipped 600)}`; if FR-CMP-29 resolves a trigger, MOD's exported `addTriggerFromPreset(env, characterId, {presetKey} \| {name, rule})` in the same transaction. If the character already has that trigger (built-in: a trigger with the preset's name, case-insensitive, or its exact rule; inline: a trigger with the entry's name, case-insensitive), the row is still added but the trigger is skipped; the ack returns `triggerSkipped: true` and the Toast reads "Added to ‹name›'s Features. Trigger already on the sheet — delete it first to use the compendium's." (#241). Any failure (incl. MOD validation) → nothing written, error Toast. Events: `CharacterSheetEdited` + MOD's trigger event. | CHARX §8.2; seams S5 |
| FR-CMP-29 | **Feature key**: every `feature` **and `spell`** entry exposes `featureKey` = `<source>:<sourceKey>` (e.g. `srd-5.1:feature/rogue/sneak-attack`, `srd-5.1:spell/hunters-mark`; homebrew `campaign:<entryId>`); features also `className` from the SRD's twelve class names (same spelling as CHARX `classes[].name`, matched case-insensitively by MOD's `level(<class>)`). Preset resolution (**trigger presets only**): a feature's `presetKey` (a MOD built-in trigger key), else its `preset` (a `TriggerRule`, MOD's zod in `@shared/effect-modifiers/triggers.ts`, opaque here), else the MOD built-in **trigger** preset that lists this `featureKey`. An effect preset listing the key (e.g. `rage`) is ignored: no trigger and no character preset (the owner adds the toggle in the sheet, FR-MOD-07). Spells resolve by built-in only: Hunter's Mark → trigger `hunters-mark` (the mark itself stays a DM apply, FR-MOD-05). Found → the view shows "Preset: ‹name›" and Add to sheet also adds the trigger (FR-CMP-28). | Seam with R; seams S5 |
| **Cross-cutting** | | |
| FR-CMP-30 | No compendium row in any snapshot; the CON-44 test imports the full bundled source on the heavy harness and asserts the compendium's per-type bound (DM snapshot does not grow: 0 B) and that the snapshot stays under the DM ceiling (1 MiB, [#208](../decisions-log.md)). No headroom guard (dropped, #208). | CON-44 |
| FR-CMP-31 | Full import of `srd-5.1`: target ≤ 2 s, logged by the test (warn above); the test fails only above 10 s (wall clock on Windows / CI). Re-import of an unchanged source: target ≤ 0.5 s, no writes (asserted). | FIX budget style |
| **S4 search** | | |
| FR-CMP-32 | **Folding and words.** `fold(s)`: Unicode NFD, combining marks removed, lower-case, `'` and `’` removed ("Hunter's" → `hunters`), every other run of characters that are not letters or digits → one space, trimmed. Query words = `fold(q)` split on spaces, duplicates dropped, first 8 kept. Name words / text words = `fold(name)` / `fold(searchText)` split the same way. The **query phrase** = `queryWords(q).join(" ")` (folded, deduplicated). A query word of ≥ 4 chars ending in `s` also matches without that `s` ("potions" → `potion`; tiers 2–5 only; tiers 0–1 compare the query phrase unchanged) (OQ-CMP-27, decided #245). `q` that folds to nothing = empty `q` (FR-CMP-36). | [20] |
| FR-CMP-33 | **AND match and tiers.** An entry matches iff **every** query word matches its name or its text. A word matches the name if a name word **starts with** it, or (tier 3) the folded name contains it; it matches the text if a text word starts with it and the query word has ≥ 3 chars (`TEXT_MATCH_MIN`, now per word). Tier = the lowest that applies: **0** folded name = the query phrase (FR-CMP-32); **1** folded name starts with the query phrase; **2** every word starts a name word, any order; **3** every word is in the name, ≥ 1 only inside a word; **4** ≥ 1 word in the name, the rest only in the text; **5** text only. Ties: source rank (FR-CMP-38), then shorter folded name, then folded name, then id. `cursor` = opaque keyset of that tuple (`[tier, sourceRank, length, foldedName, id]`; a group row uses its best member's tuple, FR-CMP-35), validated (`invalid`). Kind and filters (FR-CMP-11) narrow first; entry-less imported definitions (FR-CMP-17) have name tiers 0–3 only. | OQ-CMP-28 (decided #245); examples §13 |
| FR-CMP-34 | **Search index.** Server-only, in memory: one row per compendium entry and per entry-less imported monster definition (`id`, kind, campaignId, shared, source, facets, folded name words, folded text words). Built at the first search after start, dropped by a listener on `EntityImported`, `ImportedEntityUpdated`, `CompendiumImported`, `CompendiumEntrySaved`, `CompendiumEntryDeleted` and rebuilt at the next search, so a search never answers from rows older than the last commit. Visibility (FR-CMP-14) is applied per request before grouping and paging. Replaces today's `instr` scan and the entry-less join. No DB column, FTS table or package. Budget: ≤ 5 ms p95 per search over the full import (logged; the test fails above 50 ms). | OQ-CMP-09 revised; §12 |
| FR-CMP-35 | **Duplicate groups.** After ranking, visibility and filters, the **matching** results with the same kind, folded name and source (homebrew: same campaign) collapse into **one summary** when there are **≥ 2** of them (one → a plain row): `id` = its **best member** (first by the FR-CMP-33 tuple); `group {count}` = the matching visible members; `line` = "‹count› entries · ‹distinct className, comma-separated›" for features, else "‹count› entries", ≤ 80 chars; placed and paged by its best member's tuple (so the keyset cursor stays total: members never appear as separate rows and a page never splits a group); counts as one of the 50. `GET /search?sameAs=<id>[&q=…]` (any other parameter → `invalid`) lists the members of that id's group that are visible and match `q` (empty `q`: all visible members), ≤ 50, by `line`, then id; so the expanded list always has `count` rows. An id that is unknown, not visible or entry-less → empty page, never an error (no existence oracle). | sim-7 glitch 4; review B12 |
| FR-CMP-36 | **Default list** (empty `q`), every tab: by folded name, groups collapsed (All opens with one "Ability Score Improvement · 12 entries" row, not 12) (OQ-CMP-29, decided #245). | sim-7 glitch 4 |
| FR-CMP-37 | **One matcher everywhere.** `@shared/compendium/match.ts` (pure) exports `fold`, `queryWords`, `nameTier(name, words)` (tiers 0–3 or null) and `sourceRank`. The server index uses it; the DM client uses it for store rows in the Creatures window filter ([FR-ENT-18](entities.md#6-functional-requirements), amended) and the creature lookups ([FR-CBT-63](combat-tracker.md#6-functional-requirements), amended; OQ-CMP-31; replacement text in this track's summary, applied by the integrator at merge, rulings B8), so a multi-word query matches the same everywhere. Lookup merge: tier, then store rows (customs, characters) before imported, then the server's order; ≤ 8. | |
| FR-CMP-38 | **Source rank** (OQ-CMP-30, decided #245): 0 the campaign's own (homebrew entries, custom definitions), 1 bundled sources (`srd-5.1`), 2 other imported sources (later adapters), 3 `fixture` (exists only on disposable data, [AGENTS §9.3](../../AGENTS.md#93-fixtures)). Applies to search ties (FR-CMP-33), lookups (FR-CMP-37) and the Creatures window order (FR-ENT-18). Badges unchanged. | sim-7 glitch 4; amends OQ-CMP-22 |
| FR-CMP-39 | **Creature type for token art.** The Open5e adapter maps a monster's `type` to the creature core's `type` ([FR-ENT-26](entities.md#6-functional-requirements)); a value outside the 14 SRD types is dropped with a warning. `ADAPTER_VERSION` is bumped, so the bundled `version` changes and the DM sees **Update**; the Update writes the 322 definitions as `updated` in place (FR-CMP-07, -08), which runs the definition-changed hooks (token art fill, [FR-ENT-27](entities.md#6-functional-requirements)). Measured: all 322 SRD monsters carry one of the 14 types; an Update that changes every monster's creature core (317 `updated`, hooks run) takes 403 ms, an unchanged re-import 161 ms (§12; FR-CMP-31 targets 2 s / 0.5 s). V6 bumps `ADAPTER_VERSION` for its own `visionFt: 0` line too (rulings B40), so the two bumps are independent. | Token art |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md), shadcn/ui only.

- **Window `cmp.compendium`** (FR-CMP-18): top: search Input + Filters Popover (Selects / number inputs per kind) ; Tabs; results as a compact list (name, muted line "CR 1/4 · Small humanoid", "Level 3 evocation", "Rare wondrous item", source Badge `SRD` / `Homebrew`); **More** at the bottom. Entry view replaces the list; Back returns with scroll kept.
- *(S4)* **Search**: placeholder "Search: words in any order". A **group row** (FR-CMP-35) shows the name, the muted group line ("12 entries · Barbarian, Bard, Cleric…") and a chevron; click expands the members in place below it (fetched with `sameAs`, each with its own line, e.g. "Fighter · 4th level"); click a member opens it; click the group row again collapses. Expanded groups reset on a new search. No match → "No matches for ‘…’. Every word must match." Same in both clients.
- **Stat block**: header (name, size / type / alignment), AC / HP (formula) / speed row, six scores with mods, saves / skills / senses / languages / CR + XP, then Traits, Actions, Reactions, Legendary sections. DM actions row: **Derive…**, drag handle.
- **Homebrew form** (Dialog): kind (create only), name, facets per kind, text Textarea with a live markdown-lite preview, **Shared with players** Switch. Clone / Edit / Delete on homebrew views (DM).
- **Add to sheet**: Popover with a character Select (player: own characters only) → Toast "Added to Mira's Features" (+ "and Triggers" when a preset was added).
- **Import / Update**: AlertDialog "Players will pause for ~2 s" with Import / Cancel.
- **States**: empty "No matches for ‘…’"; nothing imported: DM empty state with Import, player "The DM hasn't set up the compendium yet"; loading skeleton rows; error Toast + retry; disconnected: REST still works, but writes follow the shell's offline rule (buttons disabled while not `live`).
- **DM view**: everything above + import panel + token menu **Stat block**. **Player view**: no Monsters tab, no Derive / Clone / Edit / import; Add to sheet for own characters.
- **Test IDs**: `cmp-window`, `cmp-search`, `cmp-filters`, `cmp-tab` (+ `data-value` kind \| `all`), `cmp-result` (+ `data-record-id`, `data-value` = kind), `cmp-more`, `cmp-empty`, `cmp-entry` (+ `data-record-id`), `cmp-back`, `cmp-statblock-<header|scores|traits|actions|reactions|legendary>`, `cmp-attribution`, `cmp-about`, `cmp-import`, `cmp-import-confirm`, `cmp-import-status`, `cmp-update`, `cmp-derive`, `cmp-derive-copy-text`, `cmp-clone`, `cmp-edit`, `cmp-delete`, `cmp-form-<kind|name|text|preview|shared|save>`, `cmp-add-to-sheet`, `cmp-add-to-sheet-character`, `cmp-preset`, `cmp-token-menu-statblock`. *(S4)* `cmp-result` gains `data-group-count` on group rows; `cmp-group-toggle` (+ `data-record-id`, `aria-expanded`), `cmp-group-member` (+ `data-record-id`), `cmp-credits` (list-view footer link, FR-CMP-19; opens `cmp-about`).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| **Compendium source** (`compendium_source`, global) | key | text PK | `srd-5.1` |
| | name, licence, attribution, url | text | Attribution once per source (FR-CMP-04) |
| | version | text | SHA-256 of bundled files + `ADAPTER_VERSION` |
| | importedAt | timestamp | `ctx.clock` |
| | counts | **JSON leaf** `{<kind>: int}` | Last import |
| **Compendium entry** (`compendium_entry`) | id | ID | `ctx.ids` |
| | campaignId | ID → Campaign \| null | null = imported (global) |
| | kind | `monster` \| `spell` \| `item` \| `condition` \| `feature` | Immutable |
| | source, sourceKey | text → source.key, text \| null | Unique `(source, sourceKey)`; sourceKey `<kind>/<slug>`, e.g. `feature/rogue/sneak-attack` |
| | name, nameKey | text 1–80, lower NFC | Unique `(campaignId, kind, nameKey)` where homebrew |
| | line | text ≤ 80 | Summary line, derived at write |
| | facets | **JSON leaf** (§8.1) | Filters via `json_extract` |
| | body | **JSON leaf** (§8.1) | ≤ 32 KB |
| | searchText | text | Lower-case plain text for FR-CMP-10's text match |
| | dataHash | text | Upsert change detection (FR-CMP-07) |
| | definitionId | ID → Entity \| null | Monsters only (FR-CMP-03) |
| | shared | bool | Homebrew only; imported = n/a |
| | derivedFromId | ID \| null | Informational, no FK |
| | createdAt, updatedAt, importedAt | timestamp | |

### 8.1 Kinds (facets / body)

| Kind | Facets | Body |
|---|---|---|
| monster | `cr`, `type`, `size` | `meta {subtype?, alignment?, armorNote?, speedText?, savesText?, skillsText?, vulnerabilities?, resistances?, immunities?, conditionImmunities?, senses?, languages?}` (text ≤ 200 each); `traits`, `actions`, `bonusActions`, `reactions` 0–40 × `{name ≤ 80, text ≤ 4,000}`; `legendary? {intro, actions[]}` |
| spell | `level` 0–9, `school`, `classes[]`, `concentration`, `ritual` | `castingTime`, `range`, `components`, `material?` (≤ 1,000 chars, #213), `duration`, `text`, `higherLevel?` |
| item | `category` weapon \| armor \| gear \| magic, `rarity?`, `attunement` | `typeLine`, `cost?`, `weight?`, `damage?`, `properties?`, `ac?`, `text` |
| condition | — | `text` |
| feature | `className` (SRD class), `subclass?`, `level?` 1–20 | `text`; `presetKey?` (MOD built-in key) or `preset?` (`TriggerRule`, MOD's zod, opaque here); at most one (FR-CMP-29) |

- **Relations:** source 1—* imported entry; campaign 1—* homebrew entry; monster entry 1—1 imported definition (`entity`); homebrew → base (informational). Sheet rows and derived customs are copies, never linked.
- **Derived:** `readOnly = source != null`, `line`, `featureKey`, XP (from CR, FR-ENT-03), `sourceLabel`.
- *(S4)* **No schema change for search.** `nameKey` and `searchText` stay as stored; folding happens when the in-memory **search index** (FR-CMP-34) is built: derived, server-only, never persisted, never sent. Summary gains derived `group? {count}` (FR-CMP-35). Monster definitions gain the creature core's optional `type` (JSON leaf, zod only, [entities §8](entities.md#8-data-model)).
- **Persisted runtime state:** none; the compendium is prep / reference data.
- **Not a record type:** entries and sources never travel on the WS; only `imported-entity` (entities) does, lazily.

## 9. API & events

**REST (Hono RPC)** — prefix per [OQ-CAMP-15](campaign-management.md#15-open-questions)

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/compendium/search` | DM, player | FR-CMP-10/11/14; *(S4)* matching FR-CMP-32–34, `sameAs` + `group` FR-CMP-35 |
| GET | `/api/compendium/entries/:id` | DM, player | FR-CMP-12/14 |
| GET | `/api/compendium/sources` | DM | Sources + bundled versions (import panel) |
| POST | `/api/compendium/import` | DM | `cmp.import {source}` (FR-CMP-07) → `200 {counts, warnings}` |
| POST / PUT / DELETE | `/api/compendium/entries[/:id]` | DM | Homebrew (FR-CMP-24/25) |
| POST | `/api/compendium/derive-monster` | DM | FR-CMP-27 → `201 {entity}` |

All REST responses: `Cache-Control: private, no-cache` (FR-CMP-12).

**WS intents:** `cmp.addToSheet {entryId, characterId}` (DM; player for own characters; FR-CMP-28), registered feature-locally (no protocol file). Also uses `sync.load {type: "imported-entity", ids}` (P's lazy ADR).

**Domain events** (all logged; none transient or undoable)

| Event | Changes | Visibility rule |
|---|---|---|
| `EntityImported` (existing, per created monster) | `imported-entity` upsert | DM only (audience `dm`) |
| `ImportedEntityUpdated {entityId}` | `imported-entity` upsert + hook-changed instances (FR-ENT-19); log rows per FR-CMP-08 | DM; instances per their own fns, active campaign only (players see token copy changes, e.g. size) |
| `CharacterSheetEdited` + MOD's trigger event (`cmp.addToSheet`, FR-CMP-28) | sheet row; `rule-trigger` row if a preset resolved | as CHARX / MOD (owner + DM; trigger per MOD's fns) |
| `CompendiumImported {source, version, counts}` | none (entries aren't a record type) | DM only; log `campaignId` null |
| `CompendiumEntrySaved {entryId, kind, shared}` / `CompendiumEntryDeleted {entryId}` | none | DM only |
| `EntityCreated` + `CharacterSheetEdited` (derive, FR-CMP-27) | as entities / CHARX | as entities / CHARX |

*(S4)* No new event, intent or record type. A server listener on the five events in FR-CMP-34 drops the search index (no state change, no frame). The adapter's `type` reaches DM connections inside the existing `imported-entity` upserts of the Update (FR-CMP-39).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Search / read imported spells, items, conditions, features | ✓ | ✓ | FR-CMP-13/14 |
| Read imported monsters, monster definitions | ✓ | ✗ (404 / empty) | FR-CMP-14, ADR-0024 |
| Read homebrew | ✓ own campaign | own campaign, `shared` only | FR-CMP-14 |
| Import, homebrew CRUD, clone, derive | ✓ | ✗ (401) | DM secret |
| Edit / delete imported | ✗ (`forbidden`) | ✗ | FR-CMP-24/25 |
| Add to sheet | any campaign character | own, unless locked | `cmp.addToSheet`: entry visibility + `char.putRow`'s rule (FR-CMP-28) |
| Import while an encounter is started | ✗ (`conflict`) | ✗ | FR-CMP-07 |
| *(S4)* Search groups, `sameAs` | ✓ (own + imported) | visible members only; hidden → not counted, empty page | FR-CMP-14 before FR-CMP-35 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** REST is independent of the WS; open views stay. Campaign deactivated → next request `409`, window shows the shell's waiting state.
- **DM disconnect / reconnect:** REST unaffected. New snapshot → `useDefinitions` reloads its ids (FR-CMP-16); stale imported rows never linger.
- **Server crash mid-import:** one transaction → nothing written; restart, click Import again. Crash after commit → complete; re-import is a no-op (FR-CMP-31). Test seam `PP_TEST_CRASH=cmp.import:before-commit` / `:after-commit`. Add to sheet: one transaction, so after a crash the sheet row and its trigger both exist or neither (`cmp.addToSheet:before-commit`).
- **Import during combat:** refused while an encounter is started (FR-CMP-07); the one-transaction write would pause every command, including combat, for up to ~2 s.
- **Concurrent edits:** two imports (two DM tabs) serialise; the second is all `existing`. Homebrew: last whole replace wins. Delete while a player views it → their next fetch is 404 ("No longer available").
- **Campaign switch:** homebrew of the old campaign leaves DM results; imported entries stay.
- **Duplicate names:** fixture goblin (source `fixture`) and SRD goblin (`srd-5.1`) both exist after an import; source Badges tell them apart (OQ-CMP-22). *(S4)* The SRD one ranks first everywhere (FR-CMP-38). Same name and source (12 × Ability Score Improvement) → one group row (FR-CMP-35); different sources never group.
- *(S4)* **Search index after a crash or restart:** in memory only, so it is empty after start and rebuilt at the first search (≈ 12 ms measured); nothing to recover. A search racing an import sees either the old rows or the new ones, never a mix: the index is dropped after the commit, by the event listener.
- *(S4)* **Player and the index:** the index holds every campaign's homebrew; FR-CMP-14 filters every row per request before groups and counts, so a player never sees a hidden entry, its name in a group line, or a count that includes it.
- *(S4)* **Disconnect / reconnect:** unchanged (REST); an expanded group refetches its members on the next open.
- **Invalid / malicious input:** strict zod; `q` ≤ 100; cursor opaque and validated; text rendered as text nodes only (FR-CMP-26); recorded sources are repo files, never client input (`cmp.import` takes a source key, not data).
- **Leaks:** a player never receives a monster entry, a monster definition, unshared homebrew or another campaign's homebrew, in REST bodies, errors or WS frames.

## 12. Performance & bandwidth

Measured with real SRD 5.1 data (Open5e v1 `wotc-srd`) on the realistic-heavy harness (probe deleted):

| Figure | Value |
|---|---|
| SRD 5.1 content | 322 monsters, 319 spells, 237 magic items, 37 weapons, 18 armor, 15 conditions, ~~179~~ **202** class features (12 classes + 1 SRD subclass each; one per class `###` / subclass `#####` heading, subclass intro as its own entry, Warlock's Eldritch Invocations merged; measured in `fix/cmp-data`, #213) = ~~1,127~~ **1,150 entries**; raw 1.73 MB (avg monster 2.4 KB, spell 1.7 KB, item 1.1 KB; max 14 KB) |
| Recorded responses (bundled) | 2.2 MB JSON |
| Heavy DM snapshot today | 676,030 B (110,402 B under 786,432 B), re-checked in the seams pass at `0f557fc`; `imported-entity` = 2 rows, 2,002 B. Sprint 3 combined with every gate pick 712,310 B (gate 1, G3); DM ceiling now 1 MiB (1,048,576 B), players 512 KiB, headroom guard dropped (#208) |
| **All imported monsters in the snapshot** (today's provider) | +341,079 B → 1,017,123 B on today's base; ≈ 1,053,389 B on the sprint-3 figure (712,310 B): over even the 1 MiB ceiling |
| Per imported definition row | avg 1,058 B, p95 1,237 B, max 1,329 B; 691 B without per-row attribution |
| Referenced-only alternative (OQ-CMP-04 B) | 20 monsters ≈ 21 KB, 40 ≈ 42 KB (≈ 14 / 28 KB without attribution) |
| **With picks** (lazy `imported-entity`, REST entries) | DM **−2,002 B** (the two fixture imports leave the snapshot; re-checked); players 277,022–280,082 B unchanged |
| Import through the real pipeline | 322 monsters 105 ms; same again (all `existing`) 13 ms |
| Raw insert of all 1,127 entries (+ FTS index) | 40 ms; full import estimated ≤ 0.5 s incl. parsing |
| DB size | 3.57 MB measured with raw bodies + an FTS5 index (upper bound); normalised, no FTS: ≈ 2 MB (estimate) |
| Search | name `LIKE` over 1,127 rows 1.1 ms; FTS5 prefix 0.04 ms (bun:sqlite ships FTS5) |
| Live import frames | ≈ 341 KB of `imported-entity` upserts to DM connections, once per full import |

**Sprint 4 (S4)**: throwaway probe, `session-sim` + realistic-heavy harness + full bundled `srd-5.1` import (1,150 entries, 324 imported definitions incl. fixture Goblin / Wolf), `bun test` on Windows, 30 runs each (deleted before commit).

| Figure | Value |
|---|---|
| Today's search, DM | median 47–54 ms, p95 ≤ 64 ms for every query tried (`""`, `a`, `gob`, `goblin`, `fire`, `potion heal`, `the`) |
| Today's search, player | median 1.0–3.1 ms, p95 ≤ 3.7 ms |
| Cause of the DM's 48 ms | the entry-less definitions query (FR-CMP-17): `LEFT JOIN compendium_entry` on `definition_id`, which has no index: 47.8 ms alone; the same as `NOT EXISTS`: 4.0 ms |
| Index build (read every name + `searchText`, fold both) | median 11.9 ms, p95 12.8 ms; `searchText` totals 970,850 chars |
| AND match over the prebuilt index | `a` 0.06 ms (1,141 hits), `the` 0.12 ms (1,030), `potion heal` 0.34 ms (3); p95 ≤ 0.46 ms |
| Folding the text on every query instead (no index) | 6–13 ms: why FR-CMP-34 keeps a folded index |
| Today's results | `potion heal` → **0** results; `hunters mark` → 0; `goblin` → fixture Goblin, then SRD Goblin; `""` (All) → first 12 rows are all "Ability Score Improvement" |
| Prototype results (FR-CMP-33 tiers) | `potion heal` and `heal potion` → Potion of Healing first (tier 2), then Potion of Poison (4), Robe of Useful Items (5); `hunters mark` → Hunter's Mark (0); `goblin` → Goblin (0), Hobgoblin (3), then text-only Worg, Bugbear…; `fire` (136 hits) → Fireball, Fire Bolt, Fire Giant… (tier 1, shorter first); `cure` → Cure Wounds, Mass Cure Wounds, then text |
| Duplicate names (same kind, name, source) | Ability Score Improvement 12, Spellcasting 7, Extra Attack 5, Fighting Style 3, six more × 2 (all features) |
| Names with accents / apostrophes | 0 / 14 (e.g. Hunter's Mark) |
| Monster types | 14 SRD types on 322 / 322 monsters: beast 97, dragon 43, humanoid 40, monstrosity 39, fiend 23, undead 18, elemental 16, giant 10, construct 9, aberration 5, celestial 6, fey 6, plant 6, ooze 4 |
| Snapshot | Search: **0 B** (REST). Token art adds one token field: see [entities §12](entities.md#12-performance--bandwidth) |
| Update after a mapping change *(review pass, B38)* | Full import 403 ms; the same source with every monster's creature core changed (317 `updated`, 5 unchanged, definition-changed hooks run; heavy harness, no tokens of SRD monsters) 403 ms; unchanged re-import 161 ms. Within FR-CMP-31 (2 s / 0.5 s). The fill adds one token update per affected token (≤ 200 per scene) inside the same transaction |
| Exact ranking rows | §13 ranking table (prototype of FR-CMP-32 / -33 / -38 with `cmp-search-homebrew`'s two items) |

- REST: search page ≤ 50 × ~130 B ≈ 7 KB; an entry ≤ 32 KB; `ETag` makes repeat opens cheap over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)): `private, no-cache` revalidates every open, `304` carries no body.
- `sync.load` of imported definitions: ≤ 50 rows × ≤ 1.3 KB ≈ 66 KB worst case.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). **No network in any test:** recorded Open5e responses only.

**Fixtures** (owner compendium; [fixtures-adapters §8](fixtures-adapters.md#8-data-model) adds the rows)

| Key | Kind | Requires | Contents |
|---|---|---|---|
| `cmp-srd-mini` | setup | — | `cmp.importRecorded` with recorded responses as TS modules `fixtures/srd/open5e/<endpoint>.ts` exporting the (filtered, `wotc-srd` only) data, per AGENTS §9.3 (source `srd-5.1`, version `mini`): monsters Goblin, Hobgoblin, Wolf, Ogre, Adult Red Dragon (legendary); spells Fireball, Cure Wounds, Hunter's Mark, Bless; items Potion of Healing, Bag of Holding, Longsword, Chain Mail; conditions Poisoned, Prone, Grappled; classes Rogue (Sneak Attack), Barbarian (Rage, Path of the Berserker) |
| `cmp-homebrew` | setup | `cmp-srd-mini` | Fixture Campaign homebrew: item "Moonblade Shard" (shared); item "CMP-SECRET-ITEM" (DM only); spell "Fireball (house)" cloned from Fireball (DM only); feature "Divine Fury", Barbarian, level 3, own words, trigger inline as `preset: TriggerRule` (first hit on each own turn while raging: 1d6 + ⌊level(Barbarian) / 2⌋ radiant; no built-in, #209) (shared) |
| `cmp-homebrew-second` | setup | `campaign-second` | Activate Second Campaign; item "CMP-SECOND-HOMEBREW" (shared); re-activate Fixture Campaign |
| `cmp-srd-full` *(S4)* | setup | `cmp-srd-mini` | `cmp.importRecorded` of the **bundled** `srd-5.1` source at its bundled version (≈ 1.2 s): the mini entries are `existing`, the rest created; 1,150 entries |
| `cmp-search-homebrew` *(S4)* | setup | `cmp-srd-mini` | Fixture Campaign homebrew: item "Potion of Healing" (**DM only**, same name as the SRD item, own words "CMP-HB-POTION"), item "Healing Draught" (shared, text "a potion that heals 2d4 + 2") |

**Bundle `compendium-full`** *(S4)* = `compendium` + `cmp-srd-full` + `cmp-search-homebrew` (+ entities' `ent-art-tokens`, [entities §13](entities.md#13-test-plan)). The `compendium` bundle stays the fast mini set.

**Bundle `compendium`** = `base` + `player-2` + `campaign-second` + `char-mira` + `char-thorn` + `enemy-1` + `enemy-2` + `enemy-custom` + `images` + `battlemap` + `encounter-1` + `cmp-srd-mini` + `cmp-homebrew` + `cmp-homebrew-second`.

- **Composes** (seams S10): `cmp-*` units write only compendium rows and their imported definitions; they never touch `char-mira` / `char-thorn` (Add to sheet is a walkthrough action, not a fixture). They load unchanged inside the orchestrator's `session-sim-7`. Sprint-2 bundles (`fog`, `fog-scn`, `scene-tools`, `effect-modifiers`) pass unchanged.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-CMP-06 bundled licence`: every record in `sources/srd-5.1/` and `fixtures/srd/open5e/`, nested `archetypes` included, has `document__slug = wotc-srd`; the attribution file contains the exact SRD 5.1 CC BY 4.0 statement (= `SRD_ATTRIBUTION`) and the Open5e url. `FR-CMP-04 version`: changing `ADAPTER_VERSION` alone changes `version`. `FR-CMP-05 adapter`: recorded files → batch; every monster of the **bundled** source maps to the creature core (322 / 322, no network); non-SRD archetypes dropped (defence in depth); features split, `level` parsed (Sneak Attack 1, Rage 1); `senses.darkvisionFt` (Goblin 60, Ogre 60, Wolf absent; see-through false); warnings counted. `FR-CMP-29 preset resolution`: `presetKey` > `preset` > built-in trigger by `featureKey`; `rage` (effect preset) → none; `srd-5.1:spell/hunters-mark` → `hunters-mark`. Kind schemas and limits (FR-CMP-01). `FR-CMP-10 ranking` (prefix > word > substring > text; ties; cursor). `FR-CMP-14 entryVisibleTo` matrix: DM / player × 5 kinds × imported / own shared / own hidden / other campaign. `FR-CMP-26` renderer: no HTML ever (`<script>` stays text); Scimitar Hit text → one `DiceText` match "1d6 + 2" with context `{creature, label: "Scimitar", category: damage}`, "+4 to hit" plain. `FR-CMP-16 boundary`: no `imported-entity` store read outside `useDefinitions` | In-code, `fixtures/srd/open5e/` |
| Integration | `FR-CMP-07 import idempotency`: mini twice → second all `existing`, no event, no log; edited recorded goblin → `updated`, `ImportedEntityUpdated` with a token's size copy in `changes`; Elite Goblin Warrior (derived) unchanged (FR-CMP-09). Bad record → nothing written, all issues. Encounter started → `conflict` "End combat first", nothing written. Crash `cmp.import:before-commit` → zero rows; `:after-commit` → complete; rerun no-op. `FR-CMP-08` goblin tokens in both campaigns (the second placed by the test) → one log row per campaign, frames only to the active campaign; Second Campaign's snapshot on activation shows the new size | `compendium` |
| Integration | `FR-CMP-10/12/13/14 search`: DM "goblin" → Goblin first; player "goblin" → no monsters, `kind=monster` empty, GET Goblin entry 404, GET "CMP-SECRET-ITEM" 404 (also with a matching `If-None-Match`: 404, never 304), "CMP-SECOND-HOMEBREW" never; `Cache-Control: private, no-cache` on 200 / 304 / 404; inactive campaign → 409; no credential → 401 | `compendium` |
| Integration | `FR-CMP-24/25/27 homebrew`: put / replace / delete, `forbidden` on imported, name `conflict`; clone independent; derive-monster: entity + sheet features (Nimble Escape) in one tx, rollback on a bad body. `FR-CMP-28 addToSheet`: Sneak Attack → Thorn row + `sneak-attack` trigger in one tx; DM adds homebrew "Divine Fury" → Mira row + a "Divine Fury" trigger with the inline rule (#209); MOD validation failure → neither; player on another's character or locked sheet → `forbidden`; player on unshared homebrew → `not_found`; crash `cmp.addToSheet:before-commit` → neither | `compendium` |
| Integration | `FR-CMP-15/30 lazy + CON-44`: DM snapshot holds no `imported-entity`; `sync.load` returns ids; player load hidden; heavy harness + full bundled import → DM snapshot ≤ the pre-import figure (per-type bound) and ≤ the 1 MiB DM ceiling (#208). `FR-CMP-18` window in the registry-driven layout tests. `FR-CMP-31` timing (logged; fail > 10 s). **Leak scan** over player REST bodies and WS frames: never "CMP-SECRET-ITEM", "CMP-SECOND-HOMEBREW", "Nimble Escape", "Fireball (house)" | `compendium`, heavy |
| E2E (thin) | DM opens Compendium, searches "goblin", opens Goblin; `player-1` searches "fire", opens Fireball, has no Monsters tab | `compendium` |
| Unit *(S4)* | `FR-CMP-32 fold`: "Hunter's Mark" ← `hunters mark`, `HUNTER'S`, `hunter’s`; "Mordenkainén" ← `mordenkainen`; `potion   heal` = 2 words; `"potion" -heal` folds to `potion heal`; 9 words → 8; `potions` also matches `potion`, `gas` stays `gas` (< 4). `FR-CMP-33 tiers`: one case per tier 0–5 on hand-made names; `a` never reaches the text tier; ties by source rank, then length, then name, id; cursor round-trip and tamper → `invalid`. `FR-CMP-37 matcher parity`: client `nameTier` = server tier for 40 SRD names × 10 queries. `FR-CMP-38 sourceRank` (homebrew 0, `srd-5.1` 1, `open5e-x` 2, `fixture` 3). `FR-CMP-39 adapter type`: 322 / 322 bundled monsters get a type; `swarm` (made up) → dropped + 1 warning | In-code, bundled source |
| Integration *(S4)* | **`FR-CMP-33 "potion heal" → Potion of Healing first`** (DM: the homebrew one, then the SRD one; player: the SRD one first). **`FR-CMP-33 word order`**: `heal potion` returns the same list as `potion heal`. **`FR-CMP-33 ranking table`** (below). **`FR-CMP-38 SRD Goblin above fixture Goblin`** in search, in the lookup merge (FR-CMP-37) and in the Creatures order (FR-ENT-18). **`FR-CMP-35/36 All tab default`**: empty `q`, no kind → one "Ability Score Improvement" summary with `group.count` 12 among the first 50, no second ASI row; `sameAs` → 12 members by line; `sameAs` + `kind` → `invalid`. **`FR-CMP-35 group count = expanded rows`**: `q=fighter`-style query matching only some ASI members → `group.count` equals the rows `sameAs` + that `q` returns; a name with one matching member → a plain row, no `group`. **`FR-CMP-35 paging across a group`**: page size forced to 3 in the test; pages joined = the full collapsed order, no repeat, no skip, the group row once. **`FR-CMP-14 player search never returns hidden entries`**: for `potion heal`, `potion`, `CMP-HB`, `""` and every tab, player pages, groups, counts and `sameAs` (on the hidden homebrew id → empty page) never contain "CMP-HB-POTION", "CMP-SECRET-ITEM", a monster or an entry-less definition; GET of the hidden id → 404, also with `If-None-Match` (never 304). **`FR-CMP-34 index freshness`**: put → next search finds it; delete → gone; `cmp.importRecorded` with an edited goblin → new name found; timing over the full import logged, fail > 50 ms | `compendium-full` |
| E2E (thin) *(S4)* | DM searches "potion heal" → first row Potion of Healing; All tab shows one ASI group row, expands to 12 | `compendium-full` |

**Ranking table** (`FR-CMP-33 ranking table`, full import + `cmp-search-homebrew`, DM unless marked). Exact first rows (tier in brackets) from the review-pass prototype of FR-CMP-32 / -33 / -38 on the bundled data (throwaway probe, deleted); the test asserts these rows in this order.

| q | Expected first rows, in order | Hits |
|---|---|---|
| `goblin` | Goblin SRD [0], Goblin Fixture [0], Hobgoblin [3], Worg [5], Bugbear [5], Deck of Illusions [5] | 7 |
| `potion heal`, `heal potion` | Potion of Healing Homebrew [2], Potion of Healing SRD [2], Healing Draught [4], Potion of Poison [4], Robe of Useful Items [5] | 5 |
| `potion heal` (player) | Potion of Healing SRD [2], Healing Draught [4], Potion of Poison [4], Robe of Useful Items [5] | 4 |
| `hunters mark`, `HUNTER'S MARK` | Hunter's Mark [0] | 1 |
| `fire` | Fireball [1], Fire Bolt [1], Fire Giant [1], Fire Storm [1], Fire Shield [1], Fire Elemental [1] | 136 |
| `cure wound` | Cure Wounds [1], Mass Cure Wounds [2], Couatl [5], Priest [5], Acolyte [5], Raise Dead [5] | 18 |
| `potions` | Potion of Healing Homebrew [2], Potion of Speed [2], Potion of Flying [2], Potion of Growth [2], Potion of Poison [2], Potion of Healing SRD [2] | 24 |
| `a` | Aid [1], Ape [1], Azer [1], Alarm [1], Ankheg [1], Augury [1]; no text-only row | 816 |
| `zzqx` | none: "No matches for ‘zzqx’. Every word must match." | 0 |

(Group rows don't change these: none of these names has two entries in one source.)

**Browser walkthrough (S4)**: `bun run build`, `fixtures:reset-load compendium-full --profile verify`, `start --profile verify`. Contexts: A DM, B `player-1`. Player REST + WS logs as above. Token art steps: [entities §13](entities.md#13-test-plan). Teardown as above.

| # | DM (A) | Player (B) | Expected |
|---|---|---|---|
| S1 | Open Compendium, All tab, empty search | — | One "Ability Score Improvement · 12 entries · Barbarian, Bard, …" row near the top, not 12; expand → 12 rows with class lines; open "Fighter · 4th level"; Back keeps the group open |
| S2 | Search "potion heal", then "heal potion" | — | Both: Potion of Healing (Homebrew, DM only) first, Potion of Healing (SRD) second, Healing Draught next |
| S3 | Search "goblin"; Creatures window search "goblin"; Encounters lookup "gob" | — | SRD Goblin above Fixture Goblin in all three; Hobgoblin after both in the Compendium |
| S4 | Search "hunters mark", "cure wound", "potions" | — | Hunter's Mark first; Cure Wounds first; potions listed |
| S5 | — | B: search "potion heal"; Features tab, empty search | Potion of Healing (SRD) first, Healing Draught; no homebrew Potion of Healing; one ASI group. B's logs: no "CMP-HB-POTION", "CMP-SECRET-ITEM", monster or the hidden id |
| S6 | Clone Cure Wounds → "Cure Wounds (house)" Shared; search "cure wound" | B: search "cure wound" | Both see it at once, first (tier 1 like Cure Wounds; homebrew ranks first, FR-CMP-38); Delete it → gone on the next search |
| S7 | Kill + restart the server; search "potion heal" | B: same | Same order as S2 / S5; no console errors |

**Existing tests S4 updates** (review B36; assertions change, names keep their FR IDs):
- `src/server/features/compendium/search.test.ts` "FR-CMP-10 ranking: name prefix > word start > substring > text…" → rewritten for FR-CMP-33 tiers (renamed `FR-CMP-10 FR-CMP-33 …`); "FR-CMP-10 cursor…" → the new tuple, groups never split.
- `src/server/features/compendium/rest.test.ts` "FR-CMP-10 FR-CMP-14 search: DM 'goblin' → Goblin then Hobgoblin…" → SRD Goblin, fixture Goblin, Hobgoblin; "FR-CMP-17 entryless imported definitions…" → the fixture rows rank after equal-named SRD rows (FR-CMP-38).
- `src/client/common/features/compendium/lookup.test.ts` "FR-CMP-17 lookup merge…" → merge per FR-CMP-37 (tier, store first, then server order).
- `src/client/common/features/combat-tracker/lookup.test.ts` "FR-CBT-63 prefix before word start before substring…" → FR-CMP-37 tiers, multi-word (with the integrator's FR-CBT-63 text, rulings B8).
- `src/client/dm/features/entities/list.test.ts` and `src/shared/entities/schemas.test.ts` "FR-ENT-18 … custom before imported, then id" → then source rank (`srd-5.1` before `fixture`), then id.
- `e2e/compendium.e2e.ts` "FR-CMP-10 FR-CMP-13 FR-CMP-15 FR-CMP-17 …": any asserted order follows FR-CMP-33 / -38.
- `src/server/features/compendium/adapter/open5e.test.ts` (C-art core): mapped creature cores now carry `type`.

**Existing tests C2 updates** (the fixture goblin and wolf leave the DM snapshot; sprint-2 bundles still pass, their DM reads go through `sync.load`):
- `src/server/features/entities/records.test.ts` "FR-ENT-16 imported-entity: DM full in every campaign…" → DM snapshot has none; `sync.load` by ids returns both in every campaign; players still never.
- `src/server/features/entities/sync.test.ts` "FR-ENT-15/16 snapshots…" (DM Goblin + Wolf via load) and "ENT §13 leak scan + restart" (adds the load ack to the scanned frames).
- `src/server/ws/snapshot-size.test.ts` and `src/server/features/fog-of-war/con44.test.ts`: heavy DM baselines −2,002 B.
- `src/server/ws/hub.test.ts` "FR-SYNC-20 convergence + leak scan": convergence compares lazy types per `fix/lazy-records`' helper (loaded ids only).
- `fixtures/units/entities/entities.fixtures.test.ts` (manifest ids unchanged; any store read via load); `e2e/entities.e2e.ts`, `e2e/combat-tracker.e2e.ts`, `e2e/combat-tracker-charx.e2e.ts`: only if they read `imported-entity` from the DM store.

**Browser walkthrough** — `bun run build`, `fixtures:reset-load compendium --profile verify`, `start --profile verify`. Contexts: A DM, B `player-1`, C `player-2`. Player evidence: REST + WS logs from `page.on('response')` / `page.on('websocket')`. Teardown: stop, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, open Compendium | — | "SRD 5.1 · 55 (#225) entries" (the mini set), **Update** shown (bundled version ≠ `mini`) |
| 2 | Update → confirm | — | Confirm "Players will pause for ~2 s"; Toast with counts (≈ 1,076 created, the mini ones `existing`) ≤ 2 s; status "≈ 1,127 entries" (exact figures: the adapter's test) |
| 3 | Search "goblin"; open Goblin; click "1d6 + 2" in the Scimitar's Hit text | — | Goblin first, Hobgoblin next; stat block AC 15, HP 7 (2d6), darkvision 60 ft, Nimble Escape, Scimitar, Shortbow; "+4 to hit" is plain text; attribution footer + About; the click stages a Goblin damage roll labelled "Scimitar" (DiceText; skip if D1 isn't on `main`) |
| 4 | Derive… "Goblin Sneak", HP 12, copy text on | — | Creatures window: Goblin Sneak (Custom, derived from Goblin); its NPC sheet Features: Nimble Escape |
| 5 | Encounters → "Ambush at the Ford": lookup "og" → Ogre (SRD) ×1, "gob" → Goblin Sneak ×2; save | — | Entries listed with CR / XP; Ogre resolves after reload (lazy load) |
| 6 | Battlemap: drag Hobgoblin from results onto the map; token menu → Stat block | — | Token placed; Compendium opens on Hobgoblin |
| 7 | — | B: open Compendium; search "fire"; open Fireball; search "moon", "CMP-SECRET" | No Monsters tab; Fireball (Level 3 evocation) but not "Fireball (house)"; Moonblade Shard found; no secret result. B's logs: none of the leak strings, no monster entry |
| 8 | — | C: Features tab → Rogue "Sneak Attack" ("Preset: Sneak Attack" shown) → Add to sheet (Thorn) | Thorn's Features: Sneak Attack, source "SRD 5.1"; Thorn's Triggers block: Sneak Attack (R's built-in) |
| 9 | Clone Potion of Healing → "Potion of Greater Healing (house)", Shared on | B: search "greater" | B finds it after the search |
| 10 | Reload all; kill + restart server | All rejoin | Compendium intact; encounter shows Ogre + Goblin Sneak; Stat block works; no console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0010, 0015, 0018, 0024 | Definitions, re-import safety, pipeline, global imports, definitions DM-only | accepted / [ADR-0046](../architecture/adr/0046-compendium-scope.md) accepted (#207) |
| [party-board](party-board.md) / [ADR-0045](../architecture/adr/0045-lazy-record-types.md) | `lazy` global type + `sync.load {type, ids}` (branch `fix/lazy-records`, after V0) before C2 | accepted (#207); seams S1 |
| fog-of-war / vision (V0) | Creature core `senses` with `darkvisionFt` (FR-CMP-05) | seams S6 |
| dice-extras (D1) | `DiceText` for entry text (FR-CMP-26); plain text until D1 is on `main` | seams S7 |
| [fixtures-adapters](fixtures-adapters.md) | Pipeline: per-kind stores, `updated` outcome, `cmp.import` as a routed caller of a **bundled** source (amends FR-FIX-20, -24) | OQ-CMP-17 |
| [entities](entities.md) | `imported-entity` lazy; in-place update of imported rows with hooks; `createIn` for derive; Creatures window search | OQ-CMP-18 |
| [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md), [character-sheet-full](character-sheet-full.md) | Call sites move to `useDefinitions`: `CharacterSheet.tsx`, `concentration.tsx`, `add-dialog.tsx`, `combat-tracker/data.ts`, `encounters-window.tsx`, `creatures-window.tsx`; lookup (FR-CBT-63) searches the server; CHARX internal row insert for FR-CMP-27 / -28 (`char.putRow`'s authorisation rule) | OQ-CMP-18 |
| [campaign-management](campaign-management.md) | `resolvePlayerLink` usable for REST (`Authorization: Player`) | OQ-CMP-20 |
| [effect-modifiers](effect-modifiers.md), [ADR-0043](../architecture/adr/0043-rule-triggers.md) | Built-in trigger presets list `featureKey`s (five built-ins, no Divine Fury, #209); `presetKey` / `TriggerRule` zod; exported server helper `addTriggerFromPreset(env, characterId, {presetKey} \| {name, rule})` (signature R's, FR-MOD-46; R4 / R5 before C4) | seams S5 |
| [scenes-map](scenes-map.md), [play-shell](play-shell.md) | Token menu registry; window registries | built |
| Packages | **None.** Data is bundled JSON (CC BY 4.0 SRD 5.1); no markdown or search library | — |
| *(S4)* [combat-tracker](combat-tracker.md) | FR-CBT-63 lookup matches with FR-CMP-37's shared matcher (multi-word, tiers 0–3) and merges per FR-CMP-37; `src/client/common/features/combat-tracker/lookup.ts` | settled by seams S14 (OQ-CMP-31) |
| *(S4)* fog-of-war / character-sheet-full (V6) | V6's one-line Open5e adapter change (`visionFt: 0`, V's OQ-CHARX-30) lands before C-art core touches the adapter | seams S5, S14 |
| *(S4)* [entities](entities.md) | FR-ENT-18 order gains source rank; the Creatures window filter uses the matcher; creature core `type` (FR-ENT-26) | same author (this track) |
| *(S4)* Search package | **None**: hand-rolled index + tiers (≈ 150 lines, measured ≤ 0.5 ms). Typo-tolerant search (MiniSearch / Fuse.js) was rejected at the gate (OQ-CMP-27, #245) | decided (#245) |

**Build split, sprint 4** (hotspots per [sprint-4](../agents/sprint-4.md#boundaries-and-hotspots-sequence-these)). Search needs **no schema, ws, protocol or canvas lock**, so C-search can start at the beginning of Phase B, in parallel with V core. *(Seams S14: C-search is lock-free, waves 1–2 / any free slot; then C-all.)* Token art (schema + canvas) is entities' part: [entities §14](entities.md#14-dependencies).

| Slice | Branch | Delivers | Shared files (AGENTS §9.9) |
|---|---|---|---|
| C-search | `build/cmp-search` | `@shared/compendium/match.ts`, in-memory index + listener, tiers, source rank, groups + `sameAs` (server), Creatures window filter + order (FR-ENT-18), lookup merge; fixtures `cmp-srd-full`, `cmp-search-homebrew`, bundle `compendium-full`; FR-CMP-32–35, 37, 38; tests §13 | Listener registry (append); `fixtures/bundles/index.ts` (append); `src/client/common/features/combat-tracker/lookup.ts` (granted to C-search by seams S14; R's slices don't touch it); `@shared/entities/schemas.ts` (`definitionOrder` only; seams S14: a different function from V6's senses and R0's `Attack` fields, so in parallel; whichever merges later rebases and keeps both); protocol §search (summary `group`, `sameAs`). FIX §8 rows (integrator) |
| C-all | `build/cmp-all-tab` | Window: group rows, expand / collapse, default list, empty copy, test IDs (FR-CMP-35 client, -36); thin e2e | After C-search. Compendium client folder only (feature-owned); none shared |

- Order inside C: C-search → C-all. FR-CMP-39 (adapter `type`, `ADAPTER_VERSION` bump) ships in the token-art core ([entities §14](entities.md#14-dependencies)), not here, so the Update that fills `type` always meets the art fill hook (FR-ENT-27). Seams S5 / S14: V6 first makes its one-line Open5e adapter change (`visionFt: 0`, V's OQ-CHARX-30); C-art core rebases on it, then adds `type` and bumps `ADAPTER_VERSION` again. V6 bumps it for its own line (rulings B40, per FR-CMP-04); two bumps = two Update prompts for a DM who updates in between, harmless.

**Build split** (hotspots per [sprint-3](../agents/sprint-3.md#boundaries-and-hotspots-sequence-these) and seams S3; schema cores V0 → R0 → P core → **C1** → D style; C touches no `src/server/ws/`, protocol or common store file)

| Slice | Branch | Delivers | Shared files (AGENTS §9.9) |
|---|---|---|---|
| C1 core | `fix/cmp-core` | After P core (schema order) and V0 (`senses`). Tables, `@shared/compendium`, adapter, bundled `srd-5.1`, `cmp.import` / `cmp.importRecorded` (**no route yet**), events, fixtures + bundle, FR-CMP-01–09, 31 | `src/server/db/` (2 tables); `src/shared/events/`; pipeline `fixtures-adapters/import-pipeline.ts` (per-kind store, `updated`); entities `import-store.ts` (update in place + hooks); `src/server/features/index.ts`, `fixtures/bundles/index.ts` (append); data-model, protocol |
| C2 read | `build/compendium-read` | REST search / get + route-local `Authorization: Player` middleware, lazy `imported-entity`, `useDefinitions` + its boundary test, server lookups, updated tests (§13), FR-CMP-10–17, 30 | After `fix/lazy-records` and R7 (combat call sites, seams S3). `src/server/app.ts` (append mount); entities `records.ts`: switching the **existing** `imported-entity` line to lazy edits an append-only registry, so it is a §9.9 shared change (orchestrator assigns); the six call sites above. `CharacterSheet.tsx` under the sheet lock: **V5 → R3 → R6 → C2 → D4 → P4 / C4** (X2) |
| C3 window | `build/compendium-window` | Window, views (`DiceText` if D1 is on `main`), import route + confirm + panel, Stat block, FR-CMP-18–23, 26 | `src/client/{dm,player}/windows.ts`, token menu registry (append) |
| C4 homebrew | `build/compendium-homebrew` | After R4 / R5 (seams S5). Homebrew, clone, derive-monster, `cmp.addToSheet` (+ trigger), feature key, FR-CMP-24, 25, 27–29 | CHARX internal row insert (sheet lock, last: P4 / C4 in arrival order) |

- C1 has no route on purpose: the import UI must not ship before C2 makes `imported-entity` lazy (else one click puts 341 KB in the DM snapshot).

## 15. Open questions

**Decided (#…)** = settled by the DM at sprint-3 gate 1 (rejected options kept for the record). "Settled" = seams / review ruling. Rows with an owner: non-blocking, the owner's **bold** pick stands unless the owner revisits it in build.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CMP-01 | Source | **Decided (#207, G30): bundled SRD 5.1**: recorded Open5e v1 `wotc-srd` responses (2.2 MB) in the repo, imported offline, CC BY 4.0 attribution. Rejected: Open5e download at runtime (needs internet, API churn), both now | — | — |
| OQ-CMP-02 | Content this sprint | **Decided (#207, G31):** monsters, spells, items (magic + weapons + armor), conditions, class features (12 classes + their 1 SRD subclass) = 1,127 entries. Rejected: monsters + spells only; + races, backgrounds, feats | — | effect-modifiers |
| OQ-CMP-03 | ADR-0010 scope | **Decided (#207, G4 / bulk): A, global library + campaign clones** → [ADR-0046](../architecture/adr/0046-compendium-scope.md). Rejected: B per-campaign import, C overlay patches | — | ADR-0004, ADR-0010 |
| OQ-CMP-04 | Imported creature definitions vs CON-44 | **Decided (#207, bulk): A, lazy `imported-entity`** ([ADR-0045](../architecture/adr/0045-lazy-record-types.md)), loaded by ids: 0 B. Rejected: B referenced-only in the snapshot (≈ 1.06 KB each), C all imported (+341 KB) | — | entities, live-sync, combat-tracker, combat-extras, character-sheet-full |
| OQ-CMP-05 | Read path for entries | Settled by seams S1: **REST search / get** (global, 1,127 rows, needs search; the lazy path is for `imported-entity` only) | no (settled) | live-sync |
| OQ-CMP-06 | Use entries directly? | **Decided (#207, bulk): yes; clone / derive only to edit.** Rejected: must clone first | — | combat-tracker |
| OQ-CMP-07 | Who browses | **Decided (#207, G32): players read spells, items, conditions, features + shared homebrew; monsters DM-only** (ADR-0024). Rejected: DM only, everything | — | campaign-management |
| OQ-CMP-08 | Homebrew editor scope | **Decided (#207, G33):** monsters: existing creature form + NPC sheet, "Derive" copies traits / actions text into sheet Features; other kinds: one text form (name, facets, markdown-lite text, Shared). Rejected: monsters only, structured editors per kind | — | combat-tracker, character-sheet-full |
| OQ-CMP-09 | Search | ~~SQL name ranking + `LIKE` on text (1.1 ms measured)~~ *(S4, revised: built as `instr` + JS ranking; DM 48 ms measured over the full import, see §12)* → **in-memory folded index on the server, rebuilt after writes (FR-CMP-34; ≤ 0.5 ms match, 12 ms build)** / FTS5 with `unicode61 remove_diacritics` (word prefix built in; virtual table outside drizzle-kit push, needs a backfill) / stored folded column (schema + backfill of existing rows). *(Gate 1 bulk-accept, #245: the in-memory index.)* | no (owner: C-search `build/cmp-search`) | — |
| OQ-CMP-10 | Stat block on token click (tier B) | **Decided (#207, bulk): in, DM token menu "Stat block"** (registry entry, opens the window). Rejected: out | — | scenes-map |
| OQ-CMP-11 | Import run, crash | **DM button; one transaction (≤ 0.5 s est.); atomic; no resume; result Toast**; refused while an encounter is running, "players pause ~2 s" confirm (decided, #207 bulk) / chunked with progress events + resume (unneeded at this size) / automatic at first start (no click; surprises a real DB) | no (owner: spec-compendium) | — |
| OQ-CMP-12 | Changed upstream entry on re-import (OQ-FIX-18) | **Update in place; customs, clones, sheets untouched; instances follow via hooks** / version and pin / skip changes | no (owner: spec-compendium) | fixtures-adapters, entities |
| OQ-CMP-13 | Text format | **Markdown-lite string + own text-node renderer** / a markdown package (dependency, DM OK) / plain text (loses tables) | no (owner: spec-compendium) | — |
| OQ-CMP-14 | **effect-modifiers**: how class features feed rule-trigger presets | Settled by seams S5: **`featureKey = <source>:<sourceKey>`; MOD's built-ins list the keys they implement (Sneak Attack, Rage, Hunter's Mark, Colossus Slayer); an entry may carry `presetKey` or `preset` (`TriggerRule`, opaque); Add to sheet also adds the trigger; C4 after R4 / R5.** Amended by #209: Divine Fury is **not** a built-in (MOD ships five); our homebrew fixture carries it inline as `preset: TriggerRule`; the 5etools import (compendium-expansion) will fill `preset` for real class features | no (settled) | effect-modifiers, character-sheet-full |
| OQ-CMP-15 | Live refresh for players | **Refetch on open / search / Back; no push** / push a signal on homebrew save | no (owner: spec-compendium) | — |
| OQ-CMP-16 | Entry gone upstream | **Keep unchanged** (may be referenced) / delete when unreferenced | no (owner: spec-compendium) | entities |
| OQ-CMP-17 | **fixtures-adapters**: pipeline changes | **Per-kind stores, `updated` outcome, `cmp.import` the one routed caller (bundled source key only, never client data); amend FR-FIX-20 / -24** / compendium writes entries outside the pipeline | no (owner: integrator) | fixtures-adapters |
| OQ-CMP-18 | **entities / combat-tracker / combat-extras / character-sheet-full**: lazy imported definitions | **`imported-entity` lazy; `useDefinitions` replaces six call sites; lookups and the Creatures window search the server for imported monsters (FR-ENT-18, FR-CBT-63 amended)**. Sequencing per seams S3 (combat sites after R7; sheet site: OQ-CMP-24). **Decided with OQ-CMP-04 (#207).** Rejected: keep `imported-entity` in the snapshot | — | listed specs |
| OQ-CMP-19 | **party-board / live-sync**: lazy record types ADR | Integrator side settled by seams S1 (P's option A is the one on-demand path, with global scope + id loads; `fix/lazy-records` after V0, before P core and C2). **Decided (#207, G4): ADR accepted, option A** → [ADR-0045](../architecture/adr/0045-lazy-record-types.md) | — | party-board, live-sync |
| OQ-CMP-20 | **campaign-management**: player credential on REST | Settled by seams S11: **`Authorization: Player <link token>` on compendium routes via `resolvePlayerLink`**; integrator adds a note on campaign-management; no other track uses player REST | no (settled) | campaign-management, protocol §2 |
| OQ-CMP-21 | Glossary | **Update "Compendium" (design settled, link here); "Clone" (monsters: derive); add "Bundled source"** (recorded copy of an external source shipped in the repo, imported offline). Integrator adds after the gate (seams S9) | no (owner: integrator) | glossary |
| OQ-CMP-22 | Fixture goblin / wolf (`fixture`) duplicate SRD ones after an import | **Keep both; source Badge** / move fixtures to `srd-5.1` (touches every bundle's IDs). *(S4: sim-7 shows the badge alone isn't enough: equal names tie on id and the fixture won. Amended: keep both, **plus source rank** FR-CMP-38, OQ-CMP-30, decided #245)* | no (owner: C-search `build/cmp-search`) | fixtures-adapters |
| OQ-CMP-23 | SRD 5.2 (2024) | **Later, as a second source** (table plays 2014, #23) / now | no (owner: spec-compendium) | — |
| OQ-CMP-24 | **Seams S3 gap**: C2 switches `CharacterSheet.tsx` to `useDefinitions` (must land with the lazy switch) | Settled by review ruling X2: **sheet lock V5 → R3 → R6 → C2 → D4 → P4 / C4; C2 also after R7** | no (settled) | character-sheet-full |
| OQ-CMP-25 | **ADR amendments**: [ADR-0046](../architecture/adr/0046-compendium-scope.md) option A amends ADR-0004 (second global-record exception: `compendium_source`, `compendium_entry`), ADR-0018 (scope table row) and ADR-0019 (player REST header) | **Decided (#207, G4): accepted with the three amendments.** Rejected: accept without player REST; reject A (per-campaign import) | — | ADR-0004, ADR-0018, ADR-0019 |
| OQ-CMP-26 | *(S4)* Search syntax beyond plain words | **Decided** (DM, sprint-4 gate 1, #245; G41): **plain words only, every word must match; quotes, `-`, `:` fold away as punctuation** (FR-CMP-32). Rejected: `"quoted phrase"`, `-word` exclusion, `kind:` / `cr:` prefixes | — | — |
| OQ-CMP-27 | *(S4)* Matching | **Decided** (DM, sprint-4 gate 1, #245; G41): **word prefix in names and text, name substring as a lower tier, case + accent + apostrophe folding, plural `s` fallback** (FR-CMP-32, -33). Rejected: substring everywhere, typo-tolerant fuzzy (package), no plural fallback | — | — |
| OQ-CMP-28 | *(S4)* Ranking weights | **Decided** (DM, sprint-4 gate 1, #245; G42): **tiers exact > name starts with the query > every word starts a name word > all words in the name > name + text > text only; ties: source rank, shorter name, A–Z** (FR-CMP-33). Rejected: kind weight (monsters first), scored relevance | — | combat-tracker (lookups) |
| OQ-CMP-29 | *(S4)* What the All tab shows with an empty search | **Decided** (DM, sprint-4 gate 1, #245; G43): **alphabetical, duplicate names collapsed into one expandable row** (FR-CMP-35, -36). Rejected: sections per kind, nothing until you type | — | — |
| OQ-CMP-30 | *(S4)* Source rank on equal tiers | **Decided** (DM, sprint-4 gate 1, #245; G42): **the campaign's own homebrew / customs > bundled SRD > other imports > fixture** (FR-CMP-38). Rejected: SRD before homebrew, badges only | — | entities, combat-tracker |
| OQ-CMP-31 | *(S4)* **combat-tracker**: FR-CBT-63 lookup matching | Settled by seams S14 and rulings B8 (the integrator applies C's replacement text for FR-CBT-63 at merge; R doesn't edit for it): **amend FR-CBT-63: match with FR-CMP-37's `nameTier` (multi-word AND, tiers 0–3) instead of the single-phrase prefix / word / substring; merge per FR-CMP-37; `lookup.ts` granted to C-search, R's slices don't touch it**. Rejected: keep the old lookup rank (a multi-word query finds SRD rows from the server but drops matching customs) | no (settled) | combat-tracker |
| OQ-CMP-32 | *(S4)* Glossary | **Add "Search group"** (compendium entries with the same kind, name and source shown as one expandable search row) and **"Source rank"** (order of sources on equal search tiers: own, bundled, other imported, fixture) | no (owner: integrator) | glossary |
| OQ-CMP-33 | *(S4, review B22)* **character-sheet-full / effect-modifiers**: SRD second damage dice ("plus 2d6 fire", 44 SRD monsters, FR-CMP-05 keeps them as text today) into R0's `Attack.extraDamage` (R's OQ-CHARX-28) | **Map them in C-art core, riding its `ADAPTER_VERSION` bump, after R0 merged (shape per R's FR; a part that doesn't fit stays text with a warning)** / later, own slice (one more Update prompt) / never (the DM adds them by hand after Derive) | no (owner: C-art core `fix/cmp-art-core`; R confirms the shape) | character-sheet-full, effect-modifiers |

## 16. Out of scope

- Runtime Open5e, SRD 5.2, 5etools, homebrew files, Griffon's Saddlebag, AI paste (§4). Rules quick reference / DM screen; races, backgrounds, feats.
- Real class / subclass data beyond the SRD (e.g. Zealot): the 5etools import ([compendium-expansion](post-mvp/compendium-expansion.md)) maps class features to `preset: TriggerRule` on the feature entry, `ask` where the model can't express a part (#209). This spec's `feature` body already carries the field.
- Custom monster actions auto-rolled vs targets beyond today's attacks ([combat-extras §16](combat-extras.md#16-out-of-scope)); legendary / lair action tracking.
- *(S4)* Typo-tolerant search, search syntax beyond plain words, search inside the stat block's numbers (e.g. "cr 5": use Filters), result snippets showing where the text matched.
- Linking condition chips to compendium text (CBTX): later, small. (Clickable notation in entry text is in, via `DiceText`, FR-CMP-26.)
