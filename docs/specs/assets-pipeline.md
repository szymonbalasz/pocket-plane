---
title: Assets pipeline
prefix: ASSET
status: draft
owner: spec-assets-pipeline
wave: 1
---

# Assets pipeline

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Ingest, store and serve images: map images and token art/portraits ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). One ingest command for DM uploads and fixture SVGs. Files content-hashed, derivatives via `sharp` ([ADR-0001](../architecture/adr/0001-tech-stack.md)).
- Served from the DM's laptop over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)): small WebP derivatives, browser-cached forever, never edge-cached.
- **A player can fetch an image only if a record they can currently see references it.** Hidden tokens and inactive scenes leak nothing.

## 2. Scope

- Ingest (DM upload over REST; fixture loader in-process), dedupe per campaign by hash, derivatives `thumb` + `display`.
- Asset record per campaign (DM only); file serving with per-request access check; client image loader; DM asset picker with upload.
- Asset references: how other specs point records at assets and make them fetchable.
- Fixture `images` ([fixtures-adapters §8](fixtures-adapters.md#8-data-model)) plus test fixtures and bundle `asset-library`.
- **Design for later:** token art library with folders (tier A), handouts ([party-board](post-mvp/party-board.md)), preload / player-ready ([scene-tools](post-mvp/scene-tools.md)) reuse the same store and loader.

## 3. Goals

- **Zero leakage:** no player request ever returns bytes of an asset not referenced in that player's current view.
- A typical map reaches 6 players over the tunnel in seconds and is downloaded once per browser.
- One write path: UI uploads and fixtures go through the same command, validation and events ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).
- Crash at any point leaves no asset row without its files.

## 4. Non-goals

- Preload, load progress, player-ready indicator (assume immediate load, [ADR-0014](../architecture/adr/0014-mvp-scope.md)). Token art library with folders/tags (tier A).
- Player uploads (OQ-ASSET-02). Rename, delete, replace an asset (OQ-ASSET-05). In-app image editing. Audio/video ([ADR-0007](../architecture/adr/0007-product-scope.md)). Cloud storage, CDN.

## 5. User stories

**DM**
- As the DM, I want to upload a map or token image and pick it again later, so scene prep stays in the app.
- As the DM, I want hidden enemies and the next battlemap to stay secret even from a player with dev tools open.

**Player**
- As a player, I want the map and tokens to appear quickly when the DM switches scene, and instantly when we come back to it.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-ASSET-01 | One command `assets.ingest {bytes, filename, name?}` → `{asset, outcome: created \| existing}`. Called by the REST upload and the fixture loader (FR-FIX-17); DM authority. Format detected from content, never from extension or Content-Type. | |
| FR-ASSET-02 | Accepted: PNG, JPEG, WebP, SVG. Animated input → first frame. SVG is rasterised at ingest at its intrinsic size; the stored original is PNG; nothing is ever stored or served as SVG. Anything else → 415, nothing written. | Limits *(proposed)*, OQ-ASSET-06 |
| FR-ASSET-03 | Body > 25 MB → 413 without reading further. Decoded size > 50 megapixels → 422, checked from the header before pixel decode. Corrupt image → 422. Nothing written in any case. | OQ-ASSET-06 |
| FR-ASSET-04 | `hash` = SHA-256 of the stored original. Unique per `(campaignId, hash)`: re-ingesting the same image in a campaign → `existing` with the existing asset; no row, file, event or log entry. Name of the second upload ignored. | Dedupe |
| FR-ASSET-05 | Files stored once per hash under `PP_ASSET_DIR`, shared by every campaign's row with that hash. Written to a temp dir in `PP_ASSET_DIR`, then renamed; an existing hash dir is reused untouched. | Disk dedupe |
| FR-ASSET-06 | Derivatives made at ingest: `thumb` WebP, long edge ≤ 512 px; `display` WebP, long edge ≤ 4096 px. Never upscaled; aspect kept; EXIF orientation applied; metadata stripped; alpha kept. | *(proposed)* OQ-ASSET-03 |
| FR-ASSET-07 | All files are on disk before the row + event-log entry commit in one transaction; `AssetIngested` dispatches after commit ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). A committed asset never lacks its files. | |
| FR-ASSET-08 | On server start: delete the temp dir and every hash dir no asset row references; regenerate missing derivatives from the original; an asset with no original is logged as an error and served as 404. | Crash recovery |
| FR-ASSET-09 | ID from `ctx.ids`, `createdAt` from `ctx.clock` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). Name = `name` or filename without extension; trimmed, control characters removed, 1–80 chars (else `invalid`); not unique. | |
| FR-ASSET-10 | An asset belongs to `ctx.campaignId` (DM: the active campaign at commit). No context ever lists or receives another campaign's asset. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-ASSET-11 | Record type `asset`: scope `campaign`; DM `full`, player `hidden`. Snapshot: the campaign's assets, newest first (`createdAt`, then insertion order). | [FR-SYNC-18](live-sync.md#6-functional-requirements) |
| FR-ASSET-12 | `GET /api/assets/:id/:file`, `file` ∈ `original \| thumb \| display`. Caller credential sent like other REST calls: DM secret, or the player's link token *(proposed, OQ-ASSET-01)*. | |
| FR-ASSET-13 | DM: any file of an asset of the active campaign. Player: `thumb` / `display` only, and only if the asset ID is in an **asset reference** of a record a fresh snapshot for that player would contain (same scope and visibility fns). Checked per request against committed state. | OQ-ASSET-01 |
| FR-ASSET-14 | Every denial (unknown ID, other campaign, unreferenced, hidden, inactive campaign, `original` for a player) → the same 404 body. Invalid DM secret → 401 ([FR-CAMP-04](campaign-management.md#6-functional-requirements)); unknown link token → 404 ([FR-CAMP-17](campaign-management.md#6-functional-requirements)). Player credentials never count toward the DM throttle (FR-CAMP-05). | No existence oracle |
| FR-ASSET-15 | 200 responses: exact `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `ETag` from hash + file, `Vary` on the credential header, `X-Content-Type-Options: nosniff`. `If-None-Match` → 304 only after FR-ASSET-13 passes. | `private`: no Cloudflare edge cache |
| FR-ASSET-16 | Record types holding asset IDs declare those fields as asset references at registration. Commands that set one call `assets.require(ctx, id)` → `not_found` unless it is an asset of `ctx.campaignId`. | Proposed ADR (§14) |
| FR-ASSET-17 | Client loader (`@ui`): `loadAsset(id, file)` fetches with the client's credential → image element. Dedupes concurrent loads; states `loading \| ready \| error`; retries failed loads when the connection is `live` again; releases unused object URLs. | Both clients |
| FR-ASSET-18 | DM asset picker: the campaign's assets (thumb, name, display size); upload via file input or drop; "Select" returns the asset ID to the caller. Upload disabled unless the connection is `live`. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-ASSET-19 | Upload states: progress %, then "Processing…"; `created` → new item selected; `existing` → Toast "Already uploaded" and that item selected; 413 / 415 / 422 / other → inline error naming the cause. | |
| FR-ASSET-20 | Fixture `images` ingests committed SVGs via FR-ASSET-01. Two loads of a bundle give identical asset IDs, hashes and file bytes (sharp version pinned by the lockfile). | [FR-FIX-08](fixtures-adapters.md#6-functional-requirements) |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Dialog, Progress, Alert, Toast, Tooltip; dark only. Test IDs per [AGENTS §9.5](../../AGENTS.md#95-test-ids).

- **DM picker** (Dialog, opened by scene/token/portrait flows and an "Images" entry, OQ-ASSET-08): thumbnail grid with name; Tooltip shows display size and MB. Test IDs: `asset-picker`, `asset-picker-item` + `data-record-id`, `asset-picker-upload`, `asset-picker-file-input`, `asset-picker-select`, `asset-upload-progress`, `asset-upload-error`.
- **States:** empty "No images yet. Upload a map or token art." · loading: skeleton tiles · uploading: Progress, then "Processing…" · error: inline Alert ("Unsupported file type", "File over 25 MB", "Image over 50 megapixels", "Upload failed, try again") · disconnected: upload disabled, live-sync banner.
- **Images on screen** (canvas: [scenes-map](scenes-map.md); portraits: [entities](entities.md)): placeholder while `loading`, neutral broken-image placeholder on `error`. Map → `display`; token art, portraits, pickers → `thumb`.
- **Player view:** no asset UI. Images appear as their records arrive; nothing says an image was withheld.

## 8. Data model

No JSON leaf fields. Files are not records.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Asset | id, campaignId | ID, ID → Campaign | Unique `(campaignId, hash)` |
| | name | text | 1–80 |
| | hash | text | SHA-256 hex of the original; server-only (not in the `asset` record) |
| | mime, bytes, width, height | text, int, int, int | Of the stored original |
| | displayWidth, displayHeight | int, int | Of `display`; grid calibration may need them (OQ-ASSET-07) |
| | createdAt | timestamp | Clock seam |
| Asset files *(disk)* | `<hash>/original`, `display.webp`, `thumb.webp` | files | Layout *(proposed)*; one set per hash |

- **Relations:** Campaign 1—* Asset. Asset references from scene, token ([scenes-map](scenes-map.md)), entity portrait ([entities](entities.md)): many records → one asset; only same-campaign assets (FR-ASSET-16). Imported (global) definitions carry no asset in MVP.
- **Derived values:** `thumb` size (from display, ≤ 512); a player's fetchable set = asset IDs in their fresh snapshot (FR-ASSET-13). Any cache of it must be rebuildable from the DB ([ADR-0006](../architecture/adr/0006-persistence.md)).
- **Persisted runtime state:** none beyond rows and files.

## 9. API & events

**REST (Hono RPC)**

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/assets` | DM | Multipart `file`, optional `name` → `201 {asset}` created / `200 {asset}` existing / 400, 413, 415, 422 |
| GET | `/api/assets/:id/:file` | DM, player | Serve file per FR-ASSET-12–15 |

**WS intents:** none (uploads are REST, [OQ-SYNC-04](live-sync.md#15-open-questions)). **Signals:** none.

**Record types and events** (generic record changes `{type, id, op, data}` + `cause`, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md))

| Record type | Scope | Visibility rule | Snapshot |
|---|---|---|---|
| `asset {id, campaignId, name, mime, bytes, width, height, displayWidth, displayHeight, createdAt}` | `campaign` | DM `full`; player `hidden` | All of the campaign's assets |

| Domain event | Changes | Logged | Transient | Undoable |
|---|---|---|---|---|
| `AssetIngested {assetId, hash, bytes}` | `asset` upsert | yes | no | no |

- `existing` outcome emits nothing. **Server API for other specs:** `assets.require(ctx, id)`; asset-reference declaration on record-type registration (FR-ASSET-16).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Upload / ingest | ✓ | ✗ (OQ-ASSET-02) | DM credential; default-DM command |
| See asset list | ✓ | ✗ | `asset` visibility = DM only |
| Fetch `thumb` / `display` | Active campaign's assets | Referenced in own current view | FR-ASSET-13 |
| Fetch `original` | ✓ | ✗ | Role |
| Set an asset reference | Per owning spec | Per owning spec | `assets.require` (same campaign) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** loaded images stay; after the snapshot the loader fetches only new IDs (browser cache hits otherwise) and retries failed loads.
- **DM disconnect / reconnect:** a finished upload arrives in the snapshot; a failed one shows "Upload failed, try again". Retrying is safe (FR-ASSET-04).
- **Server crash mid-action:** before commit → no row; temp and orphan files removed at next start (FR-ASSET-08). After commit → asset complete; re-upload returns `existing`.
- **Concurrent edits:** two tabs upload the same image → one `created`, one `existing` (DB uniqueness). Same image in two campaigns → two rows, one file set. Campaign switched mid-upload → asset lands in the campaign active at commit.
- **Reveal / hide:** fetchable as soon as the reveal commits (it precedes the broadcast); after hide or a scene switch later requests 404. Bytes already in a player's browser stay there: they were legitimately seen.
- **Invalid / malicious input:** guessed or leaked IDs → 404 unless referenced in the caller's view; `id` and `file` zod-validated, never used as paths; decompression bombs stopped by the pixel limit; SVG never served; renamed `.png` text file → 415.

## 12. Performance & bandwidth

| Item | Budget *(proposed)* |
|---|---|
| Ingest of a 50 MP image incl. derivatives | ≤ 5 s on the DM laptop |
| Access check (FR-ASSET-13), `session-sim` | ≤ 10 ms p95 |
| `display` of a 4096 × 2867 map | ~1–3 MB; 6 players ≈ 6–18 MB → ~5–15 s at 10 Mbit/s upload, ~1–3 s at 50 |
| Token art `thumb` | ≤ ~50 KB each |
| Revisit of a scene, reload | 0 bytes (immutable, `private` cache) |

- Files streamed from disk; no derivatives on request. Players never download the original.

## 13. Test plan

Isolated per worktree: `bun test` uses `:memory:` DB + temp asset dir per file; walkthroughs use the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)).

**Fixtures** (canonical: `base`, `player-1`, `player-2`, `campaign-second`; added here, SVGs under `fixtures/assets/`)

| Fixture | Contents | In `session-sim` |
|---|---|---|
| `images` | Fixture Campaign: `town` (1400 × 980 *(proposed)*), `battlemap` (1400 × 980 = 20 × 14 at 70 px), `token-mira` blue, `token-goblin` green, `token-wolf` grey, `token-elite` dark green (256 × 256 round) | yes |
| `image-large` | `map-large` 6000 × 4000 SVG → `display` 4096 × 2731, `thumb` 512 × 341 | no |
| `images-second` | Activates Second Campaign, ingests `town.svg` as "Town (copy)", re-activates Fixture Campaign. Requires `campaign-second`, `images` | no |

**Bundle `asset-library`** = `base` + `player-2` + `campaign-second` + `images` + `image-large` + `images-second`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Format sniffing; size maths (no upscale, aspect); name rules; headers; 404 body identical across denial causes | In-code |
| Integration | Created / existing; cross-campaign rows share files; 413/415/422 write nothing; injected crash after files → no row, swept at start; missing derivative regenerated; one log entry per `created`; determinism (two loads, same IDs and hashes); `asset` never in player frames; DM 404 for Second Campaign's asset; inactive-campaign player 404; player credential not counted by DM throttle; 304 only after the check | `asset-library` |
| Integration | **Access property:** with a test-only referencing record type (visible / hidden / redacted ref / scene-scoped), after any change sequence each player's fetchable set = asset IDs in a fresh snapshot | `asset-library` + test type |
| E2E (thin) | DM uploads via picker, item appears; `player-1` fetch of an unreferenced asset → 404 | `asset-library` |

**Browser walkthrough A** — bundle `asset-library`. Contexts: **A** DM, **B** `player-1`. Asset IDs from the load manifest.

| # | Step | Expected |
|---|---|---|
| 1 | A logs in, opens the picker | 7 items, newest first, thumbnails render; "Town (copy)" absent |
| 2 | A uploads `fixtures/assets/maps/battlemap.svg` | Toast "Already uploaded"; still 7 items |
| 3 | A uploads the step-1 screenshot PNG | Progress, "Processing…", new item selected; 8 items |
| 4 | A uploads any `.txt` file | "Unsupported file type"; 8 items |
| 5 | B opens link; in B's page, fetch `display` of `town` and `original` of the new upload with B's credential | Both 404 (nothing references them yet) |
| 6 | Reload A; hard-kill and restart the server | Same 8 items, thumbnails render |
| 7 | A switches to Second Campaign, opens picker; then switches back | Only "Town (copy)"; then the 8 items |

**Browser walkthrough B** — bundle `session-sim` + `player-2`, after [scenes-map](scenes-map.md) ships (Scenes gate). Contexts A DM, B `player-1`, C `player-2`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | Open links | Town map + Mira render; network shows only those asset IDs; direct fetch of `battlemap`, `token-wolf` → 404 |
| 2 | Activate battlemap | — | Battlemap, Mira, goblin render; `token-wolf`, `token-elite` never requested, direct fetch 404 |
| 3 | Reveal wolf | — | Wolf art renders ≤ 1 s; direct fetch 200 |
| 4 | — | B reloads | Same view; images from browser cache |
| 5 | Hard-kill, restart | — | All reconnect, images render; `token-elite` still 404 |
| 6 | Hide wolf | — | Wolf gone; direct fetch 404 |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Registry accepts asset-reference fields; snapshot providers + visibility fns callable for the HTTP access check | open: [proposed ADR](../architecture/adr/proposed-asset-access-by-reference.md) |
| [campaign-management](campaign-management.md) | Resolve DM / player credential on REST routes; player credentials excluded from the DM throttle | open: OQ-ASSET-01 |
| [scenes-map](scenes-map.md) | Declares scene map + token art as asset references, uses `assets.require`, hosts the picker; map `display`, tokens `thumb`; grid space (OQ-ASSET-07) | open |
| [entities](entities.md) | Portrait as asset reference; same rules | open |
| [play-shell](play-shell.md) | "Images" entry (OQ-ASSET-08) | open |
| [fixtures-adapters](fixtures-adapters.md) | Loader passes SVG bytes to `assets.ingest`; manifest lists asset IDs by fixture key | agreed (FR-FIX-17) |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ASSET-01 | How are asset fetches authorised? | **Credential header (as other REST) + reference check; clients load via fetch → object URL** (one route, no secret in any asset URL; loader code) / link token in the asset path for players, header for DM (native `<img>`; token in more URLs, two routes) / asset ID as capability, no check (simplest; any seen or leaked ID works forever, edge-cacheable) | yes | live-sync, campaign-management, scenes-map, entities |
| OQ-ASSET-02 | Player uploads (e.g. own portrait)? | **No in MVP: not tier S; revisit with character builder** / portrait only (ownership rule + quota) | no · owner: spec-assets-pipeline | character-sheet |
| OQ-ASSET-03 | Derivative set | **`thumb` ≤ 512 + `display` ≤ 4096, WebP; original DM-only** (two files, covers map and tokens) / original + thumb (originals over tunnel) / on-demand sizes (cache complexity) | no · owner: spec-assets-pipeline | scenes-map |
| OQ-ASSET-04 | Asset scope | **Row per campaign, files shared by hash; global imported art post-MVP** (fits ADR-0018) / global library (contradicts ADR-0004 for custom uploads) | no · owner: spec-assets-pipeline | campaign-management |
| OQ-ASSET-05 | Delete / garbage collection | **No delete in MVP; orphan files swept at start; DM deletes unreferenced assets with the tier-A library** (no dangling refs) / ref-counted auto delete (surprising loss) / never | no · owner: spec-assets-pipeline | scenes-map |
| OQ-ASSET-06 | Upload limits and formats | **25 MB, 50 MP, PNG / JPEG / WebP / SVG** (covers real battlemaps) / higher (slower ingest) | no · owner: DM | — |
| OQ-ASSET-07 | Grid calibration pixel space | **`display` pixels; asset exposes display size** (what players render) / original pixels + scale | no · owner: scenes-map | scenes-map |
| OQ-ASSET-08 | Where the DM opens the picker outside scene prep | **"Images" entry in the DM menu** (lets walkthrough A run before scenes-map) / only from scene/token flows | no · owner: play-shell | play-shell |
| OQ-ASSET-09 | Glossary: add **Asset reference** | **"A record field holding an asset ID; makes the asset fetchable by any client that sees the field"** / no term | no · owner: integrator | all specs with images |

## 16. Out of scope

- Token art library with folders, tags, search (tier A); handouts ([party-board](post-mvp/party-board.md)); preload and player-ready ([scene-tools](post-mvp/scene-tools.md)); art for imported definitions ([compendium](post-mvp/compendium.md)).
