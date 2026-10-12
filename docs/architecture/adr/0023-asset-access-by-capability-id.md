# 0023 — Asset access by capability ID

- Status: accepted (2026-10-12; decisions-log #123)
- Date: 2026-10-12
- Affects: [assets-pipeline](../../specs/assets-pipeline.md), [live-sync](../../specs/live-sync.md), [campaign-management](../../specs/campaign-management.md), [scenes-map](../../specs/scenes-map.md), [entities](../../specs/entities.md); later handouts ([party-board](../../specs/post-mvp/party-board.md)), preload ([scene-tools](../../specs/post-mvp/scene-tools.md))
- Extends: [ADR-0005](0005-server-authoritative-sync.md), [ADR-0019](0019-auth-credentials.md), [ADR-0021](0021-sync-protocol-conventions.md), [ADR-0022](0022-deterministic-seams.md). Raised by OQ-ASSET-01.

## Context

- Images travel over HTTP, not WS, so the visibility filter does not cover them. An inactive battlemap or a hidden token's art must not be fetchable by players.
- `<img src>` and Konva images can't send headers; ADR-0019 sends the DM secret per request (`Authorization: Bearer`, CON-08) and keeps the player token in the page URL. No player REST credential exists.
- A player who has seen an ID has already seen the bytes; browsers keep them after a hide under any option.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. Credential header + server check "asset referenced by a record the caller may see"; fetch → object URL | Also stops IDs leaked outside sync | Player REST credential; asset-reference registry change in shared code mid-skeleton; per-request check; custom loader. A visibility bug that leaks an ID also authorises it |
| B. Link token in the asset path for players; header for DM | Native `<img>` for players | Token in every asset URL; two routes; same check cost as A |
| C. Asset ID as capability, IDs from `ctx.ids` | Simplest | ID secrecy depends on unspecified ID entropy |
| **C′. Unguessable asset IDs (128-bit, `ctx.tokens`) as capability; players learn IDs only via the filtered sync; `Cache-Control: private`; originals never served** | Same practical guarantee as A for unseen assets; native `<img>` / Konva loading; no registry change, no player credential | IDs leaked outside sync work until a post-MVP revoke; seeded fixture IDs predictable (never tunnelled, ADR-0022) |

## Decision

**C′** (DM, #123).

| Rule | Detail |
|---|---|
| Capability | `GET /api/assets/:id/:file` (`thumb` \| `display`) needs no credential. Served iff the asset exists in the active campaign; every denial is the same 404 |
| ID | 128 bits from `ctx.tokens`, base64url. Real IDs always CSPRNG; seeded only in fixture load and tests (ADR-0022) |
| Secrecy | A player receives an asset ID only as a field of a record it may see. Owning specs' visibility fns drop or redact asset-ID fields otherwise |
| Caching | `Cache-Control: private, max-age=31536000, immutable`. An edge copy would be served without the active-campaign check, so responses are never shared-cacheable |
| Uploads | `POST /api/assets` is DM only (`Bearer`, CON-08) |

## Consequences

- No change to live-sync's registry or campaign-management's credentials; ADR-0019 transport unchanged.
- Commands setting an asset-ID field validate same-campaign ownership (`assets.require`), including copies propagated in the same transaction (#120).
- Data model: Asset `id` comes from `ctx.tokens`, not `ctx.ids`.
- Bytes and IDs already delivered keep working after a hide; accepted. A leaked ID can't be revoked in MVP (re-key with the tier-A library).
- Preloading an inactive scene would reveal its IDs early; it needs a player-visible preload grant (post-MVP). ADR-0003's "preloaded" is deferred by ADR-0014; to be confirmed with the DM.
