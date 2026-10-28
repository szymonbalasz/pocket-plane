# Sprint 14: fix pack (then the test tooling)

DM decision #366 (sprint-13 recap): the open bugs from sprints 12–13 first; the adopted test strategy's tooling ([proposal](test-strategy-proposal.md)) is built separately afterwards. Lean test rules meanwhile (#354: one heavy run at a time, `PP_TEST_SHARDS=3`, at most two builders, one walkthrough per slice). No spec phase; the orchestrator rules and logs in status.md.

## Slices

| Slice | Branch | Items | Area |
|---|---|---|---|
| **F1** frame | `fix/s14-frame` | BL-129 (a player reload minimises the Party Manager at 1280 with a remembered sheet), BL-134 (Fit with Party Manager at DM 1440 + retire the 8 replay exemptions), BL-136 (launcher label fit independent of the theme), BL-133 (a dragged window's grip out of reach) | play-shell frame, placer, launcher, scenes-map Fit |
| **F2** toasts | `fix/s14-toasts` | BL-130 (stack on window text / older request rows / bell count vs Pending / alerts on a record), BL-132 (roll popup over the Party Manager's tabs), BL-137 (player Notifications history shows DM cards; Initiative scroll to the active row), BL-131 (Initiative with many pending cards) | notifications, dice-extras popup, combat-tracker pending |
| **F4** roll guard | `fix/s14-roll-guard` | BL-135 per DM #367: the server forces a DM roll DM-only when made as a creature hidden from players or whose token name differs from its definition name; leak tests | dice-roll-log `dice.roll` validation |
| **F3** kit nits | `fix/s14-kit` | BL-138, BL-139, BL-141 | various (after F1 + F2) |
| (later) | `fix/test-infra` | the test-strategy tooling | scripts, playwright config |

BL-135: decided (#367), slice F4.

## Progress

| Date | What |
|---|---|
| 2026-10-28 | Planned (DM #366). F1, F2 started |
| 2026-10-28 | DM #367: BL-135 server roll guard (slice F4). F1 (4 commits) and F2 (8 commits) built, not yet tested; **paused by the DM**: the test tooling gets built first in a new session, then this sprint resumes |
