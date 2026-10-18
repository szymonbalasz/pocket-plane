# Proposed — Dice landing, popup line and tray preview

- Status: proposed (sprint 5, track D; for DM gate 1)
- Date: 2026-10-18
- Amends: [ADR-0044](0044-3d-dice.md) row **Truth** ("the log line never waits for the animation"); [ADR-0048](0048-dice-display.md) rows **Truth** and **Popup: dice**. Adds a row **Previews**.
- Keeps: [ADR-0001](0001-tech-stack.md) server-authoritative dice; [ADR-0022](0022-deterministic-seams.md) `ctx.dice`; ADR-0044 rows Library, Looks, Source, Visibility, Randomness, Roll control, Limits (its Where and Cost were already amended by ADR-0048); ADR-0048 rows Where, Which rolls, Popup: who, DM-only, Timing, Cost, Settings, Library. ADR-0048's **Popup: where** is amended by track W's [proposed-s5-windows-toast-corner](proposed-s5-windows-toast-corner.md), not here.
- Affects: [dice-extras](../../specs/dice-extras.md) (FR-DICEX-46–51), [dice-roll-log](../../specs/dice-roll-log.md) (FR-DICE-40, 41), [play-shell](../../specs/play-shell.md) (popup size constants, set by W1)
- Static serving (BL-21) has its own record: [proposed-s5-dice-static-serving](proposed-s5-dice-static-serving.md).

## Context

- DM [#250](../../decisions-log.md) [2]: the popup's dice keep their scene positions and shrink (BL-22: 10d6 = dots); show them in a line at full size. [3]: the tray shows the 3D dice that will be rolled.
- Session-sim-8 glitch 8 (#251 track D): the tray and log totals show while the die is still flying. ADR-0044 decided "the log line never waits" (#207, OQ-DICEX-04).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Per-client landing (numbers wait for this client's dice; the line comes at once); popup dice in fixed cells; tray stills on the one context** | No server, event or field change (0 B, measured baseline); every dice surface consistent | Clients show numbers at different moments (by design) |
| B. Server delays the result (or broadcasts a "landed" signal) | Everyone sees numbers together | Breaks ADR-0001 / 0044 (the server never waits); a new signal with its own visibility |
| C. Keep "line at once with numbers"; only the popup holds | Nothing changes | Leaves glitch 8 as it is |

## Decision

**A** (proposed; framing in dice-extras OQ-DICEX-33–38, dice-roll-log OQ-DICE-30). Rows marked ◆ follow an open DM pick.

| Rule | Detail |
|---|---|
| Truth (amends ADR-0044 Truth, ADR-0048 Truth) | Unchanged: the server's values, relabelled faces, pre-computed motion. **The line still renders on arrival; its die values and total wait until this client's dice land.** The client holds only entries its live-throw path put in `holding` (deadline arrival + 6 s); everything else, snapshots included, is shown. ◆ Without animation (Flat, Off, others off): OQ-DICEX-38 |
| Popup: dice (amends ADR-0048) | The same dice, laid out in a line of fixed cells (◆ 44 px, OQ-DICEX-34), wrapping to 2 lines, then "+N" (◆ OQ-DICEX-33); big dice fly to their cells; miniatures tumble into them; chips use the same cells |
| Previews (new) | The tray draws the staged dice as 3D stills on the page's one WebGL context: a temporary arena rendered and copied into the tray's own 2D canvas in one task, so it keeps the window's z-order; no render loop (◆ OQ-DICEX-35) |

## Consequences

- No protocol, schema, event or record change; CON-44 0 B (re-run 2026-10-18: heavy DM 674,452 B, players ≤ 284,256 B).
- `toast-region.ts` popup constants become 320 × 190, set by track W's W1 with the toast corner sized for them (seams S2); D's popup slice edits only the popup's internals.
- Numbers outside the dice surfaces (Initiative order, combat cards) are not held unless the DM picks otherwise (OQ-DICEX-39).
