# Backlog: self-selectable work (orchestrator)

DM decisions [#204](../decisions-log.md), [#205](../decisions-log.md): the sprint's milestones come first. Only during **downtime** (one agent working, nothing in the sprint queue can start) does the orchestrator pick an item from this list **without asking the DM**, and not near the sprint's end. Rules for picking and tracking: [orchestrator-prompt §3a](orchestrator-prompt.md#3a-use-idle-slots-backfill).

**Eligible** = size S or M, no DM product decision needed (an integrator ruling is fine), no shared core file (schema, `src/server/ws`, protocol envelope, play-shell frame) unless no other branch holds it, and testable with a thin walkthrough or e2e.

| ID | Item | Size | Area (files) | Spec need | Avoid while | Status |
|---|---|---|---|---|---|---|
| BL-01 | Fit with the Game log open cuts the top rows of Goblin Ambush and leaves space below; Town crops on the right (session-sim-6 #4) | S | scenes-map camera (`camera.ts`) | FR-MAP-44/46 wording if behaviour changes | — | open: tried in sprint 3 (commit 138c9fd, reverted in the same branch): fits both scenes at 1440×900, but 5 e2e specs (scene-tools-props, scene-tools-settings, fog-of-war, combat2-polish) click fixed map cells that then sit under the Game log → those specs must pick clear cells or close the log first; proposed FR-MAP-44 wording in #234 |
| BL-02 | "Start round 1" does nothing silently while PCs lack initiative: tooltip / inline reason (FR-CBT-14) (sim-6 #5) | S | combat-tracker DM Initiative | none | combat polish branches | done (#211) |
| BL-03 | Round-0 movement counts toward round 1's "Moved" (sim-6 #6) | S | combat-tracker hooks (`movedFt`) | FR-CBT-39 note | MOD trigger / combat core | open |
| BL-04 | A Dying / Down badge covers a neighbour's name label on the map (sim-6 #7) | S | scenes-map LabelsLayer / CBTX overlay | none | canvas work | open |
| BL-05 | "Clear templates" has no confirm and removes players' kept templates too (sim-6 #9) | S | scene-tools templates client + command | FR-SCN-25 ruling (confirm; scope) | walls track | open |
| BL-06 | New scene dialog shows "Map:" with no name after choosing a map (sim-6 #11) | S | scenes-map DM scenes window | none | — | done (#206) |
| BL-07 | Konva "stage has 9 layers" warning on every load: merge static layers (sim-6 #12) | M | scenes-map canvas layers registry | FR-SCN-02 / FR-FOG-20 note | fog v2 canvas work | open |
| BL-08 | Narrow Initiative rows still collapse chips to "+N" (sim-6 #8): abbreviate durations when tight | S | combat-extras chips | FR-CBTX-46 note | MOD tier 2 chips | open |
| BL-09 | Live-sync hub skips record changes whose player redaction is unchanged (OQ-CBTX-25; empty updates on monster temp HP) | M | `src/server/ws/` hub | live-sync FR note | any ws / snapshot work | superseded by V0 `fix/vision-core` (identical-upsert drop, sprint-3 seams S11) |
| BL-10 | Player outcome line "12 — hit!" vs AC 14 after a DM-only ruling reads odd (sim-6 #10): copy only ("DM ruled") within #178 G8 | S | combat-tracker player card view | DM product call? (ask if copy changes visibility) | — | open (ask) |
| BL-11 | BL-02 e2e flaked once under parallel load: Initiative window stayed minimised after its launcher click (`e2e/support/shell.ts` `openWindow`; D1 merge run, `%TEMP%\pocket-plane\e2e-d1.log`) | S | e2e support / play-shell minimise | none | play-shell work | done (#215) |
| BL-12 | Structure eraser on a door that sits on a wall removes the wall segment, not the door (V0 regression walkthrough, `%TEMP%\pocket-planeerify-vision-core`) | S | scene-tools structure eraser (client hit test) | none | walls track (V4) | open |
| BL-13 | Reveal all sends each combatant twice in one event with different ordering positions (state converges; wasted bytes) (V0 regression walkthrough) | S | fog / combat copies re-derive (`hooks`) | none | V2 / combat lock | done (V2, #228) |
| BL-14 | `combat-tracker/limits.test.ts` "40-char attack name + bludgeoning: label cut to 60" fails intermittently in full `check` runs (twice; passes alone) | S | combat-tracker test | none | combat lock | cause found (unseeded roll), fix in R7 |

## How to add items

- Glitches from walkthroughs and session-sims that are not fixed in their branch go here with the evidence path.
- Mark `picked (<branch>, <date>)` when started, `done (#<decision>)` when merged. Keep the table short; move done rows out at sprint end.
