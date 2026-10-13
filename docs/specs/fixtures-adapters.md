---
title: Fixtures and import pipeline core
prefix: FIX
status: complete
owner: spec-fixtures-adapters
wave: 1
---

# Fixtures and import pipeline core

## 1. Summary

- One command wipes a worktree's **disposable** DB + asset dir and rebuilds a known state from **fixtures** ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)). This spec owns fixture and bundle names (§8).
- Fixtures compose into named **bundles**. Setup fixtures are scripts of server commands; reference fixtures (SRD creatures) go through the **import pipeline** core ([ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md)).
- Pipeline core is minimal: validate → insert by global `(source, sourceKey)` → provenance ([ADR-0018](../architecture/adr/0018-global-imported-content.md)). Real adapters are post-MVP.

## 2. Scope

- **Commands** (names from AGENTS.md build conventions): `reset`, `load <bundle>`, `reset-and-load <bundle>`. Plus an **in-process loader** for `bun test`.
- Fixture/bundle format, resolution, determinism, data-dir lock, load manifest; pipeline core (batch contract, validation, insert, provenance).
- **Bundles** `base` and `session-sim` (§8). Skeleton ships the mechanism, pipeline core and `base`; later phases' builders add the rest of `session-sim`.

## 3. Goals

- Empty → playable `session-sim` in one command, within budget (FR-FIX-10). Same bundle → same IDs and player link URLs every time.
- Fixtures only create states the UI can reach (same commands, validation, domain events).
- Adding a fixture, bundle or content source never changes the mechanism or pipeline core.

## 4. Non-goals

- Real adapters: Open5e, homebrew, Griffon's Saddlebag (→ [compendium](post-mvp/compendium.md)), 5etools (→ [compendium-expansion](post-mvp/compendium-expansion.md)), Obsidian (→ [obsidian-importer](post-mvp/obsidian-importer.md)). AI paste is not an adapter. Character import. Generic adapter framework. In-place re-import of changed records.
- Fixtures in real play, seeding a game-night DB, backup/restore. Any in-app UI or route (import screen, "reset to fixture", load into a running server). Layering a bundle onto an already-loaded DB.

## 5. User stories

- As the DM at a phase gate, I want one command to put a worktree into `session-sim` so I can click through the demo myself.
- As the DM, I want reset to refuse anything not flagged disposable, so my real campaigns can never be wiped.
- As a builder, test agent or player tab, I want `reset-and-load` to print DM URL, DM secret and player links that stay the same across resets, so open tabs and scripts keep working.

## 6. Functional requirements

Retired IDs: 07 (merged into 06), 16 and 26 (→ review checks, §13), 22 (owned by entities, §10).

| ID | Requirement | Notes |
|---|---|---|
| FR-FIX-01 | `reset` empties the DB and asset dir (paths from env) and recreates the empty schema: zero rows, empty asset dir. Re-runnable from any prior state, including a half-finished reset or load. | |
| FR-FIX-02 | `reset` and `load` refuse (non-zero exit, nothing changed) when: the data dir is not flagged disposable, the resolved data dir is not under the worktree's `data/` or the OS temp dir, or the data-dir lock is held by a live process. | Flag: build conventions |
| FR-FIX-03 | `load <bundle>` applies the resolved fixtures in order. `reset-and-load` = `reset` then `load`, one invocation. | |
| FR-FIX-04 | Pre-flight, before any write: unknown bundle/fixture key, missing dependency, cycle, missing asset file or invalid reference record → non-zero, nothing written. | |
| FR-FIX-05 | A step failing mid-load → loader resets to empty, exits non-zero, and names bundle, fixture key, step index, command and validation message. | [OQ-FIX-11](#15-open-questions) |
| FR-FIX-06 | `load` requires an empty DB (manifest `empty`), else refuses with "reset first". No re-load or layering onto loaded state in MVP. | Composition is at resolution (FR-FIX-15) |
| FR-FIX-08 | Two `reset-and-load` runs of a bundle give identical record IDs, player link URLs, timestamps and row counts. A fixture's IDs and tokens are identical in every bundle that includes it (e.g. `player-1`'s link in `base`, `session-sim`, `sync-probe`). Fixed clock = one instant for every load, e.g. `2026-01-01T00:00:00Z` *(proposed)*. | [ADR-0022](../architecture/adr/0022-deterministic-seams.md) |
| FR-FIX-09 | On success the loader writes the load manifest and prints: bundle, fixtures, records per fixture key, DM client URL, DM secret (read from env, never written to the manifest), player link URLs, duration. | [OQ-CAMP-03](campaign-management.md#15-open-questions) |
| FR-FIX-10 | Budget: CLI `reset-and-load session-sim` ≤ 3 s incl. process start; in-process `session-sim` ≤ 1 s. Tests measure every run, warn above budget, fail above 2× budget. | Tolerates slow machines |
| FR-FIX-11 | The in-process loader creates a temp data dir flagged disposable, loads a bundle and returns the manifest, opening no ports. Parallel test files and worktrees never share files. | |
| FR-FIX-27 | Loader and server hold one exclusive data-dir lock for their lifetime; the server refuses to start while a loader holds it. A lock whose owner process is gone (crash) is cleared automatically with a one-line notice. | |
| FR-FIX-28 | Manifest status goes `resetting` → `empty` → `loading` → `complete`, each written before the step it names. Server start refuses on a disposable dir whose manifest is `resetting` or `loading` ("run reset-and-load"). | Crash recovery, §11 |
| FR-FIX-12 | A fixture is a TypeScript module declaring: key, kind (`setup` \| `reference`), required fixture keys, owning spec, then ordered command steps (`setup`) or one import batch (`reference`), plus its asset files. | |
| FR-FIX-13 | Setup steps call only registered server commands, in-process with DM authority, through the same validation, domain events and event log as UI intents. No other write path. | |
| FR-FIX-14 | A step can reference records created by earlier fixtures by fixture key. | |
| FR-FIX-15 | A bundle declares a name, included bundles and fixture keys. Resolution flattens, dedupes, orders by dependency then declaration order. Every bundle except `base` includes `base`. | |
| FR-FIX-17 | Fixture assets go through the asset store's ingest command, never copied into the asset dir. | [assets-pipeline](assets-pipeline.md) |
| FR-FIX-18 | Pipeline input is an **import batch**: source descriptor (key, name, licence, attribution) and records (kind, sourceKey, data). No campaign: imported definitions are global. Kind schemas come from the [ADR-0009](../architecture/adr/0009-entity-content-model.md) registry (MVP: `monster`); unknown kind → rejected. | [ADR-0018](../architecture/adr/0018-global-imported-content.md) |
| FR-FIX-19 | All records are validated before any write. Any invalid → nothing written; every error returned with sourceKey and field path. | |
| FR-FIX-20 | Key `(source, sourceKey)`, unique globally. New key → `created`; existing key → `existing`, nothing written. Each outcome returns the definition ID. | No in-place update ([OQ-FIX-18](#15-open-questions)) |
| FR-FIX-21 | Each imported definition stores provenance: source, sourceKey, licence, attribution, importedAt. | |
| FR-FIX-23 | Each `created` record emits the entities definition domain event and is logged; `existing` emits nothing. | [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) |
| FR-FIX-24 | No HTTP or WS route exists for reset, load or the pipeline. A route-table test confirms it. | |
| FR-FIX-25 | `session-sim` contains every §8 fixture marked for it that exists at the time. At skeleton it equals `base`. | |

## 7. UI/UX notes

- **Screens:** none; CLI + in-process API only. Styling N/A. **CLI states:** success summary (FR-FIX-09); one-line refusal (FR-FIX-02, 06, 27); failure naming fixture + step (FR-FIX-05).
- **DM view:** ordinary app state: "Fixture Campaign" active, its players, scenes etc. No fixture marking.
- **Player view:** the printed player link shows what any player sees. Nothing fixture-specific is visible or reachable.

## 8. Data model

Fixtures, bundles, manifest and lock are **code/files, not DB records**. Only provenance lives in the DB.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Fixture *(code)* | key, kind, requires, ownerSpec | string, `setup`\|`reference`, key[], spec | Key unique and stable |
| | steps \| batch; assets | (command, typed input)[] \| import batch; path[] | By kind; asset files under `fixtures/assets/` (AGENTS §9.3) |
| Bundle *(code)* | name, includes, fixtures | string, bundle[], key[] | |
| Import batch *(pipeline input)* | source | {key, name, licence, attribution, url?} | Fixtures use key `fixture` |
| | records | {kind, sourceKey, data}[] | `data` = per-kind schema (JSON leaf); partial allowed where the schema allows |
| Provenance *(fields on imported definition; table owned by [entities](entities.md))* | source, sourceKey, licence, attribution, importedAt | strings, timestamp | null source = custom. Unique `(source, sourceKey)` |
| Load manifest *(file in data dir)* | bundle, fixtures, status, records | string, key[], `resetting`\|`empty`\|`loading`\|`complete`, fixture key → record IDs | |
| | dmUrl, playerLinks, startedAt, durationMs | string, {player, url}[], timestamp, int | No DM secret |
| Data-dir lock *(file)* | owner, pid, port, startedAt | `server`\|`loader`, int, int \| null (server only), timestamp | Liveness check for stale locks |

- **Relations:** imported definitions are global, no campaign; customs derived from them belong to one campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md)). **Derived:** `readOnly = source != null`. **Persisted runtime state:** none owned here. Loaded state is ordinary app state ([ADR-0006](../architecture/adr/0006-persistence.md)).

**Fixtures** (canonical names; values *(proposed)*; shapes follow the owner). Characters use `char-<name>`. No item record: the shortsword is Mira's stored attack ([ADR-0012](../architecture/adr/0012-character-derived-values.md)).

| Fixture | Kind | Contents | Shape owner | In `session-sim` | Added in |
|---|---|---|---|---|---|
| `campaign` | setup | "Fixture Campaign", active | [campaign-management](campaign-management.md) | yes (`base`) | Skeleton |
| `player-1` | setup | Player "Player 1" in Fixture Campaign, stable link | campaign-management | yes (`base`) | Skeleton |
| `player-2` | setup | Player "Player 2", stable link. Optional | campaign-management | no | Skeleton |
| `campaign-second` | setup | Second campaign, inactive (contents owned by CAMP) | campaign-management | no | Skeleton |
| `sync-probes` | setup | Probes `public`, `secret` (hidden, text `SECRET-PROBE`), `mine` (owner `player-1`); test mode only | [live-sync](live-sync.md) | no | Skeleton |
| `enemy-1` | reference | SRD goblin: AC 15, HP 7, init +2, scimitar +4 / 1d6+2, CR 1/4. *(feedback pass, to build)*: speed 30; STR 8 DEX 14 CON 10 INT 10 WIS 8 CHA 8 | [entities](entities.md) | yes | Scenes |
| `enemy-2` | reference | SRD wolf: AC 13, HP 11, init +2, bite +4 / 2d4+2, CR 1/4. *(feedback pass, to build)*: speed 40; STR 12 DEX 15 CON 12 INT 3 WIS 12 CHA 6 | entities | yes | Scenes |
| `enemy-custom` | setup | Elite Goblin Warrior, custom in Fixture Campaign derived from `enemy-1`: AC 16, HP 15, scimitar +5 / 1d6+3, CR 1/2. *(feedback pass, to build)*: speed 30 and scores as `enemy-1`; save proficiency DEX; `tokenShape` square | entities (form: [combat-tracker](combat-tracker.md)) | yes | Scenes (entities ships derive, [OQ-ENT-12](entities.md#15-open-questions)) |
| `char-mira` | setup | Character "Mira", owned by `player-1`: L1 fighter, AC 16, HP 12/12, init +2, shortsword +4 / 1d6+2. *(feedback pass, to build)*: speed 30; STR 14 DEX 14 CON 14 INT 10 WIS 12 CHA 10; saves STR, CON | entities, [character-sheet](character-sheet.md) | yes | Scenes / Combat |
| `images` | setup | Town map, battlemap (20×14 cells at 70 px); tokens: Mira blue, goblin green, wolf grey, elite dark green | [assets-pipeline](assets-pipeline.md) | yes | Scenes |
| `town` | setup | Active scene: town map, grid, Mira token | [scenes-map](scenes-map.md) | yes | Scenes |
| `battlemap` | setup | Inactive scene: Mira + goblin visible, wolf + elite goblin **hidden** | scenes-map | yes | Scenes |
| `char-thorn` | setup | Character "Thorn", owned by `player-2`: L1 rogue, AC 14, HP 10/10, init +3, dagger +5 / 1d4+3. Requires `player-2`. *(feedback pass, to build)*: speed 30; STR 8 DEX 16 CON 14 INT 12 WIS 10 CHA 13; saves DEX, INT | [entities](entities.md#13-test-plan) | no | Scenes |
| `enemy-custom-second` | setup | Activates Second Campaign, creates custom "Marsh Troll" (large, AC 15, HP 59, claw +7 / 2d6+4, CR 5; *(feedback pass, to build)* speed 30), re-activates Fixture Campaign. Requires `campaign-second` | [entities](entities.md#13-test-plan) | no | Scenes |
| `image-large` | setup | `map-large` 6000 × 4000 SVG (→ `display` 4096 × 2731, `thumb` 512 × 341) | [assets-pipeline](assets-pipeline.md#13-test-plan) | no | Scenes |
| `images-second` | setup | Activates Second Campaign, ingests `town.svg` as "Town (copy)", re-activates Fixture Campaign. Requires `campaign-second`, `images` | [assets-pipeline](assets-pipeline.md#13-test-plan) | no | Scenes |
| `scenes-extras` | setup | Folder "Act 1" holding Town + Goblin Ambush; Thorn on both; custom "Cave Ogre" (large; *(feedback pass, to build)* speed 40, `tokenShape` none) visible on Goblin Ambush; root scene "Cellar" (`map-large`, cell 50, locked) with a goblin. Requires `battlemap`, `char-thorn`, `image-large` | [scenes-map](scenes-map.md#13-test-plan) | no | Scenes |
| `encounter-1` | setup | Planned "Ambush at the Ford": Goblin × 2, Wolf, Elite Goblin Warrior; party `null` (all). Requires `enemy-1`, `enemy-2`, `enemy-custom` | [combat-tracker](combat-tracker.md#13-test-plan) | yes | Combat |
| `goblin-2` | setup | Token "Goblin 2" (`enemy-1`) on Goblin Ambush (12, 8), visible. Requires `battlemap` | combat-tracker | yes | Combat |
| `thorn-battlemap` | setup | Thorn token (owner `player-2`) on Goblin Ambush (2, 9). Requires `battlemap`, `char-thorn` | combat-tracker | no | Combat |
| `combat-1` | setup | Start `encounter-1` on Goblin Ambush; initiative Wolf 18, Mira 15, Goblin 12, Goblin 2 12, Thorn 10, Elite 8; round 1, Wolf. Requires `encounter-1`, `goblin-2`, `thorn-battlemap` | combat-tracker | no | Combat |
| `combat-hit` | setup | Goblin attacks Mira (manual 15 / 4), applied → Mira 6/12 (*(feedback pass, to build)*: apply input `targets [{Mira, hit, normal}]`). Requires `combat-1` | combat-tracker | no | Combat |
| `combat-pending` | setup | Elite attacks (manual 19 / 5), card left pending. Requires `combat-hit` | combat-tracker | no | Combat |
| `char-pip` | setup | Character "Pip", owner `player-1`, L1 wizard, AC 12, HP 8/8, init +2, no attack (*(feedback pass, to build)*: no speed, no ability scores) | [character-sheet](character-sheet.md#13-test-plan) | no | Combat |
| `char-wounds` | setup | `char.adjustHp` Thorn −7 → 3/10. Requires `char-thorn` | character-sheet | no | Combat |
| `dice-settings` | setup | Public log categories on: attack, damage, initiative, healing | [dice-roll-log](dice-roll-log.md#13-test-plan) | yes | Combat |
| `rolls-1` | setup | Four DM rolls: public attack, hidden damage "DM-SECRET-ROLL", hidden skill, manual Mira initiative. Requires `dice-settings`, `char-mira`, `enemy-1` | dice-roll-log | no | Combat |
| `notifications-test` | setup | Seven test-kind notifications across audiences and states (text `SECRET-NOTE` on DM-only ones); test mode only. Requires `player-2` | [notifications](notifications.md#13-test-plan) | no | Combat |

- **Bundles (this spec):** `base` = `campaign` + `player-1`; `session-sim` = `base` + rows marked yes.
- **Bundles (other owners):** `sync-probe` = `base` + `player-2` + `campaign-second` + `sync-probes` ([live-sync](live-sync.md)); `campaign-switch` = `base` + `player-2` + `campaign-second` ([campaign-management](campaign-management.md)); `mid-combat` = `combat` + `combat-1` + `combat-hit` + `combat-pending` (combat-tracker, [OQ-FIX-04](#15-open-questions)).
- **Bundles (Combat owners):** `character-sheet` = `base` + `player-2` + `char-mira` + `char-thorn` + `char-pip` + `char-wounds` ([character-sheet](character-sheet.md#13-test-plan)). `dice-log` = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `dice-settings` + `rolls-1` ([dice-roll-log](dice-roll-log.md#13-test-plan)). `notifications` = `base` + `player-2` + `campaign-second` + `notifications-test`, test mode ([notifications](notifications.md#13-test-plan)). `combat` = `session-sim` + `player-2` + `char-thorn` + `thorn-battlemap` ([combat-tracker](combat-tracker.md#13-test-plan)). Combat fixtures roll via `ctx.dice`, seeded per fixture key (#137).
- **Bundles (Scenes owners):** `asset-library` = `base` + `player-2` + `campaign-second` + `images` + `image-large` + `images-second`; `asset-access` = `session-sim` + `player-2` (both [assets-pipeline](assets-pipeline.md#13-test-plan)). `entities` = `base` + `player-2` + `campaign-second` + `enemy-1` + `enemy-2` + `enemy-custom` + `char-mira` + `char-thorn` + `enemy-custom-second` ([entities](entities.md#13-test-plan)). `scenes` = `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + `enemy-2` + `enemy-custom` + `images` + `image-large` + `town` + `battlemap` + `scenes-extras` ([scenes-map](scenes-map.md#13-test-plan)). [play-shell](play-shell.md#13-test-plan) adds none (uses `sync-probe`).

## 9. API & events

- **REST / WS intents:** none (FR-FIX-24). **Internal command** *Import batch*: caller (MVP) loader only; input batch (§8); output per-record outcome + definition ID; errors: unknown kind, all validation errors (sourceKey + path). All-or-nothing.

**WS events** (live-sync generic record changes `{type, id, op, data}` + cause; no load-specific events)

| Event | Payload | Visibility rule |
|---|---|---|
| Definition record change, op `upsert`, from import | Definition + provenance | Per [entities](entities.md) (ADR-0018); hidden from players until entities registers a visibility fn (default deny, FR-SYNC-18) |
| Record changes from setup steps | As owning specs define | As owning specs define |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| reset / load / reset-and-load | CLI on the host, disposable data only | Never | No route (FR-FIX-24); guards (FR-FIX-02) |
| Import batch | Via loader (in-process, DM authority) | Never | Not routable in MVP |
| Edit an imported definition | No; derive a custom | No | Read-only enforced by [entities](entities.md) |

## 11. Edge cases & failure modes

- **Player / DM disconnect / reconnect:** no server runs during a load (FR-FIX-27), so tabs are disconnected. After restart, stable player links (FR-FIX-08) and the env DM secret reconnect and get a fresh snapshot ([live-sync](live-sync.md)).
- **Server crash:** lock owner gone → next loader clears the stale lock with a notice (FR-FIX-27); state is ordinary DB state ([ADR-0006](../architecture/adr/0006-persistence.md)). **Crash during reset or load** (e.g. DB wiped, asset dir not yet): manifest stays `resetting` / `loading` → `load` and server start refuse; `reset-and-load` redoes it from scratch (FR-FIX-01, 28).
- **Concurrent edits:** second loader, or loader + server, on one data dir → lock refusal. Worktrees never share paths ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)).
- **Invalid input:** bad step → wipe + named error (FR-FIX-05); bad reference record or missing image → pre-flight error (FR-FIX-04). Steps are typed against command schemas; the all-bundles test catches runtime drift.
- **Real data:** reset refused (FR-FIX-02); seeded IDs/tokens never run there ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)).

## 12. Performance & bandwidth

- Full `session-sim`: 1 campaign, 1 player, 1 character, 3 definitions, 2 scenes, ~6 tokens, 1 encounter, ~6 images (≤ 0.5 MB), ~30 domain events. Budget: FR-FIX-10. Likely costs: schema creation, rasterising (template DB is a build option). No network use.

## 13. Test plan

Isolated per worktree: every run uses its own temp data dir ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)). Agent loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

| Level | What | Fixtures |
|---|---|---|
| Unit | Resolution: includes, dedupe, order, `base` rule, cycle / unknown / missing dep (FR-FIX-04, 15) | Test-only fixtures |
| Unit | Pipeline: valid; all errors reported; unknown kind; created / existing; provenance; `readOnly` (FR-FIX-18–21) | Test-only kind; `enemy-1`, `enemy-2` later |
| Integration | Every bundle and fixture (with deps) loads. Determinism: two runs identical; `player-1` link same in `base` and `session-sim` (FR-FIX-08). Timing: warn > budget, fail > 2× (FR-FIX-10) | All |
| Integration | Mid-load failure → empty + named error; non-empty → "reset first"; killed reset / load → refusals, then recovery. Guards: not disposable, data dir outside `data/` / temp, live lock → refuse; stale lock cleared (FR-FIX-02, 05, 06, 27, 28) | `base`, test-only broken fixtures |
| Integration | One event-log entry per mutating step; pipeline events; no route (FR-FIX-13, 23, 24) | `session-sim` |
| E2E (thin) | Playwright: `reset-and-load session-sim`, DM + `player-1` contexts connect | `session-sim` |

**Review checks** (per PR, not FRs): adding a fixture/bundle touched no loader or pipeline code; SRD fixtures are SRD 5.1 text with CC BY 4.0 attribution; images are simple shapes ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)), map ≤ 200 KB, token ≤ 20 KB.

**Browser walkthrough** — bundle `session-sim`

- **Setup:** `reset-and-load session-sim`; read DM URL, DM secret, player link from the summary; start the app on the worktree's ports.
- **DM (context A):** open DM URL, enter the secret → "Fixture Campaign" active, player "Player 1". *From Scenes:* town active with Mira's token; battlemap shows wolf and elite goblin translucent.
- **Player (context B):** open the `player-1` link → joined as Player 1. *From Scenes:* sees the town; after the DM activates the battlemap, sees Mira and the goblin only.
- **Round-trip + expected:** stop app, `reset-and-load session-sim`, restart, reload both → same player link works, identical state, no console errors, player never receives hidden tokens or DM-only fields.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0015, 0017, 0018 | Creature schema, pipeline shape, fixture library, global imported definitions | accepted |
| AGENTS.md build conventions | Command names, folder layout, env names, disposable flag, lock + seam mechanism | agreed, pending merge |
| [campaign-management](campaign-management.md) | Create campaign (active/inactive), add player; tokens via the seed seam; `campaign-second` contents | open |
| [live-sync](live-sync.md) | Generic record changes; snapshot on reconnect; `sync-probe` on `base`; injectable clock and timers (FR-SYNC-26) | open |
| [entities](entities.md); [assets-pipeline](assets-pipeline.md), [character-sheet](character-sheet.md), [scenes-map](scenes-map.md), [combat-tracker](combat-tracker.md) | Entities: global definition table + provenance, read-only enforcement, definition events, `monster` kind. Others: commands and shapes their fixtures use | open |

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-FIX-01, 05–07 | ~~Pipeline for fixtures? Images? Real play? Pipeline in MVP?~~ **Decided:** reference content only; committed SVGs via sharp (D3); no; yes, minimal ([ADR-0015](../architecture/adr/0015-source-adapters-fixtures.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)) | — | — | — |
| OQ-FIX-02, 08, 09 | ~~Format? Time budget? How the loader calls commands?~~ **Decided (gate D4):** TypeScript modules; CLI ≤ 3 s, in-process ≤ 1 s, tolerant test (FR-FIX-10); in-process, DM authority, no HTTP | — | — | — |
| OQ-FIX-03 | ~~Fixture location and ownership~~ **Decided (AGENTS §9.3):** one `fixtures/` tree, `units/<feature>/`; this spec owns names | — | — | — |
| ~~OQ-FIX-04~~ | ~~Mid-combat fixtures?~~ | Decided (gate I11): `mid-combat` bundle on `combat` (⊇ `session-sim`), owned by combat-tracker | — | combat-tracker |
| OQ-FIX-10 | ~~Load while the server runs?~~ **Decided:** CLI refuses (#114); lock handling FR-FIX-27/28 | — | — | — |
| OQ-FIX-11 | Failure mid-load | **Wipe to empty, named error** / outer-transaction rollback: fights per-command commits (ADR-0016) | no (owner: spec-fixtures-adapters) | — |
| OQ-FIX-12 | ~~Deterministic IDs/tokens/clock~~ **Decided:** seeded per fixture, disposable dirs only (D4, [ADR-0022](../architecture/adr/0022-deterministic-seams.md)) | — | — | — |
| OQ-FIX-13 | ~~DM secret in fixtures~~ **Decided (moot):** env only (OQ-CAMP-03); loader prints the env value | — | — | — |
| OQ-FIX-14 | ~~Upsert key scope~~ **Decided:** global `(source, sourceKey)` ([ADR-0018](../architecture/adr/0018-global-imported-content.md)) | — | — | — |
| OQ-FIX-15 | Where provenance lives | **Inline fields on the definition row** / separate tables | no (owner: entities) | entities |
| OQ-FIX-16 | Batch with some invalid records | **Reject all, report every error** / accept valid (revisit with compendium) | no (owner: spec-fixtures-adapters) | post-mvp/compendium |
| OQ-FIX-17 | ~~How reset knows data is disposable~~ **Decided:** explicit flag in build conventions (integrator) | — | — | — |
| OQ-FIX-18 | Re-import of a changed record (ADR-0015 open row) | **MVP: skip (`existing`); update in place when the first real adapter lands** / version it | no (owner: post-mvp/compendium) | entities |
| OQ-FIX-19 | Confirm §8 shape owners; who ships the derive command for `enemy-custom` | **As listed; entities if it ships create-custom, else combat-tracker** | no (owner: entities, combat-tracker) | listed specs |
| OQ-FIX-20 | ~~Glossary~~ **Decided (integrator):** added **Fixture bundle**, **Setup fixture** vs **Reference fixture**, **Load manifest**, **Import batch**, **Disposable** (data dir) | — | — | — |

## 16. Out of scope

- Dice seeding → [dice-roll-log](dice-roll-log.md). Exact command names, folder layout, env names, lock mechanism → AGENTS.md build conventions.
