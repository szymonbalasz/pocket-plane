---
title: Dice extras
prefix: DICEX
status: in-review
owner: spec-tt, spec-fx
phase: post-mvp-9
---

# Dice extras

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Scope: DM decision [#203](../decisions-log.md) (sprint 3, track D). Builds on [dice-roll-log](dice-roll-log.md) (DICE); stub and tier table: [post-mvp/dice-extras](post-mvp/dice-extras.md).

> **Sprint 6 (track PF; DM [#285](../decisions-log.md) [2]).** Settings move to a **Preferences window** ([play-shell](play-shell.md) FR-SHELL-70–76). *OQ-SHELL-47 decided A (#288)*: this spec registers a **Dice** section there: the existing settings panel (display, others' rolls, roll popups, "Dice look…"), same stores; the tray and popup gears stay as shortcuts (OQ-DICEX-48). New FR-DICEX-57, -58 (PF2). No server, record or storage change; 0 B. Walkthrough: [play-shell §13](play-shell.md#13-test-plan) P9, P10.

> **Sprint 7 (track FU, BL-48; DM [#311](../decisions-log.md)).** Decided, not open: no stray spaces in dice text. New **FR-DICEX-63** (with [FR-DICE-78](dice-roll-log.md#6-functional-requirements)). Test `FR-DICEX-63 notation spacing` (unit over `notation.ts` and the popup line: no `"( "`, `" )"`, `"  "`); walkthrough U17 in [play-shell §13](play-shell.md#13-test-plan); slice FU4. The sim-10 note "DM tray opens 360 × 248, not 300 × 240" is **dropped here**: 300 × 240 is the tray's min, its default is 360 × 300 (FR-DICEX-01), and the 248 came from auto placement's shrink, which play-shell's useful size now governs (FR-SHELL-79). Client only, 0 B. Edge cases: client-only text; reconnect re-renders from the store; crash: no server change. No open question.

> **Sprint 8 (track TT; DM [#334](../decisions-log.md)).** Decided: **saved macros** (one click → the normal roll path incl. physical dice and the tray) and **DM roll requests** (a notification with a roll action, results hidden or public per request), moved here from the [stub](post-mvp/dice-extras.md). FR-DICEX-64–93; [proposed ADR](../architecture/adr/0061-roll-requests.md). §12–14 also hold TT's CON-44, tests, walkthrough and build split for the pause screen ([play-shell](play-shell.md) FR-SHELL-125–136, [campaign-management](campaign-management.md) FR-CAMP-46–50) and sounds ([assets-pipeline](assets-pipeline.md) FR-ASSET-52–61). Decided at gate 1 (#335): OQ-DICEX-49–60.

> **Sprint 9 (track FX, fix pack; DM [#338](../decisions-log.md)).** FR-DICEX-94–95, slice **FX2**, walkthrough [dice-roll-log §13 FX2](dice-roll-log.md#13-test-plan). No schema, 0 B.
> - **BL-89**: a roll popup stuck over the map after a mid-combat Add.
> - **BL-90**: "Name is required" before typing a macro name.
> - Die chips draw their numbers as HTML text for [FR-DICE-93](dice-roll-log.md#6-functional-requirements) (BL-57; `DieShape.tsx`).

## 1. Summary

- **Dice tray**: a window where a roll is composed or adjusted before it is sent. It becomes the roll control's second face: roll buttons still roll at once, Alt+click stages the roll in the tray; clicked dice notation always lands there.
- **3D dice**: every `roll` log entry a client receives is **thrown** as 3D dice that settle on the **server's** faces ([ADR-0022](../architecture/adr/0022-deterministic-seams.md), [FR-DICE-03](dice-roll-log.md#6-functional-requirements)). Purely cosmetic and client-side: no new server command, event or signal for the animation; visibility is the game log's ([ADR-0044](../architecture/adr/0044-3d-dice.md)).
- **Clickable dice notation** in free text ("1d12+5", "1d12 + 5"): puts the dice in the tray to adjust, then rolls a plain `dice.roll`; never feeds attack / apply.
- **Dice look** per owner (DM, each player): a named style, colours, material; everyone sees the roller's look.
- **Sprint 4** (DM [#243](../decisions-log.md) [10, 11, 12], [#244](../decisions-log.md); FR-DICEX-32–45): animated dice are the **default**: a full-screen set bounces off the screen edges **over everything**; the sprint-3 throw zone stays as the "Tray throw" option. Every received roll opens an Owlbear-style **roll popup** in the toast region with the same dice in picture-in-picture. Result chips become **die shapes** (flat d20 with the number, d6 square, …). The result stays the server's: the animation only presents it. Fixes sim-7's flat first throw and the caption over a token label.

**Sprint 4 at a glance** (review B43; sprint-3 FRs 01–31 are built: D1–D4, [#214](../decisions-log.md)–[#238](../decisions-log.md))

| FR | What | Slice | Named test(s) (§13) |
|---|---|---|---|
| 32 | Display modes; reduced motion / no WebGL → effective `flat` | D6 | `FR-DICEX-32 display modes` |
| 33 | Topmost dice layer, no input, no caption, die size clamp | D6 | `FR-DICEX-33 dice layer` |
| 34 | Lands on the server's faces in every arena | D6 | `FR-DICEX-34 …` |
| 35 | Timing, hand-off, interrupt | D6 (hand-off: D7) | `FR-DICEX-35 timing` |
| 36 | Settings v2 + v1 migration | D6 | `FR-DICEX-36 settings v2` |
| 37 | Idle preload (sim-7 first throw) | D6 | `FR-DICEX-37 preload` |
| 38 | DM-only rolls only in the DM's popup | D6 (no big throw), D7 (PiP) | `FR-DICEX-38 DM-only`, integration |
| 39–40 | Roll popup: sources, stack, content, named rows | D7 | `FR-DICEX-39 …`, `FR-DICEX-40 content` |
| 41 | PiP: same dice; hand-off / miniature / chips | D7 | `FR-DICEX-41 PiP same dice` |
| 42 | Die-shape chips everywhere | D5 | `FR-DICEX-42 die-shape chips` |
| 43–45 | Others off, slow devices, reduced motion | D6 | `FR-DICEX-43`, `-44`, `-45` |
| 09, 17, 18 *(amended)* | Pending in the popup; zone on the one canvas; interrupt hands off | D6 / D7 | amended cases in their tests |

- **Sprint 5** (DM [#250](../decisions-log.md) [2, 3], [#251](../decisions-log.md); FR-DICEX-46–52): the popup shows its dice **in a line at full size** (BL-22: 10d6 no longer shrinks to dots); the tray shows the **3D dice that will be rolled** instead of the "d12" text badge; the tray, popup and log **total waits until the dice land** (sim-8 glitch 8); a fresh tray roll never keeps an old label (BL-18); "Alt: adjust in tray" on every stageable roll button (BL-15); the built client is **served compressed and cached** (BL-21). Results stay the server's (`ctx.dice`): all of it is presentation. Damage types in the physical form (BL-20) are [FR-DICE-41](dice-roll-log.md#6-functional-requirements), the log's hold is [FR-DICE-40](dice-roll-log.md#6-functional-requirements).

**Sprint 5 at a glance**

| FR | What | Slice | Named test(s) (§13) |
|---|---|---|---|
| 46 | Popup dice in a line, fixed die size, wrap / cap (amends 41) | D11 | `FR-DICEX-46 popup line layout` (1, 4, 10, 20 dice) |
| 47 | Popup size (constants set by W1, seams S2) | D11 (internals); W1 (constants) | `FR-DICEX-47 popup size` |
| 48 | Tray preview: 3D dice of the staged roll (amends 04, 05) | D10 | `FR-DICEX-48 tray preview per die type` |
| 49 | Landing: totals wait for the dice (amends 10, 16) | D8 | `FR-DICEX-49 total hidden until landed` |
| 50 | Label reset (BL-18) | D8 | `FR-DICEX-50 label reset` |
| 51 | Alt hint on every stageable roll button (BL-15; amends 06) | D9 | `FR-DICEX-51 Alt hint on each roll button` |
| 52 | Built client served precompressed + cached (BL-21) | D12 | `FR-DICEX-52 compressed chunk served` |

- **Sprint 6** (track WF, window + layout fix pack; DM #286; session-sim-9 glitch 7, BL-44; FR-DICEX-53–55): decided, not open: **the tray keeps its Roll button visible** at its min size 300×240 with dice staged (sim-9 d01: Roll at y 301–329 under the window's bottom edge at 300; the 3D stills took the room; the player had to scroll). Root cause: the tray body is one scroll column, so the stills (40 px, wrapping) push the bottom bar out. Plus a seam with the toast fix: the DM's roll-popup stack never lands on the active tool bar (FR-DICEX-55, like [FR-NOTE-43](notifications.md#6-functional-requirements)). Presentation only; 0 B. Walkthrough [play-shell §13](play-shell.md#13-test-plan) F5, F11.

**Sprint 6 at a glance** (track WF)

| FR | What | Slice | Named test(s) (§13) |
|---|---|---|---|
| 53 | Tray: bottom bar pinned, always visible at any size ≥ min (amends 01, 48) | WF5 | `FR-DICEX-53 tray Roll visible at min` |
| 54 | Tray dice area shrinks first: stills 40 → 28 px, earlier "×N", own scroll | WF5 | `FR-DICEX-54 tray dice area fits` |
| 55 | The DM popup stack clears hard keep-outs (the tool bar); reports its rect for the Fit under OQ-MAP-57 D / C | WF3 (assigned lines) | `FR-DICEX-55 popup clears the tool bar` |

## 2. Scope

- Tray window, its states and routing from every existing roll control without changing server commands (FR-DICEX-01–10).
- Throws from `roll` entries: settle to result, other viewers, hidden rolls, latency, limits (FR-DICEX-11–20).
- Per-device render setting, reduced motion, lazy 3D chunk, perf fallback (FR-DICEX-21–23; the sprint-3 "3D / flat / off" setting is replaced by sprint 4's display modes, FR-DICEX-36).
- Dice look: record, intent, UI (FR-DICEX-24–27).
- Notation parser + `DiceText` component; sheet free text as the first surface (FR-DICEX-28–31).
- Extension point for [effect-modifiers](effect-modifiers.md) tier 2 "box per bonus die" (FR-DICEX-08).
- Decided at sprint-3 gate 1 ([#207](../decisions-log.md)): `three` + `cannon-es` (OQ-DICEX-01), throw zone over the free area (OQ-DICEX-02), server-stored looks (OQ-DICEX-06), Alt+click (OQ-DICEX-08), styles list (FR-DICEX-24).
- **Sprint 4:** display modes with full-screen as default (FR-DICEX-32–35), device settings v2 (FR-DICEX-36), 3D ready for the first throw (FR-DICEX-37), DM-only throws (FR-DICEX-38), roll popup + picture-in-picture (FR-DICEX-39–41), die-shape chips (FR-DICEX-42), others / slow / reduced motion (FR-DICEX-43–45). Game-log dice: [FR-DICE-35–37](dice-roll-log.md#6-functional-requirements). Library compared again (§14, #244). No server, schema, event or protocol change.
- **Sprint 5:** popup line layout (FR-DICEX-46, -47), tray preview (FR-DICEX-48), landing hold (FR-DICEX-49), label reset (FR-DICEX-50), Alt hint (FR-DICEX-51), compressed static serving (FR-DICEX-52). No schema, event, protocol, record or WS change; one server-core edit (static serving) and one tooling edit (build).
- **Sprint 8:** macros (FR-DICEX-64–72, sheet tab [FR-CHARX-87–90](character-sheet-full.md#6-functional-requirements)); roll requests (FR-DICEX-73–93). Out: whispers (stub), macros that feed attack / apply or read sheet values, a macro bar, request timers, companion targets.

## 3. Goals

- A roll feels like a roll: dice tumble for the roller and the table, and the faces always match the logged result.
- Text with dice in it is one click from a roll ("very important", #188).
- No new way to cheat or leak: results stay server-side; a client never shows dice it couldn't already read in its log.
- Map-first stays (#162): nothing new is open by default. ~~Dice land only where no window is.~~ *(Sprint 4, [10, 12]: dice fly over everything for ≤ 4 s, never take a click, then leave; the popup is the lasting trace.)*
- *(Sprint 4)* Everyone sees the same dice for a roll, in the same count, on the same faces, wherever they look (screen, zone, popup, log).
- *(Sprint 5)* No number shows before the dice that make it land, on any dice surface of this client. A popup's dice read at a glance, whatever the count. You see what you will roll before you roll it.

## 4. Non-goals

- Client-rolled or client-influenced results ([ADR-0001](../architecture/adr/0001-tech-stack.md): dice are server-authoritative).
- Whispers (stay in the [stub](post-mvp/dice-extras.md)). Macros and roll requests: in since sprint 8 (#334).
- Dice sound (OQ-DICEX-11; [ADR-0007](../architecture/adr/0007-product-scope.md) allows only short UI sounds).
- Dice in map world space / on the Konva canvas (OQ-DICEX-02 C; would follow V's canvas work).
- Tapping 3D faces to enter physical results; per-category looks (OQ-DICEX-05 C).
- "+5 to hit" turning into a d20 roll (only dice terms are notation, FR-DICEX-28).
- *(Sprint 4)* Private player rolls / whispers to the DM (OQ-DICEX-21, decided #245 G23: player rolls stay public, #73). A popup or throw for entries a client never received. Dice for `cbt.attack` outcome lines beyond what their line already shows (OQ-DICEX-31). A new log kind, event, record or field.
- *(Sprint 5)* A server-side wait or a "landed" signal: the server never delays a result; the hold is per client, presentation only (values are in the frame as before). Holding numbers other features show (Initiative order, HP, combat cards; OQ-DICEX-39). Restyling the tray or popup beyond the layout here (UI / art sprint, BL-29). Compressing assets-pipeline images (already compressed formats).

## 5. User stories

**DM**
- As the DM, I want my hidden rolls to animate only on my screen, so that a secret roll stays secret.
- As the DM, I want to click "2d6 + 3" in an NPC's feature text and roll it hidden, so that I don't retype stat blocks.
- As the DM, I want to see each player's dice in their colours, so that I know at a glance who rolled.

**Player**
- As a player, I want to click "1d12 + 5" in my sheet, add a d6 for a rider and roll, so that odd damage is quick.
- As a player, I want to see the 3D dice of my and my friends' rolls land on the real result, so that remote play feels like a table.
- As a player, I want to turn 3D off on a weak laptop, so that the map stays smooth.
- *(Sprint 4)* As a player, I want a friend's roll to tumble across my whole screen and then sit in a small popup with their name and total, so that I notice it and can read it a moment later.

**DM (sprint 4)**
- As the DM, I want my secret rolls to stay small in my own popup, so that big dice always mean "the table saw this".

**Sprint 5**
- As a player, I want my friend's 10d6 to sit in the popup as dice I can read, not as dots, so that I can check the fireball.
- As a player, I want to see the d6s and d8 I picked in the tray as real dice, and the total only once they land, so that a roll still feels like a roll.
- As the DM on a phone-tethered tunnel, I want the dice to load fast after a reload, so that the first roll isn't flat.
- *(Sprint 8)* As a player, I want a "Sneak Attack 3d6" button on Mira that I can still roll with real dice. As the DM, I want "Everyone: Perception" against a hidden DC, with each total coming back only to me.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| **Tray and routing** | | |
| FR-DICEX-01 | Window type `dicex.tray` "Dice tray", both clients, **default closed**, 360×300, min 300×240, launcher "Dice" after "Log". Staging a roll (FR-DICEX-02) opens it via `openWindow` ([FR-SHELL-08](play-shell.md#6-functional-requirements): open / restore + front). Placement per [protocol §18](../protocol/README.md#18-scenes-client-registries) (left edge, near `dice.log`). Passes the registry-driven layout tests: fits at 1280×720, no overlap with other products' windows at 1600×900 (seams S8). | Map-first #162 |
| FR-DICEX-02 | **Tray request**, one staged at a time (a new one replaces it): `free {expression, mode, category, label?, actor?}` (notation, palette, roll bar) or `control {options, mode}` where `options` is the caller's `RollControlOptions` **verbatim** ([FR-DICE-24](dice-roll-log.md#6-functional-requirements)). Client memory only. | |
| FR-DICEX-03 | Tray states: `idle` → `compose` (free) / `adjust` (control) → `manual` (physical mode) → `rolling` → `result` (table §7). Closing the window drops a staged request; minimising keeps it ([FR-SHELL-36](play-shell.md#6-functional-requirements)). | |
| FR-DICEX-04 | **Compose** (free): one chip per die grouped by term; palette d4 d6 d8 d10 d12 d20 d100 adds one die (joins a same-faces term without keep); clicking a die chip removes one; constant Input; expression Input synced both ways. Mode toggle + Shift / Ctrl ([FR-DICE-05](dice-roll-log.md#6-functional-requirements)); Options: category, label, actor ([FR-DICE-27](dice-roll-log.md#6-functional-requirements), [-34](dice-roll-log.md#6-functional-requirements)); DM eye preset from the category ([FR-DICE-30](dice-roll-log.md#6-functional-requirements)). Validation = FR-DICE-01 (`parseExpression`): invalid → inline message, nothing sent, Roll stays enabled ([FR-DICE-32](dice-roll-log.md#6-functional-requirements) spirit). Roll sends `dice.roll` ([FR-DICE-09](dice-roll-log.md#6-functional-requirements)) unchanged. *(Sprint 5: the chips are drawn as 3D dice, FR-DICEX-48; a fresh compose after a result starts empty, FR-DICEX-50.)* | |
| FR-DICEX-05 | **Adjust** (control): dice read-only from `options.expressions` (crit per [FR-DICE-31](dice-roll-log.md#6-functional-requirements)); mode toggle and DM public adjustable; Roll calls the control's `onRoll(RollRequest)` exactly as an immediate roll would, so **the caller sends its own intent** (`dice.roll`, `char.roll`, `cbt.attack`, `cbt.rollDamage`, `cbt.rollInitiative`, …). No server command, intent or schema changes. *(Sprint 5: read-only dice drawn as 3D dice, FR-DICEX-48; groups labelled per part, [FR-DICE-41](dice-roll-log.md#6-functional-requirements).)* | |
| FR-DICEX-06 | **Roll buttons** (`RollButton` on a `useRollControl`, every caller; surfaces listed in §7 "Roll surfaces"): click / Shift / Ctrl+click roll at once as today; **Alt+click** (Option on macOS) stages the control in the tray (`adjust`). Tooltip adds "Alt: adjust in tray". The roll bar ([FR-DICE-30](dice-roll-log.md#6-functional-requirements)) gains a tray Button that stages its current expression (`free`); Enter still rolls at once. Surfaces that aren't a `RollButton` (Roll monsters, the concentration notification's "Roll save" action) roll at once and are not stageable; their entries still throw. A new roll surface is stageable only through `useRollControl`. *(Sprint 5, BL-15: the hint shows on every stageable surface, drawn by `RollButton` itself; the roll bar's Roll stages on Alt+click too: FR-DICEX-51.)* | OQ-DICEX-08 |
| FR-DICEX-07 | **Physical dice** ([FR-DICE-07](dice-roll-log.md#6-functional-requirements)) stay. Roll in the tray while the mode is on → `manual` step in the tray with the same `ManualForm` as the popover (FR-DICE-06, -31, -32, "Roll for me"); buttons rolled at once keep the popover. One component, one `RollControl`, two hosts. | OQ-DICEX-07 |
| FR-DICEX-08 | **Extension point** (MOD tier 2, [FR-MOD-27](effect-modifiers.md#6-functional-requirements); seams S4): (a) `control.options` reaches the tray verbatim, so options a later spec adds to `RollControlOptions` work there; MOD's `subject` (incl. `subject.card`, the preview input) lives **only** in options (R14); (b) new append-only registry `src/client/common/features/dice-extras/tray-extras.ts`: `{key, order, useDice(request, mode) → {label, faces, count, sign}[]}`, rendered as labelled read-only chips beside the base dice in `compose` / `adjust` (DICEX ships it empty); (c) the `manual` step **is** `ManualForm`, so boxes MOD adds per bonus die show in popover and tray alike; (d) the fields MOD adds to `RollRequest`, `previewMode` and `manualParts` only (R14), pass through `onRoll` untouched; (e) **adv / dis preview**: when the tray's mode (toggle, Shift / Ctrl) or the request's `previewMode` (MOD's pre-roll `modes()` result) is adv / dis, the `1d20` term shows as two d20 chips tagged adv / dis. MOD owns how its preview mode combines with the toggle; DICEX only renders the result; (f) trigger parts MOD offers (Divine Fury) arrive on the damage item of the `roll` entry as `offered` items with per-die `dice`, outside `total` (R1), so FR-DICEX-13 throws them as labelled dice. No "rolled for you" special case. *(Sprint 4, confirms R's OQ-MOD-44 / [FR-CBT-83](combat-tracker.md#6-functional-requirements), review B22)* A weapon with several damage parts (Flame Tongue: 2d6 slashing + 2d6 fire) reaches the tray as one `options.expressions` entry per part with R's labels: `adjust` shows one labelled read-only group per part; physical mode shows one `ManualForm` slot per part, each with its own "Extra critical dice" sub-row ([FR-DICE-31](dice-roll-log.md#6-functional-requirements)); throws and popups draw every part's dice, labelled. No DICEX API change. | Seam for R |
| FR-DICEX-09 | **Pending**: after Roll (tray or button) the client shows a pending throw (3D: dice shaking in the throw zone; flat or reduced motion: a static "Rolling…" label, no motion) until its first new own `roll` entry arrives (`rollerRole` / `rollerPlayerId` = this client) or 3 s pass; then FR-DICEX-11 takes over. Rejects show where they do today (caller inline, tray inline); the shake just stops. Nothing is resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)). *(Sprint 4)* The pending shows as the own popup's "Rolling…" row (FR-DICEX-39); with popups off, in the zone (`zone` display) or not at all. | Latency |
| FR-DICEX-10 | **Result**: the tray shows the last own roll (flat dice, total, the log line text) until the next stage; `free` requests offer "Roll again" (same request). *(Sprint 4)* Dice as die shapes (FR-DICEX-42). *(Sprint 5)* Die values and total wait for the landing (FR-DICEX-49); "Roll again" keeps the label, anything else starts fresh (FR-DICEX-50). | |
| **Throws (3D dice)** | | |
| FR-DICEX-11 | **Source**: live event frames only (`useEventFrame`, never snapshot or resync). Every `game-log-entry` upsert of kind `roll` with `n` above this client's highest seen `n` (set from each snapshot, raised per frame) is thrown; **all such entries in one frame coalesce into one throw** (dice in `n` order, cap per FR-DICEX-14), e.g. `cbt.start` HP and initiative or Roll monsters. Undo upserts (old `n`), snapshots and reconnects never throw. No new event, signal or record. | |
| FR-DICEX-12 | **Visibility = the entry's** ([FR-DICE-15](dice-roll-log.md#6-functional-requirements)): a client throws only entries it received. Hidden DM rolls never reach players, so never throw for them; the DM's own hidden throws carry the eye-off marker. A throw reads `payload` only, never `dmPayload`. *(Sprint 4)* DM-only entries play in the DM's popup only, never big (FR-DICEX-38). | |
| FR-DICEX-13 | `throwDice(entries)` (pure, `@shared/dice-extras/throw.ts`), per entry in `n` order, per payload item in order: every die of `dice` with its server value (dropped dice thrown, dimmed at rest); MOD parts ([FR-MOD-19](effect-modifiers.md#6-functional-requirements)) and offered trigger parts (`offered`, R1) → every die of the part's per-die `dice` (≤ 20, added by R) with its value, labelled (label, or "DM" when null), signed as the part; offered dice also tagged "on a hit" and left out of the total badge (as the line, R1). A part without `dice`: `1dM` → one die of \|value\|, else a flat chip with the sum; manual items → flat dice of the typed values (value null → one chip with the dice total), "physical", no tumble. Kinds other than `roll` never throw (they carry no fresh dice). | |
| FR-DICEX-14 | 3D meshes: d4, d6, d8, d10, d12, d20; d100 = two d10 (tens 00–90, units 0–9; 100 = "00" + "0"). Other faces (d2, d3, d7, d1000…) → flat chips. **≤ 20 3D dice per throw** (first 20 in order); the rest → a flat chip row "+N more". | OQ-DICEX-12 |
| FR-DICEX-15 | **Settle to result**: the client simulates the throw headless (physics only, no renderer; fixed 60 Hz step, ≤ 2.5 s = 150 steps; a die still moving at 2.5 s snaps to its nearest resting pose), reads each die's up-face (d4: the value at the top vertex; others: the face whose normal is nearest +Y; d100: tens die + units die), relabels the faces so the up-face carries the server value, then plays the recorded motion. At rest, `upFace(die)` read from the final orientation equals the server value for every 3D die. Throw seed = hash(first entry id of the throw), client-side and cosmetic (never `ctx.dice`), so every client shows the same tumble. *(Sprint 4)* Arenas other than the zone (screen, PiP): FR-DICEX-34. **Seed = hash(first public entry id of the throw)**, or of the first entry when none is public (review B25), so a DM frame that mixes a DM-only entry with public ones tumbles the public dice exactly as the players see them. | |
| FR-DICEX-16 | **The log never waits**: the line renders on arrival ([FR-DICE-21](dice-roll-log.md#6-functional-requirements)); the throw starts in the same frame; dice rest ≤ 2.5 s later. *(Amended sprint 5, #251 / sim-8 glitch 8: the line still renders on arrival, in `n` order, with actor and label; only its die values and total wait for this client's landing, FR-DICEX-49, [FR-DICE-40](dice-roll-log.md#6-functional-requirements).)* | OQ-DICEX-04 (amended) |
| FR-DICEX-17 | **Throw zone**: a transient layer in the shell's overlay layer ([FR-SHELL-01](play-shell.md#6-functional-requirements)), `pointer-events: none`, inside the free area ([FR-SHELL-34](play-shell.md#6-functional-requirements)): bottom centre, ≤ 720×420. Shows roller name + label (coalesced throw: first roller + "N rolls"), then the dice; fades 1.5 s after rest. Never over an open window; nothing in it is interactive. A DOM / WebGL overlay, **not** a Konva layer: no canvas change (seams S3). *(Sprint 4)* Now the `zone` display option, "Tray throw" (FR-DICEX-32). Its caption moves to the popup (FR-DICEX-40); it shows in the zone only while popups are off (sim-7: caption over a token label). **Mount** (review B27): the sprint-3 zone was built as the tray's companion layer with its own canvas, never a `PlayFrame.tsx` line (#214). D6 retires that canvas: the zone becomes an arena of the one dice-layer canvas (FR-DICEX-33, -41), still clipped to the free-area rect, so the page keeps one WebGL context. No shared-file edit. | OQ-DICEX-02; amended sprint 4 |
| FR-DICEX-18 | One throw at a time: a new throw while one runs → the running one snaps to rest and fades, the new one starts. *(Sprint 4)* The interrupted throw hands its dice to its popup at once (FR-DICEX-35). | |
| FR-DICEX-19 | Others' rolls throw too, per device toggle "Show others' rolls" (default on); off → own throws only. *(Sprint 4)* Off → others' rolls play in their popup only (FR-DICEX-43). | OQ-DICEX-03 |
| FR-DICEX-20 | Each die uses its entry's **roller's look** (DM look for DM rolls, the player's for player rolls; FR-DICEX-24); flat dice use its colours. | |
| **Device settings** | | |
| ~~FR-DICEX-21~~ | **Retired (sprint 4): superseded by FR-DICEX-36** (v2 key, display modes, migration). Was: per browser `pp.dicex.v1.<campaignId>.<dm \| playerId>` = `{render: "3d" \| "flat" \| "off", others: boolean}`; default `3d`; reduced motion / no WebGL → `flat`; `flat` = faces fade in ≤ 300 ms; `off` = no throw zone; in the tray gear popover. | OQ-DICEX-10 |
| FR-DICEX-22 | **Lazy chunk**: 3D code (library, meshes, textures, all bundled; no CDN) loads by dynamic import on the first 3D throw or look preview; `flat` / `off` never load it. Each client's initial JS grows ≤ 15 KB gz (parser, tray, flat dice); 3D chunk ≤ 170 KB gz with the pick (measured 159 KB, §14). Load failure → `flat` for the session + one console warning. *(Sprint 4)* Loads at idle, not on the first throw (FR-DICEX-37). Caps unchanged; 3D chunk measured **161.3 KB gz** on `main` 2026-10-17 (§14). *(Sprint 5)* Served precompressed and cached (FR-DICEX-52): 632,343 B raw → **132,499 B** brotli on the wire (§12). | |
| FR-DICEX-23 | **Perf**: render loop only while a throw is visible (idle = no frames). A 3D throw with median frame time > 33 ms → this device switches to `flat` + Toast "Dice set to flat: 3D was slow on this device" (switch back in settings). *(Sprint 4)* Also for screen-layer and PiP throws (FR-DICEX-44). | |
| **Dice look** | | |
| FR-DICEX-24 | Look = `{style, body, pips, material}`: named **styles** Ivory, Obsidian, Crimson, Sapphire, Emerald, Amethyst, Gold, Bone, each a starting body / pips / material ("preset" stays MOD's word, seams S9); `body`, `pips` `#rrggbb`; material `plastic` \| `metal` \| `glass` \| `stone`. One per owner (DM, each player) per campaign. No row → default: DM Obsidian; players in order of sorted player `id` (every client has it; snapshot order and creation time aren't sent) Crimson, Sapphire, Emerald, Amethyst, Gold, Bone, Ivory, … (derived, not stored). | OQ-DICEX-05 |
| FR-DICEX-25 | Record `dice-look` (§8): visibility **full** to everyone in the campaign, so every client draws the roller's look. Always in the snapshot, not a lazy type (§12, seams S1). | OQ-DICEX-06 |
| FR-DICEX-26 | `dicex.setLook {style, body, pips, material}` (DM, player): owner = sender (no owner field: nobody sets another's look). zod; same look → no-op, no event; else upsert + event-log row + `DiceLookSet` in one transaction ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). IDs and time from `ctx`. | |
| FR-DICEX-27 | "Dice look" (tray gear → popover): style swatches, body / pip colour (12-swatch palette + hex Input), material ToggleGroup, live preview die (3D if render = 3d, else flat), Save, Reset (= the style's defaults). Pips vs body contrast < 3:1 → inline hint, still allowed. Disabled unless `live`. | |
| **Clickable notation** | | |
| FR-DICEX-28 | `findNotation(text)` (pure, `@shared/dice-extras/notation.ts`) → `{start, end, expression}[]`. A match = a dice term (`NdM`, `dM` = 1dM, `NdMkhK`, `NdMklK`; case-insensitive) then zero or more `op term` (op `+`, `-`, `−` U+2212, `–` U+2013; term = dice term or integer). Spaces / tabs allowed around `op`; none inside a term; no line break. Not preceded by a letter, digit or `_`; not followed by a letter, digit, `_`, or `/`, `*`, `×`, `x` + digit. Extends greedily while the next `op term` is valid; a dangling `op` is left out. `expression` = `toNotation(parseExpression(match))`; a match failing FR-DICE-01 limits is plain text. | Edge cases §13 |
| FR-DICEX-29 | `DiceText {text, context}` at `src/client/common/features/dice-extras/DiceText.tsx` (`@ui`, ships in D1; the only notation parser, seams S7): text rendered as text (never HTML), each match an inline link Button (`dicex-notation`). Click stages `free`: expression; label = `context.label` (≤ 60); category = `context.category` else `other`; actor = `context.creature` if the viewer may roll as it ([FR-DICE-10](dice-roll-log.md#6-functional-requirements)), else default. Shift / Ctrl+click preselect adv / dis when the expression has a `1d20`. Staging works offline; Roll needs `live`. | |
| FR-DICEX-30 | Surfaces built by this spec: character sheet ([CHARX](character-sheet-full.md)) feature text, spell notes, item notes, notes, in view mode (edit mode = plain inputs); context = the creature + the row's name; built as D4 under the sheet lock (V5 → R3 → R6 → C2 → D4 → P4 / C4, X2). Other specs' free text imports `DiceText` once D1 is on `main` (plain text until then): party-board handout bodies, compendium entry text (its markdown-lite component wraps text runs). No second parser (OQ-DICEX-14, -15, settled by seams S7). | OQ-DICEX-09 |
| FR-DICEX-31 | Notation never feeds attack / apply: a staged notation always rolls `dice.roll` with the tray's category, in combat too. | #188 |
| **Sprint 4: animated dice everywhere** (#243 [10, 11, 12]) | | |
| FR-DICEX-32 | **Display modes** (per device, FR-DICEX-36): **`screen` (default)**: full-screen 3D dice over everything (FR-DICEX-33); `zone`: the sprint-3 throw zone (FR-DICEX-17), labelled "Tray throw"; `flat`: no 3D; dice are die-shape chips (FR-DICEX-42) in the popup, and in the zone while popups are off; `off`: no animation, popup chips only. Every mode shows the same dice on the same faces; only the presentation differs. Reduced motion or no WebGL → effective `flat` (the stored setting is kept). | [10] |
| FR-DICEX-33 | **Screen layer**: one `<canvas>` per page, `position: fixed; inset: 0`, portalled to `document.body`, `pointer-events: none`, `aria-hidden`, the **topmost** layer (above windows, chrome, toasts, popups and dialogs; never takes input or focus). Arena = the viewport: floor + four walls on the viewport edges (world size from the viewport's CSS size, rounded to 50 px); dice enter from the bottom edge, bounce off the edges and rest anywhere on screen. Die size 7 % of the viewport's short side, clamped 40–96 px. The layer draws **dice only**, no caption (sim-7: caption over a token label); name, label and total live in the popup (FR-DICEX-40). At rest: dropped dice dimmed, MOD / offered dice with their small label beside the die. Idle = cleared canvas, no loop. | [10, 12]; sim-7 |
| FR-DICEX-34 | **Lands on the server's faces** (extends FR-DICEX-15 to every arena; [ADR-0044](../architecture/adr/0044-3d-dice.md) "Truth"): the entry carries every die's server value before the first frame; the client simulates the whole throw headless in the arena first (fixed 60 Hz, ≤ 150 steps, ≤ 50 ms for 20 dice), reads each up-face, relabels the faces so the up-face carries the server value, then plays the recorded motion. **Pre-computed, not settle-then-reorient**: no visible snap. No client changes, re-rolls or rounds a value; `data-settled` (read from the rendered mesh at rest) equals `data-value`. Seed = hash(first public entry id, FR-DICEX-15): equal viewports show the same tumble; other viewport shapes take a different path to the same faces. A resize mid-throw scales the running arena (no re-simulation); the next throw uses the new size. | Brief 3 |
| FR-DICEX-35 | **Timing** (OQ-DICEX-18): settle ≤ 2.5 s (FR-DICEX-15 budget), rest 1 s, then the dice shrink and fly into their popup's PiP (0.4 s, FR-DICEX-41) and the layer clears: ≤ 3.9 s on screen. A new throw snaps the running one to rest and hands it off at once (FR-DICEX-18). Popups off → rest 1.5 s and fade (FR-DICEX-17 rule). Durations are constants in one module. | OQ-DICEX-18 |
| FR-DICEX-36 | **Device settings v2** (retires FR-DICEX-21; OQ-DICEX-22): browser key `pp.dicex.v2.<campaignId>.<dm \| playerId>` = `{display: "screen" \| "zone" \| "flat" \| "off", others: boolean, popup: boolean}`, zod-parsed; defaults `screen`, `true`, `true`; invalid / unavailable → defaults in memory. A v1 entry migrates once on read: `3d` → `screen`, `flat` / `off` kept, `others` kept. Edited in the tray gear popover and the popup's gear (FR-DICEX-39). Never sent. | OQ-DICEX-22 |
| FR-DICEX-37 | **3D ready for the first throw** (amends FR-DICEX-22; sim-7: the first throw of a session was flat): with an effective display of `screen` or `zone`, the 3D chunk loads at idle after the first snapshot (`requestIdleCallback`, else after 2 s), not on the first throw. A throw arriving while it loads waits ≤ 1.5 s (its popup shows "Rolling…"), then plays in 3D, or flat if the chunk still isn't there. `flat` / `off` never load it. | sim-7 |
| FR-DICEX-38 | **DM-only throws** (OQ-DICEX-20; amends FR-DICEX-12): an entry with `public: false` (DM hidden roll or category off, DM attack roll [FR-CBT-52](combat-tracker.md#6-functional-requirements), monster initiative [FR-CBT-69](combat-tracker.md#6-functional-requirements), HP roll, NPC-sheet roll, hidden PC's death save) reaches only the DM ([FR-DICE-15](dice-roll-log.md#6-functional-requirements)) and **never animates on the screen layer or in the zone**: it plays in the DM's popup PiP (FR-DICEX-41 b) with the eye-off marker. A frame mixing public and DM-only entries → one popup; public dice big, DM-only dice in the PiP only. **Mixed frame on the DM** (review B25): the popup lists every entry's row; its PiP shows **all** the frame's dice in entry order: the public ones handed off from the big throw (still) and the DM-only ones playing in miniature beside them, then a still of the whole set; `data-dice` = every die of the frame (3D + chips), so the DM's count ≥ each player's (players' popup has the public dice only). Seed per FR-DICEX-15 (first public entry). | OQ-DICEX-20 |
| FR-DICEX-39 | **Roll popup** ([11]; OQ-DICEX-23, -24): every live `roll` entry a client receives (FR-DICEX-11 source and high-water: never snapshots, resyncs, undo upserts or reconnects) opens a popup on that client, **roller included**, from any source: tray, roll bar, notation, sheet checks / saves / skills / attacks (`char.roll`), `cbt.attack` / `cbt.rollDamage` / `cbt.rollInitiative` roll entries, `cbtx` saves, Start / add initiative. Off while `popup` is off. Entries of one frame → one popup, one row each (≤ 5 rows, then "+N more"). Placed in the client's toast region ([FR-SHELL-49](play-shell.md#6-functional-requirements): **the DM's top-centre region**, **the players' bottom-right corner**; OQ-SHELL-32 C, #256) as its own stack beyond the notifications and alert stacks, so action toasts never move; newest nearest the region's anchor; **≤ 3 roll popups** (the oldest closes; *sprint 5:* only as many as fit in the client's toast region, FR-DICEX-47). Shows from arrival ("Rolling…" while the dice move), stays **6 s after rest**; hover / focus pauses; ✕ closes; a click on the body calls `focusLogEntry` ([FR-DICE-37](dice-roll-log.md#6-functional-requirements)); gear → display settings. Client memory only. The popup UI is a lazy chunk loaded at idle after the first snapshot in every display mode (§12, ≤ 8 KB gz); a popup due before it arrives waits ≤ 1.5 s. *(Ruling A11)* Window placement keeps out of the **toast keep-out box** M4 exports from `toast-region.ts` (3 toasts + this popup stack, sized from §7's popup constants); D7 owns those constants afterwards and grows them there, never touching placement. *(Sprint 5, seams S2: W1 owns `toast-region.ts` incl. the popup constants, set from FR-DICEX-47.)* *(sprint 4 build, rulings)* On the DM, the roll-popup stack also keeps clear of any open non-modal dialog (the combat popup) and follows it when it moves. | [11] |
| FR-DICEX-40 | **Popup content** (OQ-DICEX-25; `payload` only, never `dmPayload`): per row: actor name bold (the entry's `actorName`: "Mira", "Goblin", "DM", the player's name), label (else the expression), **total** bold with "(adv)" / "(dis)" and "natural 20!" / "natural 1" exactly as the line ([FR-DICE-20](dice-roll-log.md#6-functional-requirements), -29), "physical" badge, offered dice tagged "on a hit" and outside the total (FR-DICEX-13); the DM's DM-only rows carry the eye-off marker. A coalesced frame lists **one named row per entry** (sim-7: "Ogre · 3 rolls" named three monsters "Ogre"). Labels render as text. | OQ-DICEX-25; sim-7 |
| FR-DICEX-41 | **Picture-in-picture** (OQ-DICEX-26): the popup's dice area shows **the same dice** as the throw: the same `throwDice` list and count (≤ 20 3D dice + chips + "+N more"), the same faces, the roller's look. (a) The throw played big on this device (screen / zone) → at rest + 1 s its dice fly into the PiP (FR-DICEX-35); the PiP then holds a still of those rested dice (copied pixels, so it moves with the popup). (b) It didn't play big (DM-only FR-DICEX-38, `others` off FR-DICEX-43) and 3D is available → the same canvas plays the throw in miniature at the PiP's rect (same simulation and seed), then the still. (c) `flat`, `off`, reduced motion or no WebGL → die-shape chips (FR-DICEX-42), faces fading in ≤ 300 ms. **One WebGL context per page** serves screen, zone and PiP. **Concurrency** (B25): one scene, several arenas: a big throw and PiP miniatures play in the same render loop at once (each arena its own viewport + scissor); the loop runs while any arena moves. **Clipping** (B26): a PiP arena is scissored per frame to its popup's **visible** rect (read each frame, so a stack shift moves a running miniature with its popup); while a modal dialog covers the popup, PiP dice under the dialog's rect aren't drawn (the big throw still flies over everything, FR-DICEX-33). **Still capture** (B26): in the same task as the frame that rendered the rested dice, `drawImage(canvas, pip rect)` into the popup's own 2D canvas; no `preserveDrawingBuffer`. **Cut order** (#245 G7): if the sprint runs late, (b) is the last cut in the sprint; the popup then shows chips instead of a miniature. *(Amended sprint 5, #250 [2], BL-22: the PiP no longer keeps the dice's scene positions or shrinks them to fit; every mode lays the same dice out in a line at a fixed size: FR-DICEX-46. Same dice, count, faces, look and one-context rules.)* | OQ-DICEX-26 |
| FR-DICEX-42 | **Die-shape chips** ([10]): `DieShape {faces, value, kept, look, size}` (`@ui`, inline SVG): d4 triangle, d6 square, d8 diamond, d10 kite, d12 pentagon, **d20 flat icosahedron** (hexagon outline + centre triangle) with the value centred; d100 = a tens kite ("40", "00") + a units kite; other faces (d2, d3, d1000) and dice-less sums → a round chip. Fill = look `body`; number and outline = look `pips`. Dropped (adv / dis only): 40 % opacity + struck; offered trigger die: dashed outline, never struck (the log's `die.offered`, [FR-DICE-35](dice-roll-log.md#6-functional-requirements), so log, popup, tray and zone match); manual: "physical" tag. Sizes `sm` (18 px; game log) and `md` (36 px; popup, tray, flat zone). Replaces the rounded squares of `FlatDie` everywhere: tray result, flat throws, zone chips, popup, log ([FR-DICE-35](dice-roll-log.md#6-functional-requirements)). | [10] |
| FR-DICEX-43 | **Others' rolls** (amends FR-DICEX-19): `others` off → other people's rolls skip the screen layer and zone and play in their popup's PiP only (FR-DICEX-41 b). Own rolls unaffected. | |
| FR-DICEX-44 | **Slow devices and links** (OQ-DICEX-27): the screen layer renders at pixel ratio ≤ 1.5, without shadows above 2.5 MP; auto-flat (FR-DICEX-23) measures screen, zone and PiP throws. A late frame (slow tunnel) throws on arrival with the server's faces; nothing waits for other clients. The popup never needs 3D. | OQ-DICEX-27 |
| FR-DICEX-45 | ~~**Reduced motion** (`prefers-reduced-motion: reduce`): effective `flat`: no screen layer, no flight, popup chips appear without motion, "Rolling…" static, no 3D chunk load.~~ **Superseded by #247 (DM): the OS / browser reduced-motion preference is ignored, as Owlbear does.** Display modes behave the same with it on or off; no hint, nothing greyed out. Flat and Off stay as the user's own per-device choices; auto-flat for no WebGL / a slow device / a failed chunk (FR-DICEX-32, -44) is unchanged. | #247 |
| **Sprint 5: dice polish** (#250 [2, 3], #251) | | |
| FR-DICEX-46 | **Popup dice in a line** (amends FR-DICEX-41 a–c; #250 [2], BL-22): the popup lays the frame's `throwDice` list out in fixed **cells**, in `throwDice` order (entry `n`, payload item, die); rules in §6.1 table A. The die size never depends on the count or the viewport. Each die shows its server value upright towards the viewer, in the roller's look. Hand-off, miniature and chips modes use the same cells. `data-dice` counts every die of the frame, `data-shown` the dice drawn in cells. | #250 [2]; BL-22 |
| FR-DICEX-47 | **Popup size** (amends §7 constants; settled by seams S2, OQ-DICEX-42): a popup is **320 px** wide (was 280) and up to **190 px** tall (pixel budget: §6.1 table B). W1 sets `ROLL_POPUP_W` 320 / `ROLL_POPUP_H` 190 in `toast-region.ts`; the toast regions and their keep-out boxes are W's ([FR-SHELL-49](play-shell.md#6-functional-requirements): the DM's top-centre region, the players' bottom-right corner). Each entry row keeps its own total at the row's right (FR-DICEX-40). **Short screens:** the stack holds as many popups as fit in the client's toast region (≤ 3); the oldest drops first; no popup leaves the viewport or crosses the top bar. D11 edits only the popup's internals. | Seam W (S2) |
| FR-DICEX-48 | **Tray preview** (#250 [3]; amends FR-DICEX-04, -05): in `compose` and `adjust` the tray's dice area shows **the 3D dice that will be rolled** in place of the "d12" text badges; rules in §6.1 table C. Stills are drawn on the page's one WebGL context into the tray's **own 2D canvas**, so they sit in the window's z-order. Fallback chips are never the text badge. | #250 [3] |
| FR-DICEX-49 | **Landing: totals wait for the dice** (sim-8 glitch 8; amends FR-DICEX-10, -16): the client keeps `holding: Map<entryId, deadline>`, filled **only** by the live-throw path (FR-DICEX-11 source: an entry this client throws or pops up). Every entry not in `holding` is shown: snapshot, resync-only, undo upserts and rows below the window floor never need an id added. An entry leaves `holding` when this client's presentation of its dice **lands** (§6.1 table D) or at its deadline (arrival + 6 s, `POPUP_ROLLING_MAX_MS`). A held entry stays held across a resync / reconnect until it lands or reaches its deadline; a reload empties `holding` (everything shown). While held, the dice surfaces hide its die values, total and adv / natural markers (§6.1 table E). Not held: actor, label, category, line order, the "N new" count, the launcher dot, other features' numbers (OQ-DICEX-39 decided #256). Reduced motion changes nothing (#247). `useLanded(entryId)` (`@ui`) = not in `holding`. Client memory only; server and frames unchanged. | sim-8 #8 |
| FR-DICEX-50 | **Label reset** (BL-18): label, actor and category belong to the staged request; which actions start a fresh request is §6.1 table F. The palette path is built on `main` (`e0acd71`, test `FR-DICEX-04 BL-18 …`); this FR makes the rule hold for every path. | BL-18 |
| FR-DICEX-51 | **Alt hint everywhere** (BL-15; amends FR-DICEX-06): every stageable roll surface shows the line "Alt: adjust in tray" exactly once, as a `<span data-testid="dicex-stage-hint">`. `RollButton` draws it in its own tooltip; a caller with its own tooltip text passes it through `RollButton` (`hint`). Rolls routed through hidden anchors (Initiative menus) show it in the trigger's tooltip or the menu (§6.1 table G). Non-stageable surfaces show none. The roll bar's Roll also **stages on Alt+click** (OQ-DICEX-45 decided #256, scope flag beyond BL-15). | BL-15 |
| FR-DICEX-52 | **Built client served compressed and cached** (BL-21; OQ-DICEX-40, -41 decided #256): rules in §6.1 table H; decision record [ADR-0052](../architecture/adr/0052-static-serving.md). All built JS / CSS ≥ 1 KB, not only `dice3d`. | BL-21 |
| **Sprint 6** (track WF; BL-44; sim-9 d01, b01) | | |
| FR-DICEX-53 | **Roll always visible** (BL-44; amends FR-DICEX-01's body and FR-DICEX-48's "40 px, wrapping"): the tray body is a column of **fixed** parts and **one** flexible part: header row (state, gear) and palette row on top, the **dice area** in the middle (flexible), the expression / constant row and the **bottom bar** (mode, DM eye, Roll, Options chevron; `dicex-tray-roll`) pinned at the bottom. Only the dice area shrinks or scrolls; the body itself never scrolls. At every window size ≥ min (300 × 240, incl. FR-SHELL-29 fits and placement's shrunk sizes) and in every state (`compose`, `adjust`, `rolling`, result), `dicex-tray-roll` lies wholly inside the window's rendered rect and is the `elementFromPoint` hit at its centre. **Budget at the min size**: the one budget is §12's table (from d01). Today's fixed parts leave ≈ 2 px for the dice, so the palette stays in **one row** at every width ≥ 300 (seven buttons ≥ 32 px wide, 4 px gaps = 248 px of the 276 inner width) and the header row is ≤ 24 px (with or without PF's tray gear, OQ-DICEX-48), which leaves ≈ 39 px. **Testable outcome** (rulings-b #14): at 300 × 240 the bottom bar is inside the window, the body doesn't scroll, and the dice area holds **≥ one row of 28-px stills**; the build measures the real heights and pins the 40-px row if the gaps allow it. More dice → 28 px or "×N", FR-DICEX-54. Same in both clients. | sim-9 d01; rulings-b #14 |
| FR-DICEX-54 | **The dice area shrinks first** (BL-44; amends §6.1 table C "Size" and "Grouping"): stills are drawn at **40 px** while every die fits in the dice area's height; else at **28 px**; still too many → **one die per term "×N"** even at ≤ 12 dice (the grouping of table C, earlier); still too many (many terms) → the dice area scrolls **on its own** (vertical, `dicex-tray-preview` `data-scroll="true"`), bottom bar unaffected. Redraw on tray size change as built (table C "Redraw when"). `dicex-tray-preview` attrs `data-cell` (40 \| 28) and `data-grouped` (`true` when "×N" was forced by room). Fallback chips follow the same steps (`DieShape` `md` → `sm`). | sim-9 d01 |
| FR-DICEX-55 | **The DM popup stack never covers a tool bar** (seam with [FR-NOTE-43](notifications.md#6-functional-requirements); sim-9 b01 found the toast, the popup shifts left the same way): `dmStackAt(vp, top, size, clear)` takes the active **hard** keep-out regions (play-shell `useKeepOuts("dm")`: the map tool bar) in `clear`, like Initiative and the toast stack; a shift left that would overlap one drops below it instead (as built for Initiative). Under [OQ-MAP-57](scenes-map.md#15-open-questions) C, `RollPopup.tsx` also reports the DM stack's rendered rect through play-shell's `reportShownStack("dicex.popups", rect \| null)` ([FR-SHELL-59](play-shell.md#6-functional-requirements)). Players unchanged (bottom-right). Two lines in dice-extras' files, **assigned to WF3** (no D slice this sprint). | sim-9 b01 |
| **Sprint 6** (track PF; if OQ-SHELL-47 A) | | |
| FR-DICEX-57 | **Dice section in Preferences:** both clients register `dicex.dice` "Dice" (order 30) in their `pref-sections.ts` ([FR-SHELL-72](play-shell.md#6-functional-requirements)); its body is the existing `SettingsPanel` (Display Full screen / Tray throw / Flat / Off; "Show others' rolls"; "Roll popups"; "Dice look…" opening the look editor pane in place), laid out for the 360-px window. Same disabled states and reasons (no WebGL → 3D modes disabled with the reason; Dice look Save disabled unless `live`, FR-DICEX-27). | #285 [2] |
| FR-DICEX-58 | **One store, two places:** the section and the tray / roll-popup gears read and write the same `pp.dicex.v2` entry (FR-DICEX-36) and the same `dice-look` record (FR-DICEX-26), so a change in one shows in the other at once (same tab; other tabs on their next read, as today). The gears stay (OQ-DICEX-48 A). No new key, field, intent or event. | FR-SHELL-76 |
| FR-DICEX-63 | **Notation and breakdown spacing** (sprint 7, track FU; BL-48: "(3d6: 5 + 2 + 1 )"): the tray's staged notation text, the roll popup's breakdown and the flat zone's text (`@shared/dice-extras/notation.ts` and the popup line) follow [FR-DICE-78](dice-roll-log.md#6-functional-requirements)'s spacing rule (one space between tokens, none after "(" or before ")", none doubled or trailing); one shared joiner where both build the same text. The tray's and popup's sizes are unchanged (the DM tray opening at 360 × 248 in sim-10 is the shell's fit / shrink, covered by [FR-SHELL-79](play-shell.md#6-functional-requirements): `dicex.tray`'s useful size is its 360 × 300 default). | BL-48 |
| **Sprint 8: macros** (the stub's tier-A row) | | |
| FR-DICEX-64 | **Record `roll-macro`**: `name` 1–40, `expression` (FR-DICE-01, canonical), `category`, `creatureId` (roll as; null = "Me" / "DM"), `playerId` (who uses it; null = DM only), `order`. ≤ 24 per (`playerId`, `creatureId`), **≤ 200 per campaign** (review A #1), else `conflict`. | OQ-DICEX-49 |
| FR-DICEX-65 | **Whose**: a player's: `playerId` = self, `creatureId` null or an own character (FR-DICE-10). The DM's: `playerId` null, or on a PC its owner by default ("DM only" → null). **One entities definition-changed hook line** (as FR-ENT-34) handles a PC's owner change: its macros move to the new owner, and its open request targets become `missed` with their prompts resolved (no re-target; the DM re-asks). | |
| FR-DICEX-66 | **Intents** `dicex.saveMacro {id?, name, expression, category, creatureId, dmOnly?}`, `dicex.deleteMacro {id}`, `dicex.moveMacro {id, index}`. Player: rows they created (`createdBy` = player; **the DM's rows are read-only for players**) on own creatures (else `forbidden` / `not_found`), no `dmOnly`; DM: any. Same values → no-op; else rows + event log + `MacroSaved` / `MacroDeleted`, one transaction. | |
| FR-DICEX-67 | **Visibility**: DM full; player iff `playerId` = viewer. In the snapshot. | |
| FR-DICEX-68 | **A macro is a roll button** (`RollButton` + `useRollControl`, label = name) sending `dice.roll` unchanged: Shift / Ctrl, physical mode, Alt → tray, throw and popup as any roll. Never attack / apply or riders (as FR-DICEX-31). | OQ-DICEX-51 |
| FR-DICEX-69 | **Tray popover**: a 24-px header Button by the gear (header ≤ 24 px, FR-DICEX-53) → "‹actor›" then "General": name, expression, roll, ✎; "+ New macro". | OQ-DICEX-50 |
| FR-DICEX-70 | **Save as macro** from the tray's Options chevron (`compose` / `result`), editor prefilled. | |
| FR-DICEX-71 | **Editor**: name, expression (live check; invalid → Save disabled), category, "DM only" (DM on a PC), Save, Delete (asks once), ↑ / ↓. | |
| FR-DICEX-72 | **States**: not `live` → disabled; a creature the viewer can't roll as → disabled with the reason; a gone creature's macros under "General", not rollable. | |
| **Sprint 8: roll requests** (the stub's tier-B row) | | |
| FR-DICEX-73 | **Record `roll-request`**, **DM only**: `roll {kind: skill \| save \| check \| custom, key, expression}`, `label`, `dc`, `dcShown`, `mode`, `results: public \| hidden`, `state`, `targets` (1–12 `{characterId, playerId, name, notificationId, state, entryId, total, natural, success, at}`). Snapshot: open + **newest 10 closed** (review A #1). | |
| FR-DICEX-74 | **Send** `dicex.request {roll, characterIds, dc?, dcShown, mode, results, label?}` (DM; ≤ 12 targets, ≤ 5 open): row + one `roll-request` prompt per target (owner = the PC's player) + `RollRequested`, one transaction. | ADR-0016 |
| FR-DICEX-75 | **Targets**: PCs with an owner that are not hidden (#141) ("All PCs" preset lists only those); anything else → `invalid`; two PCs of one player → two prompts. | OQ-DICEX-52 |
| FR-DICEX-76 | **Roll spec**: skill / save / check / custom expression (categories skill-check, saving-throw, ability-check, other); default label "Perception", "DEX save"…; `mode` is a preset the player may change. | OQ-DICEX-53, -59 |
| FR-DICEX-77 | **DC and results**: `dc` 1–40 optional, sent to players only if `dcShown`. `public` → answer public; `hidden` → `public: false` + `audiencePlayerId` = **the target's player** (DM + that player, whoever rolls). Eye preset from the category setting. | OQ-DICEX-54, -55 |
| FR-DICEX-78 | **Answer** `dicex.answerRequest {requestId, characterId, mode, manual?, manualParts?}` (target's player or DM; both `open`, else `conflict`; unseen → `not_found`). The server builds the roll: `sheetRoll` ([FR-CHARX-90](character-sheet-full.md#6-functional-requirements): sheet bonuses, MOD hooks) or, for custom, `dice.evaluate` as the PC (**no sheet bonuses or roll hooks**); one transaction: entry (audience FR-DICEX-77, marked `answer: true`, [FR-DICE-80](dice-roll-log.md#6-functional-requirements)), target `rolled`, prompt resolved, `RollRequestAnswered`. **Not rerollable** (OQ-GEM-20 A): `gem.spend` refuses an `answer` entry (`conflict`). | OQ-DICEX-60 |
| FR-DICEX-79 | **Decline** `dicex.declineRequest`: target `declined`, prompt resolved, `RollRequestDeclined`. | OQ-DICEX-57 |
| FR-DICEX-80 | **Close** `dicex.closeRequest` (DM): open targets `missed`, prompts closed by rule (FR-NOTE-28), `RollRequestClosed`. | |
| FR-DICEX-81 | **Roll for missing** `dicex.rollForMissing` (DM): rolls open targets as the DM, then closes; a hidden request stamps the PC's **current** owner (DM only if none). | |
| FR-DICEX-82 | **Lifecycle**: closed when no target is open, or by Close / Roll for missing; **no timer**; End and turns leave it open; not undoable. | OQ-DICEX-56 |
| FR-DICEX-83 | **Prompt** ([FR-NOTE-59](notifications.md#6-functional-requirements)): card toast "DM: ‹label› · ‹PC name›" (+ "· DC n" iff shown; the PC named so a player with two PCs can tell prompts apart, integrator, TT2); **Roll** = a roll button (shared `characterRolls`) → `dicex.answerRequest`, so physical dice and Alt → tray work; in the tray an answer's **expression is locked** (only mode and physical faces are editable; the server builds the roll anyway); **Decline**. | OQ-DICEX-58 |
| FR-DICEX-84 | **Results**: public answers throw for all; hidden only for the DM and the target's player (PiP, eye-off, FR-DICEX-38); others get nothing. | |
| FR-DICEX-85 | **Pass / fail** = total ≥ dc, on the DM's card only. | OQ-DICEX-54 |
| FR-DICEX-86 | **Window `dicex.requests`** (DM; launcher "Requests"; 360 × 460, **useful 360 × 400** = composer folded + a 6-row card, fits the 412 band at 1280×720 (seams S3); min 300 × 320; after WF1); also from the roll bar (FR-DICE-84). | S3 |
| FR-DICEX-87 | **Composer and card**: roll Select, PC chips + "All PCs", DC + "Show DC", mode, eye, label, Send; per target Waiting / total ✓ ✗ / Declined / No roll, nat 20 / 1, total → `focusLogEntry`; Roll for missing; Close (asks once). | |
| FR-DICEX-88 | **DM cues**: no toast per answer; launcher dot while open; the bell counts prompts. | OQ-NOTE-33 |
| FR-DICEX-89 | **Sound**: a new prompt plays key `request` (FR-SHELL-130), no flash. | |
| FR-DICEX-90 | **Paused**: prompts wait under the card, silent; restored at resume with one `request` sound (seams S10). | |
| FR-DICEX-91 | **Reload**: open prompts re-toast silently (`restoreToast`, FR-NOTE-60); answers never double (`conflict`). | OQ-NOTE-34 |
| FR-DICEX-92 | **Leaks**: no `roll-request`, hidden DC, `success`, other players' prompts or hidden answers, other players' or DM-only `roll-macro` rows in any player frame or ack. | |
| FR-DICEX-93 | **CON-44** measured at the caps (§12): DM worst +208,556 B, players +39,339 B. | #256 |
| **Sprint 9** (track FX, fix pack) | | |
| FR-DICEX-94 | **A popup never sticks** (BL-89, sim-12 glitch 8 / h00: "Goblin 3 Initiative 19" stayed over the map after an Add… mid-combat; amends FR-DICEX-39's hover pause).<br>• A roll popup closes 6 s after rest unless, **at that moment**, it is **held**. Otherwise it closes then.<br>• **Held** = the pointer is over it (`matches(":hover")`) **and** a `pointerenter` / `pointermove` on it happened **after** it showed, or the user moved focus into it after it showed (review-b ruling 12). A popup that opens under a resting pointer (e.g. over the Add dialog's button) is not held.<br>• A held popup re-checks on pointer leave and on blur, and every 1 s while held.<br>• The hover flag clears when the card unmounts or remounts, so a stale flag never holds it.<br>• ✕ always closes.<br>• Root cause **not confirmed**. Hypothesis (code read, `popups.ts` / `RollPopup.tsx`): the card got `mouseenter` / `focus` and lost its card before `mouseleave` / `blur` (remount, or the Add dialog's focus return), so `hovered` stayed true and `settle` never re-armed.<br>• The builder reproduces it first (`data-state`, the hover flag) and records the cause. | sim-12 h00 |
| FR-DICEX-95 | **No error before typing** (BL-90: "Name is required" showed as Save as macro opened; amends FR-DICEX-71).<br>• The editor shows a field's error only after that field was touched (changed or blurred) or Save was pressed.<br>• Save stays disabled while invalid.<br>• A preset (Save as macro: the expression filled in) opens with focus in Name and no error text. | sim-12 glitch 12 |

**Sprint 8: who sees what** — `roll-request`: DM only. Prompt: DM + the target's player (DC iff shown). Public answer: all; hidden answer: DM + the target's player. `roll-macro`: DM + its `playerId` (read-only to the player if the DM made it).

### 6.1 Sprint 5 rule tables

**A. Popup cells** (FR-DICEX-46)

| Rule | Value |
|---|---|
| Cell | 44 px (OQ-DICEX-34 decided #256), gap 4 px, 6 cells per line (inner width 296 px) |
| Lines | ≤ 2 (OQ-DICEX-33 decided #256): > 6 dice wrap; > 12 → 11 dice + a "+N" cell |
| "+N" | Counts every die not shown (3D and chips, FR-DICEX-14's "+N more" included); click → `focusLogEntry(entry of the first hidden die)` |
| Dropped / offered | Dropped dimmed; offered dashed |
| Labels (MOD, offered) | A tag on the cell's bottom edge, cut to the cell width with "…"; the full label and "on a hit" in the die's Tooltip |
| (a) Hand-off | At rest + 1 s each big die flies to its cell, scaling to 44 px (0.4 s, FR-DICEX-35); dice past cell 11 fly into "+N" and fade; then the still (copied pixels, as today) |
| (b) Miniature | The dice tumble into their cells (≤ 1.2 s; pre-computed, relabelled, server faces, FR-DICEX-34; seed FR-DICEX-15), then the still |
| (c) Chips | `DieShape` size `lg` (44 px, new) in the same cells |
| Actor name | Plain in D11; K4 then colours it in the roller's colour (K's OQ-DICE-40 A, #256; seams S15) |

**B. Popup pixel budget** (FR-DICEX-47)

| Part | px |
|---|---|
| Padding top + bottom | 2 × 10 = 20 |
| Entry rows: actor, label, total at the row's right (the first row also holds ✕ and ⚙) | 22 each; ≤ 3 visible = 66, more scroll inside |
| Gap rows → dice | 8 |
| Dice lines | 44 + 4 + 44 = 92 |
| Tag overhang under the last line | 4 |
| **Max** (3 rows, 2 lines) | **190**; one row + one line = 98 |

**C. Tray preview** (FR-DICEX-48)

| Rule | Value |
|---|---|
| Dice | One die per die of the staged expression, incl. MOD `trayExtras` dice (labelled) and the adv / dis pair of d20s (tagged) |
| Face | Highest face up (d20 → 20; d100 → tens "00" + units "0"); d2, d3, d1000 → round `DieShape` |
| Size | 40 px, wrapping; the constant as "+5" text after the dice |
| Grouping | > 12 dice → one die per term with "×N" (OQ-DICEX-36 decided #256) |
| Drawing | Static stills (OQ-DICEX-35 decided #256). Each redraw renders the dice in a **temporary arena** (or render target) of the one WebGL context, `drawImage`s it into the tray's 2D canvas and removes the arena **in the same task**. Never a lasting still arena on the dice layer (`addStillArena` stays the look editor's), so the dice never float over a window covering the tray. While a throw's loop runs, the copy is taken in the loop's next frame (no dropped redraw) |
| Redraw when | Dice, tags, look or tray size change; no loop of its own |
| DOM mirror | `dicex-tray-die` per die: in `compose` a button (click removes one; hover / focus shows the remove style), in `adjust` a span |
| Fallback | Effective `flat` / `off`, no WebGL, auto-flat, chunk not loaded or failed → `DieShape` `md` chips with the highest face; the chunk never loads for the tray in `flat` / `off` (FR-DICEX-22); a chunk arriving later swaps chips for dice |
| Phones | Same rules (OQ-DICEX-37 decided #256) |
| `rolling` | The preview stays, dimmed |

**D. When an entry lands** (FR-DICEX-49), per this client's presentation

| Presentation | Lands at |
|---|---|
| Big throw (`screen` / `zone`) | Rest; an interrupted throw → its snap (FR-DICEX-18) |
| PiP miniature (DM-only, `others` off) | Its dice rest in their cells |
| `flat` chips | End of the chip fade-in, ≤ 300 ms (OQ-DICEX-38 decided #256) |
| Nothing animates (`off`, `others` off with popups off, tab hidden) | Arrival (OQ-DICEX-38 decided #256) |
| Manual-only entry (every item physical: flat dice, no tumble) | Arrival |
| Throw waiting for the 3D chunk (FR-DICEX-37) | Held through the wait, then as above |
| Anything stuck | Deadline: arrival + 6 s |

**E. What a held entry shows** (one string per surface)

| Surface | While held | At landing |
|---|---|---|
| Tray result (FR-DICEX-10) | Blank die shapes, total "…" | Numbers fade in (150 ms) |
| Popup row (FR-DICEX-40) | Blank chips / cells, total "Rolling…" (as today) | Total and markers appear |
| Game log line ([FR-DICE-40](dice-roll-log.md#6-functional-requirements)) | Blank chips, total and markers "…" | Numbers fade in (150 ms) |

**F. Label reset** (FR-DICEX-50)

| After a `result`, the user… | Request |
|---|---|
| Clicks a palette die | Fresh: expression only, category `other`, no label, default actor; header shows "Other" |
| Types in the expression or constant input | Fresh, as the palette |
| Clicks a notation link | Fresh, with the link's own label / category / actor (FR-DICEX-29) |
| Uses the roll-bar tray Button, Alt+clicks the roll bar's Roll or a roll button | Fresh, from that source |
| Clicks "Roll again" | The same request, label included |
| Clicks Clear | `idle`, nothing kept |
| *(while composing, before a result)* adds or removes dice | Keeps the staged label (a rider on "Notation test" stays "Notation test") |

**G. Where the Alt hint goes** (FR-DICEX-51); the test reads `dicex-stage-hint`

| Surface | Hint | Read from |
|---|---|---|
| Sheet rolls (abilities, saves, skills, initiative, attacks / damage) | `RollButton` tooltip (the sheet's `ROLL_HINT` drops its own copy) | the button's tooltip |
| Death save, sheet section | `RollButton` tooltip | the button's tooltip |
| Concentration save, roll host | `RollButton` tooltip | the button's tooltip |
| Initiative window, row initiative | `RollButton` tooltip | the button's tooltip |
| Initiative Attack ▸ trigger (`cbt-init-row-attack`, hidden anchor) | Its tooltip: "Attack ▸ · Shift: advantage · Ctrl: disadvantage · Alt: adjust in tray" | the trigger's tooltip |
| Initiative Check ▸ / Save ▸ submenus, DM row death save item (`cbtx-init-row-death-roll`) (hidden anchors) | One muted line in the open submenu / item | the open menu |
| Game log roll bar Roll (`dice-roll-submit`) | Tooltip "Shift: advantage · Ctrl: disadvantage · Alt: adjust in tray" | the button's tooltip |
| Roll monsters, the notification's "Roll save" | None (not stageable) | absence |

**H. Static serving** (FR-DICEX-52)

| Rule | Value |
|---|---|
| Build | `bun run build` writes `.br` (brotli q11) and `.gz` (gzip -9) beside every `.js` / `.css` ≥ 1 KB in `dist/client/assets/` (inline Vite plugin, `node:zlib`, no dependency) |
| Serve | `/assets/*` by Hono `serveStatic({ precompressed: true })`: `br`, else `gz`, else the plain file, from `Accept-Encoding`; sets `Content-Encoding` |
| `Vary` | `Vary: Accept-Encoding` on **every** `/assets/*` response, plain files too (set in `onFound`) |
| Cache | `/assets/*` `Cache-Control: public, max-age=31536000, immutable` (OQ-DICEX-41 decided #256, scope flag beyond BL-21); `/` and `/p/*` `no-cache` |
| Validators | None added: content-hashed names + `immutable` make `ETag` / `Last-Modified` unnecessary; a new build changes the names. Range handling unchanged |
| Out of scope | Dev (Vite), REST, asset-pipeline images |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, semantic tokens. Dice colours are user content (the look), not theme.

- **Tray window** (`dicex.tray`): top: dice area (chips, or the last result); palette row; expression Input + constant; bottom bar like the roll bar (mode, DM eye, Roll, Options chevron → category, actor, label); gear (top-right of the body) → popover: display (sprint 4: Full screen / Tray throw / Flat / Off, see "Settings popover" below), "Show others' rolls", "Roll popups", "Dice look…".

| State | Shows | Leaves by |
|---|---|---|
| `idle` | "Click dice in any text, Alt+click a roll button, or pick dice below"; palette | palette / stage |
| `compose` | editable chips, palette, expression | Roll → `rolling` (or `manual`); Clear → `idle` |
| `adjust` | read-only dice from the control (+ `trayExtras` chips; two d20s under adv / dis, FR-DICEX-08 e), "Mira — Athletics" | Roll → `rolling` (or `manual`); Clear |
| `manual` | `ManualForm` (popover's content) | Roll / Roll for me → `rolling`; Cancel → back |
| `rolling` | Roll disabled, "Rolling…" | own entry / 3 s → `result` |
| `result` | flat dice + total + line text; "Roll again" (free) | any stage → that state |

- **Roll surfaces** (FR-DICEX-06; `main` today):

| Surface | Host | Alt+click stages? |
|---|---|---|
| Sheet abilities, saves, skills, initiative, attacks / damage (`SheetRoll`, `RoutedRoll`; in combat routed to `cbt.attack` / `cbt.rollDamage` / `cbt.rollInitiative`) | `RollButton` + `useRollControl` | yes |
| Game log roll bar | `useRollControl` (+ tray Button) | Enter rolls; tray Button stages `free`; *(sprint 5)* Alt+click Roll stages `free` too, with the hint (FR-DICEX-51) |
| Death save (sheet section, DM combat row) | `RollButton` + `useRollControl` | yes |
| Concentration save (open roll host) | `RollButton` + `useRollControl` | yes |
| Initiative window: row initiative, attack / damage, check / save anchors (DM) | `RollButton` + `useRollControl` | yes |
| Roll monsters (`cbt-init-roll-monsters`) | plain Button → `cbt.rollInitiative` | no; one coalesced throw (FR-DICEX-11) |
| Concentration notification "Roll save" with no roll host open | notification action → `cbtx.rollConcentration` | no; throw only |
| Notation links, tray palette | tray `free` | always staged |
| *(Sprint 8)* Macro buttons; roll-request prompt "Roll" | `RollButton` + `useRollControl` | yes (FR-DICEX-68, -83) |

- **Throw zone:** dice tumble in the roller's look, roller name + label above them, total badge at rest; dropped dice dimmed; MOD dice with a small label; "physical" badge on flat manual dice; DM's hidden throws with the eye-off marker (`visibility.hidden` token). *(Sprint 4: the `zone` option; caption only while popups are off, FR-DICEX-17.)*

**Sprint 4: what each display mode shows** (FR-DICEX-32, -41)

| Display (device) | Public roll: big dice | Its popup's dice | DM-only roll (DM) / others off |
|---|---|---|---|
| **`screen`** (default) | 3D over the whole screen, topmost | the same dice fly in at rest, then a still | 3D plays in the PiP only |
| `zone` ("Tray throw") | 3D in the bottom-centre zone (sprint 3) | the same dice fly in, then a still | 3D plays in the PiP only |
| `flat` | — (zone chips while popups are off) | die-shape chips fade in | chips |
| `off` | — | die-shape chips | chips |

- **Roll popup** (FR-DICEX-39–41): a card ≈ 280 px wide in the toast region. **Size constants** (ruling A11; M4's keep-out box uses them): ~~popup 280 × 160 px max (rows beyond 2 scroll inside), gap 8 px, ≤ 3 popups → stack 280 × 496 px~~ *(sprint 5: 320 × ≤ 190 px, gap 8 px, as many popups as fit in the client's toast region, ≤ 3, oldest drops first: FR-DICEX-47, §6.1 table B; constants set by W1)*. Header: actor name + label (one row per entry when coalesced), ✕, gear. Body: ~~PiP dice area (≈ 260×96 px; ≤ 20 dice shrink to fit, then "+N more"), **total** large on the right with its markers~~ *(sprint 5: see "Popup line" below)*. Muted "Rolling…" until rest. DM-only rows: eye-off marker + muted background. Click body → Game log at the entry.
- *(Sprint 5)* **Popup line** (FR-DICEX-46, -47): 320 px card in the DM's top-centre region (FR-SHELL-49) or the players' bottom-right corner. Rows: actor + label, each row's **total** bold at that row's right (markers beside it; "Rolling…" until the landing); ✕ and gear at the first row's far right. Dice line(s) below, full width:

```text
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ Mira  Fireball      34   ✕  ⚙  │   │ Thorn  20d6         71   ✕  ⚙  │
│ ■  ■  ■  ■  ■  ■               │   │ ■  ■  ■  ■  ■  ■               │
│ ■  ■  ■  ■                     │   │ ■  ■  ■  ■  ■  +9              │
└────────────────────────────────┘   └────────────────────────────────┘
 10d6: 6 + 4 cells, 44 px, never      20d6: 11 dice + "+9"
 shrunk                               (click → Game log)
```

- *(Sprint 6)* **Tray at small sizes** (FR-DICEX-53, -54): palette always one row; the bottom bar (mode, Roll) never leaves the window; staged dice shrink (40 → 28 px), then group "d6 ×N", then scroll inside their own area. **DM view / player view:** same tray. The DM's roll popups also step below an open map tool bar instead of covering it (FR-DICEX-55); players' popups unchanged.
- *(Sprint 5)* **Tray dice area** (FR-DICEX-48, §6.1 table C): the staged dice as 3D stills in the owner's look; hover on a die in `compose` → red outline, click removes it.
- *(Sprint 5)* **Held numbers** (FR-DICEX-49, §6.1 table E): blank die shapes (outline in the look, no number); total "…" in the tray and log, "Rolling…" in the popup.
- **Die shapes** (FR-DICEX-42): d4 ▲, d6 ■, d8 ◆, d10 kite, d12 pentagon, d20 hexagon with centre triangle, d100 two kites, others ●; number centred; look colours.
- **Settings popover** (tray gear and popup gear): Display: Full screen / Tray throw / Flat / Off (ToggleGroup); Switches "Show others' rolls", "Roll popups"; "Dice look…". Reduced motion / no WebGL: Full screen and Tray throw disabled with the reason. *(Sprint 6, if OQ-SHELL-47 A)* The same panel is the Preferences **Dice** section (FR-DICEX-57), one column at 360 px; test IDs unchanged (`dicex-settings-*`), the section wrapper is `ui-prefs-section` `data-record-id="dicex.dice"`.
- **Layers** (amendment to [FR-SHELL-01](play-shell.md#6-functional-requirements), settled by seams S7; integrator adds the row at merge): base < windows < chrome < banner, toasts, roll popups < dialogs, overlays < **dice layer** (topmost, no input).
- **States:** disconnected → tray Roll disabled (banner from live-sync), staged request kept; throws already running finish. Loading 3D chunk → flat for that throw. No WebGL → flat, settings show "3D unavailable on this device".
- **DM view:** tray with DM eye; own hidden throws; every player's throw in their look; look editor for the DM look. *(Sprint 4)* Every public roll big + popup (the DM's top-centre region, FR-SHELL-49); own DM-only rolls (hidden, monster attacks and initiative, HP) only in the popup PiP with eye-off.
- **Player view:** tray (no eye); own and others' public throws; own look editor; DM throws only for public DM rolls. *(Sprint 4)* Every public roll big + popup (the players' bottom-right corner); never a DM-only roll, its popup or a placeholder.
- **Keyboard:** tray expression Input: Enter / Shift+Enter / Ctrl+Enter roll ([FR-DICE-05](dice-roll-log.md#6-functional-requirements)); Esc clears a staged request. Notation links are focusable Buttons (Enter = click).
- **Test IDs:** `dicex-tray`, `dicex-tray-state` (+ `data-value` = state), `dicex-tray-die` (+ `data-faces`, `data-term`), `dicex-tray-palette` (+ `data-value` = faces), `dicex-tray-expression`, `dicex-tray-constant`, `dicex-tray-mode`, `dicex-tray-public`, `dicex-tray-roll`, `dicex-tray-clear`, `dicex-tray-again`, `dicex-tray-error`, `dicex-tray-extra` (+ `data-value` = registry key), `dicex-tray-open` (roll-bar button), `dicex-settings-open`, `dicex-settings-render` (+ `data-value`), `dicex-settings-others`, `dicex-look-open`, `dicex-look-style` (+ `data-value`), `dicex-look-body`, `dicex-look-pips`, `dicex-look-material` (+ `data-value`), `dicex-look-save`, `dicex-look-reset`, `dicex-look-contrast`; `dicex-throw` (+ `data-record-id` = first entry id, `data-count` = entries coalesced, `data-render` = 3d \| flat, `data-state` = pending \| moving \| rest), `dicex-throw-die` (+ `data-entry-id`, `data-faces`, `data-value` = server value, `data-settled` = `upFace` at rest, `data-kept`, `data-flat`, `data-offered`), `dicex-throw-more`; `dicex-notation` (+ `data-value` = canonical expression). Manual step reuses `dice-manual-*`. *(Sprint 4)* `dicex-screen` (the dice layer; + `data-state` = idle \| moving \| rest \| handoff); `dicex-throw` gains `data-arena` = screen \| zone \| pip (its existing `data-render` stays as is); `dicex-popup` (+ `data-record-id` = first entry id, `data-count` = entries, `data-dice` = dice shown incl. chips, `data-hidden`, `data-state` = rolling \| rest \| closing); `dicex-popup-row` (+ `data-record-id` = entry id); `dicex-popup-total`; `dicex-popup-pip` (+ `data-mode` = handoff \| play \| chips); `dicex-popup-close`; `dicex-popup-settings`; `dicex-die` (every `DieShape`, the element's only test ID; + `data-shape` = d4 \| d6 \| d8 \| d10 \| d12 \| d20 \| round, `data-faces`, `data-value`, `data-kept`, `data-offered`; the game log wraps it in `dice-log-die`, review B31); `dicex-settings-display` (+ `data-value`, replaces `dicex-settings-render`), `dicex-settings-popup`. Canvas dice keep their DOM mirror (`dicex-throw-die`, `data-settled`). *(Sprint 5)* `dicex-popup` gains `data-shown` (dice drawn in cells) and `data-landed` (= every row landed); `dicex-popup-row` gains `data-landed`; `dicex-popup-cell` (+ `data-entry-id`, `data-line` = 1 \| 2, `data-index`, `data-faces`, `data-value` only once its entry landed); `dicex-popup-more` (+ `data-value` = N, `data-entry-id` = the first hidden die's entry); `dicex-tray-preview` (the tray's 2D canvas; + `data-mode` = 3d \| chips); `dicex-tray-die` gains `data-group` (= N when grouped "×N"); `dicex-tray-total` (the result's total; + `data-landed`); `dicex-stage-hint` (the Alt hint line, FR-DICEX-51). Roll bar Roll keeps `dice-roll-submit`.

**Sprint 8**

- **DM view:** all macros, the Requests window, the launcher dot. **Player view:** own macros, own prompts and answers; never a request card, hidden DC, pass / fail or another player's hidden answer. Not `live` → Send / Roll / Decline / Save disabled. Styling: shadcn defaults, existing state tokens.
- **Test IDs:** `dicex-tray-macros`, `dicex-macros`, `dicex-macro` (+ `data-record-id`, `data-creature-id`), `dicex-macro-roll`, `dicex-macro-edit`, `dicex-macro-new`, `dicex-tray-save-macro`, `dicex-macro-form`, `dicex-macro-{name,expression,category,dm-only,save,delete,delete-confirm,up,down,error}`; `dicex-request-open`, `dicex-requests`, `dicex-request-{roll,expression,target,all,dc,dc-shown,mode,results,label,send}` (`target` + `data-record-id`, `data-state`), `dicex-request-card` (+ `data-record-id`, `data-state`), `dicex-request-target-row` (+ `data-record-id`, `data-state`, `data-total`, `data-success`), `dicex-request-{missing,close,close-confirm}`; `dicex-prompt` (+ `data-record-id` = notification), `dicex-prompt-roll`, `dicex-prompt-decline`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Dice look (`dice-look`, table `dice_look`) | id, campaignId | ID, ID | `ctx.ids` |
| | ownerKey | `"dm"` \| playerId | Unique (`campaignId`, `ownerKey`) |
| | ownerPlayerId | ID \| null | null = DM |
| | style | enum (8) | Named style, FR-DICEX-24 |
| | body, pips | text `#rrggbb` | |
| | material | `plastic` \| `metal` \| `glass` \| `stone` | |
| | updatedAt | timestamp | `ctx.clock` |
| Device settings *(browser only)* | ~~render~~, others; *(sprint 4)* display, popup | enum, bool, bool | FR-DICEX-36 (v2 key; v1 FR-DICEX-21 migrated); never sent |
| Tray request, pending throw *(client memory)* | | | FR-DICEX-02, -09 |
| Roll popup, PiP still *(client memory, sprint 4)* | first entry id, rows, dice, state, timer | | FR-DICEX-39–41; never stored or sent; gone on reload |
| Holding map, tray preview still *(client memory, sprint 5)* | held entry id → deadline; preview canvas | Map\<ID, ms\>, 2D canvas | FR-DICEX-48, -49; filled only by the live-throw path; never stored or sent; a reload starts empty, so every snapshot entry is shown |

- **Relations:** Campaign 1—* Dice look; Dice look → Player by id (no FK, as DICE §8). A player with no row uses the derived default.
- **Derived:** default looks by sorted player `id`; throws (`throwDice`) from `roll` entries; up-faces; canonical notation.
- **Persisted runtime state:** `dice_look` rows only. Rolls and entries unchanged ([DICE §8](dice-roll-log.md#8-data-model)).
- No change to `roll`, `game-log-entry`, kinds or any intent. DICEX adds no `RollRequest` field; what MOD adds (`subject` incl. `subject.card` on `RollControlOptions`; `previewMode`, `manualParts` on `RollRequest`; R14) passes through the tray verbatim (FR-DICEX-08, seams S4). DICEX reads R's per-die `dice` on MOD and `offered` part items (R1); it doesn't define them.

**Sprint 8** (TT0 schema lane, first; seams S7)

| Entity | Fields | Notes |
|---|---|---|
| Roll macro (`roll_macro`) | id, campaignId, playerId \| null, creatureId \| null (no FK), name, expression, category, order, createdBy, updatedAt | index `(campaignId, playerId, creatureId, order)` |
| Roll request (`roll_request`) | id, campaignId, seq, roll (**JSON leaf**), label, dc \| null, dcShown, mode, results, state, targets (**JSON leaf**, 1–12), createdAt, closedAt \| null | index `(campaignId, state, seq)`; target `name` copied at send |

- Relations: a target → its notification and answer entry by id. Derived: macro lists, "All PCs", the eye preset, `success`. Prompts are `notification` rows; answers are `roll` + `game-log-entry` rows.

## 9. API & events

**REST:** none.

**WS intents (client → server)**

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `dicex.setLook {style, body, pips, material}` | DM, player | zod (enum, `#rrggbb`); owner = sender | `{lookId}` |
| *Existing roll intents* | as today | unchanged; the tray calls them through the roll control or `dice.roll` | as today |

**Record types** (scope `campaign`)

| Type | Visibility rule | Snapshot provider |
|---|---|---|
| `dice-look` | **full** to the DM and every player of the campaign | the campaign's rows (≤ 1 + players), not windowed, not lazy (§12) |

**Domain events**

| Event | Emitted by | Payload | Changes | Player sees | Undoable |
|---|---|---|---|---|---|
| `DiceLookSet` | `dicex.setLook` | `{lookId}` | `dice-look` upsert | upsert (every player) | no |
| *(existing)* `DiceRolled`, `CharacterRolled`, `AttackRolled`, `DamageRolled`, … | as today | | `game-log-entry` upsert | per FR-DICE-15; a throw iff received (FR-DICEX-11, -12) | as today |

- No signal: throws are derived from entries already sent, so they follow the log's visibility with no new path.

**Sprint 4: who sees what** (throw + popup consume the existing events above; **no new event, field, signal or record**; visibility = the `roll` entry's, [FR-DICE-15](dice-roll-log.md#6-functional-requirements), #190 rules)

| Roll (source → event) | Entry `public` | DM | Roller (player) | Other players |
|---|---|---|---|---|
| Player roll: tray, roll bar, notation (`DiceRolled`), sheet (`CharacterRolled`), own attack / damage / initiative in combat (`AttackRolled`, `DamageRolled`, `InitiativeRolled`), own saves (`ConcentrationRolled`, `DeathSaveRolled`) | always true (#73) | big + popup | big + popup | big + popup |
| DM roll, category ticked or eye on: roll bar, tray, sheet, Initiative anchors (`CombatantRolled`), DM completing a player's card ([FR-CBT-71](combat-tracker.md#6-functional-requirements)) | true | big + popup | — | big + popup |
| DM hidden roll / category off; DM attack roll ([FR-CBT-52](combat-tracker.md#6-functional-requirements)); monster initiative at Start / add / Roll monsters ([FR-CBT-69](combat-tracker.md#6-functional-requirements); `EncounterStarted`, `CombatantsAdded`); HP rolled; NPC-sheet roll; hidden PC's death save | false | popup only, PiP plays, eye-off (FR-DICEX-38) | — | nothing: no frame, no placeholder |
| `cbt.attack` / `cbt.hp` outcome lines (apply) | per FR-CBT-24 | no throw, no popup (no fresh dice; OQ-DICEX-31) | as DM | as DM |
| Undo (`markUndone`), snapshot, resync, reconnect | — | nothing animates or pops | same | same |

- Every throw and popup reads `payload` only; `dmPayload` never reaches a player frame and is never read by DICEX code (kind contract, FR-DICE-28).
- Per-roll wire **measured, unchanged** (§12): no byte is added to any frame.
- *(Sprint 5)* No intent, event, record, field or signal. Visibility rules unchanged: the landing, popup line and tray preview only change how entries a client already received are drawn. **Static serving** (FR-DICEX-52): `GET /assets/*` adds `Content-Encoding` (`br` / `gzip`), `Vary: Accept-Encoding` (on every answer) and `Cache-Control: public, max-age=31536000, immutable`; `GET /`, `GET /p/*` add `Cache-Control: no-cache`. Same for DM and players (public build files, no secrets in them).

**Sprint 8** — intents per FR-DICEX-66, -74, -78–81 (results: `{macroId}`, `{requestId}`, `{rollId, entryId}`, `{entryIds}`). Record types: `roll-macro` (DM full; player iff `playerId` = viewer; all rows), `roll-request` (`audience: dm`; window, FR-DICEX-73). All events logged, none undoable:

| Event | Changes | Player sees |
|---|---|---|
| `MacroSaved` / `MacroDeleted {macroId}` | `roll-macro` upsert(s) / delete | iff `playerId` = them |
| `RollRequested {requestId}` | `NotificationCreated` per target first, then the `roll-request` upsert (the row lists the prompts' ids; integrator, TT2) | no frame (FR-SYNC-17); a target gets its prompt via `NotificationCreated` |
| `RollRequestAnswered {requestId, characterId, entryId}` | entry + request upsert, then `NotificationResolved` | entry per FR-DICEX-77; the roller their resolve |
| `RollRequestDeclined` / `RollRequestClosed {requestId, rolled?}` | request upsert (+ entries), then `NotificationResolved` per target | entries per FR-DICEX-77; each target's player their resolve |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Stage / compose / adjust in the tray | ✓ | ✓ | none (client) |
| Roll from the tray | as the underlying intent | as the underlying intent | FR-DICE-10, -13; caller's checks |
| Set own dice look | ✓ (DM look) | ✓ (own) | owner = sender |
| Set another owner's look | ✗ | ✗ | no field exists |
| See looks | all | all | full visibility |
| See a throw | every entry | public entries only | FR-DICE-15 |
| *(Sprint 4)* See a roll popup | every entry (DM-only: PiP only) | public entries only | FR-DICE-15 |
| *(Sprint 4)* Change own display / popup settings | ✓ (this device) | ✓ (this device) | none (browser only) |
| *(Sprint 5)* Download built client files (compressed) | ✓ | ✓ (before login too, as today) | none: public build output |
| *(Sprint 8)* Macros: create / edit / roll | any | own, on own PCs or general | FR-DICEX-66; `dice.roll`'s checks |
| *(Sprint 8)* Requests: send, close, roll for missing / answer, decline / see DC, pass / fail | ✓ / ✓ / ✓ | ✗ / own targets / ✗ | role; target `playerId`; DM-only record |

## 11. Edge cases & failure modes

- **Player / DM disconnect:** tray Roll disabled; staged request and manual inputs kept; a running throw finishes (its entry already arrived). Entries committed while offline arrive in the reconnect snapshot → in the log, **no throw** (FR-DICEX-11). An in-flight roll → `disconnected`, never resent; the shake stops at 3 s.
- **Reload mid-throw:** the snapshot has the entry → log line once, no replay, tray `idle`. Reload between Roll and commit → the roll committed (line present) or not (nothing); never doubled.
- **Server crash:** roll + entry + event-log row commit together ([DICE §11](dice-roll-log.md#11-edge-cases--failure-modes)); `dicex.setLook` likewise. After restart: snapshots equal pre-crash; no throw replays (snapshot only).
- **Concurrent:** two rolls arrive together → the earlier snaps to rest (FR-DICEX-18), both lines in order of `n`. Two tabs of one owner set looks → last commit wins, both converge. Look changed mid-throw → next throw uses it.
- **Campaign switch:** the new campaign's looks; highest `n` resets with the new snapshot.
- **Hidden roll then public category flip:** never retroactive (FR-DICE-12); players never throw the old hidden roll.
- **Undo / supersede:** `markUndone` upserts an old `n` → no throw. Gem rerolls later (#140) are new entries → thrown.
- **Many dice:** 50 d6 → 20 thrown + "+30 more"; 20 × d1000 → flat chips only. Many entries in one frame (`cbt.start`, Roll monsters) → one coalesced throw (FR-DICEX-11).
- **Invalid / malicious input:** notation over limits stays text; text is never parsed as HTML; `dicex.setLook` with a bad colour or enum → `invalid`. A client that fakes throw faces only fools itself: the log and server rows are the truth.
- **WebGL context lost** mid-throw → that throw falls back to flat at rest values; next throw retries 3D.
- *(Sprint 4)* **Reload mid-animation:** the entry is in the snapshot → log line once, no throw, no popup (popups are live-only, nothing stored). **Disconnect / reconnect:** a running throw and its popup finish; rolls committed while offline appear in the log only (no popup storm on return). **Server crash:** nothing to recover (no server state); after restart no popup replays; device settings are in the browser.
- *(Sprint 4)* **Burst** (five rolls in 2 s): each new throw hands the running one to its popup at once (FR-DICEX-35); ≤ 3 popups, the oldest closes; the log keeps all five.
- *(Sprint 4)* **Dialog open:** dice still fly over it (topmost, no input); the dialog keeps focus and clicks.
- *(Sprint 4)* **No free area** in `zone` (windows everywhere): the throw plays in the PiP instead (FR-DICEX-41 b). **Popups off + `flat`:** flat chips in the zone as sprint 3.
- *(Sprint 4)* **Slow tunnel:** the frame arrives late; the throw starts then, on the server's faces; the chunk was preloaded (FR-DICEX-37), else that throw is flat. Different viewports → different paths, same faces (FR-DICEX-34).
- *(Sprint 4)* **Tab hidden:** no animation while `document.hidden`; on return, throws that arrived meanwhile show only as popups at rest (no backlog of animations).
- *(Sprint 5)* **Landing hold:** reload mid-throw → `holding` is empty, the snapshot's entries are shown at once (no throw, no hold); disconnect / reconnect mid-throw → the entry stays in `holding`, the running throw finishes and the entry lands at rest (or at its deadline), whatever the resync brings; an entry that never entered `holding` (snapshot, resync-only, undo, below the window floor) is never blank; server crash → nothing to recover (client memory). A burst (5 rolls in 2 s) → each interrupted throw lands at its snap. WebGL lost mid-throw → flat at rest values, shown then. The cap (6 s) means no total stays hidden by a stuck animation.
- *(Sprint 5)* **Popup line:** 50 dice → 20 in the throw (FR-DICEX-14), popup 11 + "+39"; mixed DM frame (FR-DICEX-38) → one line in entry order; a coalesced 8-initiative frame → 6 + 2 cells. Window resize → cell size unchanged.
- *(Sprint 5)* **Tray preview:** look saved in another tab → redraw; tray window resized or moved under another window → redraw at the new size, z-order kept (it is the tray's own canvas); WebGL context lost → chips until the next redraw succeeds; disconnected → preview kept, Roll disabled.
- *(Sprint 5)* **Compressed serving:** a missing `.br` / `.gz` (an old `dist`) → the next encoding or the plain file; an `Accept-Encoding` with q-values (`br;q=1.0`) isn't matched by Hono's simple split → plain file (no browser sends it; accepted). A new build changes hashed names, so `immutable` never serves stale code; the HTML (`no-cache`) points at the new names. Server crash / restart: files on disk, nothing to recover. Not verified: whether Cloudflare's edge already compresses tunnel traffic; origin compression helps LAN play, other tunnels and throttled tests either way.

- *(Sprint 6)* **Tray layout / popup clearance:** client-only, so disconnect, reconnect, reload and a server crash change nothing: the tray re-lays out from its size on mount; a staged request survives a reconnect as built; the DM popup stack re-places when a tool bar appears or goes (FR-DICEX-55). Fits never go below min size (FR-SHELL-29); at exactly min the dice area holds one row and scrolls past it, the bar stays (FR-DICEX-53).
- *(Sprint 8)* **Disconnect / reconnect:** macros and open prompts return with the snapshot (prompts re-toast, silent); an answer in flight is never resent: committed → `rolled` (a repeat gets `conflict`), else still `open`. Offline players find their prompts on return. The DM's window rebuilds from the snapshot. **Crash:** each command is one transaction (row, prompts, entry, event log); no half-answered target. **Concurrent:** player and DM answer one target → first wins; Close vs a late answer → whichever commits first. A PC changing owner mid-request: its open targets become `missed`, prompts resolved (FR-DICEX-65); the DM re-asks. **Malicious:** a player can't answer another's target (`not_found`), choose the roll, the DC or the audience (built from the request), or read `roll-request`.

## 12. Performance & bandwidth

- **Wire:** no new traffic per roll (throws reuse the entry frame). `dice-look` ≈ 310 B per row; one upsert per look save (human-paced).
- **Sprint 3 (built, D2):** `dice-look` = 2,157 B in the heavy DM frame (7 rows, 308 B/row), not lazy (seams S1: a throw needs the roller's look the moment the entry arrives); asserted by `src/server/features/dice-extras/con44.test.ts`. Rejected variants and the sprint-3 table: this file's git history at the sprint-3 gate (`git log -p docs/specs/dice-extras.md`).

- **Sprint 4 CON-44 (measured 2026-10-17 at commit `0b254f2`**, the branch base; `main` since then has status-only commits). Harness `src/server/ws/testing/snapshot-size.ts` `buildRealisticHeavy`; the three figures below differ only in what each test loads on top, and **D adds 0 B to every one** (review B28):

| Harness (test file) | Heavy DM | Players | Note |
|---|---|---|---|
| plain heavy on `session-sim` (`src/server/ws/snapshot-size.test.ts`; my throwaway probe gave the same, 670,423 B) | **670,407 B** | 277,344–280,404 B | D's baseline |
| + 7 `dice-look` rows (`src/server/features/dice-extras/con44.test.ts`) | **672,555 B** | max 282,549 B | 376,021 B left of 1 MiB *(ceiling raised to 1.5 MiB, #256: 900,309 B left)* |
| + V2 vision at caps (`src/server/features/fog-of-war/con44.test.ts`, V2 case) | **679,484 B** | ≤ 283,961 B | protocol's 681,447 B is the same case at `build/vision-server` time; it drifted down since |

- **Per-roll frames** (real sockets on `dice-log`, raw event frames, throwaway probe deleted):

| What | Before (`main`) | After (decided, #245) | Note |
|---|---|---|---|
| Player `1d20+5` skill (`DiceRolled`) | DM 782 B, other player 765 B | **same** | popup + throw read this frame |
| Player `1d20+4` adv attack | 820 / 803 B | same | |
| Player `10d6` damage | 1,084 / 1,067 B | same | |
| DM public `2d6+3` | 819 / 752 B | same | |
| DM hidden `1d20` | 782 B / **0 frames** | same | nothing reaches players |
| Player `50d6` (schema max) | 2,439 / 2,422 B | same | |
| ~~Per-player prefs on the look row~~ (OQ-DICEX-22 B) | 315 B/row | 377 B/row (+62) | +434 B heavy DM and each player (7 rows, full visibility) |

- **Client bundle:** initial chunk + ≤ 15 KB gz per client; 3D chunk lazy, ≤ 170 KB gz with the pick. Both asserted by a size test on `bun run build` output. Measured library sizes: [§14](#14-dependencies). *(Sprint 4, measured 2026-10-17 with `bundle-size.test.ts` (gzip -9) and a per-module probe, deleted; review B29):*

| Chunk | Today | Cap | Left | Sprint 4 rule |
|---|---|---|---|---|
| dice-extras code in each client's initial chunks | **11.1 KB gz** (DM and player) | 15 KB | 3.9 KB | `DieShape` replaces `FlatDie` (0.91 KB today); settings v2 replaces `settings.ts` (1.03 KB); the popup **UI** (stack, rows, PiP host, gear) goes in a small lazy chunk `RollPopup` loaded at idle after the first snapshot in **every** display mode (as the tray body, #229); only the frame hook and the popup store stay initial. Comparable module today: `ThrowLayer.tsx` 2.85 KB, which would not fit beside the rest |
| `RollPopup` lazy chunk (new) | — | **8 KB gz** (new cap, asserted) | — | a popup arriving before it loads waits for it (≤ 1.5 s, as FR-DICEX-37), then shows |
| 3D chunk `dice3d` | **155.7 KB gz** (Vite's report: 629.6 KB / 161.3 KB at its default level) | 170 KB | 14.3 KB | arenas, PiP scissor and hand-off extend `renderer.ts` (2.65 KB today) and `settle.ts` (2.25 KB); our whole 3D code is 9.6 KB gz today, so 14.3 KB left is ample. **No cap raise asked**; the test enforces it, and if a build crosses it the builder stops and reports (a raise is the DM's call) |
| dice-roll-log (log chips, focus) | `GameLog.tsx` 4.42 KB, `roll-kind.ts` 1.34 KB | none of its own | — | + `die` segments and chips; not in the dice-extras budget (it's the log's code); measured by the same test's report line |
- *(Sprint 4)* **Screen layer cost:** fill rate grows with the screen: pixel ratio ≤ 1.5 and no shadows above 2.5 MP (FR-DICEX-44); one WebGL context; render loop only while dice move or fly. Precompute ≤ 50 ms for 20 dice in any arena (tested).
- **Frame rate:** target median ≥ 50 fps for 20 dice; physics precompute ≤ 50 ms for 20 dice (≤ 150 steps); auto-flat below 30 fps (FR-DICEX-23). Headless Playwright (software GL) can't judge this: the walkthrough logs fps for information only; the DM checks it on the table laptop at the sprint gate.
- **Parser:** a 4,000-char note parses < 1 ms; memoised per text.

**Sprint 5** (measured 2026-10-18 on this branch = `main` @ `04d11e9` + docs)

- **CON-44: 0 B.** Nothing new enters the snapshot or any per-roll frame: the landing, popup line, tray preview, label reset, Alt hint and slot labels ([FR-DICE-41](dice-roll-log.md#6-functional-requirements)) are client-only; compression changes HTTP bytes of static files, not WS. No probe needed; baseline re-run with the existing tests: `src/server/features/dice-extras/con44.test.ts` heavy DM **674,452 B** (7 `dice-look` rows; 898,412 B left of the 1.5 MiB DM ceiling, #256), players max **284,256 B**; `src/server/ws/snapshot-size.test.ts` heavy DM 672,306 B, players 278,879–282,109 B. Sprint-4 per-roll frames stand (`1d20+5` 782 / 765 B; `10d6` 1,084 / 1,067 B).
- **Client bundle** (`bundle-size.test.ts` today): dice-extras in each initial chunk **12.2 KB gz** of 15 (the landing set + hook stay initial, small; tray preview code goes in `dice3d`); `dice3d` **157.2 KB gz** of 170 (preview generalises `dice3d/preview.ts`, which draws one still d20 today); `RollPopup` 4.8 of 8 KB gz (line layout replaces PiP fit code). Caps unchanged; the test still enforces them.
- **Render cost:** tray preview = one draw of ≤ 12 dice per change, no loop (rAF count 0 when idle); popup line = the existing still capture, cell layout instead of scene positions. Phones: same pixel-ratio cap (1.5) and auto-flat.
- **Compressed serving (BL-21), measured** on `bun run build` output with `node:zlib` (throwaway script, outside the repo) and real requests to Hono 4.13.13 `serveStatic` (throwaway probe, deleted):

| File(s) | Raw | gzip (Hono `compress()`, on the fly) | gzip -9 (prebuilt) | **brotli q11 (prebuilt)** | At 400 kbit/s: raw → br |
|---|---|---|---|---|---|
| `dice3d` chunk | 632,343 B | 162,622 B, 8–12 ms CPU per request (30 ms cold) | 160,731 B | **132,499 B** (−79 %) | 12.6 s → **2.6 s** |
| Player initial (19 files) | 1,210,852 B | — | 373,396 B | **321,999 B** | 24.2 s → 6.4 s |
| DM initial (21 files) | 1,430,904 B | — | 434,554 B | **373,390 B** | 28.6 s → 7.5 s |
| Whole `dist/client/assets` (32 JS / CSS) | 2,560,459 B | — | 761,304 B | **649,908 B** | build adds ≈ 2.8 s for br q11 + gz -9 |

- Served today with **no `Cache-Control`, `ETag` or `Last-Modified`** (probe): every reload downloads the 632 KB chunk again, which is why the first roll after a reload went flat on a slow link (BL-21). With `immutable` (FR-DICEX-52) a reload transfers 0 B for unchanged chunks.

- *(Sprint 6, WF)* **CON-44: 0 B** (tray layout and popup placement are client-only). **Tray budget** (the one budget FR-DICEX-53 uses; read from sim-9 d01, 300 × 240, `player-1`, 2d6 + 1d8 + 1 staged; screenshot px, not a probe; the build re-measures and pins):

| Part (px) | Today (d01) | After FR-DICEX-53 |
|---|---|---|
| Window | 240 | 240 |
| Title bar | 34 | 34 |
| Header ("Other" + gear) | 30 | ≤ 24 (gear optional, OQ-DICEX-48) |
| Palette | 62 (2 rows, d100 wraps) | 31 (1 row) |
| Expression + constant row | 30 | 30 |
| Bottom bar (mode, Roll) | 36 (below the fold, y 301–329) | 36 |
| Gaps + padding | 46 | 46 |
| **Left for the dice area** | ≈ 2 (the 40-px stills push the bar out) | **≈ 39** → ≥ one 28-px row (tested); 40 only if the build trims a gap |

Redraws: one still redraw per tray resize (as built).

**Sprint 8 CON-44** (all of TT; re-measured 2026-10-21 at the caps after review A #1, `db8fe53b`, throwaway probe deleted: heavy harness + new rows at max length in wire shape, sized by `snapshotTypeBytes`; the prompt = a real pending notification re-kinded). Baseline: DM 690,771 B, players 289,100 B.

| What (worst = caps, max strings) | DM | Each player |
|---|---|---|
| `roll-macro` at the cap: 200 rows (391 B); a player with 2 PCs: 3 lists × 24 = 72 | +73,841 B | +28,301 B |
| `roll-request`: 5 open + 10 closed, 12 targets each (4,493 B; the old 20-closed window was 119,367 B) | +70,927 B | 0 |
| Prompts pending: 5 × 12 (1,054 B each); a player with 2 PCs gets 10 (one owning all 12 PCs: 60 = +63,300 B) | +63,300 B | +10,550 B |
| `campaign` + 4 sound picks + pause | +488 B | +488 B |
| `audio-asset` (lazy; `sync.load` of 50 = 13,833 B) | 0 | 0 |
| **Total worst** (realistic: 6 + 10 macros, 1 open request × 6) | **+208,556 B** (+23,769 B) | **+39,339 B** (+3,236 B); theoretical +92,089 B |
| Cumulative on GM + ST's worst (≈ 942 / 299 KB) | ≈ 1.15 MB of 1.5 MiB (≈ 420 KB left) | ≈ 338 KB of 512 KiB (≤ 391 KB theoretical) |

- Frames: `MacroSaved` 605 B; `RollRequested` 4,709 B at 12 targets + `NotificationCreated` ≈ 1.2 KB per target (DM ≈ 19 KB for 12); **players: no frame** for `RollRequested` (FR-SYNC-17), a target gets only its `NotificationCreated`; answer = entry (≈ 0.8 KB, +14 B for `answer: true`) + request upsert ≈ 4.5 KB (DM) + `NotificationResolved` ≈ 1.2 KB; `CampaignPaused` / `Resumed` 834 / 497 B to all.
- Asserted by `con44-tt.test.ts` (TT0) at these caps: ceilings; in the DM frame `roll-macro` ≤ 76 KB, `roll-request` ≤ 72 KB, `roll-request` prompts ≤ 64 KB; none of `roll-request` / `audio-asset` in player frames. Bundle: prompt + macro buttons initial (≤ 2.5 KB gz, DICEX cap 15 KB holds); popover, editor, Requests window in a lazy `TableTools` chunk (cap 12 KB gz). *(Integrator, TT2: the prompt body loads in a small idle chunk; the dice-extras initial chunk stays under its 15 KB cap.)*

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:` + seeded `ctx.dice`.

**Fixtures** (setups run as DM unless noted)

| Key | Kind | Requires | Contents |
|---|---|---|---|
| `dicex-looks` | setup | `player-2` | DM: `dicex.setLook` Obsidian, metal. `player-1` (as player-1): Crimson, body `#8b1a1a`, pips `#ffffff`, metal. `player-2`: none (default Sapphire) |
| `dicex-notation-text` | setup | `char-mira-full` | `char.putRow` on Mira, list `features`, one **new** row: name "Notation test", source "fixture", text "Greataxe 1d12 + 5 slashing. Second Wind d10+1. Hit: 7 (2d6 − 1). Adv: 1d20+3. Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6." |

- **Composes (seams S10):** units are patches. `dicex-notation-text` adds one feature row and touches no existing field of `char-mira` (notes keep "MIRA-NOTE-7" for CHARX's leak scan); `dicex-looks` writes only `dice-look` rows. Both load unchanged inside `session-sim-7`.
- **Bundle `dice-extras`** = `dice-log` + `char-mira-full` + `dicex-looks` + `dicex-notation-text`. Sprint-2 bundles are untouched.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-DICEX-28 notation parser`: "1d12+5", "1d12 + 5", "1d12 +5", "1D12+5" → `1d12+5`; "d20" → `1d20`; "7 (2d6 + 3) slashing" → `2d6+3`; "2d6 − 1" / "2d6 – 1" → `2d6-1`; "4d6kh3", "2d20kl1+5"; "1d6+1d4+2" one match; "1d8 plus 1d6" two; "1d6 +" → `1d6`; "1d6+3days" → `1d6`; "1d6+3." → `1d6+3`; newline between "1d6" and "+ 2" → `1d6`; not matched: "51d6", "1d1", "0d6", "1d1001", "2d6/2", "4d6x2", "abc1d6", "2d6x", "1 d 6", "+5 to hit", "d%"; > 60 chars / > 10 terms → text; positions exact; 4,000 chars < 1 ms. `FR-DICEX-13 throwDice`: kept + dropped (adv), MOD `1d4` part with `dice` → labelled die, `-1d4` → value 3 + "−", `3d6` part with `dice` [2, 5, 6] → three labelled dice, a part without `dice`: `1d4` → one die, `2d6` → chip, null label → "DM", an `offered` `1d6` (Divine Fury) → one die tagged "on a hit", not in the total badge, manual with / without per-die values, 51 dice → 20 + "+31 more", d3 / d1000 → flat, d100 → tens + units (100 → 00 + 0). `FR-DICEX-15 upFace + relabel`: for each die type and every (landed face, target value) pair, the relabelled up-face reads the target. `FR-DICEX-15 headless settle` (D3, cannon-es, no renderer): 20 seeds × d4, d6, d8, d10, d12, d20, d100 × every target value: simulate, relabel, read `upFace` from the final body orientation → target; d4 by its top vertex; d100 tens + units incl. 100 → 00 + 0; every run rests or snaps within 150 steps. `FR-DICEX-11 high-water`: snapshot entries, resync, `markUndone` upsert → no throw; new `n` → throw; campaign switch resets; one frame with 3 `roll` entries (Roll monsters) → one throw, dice in `n` order, 30 dice → 20 + "+10 more". `FR-DICEX-09 pending`: reduced motion → static "Rolling…" label, no animation frames. `FR-DICEX-12 payload only`: an entry with a `dmPayload` sentinel → throw never contains it. `FR-DICEX-21 settings`: parse, invalid → defaults, throwing storage → memory, reduced motion → flat. `FR-DICEX-24 default looks` by sorted player `id`: the same on DM and player stores fed in different snapshot orders. Roll control (DOM tests, as `sheet-render.test.tsx`): `FR-DICEX-06` click → `onRoll` at once + pending; Alt+click → tray `adjust`, Roll → `onRoll` with the same `RollRequest`; `FR-DICEX-07` physical + tray → `ManualForm` in the tray, FR-DICE-31/32 rules hold; `FR-DICEX-08` a test `trayExtras` entry shows its chips; an unknown `options` field (a `subject`) and the `RollRequest` fields `previewMode`, `manualParts` reach `onRoll` unchanged; adv via the toggle → two d20 chips; a request whose `previewMode` is `dis` → two d20 chips tagged dis; a damage entry with an `offered` trigger part `1d6` → one labelled thrown die (`throwDice`). `FR-DICEX-06` the Roll monsters button and the concentration notification action roll at once (no Alt stage). `FR-DICEX-01` window `dicex.tray` passes the registry-driven layout tests (1280×720 fit, 1600×900 no overlap) | in-code |
| Integration | `FR-DICEX-26`: setLook as DM and player → own row only; same look → no event; bad colour → `invalid`; event + row + log in one tx, rollback → none. `FR-DICEX-25`: every player frame has every `dice-look` row. CON-44 test (#208): heavy + 7 rows under the ceilings (DM 1.5 MiB since #256, each player 512 KiB) and DICEX's own per-type bound `dice-look` ≤ 2.5 KB in the DM frame; no headroom guard (§12). Restart → identical snapshots. Leak scan: hidden "DM-SECRET-ROLL" (rolls-1) absent from player frames, as DICE | `dice-extras` |
| E2E (thin) | B clicks `1d12+5` in Mira's "Notation test" feature → tray `compose` → Roll; A sees the line; B's `dicex-throw-die` `data-settled` = `data-value` for each die (headless Chromium WebGL, or flat when unavailable: then `data-flat`) | `dice-extras` |
| Bundle | `bun run build`: player and DM initial chunks grow ≤ 15 KB gz vs `main`; the 3D library sits only in a lazy chunk, and that chunk is ≤ 170 KB gz | — |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load dice-extras --profile verify`; `start --profile verify` (test agent's Herdr pane). Contexts **A** DM (`pw-dm`), **B** `player-1` (Mira), **C** `player-2`; B, C frames logged. Evidence + teardown per AGENTS §9.6. Throws: check `data-settled == data-value` for every `dicex-throw-die`, and *total = kept dice + constants*.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | B, C open links | No tray open (default closed); game logs as DICE |
| 2 | — | B: Mira's sheet → Features → "Notation test" | "1d12 + 5", "d10+1", "2d6 − 1", "1d20+3" are links (`data-value` `1d12+5`, `1d10+1`, `2d6-1`, `1d20+3`); "51d6", "1d1", "2d6/2", "4d6x2", "abc1d6" plain text |
| 3 | — | B: click "1d12 + 5" | Tray opens, `compose`: one d12 chip, constant 5, actor Mira, label "Notation test", category other |
| 4 | — | B: palette d6, constant → 6, Roll | A, B, C: line "Mira — Notation test: 1d12+1d6+6 …" at once; B's throw in Crimson metal, A and C see it too (same look); dice rest ≤ 2.5 s; `data-settled == data-value` |
| 5 | — | C: gear → Others' rolls off; B rolls "d10+1" | C: line only, no `dicex-throw`; A, B: throw |
| 6 | — | C: Dice look → Emerald, glass → Save; C rolls `1d20` in the tray | A, B: C's throw in Emerald glass; reload B → C's next throw still Emerald |
| 7 | Eye off; roll `1d20`, label "DM-SECRET-DICE" | — | A: throw with eye-off marker; B, C: no line, no throw; frames contain no "DM-SECRET-DICE" |
| 8 | Open Mira's sheet; Alt+click Athletics | — | Tray `adjust`: "Mira — Athletics check", d20 + modifier read-only; set Adv → two d20 chips tagged adv; Roll → one `char.roll` line "(adv)", two d20 thrown, one dimmed |
| 9 | — | B: Physical dice on; click "2d6 − 1"; Roll; enter 4 and 5 | Tray `manual` (`dice-manual-*`); line "… 4 + 5 - 1 = 8 physical"; flat dice 4, 5 (`data-flat`), no tumble |
| 10 | — | B: Physical off; roll `10d6` in the tray; reload during the throw | After reload: line once, no throw replay, tray `idle`, no console errors |
| 11 | — | C: emulate `prefers-reduced-motion`, reload; B rolls | C: flat dice (`data-render="flat"`); C's network log: no 3D chunk request. C: render Off → no throw zone |
| 12 | Hard-kill + restart server while B has "1d20+3" staged | — | B: Roll disabled, staged dice kept; after restart Roll works; looks unchanged |
| 13 | Roll `20d6` (render 3D) | — | 20 dice thrown, `data-settled == data-value`; `50d6` → 20 + "+30 more". Median fps logged in `report.md` for information only (no PASS / FAIL; the DM checks on the table laptop at the sprint gate) |

*(Sprint 4)* Steps 1–13 stay as a regression of the **`zone`** option: set Display → Tray throw on A, B, C first. Changed expectations: 5 → C sees B's dice in the popup PiP only (FR-DICEX-43); 7 → A sees the hidden roll only in the popup PiP (FR-DICEX-38).

**Sprint 4 fixtures:** no new unit (no new record type). **Bundle `dice-display`** = `combat` (session-sim + `player-2` + `char-thorn` + `thorn-battlemap`; encounter "Ambush at the Ford") + `rolls-1` (log history with the hidden "DM-SECRET-ROLL") + `dicex-looks` + `dicex-notation-text`. Composes as patches (seams S10); existing bundles unchanged.

| Level | What (sprint 4) | Fixtures |
|---|---|---|
| Unit | `FR-DICEX-39 popup gets every public roll source`: frames built from real entries of each source (`dice.roll` tray / roll bar / notation, `char.roll` check / save / skill / attack, `cbt.attack` and `cbt.rollDamage` player roll entries, `cbt.rollInitiative` PC, `cbtx.rollDeathSave`, `cbtx.rollConcentration`, DM public `dice.roll`, DM completing a player card) → one popup each, right rows and totals; `cbt.start` frame with 3 monster entries → one popup, 3 named rows (sim-7 "Ogre · 3 rolls"); snapshot, resync, `markUndone` upsert, reconnect → none; `popup` off → none. `FR-DICEX-40 content`: no `dmPayload` sentinel in any popup text; adv / natural / physical / offered markers as the line. `FR-DICEX-42 die-shape chips per die type`: d4 / d6 / d8 / d10 / d12 / d20 → `data-shape`; d100 = tens + units kites (100 → "00" + "0"); d3, d1000, manual total → round; dropped struck, offered dashed, colours from the look. `FR-DICEX-34 animation lands on the server's faces`: headless settle in screen arenas 1280×720, 1440×900, 1920×1080, 390×844 and the PiP arena × d4–d20, d100 × every target × 10 seeds → `upFace` = target, ≤ 150 steps, ≤ 50 ms for 20 dice; a resize-scaled arena keeps the faces; relabel never changes `data-value`. `FR-DICEX-38 DM-only`: a `public: false` entry → no screen / zone throw, PiP `play` + eye-off. `FR-DICEX-41 PiP same dice`: PiP dice keys, values and count = the throw's in `handoff`, `play` and `chips` modes. `FR-DICEX-45 reduced motion`: no `dicex-screen` frames, chips without transition, no 3D chunk import. `FR-DICEX-36 settings v2`: defaults, v1 `3d` → `screen` migration, invalid → defaults, throwing storage → memory. `FR-DICEX-37 preload`: `screen` → chunk import at idle after the first snapshot; `flat` / `off` → none; a throw during load waits ≤ 1.5 s then 3D, else flat. `FR-DICEX-39 stacking`: 5 rolls in 2 s → ≤ 3 popups, oldest closed first, a notification toast keeps its place; hover pauses the 6 s timer; click → `focusLogEntry(entryId)` | in-code |
| Unit / DOM (sprint 4, review B14, B25) | `FR-DICEX-32 display modes`: each of `screen` / `zone` / `flat` / `off` → which arenas and popup modes run (the §7 table, row by row); reduced motion or no WebGL with `screen` stored → effective `flat`, stored value unchanged. `FR-DICEX-33 dice layer`: portalled under `body`, last in z-order (computed `z-index` above the toast and dialog layers), `pointer-events: none`, `aria-hidden`, never focusable; `elementFromPoint` at a window's centre during a throw returns the window; no caption text node; die size at 390×844 = 40 px (clamp), 1440×900 = 63 px, 2560×1440 = 96 px (clamp); idle → no rAF callbacks. `FR-DICEX-35 timing`: fake clock: rest ≤ 2.5 s, hand-off starts at rest + 1 s, ends 0.4 s later, layer cleared; a second throw at 1.2 s → the first snaps to rest and hands off at once; popups off → rest 1.5 s + fade, no hand-off. `FR-DICEX-43 others off`: another's roll → no screen / zone throw, PiP `play`; own roll unaffected. `FR-DICEX-44 slow devices`: renderer pixel ratio = min(devicePixelRatio, 1.5); viewport 2,560×1,440 (3.7 MP) → shadows off, 1,440×900 → on; a throw with median frame 40 ms → display `flat` + the Toast, also for a PiP-only throw. `FR-DICEX-15 seed from first public entry`: a DM frame [DM-only, public] → seed = hash(public id), equal to the players' seed for the same frame. `FR-DICEX-38 mixed frame on the DM`: popup rows for both entries; PiP shows both entries' dice; `data-dice` = all dice of the frame; the players' popup `data-dice` = public dice only. `FR-DICEX-41 concurrency + clip`: a big throw and a PiP miniature render in one loop with two scissor rects; a popup shifted by a new toast mid-play → the miniature's scissor follows; a dialog over the popup → no PiP pixels under the dialog rect; the still is captured in the rest frame's task (no `preserveDrawingBuffer`). Amended cases in existing tests: `FR-DICEX-09 pending` + popups on → "Rolling…" row in the own popup, none in the zone; `FR-DICEX-17 zone` → no caption while popups are on, caption while off, drawn on the one dice-layer canvas (one WebGL context on the page); `FR-DICEX-18 interrupt` → the interrupted throw's popup gets its dice at once | in-code |
| Integration | `FR-DICEX-38 hidden roll never reaches a player frame` (real sockets, `dice-display`): DM `dice.roll` eye off "DM-SECRET-DICE", DM Initiative ▸ Attack on Mira, `cbt.start` → player-1 / player-2 raw frames contain neither the entry ids nor the label; leak scan clean (DICE's). CON-44: no new type or field; heavy snapshots under the ceilings (DM 1.5 MiB since #256, players 512 KiB); a player `1d20+5` `DiceRolled` frame ≤ 1.2 KB (measured 765–782 B) | `dice-display` |
| E2E (thin) | B (player-1): Mira's sheet → Athletics; C (player-2) sees `dicex-popup` with one d20 (`data-dice` = 1) and `dicex-screen` reaching `rest` with `data-settled == data-value` (or `data-render="flat"` without WebGL) | `dice-display` |
| Bundle | `bundle-size.test.ts`: dice-extras code in each client's initial chunks ≤ 15 KB gz (11.1 today); the new lazy `RollPopup` chunk ≤ 8 KB gz and reached by dynamic import only; 3D chunk ≤ 170 KB gz (155.7 today) (§12) | — |

**Sprint 4 walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load dice-display --profile verify`; `start --profile verify`. Contexts **A** DM 1440×900, **B** `player-1` (Mira) 1280×800, **C** `player-2` (Thorn) 1280×800 **throttled** (CDP `Network.emulateNetworkConditions`: 400 kbit/s down, 400 ms latency) from step 14. **B and C WS frames logged** (in + out, from first load, surviving reloads, as session-sim-7's `page.on('websocket')`; review B32). Default display (Full screen). Open on every context before rolling: Game log, Character sheet / Initiative, so windows cover the screen. Check per throw: `data-settled == data-value`; same `data-dice` in A / B / C popups; *total = kept dice + constants*.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 14 | Log in | B, C open links | Network logs: the 3D chunk loads at idle before any roll (A, B, C); popups none; log shows `rolls-1` with die chips (DICE §13) |
| 15 | — | B: Mira's sheet → **Athletics** (sheet check) | A, B, C: d20 flies over every window (`dicex-screen` topmost: a click at a window's centre still hits the window), rests on the server face; **first throw of the session is 3D** (sim-7); then flies into the popup: B, C bottom-right, A top-centre; row "Mira — Athletics", 1 d20, total; C later but same face |
| 16 | — | B: tray `10d6`, Roll | 10 dice everywhere; every popup `data-dice` = 10; no caption over any token label |
| 17 | — | C: popup gear → Display **Tray throw**; B clicks "1d20+3" in "Notation test" → Roll | C: zone throw bottom centre, no caption (name in the popup); A, B: full screen |
| 18 | Eye off; roll `1d20`, label "DM-SECRET-DICE" | — | A: no big dice; popup PiP plays, eye-off; B, C: nothing; frames without the label |
| 19 | Encounters → Start "Ambush at the Ford" | B: Initiative from the sheet | A: one popup, one named row per monster (no "· N rolls"), PiP only; B's roll: big for A, B, C + popups |
| 20 | — | B: Light crossbow **Attack + damage** on a Goblin | A, B, C: to-hit and damage dice big, one popup; A applies → outcome line (no new popup) |
| 21 | Initiative ▸ Goblin Attack on Mira; apply | — | A: PiP only, eye-off; B, C: no throw, no popup; after apply the outcome line in their log |
| 22 | Game log | Game log | Every roll line shows die-shape chips in the roller's colours (d20 hexagon, d6 squares, d8 diamond); dropped d20 struck; A's Goblin outcome line shows its dice breakdown as chips, B / C's as text; ≥ 6 lines at default size (FR-DICE-35) |
| 23 | — | B: roll `10d6`; reload B mid-throw | B: line once, no throw, no popup, no console errors; A, C unaffected |
| 24 | — | C: Probes → Drop connection; B rolls twice; C back | C: both lines in the log, no throw or popup replayed |
| 25 | — | C: emulate reduced motion, reload; B rolls | *(#247)* C: the same as without it: `dicex-screen` present, full-screen 3D throw, no reduced-motion hint, every display mode clickable |
| 26 | A: Notifications window → test send form ([FR-NOTE-22](notifications.md#6-functional-requirements), test mode): `note-test-text` "Popup stack test", `note-test-audience` = All, `note-test-send` | B: 5 rolls in 2 s (right after A's send) | C: ≤ 3 roll popups, the notification toast still shows in its own stack; hover pauses; click a popup → Game log fronted, entry highlighted |
| 27 | Hard-kill + restart | — | No popup or throw replays; device settings kept; logs unchanged |

**Sprint 5 fixtures:** no new unit (no new record type). **Bundle `dice-polish`** = `dice-display` + `char-brakka` + `weapon-flame-tongue` (Brakka, owned by `player-1`, with the Flame Tongue greatsword: `1d20+8`, `2d6+5` slashing + `2d6` fire). Patches over existing units (seams S10); existing bundles unchanged; `session-sim-9` needs nothing extra (session-sim-8 already has both units).

| Level | Test (sprint 5) | Checks | Fixtures |
|---|---|---|---|
| Unit / DOM | `FR-DICEX-46 popup line layout` | Frames of **1, 4, 10, 20** d6 → 1 line × 1 cell; 1 × 4; 2 lines (6 + 4); 2 lines, 11 dice + `dicex-popup-more` "+9" (`data-entry-id` = the 12th die's entry); cell 44 px at 390×844, 1280×720, 1920×1080 (never scaled); order = `throwDice` order; each `dicex-popup-cell` has `data-entry-id`; mixed frame (d20 adv + 2d6 + offered 1d6) → dropped dimmed, offered dashed, its tag cut to the cell with the full text in the Tooltip, `data-dice` = all, `data-shown` = cells; hand-off targets = cell centres, dice past cell 11 target "+N"; `handoff` / `play` / `chips` give the same cells; click "+N" → `focusLogEntry(first hidden die's entry)` | in-code |
| Unit / DOM | `FR-DICEX-47 popup size` | Card ≤ 320 × 190 with 3 rows and 2 dice lines, 98 px with 1 row + 1 line (table B); each row's total at its right; reads W1's `ROLL_POPUP_W` / `ROLL_POPUP_H`; short screen (1280×720 with a toast) → only the popups that fit in the toast region (DM top-centre, players bottom-right), the oldest dropped first, none outside the viewport or above the top bar | in-code |
| Unit / DOM | `FR-DICEX-48 tray preview per die type` | d4, d6, d8, d10, d12, d20, d100 → one preview die each (`data-faces`; d100 = two d10 "00" + "0"), highest face up; d3 / d1000 → round chip; 13 d6 → one die `data-group` 13; adv → two d20 tagged; a `trayExtras` die labelled; `flat` / `off` / no WebGL / chunk failed → `data-mode="chips"`, no 3D import in `flat` / `off`; late chunk → `3d`; each redraw adds and removes its temporary arena in one task (no lasting arena on the dice layer); a redraw during a running throw is copied on the next loop frame; idle → 0 rAF callbacks; a window over the tray wins `elementFromPoint` at a die's centre; click a die → one removed | in-code |
| Unit / DOM | `FR-DICEX-49 total hidden until landed` (fake clock) | `screen` → tray, popup and log totals held until rest (≤ 2.5 s), shown at rest; second throw at 1.2 s → the first lands at its snap; `zone` same; `flat` → 300 ms; `off` → arrival; `others` off → PiP rest; DM-only on the DM → PiP rest; manual-only entry → arrival; chunk wait → held through it; tab hidden → arrival; **reduced motion emulated → identical to without** (#247); reconnect mid-throw (resync with the entry) → still held, lands at rest; reload → `holding` empty, all shown; snapshot / resync-only / undo / below-floor entries → never held; stuck animation → shown at 6 s; one string per surface (tray / log "…", popup "Rolling…") | in-code |
| Unit / DOM | `FR-DICEX-50 label reset` | Notation "1d12 + 5" ("Notation test") → result → palette d6 → no label / actor, category `other`, header "Other"; same after typing in the expression input and after editing the constant; "Roll again" → same label; Clear → `idle`, nothing kept; notation link after a result → its own label; adding a d6 during `compose` keeps "Notation test" | in-code |
| Unit / DOM | `FR-DICEX-51 Alt hint on each roll button` | Every row of table G: `dicex-stage-hint` exactly once in the named place (tooltip, Attack ▸ trigger tooltip, open Check ▸ / Save ▸ submenu, death-save item); Alt+click / Alt+select → tray `adjust` (roll bar Roll → `free` with its expression); Roll monsters and the notification "Roll save" → no hint, no stage | in-code |
| Integration | `FR-DICEX-52 compressed chunk served` | `createApp` on a temp `clientDir` with `assets/a.js` + `.br` + `.gz` and a plain `assets/b.js`: `Accept-Encoding: gzip, deflate, br, zstd` → `Content-Encoding: br`, body = the `.br` bytes; `gzip` only → `gzip`; none → plain; **`Vary: Accept-Encoding` on every `/assets/*` answer**, `b.js` included; `Cache-Control: public, max-age=31536000, immutable` on `/assets/*`; `no-cache` on `/` and `/p/<token>` | temp dir |
| E2E | `FR-DICEX-52 compressed build output` (`e2e/static-compress.e2e.ts`, after `bun run e2e`'s build) | Every `.js` / `.css` ≥ 1 KB in `dist/client/assets/` has `.br` and `.gz` siblings that decompress to the same bytes; `dice3d` `.br` ≤ 140 KB; the e2e server answers the `dice3d` request with `content-encoding: br`, `vary`, `cache-control: …immutable` | build output |
| E2E (thin) | `dice-polish` dice flow | B composes 2d6+1d8 in the tray → `dicex-tray-preview` `data-mode` = `3d` (or `chips` without WebGL) with 3 `dicex-tray-die`; Roll → a MutationObserver recorder on C (installed before the roll) logs `dice-log-entry` `data-landed` `false` → `dicex-screen` `rest` → `data-landed` `true` with the total, in that order; C's popup `data-shown` = 3 | `dice-polish` |
| Integration | CON-44 | Existing tests unchanged and green (0 B added) | — |

**Sprint 5 walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load dice-polish --profile verify`; `start --profile verify`. Contexts **A** DM 1440×900, **B** `player-1` 1280×800, **C** `player-2` 1280×800; B and C WS frames and network logged from first load. Default display (Full screen). Game log, Character sheet / Initiative open on every context. **Timing steps (30–33, 37)** are judged from a recorder, not from screenshots (the 0.3–2.5 s windows are shorter than one MCP call): before the step, `browser_evaluate` installs a `MutationObserver` on `document.body` that appends `{t: performance.now(), testid, record id, data-landed, data-state, total text}` for every change to `dice-log-entry`, `dicex-tray-total`, `dicex-popup-row`, `dicex-screen`; after it, `browser_evaluate` returns the log and the report asserts order and times from it.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 28 | Log in | B, C open links | Network: `dice3d` and every JS / CSS **≥ 1 KB** answered with `content-encoding: br`, `vary: Accept-Encoding`, `cache-control: …immutable` (smaller files plain, still `vary` + `immutable`); `dice3d` transfer ≈ 132 KB. Reload B → `dice3d` from the browser cache (no transfer) |
| 29 | — | B: launcher Dice; palette d6, d6, d8; constant 1 | **Before rolling**, the tray shows 3D dice (two d6 showing 6, one d8 showing 8, Crimson metal) and "+1"; no "d6" text badge; drag Game log over the tray → the log covers the dice (tray's own canvas). Click a d6 → one d6 left; add it back |
| 30 | — | B: Roll (recorders on A, B, C) | Recorder per context: the entry's `data-landed="false"` with total "…" (log, tray) / "Rolling…" (popup) **before** `dicex-screen` `data-state="rest"`, then `data-landed="true"` with the number within 100 ms of rest. Screenshot after: popups **3 dice in one line at 44 px**, each row's total at its right, A's top-centre region (FR-SHELL-49), B / C bottom-right |
| 31 | — | B: tray `10d6`, Roll; then `20d6` | Every popup: 10d6 → 2 lines (6 + 4), dice not shrunk; 20d6 → 11 dice + "+9"; click "+9" → Game log fronted at the entry with all 20 chips |
| 32 | — | C: popup gear → Flat; B rolls `1d20`. C: Off; B rolls again (recorder on C) | C (Flat): `data-landed` true ≤ 350 ms after the entry appeared; C (Off): `data-landed` true in the same record as the entry's arrival. A, B unchanged |
| 33 | — | C: Full screen, Others' rolls off; B rolls `4d6` (recorder on C) | C: no `dicex-screen` motion; popup cells `data-mode="play"`; `data-landed` true only after the popup's dice rest |
| 34 | — | B: Physical dice on; Brakka's sheet → Flame Tongue **Attack + damage** | Form slots read "To hit — 1d20+8", "Slashing — 2d6+5", "Fire — 2d6" ([FR-DICE-41](dice-roll-log.md#6-functional-requirements)); type d20 = 20 → "Extra critical dice: 2d6 (slashing)" and "… (fire)"; Alt+click the same button → tray `adjust` groups labelled the same |
| 35 | — | B: Physical off; Mira's "Notation test" → "1d12 + 5" → Roll; then palette d6 | Tray header "Mira — Notation test", then after the palette click "Other", no label; Roll → line "Player 1 — 1d6 …" (no "Notation test"); "Roll again" on a notation result keeps the label |
| 36 | Start "Ambush at the Ford"; set Mira's HP to 0 | B: hover sheet death save; roll bar Roll | `dicex-stage-hint` once in each: A's Initiative row initiative tooltip, Attack ▸ trigger tooltip, open Check ▸ / Save ▸ submenus, Mira's death-save item on A's combat row; B's sheet death save and roll bar Roll tooltips. B: Alt+click roll bar Roll with `2d6` typed → tray `compose` 2d6. A: Roll monsters → no hint |
| 37 | — | B: roll `10d6`; reload B as soon as B's recorder shows `dicex-screen` `data-state="moving"` | After reload: the line once with its total shown at once (snapshot entry, `data-landed="true"` from the first record), no throw, no popup, no console errors |
| 38 | — | C: throttle (400 kbit/s, 400 ms) from a fresh load (cache disabled) | C's `dice3d` loads in ≈ 3 s on its own, ≈ 6 s inside a fresh page load that shares the link (was ≈ 13 s raw; D12 walkthrough ruling #274); B's next roll plays 3D on C (not flat) |
| 39 | Hard-kill + restart | — | No popup, throw or hold replays; assets still served `br`; logs unchanged |

### Sprint 6 (track WF): tray and popup room

Bundle **`session-sim-9`** (no new fixture; the tray and popups need no records). Walkthrough: [play-shell §13](play-shell.md#13-test-plan) F11 (tray at default and 300 × 240 with 2d6 + 1d8 + 1, then 12 d6: Roll visible and clickable without scrolling; sim-9 d01) and F5 (DM popup with a tool bar shown: popup never over the bar).

| Level | What | Fixtures |
|---|---|---|
| Unit (client, `tray-preview.test.tsx`, new `tray-layout.test.tsx`) | `FR-DICEX-53 tray Roll visible at min`: the tray at 360 × 300, 320 × 260 and 300 × 240 (min) in `compose` with 3 dice + constant, 12 dice, 20 dice (grouped), in `adjust` (a MOD-labelled attack), `rolling`, result: the bottom bar's box inside the window; the body not scrolling (`scrollHeight ≤ clientHeight`); the dice area ≥ one 28-px row (the 40 pinned by the build's measured heights, rulings-b #14); layout computed by a pure `trayLayout(bodyH, parts)` with measured part heights (the DOM test checks its CSS matches). `FR-DICEX-54 tray dice area fits`: pure `stillSize(n dice, terms, area w × h)` → 40 when two rows of 40 fit, 28 when only smaller fits, grouped "×N" when 28 doesn't, `data-scroll` when grouped still doesn't; fallback chips the same steps | In-code |
| Unit (`popups.test.ts`) | `FR-DICEX-55 popup clears the tool bar`: `dmStackAt` at 1440×900 with Initiative at x 600 and a hard region at the fog bar's rect → the shifted popup drops below the bar; no hard region → unchanged sprint-5 results (regression); under OQ-MAP-57 D / C the popup reports its rect, cleared on close | In-code |
| E2E | In play-shell's `window-fixes.e2e.ts`: `player-1` tray at 300 × 240 with 2d6 + 1d8 + 1 → `dicex-tray-roll` visible and the `elementFromPoint` hit | `session-sim-9` |
### Sprint 6 (track PF): Dice section in Preferences

Decided (#288): OQ-SHELL-47 A, so this applies. Bundle `prefs-s6` ([play-shell §13](play-shell.md#13-test-plan); e2e on `prefs-s6-e2e`, seams S12); no dice fixture needed (device settings are browser-only; looks default).

| Level | What | Fixtures |
|---|---|---|
| Client / DOM | `FR-DICEX-57 dice section` (both registries hold `dicex.dice` at order 30; the section renders the settings panel; no WebGL stub → 3D modes disabled with the reason; Dice look… opens the look pane in place; Save disabled while not live). `FR-DICEX-58 one store` (set Flat in the section → the tray gear's panel shows Flat in the same render; set "Roll popups" off in the gear → the section shows it off; one `pp.dicex.v2` entry written; no new key) | In-code |
| Walkthrough | [play-shell §13](play-shell.md#13-test-plan) P9 (Flat in Preferences = Flat in the tray gear), P10 (Dice look from Preferences), P14 (kept after reload) | `prefs-s6` |

### Sprint 8 (track TT): table tools

The one TT plan (macros, requests, pause, sounds); the other TT specs name their tests and point here.

| Unit (owner) | Contents | session-sim-12 |
|---|---|---|
| `dicex-macros` | `player-1`: Sneak Attack 3d6 damage on Mira, Luck 1d100. DM: Bless 1d4; Inspiration 1d8 on Thorn (seen by `player-2`); Ambush 2d6 on the Elite Goblin Warrior (DM only) | joins (S15) |
| `audio-chime` (ASSET) | "Chime": **generated** PCM WAV, 16-bit mono 22,050 Hz, 0.4 s = **17,684 B**, built by `fixtures/assets/audio/chime.ts` (no binary committed; `ingestStep` gains a bytes form) | joins |
| `camp-alert-sounds` (CAMP) | `request`, `pause` → Chime | joins |
| `dicex-request-open` | Perception to Mira + Thorn, DC 15 hidden, results hidden | no |
| `camp-paused` (CAMP) | "Pizza break, back soon", `town` image, 10 min | no |

- Bundles: `table-tools` = `session-sim-11` + the first four; `table-tools-paused` = + `camp-paused`; e2e aliases `-e2e`. Upload limit files (not fixtures): `e2e/support/audio.ts` writes `big.wav`, `long.wav`, `fake.mp3`.
- **Integration** (`table-tools`): `FR-DICEX-66 macro rights` (incl. the DM's rows read-only for players), `-65 macro follows the PC`, `-65 owner change closes targets` (open → `missed`, prompts resolved, new owner gets nothing), `-67 macro visibility`, `-74 request send`, `-75 request targets` (ownerless or hidden PC → `invalid`), `-77 DC never leaks`, `-78 answer` (sheet bonus, Bless part, physical, hidden audience = the target's player, custom without bonuses, repeat `conflict`), `-78 answer not rerollable` (`gem.spend` on an `answer` entry → `conflict`), `-79 decline`, `-80 close`, `-81 roll for missing` (hidden → current owner), `-82 lifecycle`, `-92 request leak scan` (real sockets, per player; incl. `roll-macro` rows); crash `PP_TEST_CRASH=dicex.answerRequest:before-commit` / `:after-commit`, `dicex.request`; `CON-44 table tools`. **Unit:** `FR-DICEX-64 macro schema`. **DOM:** `FR-DICEX-68 macro roll path`, `-69 tray macros`, `-70 save as macro`, `-71 macro editor`, `-83 prompt roll path`, `-84 hidden result surfaces`, `-86 requests window`, `-87 request card`, `-89 request sound`, `-90 request while paused`, `-91 prompt after reload`. **E2E** `table-tools.e2e.ts`: hidden Perception answered → total on the DM card only; pause blocks a token click, survives reload, Resume frees it.

**Walkthrough T** — `PP_TEST_MODE=1`; build; `fixtures:reset-load table-tools --profile verify`; `start --profile verify`. **A** DM 1440×900, **B** `player-1` 1280×720, **C** `player-2` 1280×800; B, C frames logged; AGENTS §9.6.

| # | Steps → expected |
|---|---|
| T1 | Tray → Macros on A, B, C → A all five; B Sneak Attack, Luck; C Inspiration only |
| T2 | B: Sneak Attack; physical 3, 4, 5; Alt+click → tray → Roll → popups everywhere, no damage card, "physical" 12 |
| T3 | B: tray `1d20+2` → Save as macro → ↑ → first under Mira; C unchanged |
| T4 | B, C connect to the open request → prompts without DC, silent; A: both Waiting |
| T5 | B: Roll → A: total ✓ / ✗; A, B PiP eye-off; C: nothing |
| T6 | C: reload → prompt back → Decline → A: Declined, card closed |
| T7 | A: DEX save, All PCs, DC shown, Public; B Shift+Roll; A Roll for missing → "· DC 15", `request:played`; B's roll pops up everywhere; closed |
| T8 | A: 1d100 to Mira, Hidden; B muted, Alt+Roll → tray (expression locked) → Roll → `request:muted`; C nothing |
| T9 | A: Pause (message, `town`, 5 min) → B, C card + countdown + Chime; clicks, drags, wheel, Tab, Escape, Space and arrow keys do nothing behind it |
| T10 | A (paused): request to Mira, public 1d20 → B: no sound, dice or popup |
| T11 | C offline 10 s; then a server restart → card right after each snapshot; A still "Paused" |
| T12 | A: Resume → cards gone; B: one `request` sound + the prompt; the 1d20 in the log |
| T13 | A: Campaign options → upload `big.wav`, `long.wav`, `fake.mp3` → three inline rejects; Chime for Turn; Test plays |
| T14 | A: Next to Mira's turn → B `turn:played`; muted → `turn:muted`, flash kept |
| T15 | Leak scan B, C (frames + REST): no `roll-request`, `audio-asset`, `success`, hidden DC, others' prompts or hidden answers, others' or DM-only `roll-macro` rows ("Ambush") |
| T16 | A at 1280×720: open Requests → at ≥ 360 × 400, no PC covered |
| T17 | A: Pause → Preview → the card in a non-blocking Dialog; Escape, then ✕ close it; A's windows stay usable |

### Sprint 9 (track FX): popups, macro editor

- **Unit `popups.test.ts`.** `FR-DICEX-94 popup never sticks`:
  - The hover flag is set, then the card unmounts without leave → the popup closes 6 s after rest.
  - **Opens under a resting pointer** (`:hover` true, no `pointermove` since it showed) → closes at 6 s after rest.
  - Pointer moved onto it after it showed and hovered at expiry → held; on leave → closes within 1 s.
  - Focus inside → held until blur.
- **DOM `roll-popup.test.tsx`.** The same, on a mounted card.
- **DOM `macros.test.tsx`.** `FR-DICEX-95 no error before typing`:
  - Save as macro with an expression preset → no "Name is required", Save disabled, focus in Name.
  - Type then clear the name → the error shows.
- Walkthrough: [dice-roll-log §13 FX2](dice-roll-log.md#13-test-plan) steps 7, 8.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [dice-roll-log](dice-roll-log.md) | Roll control (`useRollControl`, `RollButton`, `ManualForm`), roll bar, `roll` kind payload, entry visibility | complete; this spec edits its client folder (roll-control hotspot: D1 → R2, seams S3). No server code (R1 holds `evaluate.ts`) |
| [play-shell](play-shell.md) | `openWindow`, window registry, overlay layer mount for the throw zone, `useFreeArea` | complete; built as the tray's companion layer, no `PlayFrame.tsx` line (#214) |
| [live-sync](live-sync.md) | `useEventFrame` (live frames only), `live` state | built; D never touches `src/server/ws/`, protocol or the common store (V0, then `fix/lazy-records` only) |
| [character-sheet-full](character-sheet-full.md) | Text fields rendered through `DiceText`; `char.putRow` for the fixture | complete; sheet folder sequenced V5 → R3 → R6 → C2 → **D4** → P4 / C4 (seams S3, X2) |
| [effect-modifiers](effect-modifiers.md) | Tier 2 builds on FR-DICEX-08; MOD parts on `roll` payloads (FR-MOD-19) and `offered` trigger parts, both with per-die `dice` (R1, D9); `subject` on `RollControlOptions`, `previewMode` and `manualParts` on `RollRequest` (R14, seams S4) | revising (R, sprint 3) |
| New dependency | 3D rendering + physics, lazy chunk (OQ-DICEX-01) | **DM OK at gate 1** (#207, G1: `three` 0.186 + `cannon-es` 0.20; AGENTS §3) |
| *(Sprint 4)* [play-shell](play-shell.md) | Dice layer topmost in the layer order (FR-SHELL-01 row); the toast region takes a third stack (roll popups) | settled by seams S7 (layer row at merge; `toast-region.ts` in D7 after M4) |
| *(Sprint 4)* [notifications](notifications.md) | Roll popups share the toast region; notification and alert stacks keep their place; DM keep-out ([FR-NOTE-32](notifications.md#6-functional-requirements)) applies to popups | settled by seams S7 |
| *(Sprint 4)* track M (scenes-map / play-shell placement) | M4's auto placement keeps windows out of each client's toast region and ignores the dice layer | settled by seams S7; M4 before D7 |
| *(Sprint 4)* [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md) | Their rolls already write `roll` entries with the #190 public rules; nothing new needed. DM attack rolls stay DM-only for players | OQ-DICEX-31 (stays a DM question, seams S13; no combat change) |
| *(Sprint 4)* [character-sheet-full](character-sheet-full.md) | Sheet checks already go through `char.roll` → `roll` entries: popups and throws come free | no change |
| *(Sprint 4)* [dice-roll-log](dice-roll-log.md) | Die-shape chips in log lines, `focusLogEntry` ([FR-DICE-35–37](dice-roll-log.md#6-functional-requirements)) | this track (same owner) |
| *(Sprint 4)* New dependency | none (decided, #245 G1 / G2) | — |

**Sprint 3 (built; detail in this file's git history at the sprint-3 gate):** library comparison 2026-10-16 (four candidates; pick `three` + `cannon-es`, #207 G1); shared changes (windows.ts ×2, dice-roll-log client folder, `tray-extras.ts` registry, `dice_look` schema / event / record type, `package.json`; the throw zone shipped as the tray's companion layer, no `PlayFrame.tsx` line, #214); slices **D1** `build/dicex-tray` (#214), **D2** `fix/dicex-look-core` (#231), **D3** `build/dicex-3d` (#217), **D4** `fix/dicex-sheet-notation` (#238), all merged. Their walkthrough steps 1–13 stay in §13 as the zone regression.

**Sprint 4 library comparison** (#244, OQ-DICEX-28) — measured 2026-10-17: ours = `bun run build` (Vite) on `main`; others = `bun build --minify --target browser` of the package entry in a scratch dir outside the repo, gzip -9; npm / GitHub data the same day. "Shares ours" = uses our `three` + `cannon-es` instead of its own copy.

| Option | Min / **gzip** (measured) | Licence | Offline (no CDN / remote assets) | Look | Lands on given results | React 19 / Vite / lazy | Maintenance |
|---|---|---|---|---|---|---|---|
| **A. Ours: `three` 0.186 + `cannon-es` 0.20, hand-rolled** | 629.6 KB / **161.3 KB** (lazy `dice3d` chunk, built) | MIT / MIT | yes; no assets (CanvasTexture faces) | our meshes, 8 styles × colours × 4 materials, per-owner looks (#207) | **yes**: headless sim + relabel, tested for every die × target (D3) | built and lazy today; framework-free | three monthly (0.186.1, 2026-09-24); cannon-es 0.20.0 (2022-08), repo idle since 2024-01, only in the headless precompute, swappable |
| B. `@drdreo/dice-box-threejs` 1.1.0 (fork of `@3d-dice/dice-box-threejs`) | 618.4 KB / **159.6 KB** (vendors its own three + cannon-es; doesn't share ours) | MIT | yes with textures / sounds off (1.7 MB textures, 0.7 MB sounds to copy into `dist` if wanted) | colour sets, textures, materials built in | yes (`"6d6@4,4,4,4,4,4"`) | class API, dynamic import OK; peer `three` ^0.176 (ours 0.186: out of range) | 1 maintainer, 4 stars, last release 2025-05 (17 months) |
| C. `@3d-dice/dice-box-threejs` 0.0.12 | 549.9 KB / **144.5 KB** (vendors three r143) | MIT | as B | as B | yes (`@` notation) | as B | idle since 2022-10 (repo 2023-11), 0.0.x |
| D. `@3d-dice/dice-box` 1.1.4 (Babylon + Ammo) | 2,724.7 KB / **708.8 KB** + required assets ≈ 283 KB gz (`ammo.wasm`, theme; sprint-3 figure) | MIT | assets must be copied and served from `assetPath` | best stock themes | **no** (physics decides) | needs asset copy step in Vite | 252 stars; last release 2024-08, repo 2024-10 |
| E. `@planarally/dice` 0.8.0 (Babylon 8 + Havok) | 5,678.6 KB / **1,275.8 KB** + Havok wasm 2,095 KB (658 KB gz) | MIT | wasm served locally | Babylon PBR | no (returns physics results) | heavy; Babylon in our stack twice over | active (PlanarAlly VTT, 559 stars; release 2025-08) |
| F. `react-ttrpg-dice` 0.4.0 (R3F 9 + Rapier) | 3,352.1 KB / **1,139.6 KB** | MIT | yes (wasm inlined) | stock | yes (`predeterminedValues`) | React 19 OK | first release 2026-04, 0 stars |
| G. `@diegesis/dice` 0.2.1 (three + cannon-es in a worker) | +198.8 KB / **+58.2 KB** on top of shared three + cannon-es (291.2 KB gz whole) | MIT | textures / sounds from `assetPath` | themes, textures | yes ("you pass results in") | framework-free; peer `three` ^0.182 (out of range) | first release 2026-09-28, 4 versions, 0 stars |
| H. `@lambersond/3d-dice-core` 0.4.0 (vendored dice-box-threejs fork) | 713.4 KB / **186.4 KB** (pulls its own `three` ^0.184) | MIT on npm; repo has no licence file | asset copy for textures | as B | yes | framework-free | first release 2026-06, 0 stars |
| ~~I. `dddice-js`~~ | — | MIT SDK | **no**: a hosted service (API key, rolls on their server) | — | — | — | rejected: not offline, results not ours |

- **Decided: A** (OQ-DICEX-28; DM, sprint-4 gate 1, #245 G1): full screen, the popup PiP and die-shape chips are presentation work (arena, camera, one canvas, SVG); no candidate does them for us. A keeps the tested settle-to-result, per-owner looks and the 161 KB lazy chunk, and adds **no dependency** (no DM OK needed, [ADR-0044](../architecture/adr/0044-3d-dice.md) library row unchanged). B is the only like-for-like alternative (same size, results built in, stock themes) but a 1-person fork, 17 months idle, with its own `three` copy and a rewrite of D3. D–F cost 4–8× the bytes on the players' tunnel. G and H are too young to bet on.
- [ADR-0044](../architecture/adr/0044-3d-dice.md) is amended for **where** dice draw (topmost full screen, not "never over a window") and the popup by the dice-display ADR, accepted at the gate (#245 G4): [ADR-0048](../architecture/adr/0048-dice-display.md) (the integrator numbers it).

**Sprint 4 shared changes** (AGENTS §9.9): **no** schema, event, protocol, ws, record type, registry, `package.json` or fixture-registry line except the bundle.
- `src/client/common/features/play-shell/{toast-region.ts, ShellToaster.tsx}` (play-shell frame, shared): the region takes the roll-popup stack's height as a third stack (players: above the notification + alert stacks; DM: below them). Order **M4 `fix/window-placement` → D7** (seams S7): M4 holds the play-shell frame first and keeps auto-placed windows out of the toast region.
- Dice layer: portalled to `document.body` from the dice-extras runtime (no `PlayFrame.tsx` line). play-shell's layer order (FR-SHELL-01) gains the row at merge (doc, integrator; seams S7).
- `src/client/common/features/dice-roll-log/` + `src/shared/dice-roll-log/{kind-types.ts, roll-kind.ts}`: D owns (dice display hotspot). `kinds.ts` unchanged. R's Divine Fury log line [15] (R S4-5 `fix/fury-log-line`) goes **after** D5 and emits its parts through D5's per-die segments (seams S8).
- `fixtures/bundles/index.ts` + `fixtures/bundles/dice-display.ts` (append-only line).
- Docs at merge: play-shell layer row, protocol §26 roll-control / log-segment row, glossary (OQ-DICEX-32), ADR (ADR-0048).

**Sprint 4 build split** (no schema slot: D's place in V → R → D → M → C is empty unless OQ-DICEX-22 B)

| # | Branch | Content | Shared files | After |
|---|---|---|---|---|
| D5 | `build/dice-shapes` | `DieShape` (FR-DICEX-42) replacing `FlatDie` squares in tray / flat / zone; log `die` segment type incl. `offered` + base-dice chips + faces from expression (FR-DICE-35, -36); `focusLogEntry` (FR-DICE-37); bundle `dice-display`. **Not** MOD / offered chips in the log: R S4-5 owns `@shared/effect-modifiers/{line,combat-parts}.ts` (ruling B9) | `fixtures/bundles/index.ts` (append) | wave 1, lock-free; **R S4-5 `fix/fury-log-line` waits for it** (seams S8) |
| D6 | `build/dice-screen` | Dice layer (portal, topmost), screen arena + headless tests in viewport arenas (FR-DICEX-33, -34), timing (-35), settings v2 + migration (-36), idle preload (-37, sim-7), DM-only rule (-38), others / slow / reduced motion (-43–45), zone on the one canvas (sprint-3 zone canvas retired) + caption rule (-17), seed from first public entry (-15) | none (no `PlayFrame.tsx`: the zone never had a line, B27) | wave 2, after D5 (same folder) |
| D7 | `build/roll-popup` | Popup stack, content, coalesced named rows (FR-DICEX-39, -40, sim-7), PiP hand-off / miniature / chips with scissor clip, still capture and mixed DM frames (-38, -41), popup gear, pending in the popup (-09), lazy `RollPopup` chunk + its size cap in `bundle-size.test.ts`; takes over M4's keep-out constants in `toast-region.ts` (A11: grows them, never edits placement; browser check at 1280 × 800 with a popup showing) | `toast-region.ts`, `ShellToaster.tsx` (toast-region lock) | wave 3, after D6 and **M4** `fix/window-placement` (seams S7) |

Walkthrough steps per slice: D5 → 14, 22; D6 → 15–18, 21, 23, 25, 27 (big dice; DM-only rolls show nothing big and wait for D7's popup); D7 → 15–21 popups, 24, 26; regression 1–13 on the zone option after D7.

**Sprint 5 dependencies**

| On | What we need | Status |
|---|---|---|
| New dependency | **none** (OQ-DICEX-40 decided #256). Compression is built in: Hono 4.13.13 `serveStatic({ precompressed: true })` (`br` / `zstd` / `gz` siblings, `Content-Encoding`, `Vary`; checked in its source and by probe) and `node:zlib` in Bun 1.3 (`brotliCompressSync`, `gzipSync`). Rejected candidates (npm, 2026-10-18; dev-only, would need the DM's OK): `vite-plugin-compression2` 2.5.3 (MIT, 51 KB unpacked, deps `tar-mini`, `@rollup/pluginutils`; last release 2026-03) and `vite-plugin-compression` 0.5.1 (MIT, 15 KB, deps `chalk`, `debug`, `fs-extra`; idle since 2022-01): both make the same `node:zlib` calls our ~20-line inline plugin makes. On-the-fly: Hono's own `compress()` (gzip / deflate via `CompressionStream`, no brotli) needs no package either | — |
| [play-shell](play-shell.md) (W) | W1 sets `toast-region.ts` popup constants to 320 × 190 (FR-DICEX-47) and sizes both toast regions for them | settled by seams S2 |
| [dice-roll-log](dice-roll-log.md) | Log line hold (FR-DICE-40), slot labels (FR-DICE-41); same owner | this track |
| [character-sheet-full](character-sheet-full.md), [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md) | Their roll buttons pass tooltip text through `RollButton` (`hint`, FR-DICEX-51); sheet and DM attack callers pass `slotLabels` ([FR-DICE-41](dice-roll-log.md#6-functional-requirements)) | settled by seams S8 (OQ-DICEX-44; [OQ-DICE-31](dice-roll-log.md#15-open-questions)) |
| [combat-tracker](combat-tracker.md) (R) | Cards, apply popup and Initiative values aren't held by the landing (OQ-DICEX-39 A, #256), so R1's late fill isn't delayed. R2's log formatters (`@shared/combat-tracker/log-kinds.ts`, `@shared/effect-modifiers/{line,combat-parts}.ts`) are R's; D never edits them | OQ-DICEX-39 decided (#256); order settled by seams S7 |
| [notifications](notifications.md) | Notification toasts keep their place beside the taller popup stack (W's toast regions; DM top-centre kept, OQ-SHELL-32 C, #256) | settled by seams S2, S3 |

**Sprint 5 shared changes** (AGENTS §9.9): no schema, event, protocol, WS, record type or registry line.
- `src/server/app.ts` (server core): `serveStatic({ root, precompressed: true, onFound })` for `/assets/*` + `Cache-Control` + `Vary` on every answer; HTML routes `no-cache` (FR-DICEX-52, §6.1 table H).
- `vite.config.ts` (tooling): a small inline plugin (`writeBundle`, `node:zlib`) writing `.br` / `.gz` siblings; no `package.json` change (`build` stays `vite build`).
- ~~`src/client/common/features/play-shell/toast-region.ts`~~ *(seams S2: W1 sets `ROLL_POPUP_W` 320, `ROLL_POPUP_H` 190 from FR-DICEX-47; D edits no `toast-region.ts` line.)*
- `src/client/common/features/dice-roll-log/GameLog.tsx` order (seams S15): **W1** (log width) → **D8** (held lines) → **D9** (roll bar Alt stage + hint) → **K4** (name colour) (review ruling #20, seams S15 amended); R2 never edits it. Roll popup actor name stays plain in D11; the name colour is decided (K's OQ-DICE-40 A, #256): **K4** adds the `colorOf` line in `RollPopup.tsx` after D11 merges (seams S15).
- Popup position code is **W1's** by name (review ruling #14): `dmStackAt` and the stack's anchoring in `src/client/common/features/dice-extras/{popup-logic.ts, RollPopup.tsx}` (position only); D11 keeps to the popup's internals.
- `fixtures/bundles/index.ts` + `fixtures/bundles/dice-polish.ts` (append-only line).
- Other features' files (not §9.9, but owned elsewhere; orchestrator assigns): tooltip lines in `src/client/common/features/character-sheet/{CharacterSheet.tsx, rolls.tsx}`, `src/client/common/features/combat-extras/{concentration.tsx, sheet-sections.tsx}`, `src/client/dm/features/combat-extras/row.tsx`, `src/client/dm/features/combat-tracker/initiative-window.tsx`; `slotLabels` in `rolls.tsx` and `src/client/dm/features/combat-tracker/attack-choices.ts`.
- Feature-owned: `src/client/common/features/dice-extras/` (tray, popup internals, `holding` store, `DieShape` `lg`, tray still renderer in `dice3d/`), `src/client/common/features/dice-roll-log/{GameLog.tsx, roll-control.tsx, logic.ts}`.
- Docs at merge: proposed ADRs [ADR-0051](../architecture/adr/0051-dice-landing-line.md) (dice: amends ADR-0044 Truth, ADR-0048 Truth and Popup: dice) and [ADR-0052](../architecture/adr/0052-static-serving.md) (built client: compression + caching), protocol §26 roll-control row (`slotLabels`, `hint`), glossary (settled S12).

**Sprint 5 build split** (no schema slot)

| # | Branch | Content | Shared files | After / parallel |
|---|---|---|---|---|
| D8 | `build/dice-landing` | `holding` map + `useLanded` (FR-DICEX-49); held tray result and popup chips; log line hold (FR-DICE-40, `GameLog.tsx` line render); label reset rule + tests (FR-DICEX-50); bundle `dice-polish` | `fixtures/bundles/index.ts` (append) | wave 1, no schema: starts at once in Phase B (seams S1); ∥ D11, D12. Merges **after W1** (rebase for `GameLog.tsx`, S15). **R2 (log formatters) merges after D8** and after R1 (seams S7); `GameLog.tsx`: W1 → D8 → D9 → K4 (ruling #20) |
| D11 | `build/popup-line` | Popup line layout, cells, "+N", hand-off to cells, miniature into cells, `DieShape` `lg` (FR-DICEX-46); per-row totals and pixel budget (FR-DICEX-47; W1 sets the size constants and owns `dmStackAt`); actor name plain (K4 then colours it: OQ-DICE-40 A, #256; S15); browser check at 1280×720 and 1280×800 with 3 popups + a toast: only those that fit, none above the top bar | none (popup internals only, seams S2) | starts **after W1 merges** (S2) and **stacks on D8** (`--base build/dice-landing`) or waits for it: both touch `RollPopup.tsx` / `dicex-popup-total` (ruling #20); ∥ D12 |
| D12 | `fix/static-compress` | Precompressed build output + `serveStatic` precompressed + cache headers (FR-DICEX-52); integration + build checks | `src/server/app.ts`, `vite.config.ts` (D12 holds both, seams S11) | no schema: starts at once in Phase B (S1); ∥ every slice; any other `app.ts` line (e.g. P0's upload route, if it needs one) goes after D12 by rebase (S11) |
| D10 | `build/dice-tray-3d` | Tray preview stills via a temporary arena copied into the tray's 2D canvas in one task (not `addStillArena`), DOM mirrors, grouping, fallback chips (FR-DICEX-48) | none | wave 2, after D8 (both touch `TrayWindow.tsx`; may stack on D8) |
| D9 | `fix/dice-roll-buttons` | `RollButton` `hint` + Alt hint on every surface, roll bar Alt stage (FR-DICEX-51); `slotLabels` in `ManualForm` and tray `adjust` groups (FR-DICE-41) | none in §9.9; other features' caller files (list above) | wave 3, after D10 (`TrayWindow.tsx`) and D8 (`GameLog.tsx`; before K4, ruling #20); **the last slice on its caller files** (seams S8): after **W4** (combat-extras `row.tsx` / `parts.tsx`), **R1** and **R4** (`initiative-window.tsx`) |

Walkthrough steps per slice: D8 → 30, 32, 33, 35, 37; D11 → 30, 31, 33; D12 → 28, 38, 39; D10 → 29; D9 → 34, 36. Regression: sprint-4 steps 14–27 after D11.

**Sprint 6 build split** (track WF; full split [play-shell §14](play-shell.md#14-dependencies); no schema, no shared file)

| # | Branch | Content | Files | After / parallel |
|---|---|---|---|---|
| WF5 | `fix/tray-roll-visible` | FR-DICEX-53, -54 | `TrayWindow.tsx` (body grid: fixed parts + one flexible dice area), `TrayPreview.tsx` (still size 40 / 28, room-forced "×N", own scroll, attrs), tests | starts at once; ∥ every WF slice. *(Settled by seams S9)* **PF2 `build/colour-picker-2` merges after WF5** if it touches `TrayWindow.tsx` (the gear shortcut, OQ-DICEX-48 A); `SettingsPanel.tsx` is PF's |
| WF3 (assigned lines) | `fix/fit-s6` | FR-DICEX-55 | `popup-logic.ts` (`dmStackAt` callers pass hard regions), `RollPopup.tsx` (one `reportShownStack` line under OQ-MAP-57 D / C) | with WF3 (S9: stays there), after WF1 only under OQ-MAP-57 D / C (the `reportShownStack` export) |

- No new dependency; no record, event or frame (0 B). Docs at consolidation: protocol §18 / the popup row (hard keep-outs in the DM stack).

**Sprint 8 build split** (track TT; seams S2, S3, S7, S9; **no new dependency**: Web Audio on the existing context, a hand-rolled audio probe, OQ-ASSET-29)

| # | Branch | Content | Shared files (§9.9) | Order |
|---|---|---|---|---|
| TT0 | `fix/tt-core` | Tables `roll_macro`, `roll_request`; columns `asset.kind`, `asset.duration_ms`, `campaign.pause`, `campaign.alert_sounds`; record types `roll-macro`, `roll-request`, `audio-asset` (lazy); 9 events; zod; kind `roll-request` def; `gameLog.append` `audience`; `assets.require` kind; `con44-tt.test.ts`; docs | `db/schema.ts`, `shared/events/`, `shared/protocol/`, `server/features/index.ts`, `notifications/kinds.ts` (append), `docs/data-model/`, `docs/protocol/` | wave 1, **merges first** (CB0 after) |
| TT1+TT2 | `build/tt-dice` (one builder) | Macros: commands, entities hook line, tray popover + Save as macro (`TrayWindow.tsx`), editor, sheet tab. Requests: commands, `sheetRoll` (CHAR server file, assigned), prompt view, `dicex.requests` window, roll-bar "Request…" (`GameLog.tsx`), `restoreToast`; fixtures `dicex-macros`, `dicex-request-open`; e2e | `sheet-sections.ts`, entities hooks, both `notification-views.ts`, `dm/windows.ts` + size-table row (after WF1), `fixtures/bundles/index.ts` (appends); `ToastRuntime.tsx` **after WF4** | wave 2, after TT0 + WF1; the toast part after WF4; its `request` sound line after TT3 |
| TT3 | `build/tt-sounds` | Audio probe / serve / lazy type; `camp.setAlertSound`; Campaign options section; shell playback; the `turn-alert.ts` line (S9); fixtures `audio-chime`, `camp-alert-sounds` | `play-shell/{sounds,audio,alerts}.ts`, `AlertLayer.tsx` (lock); `combat-tracker/turn-alert.ts` (assigned line) | wave 2, after TT0 |
| TT4 | `build/tt-pause` | `camp.pause` / `camp.resume`; the card; the DM control; suppression; fixture `camp-paused`; e2e | `play-shell/overlays.ts`, `play-shell/top-bar-items.ts` (append, S2); no `PlayFrame.tsx` line | wave 3, **after WF1 + TT3** |

- *(Sprint 9)* **FX2** `fix/fx-dice-lines` (FR-DICEX-94–95, FR-DICE-93's chip): `DieShape.tsx`, `popups.ts`, `RollPopup.tsx`, `MacrosPanel.tsx`, `macro-logic.ts` and their tests. Shared: none. Split: [dice-roll-log §14](dice-roll-log.md#14-dependencies).
- Walkthrough per slice: TT1+TT2 → T1–T8, T15, T16; TT3 → T13, T14 (+ T7's sound); TT4 → T9–T12, T17. TT1+TT2 also adds the `answer` refusal to `gem.spend` (gems' server file, assigned line) and the entities hook's target closing.

## 15. Open questions

Rows 01–17 decided. Rows 01–12: DM at sprint-3 gate 1 ([#207](../decisions-log.md), 2026-10-16; gate rows G1, G16–G18 + bulk-accept D); the decided option is in bold, rejected ones are kept for the record. Rows 13–17 were settled by the seams ruling (2026-10-16; 17 = terms the integrator adds after the gate). **Rows 18–32: sprint 4, all decided** (DM, sprint-4 gate 1, [#245](../decisions-log.md), 2026-10-17: gate rows G1, G4, G7, G21–G27 + bulk-accept D); 29 and 30 settled by the seams ruling (S7); 32 is the integrator's glossary row. Full screen as default, popup for every public roll, die-shape chips and log dice were DM decisions already (#243 [10–12, 17]).

| ID | Question | Answer | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICEX-01 | 3D library (new dependency, lazy chunk; sizes measured, §14) | **Decided (#207, G1): C hand-rolled `three` 0.186 + `cannon-es` 0.20, 159 KB gz, MIT, no assets** (three maintained; cannon-es idle since 2022-08 but only in the swappable headless precompute; testable relabel; most build work). Rejected: B `dice-box-threejs`, 144 KB gz (forced results + colour sets built in; 4 years idle, vendors three r143); A `dice-box`, 700 KB gz + 283 KB assets (no forced results); D R3F 8 + rapier, 1,025 KB gz (old lines only on React 18) | no (decided) | ADR-0001, [ADR-0044](../architecture/adr/0044-3d-dice.md), D3 |
| OQ-DICEX-02 | Where do dice land? | **Decided (#207, G16): B throw zone over the free area, tray for composing** (every roll visible, no window opened, never over a window; covers map for ~3 s). Rejected: A tray window only (others' rolls animate only while your tray is open); C on the map canvas in world space (after V's canvas slices; touches `MapCanvas`) | no (decided) | play-shell, scenes-map |
| OQ-DICEX-03 | Who sees a throw? | **Decided (#207, bulk D): A everyone who received the entry, per-device "others" toggle** (hidden rolls safe by construction). Rejected: B roller only; C roller 3D, others flat | no (decided) | — |
| OQ-DICEX-04 | Does the log line wait for the dice? | **Decided (#207, bulk D): A no: line at once, dice settle ≤ 2.5 s later**. Rejected: B this client holds the line's total until its throw rests (a second, client-only delay rule). *(Amended sprint 5, #251 track D / sim-8 glitch 8: the line still comes at once, its numbers wait for the landing, FR-DICEX-49; how that reads without animation: OQ-DICEX-38)* | no (decided) | dice-roll-log |
| OQ-DICEX-05 | Customisation scope | **Decided (#207, G17): B named style + colours + material** (2,157 B measured). Rejected: A colours only; C B + per-category looks (≈ 7,500 B; more UI) | no (decided) | — |
| OQ-DICEX-06 | Where looks live, who sees whose | **Decided (#207, G17): A server `dice-look`, everyone sees the roller's look** (+2,158 B heavy DM; schema slot D2, last). Rejected: B browser-local, only you see your look; C server, but each viewer draws all dice in their own look | no (decided) | CON-44, schema order |
| OQ-DICEX-07 | Physical dice with the tray | **Decided (#207, bulk D): A stays: same `ManualForm` in the popover (buttons) and the tray (staged), flat dice in the throw**. Rejected: B tray only (every physical roll opens a window); C drop it (breaks #43) | no (decided) | dice-roll-log |
| OQ-DICEX-08 | Roll buttons and the tray | **Decided (#207, G18): A roll at once; Alt+click stages** (no extra click in combat). Rejected: B every button stages; C per-device setting | no (decided) | dice-roll-log, CHARX, CBT |
| OQ-DICEX-09 | Where notation is clickable | **Decided (#207, bulk D): B sheet text now + every sprint-3 free-text surface through `DiceText` (handouts, compendium; one parser)**. Rejected: A sheet text only; C also log lines, labels, loot text | no (decided) | P, C, party-loot |
| OQ-DICEX-10 | Motion settings | **Decided (#207, bulk D): A per device: 3D / flat / off, reduced motion → flat, auto-flat when slow**. Rejected: B one campaign setting by the DM; C none | no (decided) | — |
| OQ-DICEX-11 | Dice sound | **Decided (#207, bulk D): A none** (ADR-0007). Rejected: B a short clatter as a UI sound | no (decided) | ADR-0007 |
| OQ-DICEX-12 | Max 3D dice per throw | **Decided (#207, bulk D): B 20, rest as chips**; fps judged by the DM on the table laptop at the sprint gate (headless runs only log it). Rejected: A 10; C all 50 | no (decided) | — |
| OQ-DICEX-13 | effect-modifiers (R): tier 2 on the tray | **Settled by seams S4:** R2 (`fix/mod-roll-preview`) builds on FR-DICEX-08 after D1; extra groups via `tray-extras.ts`, physical boxes via `ManualForm` → `manualParts`, adv / dis preview = two d20s (D renders, R supplies the mode); offered trigger parts ride on the damage `roll` entry as `offered` items with per-die `dice`, outside `total` (R1, D9), and are thrown as labelled dice | no | [effect-modifiers](effect-modifiers.md) |
| OQ-DICEX-14 | party-board (P): handout text | **Settled by seams S7:** handout bodies through `DiceText` once D1 is on `main` (plain text until then); context is P's | no | [party-board](post-mvp/party-board.md) |
| OQ-DICEX-15 | compendium (C): descriptions | **Settled by seams S7:** C's markdown-lite component wraps text runs in `DiceText` once D1 is on `main`; context (actor) is C's | no | [compendium](post-mvp/compendium.md) |
| OQ-DICEX-16 | play-shell: throw layer | **Settled by seams S3:** one mount line in `PlayFrame.tsx` (overlay layer, inside the free area), assigned to D1 by sequencing; DOM / WebGL, no Konva layer | no | [play-shell](play-shell.md) |
| OQ-DICEX-17 | Glossary | **Settled by seams S9 (integrator adds after the gate):** Dice tray (window to compose / adjust a roll), Throw (the animation of one received `roll` entry), Dice look (an owner's dice appearance: style, colours, material), Dice style (a named starting look: Ivory, Obsidian, …; not "preset", which is MOD's), Notation link | no | glossary |
| OQ-DICEX-18 | How long do the dice bounce? | **Decided** (DM, sprint-4 gate 1, #245, bulk D): settle ≤ 2.5 s, rest 1 s, fly to the popup 0.4 s (≤ 3.9 s on screen). Rejected: settle ≤ 4 s; ≤ 1.5 s | no (decided) | FR-DICEX-35 |
| OQ-DICEX-19 | Does every roll animate full screen? | **Decided** (DM, sprint-4 gate 1, #245, G21): every public roll; one frame = one throw (8 initiatives = one throw of 8 d20s); ≤ 20 3D dice, the rest as chips. Rejected: d20 rolls only; cap 10 | no (decided) | FR-DICEX-14, -32 |
| OQ-DICEX-20 | DM hidden / DM-only rolls | **Decided** (DM, sprint-4 gate 1, #245, G22): only in the DM's popup, never full screen. Rejected: full screen for the DM too; chips only | no (decided) | FR-DICEX-38 |
| OQ-DICEX-21 | Private player rolls ([11] "unless private") | **Decided** (DM, sprint-4 gate 1, #245, G23): not this sprint; player rolls stay public (#73), whispers stay tier C. Rejected: a player "DM only" toggle; blind rolls | no (decided) | [dice-roll-log](dice-roll-log.md) |
| OQ-DICEX-22 | Where do display / reduced-motion settings live? | **Decided** (DM, sprint-4 gate 1, #245, G26): per device (browser); ~~OS reduced motion → flat~~ *(amended by #247: the OS reduced-motion preference is ignored, like Owlbear)*. Rejected: per player server-stored; one campaign setting | no (decided) | FR-DICEX-36 |
| OQ-DICEX-23 | Who gets a popup? | **Decided** (DM, sprint-4 gate 1, #245, G24): everyone who received the roll, the roller too. Rejected: others only | no (decided) | FR-DICEX-39 |
| OQ-DICEX-24 | Popup placement, stacking, duration | **Decided** (DM, sprint-4 gate 1, #245, G24): each client's toast region (players bottom-right; DM top-centre, clear of Initiative), a third stack, ≤ 3 popups, 6 s after the dice rest, hover pauses. Rejected: DM bottom-right too; one slot | no (decided) | FR-DICEX-39; notifications, play-shell |
| OQ-DICEX-25 | What does the popup show? | **Decided** (DM, sprint-4 gate 1, #245, bulk D): actor name, label, the dice, total + adv / natural / physical markers. Rejected: + full line text; name + total only | no (decided) | FR-DICEX-40 |
| OQ-DICEX-26 | How does the popup show "the same animated dice"? | **Decided** (DM, sprint-4 gate 1, #245, G25): one canvas; the big dice land, fly into the popup and stay as a still; the popup plays the throw itself when the big one didn't run. Rejected: a second live replay; chips only. Cut order if late (G7): the popup miniature goes last (popup keeps chips) | no (decided) | FR-DICEX-41 |
| OQ-DICEX-27 | What plays on a slow phone over the tunnel? | **Decided** (DM, sprint-4 gate 1, #245, G26): same default everywhere; 3D preloaded at idle, a late chunk → that throw flat; auto-flat when slow; the popup never needs 3D. Rejected: phones popup-only; phones flat | no (decided) | FR-DICEX-37, -44 |
| OQ-DICEX-28 | Dice library (#244) | **Decided** (DM, sprint-4 gate 1, #245, G1, G2): keep `three` + `cannon-es` hand-rolled; no new dependency. Rejected: `@drdreo/dice-box-threejs`; `@3d-dice/dice-box` (table §14) | no (decided) | [ADR-0044](../architecture/adr/0044-3d-dice.md) |
| ~~OQ-DICEX-29~~ | ~~play-shell: dice layer and layer order~~ | **Settled by seams S7:** A: dice layer topmost, portalled to `body`, no input, no `PlayFrame.tsx` line; M's windows and auto placement stay below it and ignore it; FR-SHELL-01's order gains the row at merge (integrator). Rejected: B below dialogs (needs a `PlayFrame.tsx` slot) | — | [play-shell](play-shell.md) |
| ~~OQ-DICEX-30~~ | ~~notifications / play-shell: popups in the toast region~~ | **Settled by seams S7:** A: a third stack in `toast-region.ts` / `ShellToaster.tsx`; notification and alert stacks keep their place; order **M4 `fix/window-placement` → D7 `build/roll-popup`**; M4's auto placement keeps windows out of each client's toast region (players bottom-right, DM top-centre), so D7 adds its stack without moving windows. Rejected: B sonner custom toasts | — | [notifications](notifications.md), [play-shell](play-shell.md), track M |
| OQ-DICEX-31 | combat-tracker: should players see dice for DM attack rolls? | **Decided** (DM, sprint-4 gate 1, #245, G27): no change; DM attack rolls stay DM-only ([FR-CBT-52](combat-tracker.md#6-functional-requirements), #171); players read the outcome line at apply. Rejected: a popup for public outcome lines; follow the Attack tickbox | no (decided) | [combat-tracker](combat-tracker.md) |
| OQ-DICEX-32 | Glossary | **Settled; owner: the integrator at merge** (after D5–D7 specs merge): add **Dice layer** (the full-screen, topmost canvas the dice fly on), **Roll popup** (the card in the toast region that shows a received roll with its dice), **Die shape** (a die drawn flat as its outline with the value). "Throw" gains "on the dice layer, in the zone or in a popup" | no · **Glossary: applied (#246)** | glossary |

**Sprint 5 rows: 33–41 and 45 decided by the DM at sprint-5 gate 1 ([#256](../decisions-log.md), every pick accepted); 42–44 settled by the seams ruling (S2, S12, S8).** The behaviours themselves are DM decisions (#250 [2, 3], #251: line at full size, 3D in the tray, totals wait, BL-15/18/20/21/22); these rows frame the details. Pick in bold. 

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICEX-33 | Popup line with many dice (10d6, 20d6)? | **Decided (#256): A. Wrap to 2 lines (≤ 12 dice), then 11 + "+N"** (10d6 all visible; popup ≤ 190 px; a 20d6 hides 9 behind "+9", click → log with all chips). Rejected: ~~B. One line only (≤ 6), then 5 + "+N"~~; ~~C. Wrap every die, ≤ 4 lines~~ | no (decided) | FR-DICEX-46, -47; play-shell (W) |
| OQ-DICEX-34 | What is "full size" in the popup? | **Decided (#256): A. A fixed 44 px cell** (≈ a laptop screen die: 50 px at 1280×720, 63 px at 1440×900; one popup width everywhere). Rejected: ~~B. The size the die had on screen (7 %, 40–96 px)~~; ~~C. 36 px~~ | no (decided) | FR-DICEX-46 |
| OQ-DICEX-35 | Tray compose 3D: live spin or static? | **Decided (#256): A. Static stills, highest face up** (one draw per change, no loop, nothing on a phone's battery). Rejected: ~~B. Static + a 0.5 s spin when a die is added~~; ~~C. Continuous slow spin~~ | no (decided) | FR-DICEX-48 |
| OQ-DICEX-36 | How many tray dice before they group? | **Decided (#256): A. ≤ 12 one by one (two rows in the default tray), then one die per term "×N"**. Rejected: ~~B. ≤ 20 one by one~~; ~~C. Always one die per term "×N"~~ | no (decided) | FR-DICEX-48 |
| OQ-DICEX-37 | Tray 3D on phones? | **Decided (#256): A. Same rules everywhere** (stills are one draw per change; auto-flat and the 1.5 pixel-ratio cap still apply). Rejected: ~~B. Coarse pointer + short side < 600 px → chips in the tray~~ | no (decided) | FR-DICEX-48, -44 |
| OQ-DICEX-38 | What does "waits for the dice" mean when nothing animates (Flat, Off, others off, hidden tab)? Reduced motion is ignored (#247) | **Decided (#256): A. Each client shows the numbers when its own presentation rests**: Flat after the 0.3 s chip fade, Off at once, others off at the PiP miniature's rest, hidden tab at once (a Flat viewer may read a total ~2 s before a Full-screen one). Rejected: ~~B. Every client holds ~2.5 s even without animation~~; ~~C. Hold only where 3D plays~~ | no (decided) | FR-DICEX-49, FR-DICE-40 |
| OQ-DICEX-39 | combat-tracker / combat-extras: do numbers outside the dice surfaces wait too (Initiative order, HP after Roll monsters, the DM's card toast and apply popup values, R's late damage fill)? | **Decided (#256): A. No: only the tray, popup and log hold** (the DM acts at once; a player's initiative order may move before their die lands). Rejected: ~~B. Hold combat cards and the apply popup too~~; ~~C. Hold Initiative order too~~ | no (decided) | [combat-tracker](combat-tracker.md), [combat-extras](combat-extras.md) (R) |
| OQ-DICEX-40 | How to compress the built client (BL-21)? | **Decided (#256): A. Precompressed at build (`.br` + `.gz`) + `serveStatic({ precompressed: true })`** (brotli 132 KB for `dice3d`; 0 ms per request; build +2.8 s). Rejected: ~~B. Hono `compress()` on the fly (gzip only, 163 KB)~~; ~~C. Both~~ | no (decided) | server core, tooling |
| OQ-DICEX-41 | **Scope flag** (beyond BL-21): also cache the built files? | **Decided (#256): A. Yes: `/assets/*` `immutable` for a year (names are content hashes), HTML `no-cache`** (a reload re-downloads nothing unchanged). Rejected: ~~B. Compression only~~ | no (decided) | server core |
| ~~OQ-DICEX-42~~ | ~~play-shell (W) / notifications: the popup grows from 280 × 160 to 320 × 190~~ | **Settled by seams S2: B.** W1 owns `toast-region.ts` incl. the popup constants and sets 320 × 190 from FR-DICEX-47; the toast regions and their keep-out boxes are W's, sized for this popup; D11 edits only the popup's internals and starts after W1 merges. Positions: OQ-SHELL-32 C (#256), DM top-centre, players bottom-right. Rejected: A (D11 edits the constants after W) | — | [play-shell](play-shell.md), [notifications](notifications.md) |
| ~~OQ-DICEX-43~~ | ~~Glossary~~ | **Settled by seams S12** (integrator adds at the gate merge): **Landing** (dice: the moment a client shows a roll's numbers, when its dice for it rest; not "reveal", which stays fog's word), **Dice preview** (the tray's 3D stills of the dice a staged roll will roll) | — | glossary |
| ~~OQ-DICEX-44~~ | ~~character-sheet-full, combat-extras, combat-tracker: D9 edits their roll buttons' tooltip lines~~ | **Settled by seams S8: A.** D9 edits those caller lines and is the last slice on them: after W4 (`row.tsx` / `parts.tsx`), R1 and R4 (`initiative-window.tsx`). Rejected: B (each owner adds the hint) | — | [character-sheet-full](character-sheet-full.md), [combat-extras](combat-extras.md), [combat-tracker](combat-tracker.md) |
| OQ-DICEX-45 | **Scope flag** (beyond BL-15): Alt+click on the game log roll bar's Roll stages the bar's expression in the tray (FR-DICEX-51) | **Decided (#256): A. Yes: it stages `free`, like the tray Button**. Rejected: ~~B. Hint only; no Alt stage on the roll bar~~ | no (decided) | FR-DICEX-51; [dice-roll-log](dice-roll-log.md) |

**Sprint 6** (track WF): no open question. BL-44's outcome is decided (#286); the layout order (bar pinned, dice shrink first) has no visible trade-off worth a DM call. If PF moves tray-gear settings to Preferences, that is PF's question.
**Sprint 6** (track PF). **Bold** = suggested pick.

|---|---|---|---|---|
| OQ-DICEX-48 | *(Only if [OQ-SHELL-47](play-shell.md#15-open-questions) A)* Keep the tray and roll-popup gears once the Dice section exists? | **Decided (#288): A (keep both gears as shortcuts).** Options as framed: **A. Keep both gears as shortcuts to the same panel (FR-DICEX-58)**: settings stay one click from the dice, one home in Preferences / B. Remove the gears; Preferences only: one place, but changing Display mid-roll takes a window | — · decided | FR-DICEX-57, -58; [play-shell](play-shell.md) FR-SHELL-75 |

**Sprint 6 build:** FR-DICEX-57, -58 go in slice **PF2** ([play-shell §14](play-shell.md#14-dependencies)): one line in each client's `pref-sections.ts` (append) + `SettingsPanel.tsx` (a layout prop at most; dice-extras' own file). *(Seams S9)* WF5 `fix/tray-roll-visible` owns `TrayWindow.tsx` / `TrayPreview.tsx`; `SettingsPanel.tsx` is PF's. PF2 does not edit `TrayWindow.tsx` (the gear already opens `SettingsPanel`, so OQ-DICEX-48 A needs no tray change); if it ever must, PF2 merges after WF5. No dependency.

**Sprint 8** (track TT). Decided at DM gate 1 ([#335](../decisions-log.md)): every pick accepted.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICEX-49 | Who makes macros? | **Decided (#335): A.** Options: **A. Players on own PCs; the DM on anything (a PC's for its owner or DM only)**: covers Bless and monsters / B. DM only / C. Players only | no (decided) | FR-DICEX-64–67 |
| OQ-DICEX-50 | Where? | **Decided (#335): A.** Options: **A. Sheet tab + tray popover**: 0 px / B. A macro bar: map room / C. A window | no (decided) | FR-DICEX-69 |
| OQ-DICEX-51 | Contents | **Decided (#335): A.** Options: **A. Notation + name + category, a free roll**: no server change / B. + damage type feeding the card / C. + sheet references | no (decided) | FR-DICEX-68 |
| OQ-DICEX-52 | Targets | **Decided (#335): A.** Options: **A. PCs, "All PCs" preset** / B. + companions / C. Online players only | no (decided) | FR-DICEX-75 |
| OQ-DICEX-53 | Rolls | **Decided (#335): A.** Options: **A. Skill, save, check, custom** / B. + initiative, death saves / C. Custom only | no (decided) | FR-DICEX-76 |
| OQ-DICEX-54 | DC | **Decided (#335): A.** Options: **A. Optional, shown or hidden (default hidden); pass / fail DM only**: no meta-gaming / B. Shown with pass / fail / C. None | no (decided) | FR-DICEX-77, -85 |
| OQ-DICEX-55 | Results | **Decided (#335): A.** Options: **A. Public, or Hidden = DM + the target's player (preset from the category)** / B. A + Blind (DM only; existing stamp) / C. Always public | no (decided) | FR-DICEX-77 |
| OQ-DICEX-56 | Timeout | **Decided (#335): A.** Options: **A. None; Close / Roll for missing**: no wall-clock scheduler (ADR-0016) / B. A countdown / C. Close at the next turn | no (decided) | FR-DICEX-82 |
| OQ-DICEX-57 | Decline? | **Decided (#335): A.** Options: **A. Yes** / B. No | no (decided) | FR-DICEX-79 |
| OQ-DICEX-58 | Physical dice on a prompt? | **Decided (#335): A.** Options: **A. Yes, a normal roll button** / B. One tap, server rolls | no (decided) | FR-DICEX-83 |
| OQ-DICEX-59 | Request adv / dis | **Decided (#335): A.** Options: **A. A preset the player may change** / B. Forced | no (decided) | FR-DICEX-76 |
| OQ-DICEX-60 | Answer path (technical) | **Decided (#335): A.** Options: **A. Own `dicex.answerRequest` + `sheetRoll`** / B. `requestId` on `char.roll` / `dice.roll` | no (decided) | FR-DICEX-78 |
| OQ-DICEX-61 | Glossary: Macro, Roll request, Prompt, Pause screen, Alert sound | **Resolved (integrator, sprint-8 seams / rulings)**: **A. Add** (integrator, S16) | no (decided) | glossary |
| ~~OQ-DICEX-62~~ | Luck counting | **Resolved (integrator, sprint-8 seams / rulings)**: (S6) iff the entry is public; hidden answers DM only, not in the roller's view (FR-DICE-82) | no (decided) | stats |
| ~~OQ-DICEX-63~~ | Placer seams | **Resolved (integrator, sprint-8 seams / rulings)**: (S2, S3) card = `overlays.ts` entry (`blocksInput`), control = `top-bar-items.ts`, prompt = card toast, Requests = launcher window (useful 360 × 400) | no (decided) | FR-DICEX-86 |
| ~~OQ-DICEX-64~~ | Request vs turn alert | **Resolved (integrator, sprint-8 seams / rulings)**: (S9) independent, sounds never overlap; TT3 owns the `turn` key line | no (decided) | FR-DICEX-89 |

## 16. Out of scope

- As §4. Whispers → [stub](post-mvp/dice-extras.md). *(Sprint 8: macros and roll requests are in this spec.)* Stats on rolls → [stats](stats.md). Gem rerolls → [gems](gems.md) (their new entries throw like any roll).
