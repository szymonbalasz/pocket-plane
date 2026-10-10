---
title: Assets pipeline
prefix: ASSET
status: unclaimed
owner: —
wave: 1
---

# Assets pipeline

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Upload, store and serve binary assets. MVP: map images and token/portrait images ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). Handouts later.
- Content-hashed storage and derivatives (via `sharp`), aggressive caching.
- Served from the DM's laptop over a tunnel, so bandwidth matters ([ADR-0003](../architecture/adr/0003-local-hosting.md)).

## 2. Scope

- Upload (DM; player uploads TBD).
- Content-hash addressing; dedupe identical uploads.
- Derivatives: thumbnails, resized variants, format conversion.
- HTTP caching (immutable URLs by hash).
- Preload of the next scene's map *(MVP need depends on [OQ-CBT-01](combat-tracker.md#15-open-questions))*.
- Asset metadata and campaign ownership.
- Visibility: players only fetch assets they're allowed to see.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-ASSET-NN.

## 7. UI/UX notes

> TODO (spec phase): upload flow, asset picker, progress/error states. DM vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): asset, derivative; hash, mime, dimensions, size, campaign, uploader.

## 9. API & events

> TODO (spec phase): upload, fetch by hash, derivative fetch, preload status events. Visibility rule per event.

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): partial upload, crash during derivative generation, orphaned files, huge images, unsupported formats, guessed hash URLs.

## 12. Performance & bandwidth

> TODO (spec phase): max upload size, derivative sizes, cache headers, expected map sizes × 6 players over DM upload.

## 13. Test plan

> TODO (spec phase): fixture images, temp asset dir per test run ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [campaign-management](campaign-management.md) | Campaign scope, auth | open |
| [live-sync](live-sync.md) | Preload/ready events (if any) | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ASSET-01 | Access control for asset URLs (inactive scene maps could leak) | **Auth-checked route; visibility check post-MVP** / unguessable hash only / signed URLs | yes | scenes-map, entities |
| OQ-ASSET-02 | Can players upload (e.g. own portrait)? | **Yes, portrait only** / no / yes, any | no | character-sheet |
| OQ-ASSET-03 | Derivative set and formats in MVP | **Original + thumbnail only; more later** / thumb + display size WebP / on-demand | no | scenes-map |
| OQ-ASSET-04 | Asset scope: per campaign or shared library | **Per campaign, dedupe on disk by hash** / global | no | campaign-management |
| OQ-ASSET-05 | Garbage collection of unreferenced assets | **Manual DM cleanup** / ref-counted auto delete / never | no | — |

## 16. Out of scope

- Audio/video assets ([ADR-0007](../architecture/adr/0007-product-scope.md)).
- Cloud storage / CDN.
- In-app image editing.
