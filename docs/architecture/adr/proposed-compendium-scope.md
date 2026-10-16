# 0046 — Compendium: global library, campaign clones, read on demand

- Status: accepted (#207, 2026-10-16). Completes [ADR-0010](0010-compendium-design.md) (scope; ADR-0010 becomes accepted, scope A). Number 0046; the integrator renames the file
- Date: 2026-10-16
- Amends: [ADR-0004](0004-tenancy-auth-permissions.md) (a second exception to "every record belongs to one campaign": global `compendium_source` / `compendium_entry`), [ADR-0018](0018-global-imported-content.md) (scope table row: imported compendium entries, not only definitions), [ADR-0019](0019-auth-credentials.md) (player REST header `Authorization: Player <link token>` on compendium routes). Accepted by the DM at sprint-3 gate 1 (#207; compendium OQ-CMP-25)
- Refines: [ADR-0010](0010-compendium-design.md) (scope A / B / C), [ADR-0018](0018-global-imported-content.md) (global imports), [ADR-0015](0015-source-adapters-fixtures.md) (pipeline: in-place update), [ADR-0021](0021-sync-protocol-conventions.md) C (snapshot scope)
- Depends on: [ADR-0045](0045-lazy-record-types.md) lazy record types (party-board; the one on-demand path, global scope + id loads, per the sprint-3 seams ruling S1)
- Affects: [compendium](../../specs/compendium.md), [entities](../../specs/entities.md), [fixtures-adapters](../../specs/fixtures-adapters.md), [live-sync](../../specs/live-sync.md), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [character-sheet-full](../../specs/character-sheet-full.md), [protocol](../../protocol/README.md) §2, §5

## Context

- ADR-0010 left scope open; ADR-0018 already made imported definitions global and customs per campaign.
- SRD 5.1 is 1,127 entries (322 monsters, 319 spells, 292 items, 15 conditions, 179 class features), 1.73 MB of text (measured from Open5e v1, `wotc-srd`).
- CON-44: heavy DM snapshot 676,030 B of 786,432 B (re-checked at the seams pass). Today's `imported-entity` provider sends every imported definition: all 322 SRD monsters → +341,079 B (measured), over the ceiling. One imported definition ≈ 1,058 B. (Gate 1 raised the DM ceiling to 1 MiB, #208; all monsters on the sprint-3 base, ≈ 1,053 KB, still exceed it.)

## Options

**Scope**

| Option | Pros | Cons |
|---|---|---|
| **A. Global library + campaign clones** (monsters: derive; other kinds: homebrew copy) | One import serves all campaigns; ADR-0018 already says so | ADR-0004 exception (already made by ADR-0018) |
| B. Per-campaign import | Pure ADR-0004 | 1,127 rows × campaigns; re-import per campaign |
| C. Global + per-campaign overlay patches | No copies | Merge logic; harder to reason about; ADR-0010 i already chose immutable sources |

**Getting content to clients**

| Option | Pros | Cons |
|---|---|---|
| **1. Entries over REST (search / get, per-role filter); imported definitions as a lazy record type loaded by ids** | 0 B snapshot at any library size; search + paging; `ETag` caching over the tunnel | Six DM call sites move to a `useDefinitions` hook; lookups search the server; players need a REST credential |
| 2. Snapshot holds only referenced / pinned imported definitions | Few client changes | ≈ 1 KB per used monster (20 ≈ 21 KB measured) on a sprint then past the 100 KiB guard (seams S2; guard dropped by #208); grows with the campaign |
| 3. Everything in the snapshot | No new path | +341 KB for monsters alone; impossible |

## Decision

**A + 1** (DM, sprint-3 gate 1, #207):

- Scope **A**: one global library of imported entries; campaigns edit by cloning (other kinds) or deriving (monsters) into independent campaign records.
- Delivery **1**: entries over REST with a per-role filter; imported creature definitions as a lazy record type loaded by ids ([ADR-0045](0045-lazy-record-types.md)).
- The three amendments (ADR-0004, ADR-0018, ADR-0019) as listed above.

## Consequences

| Topic | Rule |
|---|---|
| Records | `compendium_source` and `compendium_entry` (global imported, or campaign homebrew); monster entries link an imported `entity` (the creature definition) |
| Edits | Imported entries read-only (ADR-0010 i). Monsters: derive a custom (ADR-0009). Other kinds: clone into a campaign homebrew entry, independent, no link |
| Snapshot | No compendium data. `imported-entity` is lazy (`sync.load {type, ids}`), DM only |
| Reads | REST `/api/compendium/search`, `/entries/:id`; one pure `entryVisibleTo`: players never get monsters, unshared homebrew or other campaigns' homebrew. Players authenticate with `Authorization: Player <link token>` on these routes only (route-local; amends ADR-0019). Visibility before `304`; `Cache-Control: private, no-cache` |
| Import | Bundled recorded source (SRD 5.1 via Open5e, filtered to `wotc-srd` at recording time; CC BY 4.0 attribution, Open5e as provenance), DM-triggered, one transaction, idempotent, refused while an encounter is started; changed upstream rows update in place (closes ADR-0015's open row / OQ-FIX-18), instance changes logged per campaign; customs, clones and sheets never change |
| Tenancy | Global imported rows (`compendium_source`, imported `compendium_entry`, imported definitions) are the exceptions to ADR-0004's one-campaign rule; homebrew entries are campaign-scoped (amends ADR-0004, ADR-0018) |
| Pipeline | Per-kind stores (entities: `monster`; compendium: the other kinds); outcomes `created` / `updated` / `existing`; `cmp.import` is the one routed caller and takes a source key, never client data (amends FR-FIX-24) |
| ADR-0010 | Status → accepted (scope A) when this is accepted; "Consequences" points here |
