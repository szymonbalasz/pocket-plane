# Proposed — Animated tokens: videos stored as-is, still frame from the browser

- Status: proposed (DM direction, 2026-11-08)
- Date: 2026-11-08
- Consistent with: [ADR-0023](0023-asset-access-by-capability-id.md) (the asset ID is the capability), [ADR-0001](0001-tech-stack.md) (no new dependency), [ADR-0071](0071-spell-fx.md) (the Map effects preference)
- Amends: [assets-pipeline](../../specs/assets-pipeline.md) §4 non-goals: video was out of scope, citing [ADR-0007](0007-product-scope.md), which never names video
- Affects: [animated-tokens](../../specs/animated-tokens.md), [assets-pipeline](../../specs/assets-pipeline.md), [scenes-map](../../specs/scenes-map.md), [token-mirrors](../../specs/token-mirrors.md); protocol, data model

## Context

- The DM has animated token packs as WebM (see-through background) and MP4.
- The asset pipeline takes images only: `sharp` makes derivatives, and it can't read video.
- Players never get the `asset` library, only asset IDs inside the records they can see.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. Transcode on the server (ffmpeg) to one format, server-made still frame | One format to play; any upload works | A new native dependency on Windows and macOS; slow ingest |
| B. A new asset kind `video` with its own library and pickers | Clean separation | Every image use (pickers, in-use checks, tags, token image field) needs a second path |
| **C. A video is an `image` asset: the video is the stored original, and the browser sends a still frame that makes the usual derivatives** | No schema change, no dependency; every image path works unchanged; the DM's browser proves it can decode the file | The still frame comes from the client; uploads need a browser (fixtures commit a poster) |

## Decision

**C.**

- **Animated = `mime` starts with `video/`.** No new column, nothing for `upgrade:check` to move.
- **The original is served for videos only**, at `/motion`, with Range support. Images keep "originals are never served".
- **Players learn "animated" from a derived `imageAnimated` flag on the token (and mirror) row.** They can't read the asset record, and probing `/motion` for every token would cost a request each.
- **Playback is client-only and follows Map effects.** No new preference; the slow-frame drop also stops videos.
- **Safari:** no special handling, a warning at WebM upload (DM: no one plays on Safari).

## Consequences

- A token video can be at most 20 MB; players download each once.
- MP4 playback can't be checked in e2e (Playwright's Chromium has no H.264); only by hand.
- Animated maps or props later reuse the same storage and `/motion` route; only drawing would be new.
