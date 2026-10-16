---
title: Dice extras
prefix: DICEX
status: in-review
owner: spec-dice-extras
phase: post-mvp-3
---

# Dice extras

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Scope: DM decision [#203](../decisions-log.md) (sprint 3, track D). Builds on [dice-roll-log](dice-roll-log.md) (DICE); stub and tier table: [post-mvp/dice-extras](post-mvp/dice-extras.md).

## 1. Summary

- **Dice tray**: a window where a roll is composed or adjusted before it is sent. It becomes the roll control's second face: roll buttons still roll at once, Alt+click stages the roll in the tray; clicked dice notation always lands there.
- **3D dice**: every `roll` log entry a client receives is **thrown** as 3D dice that settle on the **server's** faces ([ADR-0022](../architecture/adr/0022-deterministic-seams.md), [FR-DICE-03](dice-roll-log.md#6-functional-requirements)). Purely cosmetic and client-side: no new server command, event or signal for the animation; visibility is the game log's ([proposed-3d-dice](../architecture/adr/proposed-3d-dice.md)).
- **Clickable dice notation** in free text ("1d12+5", "1d12 + 5"): puts the dice in the tray to adjust, then rolls a plain `dice.roll`; never feeds attack / apply.
- **Dice look** per owner (DM, each player): preset, colours, material; everyone sees the roller's look.

## 2. Scope

- Tray window, its states and routing from every existing roll control without changing server commands (FR-DICEX-01–10).
- Throws from `roll` entries: settle to result, other viewers, hidden rolls, latency, limits (FR-DICEX-11–20).
- Per-device render setting (3D / flat / off), reduced motion, lazy 3D chunk, perf fallback (FR-DICEX-21–23).
- Dice look: record, intent, UI (FR-DICEX-24–27).
- Notation parser + `DiceText` component; sheet free text as the first surface (FR-DICEX-28–31).
- Extension point for [effect-modifiers](effect-modifiers.md) tier 2 "box per bonus die" (FR-DICEX-08).
- *(proposed)* items: the throw zone over the free area (OQ-DICEX-02), Alt+click (OQ-DICEX-08), presets list (FR-DICEX-24).

## 3. Goals

- A roll feels like a roll: dice tumble for the roller and the table, and the faces always match the logged result.
- Text with dice in it is one click from a roll ("very important", #188).
- No new way to cheat or leak: results stay server-side; a client never shows dice it couldn't already read in its log.
- Map-first stays (#162): nothing new is open by default; dice land only where no window is.

## 4. Non-goals

- Client-rolled or client-influenced results ([ADR-0001](../architecture/adr/0001-tech-stack.md): dice are server-authoritative).
- Macros / custom roll buttons, DM roll requests, whispers (stay in the [stub](post-mvp/dice-extras.md); DM didn't take them into sprint 3).
- Dice sound (OQ-DICEX-11; [ADR-0007](../architecture/adr/0007-product-scope.md) allows only short UI sounds).
- Dice in map world space / on the Konva canvas (OQ-DICEX-02 C; would follow V's canvas work).
- Tapping 3D faces to enter physical results; per-category looks (OQ-DICEX-05 C).
- "+5 to hit" turning into a d20 roll (only dice terms are notation, FR-DICEX-28).

## 5. User stories

**DM**
- As the DM, I want my hidden rolls to animate only on my screen, so that a secret roll stays secret.
- As the DM, I want to click "2d6 + 3" in an NPC's feature text and roll it hidden, so that I don't retype stat blocks.
- As the DM, I want to see each player's dice in their colours, so that I know at a glance who rolled.

**Player**
- As a player, I want to click "1d12 + 5" in my sheet, add a d6 for a rider and roll, so that odd damage is quick.
- As a player, I want to see the 3D dice of my and my friends' rolls land on the real result, so that remote play feels like a table.
- As a player, I want to turn 3D off on a weak laptop, so that the map stays smooth.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| **Tray and routing** | | |
| FR-DICEX-01 | Window type `dicex.tray` "Dice tray", both clients, **default closed**, 360×300, min 300×240, launcher "Dice" after "Log". Staging a roll (FR-DICEX-02) opens it via `openWindow` ([FR-SHELL-08](play-shell.md#6-functional-requirements): open / restore + front). Placement per [protocol §18](../protocol/README.md#18-scenes-client-registries) (left edge, near `dice.log`). | Map-first #162 |
| FR-DICEX-02 | **Tray request**, one staged at a time (a new one replaces it): `free {expression, mode, category, label?, actor?}` (notation, palette, roll bar) or `control {options, mode}` where `options` is the caller's `RollControlOptions` **verbatim** ([FR-DICE-24](dice-roll-log.md#6-functional-requirements)). Client memory only. | |
| FR-DICEX-03 | Tray states: `idle` → `compose` (free) / `adjust` (control) → `manual` (physical mode) → `rolling` → `result` (table §7). Closing the window drops a staged request; minimising keeps it ([FR-SHELL-36](play-shell.md#6-functional-requirements)). | |
| FR-DICEX-04 | **Compose** (free): one chip per die grouped by term; palette d4 d6 d8 d10 d12 d20 d100 adds one die (joins a same-faces term without keep); clicking a die chip removes one; constant Input; expression Input synced both ways. Mode toggle + Shift / Ctrl ([FR-DICE-05](dice-roll-log.md#6-functional-requirements)); Options: category, label, actor ([FR-DICE-27](dice-roll-log.md#6-functional-requirements), [-34](dice-roll-log.md#6-functional-requirements)); DM eye preset from the category ([FR-DICE-30](dice-roll-log.md#6-functional-requirements)). Validation = FR-DICE-01 (`parseExpression`): invalid → inline message, nothing sent, Roll stays enabled ([FR-DICE-32](dice-roll-log.md#6-functional-requirements) spirit). Roll sends `dice.roll` ([FR-DICE-09](dice-roll-log.md#6-functional-requirements)) unchanged. | |
| FR-DICEX-05 | **Adjust** (control): dice read-only from `options.expressions` (crit per [FR-DICE-31](dice-roll-log.md#6-functional-requirements)); mode toggle and DM public adjustable; Roll calls the control's `onRoll(RollRequest)` exactly as an immediate roll would, so **the caller sends its own intent** (`dice.roll`, `char.roll`, `cbt.attack`, `cbt.rollDamage`, `cbt.rollInitiative`, …). No server command, intent or schema changes. | |
| FR-DICEX-06 | **Roll buttons** (`RollButton`, every caller): click / Shift / Ctrl+click roll at once as today; **Alt+click** (Option on macOS) stages the control in the tray (`adjust`). Tooltip adds "Alt: adjust in tray". The roll bar ([FR-DICE-30](dice-roll-log.md#6-functional-requirements)) gains a tray Button that stages its current expression (`free`); Enter still rolls at once. | OQ-DICEX-08 |
| FR-DICEX-07 | **Physical dice** ([FR-DICE-07](dice-roll-log.md#6-functional-requirements)) stay. Roll in the tray while the mode is on → `manual` step in the tray with the same `ManualForm` as the popover (FR-DICE-06, -31, -32, "Roll for me"); buttons rolled at once keep the popover. One component, one `RollControl`, two hosts. | OQ-DICEX-07 |
| FR-DICEX-08 | **Extension point** (MOD tier 2, [FR-MOD-27](effect-modifiers.md#6-functional-requirements)): (a) `control.options` reaches the tray verbatim, so options a later spec adds to `RollControlOptions` (MOD's `subject`) work there; (b) new append-only registry `src/client/common/features/dice-extras/tray-extras.ts`: `{key, order, useDice(request, mode) → {label, faces, count, sign}[]}`, rendered as labelled read-only chips beside the base dice in `compose` / `adjust` (DICEX ships it empty); (c) the `manual` step **is** `ManualForm`, so boxes MOD adds per bonus die show in popover and tray alike; (d) fields MOD adds to `RollRequest` (`manualMods`) pass through `onRoll` untouched. | Seam for R |
| FR-DICEX-09 | **Pending**: after Roll (tray or button) the client shows a pending throw (dice shaking in the throw zone; flat: a spinner) until its first new own `roll` entry arrives (`rollerRole` / `rollerPlayerId` = this client) or 3 s pass; then FR-DICEX-11 takes over. Rejects show where they do today (caller inline, tray inline); the shake just stops. Nothing is resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)). | Latency |
| FR-DICEX-10 | **Result**: the tray shows the last own roll (flat dice, total, the log line text) until the next stage; `free` requests offer "Roll again" (same request). | |
| **Throws (3D dice)** | | |
| FR-DICEX-11 | **Source**: live event frames only (`useEventFrame`, never snapshot or resync). Each `game-log-entry` upsert of kind `roll` with `n` above this client's highest seen `n` (set from each snapshot, raised per frame) = one **throw**. Undo upserts (old `n`), snapshots and reconnects never throw. No new event, signal or record. | |
| FR-DICEX-12 | **Visibility = the entry's** ([FR-DICE-15](dice-roll-log.md#6-functional-requirements)): a client throws only entries it received. Hidden DM rolls never reach players, so never throw for them; the DM's own hidden throws carry the eye-off marker. A throw reads `payload` only, never `dmPayload`. | |
| FR-DICEX-13 | `throwDice(entry)` (pure, `@shared/dice-extras/throw.ts`), per payload item in order: every die of `dice` with its server value (dropped dice thrown, dimmed at rest); MOD parts ([FR-MOD-19](effect-modifiers.md#6-functional-requirements)) with expression `1dM` → one die of value \|value\|, labelled (label, or "DM" when null), `NdM` (N > 1) → a flat chip with the sum; manual items → flat dice of the typed values (value null → one chip with the dice total), "physical", no tumble. Kinds other than `roll` never throw (they carry no fresh dice). | |
| FR-DICEX-14 | 3D meshes: d4, d6, d8, d10, d12, d20; d100 = two d10 (tens 00–90, units 0–9; 100 = "00" + "0"). Other faces (d2, d3, d7, d1000…) → flat chips. **≤ 20 3D dice per throw** (first 20 in order); the rest → a flat chip row "+N more". | OQ-DICEX-12 |
| FR-DICEX-15 | **Settle to result**: the client simulates the throw headless (fixed 60 Hz step, ≤ 3 s), reads each die's up-face, relabels the faces so the up-face carries the server value, then plays the recorded motion. At rest, `upFace(die)` read from the final orientation equals the server value for every 3D die. Throw seed = hash(entry id), client-side and cosmetic (never `ctx.dice`), so every client shows the same tumble. | |
| FR-DICEX-16 | **The log never waits**: the line renders on arrival ([FR-DICE-21](dice-roll-log.md#6-functional-requirements)); the throw starts in the same frame; dice rest ≤ 2.5 s later. | OQ-DICEX-04 |
| FR-DICEX-17 | **Throw zone**: a transient layer in the shell's overlay layer ([FR-SHELL-01](play-shell.md#6-functional-requirements)), `pointer-events: none`, inside the free area ([FR-SHELL-34](play-shell.md#6-functional-requirements)): bottom centre, ≤ 720×420. Shows roller name + label, then the dice; fades 1.5 s after rest. Never over an open window; nothing in it is interactive. | OQ-DICEX-02 |
| FR-DICEX-18 | One throw at a time: a new throw while one runs → the running one snaps to rest and fades, the new one starts. | |
| FR-DICEX-19 | Others' rolls throw too, per device toggle "Show others' rolls" (default on); off → own throws only. | OQ-DICEX-03 |
| FR-DICEX-20 | Each throw uses the **roller's look** (DM look for DM rolls, the player's for player rolls; FR-DICEX-24); flat dice use its colours. | |
| **Device settings** | | |
| FR-DICEX-21 | Per browser `pp.dicex.v1.<campaignId>.<dm \| playerId>` = `{render: "3d" \| "flat" \| "off", others: boolean}`, zod-parsed; invalid / unavailable → defaults, in memory. Default render `3d`; `prefers-reduced-motion: reduce` or no WebGL → `flat`. `flat` = dice faces fade in at their values (≤ 300 ms, no motion); `off` = no throw zone (the tray still works). In the tray gear popover. | OQ-DICEX-10 |
| FR-DICEX-22 | **Lazy chunk**: 3D code (library, meshes, textures, all bundled; no CDN) loads by dynamic import on the first 3D throw or look preview; `flat` / `off` never load it. Each client's initial JS grows ≤ 15 KB gz (parser, tray, flat dice); 3D chunk ≤ 170 KB gz with the pick (measured 159 KB, §14). Load failure → `flat` for the session + one console warning. | |
| FR-DICEX-23 | **Perf**: render loop only while a throw is visible (idle = no frames). A 3D throw with median frame time > 33 ms → this device switches to `flat` + Toast "Dice set to flat: 3D was slow on this device" (switch back in settings). | |
| **Dice look** | | |
| FR-DICEX-24 | Look = `{preset, body, pips, material}`: presets Ivory, Obsidian, Crimson, Sapphire, Emerald, Amethyst, Gold, Bone *(proposed)*; `body`, `pips` `#rrggbb`; material `plastic` \| `metal` \| `glass` \| `stone`. One per owner (DM, each player) per campaign. No row → default: DM Obsidian; players by creation order Crimson, Sapphire, Emerald, Amethyst, Gold, Bone, Ivory, … (derived, not stored). | OQ-DICEX-05 |
| FR-DICEX-25 | Record `dice-style` (§8): visibility **full** to everyone in the campaign, so every client draws the roller's look. | OQ-DICEX-06 |
| FR-DICEX-26 | `dicex.setStyle {preset, body, pips, material}` (DM, player): owner = sender (no owner field: nobody sets another's look). zod; same look → no-op, no event; else upsert + event-log row + `DiceStyleSet` in one transaction ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). IDs and time from `ctx`. | |
| FR-DICEX-27 | "Dice look" (tray gear → popover): preset swatches, body / pip colour (12-swatch palette + hex Input), material ToggleGroup, live preview die (3D if render = 3d, else flat), Save, Reset (= preset defaults). Pips vs body contrast < 3:1 → inline hint, still allowed. Disabled unless `live`. | |
| **Clickable notation** | | |
| FR-DICEX-28 | `findNotation(text)` (pure, `@shared/dice-extras/notation.ts`) → `{start, end, expression}[]`. A match = a dice term (`NdM`, `dM` = 1dM, `NdMkhK`, `NdMklK`; case-insensitive) then zero or more `op term` (op `+`, `-`, `−` U+2212, `–` U+2013; term = dice term or integer). Spaces / tabs allowed around `op`; none inside a term; no line break. Not preceded by a letter, digit or `_`; not followed by a letter, digit, `_`, or `/`, `*`, `×`, `x` + digit. Extends greedily while the next `op term` is valid; a dangling `op` is left out. `expression` = `toNotation(parseExpression(match))`; a match failing FR-DICE-01 limits is plain text. | Edge cases §13 |
| FR-DICEX-29 | `DiceText {text, context}` (`@ui`): text rendered as text (never HTML), each match an inline link Button (`dicex-notation`). Click stages `free`: expression; label = `context.label` (≤ 60); category = `context.category` else `other`; actor = `context.creature` if the viewer may roll as it ([FR-DICE-10](dice-roll-log.md#6-functional-requirements)), else default. Shift / Ctrl+click preselect adv / dis when the expression has a `1d20`. Staging works offline; Roll needs `live`. | |
| FR-DICEX-30 | Surfaces built by this spec: character sheet ([CHARX](character-sheet-full.md)) feature text, spell notes, item notes, notes, in view mode (edit mode = plain inputs); context = the creature + the row's name. Other specs' free text uses `DiceText` (OQ-DICEX-14, -15). | OQ-DICEX-09 |
| FR-DICEX-31 | Notation never feeds attack / apply: a staged notation always rolls `dice.roll` with the tray's category, in combat too. | #188 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, semantic tokens. Dice colours are user content (the look), not theme.

- **Tray window** (`dicex.tray`): top: dice area (chips, or the last result); palette row; expression Input + constant; bottom bar like the roll bar (mode, DM eye, Roll, Options chevron → category, actor, label); gear (top-right of the body) → popover: render (3D / Flat / Off), "Show others' rolls", "Dice look…".

| State | Shows | Leaves by |
|---|---|---|
| `idle` | "Click dice in any text, Alt+click a roll button, or pick dice below"; palette | palette / stage |
| `compose` | editable chips, palette, expression | Roll → `rolling` (or `manual`); Clear → `idle` |
| `adjust` | read-only dice from the control (+ `trayExtras` chips), "Mira — Athletics" | Roll → `rolling` (or `manual`); Clear |
| `manual` | `ManualForm` (popover's content) | Roll / Roll for me → `rolling`; Cancel → back |
| `rolling` | Roll disabled, "Rolling…" | own entry / 3 s → `result` |
| `result` | flat dice + total + line text; "Roll again" (free) | any stage → that state |

- **Throw zone:** dice tumble in the roller's look, roller name + label above them, total badge at rest; dropped dice dimmed; MOD dice with a small label; "physical" badge on flat manual dice; DM's hidden throws with the eye-off marker (`visibility.hidden` token).
- **States:** disconnected → tray Roll disabled (banner from live-sync), staged request kept; throws already running finish. Loading 3D chunk → flat for that throw. No WebGL → flat, settings show "3D unavailable on this device".
- **DM view:** tray with DM eye; own hidden throws; every player's throw in their look; look editor for the DM look.
- **Player view:** tray (no eye); own and others' public throws; own look editor; DM throws only for public DM rolls.
- **Keyboard:** tray expression Input: Enter / Shift+Enter / Ctrl+Enter roll ([FR-DICE-05](dice-roll-log.md#6-functional-requirements)); Esc clears a staged request. Notation links are focusable Buttons (Enter = click).
- **Test IDs:** `dicex-tray`, `dicex-tray-state` (+ `data-value` = state), `dicex-tray-die` (+ `data-faces`, `data-term`), `dicex-tray-palette` (+ `data-value` = faces), `dicex-tray-expression`, `dicex-tray-constant`, `dicex-tray-mode`, `dicex-tray-public`, `dicex-tray-roll`, `dicex-tray-clear`, `dicex-tray-again`, `dicex-tray-error`, `dicex-tray-extra` (+ `data-value` = registry key), `dicex-tray-open` (roll-bar button), `dicex-settings-open`, `dicex-settings-render` (+ `data-value`), `dicex-settings-others`, `dicex-look-open`, `dicex-look-preset` (+ `data-value`), `dicex-look-body`, `dicex-look-pips`, `dicex-look-material` (+ `data-value`), `dicex-look-save`, `dicex-look-reset`, `dicex-look-contrast`; `dicex-throw` (+ `data-record-id` = entry id, `data-render` = 3d \| flat, `data-state` = pending \| moving \| rest), `dicex-throw-die` (+ `data-faces`, `data-value` = server value, `data-settled` = `upFace` at rest, `data-kept`, `data-flat`), `dicex-throw-more`; `dicex-notation` (+ `data-value` = canonical expression). Manual step reuses `dice-manual-*`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Dice style (`dice-style`, table `dice_style`) | id, campaignId | ID, ID | `ctx.ids` |
| | ownerKey | `"dm"` \| playerId | Unique (`campaignId`, `ownerKey`) |
| | ownerPlayerId | ID \| null | null = DM |
| | preset | enum (8) | FR-DICEX-24 |
| | body, pips | text `#rrggbb` | |
| | material | `plastic` \| `metal` \| `glass` \| `stone` | |
| | updatedAt | timestamp | `ctx.clock` |
| Device settings *(browser only)* | render, others | enum, bool | FR-DICEX-21; never sent |
| Tray request, pending throw *(client memory)* | | | FR-DICEX-02, -09 |

- **Relations:** Campaign 1—* Dice style; Dice style → Player by id (no FK, as DICE §8). A player with no row uses the derived default.
- **Derived:** default looks by player creation order; throws (`throwDice`) from `roll` entries; up-faces; canonical notation.
- **Persisted runtime state:** `dice_style` rows only. Rolls and entries unchanged ([DICE §8](dice-roll-log.md#8-data-model)).
- No change to `roll`, `game-log-entry`, kinds, `RollRequest` or any intent.

## 9. API & events

**REST:** none.

**WS intents (client → server)**

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `dicex.setStyle {preset, body, pips, material}` | DM, player | zod (enum, `#rrggbb`); owner = sender | `{styleId}` |
| *Existing roll intents* | as today | unchanged; the tray calls them through the roll control or `dice.roll` | as today |

**Record types** (scope `campaign`)

| Type | Visibility rule | Snapshot provider |
|---|---|---|
| `dice-style` | **full** to the DM and every player of the campaign | the campaign's rows (≤ 1 + players), not windowed |

**Domain events**

| Event | Emitted by | Payload | Changes | Player sees | Undoable |
|---|---|---|---|---|---|
| `DiceStyleSet` | `dicex.setStyle` | `{styleId}` | `dice-style` upsert | upsert (every player) | no |
| *(existing)* `DiceRolled`, `CharacterRolled`, `AttackRolled`, `DamageRolled`, … | as today | | `game-log-entry` upsert | per FR-DICE-15; a throw iff received (FR-DICEX-11, -12) | as today |

- No signal: throws are derived from entries already sent, so they follow the log's visibility with no new path.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Stage / compose / adjust in the tray | ✓ | ✓ | none (client) |
| Roll from the tray | as the underlying intent | as the underlying intent | FR-DICE-10, -13; caller's checks |
| Set own dice look | ✓ (DM look) | ✓ (own) | owner = sender |
| Set another owner's look | ✗ | ✗ | no field exists |
| See looks | all | all | full visibility |
| See a throw | every entry | public entries only | FR-DICE-15 |

## 11. Edge cases & failure modes

- **Player / DM disconnect:** tray Roll disabled; staged request and manual inputs kept; a running throw finishes (its entry already arrived). Entries committed while offline arrive in the reconnect snapshot → in the log, **no throw** (FR-DICEX-11). An in-flight roll → `disconnected`, never resent; the shake stops at 3 s.
- **Reload mid-throw:** the snapshot has the entry → log line once, no replay, tray `idle`. Reload between Roll and commit → the roll committed (line present) or not (nothing); never doubled.
- **Server crash:** roll + entry + event-log row commit together ([DICE §11](dice-roll-log.md#11-edge-cases--failure-modes)); `dicex.setStyle` likewise. After restart: snapshots equal pre-crash; no throw replays (snapshot only).
- **Concurrent:** two rolls arrive together → the earlier snaps to rest (FR-DICEX-18), both lines in order of `n`. Two tabs of one owner set looks → last commit wins, both converge. Look changed mid-throw → next throw uses it.
- **Campaign switch:** the new campaign's styles; highest `n` resets with the new snapshot.
- **Hidden roll then public category flip:** never retroactive (FR-DICE-12); players never throw the old hidden roll.
- **Undo / supersede:** `markUndone` upserts an old `n` → no throw. Gem rerolls later (#140) are new entries → thrown.
- **Many dice:** 50 d6 → 20 thrown + "+30 more"; 20 × d1000 → flat chips only.
- **Invalid / malicious input:** notation over limits stays text; text is never parsed as HTML; `dicex.setStyle` with a bad colour or enum → `invalid`. A client that fakes throw faces only fools itself: the log and server rows are the truth.
- **WebGL context lost** mid-throw → that throw falls back to flat at rest values; next throw retries 3D.

## 12. Performance & bandwidth

- **Wire:** no new traffic per roll (throws reuse the entry frame). `dice-style` ≤ ~340 B per row; one upsert per look save (human-paced).
- **CON-44 (measured 2026-10-16**, throwaway probe on the heavy harness `snapshot-size.ts`, session-sim + 6 players, max-length values, 7 rows: DM + 6 players; deleted before commit):

| Variant | `dice-style` DM | Heavy DM frame | Left of 786,432 B | Players |
|---|---|---|---|---|
| Baseline (type registered, no rows) | — | 676,048 B | 110,384 B | 277,039–280,099 B |
| **Look per owner (pick)** | **2,394 B** (342 B/row) | **678,427 B** | **108,005 B** | + 2,394 B each |
| Look + 9 per-category looks (OQ-DICEX-05 C) | 7,525 B (1,075 B/row) | 683,558 B | 102,874 B | 284,549–287,609 B |
| Browser-local (OQ-DICEX-06 B) | 0 | 676,048 B | 110,384 B | unchanged |

- **Client bundle:** initial chunk + ≤ 15 KB gz per client (asserted in the build by a size test on `bun run build` output); 3D chunk lazy, size per library (OQ-DICEX-01). Measured library sizes: [§14](#14-dependencies).
- **Frame rate:** target median ≥ 50 fps on a mid laptop (integrated GPU, 1080p, Chromium) for 20 dice; physics precompute ≤ 50 ms for 20 dice (≤ 180 steps); auto-flat below 30 fps (FR-DICEX-23). Measured by the walkthrough (step 13), reported in evidence.
- **Parser:** a 4,000-char note parses < 1 ms; memoised per text.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:` + seeded `ctx.dice`.

**Fixtures** (setups run as DM unless noted)

| Key | Kind | Requires | Contents |
|---|---|---|---|
| `dicex-styles` | setup | `player-2` | DM: `dicex.setStyle` Obsidian, metal. `player-1` (as player-1): Crimson, body `#8b1a1a`, pips `#ffffff`, metal. `player-2`: none (default Sapphire) |
| `dicex-notation-text` | setup | `char-mira-full` | `char.edit` Mira's notes = "Greataxe 1d12 + 5 slashing. Second Wind d10+1. Hit: 7 (2d6 − 1). Adv: 1d20+3. Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6." |

- **Bundle `dice-extras`** = `dice-log` + `char-mira-full` + `dicex-styles` + `dicex-notation-text`.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-DICEX-28 notation parser`: "1d12+5", "1d12 + 5", "1d12 +5", "1D12+5" → `1d12+5`; "d20" → `1d20`; "7 (2d6 + 3) slashing" → `2d6+3`; "2d6 − 1" / "2d6 – 1" → `2d6-1`; "4d6kh3", "2d20kl1+5"; "1d6+1d4+2" one match; "1d8 plus 1d6" two; "1d6 +" → `1d6`; "1d6+3days" → `1d6`; "1d6+3." → `1d6+3`; newline between "1d6" and "+ 2" → `1d6`; not matched: "51d6", "1d1", "0d6", "1d1001", "2d6/2", "4d6x2", "abc1d6", "2d6x", "1 d 6", "+5 to hit", "d%"; > 60 chars / > 10 terms → text; positions exact; 4,000 chars < 1 ms. `FR-DICEX-13 throwDice`: kept + dropped (adv), MOD `1d4` part → labelled die, `-1d4` → value 3 + "−", `2d6` part → chip, null label → "DM", manual with / without per-die values, 51 dice → 20 + "+31 more", d3 / d1000 → flat, d100 → tens + units (100 → 00 + 0). `FR-DICEX-15 upFace + relabel`: for each die type and every (landed face, target value) pair, the relabelled up-face reads the target. `FR-DICEX-11 high-water`: snapshot entries, resync, `markUndone` upsert → no throw; new `n` → throw; campaign switch resets. `FR-DICEX-12 payload only`: an entry with a `dmPayload` sentinel → throw never contains it. `FR-DICEX-21 settings`: parse, invalid → defaults, throwing storage → memory, reduced motion → flat. `FR-DICEX-24 default looks` by player order. Roll control (DOM tests, as `sheet-render.test.tsx`): `FR-DICEX-06` click → `onRoll` at once + pending; Alt+click → tray `adjust`, Roll → `onRoll` with the same `RollRequest`; `FR-DICEX-07` physical + tray → `ManualForm` in the tray, FR-DICE-31/32 rules hold; `FR-DICEX-08` a test `trayExtras` entry shows its chips; an unknown `options` field reaches the tray | in-code |
| Integration | `FR-DICEX-26`: setStyle as DM and player → own row only; same look → no event; bad colour → `invalid`; event + row + log in one tx, rollback → none. `FR-DICEX-25`: every player frame has every `dice-style` row. CON-44 test: heavy + 7 rows < ceilings, DM headroom ≥ 100 KiB (§12). Restart → identical snapshots. Leak scan: hidden "DM-SECRET-ROLL" (rolls-1) absent from player frames, as DICE | `dice-extras` |
| E2E (thin) | B clicks `1d12+5` in Mira's notes → tray `compose` → Roll; A sees the line; B's `dicex-throw-die` `data-settled` = `data-value` for each die (headless Chromium WebGL, or flat when unavailable: then `data-flat`) | `dice-extras` |
| Bundle | `bun run build`: player and DM initial chunks grow ≤ 15 KB gz vs `main`; the 3D library sits only in a lazy chunk | — |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load dice-extras --profile verify`; `start --profile verify` (test agent's Herdr pane). Contexts **A** DM (`pw-dm`), **B** `player-1` (Mira), **C** `player-2`; B, C frames logged. Evidence + teardown per AGENTS §9.6. Throws: check `data-settled == data-value` for every `dicex-throw-die`, and *total = kept dice + constants*.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | B, C open links | No tray open (default closed); game logs as DICE |
| 2 | — | B: Mira's sheet → Notes | "1d12 + 5", "d10+1", "2d6 − 1", "1d20+3" are links (`data-value` `1d12+5`, `1d10+1`, `2d6-1`, `1d20+3`); "51d6", "1d1", "2d6/2", "4d6x2", "abc1d6" plain text |
| 3 | — | B: click "1d12 + 5" | Tray opens, `compose`: one d12 chip, constant 5, actor Mira, category other |
| 4 | — | B: palette d6, constant → 6, Roll | A, B, C: line "Mira — 1d12+1d6+6: …" at once; B's throw in Crimson metal, A and C see it too (same look); dice rest ≤ 2.5 s; `data-settled == data-value` |
| 5 | — | C: gear → Others' rolls off; B rolls "d10+1" | C: line only, no `dicex-throw`; A, B: throw |
| 6 | — | C: Dice look → Emerald, glass → Save; C rolls `1d20` in the tray | A, B: C's throw in Emerald glass; reload B → C's next throw still Emerald |
| 7 | Eye off; roll `1d20`, label "DM-SECRET-DICE" | — | A: throw with eye-off marker; B, C: no line, no throw; frames contain no "DM-SECRET-DICE" |
| 8 | Open Mira's sheet; Alt+click Athletics | — | Tray `adjust`: "Mira — Athletics check", d20 + modifier read-only; set Adv; Roll → one `char.roll` line "(adv)", two d20 thrown, one dimmed |
| 9 | — | B: Physical dice on; click "2d6 − 1"; Roll; enter 4 and 5 | Tray `manual` (`dice-manual-*`); line "… 4 + 5 - 1 = 8 physical"; flat dice 4, 5 (`data-flat`), no tumble |
| 10 | — | B: Physical off; roll `10d6` in the tray; reload during the throw | After reload: line once, no throw replay, tray `idle`, no console errors |
| 11 | — | C: emulate `prefers-reduced-motion`, reload; B rolls | C: flat dice (`data-render="flat"`); C's network log: no 3D chunk request. C: render Off → no throw zone |
| 12 | Hard-kill + restart server while B has "1d20+3" staged | — | B: Roll disabled, staged dice kept; after restart Roll works; looks unchanged |
| 13 | Roll `20d6` (render 3D) | — | 20 dice thrown; median fps logged in `report.md` (target ≥ 50, mid laptop); `50d6` → 20 + "+30 more" |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [dice-roll-log](dice-roll-log.md) | Roll control (`useRollControl`, `RollButton`, `ManualForm`), roll bar, `roll` kind payload, entry visibility | complete; this spec edits its client folder (roll-control hotspot, D first) |
| [play-shell](play-shell.md) | `openWindow`, window registry, overlay layer mount for the throw zone, `useFreeArea` | complete; one shared mount line (§14 shared changes) |
| [live-sync](live-sync.md) | `useEventFrame` (live frames only), `live` state | built |
| [character-sheet-full](character-sheet-full.md) | Text fields rendered through `DiceText` | complete; sheet folder sequenced V → R → **D** → P |
| [effect-modifiers](effect-modifiers.md) | Tier 2 builds on FR-DICEX-08; MOD parts on `roll` payloads (FR-MOD-19) | revising (R, sprint 3) |
| New dependency | 3D rendering + physics, lazy chunk (OQ-DICEX-01) | **DM OK at gate 1** (AGENTS §3) |

**Library candidates** (OQ-DICEX-01) — measured 2026-10-16 by bundling each with `bun build --minify --target browser` in a scratch dir:

| Option | Licence | Latest (published) | Min / **gzip** | Extra assets | Forced results | React 18 / Vite | Notes |
|---|---|---|---|---|---|---|---|
| **C. Hand-rolled `three` + `cannon-es`** | MIT / MIT | 0.186.1 (2026-09-24) / 0.20.0 (2022-08-12) | 611 KB / **159 KB** (three 134, cannon 24) | none | ours: simulate, then relabel (FR-DICEX-15) | framework-free; plain dynamic import | Maintained three; we own meshes, face textures (CanvasTexture), materials, relabel. Most build work |
| B. `@3d-dice/dice-box-threejs` | MIT | 0.0.12 (2022-10-26) | 537 KB / **144 KB** | none by default (textures 1,555 KB, sounds 335 KB optional) | built in (`"2d20@15,7"`) | no peer deps | Colour sets / materials built in. Vendors three r143 + cannon-es (no tree-shaking, a second three later); 0.0.x, 4 years idle |
| A. `@3d-dice/dice-box` (Babylon + Ammo) | MIT | 1.1.4 (2024-08-24) | 2,661 KB / **700 KB** (445 with OffscreenCanvas) | 283 KB gz required (`ammo.wasm` 126, theme 157), served from an `assetPath` (postinstall copy) | **none** (physics decides) | no peer deps | Heaviest; can't settle on the server result without patching |
| D. `@react-three/fiber` 8 + `three` + `@react-three/rapier` 1.5 | MIT (rapier3d-compat Apache-2.0) | 8.18.0 / 1.5.0 (2024-10-03) | 2,998 KB / **1,025 KB** (rapier wasm inlined ≈ 764 KB gz) | none (wasm inlined) | ours | locked to old lines: current rapier 2.x and fiber 9 need React 19 | Heaviest JS; dead-end versions on React 18 |

- No candidate fetches from a CDN (bundles grepped for cdn / unpkg / jsdelivr / gstatic). All in a lazy chunk (FR-DICEX-22); everything bundled.

**Shared changes needed** (AGENTS §9.9; the orchestrator picks sequence or shared branch first)
- `src/client/{dm,player}/windows.ts` — append `dicex.tray`.
- `src/client/common/features/play-shell/PlayFrame.tsx` (frame, shared) — mount the throw layer in the overlay layer (one line); fallback: a portal at the overlay z-index without a frame edit.
- `src/client/common/features/dice-roll-log/` (dice-roll-log's client folder; roll-control hotspot, D before R): `roll-control.tsx` (Alt+click stage, pending, `ManualForm` export for the tray host), `GameLog.tsx` (tray button).
- New append-only registry `src/client/common/features/dice-extras/tray-extras.ts` → AGENTS §9.9 list.
- Only if OQ-DICEX-06 A: `src/server/db/` (`dice_style`), `src/shared/events/` (`DiceStyleSet`), record-type registry, `src/server/features/index.ts`, `fixtures/bundles/index.ts` (`dice-extras`); schema slot last (V → R → P → C → D).
- `package.json`, `bun.lock` — the library (after DM OK). `vite.config.ts` only if the library needs asset copying.
- Docs at merge: protocol rows (intent, record type, event, roll-control row in §26, window row), data-model row, glossary (OQ-DICEX-17).

**Build split** (one commit per slice; walkthrough steps per slice)

| # | Branch | Content | Shared files | After |
|---|---|---|---|---|
| 1 | `build/dicex-tray` | Parser, `throwDice`, `DiceText` (component), tray window + states, roll-control routing (Alt+click, pending, tray `manual`, `tray-extras.ts`), roll-bar button, **flat** throws + throw zone, device settings | windows.ts ×2, `PlayFrame.tsx`, dice-roll-log client folder, new registry | Can start first (client only); **R's `fix/mod-roll-preview` waits for it** |
| 2 | `fix/dicex-style-core` | `dice_style`, record type, `dicex.setStyle`, `DiceStyleSet`, fixtures + bundle, CON-44 test | db, events, registries, bundles index | Schema order: after C core |
| 3 | `build/dicex-3d` | Library, lazy 3D renderer, settle to result, looks + materials, Dice look UI, perf fallback, bundle-size test | `package.json`, `bun.lock` | 1; look UI after 2 |
| 4 | `fix/dicex-sheet-notation` | `DiceText` in sheet feature text, spell notes, item notes, notes | character-sheet folder | R's sheet slice (V → R → D → P) |

Walkthrough steps per slice: 1 → 2–5, 7–12 (flat); 2 → 6 (data via frames); 3 → 4, 6, 11, 13 (3D); 4 → 2–3.

## 15. Open questions

**Bold** option = suggested pick (not decided). Owner of every question: the DM at sprint-3 gate 1 (via the orchestrator); cross-spec rows 13–16 also the named spec's author at seams.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-DICEX-01 | 3D library (new dependency, lazy chunk; sizes measured, §14) | **C hand-rolled `three` + `cannon-es`, 159 KB gz, MIT, no assets** (maintained, testable relabel; most build work) / B `dice-box-threejs`, 144 KB gz, MIT (forced results + colour sets built in; 4 years idle, vendors three r143) / A `dice-box`, 700 KB gz + 283 KB assets (no forced results) / D R3F 8 + rapier, 1,025 KB gz (old lines only on React 18) | yes (gate 1) | ADR-0001, build 3 |
| OQ-DICEX-02 | Where do dice land? | A tray window only (others' rolls animate only while your tray is open) / **B throw zone over the free area, tray for composing** (every roll visible, no window opened, never over a window; covers map for ~3 s) / C on the map canvas in world space (after V's canvas slices; most immersive, touches `MapCanvas`) | yes (gate 1) | play-shell, scenes-map |
| OQ-DICEX-03 | Who sees a throw? | **A everyone who received the entry, per-device "others" toggle** (table feel; hidden rolls safe by construction) / B roller only (quiet, but remote players miss the table) / C roller 3D, others flat | no | — |
| OQ-DICEX-04 | Does the log line wait for the dice? | **A no: line at once, dice settle ≤ 2.5 s later** (log stays the truth, no hidden-state timers) / B this client holds the line's total until its throw rests (suspense; a second, client-only delay rule) | no | dice-roll-log |
| OQ-DICEX-05 | Customisation scope | A colours only / **B preset + colours + material** (2,394 B measured) / C B + per-category looks (7,525 B; more UI) | no | — |
| OQ-DICEX-06 | Where looks live, who sees whose | **A server `dice-style`, everyone sees the roller's look** (+2,394 B heavy DM; schema slot) / B browser-local, only you see your look (no server work; lost per browser; others see defaults) / C server, but each viewer draws all dice in their own look | yes (gate 1: decides slice 2) | CON-44, schema order |
| OQ-DICEX-07 | Physical dice with the tray | **A stays: same `ManualForm` in the popover (buttons) and the tray (staged), flat dice in the throw** / B moves into the tray only (one place, but every physical roll opens a window) / C drop it (3D replaces it; breaks #43) | no | dice-roll-log |
| OQ-DICEX-08 | Roll buttons and the tray | **A roll at once; Alt+click stages** (no extra click in combat) / B every button stages (one more click per roll) / C per-device setting | no | dice-roll-log, CHARX, CBT |
| OQ-DICEX-09 | Where notation is clickable | A sheet text only / **B sheet text now + every sprint-3 free-text surface through `DiceText` (handouts, compendium)** / C also log lines, labels, loot text (re-roll from the log confuses "what happened") | no | P, C, party-loot |
| OQ-DICEX-10 | Motion settings | **A per device: 3D / flat / off, reduced motion → flat, auto-flat when slow** / B one campaign setting by the DM (can't fit each laptop) / C none | no | — |
| OQ-DICEX-11 | Dice sound | **A none** (ADR-0007) / B a short clatter as a UI sound (amends ADR-0030 / ADR-0007) | no | ADR-0007 |
| OQ-DICEX-12 | Max 3D dice per throw | A 10 / **B 20, rest as chips** (keeps 50 fps on a mid laptop) / C all 50 | no | — |
| OQ-DICEX-13 | effect-modifiers (R): tier 2 on the tray | **R builds `fix/mod-roll-preview` on FR-DICEX-08 after slice 1; trigger parts (Divine Fury) land as MOD parts on the `roll` entry, so they throw** / a new log kind with fresh dice (would need its own throw mapping) | no | [effect-modifiers](effect-modifiers.md) |
| OQ-DICEX-14 | party-board (P): handout text | **Rendered through `DiceText`, context = handout title** / plain text | no | [party-board](post-mvp/party-board.md) |
| OQ-DICEX-15 | compendium (C): descriptions | **Monster actions / spell text through `DiceText`, actor = the token's creature when on the map** / plain text | no | [compendium](post-mvp/compendium.md) |
| OQ-DICEX-16 | play-shell: throw layer | **One mount line in `PlayFrame.tsx` (overlay layer, inside the free area)** / a body portal at the overlay z-index (no shell edit, layering by convention) | no | [play-shell](play-shell.md) |
| OQ-DICEX-17 | Glossary | **Add: Dice tray (window to compose / adjust a roll), Throw (the animation of one received `roll` entry), Dice look, Notation link** | no | glossary |

## 16. Out of scope

- As §4. Macros, roll requests (notification with a roll action), whispers → [stub](post-mvp/dice-extras.md). Stats on rolls → [stats](post-mvp/stats.md). Gem rerolls → [gems](post-mvp/gems.md) (their new entries throw like any roll).
