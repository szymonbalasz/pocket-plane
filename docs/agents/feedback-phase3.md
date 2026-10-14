# DM feedback after the Scenes + Combat demos (2026-10-13)

Captured as decisions [#145–#146](../decisions-log.md). Work list for the next orchestrator session; tiers below are **proposed** — confirm with the DM in one batch before building ([kickoff](continue-session.md)).

## Requests

| # | Request (DM's words, short) | Today | Proposed tier | Specs touched | Notes |
|---|---|---|---|---|---|
| F1 | **Turn alert** for a player when their turn starts: screen flash + sound. Sound customisable; default a ping; DM can add more sounds | Not on the roadmap. Audio is excluded by [ADR-0007](../architecture/adr/0007-product-scope.md) | Flash + default ping **S**; DM-added sounds **A** | combat-tracker (turn event), play-shell (alert), assets-pipeline (audio assets, for A) | Needs a superseding ADR: allow short UI notification sounds only (no music/ambience) — [ADR-0030](../architecture/adr/0030-ui-notification-sounds.md). Per-player mute + volume in browser storage |
| F2 | **Diagonal rule:** every second diagonal costs 10 ft (5/10/5) | Built as 5 ft per diagonal (#124, OQ-MAP-01) | **S** (fix) | scenes-map FR-MAP-15/22, ruler + drag label | Decided: **#145 supersedes #124's ruler pick**. Distance = 5 × (max(dx,dy) + floor(min(dx,dy)/2)) |
| F3 | **Movement tracker:** creature speed on its sheet/stat block; dragging beyond speed → **amber** (dashing), beyond 2× speed → **red** (not allowed); indicators only, never block. Track movement used this turn | Partly: tier B "movement measured along drag path" | **S** (in combat: per-turn tracking; outside combat: indicator vs speed only) | entities (optional `speed` in stat block, additive), character-sheet (show speed), scenes-map (drag overlay), combat-tracker (movement used per combatant per turn, reset on turn start) | Movement counted from the token's position at turn start along the drop path (straight-line cell distance per move, summed) |
| F4 | **Token shape** setting: round crop (default today) or the image as-is (square / transparent) | Not on the roadmap | **S** | scenes-map (token field `shape: round \| square \| none`, default round), entities (default on definition, optional) | Token-owned like the display name (#126) |
| F5 | **Drag images onto the battlemap** (illustrations, props) | Props layer reserved (FR-MAP-29); "AoE props" tier C | **A** | scenes-map (new `prop` record on the reserved layer), assets-pipeline (drop upload) | DM-only; move / resize / hide; snap optional |
| F6 | **Removed-from-combat** indicator on the token | Not built | **S** | combat-tracker (token decoration via the canvas layer / token registry) | E.g. greyed + small "out" badge; DM and players (if the token is visible) |
| F7 | **Pick targets on the map**; the damage popup preselects them. **Multi-target** with Ctrl/Shift; apply to all with a **per-target section** (normal / half / none / double, e.g. Fireball 20, one resistant target takes 10) | Tier A "Multi-target select" ([combat-extras](../specs/combat-extras.md)); MVP is single target picked in the popup (#134) | **S** | scenes-map (selection set exposed to features), combat-tracker (card target list, per-target multiplier, one undo entry per target or per card), dice-roll-log (outcome lines per target) | Crosshair cursor / target ring while the popup is open. Player-side targeting stays out (#134: DM picks) unless the DM says otherwise |
| F7.1 | **Box select** on the map (drag a rectangle; Ctrl/Shift add) | Excluded in scenes-map non-goals ("multi-select") | **S** | scenes-map | Group move of selected tokens: proposed **A** |
| F8 | **Down** indicator on the token (0 HP) | Health band exists in initiative only | **S** | combat-tracker (token decoration; players see it per the band rule) | Same decoration mechanism as F6 |
| F9 | "Players have to type in the roll value — click-to-roll later?" | **Built:** every roll button rolls server-side on click; typing appears only when **Physical dice** is on in the game log (remembered per browser, FR-DICE-07) | — (verify) | dice-roll-log | Next session: reproduce from the DM's demo; if the toggle was the cause, make physical-dice mode visible on roll buttons (badge) so it's never a surprise |

## Party loot (spec questions answered)

| OQ | Decision (#146) |
|---|---|
| OQ-LOOT-01 entry shape | Free text + optional coin amounts (cp / sp / ep / gp / pp) |
| OQ-LOOT-05 running coin total | **Yes, a currency tracker** in MVP (party total from entries) |
| OQ-LOOT-02 corrections | **Edit** (DM edits an entry; logged), not void |
| OQ-LOOT-06 notification | Yes: info notification to everyone + history |

## Suggested sequencing

1. DM confirms the proposed tiers + the UI-sounds ADR (one batch).
2. Spec revisions (parallel, small): scenes-map (F2, F3 overlay, F4, F7 selection, F7.1), combat-tracker (F1 turn event, F3 tracking, F6, F7 multi-target, F8), entities (speed, default shape), character-sheet (speed), party-loot (#146). One review + consolidation pass.
3. Builds: `fix/diagonal-rule` (F2, tiny, can go first) → scenes-map feedback build → combat-tracker feedback build → party-loot build. F9 verify in parallel.
4. Then Phase 4 hardening (crash-recovery pass) and Phase 5 MVP acceptance.
