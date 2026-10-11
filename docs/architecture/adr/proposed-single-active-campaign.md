# NNNN — One active campaign per server

- Status: proposed
- Date: 2026-10-11
- Affects: campaign-management, live-sync, all specs (campaign scoping)
- Extends: [ADR-0004](0004-tenancy-auth-permissions.md)

## Context

- ADR-0004 makes the campaign the top-level scope. The DB may hold several campaigns (real + test).
- Every connection, snapshot and DM command needs one unambiguous campaign scope.
- Raised as OQ-CAMP-04 in [campaign-management](../../specs/campaign-management.md#15-open-questions).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One active campaign per server, persisted `Campaign.active` flag (at most one)** | One scope for the DM client and snapshots; survives a crash; no server-scope table | Switching disconnects the old campaign's players |
| B. Several live; each connection scoped by its own campaign | No global state | The DM client needs per-tab scoping; every DM route takes a campaign |

## Decision

> Undecided. Suggested: **A**.

## Consequences

- DM commands are scoped to the active campaign. Player connections are scoped by their link's campaign.
- Player links of inactive campaigns are rejected with reason `campaign-inactive` and get a waiting screen.
- live-sync snapshot scope = active campaign (fits the [OQ-SYNC-03](../../specs/live-sync.md#15-open-questions) pick).
