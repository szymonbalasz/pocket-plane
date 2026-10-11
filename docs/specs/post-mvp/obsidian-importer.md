---
title: Obsidian importer
prefix: OBS
status: stub
owner: —
phase: post-mvp
---

# Obsidian importer (post-MVP stub, optional)

- **What:** Optional one-shot import of selected notes from the DM's Obsidian vault into entities. The vault is **not** ported wholesale ([ADR-0007](../../architecture/adr/0007-product-scope.md)).
- **Builds on:** [entities](../entities.md), [ADR-0009](../../architecture/adr/0009-entity-content-model.md), [ADR-0011](../../architecture/adr/0011-cross-references.md) (wikilinks → references).
- **DM intent:** vault is world-building/story. Not needed early; nice to tie into the notes system later. Notes model (markdown + wikilinks + backlinks, [world-builder](world-builder.md)) should make this a thin importer.
- **Open:**
  - Kind detection (front matter, folder, tag?).
  - Embedded images → [assets-pipeline](../assets-pipeline.md).
  - Worth building at all vs manual migration?

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP, if still wanted.
