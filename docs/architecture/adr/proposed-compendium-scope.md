# Proposed — Compendium: global library, campaign clones, read on demand

- Status: proposed (sprint 3, spec-compendium; accept at sprint-3 DM gate 1). Completes [ADR-0010](0010-compendium-design.md) (scope); the integrator numbers it
- Date: 2026-10-16
- Refines: [ADR-0010](0010-compendium-design.md) (scope A / B / C), [ADR-0018](0018-global-imported-content.md) (global imports), [ADR-0015](0015-source-adapters-fixtures.md) (pipeline: in-place update), [ADR-0021](0021-sync-protocol-conventions.md) C (snapshot scope)
- Depends on: [proposed lazy record types](proposed-lazy-record-types.md) (party-board; the one on-demand path, global scope + id loads, per the sprint-3 seams ruling S1)
- Affects: [compendium](../../specs/compendium.md), [entities](../../specs/entities.md), [fixtures-adapters](../../specs/fixtures-adapters.md), [live-sync](../../specs/live-sync.md), [combat-tracker](../../specs/combat-tracker.md), [combat-extras](../../specs/combat-extras.md), [character-sheet-full](../../specs/character-sheet-full.md), [protocol](../../protocol/README.md) §2, §5

## Context

- ADR-0010 left scope open; ADR-0018 already made imported definitions global and customs per campaign.
- SRD 5.1 is 1,127 entries (322 monsters, 319 spells, 292 items, 15 conditions, 179 class features), 1.73 MB of text (measured from Open5e v1, `wotc-srd`).
- CON-44: heavy DM snapshot 676,030 B of 786,432 B (re-checked at the seams pass). Today's `imported-entity` provider sends every imported definition: all 322 SRD monsters → +341,079 B (measured), over the ceiling. One imported definition ≈ 1,058 B.

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
| 2. Snapshot holds only referenced / pinned imported definitions | Few client changes | ≈ 1 KB per used monster (20 ≈ 21 KB measured) on a sprint already past the 100 KiB guard (seams S2); grows with the campaign |
| 3. Everything in the snapshot | No new path | +341 KB for monsters alone; impossible |

## Decision

> TODO (DM gate 1): suggested **A + 1**.

## Consequences (if A + 1)

| Topic | Rule |
|---|---|
| Records | `compendium_source` and `compendium_entry` (global imported, or campaign homebrew); monster entries link an imported `entity` (the creature definition) |
| Edits | Imported entries read-only (ADR-0010 i). Monsters: derive a custom (ADR-0009). Other kinds: clone into a campaign homebrew entry, independent, no link |
| Snapshot | No compendium data. `imported-entity` is lazy (`sync.load {type, ids}`), DM only |
| Reads | REST `/api/compendium/search`, `/entries/:id`; one pure `entryVisibleTo`: players never get monsters, unshared homebrew or other campaigns' homebrew. Players authenticate with their link token on these routes |
| Import | Bundled recorded source (SRD 5.1 via Open5e), DM-triggered, one transaction, idempotent; changed upstream rows update in place (closes ADR-0015's open row / OQ-FIX-18); customs, clones and sheets never change |
| Pipeline | Per-kind stores (entities: `monster`; compendium: the other kinds); outcomes `created` / `updated` / `existing`; `cmp.import` is the one routed caller and takes a source key, never client data (amends FR-FIX-24) |
| ADR-0010 | Status → accepted (scope A) when this is accepted; "Consequences" points here |
