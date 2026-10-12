# NNNN — Several campaigns, one active per server

- Status: proposed (DM decision D1 at the Phase 1 gate; integrator numbers it)
- Date: 2026-10-11
- Affects: campaign-management, live-sync, all specs (campaign scoping)
- Extends: [ADR-0004](0004-tenancy-auth-permissions.md)

## Context

- ADR-0004 makes the campaign the top-level scope. The DM runs a few campaigns from day one (decisions-log #108).
- Every connection, snapshot and DM command needs one unambiguous campaign scope.
- Raised as OQ-CAMP-04 in [campaign-management](../../specs/campaign-management.md#15-open-questions).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Several campaigns; one active per server (persisted `Campaign.active`, at most one); DM switches** | One scope for the DM client and snapshots; survives a crash | Switching disconnects the old campaign's players |
| B. Several live; each connection scoped by its own campaign | No global state | DM client needs per-tab scoping; every DM route takes a campaign |
| C. One campaign only, no switching | Least code | DM can't keep several campaigns |

## Decision

**A.** Several campaigns; exactly one is active at a time; the DM creates campaigns and switches the active one.

## Consequences

- A connection's `campaignId` is fixed for its life. Player connections are scoped by their link's campaign; DM connections by the campaign active at `hello`.
- Switch = one transaction flipping the flags, then the server closes every connection of the previous campaign with the retryable close reason `campaign-inactive` (code owned by live-sync). No connection is re-snapshotted into another campaign.
- Player client: waiting screen, keeps retrying, joins when that campaign is active again. DM client: reconnects into the new active campaign.
- The DM's campaign list is REST-only; no WS message carries another campaign's data.
- live-sync snapshot scope = the connection's campaign (fits [OQ-SYNC-03](../../specs/live-sync.md#15-open-questions)).
