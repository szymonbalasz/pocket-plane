---
title: Animated tokens
prefix: ANIM
status: complete
owner: spec-animated-tokens
phase: post-mvp
---

# Animated tokens

> Five-minute read. Decided by the DM in conversation, 2026-11-08 ([ADR-0080](../architecture/adr/0080-animated-tokens.md)). Amends [assets-pipeline](assets-pipeline.md) (which kept video out of scope) and [scenes-map](scenes-map.md).

## 1. Summary

- The DM uploads a **WebM** (see-through background) or **MP4** as token art. On the map it plays as a looping, muted video.
- An animated token is a normal library image: the stored file is the video, and the browser grabs a **still frame** at upload. The thumbnail and the fallback image come from that frame.
- Only the map canvas plays it. Pickers, the initiative row, portraits and handouts show the still frame.

## 2. Scope

- Upload WebM and MP4, ≤ 20 MB, in the **token** and **portrait** pickers (a creature's portrait becomes its tokens' image, #120).
- Play on the map for tokens and their mirrors ([token-mirrors](token-mirrors.md)), in both clients.
- Respect the per-browser **Map effects** preference ([FR-VFX-25](spell-fx.md#6-functional-requirements)): Full / Reduced play the video; Still / Off show the still frame.
- A non-blocking warning when the DM uploads a WebM: Safari shows a black box behind see-through WebM.

## 3. Goals

- Drop in a token pack's WebM files and see them move, with no conversion step and no new server dependency.
- Delete-while-in-use, tags, search and player visibility keep working unchanged.

## 4. Non-goals

- Animated maps, props, handouts, portraits or compendium images (still frame only).
- Server-side transcoding or frame extraction (no ffmpeg).
- Safari-specific handling beyond the upload warning (DM: no one plays on Safari).
- Animated GIF / APNG / animated WebP: still first frame, as today (FR-ASSET-02).
- Sound from videos: always muted.

## 5. User stories

**DM**
- As the DM, I want to upload my animated token pack's WebM files and set one as a token's art, so my monsters move on the map.
- As the DM, I want my animated tokens to stop on a slow laptop, so the map stays smooth.

**Player**
- As a player, I want to see the animated tokens I can see, without the video giving away a token I can't.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-ANIM-01 | **Upload.** `POST /api/assets` takes an optional multipart field `poster` (an image file). When `file` is sniffed as a video (FR-ANIM-02), `poster` is required: missing → 422 "A video needs its still frame (upload it from the picker)". A `poster` sent with a non-video `file` → 400. | Amends FR-ASSET-01, -02 |
| FR-ANIM-02 | **Formats, sniffed from content** (extension and Content-Type ignored): **WebM** = EBML header with DocType `webm` → `video/webm`; **MP4** = an `ftyp` box at offset 4 whose major brand isn't QuickTime (`qt  `) or audio-only (`M4A `, `M4B `) → `video/mp4`. Any other video or container (MOV, MKV, AVI) → 415. Video > **20 MB** → 413 "Video over 20 MB", checked before the poster is decoded. | DM 2026-11-08 |
| FR-ANIM-03 | **Stored files.** Row `kind` stays `image`. `mime` = the video's (`video/webm` \| `video/mp4`), `bytes` = the video's size, `hash` = SHA-256 of the video. The video is the hash dir's `original`; `display.webp` and `thumb.webp` are made from the **poster** by the image rules (FR-ASSET-02, -05: limits, no upscale, alpha kept). `width` / `height` / display sizes = the poster's. Same write order, temp dir, dedupe and start-up sweep (FR-ASSET-03, -04, -06, -07). | No schema change |
| FR-ANIM-04 | **Animated** = an `image` asset whose `mime` starts with `video/`. Every other use of the asset (pickers, `assets.require`, in-use refusal, tags, rename, delete) is unchanged. | FR-ASSET-15, -64 |
| FR-ANIM-05 | **Serving the video.** `GET /api/assets/:id/motion`: no credential (the ID is the capability, [ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)). Served iff the asset is animated and in the active campaign, else FR-ASSET-13's common 404. `Content-Type` = the row's `mime`, `Cache-Control` and `ETag` as the other files, `Accept-Ranges: bytes`; a `Range` request → 206 with that range; an unsatisfiable range → 416. `thumb` / `display` are served as today. | Amends FR-ASSET-11 ("originals are never served"), only for videos |
| FR-ANIM-06 | **Token wire field.** The `token` record gains derived `imageAnimated: boolean` = `imageAssetId` names an animated asset; false when `imageAssetId` is null. Computed in the token provider from the asset row, for DM and player rows alike (it says nothing the player's copy of `imageAssetId` doesn't already allow them to fetch). A mirror's wire row carries the same field, from its token; a **Shadow** mirror has no art, so no field. | Amends [scenes-map §8](scenes-map.md#8-data-model), FR-MIR-07 |
| FR-ANIM-07 | **Staying correct.** `imageAnimated` changes only with `imageAssetId` (asset bytes never change, a used asset can't be deleted), so the record changes that already carry a new `imageAssetId` carry the new flag. Snapshot and live rows agree. | Test on snapshot and live |
| FR-ANIM-08 | **Picker upload (DM).** In the `token` and `portrait` contexts ([FR-ASSET-48](assets-pipeline.md#63-sprint-6-image-search-and-tags-track-im)) the file input also accepts `video/webm, video/mp4`; drop works the same. Before uploading, the client loads the video in a muted `<video>`, waits for the first frame (`loadeddata`, seek to 0, `seeked`), draws it at `videoWidth × videoHeight` to a canvas and sends it as `poster` (PNG). Over 20 MB → refused before reading, "Video over 20 MB". Can't decode within 10 s → "This browser can't play this video", no upload. | Paste and attach controls stay image-only |
| FR-ANIM-09 | **Other pickers** (map, prop, handout, compendium, attach) don't accept video files: a dropped video → "Videos work as token art only". An animated asset already in the library can still be picked there; it shows its still frame. | |
| FR-ANIM-10 | **WebM warning.** After a WebM upload succeeds, the upload row shows a non-blocking note: "Safari shows a black background behind see-through WebM." Dismissed with the row. No Safari detection anywhere. | DM 2026-11-08 |
| FR-ANIM-11 | **Library marks.** The picker and Assets window tiles of an animated asset show a small film badge (lucide `Film`); the Tooltip adds "Animated · WebM" or "· MP4" and the video's MB. The Assets window preview plays the video (muted, looping). Thumbnails themselves never play. | DM only |
| FR-ANIM-12 | **Playback on the map** (both clients). A token (or mirror) with `imageAnimated` draws a Konva `Image` whose source is a muted, looping, `playsInline` `<video>` of `/motion`, with the same crop and fit as its still image today. **One `<video>` per asset ID**, shared by every node showing it. Until the video can play (or if it fails) the node draws the `thumb` still, so nothing ever flashes empty. | |
| FR-ANIM-13 | **Redraws.** While ≥ 1 animated node is drawn and playing, the tokens layer redraws at ≤ 30 fps; with none, no extra redraws. A video plays only while some drawn node shows it: a token that isn't drawn for this viewer (another scene, hidden, fogged, out of sight) pauses it, and a video with no nodes for 60 s is released. The tab hidden → all paused. | |
| FR-ANIM-14 | **Map effects preference.** The effective level ([FR-VFX-25](spell-fx.md#6-functional-requirements), incl. the automatic drop on slow frames) decides: **Full, Reduced** → play; **Still, Off** → the `thumb` still, videos paused. Animated-token redraws count toward the slow-frame measure. No new preference. | Preferences hint gains "and animated tokens" |
| FR-ANIM-15 | **Errors and reconnect.** A `/motion` load error → the still frame, no retry loop; retried once after each reconnect snapshot, like images (FR-ASSET-16). | |
| FR-ANIM-16 | **Agent API / fixtures.** `asset_upload` (MCP) sends no poster, so a video gets FR-ANIM-01's 422; its error names the picker. The fixture step takes a poster: `ingestStep(file, {poster})`. | [agent-api](agent-api.md) |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md); no custom styles.

- **Picker** (token, portrait): Upload's file dialog lists videos. Upload row: "Reading video…" (poster grab), then the normal progress and "Processing…". Errors inline as today (Alert). WebM note (FR-ANIM-10) as a muted line under the row, with an × to dismiss.
- **Tiles:** film badge in the bottom-right corner, over the still thumbnail.
- **Map:** an animated token looks like any token (ring, name, turn ring, selection, mirrors' Transparent look) but moves. No play / pause control on the token.
- **Preferences:** "Map effects" hint becomes "Moving map effects and animated tokens".
- **States:** loading → still frame; error → still frame; disconnected → upload disabled, as today.
- **DM view / player view:** the same, apart from the DM-only picker, badges and warning.

## 8. Data model

- **No schema change**, no new record type. `asset` rows of an animated image: `kind = image`, `mime = video/webm | video/mp4`, `bytes` = video size, sizes from the poster. Files `<hash>/{original (video), display.webp, thumb.webp}`.
- **Derived:** `imageAnimated` on the `token` wire row and the mirror wire row (FR-ANIM-06), from the asset's `mime`. Not stored.
- **Relations:** unchanged (`Token.imageAssetId` → Asset).
- `upgrade:check`: nothing to move.

## 9. API & events

**REST**

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/assets` | DM | + optional `poster` field (FR-ANIM-01) |
| GET | `/api/assets/:id/motion` | anyone with the ID | The video, with Range support (FR-ANIM-05) |

**WS intents:** none new.

**WS events**

| Event | Payload | Visibility rule |
|---|---|---|
| `AssetIngested` | unchanged (`mime` tells a video) | DM only, as today |
| `token` record changes | + `imageAnimated` | the token's existing rule ([scenes-map](scenes-map.md#9-api--events)) |
| mirror record changes | + `imageAnimated` (not on Shadow) | FR-MIR-06 / -07 |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Upload a video | ✓ | ✗ | DM secret (FR-ASSET-01) |
| Fetch `/motion` | ✓ | ✓ if they know the ID | ID is the capability; active campaign; animated |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** the snapshot carries `imageAnimated`; failed videos retry once (FR-ANIM-15). Downloaded videos stay cached.
- **DM disconnect:** upload disabled, as for images.
- **Server crash mid-ingest:** as images: temp dir swept, nothing committed (FR-ASSET-06, -07). `PP_TEST_CRASH=assets.ingest:after-files` covers it.
- **Same video, different poster:** same hash → `existing` (FR-ASSET-03); the first poster stays.
- **Poster from a different video** (a crafted request): accepted. Only the DM can upload, and the worst case is a wrong still frame.
- **A token is hidden after a player loaded its video:** the player keeps the bytes (accepted, FR-ASSET-12); the token is no longer drawn, so it doesn't play.
- **Browser can't decode the codec** (e.g. HEVC MP4): the DM's own browser refuses the poster grab (FR-ANIM-08). A player whose browser can't play it sees the still frame.
- **Playwright's Chromium has no H.264:** MP4 playback isn't covered by e2e (§13).

## 12. Performance & bandwidth

- ≤ 20 MB per video, downloaded once per browser (immutable cache, Range requests). Over a tunnel, 10 different animated tokens of 5 MB = 50 MB on a player's first view.
- The video loads only when a node shows it (`preload` set on first draw), so a library full of videos costs nothing until used.
- Decoding: one `<video>` per asset, not per token. Redraws ≤ 30 fps, only while something animated is visible. A slow machine drops to Still by itself (FR-ANIM-14).
- Snapshot: one boolean per token.

## 13. Test plan

| Level | What | Fixtures |
|---|---|---|
| Unit (server) | `FR-ANIM-02 sniff`: WebM header → `video/webm`; `ftyp isom` / `mp42` → `video/mp4`; `ftyp qt  `, `M4A `, a Matroska non-webm, AVI → 415; 20 MB + 1 → 413 before the poster is touched. Hand-built header bytes | in-code |
| Integration (server) | `FR-ANIM-01` missing poster → 422, poster with an image → 400; `FR-ANIM-03` files and row (mime, bytes, sizes from poster), dedupe; `FR-ANIM-05` 200, `Range: bytes=0-99` → 206 with 100 bytes, bad range → 416, a still image's `/motion` → 404, another campaign → 404; `FR-ANIM-06/07` `imageAnimated` on DM and player snapshot and live rows, after a token image change, on a mirror, absent on a Shadow; crash at `after-files` | `animated-wisp.webm` |
| Unit (client) | `FR-ANIM-12` one `<video>` per asset ID, still frame until `canplay`, still on error; `FR-ANIM-13` no extra redraws without animated nodes, pause when not drawn, release after 60 s; `FR-ANIM-14` Still / Off → still; `FR-ANIM-08` 20 MB refusal, decode timeout; `FR-ANIM-09` other contexts refuse; `FR-ANIM-10` note on WebM only | jsdom fakes |
| E2E | `e2e/animated-tokens.e2e.ts`, bundle `animated-tokens`: DM uploads the WebM in the token picker (note shown), sets it on a token; the player's canvas node gets a playing video (`currentTime` advances); Preferences → Still → it pauses on the still | bundle |

- **Fixtures:** `fixtures/assets/tokens/animated-wisp.webm` (≤ 100 KB, see-through VP9, made in-repo by a script, CC0, ATTRIBUTION row) + `animated-wisp.svg` poster. Unit `units/assets-pipeline/animated-token.ts`; bundle `animated-tokens` on `base`: the active scene with an animated token visible to `player-1` and a hidden animated token.
- **Browser walkthrough** (bundle `animated-tokens`): DM uploads a second WebM in the token picker → "Reading video…", the WebM note, the film badge on the tile → sets it as a token's image → it moves on the DM map. `player-1` sees both visible animated tokens moving, never the hidden one (no `/motion` request for it in the network log). DM hides a token → it disappears for the player. Player Preferences → Still → tokens stop on their still frames; Full → they move again. Reload → they still move. DM's own browser: one MP4 token upload and playback (checked by hand in Chrome, H.264).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [assets-pipeline](assets-pipeline.md) | `poster` field, video sniff, `/motion` route, picker contexts | Amended here |
| [scenes-map](scenes-map.md) | token provider's derived field; tokens layer playback | Amended here |
| [token-mirrors](token-mirrors.md) | mirror wire row field | Amended here |
| [spell-fx](spell-fx.md) | the effective Map effects level and slow-frame drop | Exists |

## 15. Open questions

**Bold** = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ANIM-01 | Which frame is the still? | **Decided (DM 2026-11-08): A. The first frame.** Options were: A / B. The middle frame (some loops fade in from empty) | no (decided) | FR-ANIM-08 |
| OQ-ANIM-02 | Glossary: *animated token*, *still frame* | **Decided: A, added** | no (decided) | glossary |

## 16. Out of scope

- Animated maps, props and the rest (§4); revisit with the [theme system](post-mvp/theme-system.md) art track.
- Transcoding, trimming or picking a still by hand.
