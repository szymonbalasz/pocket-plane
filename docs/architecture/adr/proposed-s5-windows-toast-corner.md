# Proposed — One toast corner, bottom-right, for both clients

- Status: proposed (sprint 5, track W; DM gate 1 with [play-shell OQ-SHELL-32](../../specs/play-shell.md#15-open-questions))
- Date: 2026-10-18
- Amends: [ADR-0048](0048-dice-display.md) row **Popup: where** ("DM top-centre, clear of Initiative"); integrator pick #153 (DM toasts top-centre)
- Keeps: ADR-0048 rows **Popup: who** (everyone who received the roll), **Popup: dice**, the stack rules (third stack, ≤ 3, 6 s after rest, hover pauses) and the DM rule "keeps clear of an open non-modal dialog"; [ADR-0025](0025-play-shell-windows.md) (layout in browser storage)
- Affects: [play-shell](../../specs/play-shell.md) (FR-SHELL-01, -48, -49), [notifications](../../specs/notifications.md) (FR-NOTE-32), [dice-extras](../../specs/dice-extras.md) (FR-DICEX-39), [scenes-map](../../specs/scenes-map.md) (FR-MAP-59: the fit excludes the corner)

## Context

- Session-sim-8 glitch #4: the DM's top-centre region puts the roll popup and sticky combat cards on the map's top rows. Fit puts tokens there (top-row ranking), e.g. the Start popup on the top-row tokens and the Flame Tongue card on the Dragon.
- Players already stack bottom-right (FR-SHELL-01). The DM's top-centre region came from #153 / #165, when the DM's right column had no window below Initiative.
- Sprint 5 [7] widens the Game log along the bottom. The bottom-right corner below Initiative is the one place in every DM and player default layout that holds no default window. The exception is the DM's 1150-wide log at 1440×900, which reaches 150 px under the corner.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Bottom-right corner for both clients**, box 356 × 238 (1 toast + one 320 × 190 popup); Initiative / sheet end above it; the fit treats it as a window | The map top stays clear. The fit loses only an edge strip. One rule for both clients. | At 1440×900 it covers the DM log's right 150 px while something shows. With 2+ pending DM cards the stack moves left of Initiative, over the map's bottom-right, until they resolve. |
| B. Bottom-right; the Game log ends left of the corner | Nothing overlaps | The DM log is 2.15× at 1440 instead of [7]'s 2.5× |
| C. Top-centre as today; the fit keeps tokens out from under it | No layout change | Every fit frames the map beside or below a 356 × 238 box at the top centre: a much smaller map |

## Decision (proposed; the DM decides at gate 1)

- **A**:
  - Notifications, alerts and roll popups stack upward from 72 px above the bottom edge, 16 px from the right edge.
  - Order: notifications → alerts → popups.
- **Keep clear inside the corner** (FR-NOTE-32's rule moved, and ADR-0048's dialog rule kept): a stack that would overlap either of these moves left until its right edge is 12 px left of it, bottom unchanged:
  - a rendered open window above it (DM Initiative; player sheet or Initiative);
  - an open non-modal dialog.
- Combat cards' `avoidTokens` (P3 glitch 2) is retired. It chose among top-centre spots; the corner is excluded from the fit, so a card's targets are never framed under it.

## Consequences

- `toast-region.ts`:
  - `toastKeepOut` = 356 × 238 at (vw − 372, vh − 310) for both clients.
  - `ROLL_POPUP_W` 320 / `ROLL_POPUP_H` 190 are owned by play-shell's W1 (seams S2).
- The DM's top-centre code paths go in W1:
  - `dmStackAt` position, `keep-out.ts` / `ToastRuntime.tsx` placement and `card-view.ts` `avoidTokens`.
  - D11 owns only the popup's internals.
- Default heights at 1280×720 / ×800: DM Initiative and player sheet are 338 / 418 high. At 1440×900 they are unchanged: 500 / 440.
- 0 bytes: browser layout only.
- If the DM picks C, this ADR is withdrawn and FR-NOTE-32 stays as built.
