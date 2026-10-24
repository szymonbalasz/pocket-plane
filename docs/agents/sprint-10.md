# Sprint 10: hardening run

DM decision #341 (sprint-9 recap + sprint 10 scope): a **hardening sprint** from the session-sim-13 findings and the backlog, run **overnight from the kickoff prompt to done**. **No spec phase and no DM gate unless something truly blocks** (a product decision that can't be ruled by the specs, an ADR change, a new dependency, anything destructive): the orchestrator rules everything else, logs it, and reports at the recap. Process: [orchestrator prompt](orchestrator-prompt.md), [continue-session §3](continue-session.md#3-herdr-how-to-run-agents-learned-the-hard-way) and its lessons (sprint 9's first). Sprint 9 for reference: [sprint-9](sprint-9.md).

Evidence: the [session-sim-13 report](../../.verify/20261023-193558-session-sim-13/report.md) (local, gitignored; copy into each worktree) and [sprint-9 "Known gaps"](sprint-9.md#known-gaps).

## Slices (four builders at once; one walkthrough each)

| Slice | Branch | Items | Area (files) |
|---|---|---|---|
| **H1** combat + dice | `fix/h1-combat-dice` | **BL-97** first (Add… with "Add hidden" ignored when it binds an existing visible token: the creature joins public and players see its name: leak-like); **BL-105** (a roll-request prompt's Roll always goes to the tray instead of following the player's dice settings (3D on screen / popup / flat); FR-DICEX-83 says it is the normal roll button: Shift / Ctrl, physical dice, Alt → tray); **BL-103** (players' "Biggest overkill" shows the hit's damage: per FR-STATS-21 / -22 players never learn an overkill amount, so show what the spec allows or leave the card out; the DM keeps the amount); **BL-92** (fold the three remaining `updateNotification` callers into their domain event, one frame each); **BL-95** (make `e2e/roll-popup.e2e.ts` deterministic) | combat-extras Add dialog + combatant create, dice-extras `PromptBody.tsx` / roll control, combat-tracker `damage.ts` / `hit.ts`, stats awards / recap read, roll-popup e2e |
| **H2** window frame + Party Manager | `fix/h2-frame` | **BL-106** (Party Manager default width 550 → **600 px**, about 50 px wider; useful stays 440, band-capped at small screens); **BL-99** (Party Manager and the Stronghold window put each other away on the DM at 1440×900; players at 1280×720 keep only one of Recap / Stats / Party Manager / Rules open: fix the put-away / useful sizes so two common windows can stay); **BL-100** (after a reload with a remembered window over the map centre, the DM's Fit falls to the 48-px "PCs only" view in a corner); from **BL-104**: the DM's Party Manager opens 456 / 340 px at 1440 (players 550), a hidden-present pet loses its "In combat" chip; **BL-93** (win back as many named layout-harness exemptions as the fixes allow; never add new ones without a reason) | play-shell frame (placer, manager, size-table, replay + goldens), scenes-map camera, party-board window + StatusTab |
| **H3** toasts | `fix/h3-toasts` | **BL-101** (DM toasts still cover window bodies / dialogs: card toasts over the Scenes list, "Saved …" toasts over the Rules tabs and search, the stack at x 324 over Scenes while Notifications is open, toasts over the modal Start dialog's title): toasts keep off window bodies' first rows and off open modal dialogs where a clear spot exists; else today's fallback | notifications `ToastRuntime.tsx`, `keep-out.ts`, `toasts.ts`, `stack-inputs.ts` |
| **H4** rules, recap, strongholds, misc | `fix/h4-rules-misc` | **BL-98** (palette "cover" / "Open in Rules" must land on the card: expanded and its heading in view, fresh or already open); **BL-102** (rule cards print "srd:prone"-style link tokens and a literal ">" on indented quotes: render them as links / quotes); from **BL-104**: a DM-only house rule unmarked in the collapsed list, recap live refresh ≤ 2 s, the remove-facility confirm repeats its title as its body; **BL-96** (players can move a party-inventory item into a shown stronghold's Stores from the UI, as the server allows); **BL-94** (one shared credential / session helper for the palette and skip toast) | compendium rules window + adapter, session-recap client, strongholds confirm, party-board Inventory / loot Move form, client session helper |

Dropped as by design: BL-104's "sounds locked until the first click after a load" (FR-SHELL-25: browsers need a gesture).

## Orchestrator: how to run this sprint

1. Write the four builder briefs (`mkbuild.py` from `slices.json`, `SPRINT_VERIFY=.verify/sprint10` with this file as the plan; no seams / rulings / gate files this sprint: put a one-line `seams.md` naming the hotspot rules below) and start all four at once (`startslice.sh`). Copy the session-sim-13 evidence into each worktree.
2. **Spec deltas:** these are `fix/*` branches, so the orchestrator assigns each its spec rows: where a fix changes behaviour, the builder amends the matching FR row (or adds a note) in the spec named in its brief, in its own branch. The integrator checks the wording at merge. No new FR ranges are needed; if a builder needs a new FR id, it takes the next free number in that spec and says so in its report.
3. **Rulings without the DM:** pick the spec-consistent, leak-safe option; log it in status.md "Integrator rulings this sprint" and in the gate decision. Only stop for the DM on a real product call the specs can't answer.
4. Every slice: builder → "ready for walkthrough" → test agent (thin walkthrough of its items, DM + two players, leak scan where visibility is involved, reload, hard kill where state changes) → fixes → merge `main` into the branch + `check` + full `e2e` in the branch → merge → `check` + full `e2e` on `main` **in a detached gates worktree** (never rebuild `main`'s own `dist/`; never merge while `main`'s gates run). Regenerate goldens / `replay.failing.json`, never hand-merge them; when two branches touch window registries / goldens, the builder does the merge.
5. Backlog backfill (DM #286) when a slot is idle and nothing here can start; stop near the end.
6. Sprint gate: **session-sim-14** on final `main` in the gates worktree (bundle `session-sim-13`, or `session-sim-14` if a slice adds units): re-check every sim-13 FAIL / glitch and every item above, the full regression, leak scan per player, hard kill. Then a "Playtest: sprint 10 fixes" section here (what changed and how to see it, short), then **pause and recap with the DM**. Clean up worktrees, panes, tabs.

## Boundaries and hotspots

| Overlap | Rule |
|---|---|
| Play-shell frame (placer, manager, placement, shell-store, size-table, goldens, replay harness), scenes-map camera | **H2** holds them all sprint; others append only |
| Toast runtime (`ToastRuntime.tsx`, `keep-out.ts`, `toasts.ts`, `stack-inputs.ts`) | **H3**; H2 doesn't touch it (H3 reads window rects as H2 leaves them) |
| party-board | H2: `window.ts` (size row), `StatusTab.tsx`; H4: Inventory tab / Move form only |
| combat-tracker server (`damage.ts`, `hit.ts`, cards), combat-extras Add, dice-extras prompt, stats awards | **H1** |
| compendium rules, session-recap client, strongholds client | **H4** |
| Schema (`src/server/db/`) | none expected; if a slice needs it, it holds the lane alone |
| Fixtures | existing bundles keep behaving; state-changing e2e specs get their own alias bundles |

## Progress (updated as slices merge)

| Date | What |
|---|---|
| 2026-10-24 | Planned (DM #341): hardening run, no gate unless blocking; briefs `%TEMP%/pocket-plane/briefs/build-h{1,2,3,4}.md`, slice defs in `slices.json` (`h1`–`h4`) |
| 2026-10-24 | All four builders started (H1 combat + dice, H2 window frame, H3 toasts, H4 rules / recap / misc) |
| 2026-10-24 | **H4 merged** (Rules opens on the card, rule links / quotes render, DM-only house-rule badge, recap refresh ≤ 2 s, confirm bodies, party item → Stores, one session helper); walkthrough 11 / 11 |
| 2026-10-24 | **H1 merged** (Add hidden on a bound visible token joins hidden; request Roll follows dice settings, physical form reachable; players' overkill award reads as damage; one frame per card update; roll-popup e2e steady); walkthrough 7 / 8 → re-test 5 / 5 |
| 2026-10-24 | **H2 merged** (Party Manager 600 px; windows shrink in place before one is put away; Fit and resize round trips no longer fall to the 48-px PCs-only view; DM Party Manager full width at 1440; layout-harness failures DM 10 → 7, players 37 → 30); walkthrough 5 / 6 → re-test 5 / 5 |

## Check `main` any time (DM)

Bundle **`session-sim-13`**.

```powershell
bun install
bun run build
bun run fixtures:reset-load session-sim-13 --profile verify
bun run start --profile verify
```

Open `http://127.0.0.1:4112` (hard-reload a tab that was open before the restart: Ctrl+Shift+R).
