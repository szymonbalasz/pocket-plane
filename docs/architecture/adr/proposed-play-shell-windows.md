# NNNN — Feature UI as play-shell windows; layout persisted per owner

- Status: proposed
- Date: 2026-10-12
- Affects: [play-shell](../../specs/play-shell.md), every spec with play UI ([scenes-map](../../specs/scenes-map.md), [character-sheet](../../specs/character-sheet.md), [dice-roll-log](../../specs/dice-roll-log.md), [combat-tracker](../../specs/combat-tracker.md), [notifications](../../specs/notifications.md), [party-loot](../../specs/party-loot.md)), [AGENTS.md §9.9](../../../AGENTS.md#99-shared-files)
- Extends: [ADR-0014](0014-mvp-scope.md) (one play page, layout persisted per player). Raised by OQ-SHELL-01, OQ-SHELL-06, OQ-SHELL-07 in [play-shell](../../specs/play-shell.md#15-open-questions)

## Context

- ADR-0014 / decisions #44, #48: one play page, canvas base, floating windows, layout persisted per player. How features plug in and where the layout lives are not fixed.
- Combat and Reward specs are written next; each needs to know how its UI appears on the page.

## Options

**A. How features show UI**

| Option | Pros | Cons |
|---|---|---|
| **Window types in a per-client registry (kind `<prefix>.<name>`, clients, default size/position, launcher entry, component); shell owns chrome, z-order, persistence** | One window model; features add a line, no shell edits; palette/shortcuts later read the same registry | Each spec names its window kinds and defaults |
| Features own panels/routes | No registry | Inconsistent chrome; layout persistence per feature |

**B. Where layout lives**

| Option | Pros | Cons |
|---|---|---|
| **Server record `layout` per (campaign, owner), JSON leaf, saved by intent, non-logged event, own-only visibility** | Survives browser switch and crash; one sync path | DM snapshot carries players' layouts (≤ ~28 KB); a save per arrangement change |
| Browser localStorage | No server work | Lost on another browser; not "per player" |
| Both (local cache + server) | Instant restore | Two sources of truth |

## Decision

> Undecided. Suggested: **A** registry and **B** server record.

## Consequences

- Each play-UI spec lists its window types (kind, clients, default open/size) in §7; no spec adds pages.
- AGENTS §9.9 lists the two client registry files as append-only registries (OQ-SHELL-07).
- `layout` is a normal record type under [ADR-0021](0021-sync-protocol-conventions.md); `LayoutSaved` is non-logged per [ADR-0016](0016-domain-events-pending-actions.md).
