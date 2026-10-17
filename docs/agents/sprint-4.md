# Sprint 4: fog tools, animated dice, map tools, effects, search

DM decisions #243 (sprint-3 feedback, items 0–20), #244 (sprint 4 scope). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons. Sprint 3 for reference: [sprint-3](sprint-3.md) (same loop: specs in parallel → seams → review → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

DM feedback numbers in brackets ([#243](../decisions-log.md)). "sim-7" = the [session-sim-7 report](../../.verify/20261017-005557-session-sim-7/report.md) glitch list (local, gitignored; copy into each worktree).

| Track | What | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **V** vision + fog | Middle mouse always pans the map, whatever tool is active [0]; vision default 999 ft, reduced only by blinding effects [1]; vision recomputed **while dragging** a token, not only on drop [2]; campaign **party vision** toggle, off by default: on = every player sees the union of all players' vision, darkness, Invisible / Sees invisible included [3]; real **Ctrl+Z** for fog drawing [5]; **fog brush** with a configurable radius, grid-snapped unless Ctrl (like the AoE tools) [6]; DM sees the plain battlemap unless a fog tool is selected; "View as" gains **Party vision** [7]. sim-7: Fit cuts the map top with the Game log open (BL-01, code in 138c9fd; 5 e2e specs need clear cells), darkvision dim but not grey, Konva layer count (BL-07), session-sim-7 Brakka has no senses | [fog-of-war](../specs/fog-of-war.md), [character-sheet-full](../specs/character-sheet-full.md) (senses default), [scenes-map](../specs/scenes-map.md) (pan, Fit) | Revise; amend [ADR-0042](../architecture/adr/0042-dynamic-vision.md) for party vision (or a superseding ADR) | FOG, CHARX, MAP |
| **D** dice | **Animated dice as the default**: a full-screen set bouncing around, off the screen edges, **over everything** (all windows) [10, 12]; the current tray throw stays as an option; result chips as **die shapes** (flat d20 with the number, d6 square, …) not squares [10]; an Owlbear-style **roll popup** bottom right (where notifications sit) for every player, every public roll from any source (sheet check, tray, combat, notation), with the same animated dice in picture-in-picture and the same dice count [11]; the **game log** shows the same dice as the tray did [17]. sim-7: first 3D throw of a session renders flat; throw caption covers a token label. Library: compare the three + cannon-es we ship vs a dedicated dice library (size, licence, offline, look) and bring both to the gate (#244) | [dice-extras](../specs/dice-extras.md), [dice-roll-log](../specs/dice-roll-log.md) | Revise both; amend [ADR-0044](../architecture/adr/0044-3d-dice.md) if the library changes | DICEX, DICE |
| **M** map tools | **Freeform AoE templates** that still highlight affected cells: a cell counts when > 50 % covered [8]; **movement path** drawn while dragging (cells crossed, the path the distance uses): everyone sees players' tokens' paths, only the DM sees non-player tokens' paths [9]; **Show to players** moves to the Scenes view [13]. sim-7: Clear templates has no confirm and removes players' kept templates (BL-05), label collisions (badges, adjacent names), windows opening over the map (DM Initiative over Goblin Ambush's monsters; Initiative over the Compendium at Start; player sheet over the east of the map at 1280×800; empty Handout window after reload), DM dock clipped at 1280×720 | [scene-tools](../specs/scene-tools.md) (templates), [scenes-map](../specs/scenes-map.md) (drag path, labels), [play-shell](../specs/play-shell.md) (placement) | Revise | SCN, MAP, SHELL |
| **R** rules + effects | Limited uses may go **negative** (human error) [14]; Divine Fury's **roll shows in the combat log** [15]; **magic weapons**: several damage types per attack and attack / damage bonuses: Brakka gets a **Flame Tongue greatsword +1** (2d6 slashing + 2d6 fire, +1 to hit, +1 damage) [16]; **effects architecture review first**: we'll keep adding special effects; check the effect / modifier / trigger model holds and refactor if needed [18]; trigger **badges** on Initiative rows and tokens with detail on hover and in the sheet [19]. sim-7: the tray offers "Divine Fury +1d6" after it was used this turn. DM call at the gate: the players' "9 — hit!" line after a DM ruling (BL-10) | [effect-modifiers](../specs/effect-modifiers.md), [combat-tracker](../specs/combat-tracker.md), [combat-extras](../specs/combat-extras.md), [character-sheet-full](../specs/character-sheet-full.md) (weapons, uses) | Revise; proposed ADR if [18] changes the model ([ADR-0038](../architecture/adr/0038-effect-modifiers.md), [ADR-0043](../architecture/adr/0043-rule-triggers.md)) | MOD, CBT, CBTX, CHARX |
| **C** compendium | **Search**: split on whitespace, every word must match ("potion heal" → Potion of Healing) with sensible ranking [20]; the thin fixture Goblin no longer ranks above the SRD Goblin; the "All" tab doesn't open on many "Ability Score Improvement" rows; compendium / derived monsters get **token art** (or a better placeholder than initials) | [compendium](../specs/compendium.md), [entities](../specs/entities.md) (token art) | Revise | CMP |

**Not this sprint:** 5etools class import (compendium-expansion; later, #244). Player / DM colours (BL-17, A-tier) stay on the backlog for downtime.

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start four spec agents at once: **V**, **D**, **M**, **R** (R starts with the effects architecture review [18]: a short findings doc + a proposed ADR if the model must change, before its spec edits). Start **C** the moment any finishes. Copy inputs into each worktree (this file, the session-sim-7 evidence `.verify/20261017-005557-session-sim-7/`, the sprint-3 playtest section).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for anything new in the snapshot or per-drag traffic (heavy harness probe, not estimates), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives.
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: V ↔ M (canvas: brush vs freeform AoE share one shape / coverage helper; middle-mouse pan vs every tool; drag-time vision vs the drag path, one drag pipeline), V ↔ live-sync (party vision changes the per-player visibility filter; drag-time vision traffic and rate), D ↔ notifications / play-shell (roll popup where toasts sit; dice layer above every window), D ↔ R (the game log line format for trigger parts [15], [17]), R ↔ CHARX (weapons with several damage parts; negative uses), C ↔ entities (token art for imported / derived monsters).
4. Reviews: **two** review agents in parallel (review-a: V + M; review-b: D, R, C), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (dice library vs our three + cannon-es), ADR acceptance (party vision, effects model if changed), BL-10 copy, and build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, **one schema branch at a time** (see Hotspots), then feature slices in parallel wherever the hotspot table allows. If only one agent is working and no sprint task can start, §3a lets you fill a slot with a small backlog item (BL-15, BL-16, BL-17); stop doing that once the last build slices are in flight.
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main`. **Wait for the builder's commit before you check its worktree.** Never rebuild a worktree's client while a test agent walks it (sprint-3 lesson).
8. Sprint gate: session-sim-8 on final `main` (bundle = session-sim-7 + sprint-4 units; incl. middle-mouse pan under a fog tool, the fog brush + Ctrl+Z, vision updating mid-drag, party vision on / off, the DM's plain map outside fog tools, a freeform AoE with its affected cells, a drag path seen by the right people, animated dice bouncing over every window and the roll popup for all players, a Flame Tongue +1 attack with two damage types, Divine Fury in the combat log, a use going negative, trigger badges, "potion heal" finding Potion of Healing), leak scan per player, a "Playtest: sprint 4 features" section here, then **pause and recap with the DM**.

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Schema (`src/server/db/`) | Cores one at a time. Suggested order: V core (party-vision setting, vision default) → R core (weapon damage parts, effect-model refactor if any) → D (roll-popup prefs if stored) → M (template shape fields) → C (art refs) |
| Visibility filter / `src/server/ws/` | V owns party vision and drag-time vision. Nobody else edits ws / snapshot code while V core is open |
| Canvas (`MapCanvas.tsx`, layers, tools, drag pipeline) | V first (pan, brush, fog layer only with fog tools, drag-time vision), then M (freeform AoE, drag path, labels). One shared drag pipeline; one shape / coverage helper (seam) |
| Dice display (`dice-extras`, `dice-roll-log` client, overlay layer) | D owns; R's log-line work [15] goes after D's log slice [17] |
| Notifications / toast region / play-shell placement | D's roll popup and M's placement fixes: sequence (same corner, same placement rule) |
| Combat attack / damage / apply | R only (weapons, trigger badges, Divine Fury log) |
| Character sheet folder | V (senses default) → R (weapons, negative uses, trigger detail) one at a time |
| Snapshot ceilings (CON-44) | DM 1 MiB, players 512 KiB (#208). Party vision (union polygons) and drag-time vision traffic are the risks: measure; never raise a ceiling without the DM |
| Fixtures | Existing bundles keep behaving; session-sim-8 = session-sim-7 + sprint-4 units (patches, S10) |

## Gates

1. **DM gate 1 (specs):** all five tracks reviewed; picks, scope, dependencies, ADRs, BL-10 copy, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog items only during downtime and not near the end (§3a).
3. **Sprint gate:** session-sim-8, "Playtest: sprint 4 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Vision: party vision per campaign or per scene; does party vision share Explored memory too; drag-time vision rate (every cell vs throttled) and whether the dragging player sees it before the drop; what "blinding effect" means for the 999 ft default (condition Blinded → 0? effect-driven radius?).
- Fog: brush shape (circle only?) and radius units (ft vs cells); brush hides and reveals both; how undo groups brush strokes.
- Dice: library choice; how long the dice bounce; whether every roll animates (initiative for 8 monsters?); DM hidden rolls (animate only for the DM); reduced-motion / "flat" option; popup duration and stacking with notifications.
- Map tools: AoE cell rule exactly at 50 %; snapping for freeform templates (Ctrl like fog?); whether the drag path stays after the drop (until next move / turn end).
- Rules: magic weapon model (bonus on the weapon row vs an effect); several damage parts on crit; how far negative uses may go and how it shows; trigger badge content.
- Compendium: search syntax beyond AND (quotes, prefix); ranking weights; token art source (bundled SVG per type vs generated).
