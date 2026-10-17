# Proposed — Token creature type as a player-visible display copy

- Status: accepted (DM, sprint-4 gate 1, #245; G4, G44). Raised by review-b B6. The integrator numbers it at merge.
- Date: 2026-10-17
- Refines: [ADR-0024](0024-definition-visibility.md) (token display copies)
- Affects: [entities](../../specs/entities.md) (FR-ENT-26–30), [scenes-map](../../specs/scenes-map.md) (token record, placement, definition-changed hook), [compendium](../../specs/compendium.md) (FR-CMP-39)
- Raised by: [OQ-ENT-29](../../specs/entities.md#15-open-questions)

## Context

- Session-sim-7: tokens of compendium monsters show "GS", "O", "H". Sprint 4 draws **token art**, one glyph per creature type, for a token without an image (FR-ENT-28).
- The type sits in the monster's stat block (`statBlock.type`, FR-ENT-26). Under ADR-0024, players never receive monster definitions, and tokens carry copies of **name, image and size** only.
- To draw the art for players, the token needs its own copy: `creatureType` (one of 14 SRD types, `"initials"`, or null). That is a new display copy of a stat-block value, visible to every player who receives the token.
- Cost measured on the realistic-heavy harness: at most 29 B per token, +1,740 B per snapshot frame (60 tokens); 0 B for hidden tokens, which players never receive.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Add `creatureType` to the token's display copies; set at placement from the definition, owned by the token afterwards (like `shape`); the DM can set Initials per token; one fill when the definition first gains a type** | Players see a visible monster's kind at a glance; the visibility fn stays pure (the token's own field); no definition reaches players | A visible token reveals its creature type (as a portrait would). The DM hides it per token (Art ▸ Initials) |
| B. Same field, DM opt-in: placement stores `"initials"`; the DM shows the art per token | Nothing about a monster's type reaches players unless the DM asks | One click per token; "GS / O / H" stays the default, so the sim-7 glitch remains for anyone who doesn't click |
| C. No copy: draw art only in the DM client (from the definition) | No new player-visible data | Players, the main audience for "tell the dragon from the wolves", see initials; DM and players see different tokens |

## Decision

**A** (DM, sprint-4 gate 1, #245). Players see the type art on visible monster tokens by default; the DM sets Art ▸ Initials per token to hide it (OQ-ENT-29 decided, G44). Rejected: B (DM opt-in per token), C (DM-only art).

- ADR-0024's token display copies become: name, image, size and **creature type**.
- `creatureType` is written at placement / duplicate, by the DM's token menu, and once by the definition-changed hook when the definition gains a type it didn't have (null tokens only; a DM's `"initials"` is kept). Like the other copies, it is written only in the instance's own create, its own commands, or the definition's update transaction (never by a listener).
- Later definition type changes don't propagate (the token owns it, like its shape, FR-MAP-35).

## Consequences

- Players learn the creature type of a monster token they can see. Hidden, fogged-out and invisible tokens still send nothing.
- The token-visibility test and the player leak scans cover `creatureType` (FR-ENT-30).
- A future player stat-block reveal (ADR-0024's "own reveal record later") is unaffected.
- B stays possible later as a campaign setting without a schema change (it only changes what placement writes).
