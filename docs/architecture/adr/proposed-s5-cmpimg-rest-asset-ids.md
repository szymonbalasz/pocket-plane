# 00xx — Asset IDs in compendium REST bodies

- Status: accepted (DM, sprint-5 gate 1, [#256](../../decisions-log.md); OQ-ASSET-17 A). Integrator numbers it at merge.
- Date: 2026-10-18
- Amends: [ADR-0023](0023-asset-access-by-capability-id.md) (Decision, "Secrecy" row)
- Affects: [assets-pipeline](../../specs/assets-pipeline.md) (FR-ASSET-12, FR-ASSET-35–38), [compendium](../../specs/compendium.md) (FR-CMP-45–53); [ADR-0046](0046-compendium-scope.md) (delivery 1: entries over REST)
- Raised by: [OQ-ASSET-17](../../specs/assets-pipeline.md#15-open-questions)

## Context

- DM [#250](../../decisions-log.md) [10]: homebrew compendium entries get images; players see them in shared entries.
- ADR-0023 Secrecy: "A player receives an asset ID only as a field of a record it may see." FR-ASSET-12 adds "never in a REST body".
- ADR-0046 delivers compendium entries over REST (`GET /api/compendium/entries/:id`, search), never on the WS, with one pure visibility fn `entryVisibleTo` checked before any body or `304` is built, on the player's own credential (`Authorization: Player`), `Cache-Control: private, no-cache`.
- Entries are not a record type, so "a record it may see" doesn't cover an entry's image IDs.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Compendium REST bodies may carry asset IDs, only when `entryVisibleTo` lets the reader read the entry** | Same guarantee as the sync rule: a pure visibility fn per reader, checked before the body; no new path; 0 B snapshot | A second place (besides the WS filter) where IDs leave the server; must be leak-tested over REST |
| B. Entry images as a lazy record type loaded with `sync.load` | IDs stay WS-only | A second read path for one field; per-entry visibility in the WS filter; client stitches REST + WS |
| C. Image route behind the player credential | IDs never leave for players | `<img>` and Konva can't send headers; ADR-0023 rejected this (its option B) |

## Decision

**A** (DM, #256). ADR-0023's Secrecy row becomes: "A player receives an asset ID only as a field of a record it may see, **or in a compendium REST response for an entry that compendium's `entryVisibleTo` lets that player read** (never in its errors or `304`s)."

## Consequences

- FR-ASSET-12 gains the exception (FR-ASSET-36); no other REST route may return asset IDs to players without its own amendment.
- The asset leak property also scans player compendium REST bodies (FR-ASSET-38) and headers: the entry `ETag` is an opaque hash over the delivered IDs, never the IDs themselves.
- Only the compendium entry read is covered; handout images stay record fields delivered by sync (FR-ASSET-12 as written).
- Unshare / delete works like a hide: the next fetch omits the IDs; IDs already learned keep working (ADR-0023, accepted).
- Glossary "Asset reference" widens to compendium entry fields (OQ-ASSET-20).
