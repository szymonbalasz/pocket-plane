# Proposed — Launcher in the top bar

- **Status:** accepted (DM, 2026-10-26; [kit-parity](../../specs/post-mvp/kit-parity.md#15-open-questions) OQ-KIT-01 A; the integrator numbers it at merge)
- **Date:** 2026-10-26
- **Context:** DM [#355](../../decisions-log.md) makes the Gilt & Stone kit page the goal. The kit's 48 px top bar shows the campaign title on the left, the window launcher centred, and the status and DM chip on the right; the concept art agrees. [play-shell](../../specs/play-shell.md) puts the launcher bottom-centre (§7, FR-SHELL-01, -29), and [visual-direction](../../design/visual-direction.md) lists a "bottom action bar" motif. The bottom reservation is hard-coded: `LAUNCHER_CLEAR = 64` feeds `workArea`, default placement, the player toast corner and every golden layout.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Launcher in the top bar's centre zone** | Matches the kit and concept art; +64 px of map and window height at every size; one chrome strip | Shares 48 px with the title and status, so at 1280 more buttons drop labels or go to "⋯"; every default layout, golden and replay cell regenerates once |
| B. Keep it bottom-centre | No geometry change | The top bar can't reach the kit; two chrome strips |
| C. B now, A in a later slice | Ships the rest of kit parity first | The goldens still churn later |

## Decision: A

1. The launcher renders in the top bar's centre zone. Its fit width is the space between the left (title) and right (status, items, chip) zones, with ≥ 8 px gutters; FR-SHELL-43's label-drop and "⋯" rules are unchanged, and the "⋯" menu opens downward.
2. `LAUNCHER_CLEAR` becomes the 12 px edge gap. The work area runs from below the top bar to `vh − 12`. The player toast corner sits 20 px above the bottom edge.
3. The sprint-5 default layouts, the bands (FR-SHELL-79), `windows.golden.json` / `windows.memory.golden.json` (both clients) and the replay cells are regenerated once in one slice (kit-parity K5) and reviewed as a diff. The same slice makes `dice.log` 40 px taller (kit-parity OQ-KIT-02 B), so the bands grow by 24 in all. No other default, useful or minimum size changes.
4. The theme never moves the launcher: this is markup for every theme ([ADR-0069](0069-theme-switch.md) unchanged).

## Consequences

- play-shell §7 (launcher, zones, default-layout table) and FR-SHELL-01 / -29 / -50 are amended at merge; visual-direction's "bottom action bar" motif moves to the later portrait-strip / action-bar spec.
- Windows gain 64 px of room at the bottom. BL-124 (resize grip under the launcher) goes away.
- Rejected: B (the top bar can't reach the kit) and C (the goldens churn twice).
