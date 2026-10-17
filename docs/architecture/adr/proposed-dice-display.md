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
| B. Dice layer between toasts and dialogs (FR-SHELL-01 order: toasts < dialogs, overlays) | A modal dialog is never covered | Needs a new slot in `PlayFrame.tsx` (shared frame, M4's lock); dice that duck under a dialog break the DM's "over everything" ([12]) |
| C. Roller's client broadcasts the throw (ADR-0044 B) | Identical motion everywhere | New signal with its own visibility; rejected in ADR-0044 for the same leak risk |

## Decision (proposed)

**A.** Rows tagged *pick, DM gate* follow the bold pick of the named open question until the DM rules ([dice-extras §15](../../specs/dice-extras.md#15-open-questions)); the others are DM decisions (#243) or settled seams (S7).

| Rule | Detail | Status |
|---|---|---|
| Where | `screen` (default): one fixed full-viewport canvas portalled to `body`, topmost, `pointer-events: none`; arena = the viewport, walls on its edges. `zone` (option, "Tray throw"): ADR-0044's zone, now an arena of the same canvas. `flat` / `off`: chips only | DM #243 [10, 12]; seams S7 |
| Popup: who | Every live `roll` entry a client receives, the roller included | *pick, DM gate* (OQ-DICEX-23) |
| Popup: where | That client's toast region (players bottom-right, DM top-centre), a third stack, ≤ 3, 6 s after rest | *pick, DM gate* (OQ-DICEX-24); stack order seams S7 |
| Popup: dice | Same dice in picture-in-picture: hand-off from the big throw, or a miniature when the big one didn't run | *pick, DM gate* (OQ-DICEX-26) |
| DM-only | `public: false` entries never animate big; the DM sees them in the popup only | *pick, DM gate* (OQ-DICEX-20) |
| Timing | Settle ≤ 2.5 s, rest 1 s, hand-off 0.4 s | *pick, DM gate* (OQ-DICEX-18) |
| Truth | Unchanged: pre-computed headless simulation, then relabel, then play; no client changes a value; faces checked against `data-value` | ADR-0044, kept |
| Cost | 3D chunk preloaded at idle when display is `screen` / `zone`; pixel ratio ≤ 1.5; loop only while dice move | *pick, DM gate* (OQ-DICEX-27) |
| Settings | Per device, browser only (`pp.dicex.v2.*`; v1 migrated) | *pick, DM gate* (OQ-DICEX-22) |

## Consequences

- No protocol, schema or event change; CON-44 deltas 0 B (snapshot and per roll, measured 2026-10-17).
- play-shell's layer order gains "dice layer" on top; `toast-region.ts` sizes a third stack (shared; sequenced with M's placement fixes).
- The log gains a `die {faces, value, kept, offered?, label?}` line segment (dice-roll-log owned; seams S8 as amended by ruling B5); kinds that reuse the roll helpers get chips with no change of their own.
- One WebGL context per page (screen, zone and PiP arenas); the sprint-3 zone canvas is retired.
