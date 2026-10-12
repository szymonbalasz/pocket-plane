---
title: Play shell
prefix: SHELL
status: complete
owner: spec-play-shell
wave: 2
---

# Play shell

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The one play page per client (Roll20-style): scene canvas as the base, **floating windows** over it ([ADR-0014](../architecture/adr/0014-mvp-scope.md), [decisions-log](../decisions-log.md) #44, #48). Replaces the DM's six-window setup ([vision](../vision.md#the-table-today)).
- Features don't own pages: they register **window types**; the shell opens, arranges and persists them. Plug-in contract: [ADR-0025]($10025-play-shell-windows.md).
- **Layout** lives in browser storage, per campaign and owner (DM or the link's player); it never reaches the server (#121).
- Hosts the foundation UI: connection indicator, reconnect banner, presence ([live-sync](live-sync.md)); switcher, players panel, login / waiting / invalid-link screens ([campaign-management](campaign-management.md)).

## 2. Scope

- Page frame for DM and player clients: base layer, top bar, tool rail slot, launcher, banner, toast region. Window manager: open, close, move, resize, bring to front, minimise; clamp to viewport; reset layout *(proposed)*.
- Window registry (client code) and `openWindow(kind, instance?)` for features; `instance` key ready for several windows of one type (tokens open notes later, ADR-0014), MVP uses `main` only.
- **Later, not built** (nothing here may block them): command palette, shortcuts, portrait strip, pause overlay, DM "view as player". They plug in via the registry, a reserved strip slot above the launcher and an overlay layer.

## 3. Goals

- Everything used during play is reachable without leaving the canvas; a player sees the active scene with no clicks after opening the link.
- Each owner's arrangement survives reload, reconnect and a server or browser crash. A feature adds a window by registering it, no shell code changes. Layouts never leave the browser; opening a window grants no data.

## 4. Non-goals

- BG2 styling, portrait strip (→ [theme-system](post-mvp/theme-system.md)); mobile/touch ([ADR-0007](../architecture/adr/0007-product-scope.md)); docked panels; pop-out browser windows; restoring a layout on another browser (#121).
- Window contents (each owning spec); canvas behaviour ([scenes-map](scenes-map.md)).

## 5. User stories

- **DM:** I want the players panel, scene list and (later) initiative as windows over the map, so that I run the session from one tab; and my arrangement back after a crash, so that I don't rebuild it mid-session.
- **Player:** I want to land on the map the DM is showing, so that I'm in the game the moment I open my link; and my windows where I left them.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-SHELL-01 | Each client has one play page. Base layer fills the viewport. Stacking, bottom → top: base layer < windows < chrome (top bar, tool rail at the left edge with content from scenes-map, launcher) < reconnect banner, toasts < dialogs, overlays. | |
| FR-SHELL-02 | Player: valid link + active campaign → loading skeleton, then the shell after the first snapshot with the active scene as base layer. DM: base layer = the DM's viewed scene (#122, [FR-MAP-08](scenes-map.md#6-functional-requirements)). Nothing to show → one empty-state component: player "Waiting for the DM to show a scene", DM "No active scene". Windows still work. | [FR-CAMP-16](campaign-management.md#6-functional-requirements) |
| FR-SHELL-03 | DM: valid secret + active campaign → shell after the first snapshot. No active campaign → campaign-management's "Create your first campaign" page; no shell, no WS. | |
| FR-SHELL-04 | Login (DM), invalid-link (`rejected`) and waiting (`waiting`) screens replace the whole shell, with campaign-management's wording. Leaving `waiting` restores the shell without reload, windows as they were. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-SHELL-05 | Top bar, right: connection indicator (both clients). Reconnect banner below the top bar, full width, live-sync's texts. While not `live`, feature intent controls are disabled (live-sync) but window management keeps working. | |
| FR-SHELL-06 | DM top bar: campaign switcher (CAMP §7); *(proposed, OQ-SHELL-11)* presence badge "N/M online" (tooltip: names), click opens `camp.players`. Player top bar: campaign-management's wording, "Playing as **‹player›** in **‹campaign›**"; renames show ≤ 1 s. | Presence: [FR-SYNC-23](live-sync.md#6-functional-requirements) |
| FR-SHELL-07 | A window type registers: `kind` (`<prefix>.<name>`), title, clients (`dm` / `player` / both), default + min size, default position, default open, launcher icon/label/order, optional `available(store)`, component. Only registered, available kinds for this client render. | OQ-SHELL-07 |
| FR-SHELL-08 | Open (launcher or `openWindow`): opens at the window's last geometry, else its default; brings it to front. Already open → brought to front; minimised → restored. One instance per kind in MVP (`main`). | |
| FR-SHELL-09 | Launcher button: closed / minimised → open + front; open but behind → front; open on top → minimise. Button shows open / minimised state. | |
| FR-SHELL-10 | Move by dragging the title bar; resize by edges and corner, never below min size or beyond the viewport. Pointer-down anywhere in a window brings it to front. | |
| FR-SHELL-11 | Minimise hides the window (launcher marks it); close unmounts it. Both keep its geometry for the next open. | |
| FR-SHELL-12 | Clamp on restore, open and viewport resize: window ≤ viewport size; whole title bar height and ≥ 120 px of its width inside the viewport, below the top bar. Clamping is render-only: it never writes the layout; writes carry each untouched window's stored geometry. | |
| FR-SHELL-13 | Pointer events reach the base layer only outside windows and chrome. Exception: an HTML5 drag that starts in a window and ends over the base layer delivers its drop to the base layer (e.g. [FR-ENT-18](entities.md#6-functional-requirements) rows). Key events whose target is inside a window, the top bar, the launcher, a dialog or any editable element never reach canvas handlers. | Ctrl-D ([FR-MAP-17](scenes-map.md#6-functional-requirements)) |
| FR-SHELL-14 | *(proposed)* Launcher menu "Reset layout" → this client's default layout, written. | Recovery |
| FR-SHELL-15 | The layout (every window's kind, instance, state `open` / `minimised` / `closed`, geometry, z-order) is one `localStorage` entry per (campaign, owner): key `pp.layout.v1.<campaignId>.<dm \| playerId>`, `playerId` from `you`. Written synchronously on each change: open, close, minimise, move end, resize end, bring to front. Never sent to the server. | #121 |
| FR-SHELL-16 | The entry is applied after the first snapshot after page load and after the first snapshot after `you.campaignId` changes; no entry → default layout. Other snapshots (reconnect, resync, scene switch) never open, close or move windows. A change is written to the key of the campaign it was made in. | No jumps |
| FR-SHELL-17 | On read the entry is parsed with zod: ≤ 40 windows, unique (kind, instance), kind `^[a-z]+\.[a-z0-9-]+$` ≤ 64 chars, integer geometry within ±10 000 px. Invalid → default layout + console warning; the next change overwrites it. Storage unavailable or throwing → layout kept in memory only, console warning, no error UI. | |
| FR-SHELL-18 | Saved windows of unknown or unavailable kinds are skipped on restore without error; unknown ones are dropped at the next write, unavailable ones kept. When a kind becomes available it renders in its saved state; when it becomes unavailable it unmounts and keeps its saved state. | |
| FR-SHELL-19 | Same owner in two tabs: each restores from the entry on load; writes are last-write-wins; `storage` events are ignored, so a page never applies another page's changes live. | |
| FR-SHELL-20 | Test mode only: window type `shell.test` (both clients; shows its window key and a text input). Shown iff the client is in test mode by the same signal as live-sync's probe panel ([FR-SYNC-27](live-sync.md#6-functional-requirements)). Absent otherwise. | |
| FR-SHELL-21 | The shell registers windows whose owner specs are complete: `camp.players` (DM; campaign-management's players panel incl. online dots) and, in test mode, `sync.probes` (both; live-sync's probe panel and "drop connection" button). | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark only, laptop viewports (≥ 1280 px), semantic tokens only, map is the hero (thin chrome over the canvas, no reserved margins).

- **Top bar** (thin, overlays the canvas): left = campaign (DM: switcher Select + "New campaign" Dialog; player: "Playing as …"); right = DM presence Badge, connection indicator (Badge + Tooltip). **Tool rail**: left edge, below the top bar; slot filled by scenes-map, empty otherwise.
- **Launcher**: bottom-centre bar of icon Buttons with Tooltips (BG2 "bottom action bar" motif later via theme); trailing "⋯" menu with "Reset layout". **Toasts**: one region, bottom-right.
- **Window**: panel surface; title bar (title, minimise, close), scrolling body, resize handle; focused window uses a semantic border token (names: [theme-system](post-mvp/theme-system.md)).
- **No new dependency**: pointer events + CSS transform. A drag/resize library needs the DM's OK (AGENTS §3).
- **Defaults** (DM): `camp.players` top-right, `map.scenes` top-left (scenes-map). Player: none open in Scenes phase; Combat specs set `defaultOpen` for theirs (OQ-SHELL-06).
- **States:** `connecting` = skeleton over the page; `live` = shell; `reconnecting` = last view + banner, windows usable; `waiting` / `rejected` = campaign-management screens; nothing to show = base empty state.
- **DM view:** switcher + presence; DM window types; base = viewed scene. **Player view:** name + campaign; player window types; base = active scene.
- **Test IDs** (`ui-` per AGENTS §9.5): `ui-topbar`, `ui-presence-badge`, `ui-tool-rail`, `ui-launcher`, `ui-launcher-button` + `data-record-id=<kind>`, `ui-launcher-menu`, `ui-launcher-reset`, `ui-window` + `data-record-id=<kind>:<instance>` + `data-state`, `ui-window-title`, `-minimise`, `-close`, `-resize`, `ui-base-empty`. Indicator keeps live-sync's `sync-connection-status`.

## 8. Data model

No server entity, record type or migration (#121). Client-side only:

| Entity | Field | Type | Notes |
|---|---|---|---|
| Layout *(browser `localStorage`)* | key | `pp.layout.v1.<campaignId>.<dm \| playerId>` | One per (origin, campaign, owner); no secret token in the key |
| | windows | WindowState[] | zod-parsed on read (FR-SHELL-17); ≤ ~4 KB |
| WindowState *(in `windows`)* | kind, instance, state, x, y, w, h, z | string, string (`main`), `open` \| `minimised` \| `closed`, int ×5 | px from viewport top-left; z = stacking order |
| Window type *(client code)* | FR-SHELL-07 fields | — | Per-client registry; not sent or stored |

- **Relations:** key names a Campaign and Player ([campaign-management](campaign-management.md)) by ID only; kinds name window types, not records. **Derived:** rendered geometry = clamp(stored, viewport); launcher states. **Persisted runtime state:** the Layout entry; window manager state is client memory, rebuilt from it on load.

## 9. API & events

- **REST, WS intents, record types, domain events, signals:** none. Envelopes, rejects, close codes: [live-sync](live-sync.md).
- **Visibility:** N/A; layouts never leave the browser. Window contents read the synced store, already filtered server-side.
- **Client API for features:** `registerWindow(def)` (one line in the client's registry list), `openWindow(kind, instance?)`. The shell passes no data.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Arrange, persist, reset own layout | ✓ | ✓ | — (browser only) |
| Open a window type | DM types | player types | None needed: registry is per client; data stays filtered server-side |

## 11. Edge cases & failure modes

- **Player / DM disconnect / reconnect:** last view + banner; windows still movable and written; players unaffected by DM drops. Snapshots don't move windows (FR-SHELL-16).
- **Campaign switch:** DM restores the new campaign's DM entry (default if none); players get the waiting screen, then the shell as it was.
- **Server crash:** layout unaffected (browser-side). **Browser crash:** every finished change was already written; a drag in progress is lost.
- **Another browser, fresh profile, or new origin** (dev vs verify port, new tunnel URL): separate storage → default layout. Accepted (#121).
- **Two tabs, same owner:** last write wins, no live jumps (FR-SHELL-19). **Two players on one browser** (different links): separate keys.
- **Viewport change:** clamp, render-only (FR-SHELL-12). **Removed or unavailable window type:** FR-SHELL-18. **Corrupt or full storage:** FR-SHELL-17.
- **Shared computer:** entries hold only window geometry and kinds, no game data.

## 12. Performance & bandwidth

- No network cost. One synchronous ≤ 4 KB `localStorage` write per finished change.
- Drag/resize moves the window by CSS transform; no store write or canvas re-render until pointer up; closed and minimised windows are unmounted. Target *(proposed, OQ-SHELL-10)*: canvas pan/zoom ≥ 50 fps with 8 open windows on the DM's laptop.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); temp DB, port 0 for tests.

- **Fixtures:** none added (no record type; fixtures act as DM only, FR-FIX-13). **Bundle:** live-sync's `sync-probe` = `base` + `player-2` + `campaign-second` + `sync-probes`. Scene landing: scenes-map's walkthrough.

| Level | What | Fixtures |
|---|---|---|
| Unit | Window manager reducer: open/close/minimise/focus, launcher toggle, z-order, clamp math (render-only; untouched windows keep stored geometry), default layout, unknown/unavailable kinds and availability flips. Storage: key per (campaign, owner); write after campaign switch goes to the old key; zod bounds (41 windows, duplicate (kind, instance), bad kind, geometry > 10 000 → default); corrupt JSON → default; throwing storage → memory only. FR-SHELL-13: Ctrl+D typed in a window input, top bar, dialog never reaches a stub base key handler; drag from a window delivers drop to a stub base drop target. Test mode off → `shell.test`, `sync.probes` not in registry or launcher | In-code |
| Integration | N/A: no server code. Covered by unit (client) and E2E | — |
| E2E (thin) | Playwright, `player-1`: move + resize a window, reload → restored; same context opens `player-2`'s link → default layout; no WS frame contains a `windows` field. Reset-only DB: DM login → create page, no WS opened | `sync-probe` |

**Review checks:** adding a window type touches only the client's registry list; no drag/resize dependency added.

**Browser walkthrough** — `PP_TEST_MODE=1`; `reset-and-load sync-probe --profile verify`, built client, `start --profile verify`; evidence per AGENTS §9.6. Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** `player-1` again (fresh storage). All start at 1600×900.

| # | DM (A) | Players | Expected |
|---|---|---|---|
| 1 | Log in | — | Shell; "Connected"; badge "0/2 online"; Players window top-right; base "No active scene" |
| 2 | — | B opens link | B: "Playing as Player 1 in Fixture Campaign"; no windows open; launcher shows Probes, Test. A: "1/2 online" |
| 3 | — | B opens Probes + Test, moves + resizes Probes, clicks Probes to front, reloads | Same positions, sizes, z-order after reload |
| 4 | — | C opens link | Default player layout. B's and C's frames contain no layout data |
| 5 | — | B drags Probes half off-screen, resizes viewport to 1280×720, then back to 1600×900 | Title bar (≥ 120 px) stays in view; back at 1600×900 Probes is at its pre-resize spot |
| 6 | Rename Player 1 → "Mira's player" | — | B's top bar updates ≤ 1 s |
| 7 | — | B: "drop connection" (Probes window), moves a window while banner shows | Banner; window moves; after reconnect windows stay put; reload shows the moved position |
| 8 | Move Players window to top-left; switch to "Second Campaign", then back | — | A: default DM layout, then Players top-left again. B, C: waiting screen, then shell as before, no reload |
| 9 | Hard-kill + restart server | — | All: banner, rejoin, no window moves; reload → same layouts |
| 10 | — | D opens B's link; B: "Reset layout", reloads | D: default layout (browser-local). B: player default after reset and reload |
| 11 | — | Mangled link | Invalid-link screen; no top bar, launcher or windows |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Connection states, indicator/banner/presence components, probe panel, test-mode signal | agreed |
| [campaign-management](campaign-management.md) | Login / waiting / invalid-link screens and wording; switcher; players panel; `you.playerId`, `you.campaignId` | agreed |
| [scenes-map](scenes-map.md) | Base-layer component, viewed/active scene, tool rail content, `map.scenes` window | agreed (OQ-SHELL-05) |
| [entities](entities.md), [assets-pipeline](assets-pipeline.md) | `ent.creatures` (drag source, FR-SHELL-13), `asset.images` windows | open (OQ-SHELL-06) |
| Combat / Reward specs | Their window types and defaults | open (OQ-SHELL-06) |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-SHELL-01~~ | ~~Where is layout persisted?~~ | **Decided (#121):** browser storage keyed by player link / DM (FR-SHELL-15) | — | — |
| OQ-SHELL-02 | Can the DM push a window open on players' pages? | **Not in MVP; `openWindow` lets a later notification action or signal do it** / yes now, as a closable suggestion (more scope) | no · owner: spec-play-shell | combat-tracker, notifications |
| ~~OQ-SHELL-03~~ | ~~Docked panels?~~ | Removed: non-goal (§4) | — | — |
| OQ-SHELL-04 | DM layout per campaign or global? | **Per campaign** (fits ADR-0004 scoping) / one DM entry for all campaigns | no · owner: spec-play-shell | — |
| OQ-SHELL-05 | scenes-map contract | **Agreed by [scenes-map §7](scenes-map.md#7-uiux-notes):** scenes-map exports base-layer canvas + scene; shell owns empty state and tool rail slot; scene list = `map.scenes` | no · owner: scenes-map | scenes-map |
| OQ-SHELL-06 | Window kinds for other specs | **`ent.creatures` (DM), `asset.images` (DM; picker grid, answers [OQ-ASSET-08](assets-pipeline.md#15-open-questions)), `char.sheet`, `dice.log`, `cbt.initiative`, `note.history`, `loot.log` (both), `cbt.encounters` (DM)**; each spec confirms name, clients, default open | no · owner: each named spec | entities, assets-pipeline, character-sheet, dice-roll-log, combat-tracker, notifications, party-loot |
| OQ-SHELL-07 | AGENTS §9.9: window registry lists (`src/client/dm/windows.ts`, `src/client/player/windows.ts`) as append-only registries; build order | **Yes, and the shell frame + empty registries merge before other Scenes builders register windows (or `fix/shell-registry` creates them first)** / shared file via orchestrator (serialises builds) | no · owner: orchestrator | AGENTS.md, Scenes builds |
| ~~OQ-SHELL-08~~ | ~~Can a fixture step act as a player?~~ | **Decided (integrator ruling, gate Scenes; FR-FIX-13):** fixtures act as DM only; no layout fixture (moot after #121) | — | — |
| OQ-SHELL-09 | Glossary: add **Play page**, **Window**, **Window type**, **Launcher**, **Layout** (as in §1, §6, §8) | **Add** / keep spec-local | no · owner: integrator | glossary |
| OQ-SHELL-10 | Numbers: 40 windows, 120 px clamp, 50 fps | **As proposed** / DM sets others | no · owner: DM | — |
| OQ-SHELL-11 | DM presence badge "N/M online" in the top bar | **Keep** (one glance; opens `camp.players`) / drop (panel's online dots suffice) | no · owner: DM | — |

## 16. Out of scope

- §2's later list; docked panels, pop-outs, cross-browser layout (§4); window contents (owning specs).
