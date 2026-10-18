# Proposed — Player colour stored once, derived everywhere

- Status: proposed (spec-colours, sprint 5 track K; for DM gate 1)
- Date: 2026-10-18
- Affects: [campaign-management](../../specs/campaign-management.md) (FR-CAMP-23–29), [scenes-map](../../specs/scenes-map.md) (FR-MAP-68–73), [scene-tools](../../specs/scene-tools.md) (FR-SCN-47), [dice-roll-log](../../specs/dice-roll-log.md) (FR-DICE-60–61), [notifications](../../specs/notifications.md) (FR-NOTE-38–41)
- Raised by: [OQ-CAMP-22](../../specs/campaign-management.md#15-open-questions)

## Context

- BL-17 (DM, decided): players and the DM pick a colour; it marks their laser, pings, templates, drag path, log lines and notifications.
- Every one of those already names its person: signals carry the server-stamped `from {role, playerId?}` ([ADR-0026](0026-signal-routing.md)); templates `placedByPlayerId`; tokens `ownerPlayerId`; log entries `rollerRole` / `rollerPlayerId`. Notifications name nobody today.
- Measured (realistic-heavy harness, `session-sim`, 2026-10-18): a palette key on 7 player rows + the campaign row = **+149 B** per snapshot frame. A colour copy on every kept template and log entry = +2,163 B (DM) and +21 B on every signal frame (ping 176 → 197 B, laser 613 → 634 B).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Store the colour once (`player.color`, `campaign.dmColor`); every surface looks it up from the id it already carries; notifications gain `byRole` / `byPlayerId`** | +149 B per frame, 0 B per signal; a colour change recolours everything at once; one source of truth for later features | Clients need the `player` records to draw (they already have them, FR-CAMP-19); the notification stamp costs ≤ 8.4 KB (DM, 120 rows) |
| B. Copy the colour onto each record / signal at creation | Old marks keep the colour they were drawn in | Schema on templates, log entries, notifications; +21 B per signal frame; stale copies after a change; two sources of truth |
| C. Colour per browser (localStorage) | No server change | Nobody else sees it: defeats BL-17 |

## Decision

**Proposed: A** (pending DM gate 1; rejected options struck there).

- Colour = a key of one fixed palette (OQ-CAMP-17), or `#rrggbb` if the DM picks the free picker; the wire carries the key, each client maps it to a theme token (`player.<key>`, [visual-direction](../../design/visual-direction.md), OQ-CAMP-23).
- No feature copies a colour into its own rows or frames. A feature that needs "whose colour" stores or receives a player id (or the DM role) and calls the shared client helper `colorOf`.

## Consequences

- Not secret: every client of the campaign receives every player's colour and the DM's (with the names it already gets).
- A colour change is one `player` or `campaign` upsert; existing pings, trails, templates, paths, log lines and notifications redraw in the new colour (OQ-CAMP-21).
- Future per-person marks (chat, drawings, hand-raise) follow the same rule: carry the person, not the colour.
