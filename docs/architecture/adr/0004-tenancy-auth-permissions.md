# 0004 — Tenancy, auth and permissions

- Status: accepted
- Date: 2026-10-10
- Affects: all specs

## Context

- One DM, a known group of players. Accounts and role frameworks are overhead.

## Decision

**Tenancy**
- **Campaign** is the top-level scope. Every record belongs to exactly one campaign.

**Auth**
- No user accounts.
- **DM secret** grants DM access.
- **Player links**: one per player, bound to a player name within a campaign.

**Permissions**
- Enforced primarily by **two separate clients**: DM client and player client.
- Server performs **minimal ownership checks** on player-writable actions (e.g. move own token, edit own character).
- No roles, no ACL framework.
- Server never sends DM-only data to player connections ([ADR-0005](0005-server-authoritative-sync.md) visibility filter).

## Consequences

- Each spec lists its player-writable actions and the ownership rule for each.
- A leaked player link = that player's access. Revocation/rotation **not planned** (tier F, trusted table — [feature tiers](../../feature-tiers.md#5-dm-tools)).
- Compendium may be shared across campaigns — scope is open in [ADR-0010](0010-compendium-design.md).
- **Refined by [ADR-0018](0018-global-imported-content.md):** imported definitions are global; custom definitions stay per campaign.

> Amended by [ADR-0046](0046-compendium-scope.md) (#207): global `compendium_source` / `compendium_entry` rows are a second exception to "every record belongs to one campaign".
