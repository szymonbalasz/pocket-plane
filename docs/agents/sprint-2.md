# Sprint 2: DM playtest fixes first, then fog of war, props and structure

DM decisions #187 (sprint 2 chosen) and #188 (the DM's sprint-1 playtest notes come first). Process: [orchestrator prompt](orchestrator-prompt.md), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its sprint-1 lessons. Sprint 1 for reference: [sprint-1](sprint-1.md).

Two phases. **Phase 1** fixes what the DM found playtesting sprint 1 (N1–N11) plus the session-sim-4 glitches (G1–G10). **Phase 2** (tracks F and B) starts only after phase 1 is merged and verified. Inside each phase, tracks run **in parallel**; overlapping code is sequenced by the orchestrator.

```mermaid
flowchart LR
  Q[fix/asset-cache N2] --> M1
  A[P2a spec: combat] --> G1{DM gate 1}
  B[P2b spec: sheet + shell] --> G1
  M[M spec: effect modifiers] --> G1
  G1 --> M1[phase 1 builds + walkthroughs]
  M1 --> R1[session-sim check + playtest notes]
  R1 --> F[F spec: fog-of-war]
  R1 --> S[B spec: scene-tools]
  F --> G2{DM gate 2}
  S --> G2
  G2 --> M2[phase 2 builds + walkthroughs]
  M2 --> R2[session-sim regression + recap]
```

## Orchestrator: how to run this sprint

**Phase 1**
1. At once: `fix/asset-cache` (N2, a bug: no spec; root cause first) and three spec agents: `spec/polish-2a` (P2a combat), `spec/polish-2b` (P2b sheet + shell), `spec/effect-modifiers` (M). P2a / P2b revise the owning specs (one agent per group so cross-spec items get one design); M writes a new spec `docs/specs/effect-modifiers.md` from `_template.md` (prefix **MOD**, `phase: post-mvp-2`) plus a proposed ADR. Copy the inputs (this file, the session-sim-4 report) into each agent's worktree.
2. Settle the seams between P2a, P2b and M yourself (N7's sheet buttons vs combat routing; M's modifiers vs CBTX effects and the sheet), then one review agent across all three; authors apply the findings.
3. **DM gate 1**: every pick that needs the DM (column below), M's scope and whether M builds in phase 1 or later. Then integrate (ADRs, links, index, glossary, registries, log) and merge the spec branches.
4. Builds per the hotspot table; walkthroughs per feature; `check` + full `e2e` in the branch and on `main` after every merge. Then a session-sim run on `main` and a **"Playtest: phase 1 fixes"** section appended here (setup commands + steps, like [sprint-1](sprint-1.md#playtest-sprint-1-features)); tell the DM it's ready. Continue to phase 2 without waiting; DM feedback joins at gate 2.

**Phase 2**
5. Spec agents `spec/fog-of-war` (F, new spec FOG, `docs/specs/fog-of-war.md` from `_template.md`, `phase: post-mvp-2`) and `spec/scene-tools` (B, expand the stub [post-mvp/scene-tools](../specs/post-mvp/scene-tools.md) into `docs/specs/scene-tools.md` without fog, prefix SCN). Settle the F ↔ B seam (layer stack, what fog hides) before one review agent.
6. **DM gate 2**: F and B scope, every pick, any phase-1 playtest feedback. Integrate and merge.
7. Builds, walkthroughs, `check` + full `e2e` on `main` after each merge, session-sim regression on final `main` (incl. fog, a wall, an AoE template), a "Playtest: sprint 2 features" section here, then **pause and recap with the DM** before sprint 3.

Work autonomously between gates; come back to the DM only for product decisions, gates, ADR acceptance, new dependencies, anything destructive.

## Phase 1: DM playtest notes (sprint 1, 2026-10-15)

| # | DM note (short) | Track | Owning spec(s) | Needs the DM? |
|---|---|---|---|---|
| N1 | Minimise vs close look the same; what does minimised mean for a player (the launcher line suggests "open")? | P2b | play-shell | Yes: what minimise is for (keeps state / alerts / badges?) vs dropping it |
| N2 | Thorn's new token art loaded; Mira's (and the goblins', wolf's) only after empty cache + hard reload | Q | assets-pipeline (cache headers, seeded asset IDs across fixture reloads) | No: bug |
| N3 | DM view, under each player: passive Perception, Investigation, Insight, current HP, AC, temp HP, level | P2b | character-sheet-full, campaign-management (players panel) | No (placement is the spec agent's pick) |
| N4 | Why is there an Attack on both the Main and the Actions tab? | P2b | character-sheet, character-sheet-full | No |
| N5 | Adding creatures to an encounter: roll initiative before adding; tickbox "create tokens" (checked; placed in the middle of the screen); tickbox "add hidden" (checked); per row after creature + number: HP **average** (standard) or **rolled**, in both the encounter builder and the mid-fight add dialog; creature lookup becomes an **autocomplete** instead of a dropdown | P2a | combat-tracker (builder), combat-extras (add dialog), entities (HP formula on definitions) | No: DM specified it |
| N6 | Creatures added mid-encounter get no movement-tracker value in the Initiative window | P2a | combat-extras, combat-tracker | No: bug |
| N6.1 | Added creatures: no red crosshair when selected as targets (stays white); the popup says the selection "is not in combat"; multi-select doesn't list them (the targets dropdown does) | P2a | combat-extras, combat-tracker (FR-CBT-33 selection rows, binding) | No: bug |
| N7 | Attack / Damage buttons confuse: Main's Attack also rolls damage; Actions' Attack / Damage differ in and out of combat. Add a **third button: Attack + damage**, and make the three behave the same everywhere | P2b (sheet) with P2a (routing) | character-sheet-full, combat-tracker routes | No: DM specified the third button; the spec states each button in and out of combat |
| N8 | The targets popup (opened from a player's apply notification) can't be moved: make it movable like any window, open it over the apply notification, and that notification goes away | P2a | combat-tracker (amends FR-CBT-55 "not draggable"), notifications | No: DM decided |
| N9 | Bless adds to attack rolls: the sheet needs a place for temporary effects; and the plan for toggling effects like a barbarian's **Rage** | M | new effect-modifiers spec; combat-extras (effects), character-sheet-full (sheet section), ADR-0009 modifiers (design-for-later becomes real) | Yes: scope (modifier kinds, presets, toggles with uses) and whether it builds in phase 1 |
| N10 | Dice notation anywhere in free text becomes clickable ("1d12+5", whitespace-tolerant) and puts the dice in a **3D dice tray** to adjust and roll; doesn't feed attack / apply. Every roll eventually goes through the 3D roller | — | backlog: [feature-tiers](../feature-tiers.md#3-character-sheet-and-dice), [dice-extras](../specs/post-mvp/dice-extras.md) | Done (#188): 3D dice tray tier **S**, dice notation shortcut tier **A** (flagged very important). Not built in sprint 2 |
| N11 | When a player gets a notification (e.g. roll for concentration), the DM sees a few-second cue over that player's token | P2a | combat-extras, notifications, scenes-map (transient token cue) | No |

## Phase 1: glitches from the session-sim-4 regression (#186)

Evidence: `.verify/20261014-194223-session-sim-4/report.md` in the main checkout (glitches 1–17, screenshots alongside). G2, G3, G6, G8 → P2b; G1, G4, G5, G7, G9, G10 → P2a.

| # | Glitch | Owning spec(s) | Needs the DM? |
|---|---|---|---|
| G1 | Effect chips always collapse to "+N" in the default Initiative window, even with room | combat-extras, combat-tracker | No |
| G2 | Fitted battlemap tokens are tiny (~29 px at 1440×900, ~15 px at 1280×720); bars, icons, names unreadable | scenes-map (FR-MAP-44 fit, zoom floor) | Yes: minimum token size when fitting vs fit as now + zoom hint vs per-scene default zoom |
| G3 | Resizing the window leaves tokens under windows until Fit | scenes-map, play-shell | No (spec agent picks; e.g. refit on viewport resize while the camera is still "fitted") |
| G4 | Initiative window doesn't grow; added rows below the fold | combat-tracker, play-shell | No |
| G5 | Attack popup's damage preview ignores temp HP; HP dialog shows no temp HP | combat-tracker, combat-extras | No |
| G6 | Physical dice crit: 4d6 → 8d6 with empty boxes; Roll does nothing silently | dice-roll-log | No |
| G7 | Death-save counters in the public log line contradict #178 G6 (others see the state only) | combat-extras FR-CBTX-39 | No: fix to match #178 |
| G8 | No DM cue for a draft awaiting approval; no player cue on approval | character-sheet-full, notifications | No |
| G9 | Pending concentration card: no DM bell badge, no Initiative "Pending" row; after End "Resolved by DM" | combat-extras, notifications | No |
| G10 | Undo tooltip copy ("Sela → Goblin 2, 0"; "DM → Mira, 4" after 99) | combat-tracker | No |

Fold in if the same FR is touched anyway (P2a or P2b, whichever owns it): 11–17 of the report (duplicate card toast, "physical" twice, sheet picker jumps after reload, dead PC no map cue after End, monster initiative rolls public, cramped sheet for creation, encounter rating counts a token-less approved PC), plus sprint-1 leftovers: pending toast over Initiative's Undo, Notifications window opens ~250 px tall vs 360×480, setting a monster's temp HP sends players an empty update.

## Phase 1: track M, effect modifiers (N9)

Design first; build if the DM says so at gate 1. Proposed scope for the spec agent to refine:
- Effects (CBTX) gain optional **modifiers**: roll bonus dice (Bless +1d4 to attack rolls and saves), flat bonuses (+2 damage), advantage / disadvantage on a roll kind, resistance to damage types; applied server-side when a matching roll is made, shown on the roll line ("+1d4 Bless").
- **Presets** for common effects (Bless, Bane, Rage, Hunter's Mark, Shield of Faith…) as data, hand-editable; the DM and the owning player **toggle** an effect on / off; optional uses (Rage 2 / long rest).
- A sheet section "Active effects" (through CHARX's sheet sections) listing what currently modifies this character.
- Reconcile with ADR-0009's design-for-later modifier list, CBTX's out-of-scope "adv / dis automation", ADR-0036 overrides (an override still wins).
- Out: a full rules engine, spell / class data (compendium), automatic concentration from spells.

## Phase 2 (after phase 1): fog of war and props + structure

## Track F: fog of war → new spec `fog-of-war` (prefix FOG)

The first post-MVP item since ADR-0014. Proposed scope (DM confirms at the gate):

- DM-only fog per scene: rectangle and polygon tools to reveal / hide areas (no brush); reveal all / fog all; **new scenes fully fogged** (carried pick).
- DM sees fog as a translucent overlay; players see it opaque. Live: a reveal reaches players ≤ 1 s.
- **Tokens (and props) under fog are hidden from players, filtered server-side** (carried pick), through the visibility filter, never by the client; a token walking out of fog appears; own PC tokens always visible to their owner.
- Undo for fog edits (DM); fog survives reload, reconnect and a hard kill.
- Snapshot cost stated: fog geometry must fit the CON-44 ceilings (heavy DM snapshot is ~731 KiB of 768 KiB: a real constraint; propose compaction or windowing).
- Out: vision, dynamic lighting, line of sight (ADR-0007), player-side exploration memory, fog by walls.

## Track B: props and structure → spec `scene-tools` (prefix SCN, without fog)

Expand the stub. Proposed scope (DM confirms):

- **Layers**: map / objects / tokens / DM-only, a layer model scenes-map renders in order; DM-only layer ≈ hidden tokens (reconcile with MVP's hidden flag, don't duplicate it).
- **Structure**: walls and doors drawn on the grid (segments), **block token movement only** (no vision, ADR-0007); doors open / closed / locked by the DM; a blocked move is refused server-side with a clear cue; DM can always move through.
- **AoE templates**: cone, sphere, cube, line, cylinder; **DM and players place** (carried pick); snap to grid; show affected squares; ephemeral vs persistent (pick); who can delete.
- **Props**: image objects on the objects layer (barrels, tables), DM-placed, from the asset pipeline.
- Diagonal rule as a campaign setting (carried OQ; pick).
- Out unless the DM adds them: map pins (tier B), vision, lighting, freehand drawing (#21), automatic AoE damage / saves (that's combat-extras' out-of-scope multi-target).

## Boundaries and hotspots (orchestrator: sequence these)

**Phase 1**

| Overlap | Rule |
|---|---|
| P2a ↔ P2b: N7 sheet buttons vs combat routing | P2b owns the sheet buttons, P2a the combat route semantics; one seam settled before the review |
| P2a ↔ M: CBTX effects | **M owns** modifiers and their application; P2a doesn't change the effect record shape |
| P2b ↔ M: sheet section for active effects | M registers through CHARX's `sheetSections`; P2b doesn't add an effects block |
| P2a ↔ P2b: combat-tracker vs character-sheet files | Disjoint by default; any shared file → lock in status.md |
| Schema (`src/server/db/`) | P2a (HP formula, add options) and M (modifier rows) core changes one at a time, never both |
| Everything ↔ snapshot ceilings | Re-check CON-44 (heavy DM snapshot ~731 KiB of 768 KiB) |

**Phase 2**

| Overlap | Rule |
|---|---|
| F ↔ B: layer stack | **B owns** the layer model and its client registry; F registers the fog layer through it. Each spec raises an OQ naming the other; settle before the review |
| F ↔ B: what fog hides | **F owns** the rule (tokens, props, AoE templates under fog); B's records expose what F's filter needs (position, footprint) |
| F ↔ visibility filter / record registry | Server-side fog filtering touches scenes-map's token visibility fn: a shared seam. Prefer a scenes-map visibility hook registry (append-only) over editing the fn twice |
| F, B ↔ DB schema | Shared file: core branches (`fix/scn-core`, `fix/fog-core`) one after the other, never at the same time |
| P2 ↔ F, B: scenes-map camera / canvas (G2, G3) | **P2's scenes-map fixes merge before** the F and B builds start canvas work |
| P2 ↔ combat-extras / combat-tracker (G1, G4, G5, G7, G9, G10) | Independent of F and B; build in parallel with them |
| Everything ↔ snapshot ceilings | Every new record type re-checks CON-44; never raise a ceiling without the DM |
| play-shell frame, `overlays.tsx`, `MapCanvas.tsx` | Locks per AGENTS §9.9, recorded in status.md |

## Gates

1. **DM gate 1 (phase 1 specs):** P2a, P2b, M reviewed by one review agent; one DM pass: the "Needs the DM" picks (N1, N9, G2 at least), M's scope and timing.
2. Phase 1 builds: walkthrough PASS per feature; full `check` + full `e2e` before each merge and on `main` after it; "Playtest: phase 1 fixes" section here.
3. **DM gate 2 (phase 2 specs):** F and B reviewed by one review agent; one DM pass: scope, picks, any phase-1 playtest feedback.
4. **Sprint gate (DM):** session-sim regression on final `main` (incl. fog, a wall, an AoE template, an effect modifier if built), "Playtest: sprint 2 features" section here, then recap and pick sprint 3 (candidates: party board + handouts, table flavour, compendium, 3D dice tray).
