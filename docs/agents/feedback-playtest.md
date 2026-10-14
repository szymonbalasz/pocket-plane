# DM feedback after the MVP playtest (2026-10-14)

Work list for the next phase. **Tiers confirmed by the DM (#171): all five tier S, part of MVP.** P3 / P4 answers in the notes.

## Playtest requests

| # | Request (DM's words, short) | Today | Tier | Specs touched | Notes |
|---|---|---|---|---|---|
| P1 | **Tooltip delay** (~400 ms) on **all** tooltips. They clash with popups, e.g. Roll initiative → the roll dialog and the button's tooltip fight for space while the mouse is still on the button | Tooltips show at once | **S** | play-shell (shared tooltip) | One shared default in `src/client/common/` (shared file, §9.9). Also hide the tooltip when a popover opens from that button |
| P2 | **Token labels**: move up so they sit in the gap between grid cells, not over the top of the cell below; draw them **above** all tokens (today the lower token hides the upper token's label). **Down** becomes a semi-transparent **X** centred over the token, not a label | Label under the token, in token z-order; "Down" label where the name label will now go | **S** | scenes-map (label position + layer), combat-tracker (Down decoration, F8) | Labels on their own layer above the token layer. Check the "Out" overlay (F6) and the token overlays registry (FR-MAP-34) still fit. Related: G9 |
| P3 | **Live drag**: others see a token while it is being dragged, not only where it lands | Only the drop is broadcast | **S** | scenes-map (drag preview), live-sync (ephemeral, unlogged event like ping/laser) | Throttled; never logged or persisted. Visibility: a hidden token's drag never reaches players. **DM: no movement label for others** (only the dragger sees it) |
| P4 | **Hide "Roll initiative"** once round 1 has started; **keep the manual set-by-hand override** | The button stays all combat | **S** | combat-tracker, character-sheet (roll button) | **DM: hide every roll-initiative button** (player sheet, DM row button, "Roll monsters") once round 1 has started; no re-rolls. The DM's initiative number input stays as the only override, incl. late joiners |
| P5 | **DM sees the dice breakdown for NPC damage**, like players' rolls show theirs. Players don't see it | NPC damage shows the total only | **S** | dice-roll-log, combat-tracker (damage card) | DM-only field per the visibility filter; leak test for players. Overlaps G7 (monster rolls get no line of their own) |

## Acceptance glitches still open (#169)

From the [acceptance report](../../.verify/20261013-222244-mvp-acceptance/report.md) (local; archived at `%TEMP%\pocket-plane\verify-mvp-acceptance\`). Planned as one `fix/*`; fold in with P1–P5 where they touch the same code.

| # | Glitch | Goes with |
|---|---|---|
| G1 | Thorn has no token in `session-sim` (fixture gap) | — |
| G2 | Default DM window layout crowds the battlemap at 1440×900 | — |
| G3 | At 1280×720 windows don't reflow (log input behind launcher, Initiative clipped) | G2 |
| G4 | Downed monsters' turns skipped with no cue | P4 |
| G5 | Stale map selection pre-fills attack targets | — |
| G6 | No "End encounter" in the Initiative window | P4 |
| G7 | DM physical rolls not tagged; monster attack rolls have no log line of their own | P5 |
| G8 | Override reads "13 — hit! … vs AC 15"; should say the DM ruled a hit | P5 |
| G9 | PC at 0 HP has no Down badge in the Initiative row | P2 |
| G10 | "2/2 online" stays during a server outage | — |
| G11 | Every token uses the same silhouette art | — |
| G12 | Cosmetic: fixture clock "02:00", "— natural 1" wording, shared group roll not stated | — |

## Suggested sequencing

1. ~~DM confirms tiers and the open points (P3 label, P4 scope).~~ Done 2026-10-14 (#171).
2. Spec revisions (one agent): scenes-map (P2, P3), combat-tracker (P2 Down, P4, G4, G6, G9), dice-roll-log (P5, G7, G8), play-shell (P1), live-sync (P3 event).
3. Builds: `fix/tooltip-delay` (P1, tiny, first) → scenes-map build (P2, P3) → combat/log build (P4, P5, G4–G9) → `fix/playtest-glitches` (the rest).
4. Then post-MVP planning ([continue-session §2.4](continue-session.md#2-next-in-order)).
