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
- Features don't own pages: they register **window types**; the shell opens, arranges and persists them. Plug-in contract: [ADR-0025](../architecture/adr/0025-play-shell-windows.md).
- **Layout** lives in browser storage, per campaign and owner (DM or the link's player); it never reaches the server (#121).
- Hosts the foundation UI: connection indicator, reconnect banner, presence ([live-sync](live-sync.md)); switcher, players panel, login / waiting / invalid-link screens ([campaign-management](campaign-management.md)).
- **Feedback pass** (F1, #148; [ADR-0030](../architecture/adr/0030-ui-notification-sounds.md)): an **alert** surface for features (screen flash + short UI sound + Toast); first caller: combat's player turn alert ([FR-CBT-41](combat-tracker.md#6-functional-requirements)). Per-browser mute + volume.
- **Playtest pass** (#171; FR-SHELL-29–33): one shared **tooltip** delay (≈ 400 ms) and no tooltip fighting a popover (P1); windows **fit the work area** on smaller viewports (G3); the DM's Initiative default shows a full encounter (G2); presence reads "unknown" while the DM is not live (G10).
- **Polish pass** (sprint 1; FR-SHELL-34, 35): the shell reports the **free area** (work area no window covers) so the map can frame tokens there (R1, #178); the DM's Game log shows a real history at default size (R3).

## 2. Scope

- Page frame for DM and player clients: base layer, top bar, tool rail slot, launcher, banner, toast region. Window manager: open, close, move, resize, bring to front, minimise; clamp to viewport; reset layout *(proposed)*.
- Window registry (client code) and `openWindow(kind, instance?)` for features; `instance` key ready for several windows of one type (tokens open notes later, ADR-0014), MVP uses `main` only.
- **Alerts** (FR-SHELL-22–27): `alert()` API, flash, built-in ping, player sound control (mute, volume), audio unlock on first interaction, test-mode hooks.
- **Playtest pass** (FR-SHELL-29–33): shared Tooltip rules for both clients; render-time fit of windows to the work area; DM Initiative default height; presence badge while not live.
- **Polish pass** (FR-SHELL-34, 35): free-area helper for the canvas; Game log history numbers at default size. No new window, default geometry or stored field.
- **Later, not built** (nothing here may block them): command palette, shortcuts, portrait strip, pause overlay, DM "view as player". They plug in via the registry, a reserved strip slot above the launcher and an overlay layer.

## 3. Goals

- Everything used during play is reachable without leaving the canvas; a player sees the active scene with no clicks after opening the link.
- Each owner's arrangement survives reload, reconnect and a server or browser crash. A feature adds a window by registering it, no shell code changes. Layouts never leave the browser; opening a window grants no data.

## 4. Non-goals

- BG2 styling, portrait strip (→ [theme-system](post-mvp/theme-system.md)); mobile/touch ([ADR-0007](../architecture/adr/0007-product-scope.md)); docked panels; pop-out browser windows; restoring a layout on another browser (#121).
- Window contents (each owning spec); canvas behaviour ([scenes-map](scenes-map.md)).
- Music, ambience, soundboard, voice ([ADR-0007](../architecture/adr/0007-product-scope.md), [ADR-0030](../architecture/adr/0030-ui-notification-sounds.md)); DM-added sounds (tier A, design for later, FR-SHELL-26); OS / push notifications; a DM sound control (no DM alerts in MVP).

## 5. User stories

- **DM:** I want the players panel, scene list and (later) initiative as windows over the map, so that I run the session from one tab; and my arrangement back after a crash, so that I don't rebuild it mid-session.
- **Player:** I want to land on the map the DM is showing, so that I'm in the game the moment I open my link; and my windows where I left them.
- **Player:** I want the screen to flash and ping when something needs me (my turn), and to mute or turn it down, so that I don't miss it and it doesn't annoy the table.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-SHELL-01 | Each client has one play page. Base layer fills the viewport. Stacking, bottom → top: base layer < windows < chrome (top bar, tool rail at the left edge with content from scenes-map, launcher) < reconnect banner, toasts < dialogs, overlays. **Toast region:** bottom-right for players; top-centre for the DM, below the top bar and below top-anchored window title bars (so a sticky card never covers a window's close / minimise buttons), clear of the right-edge Initiative rows (#153, #165). | #153, #165 |
| FR-SHELL-02 | Player: valid link + active campaign → loading skeleton, then the shell after the first snapshot with the active scene as base layer. DM: base layer = the DM's viewed scene (#122, [FR-MAP-08](scenes-map.md#6-functional-requirements)). Nothing to show → one empty-state component: player "Waiting for the DM to show a scene", DM "No scenes yet" (the DM sees the first scene when none is active, [FR-MAP-08](scenes-map.md#6-functional-requirements); CON-32). Windows still work. | [FR-CAMP-16](campaign-management.md#6-functional-requirements) |
| FR-SHELL-03 | DM: valid secret + active campaign → shell after the first snapshot. No active campaign → campaign-management's "Create your first campaign" page; no shell, no WS. | |
| FR-SHELL-04 | Login (DM), invalid-link (`rejected`) and waiting (`waiting`) screens replace the whole shell, with campaign-management's wording. Leaving `waiting` restores the shell without reload, windows as they were. | [FR-SYNC-24](live-sync.md#6-functional-requirements) |
| FR-SHELL-05 | Top bar, right: connection indicator (both clients). Reconnect banner below the top bar, full width, live-sync's texts. While not `live`, feature intent controls are disabled (live-sync) but window management keeps working. | |
| FR-SHELL-06 | DM top bar: campaign switcher (CAMP §7); *(proposed, OQ-SHELL-11)* presence badge "N/M online" (tooltip: names), click opens `camp.players`. Player top bar: campaign-management's wording, "Playing as **‹player›** in **‹campaign›**"; renames show ≤ 1 s. While not `live`: FR-SHELL-33. | Presence: [FR-SYNC-23](live-sync.md#6-functional-requirements) |
| FR-SHELL-07 | A window type registers: `kind` (`<prefix>.<name>`), title, clients (`dm` / `player` / both), default + min size, default position, default open, launcher icon/label/order, optional `available(store)`, component. Only registered, available kinds for this client render. | OQ-SHELL-07 |
| FR-SHELL-08 | Open (launcher or `openWindow`): opens at the window's last geometry, else its default, or the first free slot if the default is covered by an open window (#144; built geometry in [protocol §18](../protocol/README.md#18-scenes-client-registries), which supersedes the §7 positions in feature specs); brings it to front. Already open → brought to front; minimised → restored. One instance per kind in MVP (`main`). | |
| FR-SHELL-09 | Launcher button: closed / minimised → open + front; open but behind → front; open on top → minimise. Button shows open / minimised state. | |
| FR-SHELL-10 | Move by dragging the title bar; resize by edges and corner, never below min size or beyond the viewport. Pointer-down anywhere in a window brings it to front. | |
| FR-SHELL-11 | Minimise hides the window (launcher marks it); close unmounts it. Both keep its geometry for the next open. | |
| FR-SHELL-12 | Clamp on restore, open and viewport resize: window ≤ viewport size; whole title bar height and ≥ 120 px of its width inside the viewport, below the top bar. Clamping is render-only: it never writes the layout; writes carry each untouched window's stored geometry. Smaller viewport than the one a window was stored at: FR-SHELL-29 first. | Amended #171 (G3) |
| FR-SHELL-13 | Pointer events reach the base layer only outside windows and chrome. Exception: an HTML5 drag that starts in a window and ends over the base layer delivers its drop to the base layer (e.g. [FR-ENT-18](entities.md#6-functional-requirements) rows). Key events whose target is inside a window, the top bar, the launcher, a dialog or any editable element never reach canvas handlers. | Ctrl-D ([FR-MAP-17](scenes-map.md#6-functional-requirements)) |
| FR-SHELL-14 | *(proposed)* Launcher menu "Reset layout" → this client's default layout, written. | Recovery |
| FR-SHELL-15 | The layout (every window's kind, instance, state `open` / `minimised` / `closed`, geometry, z-order) is one `localStorage` entry per (campaign, owner): key `pp.layout.v1.<campaignId>.<dm \| playerId>`, `playerId` from `you`. Written synchronously on each change: open, close, minimise, move end, resize end, bring to front. Never sent to the server. *(#171)* Each window also stores the work-area size at which **its** geometry was last set (`area {w, h}` on the WindowState: open at default / placement, move end, resize end; FR-SHELL-29); untouched windows keep their own `area`; windows without it still parse. | #121 |
| FR-SHELL-16 | The entry is applied after the first snapshot after page load and after the first snapshot after `you.campaignId` changes; no entry → default layout. Other snapshots (reconnect, resync, scene switch) never open, close or move windows. A change is written to the key of the campaign it was made in. | No jumps |
| FR-SHELL-17 | On read the entry is parsed with zod: ≤ 40 windows, unique (kind, instance), kind `^[a-z]+\.[a-z0-9-]+$` ≤ 64 chars, integer geometry within ±10 000 px. Invalid → default layout + console warning; the next change overwrites it. Storage unavailable or throwing → layout kept in memory only, console warning, no error UI. | |
| FR-SHELL-18 | Saved windows of unknown or unavailable kinds are skipped on restore without error; unknown ones are dropped at the next write, unavailable ones kept. When a kind becomes available it renders in its saved state; when it becomes unavailable it unmounts and keeps its saved state. | |
| FR-SHELL-19 | Same owner in two tabs: each restores from the entry on load; writes are last-write-wins; `storage` events are ignored, so a page never applies another page's changes live. | |
| FR-SHELL-20 | Test mode only: window type `shell.test` (both clients; shows its window key and a text input). Shown iff the client is in test mode by the same signal as live-sync's probe panel ([FR-SYNC-27](live-sync.md#6-functional-requirements)). Absent otherwise. | |
| FR-SHELL-21 | The shell registers windows whose owner specs are complete: `camp.players` (DM; campaign-management's players panel incl. online dots) and, in test mode, `sync.probes` (both; live-sync's probe panel and "drop connection" button). | |
| **Alerts** (feedback F1, #148) | | |
| FR-SHELL-22 | Client API `useShellAlert()` → `alert({id, title, detail?, sound?})` (both clients). Does: (1) a full-viewport **flash** in the overlay layer, `pointer-events: none`, two pulses over ≈ 1.2 s (≤ 3 flashes/s; #154) in a semantic accent token; `prefers-reduced-motion` → one steady 1.5 s frame glow; (2) a Toast "‹title› — ‹detail›" in the client's toast region (FR-SHELL-01); (3) the sound (FR-SHELL-24–26); (4) FR-SHELL-23. A repeat of the same `id` while its flash runs restarts it, no stacking. Shown in every connection state; never blocks input. | F1, ADR-0030 |
| FR-SHELL-23 | While the page is hidden (`document.hidden`), an alert prefixes the page title with "● ‹title› — " until the page is visible again. | Alt-tabbed players |
| FR-SHELL-24 | **Sound control** (player client): top-bar speaker Button (state on / muted / locked; muted or volume 0 shows muted before locked) with a Popover: Mute Switch, Volume Slider 0–100 (default 70, unmuted), **Test** (plays `ping`, counts as an interaction, respects mute). Stored as one `localStorage` entry per (campaign, owner) `pp.sound.v1.<campaignId>.<playerId>` = `{muted, volume}`, zod-parsed; invalid or unavailable storage → defaults, in memory, console warning (as FR-SHELL-17). Never sent. DM: none in MVP (#154). | ADR-0030 |
| FR-SHELL-25 | **Audio unlock** (ADR-0030): one shared Web Audio context, created on the first `pointerdown` or `keydown` anywhere on the page (not at load: Chrome warns about autoplay) (e.g. the first click after joining). Until then an alert is flash + Toast only, and the speaker shows `locked` (Tooltip "Click anywhere to enable sounds"). Muted or volume 0 → no sound. No Web Audio or a failed play → flash + Toast, one console warning. | |
| FR-SHELL-26 | Sounds come from a client sound list `{id, label, play(ctx, gain)}`; MVP ships **`ping`**, synthesised with Web Audio (two short sine tones, ≤ 400 ms; no file, no licence) (OQ-SHELL-12). Unknown id → `ping` (test mode records the sound actually played). **Design for later** (tier A): DM-added sounds = small audio assets ([assets-pipeline](assets-pipeline.md)) added as sound ids; a campaign setting picks the turn-alert sound, players may override per browser. Callers pass a sound id, so nothing changes for them. | ADR-0030 |
| FR-SHELL-27 | **Test mode** (as FR-SHELL-20): `ui-topbar` carries `data-test-last-sound="<id>:<played \| muted \| locked \| failed>:<n>"` (`n` counts alerts with a sound); `shell.test` gains an **Alert** button: `alert({id: "shell.test", title: "Test alert", sound: "ping"})`. | Walkthroughs |
| FR-SHELL-28 | **Content first at default size:** a window type's default size shows ≥ 3 rows of its primary content with all its optional chrome on. First case (#153): the DM's `dice.log` with Physical dice on (strip + roll bar) showed no entries; its build raises the DM default height or gives the log area a minimum (≥ 3 entries) and lets the roll bar scroll with the body. *(R3: numbers for `dice.log` raised by FR-SHELL-35.)* | #153 nit |
| **Playtest pass** (#171) | | |
| FR-SHELL-29 | **Fit on render** (G3; amends FR-SHELL-12). *Work area* = viewport below the top bar and above the launcher bar's top edge. Per window and **per axis**, against that window's own `area` (FR-SHELL-15): if the current work-area width < `area.w` (height < `area.h`), a window that lay wholly inside its stored work area on that axis renders wholly inside the current one: a window that touched (≤ 8 px) the stored right (bottom) edge keeps that gap to the current edge; any other moves left (up) only as far as needed; then it shrinks on that axis, never below min size. If min size still doesn't fit, FR-SHELL-12 applies. A window stored partly outside the work area (parked by the user) gets FR-SHELL-12 only. Render-only, like FR-SHELL-12: nothing written; back at the stored size the window is at its stored geometry. Windows without `area` (stored before this pass): FR-SHELL-12 only until their geometry is next set. Default layouts are built for the current work area (placement, protocol §18). | G3; OQ-SHELL-17 (decided #172) |
| FR-SHELL-30 | **Tooltips** (P1): every hover hint in both clients is the shared `Tooltip` (`@ui/components/ui/overlays`) under one provider per client with **one open delay, 400 ms** (a single exported constant; (decided #172) skip delay 300 ms: moving straight from one trigger to the next opens at once). Native `title` is not used on interactive elements (it can't be delayed or suppressed); it stays only on non-interactive truncated text. Tooltip content carries `data-testid="ui-tooltip"`. | P1 |
| FR-SHELL-31 | **Tooltip vs overlay** (P1): pressing a trigger (pointer down, Enter, Space) closes its tooltip and cancels a pending open; it stays closed until the pointer leaves the trigger. While a popover, dialog, dropdown or context menu opened from a trigger is open, that trigger's tooltip never opens; focus returned to the trigger when the overlay closes doesn't open it either. Tooltips inside the open overlay work normally. | P1: Roll initiative → popover |
| FR-SHELL-32 | **Default size shows a full encounter** (G2; extends FR-SHELL-28): the DM's `cbt.initiative` default height fits its header and **6 combatant rows** (the `session-sim` encounter) with no pending card, without scrolling, at 1440×900; FR-SHELL-29 fits it at 1280×720 (rows scroll). The map-first coverage floors (protocol §24: DM ≥ 70 % at 1440×900, ≥ 60 % at 1280×720) still hold. | G2; geometry in Shared changes |
| FR-SHELL-33 | **Presence while not live** (G10): while the DM client is not `live`, presence is unknown ([FR-SYNC-29](live-sync.md#6-functional-requirements)): the badge reads "– / M online", muted, Tooltip "Unknown while reconnecting", `data-state="unknown"`. Back to "N / M online" from the next snapshot. | G10 |
| **Polish pass** (sprint 1) | | |
| FR-SHELL-34 | **Free area** (R1; decided #178, [OQ-MAP-33](scenes-map.md#15-open-questions)): pure `freeArea(rects, vp)` + hook `useFreeArea()` in a new `free-area.ts`. Free area = the largest axis-aligned rectangle inside the work area (FR-SHELL-29), right of the tool rail (x ≥ 68 px), that no **rendered open** window overlaps (minimised / closed windows, toasts, popovers and the attack popup don't count). Ties → the higher, then the more left one. Smaller than 320×240 or than 25 % of the work area → the work area right of the rail. The hook also returns a counter of **appearances**: windows rendered because their kind became available while open (FR-SHELL-18; e.g. player `cbt.initiative` on Start), not user opens. Kinds that first become available in a **reconnect snapshot** (e.g. a player offline at Start) count as **one** appearance for that snapshot. `noteAppearance()` (same file) adds one for feature-driven opens: [FR-CBT-60](combat-tracker.md#6-functional-requirements) after the DM's own Start. Read-only otherwise; nothing stored or sent. Consumer: [FR-MAP-44](scenes-map.md#6-functional-requirements). | R1 |
| FR-SHELL-35 | **Game log history at default size** (R3; amends FR-SHELL-28 for `dice.log`; decided #178, OQ-DICE-25): at its default size, with the roll bar collapsed ([FR-DICE-30](dice-roll-log.md#6-functional-requirements)), the DM's `dice.log` (460×240) shows ≥ 6 single-line entries with Physical dice off and ≥ 4 with it on (strip shown); the player's (340×280) ≥ 6 / ≥ 4. No bigger default (map-first #162, R1). | R3 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark only, laptop viewports (≥ 1280 px), semantic tokens only, map is the hero (thin chrome over the canvas, no reserved margins).

- **Top bar** (thin, overlays the canvas): left = campaign (DM: switcher Select + "New campaign" Dialog; player: "Playing as …"); right = DM presence Badge, player speaker Button (lucide volume / volume-x icon, FR-SHELL-24), connection indicator (Badge + Tooltip).
- **Alert flash** (FR-SHELL-22): overlay layer above dialogs, inset frame + translucent fill in an accent placeholder token (theme-system names it); Toast in the existing region. **Tool rail**: left edge, below the top bar; slot filled by scenes-map, empty otherwise.
- **Tooltips** (FR-SHELL-30/31): shadcn Tooltip only, small panel surface, side top by default; same delay everywhere; e.g. the sheet's "Shift: advantage · Ctrl: disadvantage" hint becomes a Tooltip and stays shut while the roll popover is open.
- **Launcher**: bottom-centre bar of icon Buttons with Tooltips (BG2 "bottom action bar" motif later via theme); trailing "⋯" menu with "Reset layout". **Toasts**: one region per client: player bottom-right; DM top-centre below the top bar (FR-SHELL-01).
- **Window**: panel surface; title bar (title, minimise, close), scrolling body, resize handle; focused window uses a semantic border token (names: [theme-system](post-mvp/theme-system.md)).
- **No new dependency**: pointer events + CSS transform. A drag/resize library needs the DM's OK (AGENTS §3).
- **Defaults** (DM): `camp.players` top-right, `map.scenes` top-left (scenes-map). Player: none open in Scenes phase; Combat specs set `defaultOpen` for theirs (OQ-SHELL-06).
- **States:** `connecting` = skeleton over the page; `live` = shell; `reconnecting` = last view + banner, windows usable; `waiting` / `rejected` = campaign-management screens; nothing to show = base empty state.
- **DM view:** switcher + presence; DM window types; base = viewed scene. **Player view:** name + campaign; player window types; base = active scene.
- **Test IDs** (`ui-` per AGENTS §9.5): `ui-topbar`, `ui-presence-badge`, `ui-tool-rail`, `ui-launcher`, `ui-launcher-button` + `data-record-id=<kind>`, `ui-launcher-menu`, `ui-launcher-reset`, `ui-window` + `data-record-id=<kind>:<instance>` + `data-state`, `ui-window-title`, `-minimise`, `-close`, `-resize`, `ui-base-empty`, `ui-alert-flash` (+ `data-alert-id`), `ui-sound-button` (+ `data-state`), `ui-sound-mute`, `ui-sound-volume`, `ui-sound-test`; test mode `shell-test-alert`; `ui-tooltip` (tooltip content); `ui-presence-badge` gains `data-state` = `known` \| `unknown`. Indicator keeps live-sync's `sync-connection-status`.

## 8. Data model

No server entity, record type or migration (#121). Client-side only:

| Entity | Field | Type | Notes |
|---|---|---|---|
| Layout *(browser `localStorage`)* | key | `pp.layout.v1.<campaignId>.<dm \| playerId>` | One per (origin, campaign, owner); no secret token in the key |
| | windows | WindowState[] | zod-parsed on read (FR-SHELL-17); ≤ ~4 KB |
| WindowState *(in `windows`)* | kind, instance, state, x, y, w, h, z | string, string (`main`), `open` \| `minimised` \| `closed`, int ×5 | px from viewport top-left; z = stacking order |
| | area *(#171)* | `{w, h}` int, optional | Work area when this window's geometry was last set (FR-SHELL-29) |
| Window type *(client code)* | FR-SHELL-07 fields | — | Per-client registry; not sent or stored |
| Sound settings *(browser `localStorage`)* | key; muted, volume | `pp.sound.v1.<campaignId>.<playerId>`; bool, int 0–100 | FR-SHELL-24; defaults unmuted, 70 |
| Sound *(client code)* | id, label, play | — | FR-SHELL-26; MVP `ping` only |

- **Relations:** key names a Campaign and Player ([campaign-management](campaign-management.md)) by ID only; kinds name window types, not records. **Derived:** rendered geometry = clamp(fit(stored, area, work area), viewport) (FR-SHELL-29, -12); launcher states; presence known iff `live`; *(R1)* free area from the rendered rects, appearance counter (FR-SHELL-34). **Persisted runtime state:** the Layout entry; window manager state is client memory, rebuilt from it on load.

## 9. API & events

- **REST, WS intents, record types, domain events, signals:** none. Envelopes, rejects, close codes: [live-sync](live-sync.md).
- **Visibility:** N/A; layouts never leave the browser. Window contents read the synced store, already filtered server-side.
- **Client API for features:** `registerWindow(def)` (one line in the client's registry list), `openWindow(kind, instance?)`, `useShellAlert()` (FR-SHELL-22). The shell passes no data. Alerts are client-side reactions to events the client already received; the shell adds no event, intent or record.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Arrange, persist, reset own layout | ✓ | ✓ | — (browser only) |
| Open a window type | DM types | player types | None needed: registry is per client; data stays filtered server-side |
| Mute, volume | — | own browser | — (browser only) |

## 11. Edge cases & failure modes

- **Player / DM disconnect / reconnect:** last view + banner; windows still movable and written; players unaffected by DM drops. Snapshots don't move windows (FR-SHELL-16).
- **Campaign switch:** DM restores the new campaign's DM entry (default if none); players get the waiting screen, then the shell as it was.
- **Server crash:** layout unaffected (browser-side). **Browser crash:** every finished change was already written; a drag in progress is lost.
- **Another browser, fresh profile, or new origin** (dev vs verify port, new tunnel URL): separate storage → default layout. Accepted (#121).
- **Two tabs, same owner:** last write wins, no live jumps (FR-SHELL-19). **Two players on one browser** (different links): separate keys.
- **Viewport change:** clamp, render-only (FR-SHELL-12). **Removed or unavailable window type:** FR-SHELL-18. **Corrupt or full storage:** FR-SHELL-17.
- **Shared computer:** entries hold only window geometry and kinds, no game data.
- **Playtest pass:** viewport shrinks mid-session → windows refit at once, render-only; a drag / resize in progress is refit at pointer up. Layout from a bigger screen opened on a laptop → fits; reopened on the big screen → as stored. Tooltip pending when the connection drops: unaffected (client only). Presence: disconnect → "unknown" at once; reconnect → snapshot presence; server crash → "unknown" until rejoin (no stale "2/2 online").
- **Polish pass:** free area is recomputed from what is rendered (viewport resize, window moves); only the canvas decides when to use it (FR-MAP-44). Every window minimised → the work area. Disconnect / reconnect / crash: client-only geometry, unaffected; snapshots never open, close or move windows (FR-SHELL-16); a kind that first becomes available in a reconnect snapshot counts as one appearance (FR-SHELL-34).
- **Alerts:** audio still locked (no interaction yet) → flash + Toast only; the speaker shows `locked`. Two tabs of one player → both alert and play (accepted). Tab hidden → title mark (FR-SHELL-23); the sound plays if unlocked. Disconnect / reconnect: alerts come only from live events, so nothing replays on a snapshot (callers' rule, e.g. FR-CBT-41). Server crash: no effect on settings. Corrupt or missing sound settings → defaults.

## 12. Performance & bandwidth

- No network cost. One synchronous ≤ 4 KB `localStorage` write per finished change.
- Alerts: one CSS animation on one element; the ping is synthesised (no download). Sound settings ≤ 50 B per write.
- Drag/resize moves the window by CSS transform; no store write or canvas re-render until pointer up; closed and minimised windows are unmounted. Target *(proposed, OQ-SHELL-10)*: canvas pan/zoom ≥ 50 fps with 8 open windows on the DM's laptop.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); temp DB, port 0 for tests.

- **Fixtures:** none added (no record type; fixtures act as DM only, FR-FIX-13). **Bundle:** live-sync's `sync-probe` = `base` + `player-2` + `campaign-second` + `sync-probes`. Scene landing: scenes-map's walkthrough.

| Level | What | Fixtures |
|---|---|---|
| Unit | **Alerts:** same-id restart; reduced motion → glow; title prefix while hidden, cleared on visible; sound outcome with a stub AudioContext (locked before first pointerdown, then played; muted; volume 0; throwing → failed); sound settings parse (bad JSON, volume 101 → defaults; throwing storage → memory); unknown sound id → ping; `data-test-last-sound` only in test mode. Window manager reducer: open/close/minimise/focus, launcher toggle, z-order, clamp math (render-only; untouched windows keep stored geometry), default layout, unknown/unavailable kinds and availability flips. Storage: key per (campaign, owner); write after campaign switch goes to the old key; zod bounds (41 windows, duplicate (kind, instance), bad kind, geometry > 10 000 → default); corrupt JSON → default; throwing storage → memory only. FR-SHELL-13: Ctrl+D typed in a window input, top bar, dialog never reaches a stub base key handler; drag from a window delivers drop to a stub base drop target. Test mode off → `shell.test`, `sync.probes` not in registry or launcher. Toast region placement per client (DM top-centre, player bottom-right). **Playtest (#171):** `FR-SHELL-29 fit` (stored at 1440×900 → 1280×720: right-edge window keeps its gap, bottom window ends above the launcher, mid window moves only as needed, shrink stops at min, parked window clamps only, no `area` → clamp only, nothing written, back to 1440×900 = stored; per window: at 1280×720 move one window → the others keep their 1440×900 `area` and still fit; per axis: only width smaller → only x / w change); `FR-SHELL-30 delay` (fake timers: no `ui-tooltip` at 399 ms, shown at 400 ms; one constant used by both providers); `FR-SHELL-31` (pointer down closes and stays closed until leave; trigger opens a Popover → no tooltip while open; Escape returns focus → no tooltip); `FR-SHELL-33` (badge "– / 2" with `data-state="unknown"` while `reconnecting`, "1 / 2" after snapshot); lint-style test: no `title=` on `button`, `a` or `[role=button]` in `src/client/**`. **Polish:** `FR-SHELL-34 free area` (largest rect; minimised excluded; rail strip excluded; tie → higher, then left; < 320×240 or < 25 % → work area; appearance counter: availability flip of an open window counts; two kinds first available in one reconnect snapshot count once; `noteAppearance()` counts; user open / restore and a snapshot with no newly available kind don't); `FR-SHELL-34 default layout leaves tokens uncovered` (registry-driven, next to the #162 coverage tests in `src/client/{dm,player}/features/play-shell/windows.test.ts`: DM and player default layouts at 1280×720, 1440×900, 1600×900; the `session-sim` Goblin Ambush token cells (DM: all six; player: the four visible) fitted with FR-MAP-44 → no token centre inside a window rect; DM with `cbt.initiative` open, player before and after `cbt.initiative` appears) | In-code |
| Integration | N/A: no server code. Covered by unit (client) and E2E | — |
| E2E (thin) | Playwright, `player-1`: move + resize a window, reload → restored; same context opens `player-2`'s link → default layout; no WS frame contains a `windows` field. Reset-only DB: DM login → create page, no WS opened. Test window **Alert** → `ui-alert-flash` shown, `ping:played:1`. FR-SHELL-35 (amended #178, replaces the FR-SHELL-28 check): DM `dice.log` at default size, 8 single-line entries: ≥ 6 rows fully visible; Physical dice on → ≥ 4. FR-SHELL-32: DM at 1440×900 after Start → 6 `cbt-init-row` fully visible, no scroll | `sync-probe`; `dice-log`; `combat` |

**Review checks:** adding a window type touches only the client's registry list; no drag/resize dependency added.

**Browser walkthrough** — `PP_TEST_MODE=1`; `reset-and-load sync-probe --profile verify`, built client, `start --profile verify`; evidence per AGENTS §9.6. Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** `player-1` again (fresh storage). All start at 1600×900.

| # | DM (A) | Players | Expected |
|---|---|---|---|
| 1 | Log in | — | Shell; "Connected"; badge "0/2 online"; Players window top-right; base "No scenes yet" |
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
| 12 | — | B: speaker → volume 40, Mute; reload; Test window **Alert** | After reload: muted, 40. Alert: flash + Toast "Test alert", `data-test-last-sound` `ping:muted:1`, no audio |
| 13 | — | B: unmute; **Alert** again; C: Alert (C clicked before) | B: `ping:played:2`. C: `ping:played:1` at volume 70 (own entry). The DM top bar has no speaker. No console errors |
| 14 | `browser_evaluate` on a launcher button: dispatch `pointerenter` / `pointermove`, sample `[data-testid=ui-tooltip]` at 200 ms and 600 ms via `setTimeout`, return the booleans; then the same on the next button right after leaving the first | — | `false` at 200 ms, `true` at 600 ms; next button `true` at ≈ 50 ms (skip delay). Exact timing is the fake-timer unit test's job |
| 15 | — | B: open Probes, park it half off the right edge; open Test at its default; viewport 1440×900 → 1280×720 | Test window wholly inside the work area (above the launcher, right edge in view); Probes clamped only (title bar ≥ 120 px in view). Back at 1440×900: both at their stored spots; reload → same |
| 15b | — | B: at 1280×720 move Test; check; back to 1440×900 | Probes still clamp-only; the other open windows still fit (their own `area` is 1440×900); back at 1440×900 the untouched windows are at their stored spots, Test where it was moved |
| 16 | Hard-kill the server; read the badge; restart | — | During the outage: badge "– / 2 online", `data-state="unknown"`, next to "Reconnecting…". After rejoin: "N / 2 online" |

**Polish pass:** free area / fit (FR-SHELL-34) is walked in [scenes-map §13](scenes-map.md#13-test-plan) step 12 and [combat-tracker §13](combat-tracker.md#13-test-plan) step 3; Game log history (FR-SHELL-35) in [dice-roll-log §13](dice-roll-log.md#13-test-plan) step 12.

**Tooltip vs popover** (FR-SHELL-31) is walked where the clash was seen: [character-sheet §13](character-sheet.md#13-test-plan) step 11 (Physical dice on, hover Initiative, click → popover, no tooltip). FR-SHELL-32 at 1440×900: [combat-tracker §13](combat-tracker.md#13-test-plan) step 3.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md) | Connection states, indicator/banner/presence components, probe panel, test-mode signal | agreed |
| [campaign-management](campaign-management.md) | Login / waiting / invalid-link screens and wording; switcher; players panel; `you.playerId`, `you.campaignId` | agreed |
| [scenes-map](scenes-map.md) | Base-layer component, viewed/active scene, tool rail content, `map.scenes` window | agreed (OQ-SHELL-05) |
| [entities](entities.md), [assets-pipeline](assets-pipeline.md) | `ent.creatures` (drag source, FR-SHELL-13), `asset.test` (test mode, [FR-ASSET-19](assets-pipeline.md#6-functional-requirements)) windows | agreed (CON-28) |
| Combat / Reward specs | Their window types and defaults | open (OQ-SHELL-06) |
| [combat-tracker](combat-tracker.md) (feedback) | First `alert()` caller: player turn alert ([FR-CBT-41](combat-tracker.md#6-functional-requirements)); [ADR-0030](../architecture/adr/0030-ui-notification-sounds.md) accepted (#148) | complete |
| [dice-roll-log](dice-roll-log.md), [notifications](notifications.md) | `dice.log` default size meets FR-SHELL-28 (#153); toast region placement (built, #153) | complete |
| Playtest pass (#171) | [live-sync](live-sync.md) FR-SYNC-29 (presence unknown while not live); [combat-tracker](combat-tracker.md) `cbt.initiative` rows for FR-SHELL-32; every feature with hover hints moves to the shared Tooltip (FR-SHELL-30) | complete (#172) |
| Polish pass (sprint 1) | [scenes-map](scenes-map.md) FR-MAP-44/45 consume the free area (R1); [dice-roll-log](dice-roll-log.md) FR-DICE-30 compact roll bar (R3) | complete (#178) |

**Shared changes** (feedback pass):
- **Existing common files this build edits:** play-shell's frame files stay shared (AGENTS §9.9, #154), so route via the orchestrator: `src/client/common/features/play-shell/{PlayFrame.tsx (flash overlay layer, player top-bar speaker Button), ShellContext.tsx (alert API), test-windows.tsx (`shell-test-alert`)}`. FR-SHELL-28: `src/client/common/features/dice-roll-log/{GameLog.tsx, window.ts}` (dice-roll-log-owned; fold into this build or a `fix/*`). New files (free): alert store, sound engine + `ping`, sound settings storage.
- No server, schema, event, protocol or record change; data-model / protocol unchanged. Glossary: OQ-SHELL-15.

**Shared changes** (playtest pass, #171; orchestrator routes per AGENTS §9.9):
- **Existing common UI** (shared): `src/client/common/components/ui/overlays.tsx`: Tooltip delay constant, FR-SHELL-31 suppression, `ui-tooltip`; Popover / DropdownMenu wrappers in the same folder (`menus.tsx`, `controls.tsx`) only if suppression needs an "opened from" hook. `src/client/dm/main.tsx`, `src/client/player/main.tsx`: provider takes the shared constant (today `delayDuration={200}`).
- **Play-shell frame** (shared, #154): `geometry.ts`, `ShellWindow.tsx`, `storage.ts` (per-window `area`) for FR-SHELL-29. `placement.ts` already fits to the area above the launcher (protocol §18); at most it exports the work-area helper.
- **Feature files the playtest builds touch** (feature-owned; native `title` → Tooltip, FR-SHELL-30): `CharacterSheet.tsx` (roll hints), `HistoryWindow.tsx` (Pending / History), DM `initiative-window.tsx` (Moved cell), `CampaignBar.tsx` / `PlayersPanel.tsx` (campaign-management: icon buttons; presence badge FR-SHELL-33), `scenes-window.tsx`, `token-menu-entries.tsx`, `creature-form.tsx` where a `title` sits on a button.
- **Protocol §24 / §18** (consolidated #172, protocol §30): DM `cbt.initiative` default geometry 400 × ≈ 500 (exact height set by the build to meet FR-SHELL-32); §18 "Default layout" gains the work-area / fit rule and the 6-row check. No data-model change.

**Shared changes** (polish pass, sprint 1; after the DM gate):
- **New file** (free, AGENTS §9.9): `src/client/common/features/play-shell/free-area.ts` (FR-SHELL-34: `freeArea`, `useFreeArea`, `noteAppearance`; reads the existing `useShellState` / `useAvailableKinds` exports and the sync connection transition for reconnect snapshots, so no frame file changes). Layout tests: the existing `src/client/{dm,player}/features/play-shell/windows.test.ts` coverage tests gain the token check (tests only; `map-coverage.ts` may gain a helper).
- FR-SHELL-35: dice-roll-log's own `GameLog.tsx` (FR-DICE-30); no shell file.
- **None:** DB, events, protocol messages, default geometry, `WindowState`. Docs at consolidation: protocol §18 (free area; token check in "Default layout"), §24 `dice.log` row (collapsed roll bar, history numbers). Glossary: OQ-SHELL-20.

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-SHELL-01~~ | ~~Where is layout persisted?~~ | **Decided (#121):** browser storage keyed by player link / DM (FR-SHELL-15) | — | — |
| OQ-SHELL-02 | Can the DM push a window open on players' pages? | **Not in MVP; `openWindow` lets a later notification action or signal do it** / yes now, as a closable suggestion (more scope) | no · owner: spec-play-shell | combat-tracker, notifications |
| ~~OQ-SHELL-03~~ | ~~Docked panels?~~ | Removed: non-goal (§4) | — | — |
| OQ-SHELL-04 | DM layout per campaign or global? | **Per campaign** (fits ADR-0004 scoping) / one DM entry for all campaigns | no · owner: spec-play-shell | — |
| OQ-SHELL-05 | scenes-map contract | **Agreed by [scenes-map §7](scenes-map.md#7-uiux-notes):** scenes-map exports base-layer canvas + scene; shell owns empty state and tool rail slot; scene list = `map.scenes` | no · owner: scenes-map | scenes-map |
| OQ-SHELL-06 | Window kinds for other specs | **`ent.creatures` (DM), `asset.test` (DM, test mode only; picker grid, per [OQ-ASSET-08](assets-pipeline.md#15-open-questions) / [FR-ASSET-19](assets-pipeline.md#6-functional-requirements), CON-28), `char.sheet`, `dice.log`, `cbt.initiative`, `note.history`, `loot.log` (both), `cbt.encounters` (DM)**; each spec confirms name, clients, default open | no · owner: each named spec | entities, assets-pipeline, character-sheet, dice-roll-log, combat-tracker, notifications, party-loot |
| OQ-SHELL-07 | AGENTS §9.9: window registry lists (`src/client/dm/windows.ts`, `src/client/player/windows.ts`) as append-only registries; build order | **Yes, and the shell frame + empty registries merge before other Scenes builders register windows (or `fix/shell-registry` creates them first)** / shared file via orchestrator (serialises builds) | no · owner: orchestrator | AGENTS.md, Scenes builds |
| ~~OQ-SHELL-08~~ | ~~Can a fixture step act as a player?~~ | **Decided (integrator ruling, gate Scenes; FR-FIX-13):** fixtures act as DM only; no layout fixture (moot after #121) | — | — |
| ~~OQ-SHELL-09~~ | ~~Glossary: add **Play page**, **Window**, **Window type**, **Launcher**, **Layout**~~ | **Decided (integrator, Scenes consolidation):** added to the [glossary](../glossary.md) | — | — |
| OQ-SHELL-10 | Numbers: 40 windows, 120 px clamp, 50 fps | **As proposed** / DM sets others | no · owner: DM | — |
| OQ-SHELL-11 | DM presence badge "N/M online" in the top bar | **Keep** (one glance; opens `camp.players`) / drop (panel's online dots suffice) | no · owner: DM | — |
| OQ-SHELL-12 | Default ping source (F1) | **Synthesised with Web Audio** (no file, no licence, no download) / a bundled short audio file (needs a licence and a decoder path) | no · owner: spec-feedback | assets-pipeline (tier A sounds) |
| ~~OQ-SHELL-13, 14~~ | ~~Sound control placement; flash style~~ | **Decided (#154):** player top-bar speaker + Popover, settings per (campaign, player), no DM control; two pulses ≈ 1.2 s, frame + translucent fill, reduced motion → steady glow | — | visual-direction |
| ~~OQ-SHELL-15~~ | ~~Glossary: add **Alert**~~ | **Decided (integrator, feedback consolidation):** added to the [glossary](../glossary.md) | — | — |
| ~~OQ-SHELL-16~~ | ~~Tooltip timing (P1)~~ | **Decided (#172):** 400 ms open, 300 ms skip delay (FR-SHELL-30) | — | all clients |
| ~~OQ-SHELL-17~~ | ~~How windows reflow on a smaller screen (G3)~~ | **Decided (#172):** per-window work-area size, edge gaps kept, fit per axis (FR-SHELL-29) | — | protocol §18 |
| ~~OQ-SHELL-18~~ | ~~Glitch verdicts G2, G3, G10 (playtest)~~ | **Decided (#172):** verdicts accepted: G2 → FR-SHELL-32 + [FR-CBT-55](combat-tracker.md#6-functional-requirements) (windows over tokens stay accepted, #144, #162); G3 → FR-SHELL-29; G10 → FR-SHELL-33 + FR-SYNC-29, campaign-management's dots amended (FR-CAMP-14) | — | combat-tracker, live-sync |
| ~~OQ-SHELL-19~~ | ~~Glossary: add **Work area** ("viewport below the top bar and above the launcher; windows fit into it", FR-SHELL-29, -32, [FR-CBT-55](combat-tracker.md#6-functional-requirements))~~ | **Decided (#172):** **Work area** added to the [glossary](../glossary.md) | — | glossary |
| ~~OQ-SHELL-20~~ | ~~Glossary: add **Free area**~~ | **Decided #178:** add "**Free area**: the largest part of the work area, right of the tool rail, that no open window covers; the map frames its tokens there" (FR-SHELL-34, FR-MAP-44); integrator writes it at merge | — | glossary, scenes-map |

## 16. Out of scope

- §2's later list; docked panels, pop-outs, cross-browser layout (§4); window contents (owning specs).
