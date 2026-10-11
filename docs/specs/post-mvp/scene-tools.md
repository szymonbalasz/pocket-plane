---
title: Scene tools
prefix: SCN
status: stub
owner: —
phase: post-mvp
---

# Scene tools (post-MVP stub)

Moved out of MVP by [ADR-0014](../../architecture/adr/0014-mvp-scope.md).

- **What:** Polygon fog, hidden tokens, AoE props (cone, sphere, cube, line, cylinder), live drag previews, scene preload, **player-ready indicator** (DM sees who has fully loaded a scene; deferred from MVP, which assumes immediate load).
- **Builds on:** [scenes-map](../scenes-map.md), [live-sync](../live-sync.md) (reveal semantics, OQ-SYNC-06), [assets-pipeline](../assets-pipeline.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Fog default for new scene | **Fully fogged; DM reveals** / clear |
| Token under fog hidden from players automatically? | **Yes, filtered server-side** / only if flagged |
| AoE props: who can place? | **DM and players** / DM only |
| DM-configurable 5/10/5 diagonal rule | **Campaign setting** / no |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
