---
title: Assets pipeline
prefix: ASSET
status: in-review
owner: spec-cmpimg
wave: 1
phase: post-mvp-5
---

# Assets pipeline

> **Sprint 5 revision, tracks P and C.** **Track P (DM [#250](../decisions-log.md) [10] [11] [12], [#251](../decisions-log.md)):** one shared **image attach control** in `src/client/common/` (asset picker + direct upload + drop + clipboard paste, returning asset IDs), built once by track P and consumed by handouts ([party-board](party-board.md) FR-PARTY-39) and compendium entry images (track C). Uploads and pastes made through it are **attachments**: asset rows outside the library and every snapshot (decided #256, OQ-ASSET-12). New FR-ASSET-20–27; amended FR-ASSET-01, -03, -10, -17. DM questions OQ-ASSET-11–14 decided at sprint-5 gate 1 ([#256](../decisions-log.md)): every pick accepted. CON-44 measured ([§12](#12-performance--bandwidth)).
>
> **Track C (compendium images, DM [#250](../decisions-log.md) [10] [12]):** compendium homebrew entries hold image asset IDs ([compendium FR-CMP-45–53](compendium.md#6-functional-requirements)). Entries are read over REST, not the WS, so a player learns those IDs from a compendium REST body: **FR-ASSET-12 gains one exception** (FR-ASSET-36, [ADR, accepted #256](../architecture/adr/proposed-s5-cmpimg-rest-asset-ids.md) amending ADR-0023; OQ-ASSET-17). New FR-ASSET-35–38; amended FR-ASSET-12. 0 B to any snapshot (measured, [CMP §12](compendium.md#12-performance--bandwidth)).

### Sprint 5 at a glance

| FR | What | Slice ([PARTY §14.2](party-board.md#142-sprint-5-build-split)) | Named test (§13) |
|---|---|---|---|
| FR-ASSET-20–23 | `ImageAttach` contract, upload queue, paste, drop, library | P1 `build/image-attach` | `FR-ASSET-20 contract`, `FR-ASSET-22 paste creates an asset`, `FR-ASSET-23 refusals` |
| FR-ASSET-24–26 | Attachments: `listed = false`, upload field, dedupe and listing | P0 core | `FR-ASSET-24 attachment not in any snapshot`, `FR-ASSET-26 listing on re-upload` |
| FR-ASSET-27 | DM only; uploader context; `asset.test` hosts the control | P1 | `FR-ASSET-27 no player upload` |
| FR-ASSET-35, -37 | *(C)* Entry images as asset references; stale IDs dropped at the compendium read | C5 core ([CMP §14](compendium.md#14-dependencies)) | CMP `FR-CMP-46 assets.require refusal`, `FR-CMP-47 asset deleted` |
| FR-ASSET-36, -38 | *(C)* REST-body exception (ADR, #256); leak property over REST incl. ETag | C5 core | `FR-ASSET-36 leak property over REST` |

## 1. Summary

- Ingest, store and serve images: map images and token art/portraits ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). One ingest command for DM uploads and fixture SVGs. Files content-hashed, derivatives via `sharp` ([ADR-0001](../architecture/adr/0001-tech-stack.md)).
- Served from the DM's laptop over the tunnel ([ADR-0003](../architecture/adr/0003-local-hosting.md)): small WebP derivatives, browser-cached forever, never edge-cached.
- **Player access: the random, unguessable asset ID is the capability; players learn IDs only through the filtered sync** (decided, #123; [ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)). Hidden tokens and inactive scenes never reveal their image IDs.
- *(S5)* An **image attach control** lets the DM add images to a form by upload, drop, paste or the library; new images become **attachments** (asset rows the library doesn't list), so pasting never grows any snapshot.

## 2. Scope

- Ingest (DM upload over REST; fixture loader in-process), dedupe per campaign by hash, derivatives `thumb` + `display`. Asset record per campaign (DM only); serving by ID; client image loader; DM asset picker with upload. `assets.require` for specs that store asset IDs. Fixture `images` ([fixtures-adapters §8](fixtures-adapters.md#8-data-model)), test fixtures, bundles.
- *(S5)* Image attach control (FR-ASSET-20–23, -27); attachments (`asset.listed`, FR-ASSET-24–26). Callers this sprint: the handout editor (P), the compendium homebrew form's image slots (track C). **Not in S5:** player uploads (OQ-ASSET-02, OQ-ASSET-14), paste into other text areas (sheet notes, scene notes; OQ-ASSET-13 b), inline images in text (OQ-ASSET-13 B), delete / revoke (OQ-ASSET-05).
- *(S5, track C)* Compendium entry images as asset references, the REST-body rule for them, stale-reference handling and the leak property over REST (FR-ASSET-35–38).

## 3. Goals

- **No ID leakage:** a player never receives an asset ID except as a field of a record they can see.
- A typical map reaches 6 players over the tunnel in seconds and is downloaded once per browser.
- One write path for UI and fixtures ([ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)); a crash never leaves an asset row without its files.
- *(S5)* A screenshot pasted into a handout is in its image strip ≤ 2 s later (local upload); pasting adds 0 B to any snapshot.

## 4. Non-goals

- Preload, load progress, player-ready (ADR-0003's "preloaded" is deferred by [ADR-0014](../architecture/adr/0014-mvp-scope.md): assume immediate load). Preloading an inactive scene would reveal its IDs early; it needs a player-visible preload grant (post-MVP, [scene-tools](scene-tools.md)).
- Token art library / standalone image browser (tier A). Player uploads (OQ-ASSET-02). Rename, delete, replace, revoke an asset (OQ-ASSET-05). Image editing. Audio/video ([ADR-0007](../architecture/adr/0007-product-scope.md)). Cloud storage, CDN.

## 5. User stories

- **DM:** As the DM, I want to upload a map or token image and pick it again later, so scene prep stays in the app.
- **DM:** As the DM, I want hidden enemies and the next battlemap to stay secret even from a player with dev tools open.
- **Player:** As a player, I want the map and tokens to appear quickly when the DM switches scene, and instantly when we come back to it.
- *(S5)* **DM:** As the DM, I want to paste or drop an image straight into the form I'm writing, without first going through the asset library, and without my library filling up with screenshots.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-ASSET-01 | One command `assets.ingest {bytes, filename, name?}` → `{asset, outcome: created \| existing}`. Called by the REST upload (DM, `Authorization: Bearer <secret>`, CON-08) and the fixture loader (FR-FIX-17); DM authority. Format detected from content, never from extension or Content-Type. *(S5: + `listed?: boolean`, default true, FR-ASSET-24.)* | |
| FR-ASSET-02 | Accepted: PNG, JPEG, WebP, SVG; animated → first frame. SVG rasterised at ingest at intrinsic size, stored as PNG, never stored or served as SVG; no width/height and no viewBox → 422; megapixels from those attributes; external references (file or URL `href`) never resolved. Other formats → 415. Body > 25 MB → 413 without reading further. > 50 megapixels (from the header, before pixel decode) or corrupt → 422. Nothing written on any rejection. | *(proposed)* OQ-ASSET-06 |
| FR-ASSET-03 | `hash` = SHA-256 of the stored original. Unique per `(campaignId, hash)`: re-ingesting the same image in a campaign → `existing` with the existing asset; no row, file, event or log entry. Name of the second upload ignored. *(S5: except listing an attachment, FR-ASSET-26.)* | Dedupe |
| FR-ASSET-04 | Files stored once per hash under `PP_ASSET_DIR`, shared by every campaign's row with that hash. Written to a temp dir in `PP_ASSET_DIR`, then renamed; an existing hash dir is reused untouched. | Disk dedupe |
| FR-ASSET-05 | Derivatives made at ingest: `thumb` WebP, long edge ≤ 512 px; `display` WebP, long edge ≤ 4096 px. Never upscaled; aspect kept; EXIF orientation applied; metadata stripped; alpha kept. | *(proposed)* OQ-ASSET-03 |
| FR-ASSET-06 | All files are on disk before the row + event-log entry commit in one transaction; `AssetIngested` dispatches after commit ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). | |
| FR-ASSET-07 | On server start: delete the temp dir and every hash dir no asset row references. An asset missing any file is logged as an error; its files answer 404. | Crash recovery |
| FR-ASSET-08 | `id` = 128 bits from `ctx.tokens`, base64url (it is the capability, FR-ASSET-11); `seq` = monotonic insertion order, assigned by the DB at insert (CON-20); `createdAt` from `ctx.clock` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). Name = `name` or filename without extension; trimmed, control characters removed, 1–80 chars (else `invalid`); not unique. | |
| FR-ASSET-09 | An asset belongs to `ctx.campaignId`, resolved when the request is authenticated ([FR-CAMP-11](campaign-management.md#6-functional-requirements)). No context ever lists or receives another campaign's `asset` record. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-ASSET-10 | Record type `asset`: scope `campaign`; DM `full`, player `hidden`. Snapshot: all the campaign's assets *(S5: **listed** assets only, FR-ASSET-24)*; array order not significant. Picker order: `createdAt` desc, then `seq` desc. | [FR-SYNC-18](live-sync.md#6-functional-requirements) |
| FR-ASSET-11 | `GET /api/assets/:id/:file`, `file` ∈ `thumb \| display`. No credential: knowing the ID is the permission (#123). Served iff the asset exists and belongs to the active campaign. Originals are never served. | Same for DM and players |
| FR-ASSET-12 | Asset IDs reach a player only as fields of records that player receives through the filtered sync (snapshot or record change). Never in a REST body, error, toast, URL or log a player can read. Specs that store asset IDs drop or redact those fields where the player may not see the image. Bytes already loaded stay usable after a hide (accepted). *(S5: one exception, compendium REST bodies under `entryVisibleTo`, FR-ASSET-36.)* | Owning specs' visibility fns |
| FR-ASSET-13 | GET denials (unknown ID, inactive or other campaign's asset, invalid `file`) → the same 404 body. POST: missing or wrong DM secret → 401 ([FR-CAMP-04](campaign-management.md#6-functional-requirements)); throttled → 429 ([FR-CAMP-05](campaign-management.md#6-functional-requirements)). | No existence oracle |
| FR-ASSET-14 | 200 responses: exact `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `ETag: "<id>-<file>"`, `X-Content-Type-Options: nosniff`. `If-None-Match` → 304 only when FR-ASSET-11 would serve. | `private`: no Cloudflare edge copy outside the active-campaign check |
| FR-ASSET-15 | Every command that sets an asset-ID field calls `assets.require(ctx, id)` → `not_found` unless it is an asset of `ctx.campaignId`. Propagated copies (e.g. token image from a definition edit, #120) are written in the same transaction. | Same campaign only |
| FR-ASSET-16 | Client loader (`@ui`): `assetUrl(id, file)`; `useAssetImage(id, file)` → native image element for DOM and Konva, states `loading \| ready \| error`, one load per URL shared by all consumers. An `error` load retries once after the next reconnect snapshot; otherwise final until a new record change carries the ID. | Both clients |
| FR-ASSET-17 | DM asset picker: the campaign's assets (thumb, name, display size); upload via file input or drop; "Select" returns the asset ID. Upload disabled unless `live`. Upload: progress %, then "Processing…"; `existing` → Toast "Already uploaded"; on `created` / `existing` the item is selected once the `asset` record with that ID is in the store (after the reconnect snapshot if not `live`). 413 / 415 / 422 / other → inline error naming the cause. *(S5: lists listed assets only; moves to `@ui` and is reused by the attach control's "From library", FR-ASSET-23; its own uploads stay listed.)* | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-ASSET-18 | Fixture `images` ingests committed SVGs via FR-ASSET-01. Two loads of a bundle give identical asset IDs and record fields; on the same machine also identical hashes and file bytes. | [FR-FIX-08](fixtures-adapters.md#6-functional-requirements) |
| FR-ASSET-19 | Test mode only (`PP_TEST_MODE=1`): DM window type `asset.test` ([FR-SHELL-07](play-shell.md#6-functional-requirements)) hosting the picker. Absent otherwise. *(S5: also hosts an attach control, FR-ASSET-27.)* | *(proposed)* OQ-ASSET-08 |

### 6.1 Sprint 5: image attach control and attachments

| ID | Requirement | Notes |
|---|---|---|
| FR-ASSET-20 | **Image attach control** `ImageAttach` (`src/client/common/features/assets-pipeline/attach/`, `@ui`), one component for every form that holds image asset IDs. **Props:** `max: number` (the caller's slot cap) and `count: number` (images the caller holds now); remaining = `max − count − queued − in flight` (review #17), 0 → adding disabled with "No more images (‹max›)"; `onAdd(assetId: string)`, called once per finished image, in pick / upload order; `owner: string` (test-ID scope, `data-owner`); `pasteTarget?` / `dropTarget?: RefObject<HTMLElement>` (paste / drop anywhere inside them is handled; default: the control itself; the ref may point **inside a portal**, e.g. a Dialog's content: the listener attaches to the ref's element, seams S5); `library?: boolean` (default true: shows **From library**); `disabled?: boolean` (host form busy). Renders: **Upload** Button (file input, `multiple`), **From library** Button, hint "or drop / paste an image", a progress line and an error Alert. It never holds the list of images: the caller owns order, removal and the slot layout. **Dedupe is the caller's** (seams S5): the control may return an id the caller already holds (same bytes → same id, FR-ASSET-26); there is no `heldIds` prop; the caller skips it and says so (handouts "Already in this handout", C "Already in this entry"). | [11] [12]; OQ-ASSET-11 |
| FR-ASSET-21 | **Upload queue**: files from a pick, a drop or a paste go through one queue, **one upload at a time**, each `POST /api/assets` with `listed=false` (FR-ASSET-24). Files beyond the remaining slots (files already queued or uploading count) are not sent: "Only ‹n› more images" (the first n are). Before sending, client pre-checks: type ∈ PNG, JPEG, WebP, SVG by MIME → else "Unsupported file type"; size > 25 MB → "File over 25 MB"; the server stays authoritative (FR-ASSET-02: sniffed format, 413 / 415 / 422). Progress: "Uploading ‹i› of ‹n› · ‹pct› %", then "Processing…". A failed file shows its error with its file name; the queue continues. `created` / `existing` → `onAdd(asset.id)` straight from the response (no wait for a record: attachments have none). Network failure → "Upload failed, try again". A WS disconnect doesn't stop REST: a finished upload is still added. 401 → the DM client's usual secret reset. | FR-ASSET-17 messages |
| FR-ASSET-22 | **Clipboard paste**: a `paste` event inside `pasteTarget` (incl. Textareas and Inputs) whose `clipboardData` has **no plain text** and ≥ 1 image file (`image/*`) → `preventDefault`, each image file joins the queue with name "Pasted image ‹yyyy-mm-dd hh:mm›" (local time). Plain text present → the browser's normal text paste, no upload (copying from a web page or a document never uploads its pictures by surprise). **Exception: the image wins when the plain text is a single URL** (trimmed, one `http(s)://` token, no whitespace): some browsers' "Copy image" adds the image URL as `text/plain`; then the image is uploaded and the URL is not pasted (review #18; real-browser check in P1's walkthrough). No image and no text → nothing. The text field's value never changes because of an image (OQ-ASSET-13). Paste with no slot left or while disabled → "No more images (‹max›)", text untouched. | [12] |
| FR-ASSET-23 | **Drop and library**: dragging files over `dropTarget` outlines it (as the picker, FR-ASSET-17); a drop queues the files (non-files ignored). **From library** opens the existing picker Dialog (FR-ASSET-17, moved to `@ui`); "Select" → `onAdd(id)` (a listed asset). Library hidden when `library` is false or the client has no `asset` records (players). | |
| FR-ASSET-24 | **Attachments**: column `asset.listed` (bool, default true; existing rows true). `listed = false` = an **attachment**: a normal asset (ID from `ctx.tokens`, files, dedupe, serving, `assets.require`, FR-ASSET-11–15 unchanged) that the library doesn't list: excluded from the `asset` record type (snapshot and record changes), so it costs no snapshot bytes. `POST /api/assets` takes an optional multipart field `listed` (`"true"` \| `"false"`, else 400); the attach control always sends `"false"`, the picker's own Upload `"true"`. `AssetIngested` gains `listed`; an attachment's event is logged with no record change. Fixture `ingestStep(file, {listed: false})`. | OQ-ASSET-12 |
| FR-ASSET-25 | **Leak rules unchanged** for attachments: their IDs reach a player only as fields of records that player can see (FR-ASSET-12), set only by owning commands that call `assets.require` (FR-ASSET-15), **except** track C's compendium REST exception (FR-ASSET-36, ADR accepted #256; stale IDs per FR-ASSET-37): compendium entry image IDs in REST bodies after `entryVisibleTo`. Handout image IDs stay record fields via sync (review #24). The upload response (`{asset}`, 341 B measured) goes only to the uploading DM. | ADR-0023 |
| FR-ASSET-26 | **Dedupe with listing** (amends FR-ASSET-03): same bytes in the campaign → `existing`, same ID. If the existing row is an attachment and the request says `listed: true` (picker upload of the same file), the row becomes listed: `AssetListed {assetId}` (logged; `asset` upsert to the DM). A `listed: false` request never unlists. So a pasted image the DM later uploads in the picker appears in the library under its first name. | |
| FR-ASSET-27 | **Who uploads**: DM only (route unchanged: DM `Bearer`, 401 / 429; OQ-ASSET-02 / -14). The control uploads through an **uploader context** (`AttachUploaderProvider`, `@ui`) that only the DM client provides at its root (uses the DM secret, same `upload.ts`, moved to `@ui`); without a provider (player client) `ImageAttach` renders nothing. `asset.test` (test mode) hosts one control (`owner = "asset-test"`) listing the IDs it got, for walkthroughs. | |

### 6.2 Sprint 5, track C: compendium entry images

| ID | Requirement | Notes |
|---|---|---|
| FR-ASSET-35 | **Asset reference** `CompendiumEntry.imageAssetIds` (homebrew entries, 0–4, [FR-CMP-45](compendium.md#6-functional-requirements)): set only by `cmp.putEntry`, each ID through `assets.require` (FR-ASSET-15) in that transaction; listed assets and attachments both accepted. Imported (global) entries carry none (OQ-CMP-39). | |
| FR-ASSET-36 | **REST-body exception to FR-ASSET-12** (OQ-ASSET-17): an asset ID may also reach a player inside a **compendium REST response** (`GET /api/compendium/entries/:id`; search summaries carry no image fields, OQ-CMP-42 decided #256), only when compendium's `entryVisibleTo` lets that player read the entry ([FR-CMP-14](compendium.md#6-functional-requirements), [FR-CMP-48](compendium.md#6-functional-requirements)), on the player's own credential (`Authorization: Player`), with `Cache-Control: private, no-cache`. Never in an error body, a 304, a log line or a toast. No other REST route may return asset IDs to players without its own amendment. | ADR accepted #256 (amends ADR-0023 "Secrecy") |
| FR-ASSET-37 | **Stale references in lists**: the **compendium entry read** (FR-CMP-47; the only REST reader of a JSON-leaf ID list) drops IDs without an asset row in the campaign, so clients never get an ID that can only 404. Handout `imageAssetIds` are not covered: they stay record fields delivered by sync (party-board), under FR-ASSET-12 as written. Single-ID fields (map, token image, portrait) keep today's rule (broken-image placeholder, FR-ASSET-16). | Today only via DB edits; a future delete (OQ-ASSET-19) |
| FR-ASSET-38 | **Leak property over REST**: the FR-ASSET-12 leak property also scans every player compendium REST body (search, `sameAs`, GET incl. 404 / 304): each asset ID found belongs to an entry that player may read at that moment. Test lives in compendium's folder (`image-leak.test.ts`), not here. | §13 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Dialog, Progress, Alert, Toast, Tooltip; dark only. Test IDs per [AGENTS §9.5](../../AGENTS.md#95-test-ids).

- **DM picker** (Dialog, opened by scene / token / portrait flows; `asset.test` window in test mode): thumbnail grid with name; Tooltip shows display size and MB. Test IDs: `asset-picker`, `asset-picker-item` + `data-record-id`, `asset-picker-upload`, `asset-picker-file-input`, `asset-picker-select`, `asset-upload-progress`, `asset-upload-error`.
- **States:** empty "No images yet. Upload a map or token art." · loading: skeleton tiles · uploading: Progress, then "Processing…" · error: inline Alert ("Unsupported file type", "File over 25 MB", "Image over 50 megapixels", "Upload failed, try again") · disconnected: upload disabled, live-sync banner.
- **Images on screen** (canvas: [scenes-map](scenes-map.md); portraits: [entities](entities.md)): placeholder while `loading`, neutral broken-image placeholder on `error`. Map → `display`; token art, portraits, pickers → `thumb`.
- **Player view:** no asset UI. Images appear as their records arrive; nothing says an image was withheld.
- *(S5)* **Attach control** (FR-ASSET-20–23): a compact row under / beside the caller's image strip: **Upload** (secondary Button, upload icon), **From library** (ghost Button), muted hint "or drop / paste an image"; while dragging files the drop target gets the picker's dashed outline; progress line (Progress + "Uploading 2 of 3 · 45 %", then "Processing…"); errors as a destructive Alert under it, one line per failed file ("wanted.gif: Unsupported file type"), cleared by the next add. Disabled (not `live` for library picks; host `disabled`; no slot left) → Buttons disabled with a Tooltip saying why. Same look in every caller; the caller decides placement and slot layout. Styling per [visual-direction](../design/visual-direction.md), no custom styles.
- *(S5)* **Test IDs:** `asset-attach` + `data-owner` + `data-state` (`idle|uploading|processing|error`), `asset-attach-upload`, `asset-attach-file-input`, `asset-attach-library`, `asset-attach-hint`, `asset-attach-drop` (outline marker on the drop target while dragging), `asset-attach-progress` + `data-value` (pct), `asset-attach-error` + `data-value` (file name). `asset.test`: `asset-attach-result` + `data-record-id` per added id.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Asset | id, campaignId | ID (128-bit token, FR-ASSET-08), ID → Campaign | Unique `(campaignId, hash)` |
| | seq | int | Insertion order; picker tiebreak |
| | name | text | 1–80 |
| | hash | text | SHA-256 hex of the original; server-only (not in the `asset` record) |
| | mime, bytes, width, height; displayWidth, displayHeight | text, int ×3; int ×2 | Stored original; `display` (grid calibration, OQ-ASSET-07) |
| | createdAt | timestamp | Clock seam |
| | listed *(S5)* | bool, default true | false = attachment: not in the `asset` record type (FR-ASSET-24); server-only, not on the wire |
| Asset files *(disk)* | `<hash>/original`, `display.webp`, `thumb.webp` | files | Layout *(proposed)*; one set per hash |

- **Relations:** Campaign 1—* Asset. Asset-ID fields: `Scene.mapAssetId`, `Token.imageAssetId` ([scenes-map](scenes-map.md)), `Entity.portraitAssetId` ([entities](entities.md)): many records → one asset, same campaign only (FR-ASSET-15). Imported (global) definitions carry no asset in MVP. *(S5, track C: + `CompendiumEntry.imageAssetIds`, JSON leaf 0–4, homebrew only, [compendium §8](compendium.md#8-data-model); imported entries none.)*
- **Derived values:** `thumb` size. **Persisted runtime state:** none beyond rows and files. No JSON leaf fields; files are not records.
- *(S5)* Asset-ID fields that may hold attachments: `Handout.imageAssetIds` ([party-board](party-board.md#8-data-model)), compendium entry images (track C). Any asset-ID field accepts both kinds (`assets.require` doesn't look at `listed`). Index unchanged (`listed` filters the per-campaign provider query).

## 9. API & events

**REST (Hono RPC).** WS intents: none (uploads are REST, [OQ-SYNC-04](live-sync.md#15-open-questions)). Signals: none.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/assets` | DM (`Bearer`) | Multipart `file`, optional `name` *(S5: optional `listed` `"true"`/`"false"`, FR-ASSET-24)* → `201 {asset}` created / `200 {asset}` existing / 400, 401, 413, 415, 422, 429 |
| GET | `/api/assets/:id/:file` | anyone holding the ID | Serve per FR-ASSET-11, -13, -14 |

**Record types and events** (generic record changes `{type, id, op, data}` + `cause`, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md))

| Record type | Scope | Visibility rule | Snapshot |
|---|---|---|---|
| `asset {id, campaignId, seq, name, mime, bytes, width, height, displayWidth, displayHeight, createdAt}` | `campaign` | DM `full`; player `hidden` | All of the campaign's assets |

| Domain event | Changes | Logged | Transient | Undoable |
|---|---|---|---|---|
| `AssetIngested {assetId, hash, bytes}` *(S5: + `listed`)* | `asset` upsert *(S5: only if listed; attachment → none)* | yes | no | no |
| *(S5)* `AssetListed {assetId}` | `asset` upsert (DM) | yes | no | no |

- `existing` outcome emits nothing *(S5: except FR-ASSET-26's listing)*. **Server API for other specs:** `assets.require(ctx, id)` (FR-ASSET-15).
- *(S5)* Visibility per event: `asset` changes reach DM connections only (player `hidden`); players get at most an empty-change frame. **Client API for other specs:** `ImageAttach` + `AttachUploaderProvider` (FR-ASSET-20, -27).

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Upload / ingest | ✓ | ✗ (OQ-ASSET-02) | DM credential; default-DM command |
| See asset list | ✓ | ✗ | `asset` visibility = DM only |
| Fetch `thumb` / `display` | Any ID it holds | Any ID it holds (learned only via FR-ASSET-12) | Asset exists in the active campaign |
| Set an asset-ID field | Per owning spec | Per owning spec | `assets.require` (same campaign) |
| *(S5)* Upload / paste through the attach control | ✓ | ✗ (control not rendered; OQ-ASSET-14) | DM credential on POST; uploader context only in the DM client |
| *(S5)* See attachments in the library | ✗ (not listed) | ✗ | `asset` provider: listed only |
| *(S5)* Receive entry image IDs over REST | ✓ own campaign's entries | entries `entryVisibleTo` allows | FR-ASSET-36 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** loaded images stay; after the snapshot the loader fetches only new IDs (browser cache otherwise) and retries `error` loads once. **DM:** a finished upload arrives in the snapshot and is then selected; a failed one shows "Upload failed, try again"; retrying is safe (FR-ASSET-03).
- **Server crash mid-action:** before commit → no row; temp and orphan files removed at next start (FR-ASSET-07). After commit → asset complete; re-upload returns `existing`.
- **Concurrent edits:** two tabs upload the same image → one `created`, one `existing` (DB uniqueness). Same image in two campaigns → two rows, two IDs, one file set. Campaign switched mid-upload → the asset lands in the campaign active when the upload was authenticated; the DM sees it after switching back.
- **Reveal / hide:** reveal sends the record, so the player learns the ID then; after a hide the ID still works for that player (bytes were legitimately seen).
- *(S5)* **Attach control, disconnect mid-upload:** REST is independent of the WS; the image is added when its response comes, and the host form keeps its draft (Save waits for `live`). **Server crash mid-upload:** as FR-ASSET-07: no row, files swept; the control shows "Upload failed, try again"; re-pasting is safe (dedupe). **Reconnect:** attachments have no record, so nothing to resync; IDs in the host's draft stay valid.
- *(S5)* **Never saved:** an image uploaded or pasted into a form that is then cancelled stays as an unreferenced attachment (no delete, OQ-ASSET-05; FR-ASSET-07 sweeps files only when no row references them). Accepted: local disk, DM only, no snapshot cost.
- *(S5)* **Clipboard quirks:** a copied image from a browser carries `text/html` but no plain text → uploads; from a word processor, plain text + a picture → text only (FR-ASSET-22); a `.gif` / HEIC on the clipboard → "Unsupported file type" (OQ-ASSET-11); several images → queued in order.
- *(S5, track C)* **Compendium entry images:** share = the player's next fetch returns the IDs; unshare / image removed = the next fetch omits them, IDs already learned keep working (as any hide). A forged `PUT` naming another campaign's asset → `not_found` (FR-ASSET-35). REST has no reconnect step; a player's reconnect snapshot never holds entry image IDs. Crash: `cmp.putEntry` is one transaction; an upload that finished before it stays an unreferenced attachment.
- **Invalid / malicious input:** guessing a 128-bit ID is infeasible; leaked IDs work until revoke exists (post-MVP, OQ-ASSET-05); `id` and `file` zod-validated, never used as paths; decompression bombs stopped by the pixel limit; SVG never served; renamed `.png` text file → 415. Seeded fixture IDs are predictable: fixture data is never tunnelled ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)).

## 12. Performance & bandwidth

- Budgets *(proposed)*: ingest of a 50 MP image incl. derivatives ≤ 5 s on the DM laptop; `images` fixture ≤ 300 ms in-process (share of FR-FIX-10); DM snapshot ≤ ~300 assets × ~250 B ≈ 75 KB (revisit with the tier-A library).
- Map `display` 1–3 MB per player; 6 players ≈ 5–15 s at 10 Mbit/s DM upload; token `thumb` ≲ 50 KB; revisits 0 bytes.
- Files streamed from disk; no derivatives on request; originals never leave the laptop.
- *(S5, track C, measured)* Entry images: snapshots +0 B (DM and players); entry GET +25 B per ID (+118 B at 4); a library image costs ≈ 325 B in the DM snapshot (80-char name), an attachment 0 B. Gallery loads `thumb` (19–76 KB for a noisy 1600 × 1200 / 800 × 800 image), the lightbox `display` (271–816 KB). Figures and probe: [CMP §12](compendium.md#12-performance--bandwidth).

**Sprint 5, measured** (throwaway probe: `session-sim-8` on Goblin Ambush + `buildRealisticHeavy`, 100 assets with 80-char names written straight to the table; frame bytes as `snapshotSizes`; deleted). Base heavy DM **678,650 B** (9 assets, 2,245 B).

| What | DM snapshot | Player snapshot | Per event / request |
|---|---|---|---|
| A **library** asset (listed), max-length name | **+332 B each** (+100 → 711,850 B) | 0 B (`hidden`) | `AssetIngested` frame 524 B, DM connections only |
| An **attachment** (FR-ASSET-24, pick) | **0 B** | 0 B | event frame with no change (≤ 125 B, DM); upload response 341 B to the uploader |

- Headroom if pastes went to the library, at the DM ceiling of 1.5 MiB (1,572,864 B, #256): from this base 894,214 B ≈ 2,690 images; from the sprint-5 all-track worst (≈ 940 KB, seams S14) ≈ 630 KB ≈ 1,900 images at ASCII names (fewer at 3-byte). Library growth is unbounded per session; the decided attachments add none. CON-44 test: `FR-ASSET-24` adds 50 attachments to the heavy harness → DM snapshot bytes unchanged.
- Upload time: local (DM browser → own laptop), dominated by `sharp` (≤ 5 s at 50 MP, FR budget above); a typical 2 MB screenshot is expected well under 1 s (not measured; the test logs it). Players fetch `display` derivatives as before.

## 13. Test plan

Isolated per worktree: `bun test` uses `:memory:` DB + temp asset dir per file; walkthroughs use the `verify` profile ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)).

**Fixtures** (canonical: `base`, `player-1`, `player-2`, `campaign-second`; added here, SVGs under `fixtures/assets/`)

| Fixture | Contents | In `session-sim` |
|---|---|---|
| `images` | Fixture Campaign: `town` (1400 × 980 *(proposed)*), `battlemap` (1400 × 980 = 20 × 14 at 70 px), `token-mira` blue, `token-goblin` green, `token-wolf` grey, `token-elite` dark green, `token-thorn` *(playtest pass, G11, #174)* (256 × 256 round; each a distinct silhouette, not only a colour) | yes |
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

**Sprint 5 tests** (P0 server, P1 client; fixtures `asset-library`, `party-s5`)

| Level | Named tests |
|---|---|
| Unit (client, DOM) | `FR-ASSET-20 contract` (count = max → disabled + message; `onAdd` once per image in order; never mutates the caller's list; `library: false` hides From library; no uploader provider → renders nothing); `FR-ASSET-21 queue` (one request at a time; 3 files with 2 slots → 2 sent + "Only 2 more images"; two quick pastes with 1 slot left → one upload, the second refused (queued and in-flight files count); progress text; a failed middle file doesn't stop the third; network error message); **`FR-ASSET-22 paste creates an asset`** (synthetic paste with a PNG `File` in a Textarea → one POST with `listed=false` and name "Pasted image …", `onAdd(id)`, Textarea value unchanged; plain text + image → text pasted, no POST; a single URL as plain text + image → POST, URL not pasted; two URLs or a sentence + image → text; empty clipboard → nothing); `FR-ASSET-23 drop + library` (drop 2 files → queued; non-file drag ignored; Select in the picker → `onAdd`); `FR-ASSET-20 in a Dialog` (control and its `pasteTarget` / `dropTarget` inside a Dialog portal: paste and drop handled, seams S5); `FR-ASSET-20 duplicate id` (re-pasting the same bytes → `onAdd` with the same id, the control adds no filtering); **`FR-ASSET-23 refusals`** (client: `.txt` → "Unsupported file type", 26 MB → "File over 25 MB", nothing sent) |
| Integration (server) | `FR-ASSET-24 attachment not in any snapshot` (upload with `listed=false` → 201, row `listed = false`, DM snapshot and live frames carry no `asset` record for it, event logged; GET `display` / `thumb` 200; `assets.require` accepts it); `FR-ASSET-24 refusals` (`listed=maybe` → 400; 26 MB → 413, `.txt` → 415, corrupt → 422, nothing written, as today); `FR-ASSET-26 listing on re-upload` (attachment re-uploaded with `listed=true` → `existing`, same id, `AssetListed` upsert to DM; listed re-uploaded with `listed=false` → stays listed, no event); `FR-ASSET-25 leak` (`party-s5`: the attachment id of h6 never in a player frame until h6 is shared with that player; leak property test extended with unlisted assets); `FR-ASSET-27 no player upload` (player link token on POST → 401; player client renders no control); CON-44 50 attachments → DM bytes unchanged |
| E2E (thin) | `asset.test`: paste a PNG into the window's Textarea → `asset-attach-result` gains an id; the picker still shows the original 7 items |

Walkthrough: [PARTY §13.1](party-board.md#131-sprint-5-track-p-party-loot-asset-cmp) steps S5-2, S5-3 (upload, drop, paste into a handout), S5-10 (after restart the images render).
**Sprint 5, track C** (bundle `cmp-images`, [CMP §13.1](compendium.md#131-sprint-5-entry-images-track-c)): `FR-ASSET-35` = CMP's `FR-CMP-46 assets.require refusal`; **`FR-ASSET-36 leak property over REST`** (`image-leak.test.ts`: random sequences of put / share / unshare / image add / remove over `cmp-images`; after each step every asset ID in player-1's and player-2's search, `sameAs` and GET bodies (200, 304, 404) belongs to an entry that player may read; error bodies never hold one; **no response's `ETag` header contains any asset ID** (opaque hash, FR-CMP-47; review B25)); `FR-ASSET-37 stale reference dropped` = CMP's `FR-CMP-47 asset deleted`. Walkthrough: CMP walkthrough I.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Register record type `asset` (no registry change). §12 "Assets are URLs" to read "records carry asset IDs; clients build the URL" (integrator) | done (CON-29) |
| [campaign-management](campaign-management.md) | DM `Bearer` on POST, 401 / 429 (FR-CAMP-04/05); `ctx.campaignId` at authentication (FR-CAMP-11). No player REST credential (#123) | agreed |
| [scenes-map](scenes-map.md) | `Scene.mapAssetId`, `Token.imageAssetId` set via `assets.require`; sent only on records the player sees (FR-ASSET-12); picker in its flows; map `display`, token `thumb`; OQ-ASSET-07. FR-MAP-19 "fetchable" → "ID reaches players" | open |
| [entities](entities.md) | `portraitAssetId` set via `assets.require` (FR-ENT-08/11); kept in FR-ENT-15 redaction, so all players learn character portrait IDs; monster portrait IDs reach players only via visible tokens' copies, written in the edit's transaction (#120) | agreed (OQ-ASSET-10 decided) |
| [play-shell](play-shell.md) | Window registry (FR-SHELL-07) for `asset.test`; no shell change | agreed |
| [fixtures-adapters](fixtures-adapters.md) | Loader passes SVG bytes to `assets.ingest`; manifest lists asset IDs by fixture key. Add `image-large`, `images-second`, bundles `asset-library`, `asset-access` to FIX §8 at merge (integrator) | agreed (FR-FIX-17) |
| [data model](../data-model/README.md) | Asset `id` from `ctx.tokens`, not `ctx.ids` (consolidation, integrator) | done ([CON-19](../data-model/README.md#8-conflicts-log)) |
| *(S5)* [party-board](party-board.md) | Handout editor hosts the control (FR-PARTY-39); fixture `handout-attachment`, bundle `party-s5` | this track |
| *(S5)* [compendium](compendium.md) (track C) | Entry image slots use `ImageAttach` (C chooses `max` 4, placement, `owner = "cmp-form"`); C5 UI starts after P1, P4 and C5 core merge (OQ-ASSET-15, OQ-ASSET-18). `imageAssetIds` on homebrew entries via `assets.require` (FR-ASSET-35); REST-body exception (FR-ASSET-36, ADR accepted #256); stale IDs dropped at the compendium read (FR-ASSET-37). Build: CMP §14 C5 core / C5 UI; C edits no file of this feature | settled by seams S5; decided #256 |
| *(S5)* [play-shell](play-shell.md) (track W) | One `AttachUploaderProvider` line in the DM client root (granted append-style, no wait on W1) | settled by seams S4 ([OQ-PARTY-22](party-board.md#15-open-questions)) |
| *(S5)* New npm dependency | **none**: Clipboard events, `File`, `DataTransfer`, drag-and-drop and `XMLHttpRequest` upload progress are browser APIs; `sharp` already decodes PNG / JPEG / WebP and rasterises SVG | — |

**Sprint 5 shared files** (slices in [PARTY §14.2](party-board.md#142-sprint-5-build-split)): P0 `src/server/db/` (`asset.listed`), `src/shared/events/assets-pipeline.ts` (`AssetListed`, `listed`), protocol + data-model rows; the upload `listed` field stays inside the assets feature route (`src/server/features/assets-pipeline/routes.ts`), no `src/server/app.ts` line (if one were needed, after D12, seams S11); P1 new files under `src/client/common/features/assets-pipeline/` (feature-owned; `AssetPicker.tsx` + `upload.ts` move there from `src/client/dm/features/assets-pipeline/`, DM callers re-import), DM root provider line (granted append-style, seams S4; no wait on W1).

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
| ~~OQ-ASSET-10~~ | ~~entities: FR-ENT-08/11 call `assets.require` for `portraitAssetId`~~ | **Decided:** yes; [FR-ENT-08/11](entities.md#6-functional-requirements) call it (CON-27) | — | — |
| OQ-ASSET-11 | *(S5)* Upload size and formats for direct upload and paste [11] [12] | **Decided (#256): same as library uploads: 25 MB, 50 MP, PNG / JPEG / WebP / SVG** (FR-ASSET-02, -21). Rejected: ~~B a lower cap for pastes~~, ~~C A + GIF~~ | — | — |
| OQ-ASSET-12 | *(S5)* Where uploaded / pasted images live | **Decided (#256): attachments: not in the asset library, never in a snapshot (0 B; +332 B per library image avoided); a later picker upload of the same file lists it** (FR-ASSET-24, -26). Rejected: ~~B library with a tag and a filter~~, ~~C plain library~~ | — | party-board, compendium |
| OQ-ASSET-13 | *(S5)* Paste into text: (a) how, (b) where | **Decided (#256): (a) the image goes to the form's images (strip / slots); the text never changes; (b) forms that hold images: the handout editor and the compendium homebrew form (track C)** (FR-ASSET-22). Rejected: (a) ~~B inline image at the cursor~~, ~~C an attachment chip~~; (b) ~~every DM text area~~. Same decision as [OQ-PARTY-21](party-board.md#15-open-questions) | — | party-board, compendium |
| OQ-ASSET-14 | *(S5)* Players uploading or pasting images | **Decided (#256): no** (FR-ASSET-27). Rejected: ~~B players paste into their own sheet notes~~ (later, with OQ-ASSET-02) | — | character-sheet-full |
| OQ-ASSET-15 | *(S5)* **compendium (track C)**: consumes `ImageAttach` for entry image slots | **Settled by seams S5:** C builds no upload / paste code of its own; C5 UI starts after **P1, P4 and C5 core** merge; C passes `max`, `count`, `owner = "cmp-form"`, its own slot layout; refs may sit inside a Dialog portal; dedupe is C's ("Already in this entry"); entry images are attachments (`listed=false`, FR-ASSET-24) checked with `assets.require` in C's write | no · settled | compendium |
| OQ-ASSET-16 | Glossary | **Add "Attachment": an asset uploaded or pasted into a form, not listed in the asset library; "Asset library": the DM's listed assets (the picker)**; amend "Asset" (handout and compendium images). Settled by seams S12 (integrator, gate merge) | no · settled | glossary |
| OQ-ASSET-17 | *(S5, track C)* Compendium entries travel over REST, but FR-ASSET-12 / ADR-0023 say a player learns asset IDs only through the filtered sync. How do entry image IDs reach players? | **Decided (#256): A, allow them in compendium REST bodies only after `entryVisibleTo` (FR-ASSET-36)**, via the [ADR](../architecture/adr/proposed-s5-cmpimg-rest-asset-ids.md) amending ADR-0023's Secrecy rule (accepted; the integrator numbers it at merge). Rejected: ~~B lazy record type `cmp-entry-images`~~, ~~C credentialed image route~~ | — | ADR-0023, compendium |
| OQ-ASSET-18 | *(S5, track C)* **Seam with track P's `ImageAttach`** (FR-ASSET-20–27, P's OQ-ASSET-15) | **Settled by seams S5:** no new prop; C passes `max` 4, `count`, `owner = "cmp-form"`, `disabled` while saving; `pasteTarget` / `dropTarget` may point **inside a portal** (the form's Dialog content: the listener attaches to the ref's element; P1 tests it in a Dialog); **dedupe is the caller's** (the control may return an ID C already holds → "Already in this entry"; no `heldIds` prop); entry images are attachments (`listed=false`), checked by `cmp.putEntry` with `assets.require`; C's fixture uses P's `ingestStep(file, {listed: false})`; C5 UI starts after P1, P4 and C5 core merge. Rejected: a `heldIds` prop | no (settled S5) | compendium |
| OQ-ASSET-19 | *(S5, track C)* Future asset delete / revoke (OQ-ASSET-05) and entry images | **When delete lands: "unreferenced" also checks `compendium_entry.image_asset_ids` (and `Handout.imageAssetIds`); until then readers drop missing IDs (FR-ASSET-37)** / cascade: deleting an asset strips it from entries (silent content loss) | no · owner: spec-assets-pipeline | compendium, party-board |
| OQ-ASSET-20 | *(S5, track C)* Glossary | **Amend "Asset reference": "A record field, or a compendium entry field, holding an asset ID … a player learns the ID only if they can see the field (sync) or read the entry (REST, ADR-0023 as amended)"; add "Entry image": an image slot on a homebrew compendium entry; the first is the main image** — settled S12 (integrator applies at the gate merge) | no (settled S12) | glossary |

## 16. Out of scope

- See §4. Also art for imported definitions ([compendium](post-mvp/compendium.md)); handouts ([party-board](post-mvp/party-board.md)) reuse the store and loader.
- *(S5, track C)* Asset IDs in any other player REST body; images on imported compendium entries (OQ-CMP-39).
