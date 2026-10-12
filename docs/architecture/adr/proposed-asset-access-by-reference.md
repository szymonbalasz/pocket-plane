# NNNN — Asset access by reference

- Status: proposed
- Date: 2026-10-12
- Affects: [assets-pipeline](../../specs/assets-pipeline.md), [live-sync](../../specs/live-sync.md), [campaign-management](../../specs/campaign-management.md), [scenes-map](../../specs/scenes-map.md), [entities](../../specs/entities.md); later handouts ([party-board](../../specs/post-mvp/party-board.md))
- Extends: [ADR-0005](0005-server-authoritative-sync.md), [ADR-0019](0019-auth-credentials.md), [ADR-0021](0021-sync-protocol-conventions.md). Raised by OQ-ASSET-01.

## Context

- Images travel over HTTP, not WS, so the visibility filter does not cover them. An inactive battlemap or a hidden token's art must not be fetchable by players, even with a guessed or leaked ID.
- `<img src>` can't send headers; ADR-0019 sends the DM secret per request and keeps the player token in the page URL. No player REST route except `/api/join/:token` exists yet.
- Responses pass through Cloudflare; a shared cache must never serve one caller's image to another.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Credential header on one route + reference check; clients load via fetch → object URL** | No credential in asset URLs; one route for both roles; same auth as REST | Shared client loader; defines a player credential for REST |
| B. Link token in the asset path for players; header for DM | Native `<img>` for players; mirrors `/api/join/:token` | Token in every asset URL; two routes; DM still needs fetch |
| C. Asset ID as capability, no check | Simplest; edge-cacheable | Any ID ever seen or leaked works forever, for anyone reaching the tunnel |

**Reference check** (with A or B): a player may fetch an asset iff its ID appears in an **asset reference** field of a record that a fresh snapshot for that player would contain: same scope rules and visibility fns as live-sync, evaluated per request against committed state.

## Decision

> Undecided. Suggested: **A** with the reference check.

## Consequences

- live-sync's record-type registration gains an optional list of asset-reference fields (shared file `src/server/ws/`, via the orchestrator). Visibility fns are unchanged; the check reuses snapshot providers and fns.
- campaign-management: REST routes accept a player credential (link token) in the same header scheme as the DM secret, typed so player credentials never count toward the DM throttle (FR-CAMP-05).
- Asset responses: `Cache-Control: private, …, immutable`, `Vary` on the credential header; every denial is the same 404.
- Commands setting a reference validate same-campaign ownership (`assets.require`).
- Bytes already delivered stay in the player's browser after a hide; accepted (they were legitimately seen).
