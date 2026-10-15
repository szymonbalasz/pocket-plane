---
title: Scene tools
prefix: SCN
status: claimed
owner: spec-scene-tools
phase: post-mvp-2
---

# Scene tools (post-MVP stub)

Moved out of MVP by [ADR-0014](../architecture/adr/0014-mvp-scope.md). Fog of war has its own spec (`fog-of-war`, prefix FOG; sprint 2 track F).

- **What:** Tier-A map features ([feature tiers](../feature-tiers.md#1-map-and-tokens)): layers (incl. DM-only), doors and walls (movement only). Tier B: map pins linked to notes/locations. Plus: AoE props (cone, sphere, cube, line, cylinder), image props, live drag previews, scene preload, **player-ready indicator** (DM sees who has fully loaded a scene; deferred from MVP, which assumes immediate load).
- Hidden tokens moved **into MVP** ([scenes-map](scenes-map.md)).
- **Builds on:** [scenes-map](scenes-map.md), [live-sync](live-sync.md), [assets-pipeline](assets-pipeline.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| AoE props: who can place? | **DM and players** / DM only |
| DM-configurable 5/10/5 diagonal rule | **Campaign setting** / no |

> TODO (spec phase): expand from [_template.md](_template.md).
