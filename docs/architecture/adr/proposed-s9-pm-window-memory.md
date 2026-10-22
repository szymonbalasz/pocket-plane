# proposed — Window memory: the placer leaves windows you arranged alone

- Status: proposed (sprint 9, track PM; the rule is DM decision [#338](../../decisions-log.md); the sub-picks OQ-SHELL-74–79 wait for DM gate 1)
- Date: 2026-10-22
- **Amends** [ADR-0060](0060-one-window-placer.md) decisions 2, 3, 5, 6 (below) and #333's reading at #335 for windows the user moved or resized. Extends [ADR-0025](0025-play-shell-windows.md) (layouts stay browser-only, #121).
- Supersedes: BL-85 (put-away windows coming back), by design.
- Raised by: DM #338 (sprint-8 recap; "the orchestrator's pick A"), session-sim-12 glitches 3 and 5.
- Affects: [play-shell](../../specs/play-shell.md) FR-SHELL-144–164 (amends -41, -56, -80, -99, -101, -102, -104, -106), [scenes-map](../../specs/scenes-map.md) FR-MAP-113–115, [party-board](../../specs/party-board.md) FR-PARTY-59–67 (the first window that uses `absorbs`).

## Context

- ADR-0060 made one placer for every path. It treats a window the user moved (`userSpot`) or resized (`userSize`) as **mostly** fixed. But the placer still moves or hides it in these cases (code read, sprint 9):
  - a reopen or reload when it overlaps another window (`isCovered`, `needsPlacing`);
  - a protected window's zone, which displaces user spots too (FR-SHELL-99);
  - the protected squeeze of a moved Game log (only `userSize` is skipped);
  - L3 put-aways.
- sim-12: windows put away never came back (glitch 3), and the Game log shrank for good (glitch 5). The DM's answer (#338) is to stop the placer touching what they arranged, not to add more returns.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Window memory: a moved / resized window is fixed for the placer (reopens exactly, MRU on top, nothing makes room); only tool-bar pushes move it, temporarily; untouched windows keep ADR-0060's ladder with remembered ones as fixed obstacles** | What the DM asked; predictable; less placer work; the existing `userSpot` / `userSize` fields, 0 B | Windows can overlap and cover PCs once arranged (accepted by #338); the harness needs exemptions |
| B. Keep ADR-0060 and add returns for every put-away / squeezed window (BL-85 as filed) | Tidy layouts, PCs always clear | The DM's arranged windows still jump; more transient state; the sprint 4–8 pattern again |
| C. A per-window "pin" toggle: pinned windows fixed, others placed | The user chooses per window | A new control and stored field; the DM asked for automatic memory |

## Decision

**A** (#338). Sub-picks proposed: OQ-SHELL-74 A (only a move / resize remembers), -75 A (smaller screen: render-only nudge), -76 A (push = least move, exact return), -77 A (untouched windows: the ladder, never putting a remembered window away), -78 A (Party Manager 550, useful 440), -79 A (a zone may overlap a remembered window).

| ADR-0060 decision | Status | What changes |
|---|---|---|
| 1. One entry point `settle(world, trigger)` | **stays** | No new trigger; a remembered window's open runs no rung |
| 2. One ladder | **amended** | For untouched windows only. Remembered windows are fixed obstacles; L3 / the look-ahead put away only untouched launcher windows; the L2 squeeze only untouched protected windows |
| 3. Zones | **amended** | An untouched protected window still takes its zone. Launcher windows in it are displaced only if untouched; a remembered window stays under it (MRU z) |
| 4. Least movement | **stays** | — |
| 5. Displacement memory | **amended** | Remembered windows get only `toolbar:<id>` memory and return to their exact rect without the clear-spot test. `viewport:` / `window:` causes apply to untouched windows. A put-away (`open:<kind>`) stays put away (BL-85 superseded) |
| 6. Written vs render-only | **amended** | `userSpot` / `userSize` = remembered, cleared only by Reset. Exceptions now: tool-bar push and the render clamp. The zone exception is gone; reopen / reload / appear = the stored rect |
| 7. Registration | **stays**, plus `absorbs` / `onAbsorb` | A window type may take over a removed kind's stored state (`party.board` ← `party.summary`) |
| — | **new** | Most recently opened / touched window on top: every open (incl. `appear`, feature opens) and every pointer-down fronts; placer writes never change z |

**Reopen algorithm** (pure, in `settle`): remembered → stored rect unchanged; nothing else changes; render = `renderedRect` (FR-SHELL-29 fit, FR-SHELL-12 clamp, rail inset), never written; a shown hard keep-out over it → the least-move push; z = top.

## Consequences

- **0 B**, no new stored field, layout key and shape unchanged; old entries' flags count as remembered (FR-SHELL-154).
- **Harness** (FR-SHELL-162): new `memory` path. I1 / I2 / I3 exempt remembered windows. New invariants I9–I13: stored rect kept, render = nudge, MRU, never put away, Reset clears. Goldens regenerated once in PM1, plus a `memory` table. `layout-checks.ts` stays the brute oracle.
- **Revisit** if the DM finds arranged windows piling over PCs at 1280×720: a per-window "forget" or a pin control (option C) would be the next step, not placer exceptions.
- Glossary: "Remembered window"; Placer / Auto placement amended (integrator).
