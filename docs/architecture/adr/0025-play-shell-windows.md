# 0025 — Feature UI as play-shell windows; layout in browser storage

- Status: accepted (2026-10-12; decisions-log #121)
- Date: 2026-10-12
- Affects: [play-shell](../../specs/play-shell.md), every spec with play UI ([scenes-map](../../specs/scenes-map.md), [entities](../../specs/entities.md), [assets-pipeline](../../specs/assets-pipeline.md), [character-sheet](../../specs/character-sheet.md), [dice-roll-log](../../specs/dice-roll-log.md), [combat-tracker](../../specs/combat-tracker.md), [notifications](../../specs/notifications.md), [party-loot](../../specs/party-loot.md)), [AGENTS.md §9.9](../../../AGENTS.md#99-shared-files)
- Extends: [ADR-0014](0014-mvp-scope.md) (one play page, layout persisted per player). Raised by OQ-SHELL-01, OQ-SHELL-06, OQ-SHELL-07 in [play-shell](../../specs/play-shell.md#15-open-questions)

## Context

- ADR-0014 / decisions #44, #48: one play page, canvas base, floating windows, layout persisted per player. How features plug in and where the layout lives were not fixed.
- Scenes, Combat and Reward specs each need to know how their UI appears on the page.

## Options

**A. How features show UI**

| Option | Pros | Cons |
|---|---|---|
| **Window types in a per-client registry (kind `<prefix>.<name>`, clients, default size/position, launcher entry, component); shell owns chrome, z-order, persistence** | One window model; features add a line, no shell edits; palette/shortcuts later read the same registry | Each spec names its window kinds and defaults |
| Shell hard-codes each feature's window (no registry) | Simplest now | Every feature edits shell code; conflicts across parallel builds |
| Features own panels/routes | No registry | Inconsistent chrome; layout persistence per feature |

**B. Where layout lives**

| Option | Pros | Cons |
|---|---|---|
| **Browser `localStorage`, one entry per (campaign, owner = DM or the link's player)** | Survives reload, reconnect, server and browser crash; per player per browser; no server code, record type, intent or sync edge cases | Lost on another browser, a fresh profile or a new origin (e.g. new tunnel URL) |
| Server record `layout` per (campaign, owner), saved by intent | Only option that restores on another browser | Record type, intent, visibility (players: own only; DM: all), multi-tab and campaign-switch rules, NULL-owner uniqueness |
| Both (local cache + server) | Instant restore | Two sources of truth |

## Decision

- **A:** window types in a per-client registry.
- **B:** browser `localStorage`, keyed by player link / DM, per campaign (decisions-log #121). Cross-browser restore is not needed.

## Consequences

- Each play-UI spec lists its window types (kind, clients, default open/size) in §7; no spec adds pages.
- AGENTS §9.9 lists the two client registry files (`src/client/dm/windows.ts`, `src/client/player/windows.ts`) as append-only registries (OQ-SHELL-07).
- Build order: the play-shell frame and empty registries merge before other Scenes builders register windows (or a `fix/shell-registry` creates them first).
- No `layout` record type, intent or domain event; nothing in `docs/data-model/` or `docs/protocol/` changes for layouts.
- Moving to a server record later stays possible: the stored document (WindowState[]) is the same shape.
