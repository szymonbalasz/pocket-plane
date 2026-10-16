# Sprint 3: vision, dice, rules, party board, compendium

DM decisions #201 (fog v2 + dynamic vision), #202 (walls), #203 (sprint 3 scope), #204 (keep agents busy: backfill). Process: [orchestrator prompt](orchestrator-prompt.md) (incl. **§3a backfill**), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons. Sprint 2 for reference: [sprint-2](sprint-2.md) (same loop: specs in parallel → seams → review → one DM gate → builds per hotspot rules → walkthroughs → session-sim → playtest section → recap).

## Tracks

| Track | What (DM's words, #201–#203) | Specs | New / revised | Prefix |
|---|---|---|---|---|
| **V** vision | Fog v2: freeform shapes with drawing tools (grid snap unless Ctrl); **dynamic vision** with a per-character vision / darkvision radius piercing fog; three fog kinds **Fog / Explored / Magical darkness**; per-map Explored toggle; sheet setting "sees through magical darkness" (fully dark screen inside darkness without it; darker transparent overlay with it); **walls freeform with Ctrl**; **red wall highlight while dragging over a wall** | [fog-of-war](../specs/fog-of-war.md) (revision block at the top), [scene-tools](../specs/scene-tools.md) (walls), [character-sheet-full](../specs/character-sheet-full.md) (vision fields) | Revise all three; complete [proposed-dynamic-vision](../architecture/adr/proposed-dynamic-vision.md) | FOG, SCN, CHARX |
| **D** dice | **3D dice**, **dice tray**, **clickable dice notation** in free text, **dice customisation** (per-player look) | stub [post-mvp/dice-extras](../specs/post-mvp/dice-extras.md) → `docs/specs/dice-extras.md` | New spec | DICEX |
| **R** rules | **Effect modifiers tiers 1–3** (tier 1 built; tiers 2–3 per [MOD §14.2](../specs/effect-modifiers.md)) + a **flexible conditional trigger system** on the event stream; reference case **Zealot barbarian Divine Fury** (+1d6 + half barbarian level radiant, first hit each turn while raging); many such class features expected | [effect-modifiers](../specs/effect-modifiers.md) (revision block) | Revise; complete [proposed-rule-triggers](../architecture/adr/proposed-rule-triggers.md) | MOD |
| **P** party | **Party board + handouts** | stub [post-mvp/party-board](../specs/post-mvp/party-board.md) → `docs/specs/party-board.md` | New spec | PARTY |
| **C** compendium | **Compendium** (SRD import, browse / search, clone to campaign, homebrew; feeds trigger presets) | stub [post-mvp/compendium](../specs/post-mvp/compendium.md) → `docs/specs/compendium.md` | New spec | CMP |

## Orchestrator: how to run this sprint

**Phase A: specs (one DM gate)**
1. Start four spec agents at once: **V** (one agent across fog-of-war, scene-tools walls, character-sheet-full vision fields: one design for vision), **D**, **R**, **P**. Start **C** the moment any of them finishes (backfill: never leave a slot empty). Copy inputs into each worktree (this file, the relevant session-sim-6 evidence `.verify/20261015-232530-session-sim-6/` for V, the proposed ADRs are on `main`).
2. Each spec agent: options + bold pick per open question, a **measured** CON-44 figure for new record types (heavy harness probe, not estimates; sprint-2 lesson), named tests, a §13 walkthrough, a build split with the shared files each slice touches, and the **dependency** it needs, if any, with alternatives.
3. Settle seams yourself (one `seams.md`, copied into each worktree; authors push back once). Expected seams: V ↔ scene-tools (walls block sight; freeform segments in the move guard), V ↔ combat (vision-hidden monsters; per-player visibility of combatants), V ↔ live-sync (per-player visibility filter, ADR-0039 → per-player), R ↔ dice (tier-2 boxes per bonus die vs the new tray), R ↔ combat (trigger parts on cards / apply / undo), R ↔ C (class-feature presets from compendium data), P ↔ party-loot / character-sheet inventory, D ↔ character-sheet / notes (clickable notation in sheet text).
4. Reviews: **two** review agents in parallel (review-a: V; review-b: D, R, P, C), then `rulings.md`, authors apply.
5. **DM gate 1**: every pick that needs the DM, scope cuts per track, **new dependencies** (3D dice / physics library; geometry / visibility-polygon / polygon-clipping library), ADR acceptance (dynamic vision, rule triggers, any new ones), and build order. Integrate (number ADRs, index, glossary, registries in AGENTS §9.9, log) and merge the spec branches.

**Phase B: builds**
6. Cores first, **one schema branch at a time** (see Hotspots), then feature slices in parallel. Keep 3–4 agents working (§3a): while a core holds a lock, run other tracks' non-locked slices, walkthroughs, or backlog backfill.
7. Every slice: builder → "ready for walkthrough" → test agent → fixes → `check` + full `e2e` in the branch after merging main → merge → `check` + full `e2e` on `main`. **Wait for the builder's commit before you check its worktree** (sprint-2 lesson).
8. Sprint gate: session-sim-7 on final `main` (incl. a freeform fog shape, Explored memory, magical darkness with and without Devil's Sight, darkvision piercing fog, a freeform wall with the red drag highlight, the 3D tray rolling a clicked notation, a Zealot Divine Fury trigger once per turn, a handout, a compendium monster cloned into an encounter), leak scan per player, a "Playtest: sprint 3 features" section here, then **pause and recap with the DM**.

## Boundaries and hotspots (sequence these)

| Overlap | Rule |
|---|---|
| Schema (`src/server/db/`) | Cores one at a time. Suggested order: V core (fog shapes + migration from the cell mask, vision fields) → R core (trigger records, counters) → P core → C core (compendium tables) → D (customisation prefs, if stored server-side) |
| Visibility filter / `src/server/ws/` | V owns the per-player visibility change (fog subjects, combat copies). Nobody else edits ws / snapshot code while V core is open |
| Canvas (`MapCanvas.tsx`, layers, tools) | V owns (fog drawing tools, vision render, darkness overlay, wall drag highlight). D's 3D dice "over the battlemap" mode (if picked) goes after V's canvas slices |
| Roll control (`src/client/common/features/dice-roll-log/`) | D first (tray wraps / replaces the roll control), then R's tier-2 "box per bonus die" on top of the tray |
| Combat attack / damage / apply (`combat-tracker` server + popup) | R's trigger parts on cards / apply / undo; V's vision-hidden combatant copies touch lifecycle / token hooks: different files, but schedule R's combat slice after V's combat slice if both touch `hooks.ts` |
| Character sheet folder | V (vision fields) → R (tier-3 uses, trigger presets on features) → D (clickable notation in sheet text) → P (inventory / handouts links), one at a time |
| Snapshot ceilings (CON-44) | Heavy DM ~676 KB of 786 KB now. Vision / explored memory per player and compendium data are the risks: measure per slice; never raise a ceiling without the DM; compendium data should load on demand, not in the snapshot |
| Fixtures | New scenes are fully fogged since #196 (FR-FOG-25 ripple): fog v2 must keep existing bundles behaving as today |

## Gates

1. **DM gate 1 (specs):** all five tracks reviewed; picks, scope, dependencies, ADRs, build order.
2. **Builds:** walkthrough PASS per slice; `check` + full `e2e` in the branch and on `main` after every merge; backlog backfill whenever only one agent works (§3a).
3. **Sprint gate:** session-sim-7, "Playtest: sprint 3 features", recap.

## Expected DM questions (for the spec agents to frame, not to decide)

- Vision: shared party vision vs each player sees only their own characters' vision; do walls block sight; Explored memory per player or per party; how "darkvision" differs from normal vision in dim / dark areas (no lighting model: probably radius only).
- Dice: 3D library choice (size, licence, offline); tray placement (window vs over the map); customisation scope (colours / materials / per-roll-kind); whether physical-dice entry stays.
- Rules: where triggers run; formula language; which class-feature presets ship.
- Party board: handout reveal model vs entity visibility; inventory transfer; gold ledger vs party-loot.
- Compendium: source (bundled SRD JSON vs Open5e download; licence per ADR-0018), what's in (monsters, spells, items, class features), homebrew editor scope.
