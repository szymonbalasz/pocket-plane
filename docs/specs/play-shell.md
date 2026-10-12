---
title: Play shell
prefix: SHELL
status: in-review
owner: spec-play-shell
wave: 2
---

# Play shell

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The one play page per client (Roll20-style): scene canvas as the base, **floating windows** over it ([ADR-0014](../architecture/adr/0014-mvp-scope.md), [decisions-log](../decisions-log.md) #44, #48). Replaces the DM's six-window setup ([vision](../vision.md#the-table-today)).
- Features don't own pages: they register **window types**; the shell opens, arranges and persists them. Plug-in contract: [proposed ADR](../architecture/adr/proposed-play-shell-windows.md).
- Hosts the foundation UI: connection indicator, reconnect banner, presence ([live-sync](live-sync.md)); switcher, players panel, login / waiting / invalid-link screens ([campaign-management](campaign-management.md)).

## 2. Scope

- Page frame for DM and player clients: base layer, top bar, launcher, banner, toast region. Window manager: open, close, move, resize, bring to front, minimise; clamp to viewport; reset layout *(proposed)*.
- Window registry (client code) and `openWindow(kind, instance?)` for features (tokens open notes later, ADR-0014 "design for later"; `instance` key ready for several windows of one type, MVP uses `main` only).
- **Layout** persisted per owner (DM, each player): server record *(pick; OQ-SHELL-01 open)*.
- **Later plug-in points** (not built; nothing below may block them):

| Later feature | Tier | Plugs in via |
|---|---|---|
| Command palette | A–B | shadcn Command listing registry entries (each launcher entry is a command) |
| Keyboard shortcuts | B | Optional `shortcut` field on a window type; same key-routing rule as FR-SHELL-13 |
| Portrait strip, party HP/AC summary | A / B | Reserved strip slot above the launcher |
| Pause / intermission screen | A | Overlay layer above windows (player client) |
| DM "view as player" | C | Player registry rendered in the DM client from a player-filtered store (needs server support) |

## 3. Goals

- Everything used during play is reachable without leaving the canvas; a player sees the active scene with no clicks after opening the link.
- Each owner's arrangement survives reload, browser switch and a server crash. A feature adds a window by registering it, no shell code changes. No leakage: layouts are private; opening a window grants no data.

## 4. Non-goals

- BG2 styling, portrait strip (→ [theme-system](post-mvp/theme-system.md)); mobile/touch ([ADR-0007](../architecture/adr/0007-product-scope.md)); docked panels (OQ-SHELL-03); popping windows out into browser windows.
- Window contents (each owning spec); canvas behaviour ([scenes-map](scenes-map.md)).

## 5. User stories

- **DM:** I want the players panel, scene list and (later) initiative as windows over the map, so that I run the session from one tab; and my arrangement back after a crash, so that I don't rebuild it mid-session.
- **Player:** I want to land on the map the DM is showing, so that I'm in the game the moment I open my link; and my windows where I left them, even on another browser.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-SHELL-01 | Each client has one play page. Base layer fills the viewport. Stacking, bottom → top: base layer < windows < top bar, launcher < reconnect banner, toasts < dialogs, overlays. | |
| FR-SHELL-02 | Player: valid link + active campaign → loading skeleton, then the shell after the first snapshot with the active scene as base layer. No active scene → base shows "Waiting for the DM to show a scene"; windows still work. | [FR-CAMP-16](campaign-management.md#6-functional-requirements); scene from scenes-map |
| FR-SHELL-03 | DM: valid secret + active campaign → shell after the first snapshot. No active campaign → campaign-management's "Create your first campaign" page; no shell, no WS. | |
| FR-SHELL-04 | Login (DM), invalid-link (`rejected`) and waiting (`waiting`) screens replace the whole shell, with campaign-management's wording. Leaving `waiting` restores the shell without reload, windows as they were. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-SHELL-05 | Top bar, right: connection indicator (both clients). Reconnect banner below the top bar, full width, live-sync's texts. While not `live`, feature intent controls are disabled (live-sync) but window management keeps working. | |
| FR-SHELL-06 | DM top bar: campaign switcher (CAMP §7) and presence badge "N/M online" (tooltip: names); click opens the Players window `camp.players` = campaign-management's players panel incl. online dots. Player top bar: "Playing as **‹player›** · ‹campaign›"; renames show ≤ 1 s. | Presence: [FR-SYNC-23](live-sync.md#6-functional-requirements) |
| FR-SHELL-07 | A window type registers: `kind` (`<prefix>.<name>`), title, clients (`dm` / `player` / both), default + min size, default position, default open, launcher icon/label/order, optional `available(store)`, component. Only registered, available kinds for this client render. Adding one touches only the client's registry list. | OQ-SHELL-07 |
| FR-SHELL-08 | Open (launcher or `openWindow`): opens at the window's last geometry, else its default; brings it to front. Already open → brought to front; minimised → restored. One instance per kind in MVP (`main`). | |
| FR-SHELL-09 | Launcher button: closed / minimised → open + front; open but behind → front; open on top → minimise. Button shows open / minimised state. | |
| FR-SHELL-10 | Move by dragging the title bar; resize by edges and corner, never below min size or beyond the viewport. Pointer-down anywhere in a window brings it to front. | |
| FR-SHELL-11 | Minimise hides the window (launcher marks it); close unmounts it. Both keep its geometry for the next open. | |
| FR-SHELL-12 | Clamp on restore, open and viewport resize: window ≤ viewport size; whole title bar height and ≥ 120 px of its width inside the viewport, below the top bar. | |
| FR-SHELL-13 | Pointer events reach the base layer only outside windows and chrome. Key events whose target is inside a window never reach canvas handlers. | Ctrl-D etc. ([scenes-map](scenes-map.md)) |
| FR-SHELL-14 | *(proposed)* Launcher menu "Reset layout" → this client's default layout, saved. | Recovery |
| FR-SHELL-15 | One `layout` record per (campaign, owner) holds every window's state (open / minimised / closed, geometry, order). Any change (open, close, minimise, move end, resize end, bring to front) is saved by `shell.saveLayout` 500 ms after the last change; ≤ 1 save in flight per page, latest state wins. | Pick; OQ-SHELL-01 open |
| FR-SHELL-16 | The saved layout is applied from the first snapshot per page load and campaign; no record → default layout. Later snapshots (reconnect, resync, scene switch) never open, close or move windows. | No jumps |
| FR-SHELL-17 | After every snapshot, if the page's layout differs from the snapshot's own `layout` record, the client sends one save. | Covers lost and offline changes |
| FR-SHELL-18 | Saved windows of unknown or unavailable kinds are skipped on restore without error; unknown ones are dropped at the next save, unavailable ones kept. | Removed window types |
| FR-SHELL-19 | `shell.saveLayout` (DM, player) writes only the record of the sender's context (`campaignId`, role, `playerId`); the payload has no owner field. Strict zod: ≤ 40 windows, unique (kind, instance), kind `^[a-z]+\.[a-z0-9-]+$` ≤ 64 chars, integer geometry within ±10 000 px. Bad → `reject invalid`, nothing stored. | |
| FR-SHELL-20 | Visibility of `layout`: player → `full` iff it is their own, else `hidden`. DM → `full` for all (FR-SYNC-18); the DM client applies only the DM's own. | Default deny for others |
| FR-SHELL-21 | `LayoutSaved` commits before broadcast, is not written to the event log and is not undoable. After a server restart every committed layout is in the snapshot. | [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) non-logged |
| FR-SHELL-22 | Same owner in two tabs or browsers: each restores from the one record on load; saves are last-write-wins; a page never applies another page's save live. | |
| FR-SHELL-23 | Test mode only (`PP_TEST_MODE=1`): window type `shell.test` (both clients; shows its window key and a text input). Absent otherwise. | Like the sync probe |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark only, laptop viewports (≥ 1280 px), semantic tokens only, map is the hero (thin chrome over the canvas, no reserved margins).

- **Top bar** (thin, overlays the canvas): left = campaign (DM: switcher Select + "New campaign" Dialog; player: "Playing as …"); right = DM presence Badge, connection indicator (Badge + Tooltip).
- **Launcher**: bottom-centre bar of icon Buttons with Tooltips (BG2 "bottom action bar" motif later via theme); trailing "⋯" menu with "Reset layout". **Toasts**: one region, bottom-right (notifications, "Link copied" …).
- **Window**: panel surface; title bar (title, minimise, close), scrolling body, resize handle; focused window uses the frame border token.
- **Defaults** (DM): `camp.players` top-right, `map.scenes` top-left (scenes-map confirms). Player: none open in Scenes phase; Combat specs set `defaultOpen` for theirs (OQ-SHELL-06).
- **States:** `connecting` = skeleton over the page; `live` = shell; `reconnecting` = last view + banner, windows usable; `waiting` / `rejected` = campaign-management screens; no active scene = base empty state.
- **DM view:** top bar with switcher + presence; DM window types; layout per campaign (OQ-SHELL-04). **Player view:** top bar with name; player window types only; own layout only.
- **Test IDs** (`shell-` per AGENTS §9.5): `shell-topbar`, `shell-presence-badge`, `shell-launcher`, `shell-launcher-button` + `data-record-id=<kind>`, `shell-launcher-menu`, `shell-launcher-reset`, `shell-window` + `data-record-id=<kind>:<instance>` + `data-state`, `shell-window-title`, `-minimise`, `-close`, `-resize`, `shell-base-empty`. Indicator keeps live-sync's `sync-connection-status`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Layout | id | ID | From `ctx.ids` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)) |
| | campaignId | ID → Campaign | Scope `campaign` |
| | ownerRole, ownerPlayerId | `dm` \| `player`, ID → Player \| null | null for DM; unique per (campaignId, ownerRole, ownerPlayerId) |
| | windows | **JSON leaf**: WindowState[] | zod on read and write ([ADR-0006](../architecture/adr/0006-persistence.md)); a UI document, never queried |
| | updatedAt | timestamp | `ctx.clock` |
| WindowState *(in `windows`)* | kind, instance, state, x, y, w, h, z | string, string (`main`), `open` \| `minimised` \| `closed`, int ×5 | px from viewport top-left; z = stacking order |
| Window type *(client code)* | FR-SHELL-07 fields | — | Per-client registry; not sent or stored |

- **Relations:** Layout → Campaign, Player ([campaign-management](campaign-management.md)); kinds name window types, not records. **Derived:** rendered geometry = clamp(stored, viewport); launcher states; dirty flag (page vs last saved). **Persisted runtime state:** Layout; window manager state is client memory, rebuilt from it on load.

## 9. API & events

**REST:** none. **Signals:** none. Envelopes, rejects, close codes: [live-sync](live-sync.md).

| WS intent | Who | Validation / ownership |
|---|---|---|
| `shell.saveLayout {windows}` | DM, player | FR-SHELL-19; upsert of the sender's own record |

| Record type | Scope | Visibility | Snapshot provider |
|---|---|---|---|
| `layout` | campaign | FR-SHELL-20 | DM: all of the campaign (≤ 1 + players); player: own row |

| Domain event | Changes | Logged | Transient | Undoable |
|---|---|---|---|---|
| LayoutSaved | `layout` upsert | no | no | no |

- **Client API for features:** `registerWindow(def)` (registry list), `openWindow(kind, instance?)`, `closeWindow(kind, instance?)`. Window contents read the synced store; the shell passes no data.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Arrange windows on own page | ✓ | ✓ | — (client only) |
| Save layout | own | own | Record chosen from connection context; no owner in payload |
| Read layouts | all (applies own) | own | `layout` visibility fn |
| Open a window type | DM types | player types | None needed: registry is per client; data stays filtered server-side |

## 11. Edge cases & failure modes

- **Player / DM disconnect / reconnect:** last view + banner; windows still movable; players unaffected by DM drops. Snapshot doesn't move windows (FR-SHELL-16); unsaved or in-flight changes go out as one new save (FR-SHELL-17), never a resend ([FR-SYNC-05](live-sync.md#6-functional-requirements)). **Campaign switch:** DM restores the new campaign's DM layout; players get the waiting screen, then the shell as it was.
- **Server crash:** committed saves survive; debounced or in-flight changes are saved after reconnect if the page is still open (lost only if it was closed too). **Concurrent edits:** two pages of one owner → last write wins, no live jumps (FR-SHELL-22).
- **Viewport change / resolution:** clamp (FR-SHELL-12). **Removed or unavailable window type:** FR-SHELL-18. **Active-scene switch:** resync, windows untouched.
- **Invalid / malicious input:** strict schema (FR-SHELL-19); oversize frame closes (live-sync); spoofed owner impossible; another owner's layout never reaches a player (leak test).

## 12. Performance & bandwidth

- Layout ≤ 4 KB (40 × ~100 B). Saves ≤ 2/s per page (500 ms debounce); each `LayoutSaved` frames only the owner's pages and the DM (local).
- Drag/resize moves the window by CSS transform; no store write or canvas re-render until pointer up; closed and minimised windows are unmounted. Target *(proposed, OQ-SHELL-10)*: canvas pan/zoom ≥ 50 fps with 8 open windows on the DM's laptop.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); temp DB, port 0 for tests.

- **Fixtures:** `base`, `player-2`, `campaign-second`, `sync-probes` (owners per [fixtures-adapters](fixtures-adapters.md#8-data-model)). **Added here** (via `shell.saveLayout`, OQ-SHELL-08): `layout-dm` = DM: `camp.players` open at (900, 60) 340×300; `layout-player-1` = `player-1`: `sync.probes` open at (40, 80) 360×280, `shell.test` minimised, `gone.window` open (unknown kind). **Bundle `play-shell`** = `base` + `player-2` + `campaign-second` + `sync-probes` + `layout-dm` + `layout-player-1`. Scene landing: `session-sim` once scenes-map ships `town` / `battlemap`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Window manager reducer: open/close/minimise/focus, launcher toggle, z-order, clamp math, default layout, unknown/unavailable kinds, dirty diff; debounce with fake timers; layout zod bounds | In-code |
| Integration | `shell.saveLayout` as DM and player writes only own record; extra owner field → `invalid`; 41 windows → `invalid`; no event-log row; snapshot carries own layout; **leak scan**: `player-2` frames never contain `layout-player-1`'s id; restart → identical layouts | `play-shell` |
| E2E (thin) | Playwright, `player-1`: move + resize a window, reload → restored; second context with the same link → same layout | `play-shell` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `reset-and-load play-shell --profile verify`, built client, `start --profile verify`; evidence per AGENTS §9.6. Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** `player-1` again (fresh storage).

| # | DM (A) | Players | Expected |
|---|---|---|---|
| 1 | Log in | — | Shell; "Connected"; badge "0/2 online"; Players window at (900, 60); base empty state |
| 2 | — | B opens link | B: "Playing as Player 1 · Fixture Campaign"; probes window at (40, 80); `shell.test` minimised; no error for `gone.window`. A: "1/2 online" |
| 3 | — | B moves + resizes probes, opens `shell.test`, clicks probes to front, reloads | Same positions, sizes, z-order after reload |
| 4 | — | C opens link | Default player layout; C's frames contain no other `layout` |
| 5 | — | B drags probes half off-screen, resizes viewport to 1280×720 | Title bar (≥ 120 px of it) stays in view |
| 6 | Rename Player 1 → "Mira's player" | — | B's top bar updates ≤ 1 s |
| 7 | — | B: "drop connection", moves a window while banner shows | Banner; window moves; after reconnect windows stay put; reload shows the moved position |
| 8 | Switch to "Second Campaign", then back | — | A: default DM layout, then (900, 60) layout again. B, C: waiting screen, then shell as before, no reload |
| 9 | Hard-kill + restart server | — | All: banner, rejoin, no window moves; reload → same layouts |
| 10 | — | D opens B's link; D: "Reset layout"; B reloads | D shows B's saved layout (server-persisted); after reset both show the player default |
| 11 | — | Mangled link | Invalid-link screen; no top bar, launcher or windows |
| 12 | *(`session-sim`, after scenes-map)* switch active scene | B open | B lands on town under its windows; on switch, base changes, windows untouched |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Connection states, indicator/banner/presence components, record-type + intent registration | agreed |
| [campaign-management](campaign-management.md) | Login / waiting / invalid-link screens and wording; switcher; players panel; `you.playerId` | agreed |
| [scenes-map](scenes-map.md) | Base-layer component, active scene, `map.scenes` window, canvas tools | open (OQ-SHELL-05) |
| [fixtures-adapters](fixtures-adapters.md) | `base`, `player-2`, `session-sim`; fixture steps acting as a player | open (OQ-SHELL-08) |
| Combat / Reward specs | Their window types and defaults | open (OQ-SHELL-06) |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SHELL-01 | Where is layout persisted? | **Server record per (campaign, owner), saved over WS** (survives browser switch and crash; DM receives players' layouts) / browser localStorage per link (no server work; lost on another browser, weaker than #48) / both, local as cache (instant restore; two sources of truth) | yes | live-sync, fixtures-adapters |
| OQ-SHELL-02 | Can the DM push a window open on players' pages? | **Not in MVP; `openWindow` lets a later notification action or signal do it** (no new protocol now) / yes now, as a closable suggestion (more scope) | no · owner: spec-play-shell | combat-tracker, notifications |
| OQ-SHELL-03 | Docked panels as well as floating? | **Floating only in MVP** (one model) / dock to edges (more layout code) | no · owner: spec-play-shell | — |
| OQ-SHELL-04 | DM layout per campaign or global? | **Per campaign** (fits ADR-0004 scoping) / global (needs a record outside any campaign) | no · owner: spec-play-shell | — |
| OQ-SHELL-05 | scenes-map contract | **scenes-map exports the base-layer component and active scene; shell owns the no-scene state; scene list = window `map.scenes`; canvas tools in a left tool rail slot owned by scenes-map** / scenes-map draws its own toolbar inside the canvas | no · owner: scenes-map | scenes-map |
| OQ-SHELL-06 | Window kinds for later specs | **`char.sheet` (both), `dice.log` (both), `cbt.initiative` (both), `cbt.encounters` (DM), `note.history` (both), `loot.log` (both)**; each spec confirms name, clients, default-open / own names | no · owner: each named spec | character-sheet, dice-roll-log, combat-tracker, notifications, party-loot |
| OQ-SHELL-07 | AGENTS §9.9: add the window registry lists (`src/client/dm/windows.ts`, `src/client/player/windows.ts`) to the append-only registries | **Yes** (features add lines in parallel) / shared file via orchestrator (serialises builds) | no · owner: orchestrator | AGENTS.md |
| OQ-SHELL-08 | Can a fixture step act as a player (for `layout-player-1`)? | **Steps name an actor: `dm` (default) or a player fixture key** (fixtures use real commands) / test-only DM command writing any layout (command the UI can't reach) | no · owner: spec-fixtures-adapters | fixtures-adapters |
| OQ-SHELL-09 | Glossary: add **Play page**, **Window**, **Window type**, **Launcher**, **Layout** (as in §1, §6, §8) | **Add** / keep spec-local | no · owner: integrator | glossary |
| OQ-SHELL-10 | Numbers: 500 ms debounce, 40 windows, 120 px clamp, 50 fps | **As proposed** / DM sets others | no · owner: DM | — |

## 16. Out of scope

- Tier A–C items in §2's later table; docked panels, pop-outs (§4); window contents (owning specs).
