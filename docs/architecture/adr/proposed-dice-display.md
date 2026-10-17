# Proposed — Dice display: full-screen dice layer and roll popup

- Status: proposed (sprint 4, track D; for DM gate 1)
- Date: 2026-10-17
- Amends: [ADR-0044](0044-3d-dice.md) rows **Where**, **Source** (adds the popup), **Cost** (preload). Library row unchanged (pick A, [dice-extras OQ-DICEX-28](../../specs/dice-extras.md#15-open-questions))
- Keeps: [ADR-0001](0001-tech-stack.md) server-authoritative dice, [ADR-0022](0022-deterministic-seams.md) `ctx.dice`, ADR-0044 "Truth", "Visibility", "Randomness", "Looks"
- Affects: [dice-extras](../../specs/dice-extras.md), [dice-roll-log](../../specs/dice-roll-log.md), [play-shell](../../specs/play-shell.md) (layer order, toast region), [notifications](../../specs/notifications.md) (shared region)

## Context

- DM [#243](../../decisions-log.md) [10, 12]: animated dice are the default, bouncing off the screen edges, **over everything**, visible to everyone. [11]: an Owlbear-style roll popup bottom right with the same dice, for every public roll. [17]: the log shows the same dice. "This is important."
- ADR-0044 put dice in a zone over the free area, "never over a window", and loaded 3D on the first throw (sim-7: first throw flat; caption over a token label).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One topmost dice canvas (portal, no input) + a roll popup stack in the toast region; both derived from received `roll` entries (ADR-0044 A)** | No new event, signal or field (measured: 0 B); hidden rolls can't reach players by construction; one WebGL context serves screen, zone and popup; no `PlayFrame.tsx` change | Covers dialogs for ≤ 4 s (no input taken); the toast region gets a third stack (shared file, sequenced with track M) |
| B. Dice drawn inside each window's stacking context / below dialogs | Dialogs never covered | Needs a `PlayFrame.tsx` slot; toasts already sit above dialogs, so the order gets inconsistent |
| C. Roller's client broadcasts the throw (ADR-0044 B) | Identical motion everywhere | New signal with its own visibility; rejected in ADR-0044 for the same leak risk |

## Decision (proposed)

**A.**

| Rule | Detail |
|---|---|
| Where | `screen` (default): one fixed full-viewport canvas portalled to `body`, topmost, `pointer-events: none`; arena = the viewport, walls on its edges. `zone` (option, "Tray throw"): ADR-0044's zone. `flat` / `off`: chips only |
| Popup | Every live `roll` entry a client receives → a popup in that client's toast region (players bottom-right, DM top-centre), same dice in picture-in-picture: hand-off from the big throw, or a miniature playback when the big one didn't run (DM-only rolls, others off) |
| DM-only | `public: false` entries never animate big; the DM sees them in the popup only |
| Truth | Unchanged: pre-computed headless simulation, then relabel, then play; no client changes a value; faces checked against `data-value` |
| Cost | 3D chunk preloaded at idle when display is `screen` / `zone`; pixel ratio ≤ 1.5; loop only while dice move |
| Settings | Per device, browser only (`pp.dicex.v2.*`; v1 migrated) |

## Consequences

- No protocol, schema or event change; CON-44 deltas 0 B (snapshot and per roll, measured 2026-10-17).
- play-shell's layer order gains "dice layer" on top; `toast-region.ts` sizes a third stack (shared; sequenced with M's placement fixes).
- The log gains a `die` line segment (dice-roll-log owned); kinds that reuse the roll helpers get chips with no change.
