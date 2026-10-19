# Proposed — Free player colour (amends ADR-0055)

- Status: proposed (spec-prefs, sprint 6 track PF; for DM gate 1)
- Date: 2026-10-19
- Amends: [ADR-0055](0055-player-colour.md) (decision bullet 1 only)
- Affects: [campaign-management](../../specs/campaign-management.md) (FR-CAMP-30–37), [play-shell](../../specs/play-shell.md) (FR-SHELL-70), and every surface that draws `colorOf` (no change there: [scenes-map](../../specs/scenes-map.md), [scene-tools](../../specs/scene-tools.md), [dice-roll-log](../../specs/dice-roll-log.md), [notifications](../../specs/notifications.md), [dice-extras](../../specs/dice-extras.md))
- Raised by: [OQ-CAMP-30](../../specs/campaign-management.md#15-open-questions)

## Context

- DM #285 [1]: players need a **better picker than 8 fixed options** (free colour + suggestions), keeping contrast and colour-blind safety.
- ADR-0055 decided "store once, derive everywhere" and, in bullet 1, "colour = a key of one fixed palette of 8; the wire carries the key".
- Built reality: the columns are already `text` (`player.color`, `campaign.dm_color`); the wire schema already reads any string (`WireColor`); the pure WCAG / CIELAB / CIEDE2000 / Machado helpers already exist in `@shared/campaign-management/colors.ts`.
- Measured (realistic-heavy harness, `session-sim`, 2026-10-19; CAMP §12): a hex on every colour field = **−21 B** per snapshot frame vs the sprint-5 worst key (`vermillion`), **+14 B** vs all-`amber`. DM ≈ 682 KB, players ≤ 287 KB.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Store `#rrggbb` always; boot migration turns keys into hex; the 8 keys become palette colours matched by hex** | One format in every reader; no schema change; any colour the rules allow | The UI sprint can't restyle a stored colour by theme token (it can remap palette hexes with a one-off migration) |
| B. Store a palette key or a hex | Palette picks stay themeable | Two formats in every reader and test; more branches in `colorOf` and the rules |
| C. Keep keys; add more fixed colours | No format change | Not a free colour (contradicts #285 [1]) |

## Decision

**A** (proposed; the DM decides at sprint-6 gate 1). ADR-0055 bullet 1 then reads:

- Colour = a lowercase `#rrggbb` that passes the validity rule (contrast ≥ 4.5 : 1 on `#171717`, CIELAB chroma ≥ 25, ΔE2000 ≥ 15 from `accent.danger`) and, when picked, sits ≥ 9 ΔE2000 (worst of normal, deuteranopia, protanopia) from every other person's colour in the campaign (FR-CAMP-31, -32). The 8 sprint-5 colours are suggested **palette colours**. The wire carries the hex.

Unchanged: store once, derive everywhere; person ids per record, never colour values; the system actor has no colour; colours are not secret.

## Consequences

- `PlayerColorSet.color` becomes a hex (shared event schema); old log rows keep their key and stay readable.
- `colorOf` returns the hex; a key (old data or an older peer) still maps to its palette hex; anything else falls back to the role accent.
- `campaign.dm_color` keeps its DB default `'amber'` (no schema change); new campaigns are written with `#e69f00`.
- visual-direction's "Player colours" table becomes "Palette colours" plus the two rules.
