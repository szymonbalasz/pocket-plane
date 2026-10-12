---
title: Assets pipeline
prefix: ASSET
status: complete
owner: spec-assets-pipeline
wave: 1
---

# Assets pipeline

## 1. Summary

- Ingest, store and serve images: map images and token art/portraits ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). One ingest command for DM uploads and fixture SVGs. Files content-hashed, derivatives via `sharp` ([ADR-0001](../architecture/adr/0001-tech-stack.md)).
- Served from the DM's laptop over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)): small WebP derivatives, browser-cached forever, never edge-cached.
- **Player access: the random, unguessable asset ID is the capability; players learn IDs only through the filtered sync** (decided, #123; [ADR-0023]($10023-asset-access-by-capability-id.md)). Hidden tokens and inactive scenes never reveal their image IDs.

## 2. Scope

- Ingest (DM upload over REST; fixture loader in-process), dedupe per campaign by hash, derivatives `thumb` + `display`. Asset record per campaign (DM only); serving by ID; client image loader; DM asset picker with upload. `assets.require` for specs that store asset IDs. Fixture `images` ([fixtures-adapters §8](fixtures-adapters.md#8-data-model)), test fixtures, bundles.

## 3. Goals

- **No ID leakage:** a player never receives an asset ID except as a field of a record they can see.
- A typical map reaches 6 players over the tunnel in seconds and is downloaded once per browser.
- One write path for UI and fixtures ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)); a crash never leaves an asset row without its files.

## 4. Non-goals

- Preload, load progress, player-ready (ADR-0003's "preloaded" is deferred by [ADR-0014](../architecture/adr/0014-mvp-scope.md): assume immediate load). Preloading an inactive scene would reveal its IDs early; it needs a player-visible preload grant (post-MVP, [scene-tools](post-mvp/scene-tools.md)).
- Token art library / standalone image browser (tier A). Player uploads (OQ-ASSET-02). Rename, delete, replace, revoke an asset (OQ-ASSET-05). Image editing. Audio/video ([ADR-0007](../architecture/adr/0007-product-scope.md)). Cloud storage, CDN.

## 5. User stories

- **DM:** As the DM, I want to upload a map or token image and pick it again later, so scene prep stays in the app.
- **DM:** As the DM, I want hidden enemies and the next battlemap to stay secret even from a player with dev tools open.
- **Player:** As a player, I want the map and tokens to appear quickly when the DM switches scene, and instantly when we come back to it.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-ASSET-01 | One command `assets.ingest {bytes, filename, name?}` → `{asset, outcome: created \| existing}`. Called by the REST upload (DM, `Authorization: Bearer <secret>`, CON-08) and the fixture loader (FR-FIX-17); DM authority. Format detected from content, never from extension or Content-Type. | |
| FR-ASSET-02 | Accepted: PNG, JPEG, WebP, SVG; animated → first frame. SVG rasterised at ingest at intrinsic size, stored as PNG, never stored or served as SVG; no width/height and no viewBox → 422; megapixels from those attributes; external references (file or URL `href`) never resolved. Other formats → 415. Body > 25 MB → 413 without reading further. > 50 megapixels (from the header, before pixel decode) or corrupt → 422. Nothing written on any rejection. | *(proposed)* OQ-ASSET-06 |
| FR-ASSET-03 | `hash` = SHA-256 of the stored original. Unique per `(campaignId, hash)`: re-ingesting the same image in a campaign → `existing` with the existing asset; no row, file, event or log entry. Name of the second upload ignored. | Dedupe |
| FR-ASSET-04 | Files stored once per hash under `PP_ASSET_DIR`, shared by every campaign's row with that hash. Written to a temp dir in `PP_ASSET_DIR`, then renamed; an existing hash dir is reused untouched. | Disk dedupe |
| FR-ASSET-05 | Derivatives made at ingest: `thumb` WebP, long edge ≤ 512 px; `display` WebP, long edge ≤ 4096 px. Never upscaled; aspect kept; EXIF orientation applied; metadata stripped; alpha kept. | *(proposed)* OQ-ASSET-03 |
| FR-ASSET-06 | All files are on disk before the row + event-log entry commit in one transaction; `AssetIngested` dispatches after commit ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). | |
| FR-ASSET-07 | On server start: delete the temp dir and every hash dir no asset row references. An asset missing any file is logged as an error; its files answer 404. | Crash recovery |
| FR-ASSET-08 | `id` = 128 bits from `ctx.tokens`, base64url (it is the capability, FR-ASSET-11); `seq` = monotonic insertion order; `createdAt` from `ctx.clock` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). Name = `name` or filename without extension; trimmed, control characters removed, 1–80 chars (else `invalid`); not unique. | |
| FR-ASSET-09 | An asset belongs to `ctx.campaignId`, resolved when the request is authenticated ([FR-CAMP-11](campaign-management.md#6-functional-requirements)). No context ever lists or receives another campaign's `asset` record. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-ASSET-10 | Record type `asset`: scope `campaign`; DM `full`, player `hidden`. Snapshot: all the campaign's assets; array order not significant. Picker order: `createdAt` desc, then `seq` desc. | [FR-SYNC-18](live-sync.md#6-functional-requirements) |
| FR-ASSET-11 | `GET /api/assets/:id/:file`, `file` ∈ `thumb \| display`. No credential: knowing the ID is the permission (#123). Served iff the asset exists and belongs to the active campaign. Originals are never served. | Same for DM and players |
| FR-ASSET-12 | Asset IDs reach a player only as fields of records that player receives through the filtered sync (snapshot or record change). Never in a REST body, error, toast, URL or log a player can read. Specs that store asset IDs drop or redact those fields where the player may not see the image. Bytes already loaded stay usable after a hide (accepted). | Owning specs' visibility fns |
| FR-ASSET-13 | GET denials (unknown ID, inactive or other campaign's asset, invalid `file`) → the same 404 body. POST: missing or wrong DM secret → 401 ([FR-CAMP-04](campaign-management.md#6-functional-requirements)); throttled → 429 ([FR-CAMP-05](campaign-management.md#6-functional-requirements)). | No existence oracle |
| FR-ASSET-14 | 200 responses: exact `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `ETag: "<id>-<file>"`, `X-Content-Type-Options: nosniff`. `If-None-Match` → 304 only when FR-ASSET-11 would serve. | `private`: no Cloudflare edge copy outside the active-campaign check |
| FR-ASSET-15 | Every command that sets an asset-ID field calls `assets.require(ctx, id)` → `not_found` unless it is an asset of `ctx.campaignId`. Propagated copies (e.g. token image from a definition edit, #120) are written in the same transaction. | Same campaign only |
| FR-ASSET-16 | Client loader (`@ui`): `assetUrl(id, file)`; `useAssetImage(id, file)` → native image element for DOM and Konva, states `loading \| ready \| error`, one load per URL shared by all consumers. An `error` load retries once after the next reconnect snapshot; otherwise final until a new record change carries the ID. | Both clients |
| FR-ASSET-17 | DM asset picker: the campaign's assets (thumb, name, display size); upload via file input or drop; "Select" returns the asset ID. Upload disabled unless `live`. Upload: progress %, then "Processing…"; `existing` → Toast "Already uploaded"; on `created` / `existing` the item is selected once the `asset` record with that ID is in the store (after the reconnect snapshot if not `live`). 413 / 415 / 422 / other → inline error naming the cause. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-ASSET-18 | Fixture `images` ingests committed SVGs via FR-ASSET-01. Two loads of a bundle give identical asset IDs and record fields; on the same machine also identical hashes and file bytes. | [FR-FIX-08](fixtures-adapters.md#6-functional-requirements) |
| FR-ASSET-19 | Test mode only (`PP_TEST_MODE=1`): DM window type `asset.test` ([FR-SHELL-07](play-shell.md#6-functional-requirements)) hosting the picker. Absent otherwise. | *(proposed)* OQ-ASSET-08 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Dialog, Progress, Alert, Toast, Tooltip; dark only. Test IDs per [AGENTS §9.5](../../AGENTS.md#95-test-ids).

- **DM picker** (Dialog, opened by scene / token / portrait flows; `asset.test` window in test mode): thumbnail grid with name; Tooltip shows display size and MB. Test IDs: `asset-picker`, `asset-picker-item` + `data-record-id`, `asset-picker-upload`, `asset-picker-file-input`, `asset-picker-select`, `asset-upload-progress`, `asset-upload-error`.
- **States:** empty "No images yet. Upload a map or token art." · loading: skeleton tiles · uploading: Progress, then "Processing…" · error: inline Alert ("Unsupported file type", "File over 25 MB", "Image over 50 megapixels", "Upload failed, try again") · disconnected: upload disabled, live-sync banner.
- **Images on screen** (canvas: [scenes-map](scenes-map.md); portraits: [entities](entities.md)): placeholder while `loading`, neutral broken-image placeholder on `error`. Map → `display`; token art, portraits, pickers → `thumb`.
- **Player view:** no asset UI. Images appear as their records arrive; nothing says an image was withheld.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Asset | id, campaignId | ID (128-bit token, FR-ASSET-08), ID → Campaign | Unique `(campaignId, hash)` |
| | seq | int | Insertion order; picker tiebreak |
| | name | text | 1–80 |
| | hash | text | SHA-256 hex of the original; server-only (not in the `asset` record) |
| | mime, bytes, width, height; displayWidth, displayHeight | text, int ×3; int ×2 | Stored original; `display` (grid calibration, OQ-ASSET-07) |
| | createdAt | timestamp | Clock seam |
| Asset files *(disk)* | `<hash>/original`, `display.webp`, `thumb.webp` | files | Layout *(proposed)*; one set per hash |

- **Relations:** Campaign 1—* Asset. Asset-ID fields: `Scene.mapAssetId`, `Token.imageAssetId` ([scenes-map](scenes-map.md)), `Entity.portraitAssetId` ([entities](entities.md)): many records → one asset, same campaign only (FR-ASSET-15). Imported (global) definitions carry no asset in MVP.
- **Derived values:** `thumb` size. **Persisted runtime state:** none beyond rows and files. No JSON leaf fields; files are not records.

## 9. API & events

**REST (Hono RPC).** WS intents: none (uploads are REST, [OQ-SYNC-04](live-sync.md#15-open-questions)). Signals: none.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/assets` | DM (`Bearer`) | Multipart `file`, optional `name` → `201 {asset}` created / `200 {asset}` existing / 400, 401, 413, 415, 422, 429 |
| GET | `/api/assets/:id/:file` | anyone holding the ID | Serve per FR-ASSET-11, -13, -14 |

**Record types and events** (generic record changes `{type, id, op, data}` + `cause`, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md))

| Record type | Scope | Visibility rule | Snapshot |
|---|---|---|---|
| `asset {id, campaignId, seq, name, mime, bytes, width, height, displayWidth, displayHeight, createdAt}` | `campaign` | DM `full`; player `hidden` | All of the campaign's assets |

| Domain event | Changes | Logged | Transient | Undoable |
|---|---|---|---|---|
| `AssetIngested {assetId, hash, bytes}` | `asset` upsert | yes | no | no |

- `existing` outcome emits nothing. **Server API for other specs:** `assets.require(ctx, id)` (FR-ASSET-15).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Upload / ingest | ✓ | ✗ (OQ-ASSET-02) | DM credential; default-DM command |
| See asset list | ✓ | ✗ | `asset` visibility = DM only |
| Fetch `thumb` / `display` | Any ID it holds | Any ID it holds (learned only via FR-ASSET-12) | Asset exists in the active campaign |
| Set an asset-ID field | Per owning spec | Per owning spec | `assets.require` (same campaign) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** loaded images stay; after the snapshot the loader fetches only new IDs (browser cache otherwise) and retries `error` loads once. **DM:** a finished upload arrives in the snapshot and is then selected; a failed one shows "Upload failed, try again"; retrying is safe (FR-ASSET-03).
- **Server crash mid-action:** before commit → no row; temp and orphan files removed at next start (FR-ASSET-07). After commit → asset complete; re-upload returns `existing`.
- **Concurrent edits:** two tabs upload the same image → one `created`, one `existing` (DB uniqueness). Same image in two campaigns → two rows, two IDs, one file set. Campaign switched mid-upload → the asset lands in the campaign active when the upload was authenticated; the DM sees it after switching back.
- **Reveal / hide:** reveal sends the record, so the player learns the ID then; after a hide the ID still works for that player (bytes were legitimately seen).
- **Invalid / malicious input:** guessing a 128-bit ID is infeasible; leaked IDs work until revoke exists (post-MVP, OQ-ASSET-05); `id` and `file` zod-validated, never used as paths; decompression bombs stopped by the pixel limit; SVG never served; renamed `.png` text file → 415. Seeded fixture IDs are predictable: fixture data is never tunnelled ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)).

## 12. Performance & bandwidth

- Budgets *(proposed)*: ingest of a 50 MP image incl. derivatives ≤ 5 s on the DM laptop; `images` fixture ≤ 300 ms in-process (share of FR-FIX-10); DM snapshot ≤ ~300 assets × ~250 B ≈ 75 KB (revisit with the tier-A library).
- Map `display` 1–3 MB per player; 6 players ≈ 5–15 s at 10 Mbit/s DM upload; token `thumb` ≲ 50 KB; revisits 0 bytes.
- Files streamed from disk; no derivatives on request; originals never leave the laptop.

## 13. Test plan

Isolated per worktree: `bun test` uses `:memory:` DB + temp asset dir per file; walkthroughs use the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)).

**Fixtures** (canonical: `base`, `player-1`, `player-2`, `campaign-second`; added here, SVGs under `fixtures/assets/`)

| Fixture | Contents | In `session-sim` |
|---|---|---|
| `images` | Fixture Campaign: `town` (1400 × 980 *(proposed)*), `battlemap` (1400 × 980 = 20 × 14 at 70 px), `token-mira` blue, `token-goblin` green, `token-wolf` grey, `token-elite` dark green (256 × 256 round) | yes |
| `image-large` | `map-large` 6000 × 4000 SVG → `display` 4096 × 2731, `thumb` 512 × 341 | no |
| `images-second` | Activates Second Campaign, ingests `town.svg` as "Town (copy)", re-activates Fixture Campaign. Requires `campaign-second`, `images` | no |

**Bundles:** `asset-library` = `base` + `player-2` + `campaign-second` + `images` + `image-large` + `images-second`. `asset-access` = `session-sim` + `player-2`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Format sniffing; SVG size rules; size maths (no upscale, aspect); name rules; headers; picker order with equal `createdAt`; identical 404 body across denial causes | In-code |
| Integration | Created / existing; cross-campaign rows share files, IDs differ; 413/415/422 write nothing; SVG external `href` not fetched; injected crash after files → no row, swept at start; one log entry per `created`; determinism; IDs 128-bit from `ctx.tokens`; `asset` never in player frames; inactive / other-campaign / unknown ID / `original` → 404; 304 only when servable; POST 401 / 429. **Leak property:** with a test-only record type (visible / hidden / redacted without the ID / scene-scoped), after any change sequence every asset ID found by string scan in a player's frames is in a record that player may see | `asset-library` + test type |
| E2E (thin) | DM uploads via the `asset.test` picker, item appears; unknown ID → 404 | `asset-library`, test mode |

**Browser walkthrough A** (assets build done = A + the leak-property test) — `asset-library`, verify profile, `PP_TEST_MODE=1`. Contexts **A** DM, **B** `player-1`. IDs from the load manifest; "direct fetch" = request from B's page.

| # | Step | Expected |
|---|---|---|
| 1 | A logs in, opens the `asset.test` window | 7 items in load order reversed, thumbnails render; "Town (copy)" absent |
| 2 | A uploads `fixtures/assets/maps/battlemap.svg`, then the step-1 screenshot PNG, then any `.txt` | "Already uploaded", `battlemap` selected (7); progress, "Processing…", new item selected (8); "Unsupported file type" (8) |
| 3 | B opens link; leak scan of B's WS frames; direct fetch of a random ID, `town` `original`, "Town (copy)" `display` | No asset ID in any frame; all three 404 |
| 4 | Reload A; hard-kill and restart the server | Same 8 items, thumbnails render |
| 5 | A switches to Second Campaign, opens the window; direct fetch of `town` `display`; switches back | Only "Town (copy)"; 404; then the 8 items |

**Browser walkthrough B** — `asset-access`; run at the Scenes gate by scenes-map's test agent. Contexts A DM, B `player-1`, C `player-2`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | Open links | Town map + Mira render; frames and requests carry only `town`, `token-mira` IDs |
| 2 | Activate battlemap | — | Battlemap, Mira, goblin render; `token-wolf`, `token-elite` IDs absent from all player frames and requests |
| 3 | Reveal wolf | B reloads | Wolf renders ≤ 1 s; after reload same view, images from browser cache |
| 4 | Hard-kill, restart; then hide wolf | — | All reconnect, images render, `token-elite` ID still absent; wolf gone from canvas |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Register record type `asset` (no registry change). §12 "Assets are URLs" to read "records carry asset IDs; clients build the URL" (integrator) | agreed |
| [campaign-management](campaign-management.md) | DM `Bearer` on POST, 401 / 429 (FR-CAMP-04/05); `ctx.campaignId` at authentication (FR-CAMP-11). No player REST credential (#123) | agreed |
| [scenes-map](scenes-map.md) | `Scene.mapAssetId`, `Token.imageAssetId` set via `assets.require`; sent only on records the player sees (FR-ASSET-12); picker in its flows; map `display`, token `thumb`; OQ-ASSET-07. FR-MAP-19 "fetchable" → "ID reaches players" | open |
| [entities](entities.md) | `portraitAssetId` set via `assets.require` (FR-ENT-08/11); kept in FR-ENT-15 redaction, so all players learn character portrait IDs; monster portrait IDs reach players only via visible tokens' copies, written in the edit's transaction (#120) | open: OQ-ASSET-10 |
| [play-shell](play-shell.md) | Window registry (FR-SHELL-07) for `asset.test`; no shell change | agreed |
| [fixtures-adapters](fixtures-adapters.md) | Loader passes SVG bytes to `assets.ingest`; manifest lists asset IDs by fixture key. Add `image-large`, `images-second`, bundles `asset-library`, `asset-access` to FIX §8 at merge (integrator) | agreed (FR-FIX-17) |
| [data model](../data-model/README.md) | Asset `id` from `ctx.tokens`, not `ctx.ids` (consolidation, integrator) | open |

## 15. Open questions

**Bold** option = suggested pick unless the row says Decided.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ASSET-01 | ~~How are asset fetches authorised?~~ | **Decided (#123): random unguessable asset IDs are the capability; players learn IDs only via the filtered sync; no player REST credential, reference check or custom loader** | no (decided) | live-sync, campaign-management, scenes-map, entities |
| OQ-ASSET-02 | Player uploads (e.g. own portrait)? | **No in MVP: not tier S; revisit with character builder** / portrait only (ownership rule + quota) | no · owner: spec-assets-pipeline | character-sheet |
| OQ-ASSET-03 | Derivative set | **`thumb` ≤ 512 + `display` ≤ 4096, WebP; original never served** / original + thumb (originals over tunnel) / on-demand sizes (cache complexity) | no · owner: spec-assets-pipeline | scenes-map |
| OQ-ASSET-04 | Asset scope | **Row per campaign, files shared by hash** / global library (contradicts ADR-0004) | no · owner: spec-assets-pipeline | campaign-management |
| OQ-ASSET-05 | Delete / revoke | **No delete or revoke in MVP; orphan files swept at start; with the tier-A library: delete unreferenced assets, re-key a leaked ID** / ref-counted auto delete (surprising loss) | no · owner: spec-assets-pipeline | scenes-map |
| OQ-ASSET-06 | Upload limits and formats | **25 MB, 50 MP, PNG / JPEG / WebP / SVG** (covers real battlemaps) / higher (slower ingest) | no · owner: DM | — |
| OQ-ASSET-07 | Grid calibration pixel space | **`display` pixels; asset exposes display size** (what players render; OQ-MAP-15 agrees) / original pixels + scale | no · owner: scenes-map | scenes-map |
| OQ-ASSET-08 | Where can the DM open the picker outside scene / token / portrait flows? | **Test-mode-only window `asset.test` (like `shell.test`, FR-SHELL-23)** (no product scope; walkthrough A runs before scenes-map) / DM window `asset.images` (≈ tier-A library) / host flows only | no · owner: spec-assets-pipeline | play-shell |
| OQ-ASSET-09 | ~~Glossary: add **Asset reference**~~ | **Decided (integrator, Scenes consolidation):** added to the [glossary](../glossary.md) as suggested | no (decided) | all specs with images |
| OQ-ASSET-10 | entities: FR-ENT-08/11 call `assets.require` for `portraitAssetId` | **yes** / — | no · owner: spec-entities | entities |

## 16. Out of scope

- See §4. Also art for imported definitions ([compendium](post-mvp/compendium.md)); handouts ([party-board](post-mvp/party-board.md)) reuse the store and loader.
