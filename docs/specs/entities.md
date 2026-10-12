---
title: Entities (core)
prefix: ENT
status: draft
owner: spec-entities
wave: 2
---

# Entities (core)

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The **creature definition** contract that tokens, combatants and encounter entries point at. MVP kinds: `character`, `monster` ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- One `entity` table, one zod stat-block schema per kind, same shape for SRD, custom and fixture ([ADR-0009](../architecture/adr/0009-entity-content-model.md)). Imported definitions are global and read-only; custom definitions and characters belong to one campaign ([ADR-0018](../architecture/adr/0018-global-imported-content.md)).
- Owns the commands to create, derive, edit and delete definitions, and their visibility. The creature **form** is [combat-tracker](combat-tracker.md)'s; instances are [scenes-map](scenes-map.md)'s and combat-tracker's.

## 2. Scope

- `entity` record: kind, scope, name, portrait, stat block (JSON leaf), inline provenance, character owner and current HP.
- Shared creature core (size, AC, max HP, initiative bonus, attacks) + monster `cr` + character `level`, `className`. XP derived from CR.
- Server commands: create custom monster (from scratch or **derived**), create character (fixtures only in MVP), update, delete *(proposed, OQ-ENT-07)*. Internal import write for the pipeline ([fixtures-adapters](fixtures-adapters.md)).
- Read-only enforcement for imported definitions; campaign-scope checks for every definition reference.
- Record types + visibility fns; DM **Creatures** list window (read-only, drag source) *(proposed, OQ-ENT-03)*.
- Fixtures `enemy-1`, `enemy-2`, `enemy-custom`, `char-mira` (+ test-only additions, §13).

## 3. Goals

- Encounter builder, tokens and combat never branch on where a definition came from.
- No code path changes an imported definition; the DM customises only by deriving.
- Players never learn prepared monsters or other players' stats.
- An edit to a custom definition reaches every instance with no copy to update.
- Later kinds (npc, item…), full sheet fields and modifiers are additive: no reshaping of MVP data.

## 4. Non-goals

- World-builder kinds, notes, search, cross-references, location ↔ scenes (→ [world-builder](post-mvp/world-builder.md)). Compendium browse, clone, real adapters, re-import (→ [compendium](post-mvp/compendium.md)).
- Creature form UI (→ [combat-tracker](combat-tracker.md), tier S). Full monster editor, custom actions, traits, abilities, saves, skills (tier A). Stat block view on token click (tier B).
- Character builder or player-created characters (→ [levelling](post-mvp/levelling.md)); full sheet (→ [character-sheet-full](post-mvp/character-sheet-full.md)).
- Instance state (position, hidden, initiative, monster HP) and modifiers (tier A, [combat-extras](post-mvp/combat-extras.md)).

## 5. User stories

**DM**
- As the DM, I want to derive "Elite Goblin Warrior" from the SRD goblin so that I only type what differs.
- As the DM, I want to fix a custom creature mid-session and have every token and combatant use the new stats.
- As the DM, I want SRD creatures visibly locked so that I can't break reference data by accident.
- As the DM, I want my prepared monsters invisible to players until a token shows them.

**Player**
- As a player, I want my character's numbers (incl. current HP) to be mine and always current.
- As a player, I want my sheet private from other players.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-ENT-01 | Kind registry in `@shared/entities`: `character`, `monster`, each with a strict zod stat-block schema (§8). Every write validates; reads re-validate (ADR-0006). Unknown kind or key → `invalid` with field path. | One schema for pipeline, commands, fixtures (FR-FIX-18) |
| FR-ENT-02 | Both kinds share the creature core (§8). Monster adds `cr`; character adds `level`, `className`. | OQ-ENT-04 |
| FR-ENT-03 | XP is derived from CR by the SRD table in `@shared/entities`, never stored. CR 0 → 10 XP *(proposed)*. | Used by combat-tracker (OQ-CBT-12) |
| FR-ENT-04 | Imported definitions have `campaignId = null`. Custom monsters and characters get `ctx.campaignId`; no request field sets a campaign. | ADR-0018 |
| FR-ENT-05 | Provenance is inline on the row: `source, sourceKey, licence, attribution, importedAt`; unique `(source, sourceKey)`; all null for customs. `readOnly = source != null`. | Answers OQ-FIX-15 |
| FR-ENT-06 | Only the internal `entities.import` (called by the pipeline, FR-FIX-20) writes rows with a source. It emits one `EntityImported` per created row. No route reaches it. | FR-FIX-23, 24 |
| FR-ENT-07 | Update or delete of an imported definition → `forbidden` (REST 403) "Imported definitions are read-only. Derive a custom one.", no change, no event, no log entry. | Was FR-FIX-22 |
| FR-ENT-08 | Create custom monster: name trimmed, 1–60 chars, no control chars, unique (case-insensitive) among the campaign's entities of that kind, else `conflict`. Optional portrait = asset of the same campaign. | |
| FR-ENT-09 | Derive = create with `derivedFromId`: must be a monster that is global or in `ctx.campaignId`, else `not_found`. The request carries the full stat block; the server copies nothing. The result is independent: later edits or deletion of the base never change it. | ADR-0009 |
| FR-ENT-10 | Create character: `ownerPlayerId` must be a player of `ctx.campaignId`; `hpCurrent = hpMax`. MVP callers: fixtures only (no UI, decisions #100). | |
| FR-ENT-11 | Update replaces name, portrait, stat block and (characters) owner as a whole. Kind, campaign, provenance and `derivedFromId` are immutable. Character with `hpCurrent > hpMax` after update → clamped in the same transaction. Instance state is never touched. | OQ-ENT-10 |
| FR-ENT-12 | `resolveDefinition(ctx, id)` (server) returns a definition that is global or in `ctx.campaignId`, else `not_found`. Every command that stores a definition reference (entities, scenes-map, combat-tracker) uses it. | ADR-0018 |
| FR-ENT-13 | Instances store only the definition id, never stat-block fields. `effectiveStats(definition, instance)` in `@shared/entities` is the one way to read stats; MVP returns the definition's block unchanged. | Modifiers hook, tier A |
| FR-ENT-14 | *(proposed, OQ-ENT-07)* Delete: custom monsters only, while nothing references them (DB FK restrict from instance tables) → else `conflict` "In use". Characters cannot be deleted in MVP. | ADR-0009 open row |
| FR-ENT-15 | Visibility `entity`: DM full. Player: own character (`ownerPlayerId = ctx.playerId`) full; other characters redacted to `{id, kind, name, portraitAssetId, ownerPlayerId}`; monsters hidden. | OQ-ENT-05 |
| FR-ENT-16 | Visibility `imported-entity`: DM full; players hidden. | OQ-ENT-05 |
| FR-ENT-17 | Every command commits row + event-log entry in one transaction, then emits its domain event (§9). IDs and timestamps come only from `ctx.ids` / `ctx.clock`. | ADR-0016, 0022 |
| FR-ENT-18 | DM Creatures window lists every definition the campaign can use: characters, customs, imported. Updates live ≤ 1 s after commit. Rows are drag sources carrying the definition id. | OQ-ENT-03 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md); window hosted by [play-shell](play-shell.md)'s registry.

- **DM view — Creatures window:** shadcn Table + Tabs (All / Characters / Monsters). Row: portrait thumb, name, kind, source Badge (`SRD` / `Custom` / owner name for characters), CR + XP (monsters). Imported rows show a lock icon, Tooltip "Read-only — derive to customise". Customs with a base show "derived from Goblin" (muted).
  - Combat-tracker adds New / Derive / Edit actions to this window in Phase 3; scenes-map handles drop onto the canvas.
  - Test IDs: `ent-list`, `ent-list-tab-<all|character|monster>`, `ent-list-row` + `data-record-id`, `ent-list-row-lock`.
- **States:** empty "No creatures yet"; loading skeleton; disconnected: last list stays, live-sync banner.
- **Player view:** no entities UI. Own character is shown by [character-sheet](character-sheet.md); token labels come from instances ([scenes-map](scenes-map.md)).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Entity | id | ID | `ctx.ids` |
| | kind | `character` \| `monster` | Immutable; later kinds add to the registry |
| | campaignId | ID → Campaign \| null | Null iff imported (FR-ENT-04) |
| | name | text | 1–60 |
| | portraitAssetId | ID → Asset \| null | Same campaign; always null for imported ([OQ-ASSET-04](assets-pipeline.md#15-open-questions)) |
| | statBlock | **JSON leaf** | Per-kind schema below |
| | ownerPlayerId | ID → Player \| null | Required for character, null for monster |
| | hpCurrent | int \| null | Character only: PC HP lives on the character (ADR-0009). OQ-ENT-08 |
| | derivedFromId | ID → Entity \| null | Informational; FK `on delete set null` |
| | source, sourceKey, licence, attribution | text \| null | Provenance; unique `(source, sourceKey)` |
| | importedAt, createdAt, updatedAt | timestamp | `ctx.clock`; `importedAt` null for customs |

**Stat block** (strict; new fields only ever added as optional)

| Field | Kinds | Type |
|---|---|---|
| size | both | `tiny` \| `small` \| `medium` \| `large` \| `huge` \| `gargantuan` |
| ac | both | int 0–30 |
| hpMax | both | int 1–999 |
| initBonus | both | int −10…+20 |
| attacks | both | 0–8 × `{name 1–40, toHit int −10…+30, damage "NdM±K", damageType?}`; dice: N 1–20, M ∈ 4/6/8/10/12/20/100, K 0–30, a subset of [dice-roll-log](dice-roll-log.md)'s grammar; damageType = a 5e damage type. MVP UI uses the first |
| cr | monster | `"0"`, `"1/8"`, `"1/4"`, `"1/2"`, `"1"`…`"30"` |
| level, className | character | int 1–20; text 0–40 |

- **Relations:** Campaign 1—* Entity (custom, character); Player 1—* character; Entity 1—* instances (token, combatant, encounter entry; owned by scenes-map / combat-tracker, FK restrict); derived → base (informational).
- **Derived values:** `readOnly`, `xp`, `effectiveStats` (FR-ENT-03, 05, 13). Computed in `@shared`, not sent.
- **Persisted runtime state:** character `hpCurrent`. Everything else is prep data.
- **Design for later:** non-creature kinds register their own schema (partial data allowed, ADR-0009); modifiers live on instances (ADR-0009 open row); notes column for world-builder.

## 9. API & events

**REST (Hono RPC)** — prep CRUD ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) D); prefix per [OQ-CAMP-15](campaign-management.md#15-open-questions). No GET: the snapshot carries the records.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/entities` | DM | `entities.create {kind, name, portraitAssetId?, statBlock, derivedFromId?, ownerPlayerId?}` |
| PUT | `/api/entities/:id` | DM | `entities.update` (FR-ENT-11) |
| DELETE | `/api/entities/:id` | DM | `entities.delete` (FR-ENT-14) |

**WS intents / signals:** none. **Internal command:** `entities.import` (pipeline only, FR-ENT-06).

**Record types** (generic record changes `{type, id, op, data}` + `cause`)

| Type | Scope | Data | Visibility rule | Snapshot |
|---|---|---|---|---|
| `entity` | campaign | Row minus provenance (always null) | FR-ENT-15 | Campaign's characters + customs |
| `imported-entity` | global | Row incl. provenance | FR-ENT-16 | All imported definitions |

**Domain events** (none transient, none undoable; entities adds no listeners)

| Event | Changes | Logged |
|---|---|---|
| `EntityImported {entityId, source, sourceKey}` | `imported-entity` upsert | yes, `campaignId` null |
| `EntityCreated {entityId, kind, derivedFromId?}` | `entity` upsert | yes |
| `EntityUpdated {entityId}` | `entity` upsert (before/after; owner change flips who sees it full) | yes |
| `EntityDeleted {entityId}` | `entity` delete | yes |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create custom monster / derive | ✓ | ✗ | DM credential; FR-ENT-08, 09 |
| Create character | ✓ (fixtures in MVP) | ✗ | Owner is a player of `ctx.campaignId` |
| Update custom monster or character | ✓ | ✗ (own-sheet edits: [OQ-CHAR-03](character-sheet.md#15-open-questions)) | Not imported (FR-ENT-07); `resolveDefinition` |
| Update / delete imported | ✗ | ✗ | `forbidden` |
| Delete custom monster | ✓, unreferenced | ✗ | FK restrict → `conflict` |
| Receive records | full | own character full; others redacted; monsters hidden | FR-ENT-15, 16 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** fresh snapshot; own character incl. `hpCurrent` current. Owner reassigned meanwhile → snapshot reflects it.
- **DM disconnect / reconnect:** REST commands don't depend on the WS. Lost response → retry of create hits the name rule (`conflict`), never a duplicate.
- **Server crash mid-action:** one transaction per command (row + log): all or nothing. Import batch all-or-nothing (FR-FIX-19). After restart, snapshots equal pre-crash state.
- **Concurrent edits:** two DM tabs update one definition → last commit wins (whole-block replace, no merge). Base deleted while a derive is in flight → `not_found`.
- **Edit during combat:** combatants show new stats at once (FR-ENT-13); combat log keeps the effective values used at the time (ADR-0009). Combatant HP above a lowered max: combat-tracker's call (OQ-ENT-10).
- **Campaign switch:** customs of the old campaign leave the DM store with the reconnect; `resolveDefinition` rejects them in the new one.
- **Invalid / malicious input:** strict zod (unknown keys, bounds, dice grammar); names rendered as text; a player hitting entity routes → 401; spoofed `campaignId`/`source` fields → `invalid` (not in schema).

## 12. Performance & bandwidth

- MVP: ≤ ~20 definitions per campaign, ≤ 2 KB each → ≤ 40 KB of snapshot. Edits are rare (prep); events ≤ 2 KB.
- Post-MVP compendium (hundreds of imported definitions) would bloat the DM snapshot: it should move `imported-entity` to on-demand REST queries. Noted for [compendium](post-mvp/compendium.md).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

**Fixtures** (owner entities; values from [fixtures-adapters §8](fixtures-adapters.md#8-data-model))

| Key | Kind | Contents |
|---|---|---|
| `enemy-1` | reference | `srd/monster/goblin.ts`: small, AC 15, HP 7, init +2, scimitar +4 / 1d6+2 slashing, CR 1/4. Source `fixture`, SRD 5.1 CC BY 4.0 attribution |
| `enemy-2` | reference | `srd/monster/wolf.ts`: medium, AC 13, HP 11, init +2, bite +4 / 2d4+2 piercing, CR 1/4 |
| `enemy-custom` | setup | `entities.create` derived from `enemy-1`: "Elite Goblin Warrior", AC 16, HP 15, scimitar +5 / 1d6+3, CR 1/2 |
| `char-mira` | setup | "Mira", owner `player-1`, medium, L1 fighter, AC 16, HP 12/12, init +2, shortsword +4 / 1d6+2 piercing |
| `char-thorn` *(new)* | setup | "Thorn", owner `player-2`, L1 rogue, AC 14, HP 10/10, init +3, dagger +5 / 1d4+3 piercing |
| `enemy-custom-second` *(new)* | setup | In `campaign-second`: activate it, create "Marsh Troll" from scratch (large, AC 15, HP 59, claw +7 / 2d6+4, CR 5), re-activate Fixture Campaign |

- **Bundle `entities`** = `base` + `player-2` + `campaign-second` + all six above. `enemy-1`, `enemy-2`, `enemy-custom`, `char-mira` also join `session-sim` (FR-FIX-25).

| Level | What | Fixtures |
|---|---|---|
| Unit | Schemas: bounds, strict keys, dice grammar, CR enum; XP table; `effectiveStats` identity; visibility matrix (DM / owner / other player × character / custom / imported) | In-code |
| Integration | Each command: row + log + event, IDs from `ctx`; rollback → none. Read-only `forbidden`, no event. Derive cross-campaign → `not_found`; base edit leaves derived unchanged. Name `conflict`. `hpCurrent` clamp. Owner change: old owner gets redacted upsert, new owner full. Delete blocked by a referencing row. **Leak scan:** `player-1` frames never contain "Elite Goblin Warrior", "Marsh Troll", "Goblin" or Thorn's `1d4+3`; restart → identical snapshots | `entities` |
| E2E (thin) | DM list rows; `player-1` WS frames (`page.on('websocket')`) hold Mira full, no monster records; restart | `entities` |

**Browser walkthrough** — `bun run build`, `fixtures:reset-load entities --profile verify`, `start --profile verify`. Contexts: A + A2 DM, B `player-1`, C `player-2`. The form ships in Phase 3, so DM edits are REST calls from A's page (`fetch` with the stored secret). Player evidence: WS frames captured via Playwright; if the MCP can't, attach the E2E leak spec's frame log.

| # | DM (A, A2) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in; open Creatures | — | Mira (Player 1), Thorn (Player 2), Goblin + Wolf (SRD, lock, CR 1/4, 50 XP), Elite Goblin Warrior (Custom, derived from Goblin, CR 1/2, 100 XP). No Marsh Troll |
| 2 | — | B, C open links | B: Mira full, Thorn name only, no monsters. C: the reverse |
| 3 | PUT Goblin | — | 403 read-only message; nothing changes anywhere |
| 4 | PUT Elite Goblin Warrior HP 20; POST derive "Goblin Boss" from Goblin | — | A2 updates ≤ 1 s; B, C get no frame |
| 5 | PUT Mira name "Mira Vale" | — | B sees full upsert, C redacted upsert, ≤ 1 s |
| 6 | Reload all; then kill + restart server | — | All reconnect; state includes steps 4–5 |
| 7 | Switch to Second Campaign, then back | — | List: Marsh Troll + SRD only, then step-6 list. No console errors throughout |

Teardown: stop server, `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0009, 0012, 0015, 0016, 0018, 0021, 0022 | Model, stored basics, pipeline, events, scope, sync, seams | accepted |
| [live-sync](live-sync.md), [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | `global` scope, visibility fns, REST → same events; players, `ctx.campaignId`; pipeline calls `entities.import` | complete |
| [assets-pipeline](assets-pipeline.md), [play-shell](play-shell.md) | Asset id + campaign scope, portrait access (OQ-ASSET-01/04); window registry | Phase 2, open |
| [scenes-map](scenes-map.md), [combat-tracker](combat-tracker.md), [character-sheet](character-sheet.md), [dice-roll-log](dice-roll-log.md) | Use `resolveDefinition` + FK restrict; form calls `entities.create/update`; additive character fields + `hpCurrent` commands; dice grammar superset | Phase 2–3, open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ENT-01, 02 | ~~Content model; one definition per kind~~ **Decided:** [ADR-0009](../architecture/adr/0009-entity-content-model.md) | — | — | — |
| OQ-ENT-03 | Entities UI in MVP | **Read-only DM Creatures list (drag source); form = combat-tracker; characters fixtures-only** (one list for both callers) / no entities UI, each feature builds a picker (duplication) | no (owner: spec-entities) | scenes-map, combat-tracker, play-shell |
| OQ-ENT-04 | Do characters and monsters share the basics shape? | **Yes, one creature core (§8)** (one contract for combat) / separate per kind (combat branches on kind) | yes | character-sheet, combat-tracker |
| OQ-ENT-05 | What do players see of definitions? | **Own character full; other characters redacted; monsters (custom + imported) hidden** (no prep leak; instances carry display data) / monsters name-only (leaks prepared customs) / all full. [Proposed ADR](../architecture/adr/proposed-definition-visibility.md) | yes | scenes-map, combat-tracker, character-sheet |
| OQ-ENT-06 | Record types for two scopes | **Two types, one schema: `entity` (campaign), `imported-entity` (global)** (fits the registry as is) / one type with per-record scope (registry change) | no (owner: spec-entities) | live-sync |
| OQ-ENT-07 | Delete a custom definition in use (ADR-0009 open row) | **Custom monsters only; blocked while referenced (FK restrict → `conflict`)** (safe, cheap) / no delete in MVP / cascade (destroys prep) | no (owner: spec-entities) | scenes-map, combat-tracker |
| OQ-ENT-08 | Where PC current HP lives | **`hpCurrent` column on `entity` (character only); HP commands owned by combat-tracker / character-sheet** (one row per PC) / separate character-state table | no (owner: character-sheet) | character-sheet, combat-tracker |
| OQ-ENT-09 | Player-visible instance data, given monster definitions are hidden | **Instances carry display name, image and size; scenes-map refreshes size via an `EntityUpdated` listener** (keeps live link) / size copied at placement (stale after edits) | no (owner: scenes-map) | scenes-map, combat-tracker |
| OQ-ENT-10 | Combatant HP above a lowered `hpMax` | **Combat-tracker clamps in an `EntityUpdated` listener** / leave until healed | no (owner: combat-tracker) | combat-tracker |
| OQ-ENT-11 | XP for CR 0 (SRD: "0 or 10") | **10** (DMG table) / 0 / stored per definition | no (owner: combat-tracker) | combat-tracker |
| OQ-ENT-12 | Answers to fixtures-adapters | **OQ-FIX-15: inline (FR-ENT-05). OQ-FIX-19: entities ships `entities.create` incl. derive and `enemy-custom` in Phase 2; combat-tracker ships the form. Shape owners as listed; `char-mira` record = entities, sheet fields = character-sheet** | no (owner: spec-entities) | fixtures-adapters, combat-tracker, character-sheet |
| OQ-ENT-13 | Glossary: **Entity** says "campaign-owned" and "content model is open" | **"A world record (character, monster; later npc, item…). Customs and characters belong to one campaign; imported definitions are global ([ADR-0018](../architecture/adr/0018-global-imported-content.md)). Model: [ADR-0009](../architecture/adr/0009-entity-content-model.md)"** / keep | no (owner: integrator) | glossary |

## 16. Out of scope

- See §4. Instance records → [scenes-map](scenes-map.md), [combat-tracker](combat-tracker.md). Modifiers → [combat-extras](post-mvp/combat-extras.md). Re-import ([OQ-FIX-18](fixtures-adapters.md#15-open-questions)) → [compendium](post-mvp/compendium.md).
