# Test strategy proposal (DM #354)

> **Status (2026-10-28, #368):** superseded by the GitHub CI loop ([AGENTS §9.4.1](../../AGENTS.md#941-the-test-loop-targeted-locally-everything-in-ci)): CI runs the full suite on every push, so the heavy-run lock (1), branch gates and the impacted-e2e runner (2) are dropped. Kept and built in `fix/test-infra`: one automatic e2e retry reported as flaky (3), screenshot baselines (4, rendered in CI), builders test lightly (5: targeted `bun run check`), the BL-128 / BL-140 flake fixes.

The DM found the test loop too slow and too heavy (sprint 12: overlapping full checks, e2e and walkthrough browsers ran the 64 GB machine out of memory). This proposal is for the sprint-13 recap.

## What sprints 12–13 cost

| Item | Cost | Value seen |
|---|---|---|
| Branch gates (`check:full` + full e2e, 104 bundles) | ~14 min per run, often 2 runs per slice | Caught real regressions: drag reorder, the sheet's gem block, launcher geometry, a log selector, a CSS merge break |
| Agent walkthroughs | 32 runs (12 re-tests), 20–40 min each, 2 servers + up to 3 browsers | Caught a leak (K7), layout bugs, every kit gap; the only judge of "looks like the kit" |
| Load flakes | `popup-line`, `combat2-polish` (random dice), `gems-reroll`, `fog-of-war`, `dice-tray-3d`: failed under load, passed alone | None: each cost a manual re-run |
| Session-sim | ~35–60 min once per sprint | Whole-app regression, leak scan, hard kill |

The checks are worth having. The waste is in running everything for every change, running it in parallel, and chasing flakes by hand.

## Proposal

1. **One heavy-run lock, enforced by a script.** `check:full`, e2e, walkthrough servers and gates take a machine-wide lock file and queue. Builders can't overlap without knowing it. This makes DM #354's rule automatic.
2. **Branch gates run only what a change can break.** Each e2e spec already names its bundle; add the folders it covers. A branch gate runs `check:full` plus the e2e specs for the touched folders and a 10-spec smoke set (~5 min instead of ~14). The **full** e2e runs on `main` once per merge batch (every 2–3 merges) in the gates worktree.
3. **Fix the flakes, then quarantine.** Seed the dice where a spec depends on a roll (BL-140), fix `popup-line` (BL-128). A short quarantine list gets one automatic retry, reported separately, so nobody re-runs by hand.
4. **Automated screenshot checks for the look.** Per kit area, both themes, a Playwright screenshot baseline (`toHaveScreenshot`) in the e2e suite: Simple Dark must not change, Gilt & Stone must not regress. Agent walkthroughs stay for new behaviour and judgement calls only, with at most 2 browsers. Re-tests check only the failed steps, as now.
5. **Builders test lightly.** Tests in the touched folders + typecheck + lint while working; one plain `check` before "ready". The orchestrator owns `check:full` and e2e.
6. **Keep:** at most two builders, `PP_TEST_SHARDS=3`, one session-sim per sprint (trimmed to ~30 min).

Expected effect: heavy runs per slice from ~1–1.5 h to ~30–40 min; memory peak bounded by the lock; fewer manual re-runs.

## To build it

One tooling slice (`fix/test-infra`, shared files `scripts/`, `playwright.config.ts`, `package.json`): the heavy-run lock, folder-to-spec mapping and the impacted-e2e runner, the quarantine retry, screenshot baselines for the kit areas, the BL-128 / BL-140 flake fixes. About one day of builder time.
