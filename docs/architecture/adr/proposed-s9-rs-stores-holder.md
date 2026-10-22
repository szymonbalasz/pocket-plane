# Proposed — A stronghold's Stores as a holder in the loot / inventory ledger

- Status: proposed (sprint 9, track RS; integrator numbers it at merge)
- Date: 2026-10-22
- Extends: [party-loot](../../specs/party-loot.md) (derived pot / wallets, FR-LOOT-09), [party-board](../../specs/party-board.md) (party inventory, item moves logged as loot entries); [ADR-0024](0024-definition-visibility.md) copy rule
- Affects: [party-loot](../../specs/party-loot.md) FR-LOOT-30–39, [party-board](../../specs/party-board.md) FR-PARTY-17–23, -77, [strongholds](../../specs/strongholds.md) FR-HOLD-19, -21, -28, [protocol](../../protocol/README.md), [data model](../../data-model/README.md)
- Raised by: BL-73 (DM, #338): "Stores (one per stronghold: a holder in the loot / inventory ledger, so Move to party is the existing form)"; strongholds can be DM-only

## Context

- The ledger has three coin ends (`party`, `world`, `character`) and two item holders (party inventory, a sheet's items). Balances are derived from entries (never stored), so conservation holds by construction.
- `loot-entry` rows are visible in full to every player (FR-LOOT-10). A DM-only stronghold's Stores must not leak its name or id through them.
- CON-44 (measured, throwaway probe, heavy harness): `stores-coin` 10 rows DM +2,476 B / player +2,336 B; every one of the 100 windowed loot rows with a Stores end: DM +7,500 B, player +5,500 B.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. New end kind `{kind: stores, strongholdId}` for coin and items; derived `stores-coin` per stronghold (as wallets); Stores items are `party_item` rows with `stronghold_id`; a server-written `stores_hidden` copy on entries and items; players see a hidden end as "Outside the party" (row hidden when no party-side end is left)** | Same commands, forms, log and conservation rule; Move to party is literally the Move form; no new table | Copy rewrite on every show / hide (bounded by the stronghold's ledger rows); one more derived type in the snapshot (≤ 8 rows) |
| B. A separate Stores table and its own move commands | No change to the ledger | Two sources of truth for coin and items; a second Move form, against BL-73 |
| C. Stores as a hidden "character" | No new end kind | Fake entities, wallets and sheets; breaks character lists, rights and stats |

## Decision

> Undecided. Suggested pick **A**.

- Pairing: `world` pairs with `character` or `stores`. Rights: DM any; players with visible Stores as with the party pot (OQ-LOOT-21 A).
- Hidden Stores (OQ-LOOT-22 A): ends redacted to `world` for players; both ends `world` → row hidden; Stores items and `stores-coin` hidden.
- Deleting a stronghold moves its Stores to the party in the same transaction (OQ-HOLD-06 B); old entries keep their `stores` end, shown as "Stores (removed)".

## Consequences

- Shared files: `Endpoint` in `src/shared/events/party-loot.ts`; `loot_entry` (`from/to_stronghold_id`, `stores_hidden`) and `party_item` (`stronghold_id`, `stores_hidden`) columns; one derived record type registration.
- Conservation becomes pot + Σ wallets + Σ Stores = Σ loot + net from outside; asserted after every RS test command.
- A later "pay upkeep from Stores" or income feature writes ordinary `stores → world` / `world → stores` entries; nothing else changes.
