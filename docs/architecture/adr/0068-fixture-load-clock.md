# 0068 — CLI fixture loads anchor the seeded clock at load time

- Status: accepted (DM gate, [#339](../../decisions-log.md)) ([OQ-FIX-21](../../specs/fixtures-adapters.md#15-open-questions) A; sprint 9, track FX)
- Date: 2026-10-22
- Amends: [ADR-0022](0022-deterministic-seams.md), decision row "Fixed clock", **for CLI loads only**. IDs, tokens, the per-key seed, "disposable only", the scope and the tiebreak are unchanged.
- Affects: [fixtures-adapters](../../specs/fixtures-adapters.md) FR-FIX-08, FR-FIX-29; [stats](../../specs/stats.md) (fight labels, durations, sessions on fixture data); BL-69

## Context

- ADR-0022 seeds one fixed instant (`FIXTURE_INSTANT` = 2026-01-01T00:00Z) for every load, so timestamps match across runs and bundles.
- The DM's playtest bundles (`session-sim-*`) start a fight in fixtures and leave it running for live play. Its `startedAt` is 1 Jan, but its live lines and End use the real clock. Stats then reads "Fight 3 · Thu 1 Jan" next to "Today" and "Duration 7074 h 18 min" (BL-69, sim-11 and sim-12).
- Real play never mixes the two clocks. The artefact appears only on fixture data that is then played live.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. CLI loads (`fixtures:load`, `fixtures:reset-load`) anchor the seeded clock at the load's start, truncated to the minute (UTC); `bun test` and `bun run e2e` keep `FIXTURE_INSTANT`** | Fixture fights read the play day; durations are minutes; tests and e2e stay byte-identical | Two CLI loads on different minutes differ in timestamps (IDs, tokens, links and counts don't). On `session-sim-12`, the fixture's "past" facts and the live play land in **one** stats session (< 6 h gap) |
| B. Stats takes labels and durations from the fight's first counted fact, with "—" over 24 h | No fixture change | Hides the symptom; fixture facts still date 1 Jan |
| C. Drop BL-69's date half | No change | The DM keeps seeing "Thu 1 Jan" and 7,000-hour durations in every playtest |

## Decision

**A**, written as FR-FIX-29.
- The anchor is one instant for the whole load. The relative offsets between fixture facts are kept: today all are 0 apart, so no fixture changes.
- The loader takes `now?`, and `scripts/fixtures.ts` passes the start time. `scripts/e2e.ts` (`resetAndLoad`) and in-process `loadBundle` pass none.
- A test may pass `now` to check the anchor.

## Consequences

- FR-FIX-08's "identical timestamps" holds per `now`: always in `bun test` and `bun run e2e`, and for CLI loads within one minute.
- Checked: nothing compares digests across two loads. `state:digest` compares one load before and after a kill or restart.
- **Named stats change on `session-sim-12`** (sim-13 expectations follow):
  - Fixture fights (Old Crypt, Ambush) read the load day.
  - The fixture session and the evening's live play are one session, so Session awards and Luck "Today" include the fixture's rolls.
  - Luck "Campaign" totals are unchanged.
  - Walkthrough FX1 step 8 records the before / after.
