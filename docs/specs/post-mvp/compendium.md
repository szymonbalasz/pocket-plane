---
title: Compendium
prefix: CMP
status: stub
owner: —
phase: post-mvp
---

# Compendium (post-MVP stub)

Moved out of MVP by [ADR-0014](../../architecture/adr/0014-mvp-scope.md). First post-MVP candidate.

- **What:** Library of 5e rules content (monsters, spells, items, conditions). SRD import from Open5e, browse/search, clone-to-campaign, homebrew, provenance/licence, re-import without clobbering edits.
- **Tiered** ([feature tiers](../../feature-tiers.md#5-dm-tools)): Open5e/SRD import (A), homebrew monster editor (A), stat block view on token click (B), rules quick reference (B).
- **NPC workflow (DM):** create a custom NPC from an **SRD monster as base** or by **duplicating an existing NPC**, then edit stats and add **custom actions** (auto-roll vs selected target(s) in combat — [combat-extras](combat-extras.md)). Many custom NPCs per encounter. Shieldmaiden is the reference.
- **Importers** (each an adapter, [ADR-0015](../../architecture/adr/0015-source-adapters-fixtures.md)):

| Source | Tier | Notes |
|---|---|---|
| Open5e | A | Important; first real adapter |
| DM homebrew files | A | > TODO (spec phase): file formats? |
| Griffon's Saddlebag items | B | Bulk import name/description/rarity; mechanics added one by one as items get used |
| 5etools JSON | C | Separate project ([compendium-expansion](compendium-expansion.md)) |

- **Builds on:** [fixtures-adapters](../fixtures-adapters.md) (Open5e = another adapter), [entities](../entities.md), [ADR-0010](../../architecture/adr/0010-compendium-design.md), [ADR-0015](../../architecture/adr/0015-source-adapters-fixtures.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Scope, overrides, re-import safety | See [ADR-0010](../../architecture/adr/0010-compendium-design.md) |
| First Open5e content types | **Monsters, spells, items, conditions** / all SRD types |
| Import trigger | **DM-triggered in UI, with progress** / CLI script |
| Can players browse? | **Read-only spells/items/conditions; monsters DM-only** / DM only |
| Use entries directly (add SRD goblin to combat) without cloning? | **Yes; clone only to edit** / must clone |

- **Test note:** recorded Open5e responses as fixtures; no network in tests.

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
