# Continue: orchestrator session handover

Paste into a new opencode session started in `C:\Repos\pocket-plane` inside Herdr:

> Read `docs/agents/continue-session.md` and continue as the orchestrator.

---

You are the **orchestrator and integrator** for Pocket Plane. Your full role, rules, agent brief templates and phase plan are in [orchestrator-prompt.md](orchestrator-prompt.md). Read it first, then this file, then [status.md](status.md). Follow [AGENTS.md](../../AGENTS.md) §1 (short replies; 1–2 questions at a time, each with options and your pick).

## 1. Where we are (2026-10-12)

| Area | State |
|---|---|
| Phase 0–1 | Done. Foundation specs (live-sync, campaign-management, fixtures-adapters) `complete`. Build conventions in AGENTS.md §9 approved. |
| Phase 2 skeleton | **Merged to `main`** (`f0592c1`). 96 tests, build and E2E green; walkthroughs PASS. |
| Scenes specs | assets-pipeline, entities, play-shell, scenes-map `complete`; consolidated into [data model](../data-model/README.md) and [protocol](../protocol/README.md). |
| ADRs | 0001–0026 accepted (0018–0026 added this session). |
| Decisions | Logged up to #130 in [decisions-log](../decisions-log.md). |
| Worktrees | None besides `main`. `main` has its own `.env` (slot 1: dev 4110/4111, verify 4112). |

**Waiting on the DM:**
1. DM runs the skeleton with [demo-skeleton.md](demo-skeleton.md) and says go.
2. Reconnect time: live-sync §3 wants "live ≤ 2 s after the server is reachable"; FR-SYNC-05 backoff caps at 5 s (measured up to 5.3 s). Pick: lower the cap to 1.5 s (spec + code change).

**Next, in order, after "go":**
1. `fix/scenes-core` (one builder; shared files): ADR-0026 signal routing (server stamps sender, DM-only `map.pull`, receivers filter by scene); CON-22 (`sceneOf(record)` in record-type registration, scene filter on live events, not only snapshots — otherwise DM edits on an inactive scene leak to players); CON-23 (hook after commit, before listeners, for the active-scene cache); CON-24/25 + remaining open CON-18–33 rows in data-model §8 / protocol §11; the reconnect cap if approved. Walkthrough with the sync-probe bundle, merge.
2. Scenes builders in this order (shared registries are append-only, AGENTS §9.9): **play-shell** (creates the window registries) → **assets-pipeline** → **entities** (adds the real definition table; plugs into the import pipeline via `services.imports`) → **scenes-map**. Max 4 working agents total; sequence shared-file changes per AGENTS §9.9.
3. In parallel when slots allow: **Combat specs** (character-sheet, dice-roll-log, notifications, combat-tracker) through the per-phase cycle: spec → review → DM gate → revise → consolidate. Open questions already waiting for combat-tracker: OQ-MAP-03/11/21, OQ-ENT-10/15, OQ-CHAR-04.
4. Scenes gate: demo script for the DM (town → battlemap, tokens moved by DM and player, hidden token revealed).

## 2. Herdr: how to run agents (learned the hard way)

Load the `herdr` skill. Check `HERDR_ENV=1`; if not set, stop and tell the DM.

**Find your workspace first.** `herdr pane current --current` → `workspace_id` (was `wR` last session; IDs can change). Use it everywhere below as `<ws>`.

**Create a worktree + agent**
```powershell
$r = herdr worktree create --workspace <ws> --branch <type>/<slug> --label <slug> --base main --no-focus | ConvertFrom-Json
# MUST check: $r.result.workspace.worktree.repo_name -eq 'pocket-plane'
$p = herdr pane split $r.result.root_pane.pane_id --direction right --no-focus | ConvertFrom-Json
herdr agent start <name> --kind opencode --pane $p.result.pane.pane_id --timeout 90000
```
- **Always pass `--workspace`.** Without it Herdr uses the UI-focused workspace; it once created worktrees in another repo.
- Read-only reviewers don't need a worktree: start them in a new tab of `<ws>` (`herdr tab create --workspace <ws> --label reviews --no-focus`).
- `build/*` and `fix/*` worktrees: run `bun install` and `bun run env:init` in them before the builder starts (or tell the builder to).

**Prompting**
- Write each brief to `%TEMP%\opencode\briefs\<name>.md`, then send it with `herdr agent prompt <name> $text`. Sanitise first: replace `"` with `'` and keep it **ASCII only** (`→`, `§`, `–` broke argument parsing once).
- Don't use `--wait` for long work. A fresh agent sometimes doesn't start (`agent_prompt_stalled`): check `herdr agent get <name>` after ~10 s and resend if still `idle`.
- Poll in one command: loop `herdr agent list` every 30 s, cap ~14 min, stop when any watched agent leaves `working`.
- Read results only when the agent is idle/done: `herdr agent read <name> --source recent-unwrapped --lines 60`. While working, only `--source visible` works.
- Long reports: have the agent write findings to `%TEMP%\opencode\<name>.md` and reply with a summary. To hand review findings to a revision agent, copy the file into its worktree as `.review.md` and tell it to delete it before committing.
- If an agent is interrupted (token refresh rate limit, dropped turn), prompt it to "continue from where you stopped"; its context is intact.

**Blocked agents:** read the prompt. Dependency or product questions → ask the DM, never approve on their behalf. A permission request to read another worktree is out of brief → choose Reject (`herdr agent send-keys <name> right right enter`) and re-prompt.

**Test agents (browser walkthroughs)**
- Run in the builder's worktree, in a new tab. Give each test agent: its own `PP_PORT` (e.g. 4103, 4104…), `PP_DATA_DIR=data/verify-<name>`, `PP_PROFILE=verify`, and a **dedicated Herdr server pane**. Agents must never start the server from their own shell (it hangs on Windows); they use `herdr pane run <pane> "<env>; bun run start"`, `herdr pane send-keys <pane> ctrl+c`, `herdr pane read <pane>`.
- Build the client once yourself (`bun run build`) before starting parallel test agents.
- Browsers: Playwright MCP servers `pw-dm`, `pw-player-1`, `pw-player-2` from the repo `opencode.json`. Agents started after that file existed have them.
- Evidence goes to `<worktree>/.verify/<run-id>/`. Before removing a worktree, copy `.verify` to `%TEMP%\opencode\verify-<task>\`.
- Brief template: orchestrator-prompt §5 "Test agent" plus the isolation and server-pane rules above.

**Merging and cleanup (always)**
1. Check `git -C <worktree> log --oneline main..HEAD` and `status --short`, and for builds run `bun run check` + `bun run build`.
2. `git merge --no-ff -m "Merge <branch> (…)" <branch>` on `main`.
3. Close the agent pane and the root pane (`herdr pane close`), wait 2–3 s, `git worktree remove <path>`, `git branch -d <branch>`, `git worktree prune`. If an empty directory is left behind, delete it.
4. Update `status.md`, the spec index, the glossary and the decisions log as the integrator; number proposed ADRs at acceptance.

## 3. PowerShell gotchas

- Don't name a helper function `R` (it's the built-in `Invoke-History` alias).
- In `[regex]::Replace`, write `${1}` when digits follow a backreference (`$100…` broke 9 ADR links once).
- Console output shows `—`/`§` as mojibake; the files are fine. Edit with the Edit tool or `[IO.File]` read/write (UTF-8, LF).
- Format new JSON/TS files with Biome (`bun x biome format --write <file>`) before committing, or `bun run check` fails.
- `opencode.json` is committed; your own session only loads MCP servers at start.

## 4. Don't forget

- Ask the DM before: a new phase, accepting/superseding an ADR, a dependency outside ADR-0001 / #110 / #119, anything destructive, or reading their personal config.
- Token display name belongs to the token (Goblin 1 / Hugo); definition edits only refresh image and size (#126).
- Keep `status.md` current; it's how the next session picks up.
