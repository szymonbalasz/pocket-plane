---
title: Compendium expansion
prefix: CMPX
status: draft
owner: spec-compendium-expansion
phase: post-mvp
---

# Compendium expansion: 5etools import

> **Guideline:** five-minute read. Builds on [compendium](../compendium.md) (FR-CMP-*); everything not restated here works as there. Measured figures come from the DM's local 5etools package (2014 build `1.217.1`, 2026-05-24), read by a throwaway probe outside the repo; no 5etools text is quoted or committed. DM picks so far (2026-10-30): 2014 build, global library, SRD duplicates hidden behind the 5etools copy, no classes.

## 1. Summary

- The DM points the server at their own extracted 5etools folder (`PP_5ETOOLS_DIR`) and imports the **books** they choose into the compendium: **monsters, spells, items**.
- Each book becomes one more global, read-only **source**, next to `srd-5.1` ([ADR-0018](../../architecture/adr/0018-global-imported-content.md), [ADR-0046](../../architecture/adr/0046-compendium-scope.md)). Search, entry views, Derive, Add to sheet, players' reads: unchanged paths.
- An imported entry that *is* an SRD entry (or a reprint of an older book's) **hides the other from search**; old references keep working.
- Nothing from 5etools is bundled, committed or sent in a snapshot.

## 2. Scope

- **X1 core:** config, folder reader, 5etools adapter (monsters, spells, items), per-book sources, import / update, supersede rule, fixtures.
- **X2 panel:** the DM import panel lists the folder's books; import / update per book; About credits.
- **X3 token art** *(later slice)*: 5etools token images for imported monsters ([OQ-CMPX-01](#15-open-questions)).
- *(proposed)* A local probe script reporting mapping warnings over the real folder (dev aid, never in CI).

## 3. Goals

- Import the Monster Manual in one click, ≤ 2 s; every book the DM owns in ≤ 15 s total.
- "goblin" gives **one** Goblin: the MM's, not the SRD's too.
- 5etools monsters drop onto the map and into encounters exactly like SRD ones (same definition contract, FR-CMP-03).
- A new 5etools release → **Update**, nothing else to do; DM work never changes (FR-CMP-09).
- Players can look up spells and items from the imported books; never monsters (FR-CMP-14).
- 0 B in any snapshot; search stays ≤ 5 ms p95 over everything imported.

## 4. Non-goals

- **Classes, subclasses, races, backgrounds, feats, optional features**: wait for character-sheet work and [levelling](levelling.md) (DM, 2026-10-30).
- Conditions and diseases (the 2014 conditions = SRD text, already imported); variant rules and actions as `rule` cards; adventure and book text; monster lore (fluff, [OQ-CMPX-05](#15-open-questions)).
- 2024 rules (the `5etools-2.x` builds), reading the `.tar.xz` directly, downloading 5etools.
- Running ttrpg-convert-cli or any Java; its code is a reading reference only (tag rendering, `_copy` handling).
- Expanding generic magic variants into every weapon / armor combination.
- Per-campaign book filtering (DM: global is fine).

## 5. User stories

**DM**
- As the DM, I want to pick MM, Volo's and Xanathar's in a list and import them, so my library matches the books I own.
- As the DM, I want "goblin" to show the Monster Manual Goblin only, and the Monsters of the Multiverse version of a Volo's creature only.
- As the DM, I want to drag a Mind Flayer onto the map and roll its Mind Blast from the stat block.
- As the DM, I want to download the next 5etools release, extract it over the folder, and click Update.

**Player**
- As a player, I want to look up a Xanathar's spell and add it to my sheet.
- As a player, I want Hunter's Mark to still add its trigger even though the entry now comes from the PHB.

## 6. Functional requirements

All writes as compendium (one transaction, event-log entry, domain event; ids / time from `ctx`).

| ID | Requirement | Notes |
|---|---|---|
| **X1 core** | | |
| FR-CMPX-01 | **Config.** Optional `PP_5ETOOLS_DIR` (absolute, or relative to the worktree root), parsed in `config.ts`. Unset, missing, or no `data/books.json` → the 5etools feature reports `not-configured` / `not-found`; the rest of the app is unaffected. Read-only: the server never writes there. | Shared file |
| FR-CMPX-02 | **Books.** The folder's books = every source abbreviation with ≥ 1 monster, spell or item (bestiary / spells index files, `items.json`), labelled from `books.json` / `adventures.json`, else the abbreviation. One **compendium source** per book: key `5et-<abbr lower>` (e.g. `5et-mm`), name = book name, badge = abbreviation. `cmp.import` takes this key; the server maps it to files itself; a key not in the list → `invalid`. Never a path from the client. | Measured: 27 book + 53 adventure + 15 other sources have monsters |
| FR-CMPX-03 | **Version.** Source `version` = SHA-256 of (`changelog.json`'s last `ver` + `ADAPTER_VERSION_5ET`). Panel shows **Update** when it differs from the stored one (FR-CMP-04, -20). | Cheap: no 90 MB hash |
| FR-CMPX-04 | **Read only what's needed:** bestiary (all files, for cross-book `_copy`), `legendarygroups.json`, the spells files + `spells/sources.json`, `items.json`, `items-base.json`, `magicvariants.json`. Parsed per import, dropped after. | ≈ 13 MB of 90 MB |
| FR-CMPX-05 | **Copies.** `_copy` (with `_mod`: `replaceArr`, `appendArr`, `prependArr`, `insertArr`, `removeArr`, `replaceTxt`, `setProp`, `scalarAddProp`, `scalarMultProp`, `addSpells`) resolved before mapping, recursively, across books. An unknown mode or missing base → that record skipped with a warning. | 1,124 of 3,808 monsters are copies |
| FR-CMPX-06 | **Text.** 5etools `entries` → markdown-lite (FR-CMP-26): strings → paragraphs; named `entries` → `**Name.** text`; `list` → `- ` items; `table` → pipe table; `inset` / `quote` → `> ` quote; anything else → its plain text, warning. Tags: `{@hit n}` → "+n", `{@damage x}` / `{@dice x}` → "x" (clickable via `DiceText`), `{@dc n}` → "DC n", `{@atk mw}` → "*Melee Weapon Attack:*" (and `rw`, `ms`, `rs`, combos), `{@h}` → "*Hit:* ", `{@recharge n}` → "(Recharge n–6)", every other tag → its display text (last `\|` part, else first). Output is text, never HTML or links. | Monster tag census: 31 kinds, top 10 = 95 % |
| FR-CMPX-07 | **Monster → entry + definition** (FR-CMP-03, -05 contract): size, AC, HP + formula, speed, scores, saves, CR, `type` (object → its `type`), darkvision; **attacks** from actions with `{@atk}` + `{@hit}` + first `{@damage}` (type from the text after it). Second damage dice stay in the text with a warning ([OQ-CMPX-03](#15-open-questions)). Spellcasting → a trait "Spellcasting" (header, then "At will: …", "1/day each: …", "1st level (4 slots): …"); legendary → `legendary`; mythic, lair actions, regional effects (legendary group) → one trait each. Over-limit lists / texts clipped with a warning (FR-CMP-01 caps). | 4,211 attack actions; 1,382 with > 1 damage tag |
| FR-CMPX-08 | **Monster without a numeric HP or AC** (42 special HP, 20 AC): the entry is imported, **no creature definition** (not draggable, no lookup row); its view's **Derive…** opens the creature form from the entry text with HP / AC empty. *(pick, [OQ-CMPX-02](#15-open-questions))* | 62 monsters |
| FR-CMPX-09 | **Spell** → `spell`: level, school, components, material, duration, range, casting time, `text`, `higherLevel` (`entriesHigherLevel`), concentration, ritual; classes from `spells/sources.json`, SRD twelve only, others dropped with a warning *(pick, [OQ-CMPX-06](#15-open-questions))*. | 525 spells |
| FR-CMPX-10 | **Item** → `item`: `items.json` + base items + generic variants ("+1 Weapon", not expanded); item groups → one entry each. Category from the type code (melee / ranged → weapon; LA / MA / HA / S → armor; magic when `rarity` ∉ none / unknown; else gear), rarity, attunement (`reqAttune`), cost, weight, damage, properties, AC. | 1,640 + 124 + 129 + 72; largest 34 KB raw |
| FR-CMPX-11 | **Keys.** `sourceKey` = `<kind>/<slug(name)>` within the book source (`5et-mm` + `monster/goblin`); the monster's definition uses the same pair. A duplicate key in one book → the record skipped with a warning. | Measured 0 duplicate monster names per book |
| FR-CMPX-12 | **Import** = FR-CMP-07 per book: `cmp.import {source: "5et-mm"}`; the panel's Import of N books runs N commands **one after another, one transaction each** *(pick, [OQ-CMPX-09](#15-open-questions))*; refused while an encounter is started. Outcomes `created` / `updated` / `existing`; events and logging as FR-CMP-08. Re-import never touches homebrew, clones, customs or sheets (FR-CMP-09). | |
| FR-CMPX-13 | **Supersede.** An imported entry may list `supersedes`: entries it replaces, as `<source>:<sourceKey>` refs, set by the adapter. (a) `srd: true` / `srd: "<SRD name>"` → the `srd-5.1` entry of that kind and name. (b) An older entry whose `reprintedAs` names this one (e.g. Volo's → MPMM) → that entry. | 323 monsters, 319 spells, 493 items carry `srd`; 275 monsters `reprintedAs` |
| FR-CMPX-14 | **Hidden, not gone.** In the search index (FR-CMP-34), an entry referenced by any **imported** entry's `supersedes` is left out of search, the default list, groups, lookups (FR-CMP-17) and the Creatures window, for DM and players. `GET /entries/:id`, `sync.load` of its definition, existing tokens, encounters, derived customs and Rules pages (FR-CMP-64) still resolve it. Derived each index build, so import order doesn't matter. | DM pick (b) |
| FR-CMPX-15 | **Presets follow.** FR-CMP-29's preset resolution: an entry with no preset of its own takes the preset of an entry it supersedes ("Hunter's Mark" from the PHB → `hunters-mark`). | Seam with effect-modifiers |
| FR-CMPX-16 | **Rank.** Book sources rank 2 (FR-CMP-38: other imported). Source label = book name; badge = abbreviation. Derive's copied rows and Add to sheet's feature `source` use the abbreviation. | |
| **X2 panel** | | |
| FR-CMPX-17 | DM import panel gains a **5etools** section: `not-configured` → "Set PP_5ETOOLS_DIR in .env to your extracted 5etools folder"; `not-found` → that plus the resolved path; else the 5etools version and a book list (search box, checkbox per book, monster / spell / item counts, "imported ‹date›" or **Update**). **Import selected** / **Update all** → confirm "Players will pause for a few seconds per book" → progress "Book i / N" → Toast with totals and warning count. | FR-CMP-20 |
| FR-CMPX-18 | **Credits.** FR-CMP-19's About dialog lists each imported book: "‹Book› — © Wizards of the Coast. Read from your own 5etools files for use at your table." Entry footer: "‹Book› (‹abbr›)", no licence line. | |
| FR-CMPX-19 | **Test IDs:** `cmpx-panel`, `cmpx-status` (+ `data-state` `not-configured` \| `not-found` \| `ready`), `cmpx-book` (+ `data-value` = source key, `data-state` `new` \| `imported` \| `outdated`), `cmpx-book-check`, `cmpx-book-search`, `cmpx-import`, `cmpx-update-all`, `cmpx-progress`. | AGENTS §9.5 |
| **Cross-cutting** | | |
| FR-CMPX-20 | **Never committed:** no 5etools text, name list or image in the repo, fixtures included. Fixtures are invented creatures, spells and items **in 5etools format** (FR-CMPX-26). | Public repo; ADR-0015 |
| FR-CMPX-21 | **0 B snapshot** (FR-CMP-30): the CON-44 test imports the fixture books and asserts no growth for any viewer. | |
| FR-CMPX-22 | **Search cost:** the FR-CMP-34 bench re-runs on a synthetic index of SRD + 6,300 rows (all books); gate ≤ 5 ms p95, test fails above 50 ms. | §12 |

## 7. UI/UX notes

Per [visual-direction](../../design/visual-direction.md), shadcn/ui only.

- **Import panel** (DM, Compendium window): SRD section as today, then **5etools**: status line, version, a search Input, a scrollable Checkbox list (book name, muted "MM · 450 monsters · 0 spells · 0 items", Badge "Imported" / "Update"), footer **Import selected** (disabled with none checked) and **Update all**. Progress replaces the footer while running.
- **Results / views:** source Badge = book abbreviation ("MM", "XGE"); otherwise as compendium §7.
- **States:** not configured / not found (FR-CMPX-17); importing (buttons disabled, progress); error Toast per failed book, others kept; disconnected: REST only, writes need `live` (FR-CMP §7).
- **DM view:** everything above. **Player view:** no panel; book entries appear in search with their badges (no monsters).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Compendium source | key | text | `5et-<abbr>` |
| | name, licence, attribution, url | text | Book name; licence "User-supplied (5etools)"; url null |
| | version | text | FR-CMPX-03 |
| Compendium entry | supersedes *(new)* | **JSON leaf** `string[]` (`<source>:<sourceKey>`), default `[]` | Imported only; not part of `dataHash`'s body hash but stored with it (changes count as `updated`) |
| Entity (imported definition) | source, sourceKey | text | Book source + `monster/<slug>` |

- **Relations:** book source 1—* entry; monster entry 1—0..1 definition (FR-CMPX-08); entry *—* superseded entries (by ref, no FK).
- **Derived:** the hidden set (FR-CMPX-14) and the inherited preset (FR-CMPX-15), at index build; book list and counts (folder read, cached per process until the version changes).
- **Persisted runtime state:** none. Additive column; existing rows need no backfill.

## 9. API & events

**REST**

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/compendium/sources` | DM | + `fiveEtools {state, version?, books[{key, name, abbr, counts, importedVersion?}]}` |
| POST | `/api/compendium/import` | DM | Unchanged body `{source}`; accepts `5et-*` keys |
| GET | `/api/compendium/search`, `/entries/:id` | DM, player | Unchanged; hidden set applied (FR-CMPX-14) |

**WS intents:** none new. **WS events:** none new. `EntityImported` / `ImportedEntityUpdated` / `CompendiumImported` as FR-CMP-08 (definitions: DM only; `CompendiumImported`: DM only).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| See 5etools panel, import, update | ✓ | — | DM secret (FR-CMP-13) |
| Search / read book spells and items | ✓ | ✓ | `entryVisibleTo` (FR-CMP-14) |
| Read book monsters | ✓ | — | as FR-CMP-14 |
| Choose files or paths | — | — | Never: key → files on the server (FR-CMPX-02) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** REST reads; nothing to resync.
- **DM disconnect mid-import:** the server finishes the running book; the panel reloads state from `/sources` (per-book imported version).
- **Server crash mid-import:** the running book rolls back; books committed before it stay; re-running imports the rest (`existing` for done ones).
- **Folder changed while running:** each book reads its files once at its start; a later book may see the new release, and the panel then shows **Update** for the earlier ones.
- **Invalid / malicious input:** files are untrusted data: JSON parse only, zod on every mapped record, caps from FR-CMP-01, text never rendered as HTML, links dropped. A malformed file fails that book with issues, nothing written for it.
- **SRD not imported:** `supersedes` refs point at nothing; nothing hidden.
- **5etools book removed from a later release:** its entries stay (FR-CMP-09; removal: [OQ-CMPX-04](#15-open-questions)).

## 12. Performance & bandwidth

| What | Figure |
|---|---|
| Folder | `data/` 90 MB; read per import ≈ 13 MB; tokens 3,857 files, 559 MB (X3 only) |
| Entries if every book is imported | ≈ 3,800 monsters + 525 spells + ≈ 1,960 items ≈ 6,300 (SRD today: 1,288) |
| Import | MM target ≤ 2 s; all books ≤ 15 s (logged; test on fixtures fails above 10 s per book) |
| Search | ≤ 5 ms p95 over SRD + 6,300 (FR-CMPX-22); 0.96 ms today on SRD |
| Snapshot | 0 B (FR-CMPX-21) |
| Players / tunnel | Unchanged: one entry per read, `ETag` / `304` |

## 13. Test plan

Isolated per worktree ([ADR-0008](../../architecture/adr/0008-parallel-dev-isolation.md)), [ADR-0017](../../architecture/adr/0017-agent-verification-fixture-library.md).

| Level | What | Fixtures |
|---|---|---|
| Unit | `_copy` / `_mod` modes; tag rendering table; entries → markdown-lite; monster / spell / item mapping incl. FR-CMPX-08; key slugs and duplicates; `supersedes` from `srd` and `reprintedAs`; book list labels | `fixtures/5etools-mini/` |
| Integration | Import two books: counts, warnings, idempotent re-import (0 writes); Update after a fake version bump; hidden set for DM and player (search, lookups, Creatures, `sameAs`) while `GET` still works; preset inheritance + Add to sheet; per-book transaction on `PP_TEST_CRASH=cmp.import:before-commit`; config states; path never from client; CON-44 0 B; search bench | `5etools-mini` + `cmp-srd-mini-s3` |
| E2E (thin) | DM imports both fixture books, "goblin" → one row badged TB1, drag to map; player sees the TB1 spell, no monsters | bundle `cmpx-5etools` |

- **Fixture folder** `fixtures/5etools-mini/` (invented content, 5etools layout): books `TB1`, `TB2` in `books.json`; `changelog.json` `ver` `0.0.1`; bestiary: a "Goblin" with `srd: true` (own stats and words), a `_copy` variant, a "Gnasher" in TB1 `reprintedAs` TB2, a special-HP monster, a spellcaster, a legendary creature with a group; one spell with `srd: "Hunter's Mark"`; a weapon, a magic item, a generic variant.
- **Bundle `cmpx-5etools`** = `base` + `cmp-srd-mini-s3`; the walkthrough sets `PP_5ETOOLS_DIR=fixtures/5etools-mini`.

**Browser walkthrough:** bundle `cmpx-5etools` → DM: Compendium → panel `ready`, two books → import both → "goblin" gives one TB1 Goblin → stat block attack rolls → drag to map; "gnasher" gives TB2 only; Derive… on the special-HP monster opens the form with HP empty; re-import → "0 changed" → player: TB1 spell found, Add to sheet adds the Hunter's Mark trigger; Monsters tab absent; search "goblin" empty.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [compendium](../compendium.md) | Import pipeline, index, visibility, panel; amendments FR-CMP-04 (book sources), -06 (non-bundled source), -29 (FR-CMPX-15), -34 (hidden set), -38 (rank) | complete; amendments via proposed ADR |
| Server config (`config.ts`), `.env.example`, AGENTS §9.2 | `PP_5ETOOLS_DIR` | Shared files: orchestrator |
| DB schema, data-model docs | `compendium_entry.supersedes` | Shared files: orchestrator |
| [entities](../entities.md) | Definition contract; token art (X3) | complete |
| [effect-modifiers](../effect-modifiers.md) | Preset lookup by `featureKey` (FR-CMPX-15) | complete |
| [proposed ADR](../../architecture/adr/proposed-user-supplied-sources.md) | User-supplied folder sources + supersede rule | proposed |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CMPX-01 | Token art for 5etools monsters (X3): imported definitions are global, assets are per campaign ([ADR-0023](../../architecture/adr/0023-asset-access-by-capability-id.md)) | **A: copy the token into the campaign's asset store on first placement, reused after** · B: global art route (amends ADR-0023) · C: type glyphs only | no (X3 only) | entities, scenes-map, assets-pipeline |
| OQ-CMPX-02 | Monsters with no numeric HP / AC (62) | **A: entry only, Derive fills in** · B: placeholder HP / AC with a warning | no | FR-CMPX-08 |
| OQ-CMPX-03 | Second damage dice in attacks (1,382 of 4,211) | **A: first damage only, rest in text (as SRD)** · B: extra damage parts in the creature core | no | entities, combat |
| OQ-CMPX-04 | Removing an imported book | **A: later** · B: now (delete entries, keep definitions in use) | no | FR-CMP-09, §4 |
| OQ-CMPX-05 | Monster lore (fluff text) | **A: later** · B: now, as a `lore` text in the monster body | no | compendium §8.1 |
| OQ-CMPX-06 | Spell classes outside the SRD twelve (Artificer) | **A: drop with a warning for now** · B: widen the `classes` facet | no | compendium FR-CMP-11 |
| OQ-CMPX-07 | One transaction per book or one for all | **A: per book** (short pauses, partial success) · B: all at once | no | FR-CMPX-12 |
| OQ-CMPX-08 | Glossary: **Book** (a 5etools source abbreviation, one compendium source), **Superseded entry** | **Add both** | no | glossary |

Owner of non-blocking questions: the DM at the spec gate.

## 16. Out of scope

- Classes and character options → [levelling](levelling.md); 2024 rules; lore, conditions, rules text (§4).
- Token art until OQ-CMPX-01 is decided (slice X3).
- Other third-party formats (Griffon's Saddlebag, homebrew files) → their own adapters ([ADR-0015](../../architecture/adr/0015-source-adapters-fixtures.md)).
