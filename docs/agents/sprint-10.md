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
| 2026-10-24 | **H3 merged** (DM toast stack off window content, first rows and modal dialogs; slides beside windows, back home after a dialog, folds only what doesn't fit); walkthrough 5 / 8 → re-tests 7 / 8, 9 / 10, 12 / 12. All four slices on `main` |
| 2026-10-24 | Final `main` check 5,587 / e2e 238 / bench 41 / 41. **session-sim-14 13 / 13 PASS** (leak scan clean, hard kill byte-identical); glitches → BL-107–BL-114. [Playtest: sprint 10 fixes](#playtest-sprint-10-fixes) written. Decision #342. Paused for the DM recap |
| 2026-10-24 | Recap part 1–2 (#343, #344): **T2 merged** (players' "Most damage dealt" withheld while hidden damage could change its winner; a hidden pet leaves other players' data); **T3 merged** (Stats opens on a **Campaign** tab). #345: faster test loop (process + T4 tooling) |
| 2026-10-24 | **T1 merged**: Dice tray 504 × 420 by default, dice 56 px (≥ 48 px when the tray has to open at 360 × 300) |
| 2026-10-24 | **T4 merged** (#345): `bun run check` ~2 min (was 8–16), `check:full` ~3 min, full e2e ~10 min on 4 workers (was ~27). Decision #346. Paused for the rest of the recap |

## Playtest: sprint 10 fixes

Run from `C:\Repos\pocket-plane` on `main` (PowerShell). About 15 minutes. **DM** (normal browser) + **Player 1** (incognito: Mira and Brakka) + **Player 2** (another browser: Thorn). Regression run: [session-sim-14 report](../../.verify/20261024-061849-session-sim-14/report.md) (local, gitignored): **13 / 13 PASS** on final `main` (check 5,587, e2e 238, bench 41 / 41), leak scan clean for both players, a hard kill mid-fight with a hidden "Add hidden" monster restarted byte-identical. Every sim-13 FAIL and glitch is fixed or ruled by design. New small glitches: BL-107–BL-114 in the [backlog](backlog.md).

### Setup

```powershell
git pull; bun install
bun run build
bun run fixtures:reset-load session-sim-13 --profile verify
bun run start --profile verify
```

Open the printed DM URL (paste the secret) and each player link in its own browser. Show Goblin Ambush from Scenes if Town is live; close Player 1's handout popup if it appears. Hard-reload any tab that was open before the restart (Ctrl+Shift+R). Exact sizes: F12 → device toolbar → Responsive.

### What changed and how to see it

| # | Fix | You do | Expect |
|---|---|---|---|
| 1 | **Add hidden really hides** | Mid-fight: Initiative → **Add…** → Elite Goblin Warrior, tick **Create tokens** + **Add hidden** (it binds the visible Elite Goblin Warrior 2) | Its row has the eye-off, its token goes faint for you and disappears for both players; a hit on it never names it to them |
| 2 | **Roll requests use your dice settings** | **Requests** → All PCs, Perception, Send. Player 1 clicks **Roll** on the prompt | Big 3D throw on screen (not the tray); **Alt+click** sends it to the tray. Player 2 with flat dice: popup only; with physical dice on: the "Physical dice" form opens above the prompt and its buttons work |
| 3 | **Players' overkill award** | Big hit on a low-HP goblin, then **Stats → Session** (and Recap) on all three | You: "Biggest overkill 26"; players: "Biggest overkill 33 damage" (the hit, never the overkill number) |
| 4 | **Party Manager 600 px** | Launcher **Party Manager** (DM 1440×900, PCs not under it; players) | About 50 px wider than before; still 440 when space is tight |
| 5 | **Two windows can stay** | DM 1440: open Party Manager, then a stronghold's window. Player 1 out of a fight at 1280×720: Recap + Stats | Both stay open (the first one narrows, and grows back when the other closes). With the PCs mid-map one may still be put away (PCs first) |
| 6 | **No more zoom into a corner** | Drag the Compendium over the map centre, reload; then 1280×720 → 1440×900 → 1280×720 with Party Manager open | The map stays at a normal Fit (not the tiny "PCs only" view); windows and the view come back after the round trip |
| 7 | **DM toasts keep off windows** | Queue 4–5 damage cards (players' Attack + damage) with Scenes open at 1280×720; open Rules; open Initiative → **Start** then Escape | Scene rows, Rules tabs / search and the Start dialog stay clickable; the stack sits beside or below, and returns home after the dialog |
| 8 | **Rules land on the card** | `Ctrl+K` "cover" → Enter (Rules closed); then "opportunity" with Rules open | The card opens with its heading at the top of the list |
| 9 | **Rule text renders** | Rules → Combat → Grappling | No "srd:…" text: "grappled" / "prone" are links that open those cards; the indented quote is a quote, no ">" |
| 10 | **House rule badge, recap speed, confirms** | A DM-only house rule; kill something with the Recap open; Stronghold → remove a facility / Delete stronghold (cancel) | "DM only" badge on the collapsed row (you only); Recap updates within ~1 s; the confirms say what happens, not the title twice |
| 11 | **Party item → Stores** | Player 1: **Party Manager → Inventory** → an item → **Move…** | "Greystone Keep Stores" is offered (never the secret tower); the item moves there for everyone |
| 12 | **Bigger Dice tray** (#343) | Launcher **Dice tray** (or `D`) on all three; stage d20 + 2d6 + d8 | Opens about 504 × 420 where there's room (dice ~56 px, 40 % bigger); where the PCs leave little room it opens 360 × 300 with dice still ~48 px; Roll always visible. A tray you resized before keeps your size |
| 13 | **Campaign stats** (#344) | Launcher **Stats** (or `S`, or palette "stats") on all three | Opens on the new **Campaign** tab (first): sessions · fights · monsters slain; each PC's lifetime Dealt / Taken / Healed / Kills / Down / nat 20s / 1s / Fights (same as their sheet's Trophies); campaign records with who and when; awards won per character. Players' numbers leave out hidden monsters and your hidden rolls |
| 14 | **Your two calls** (#343) | Damage a hidden monster "from" a PC, then Stats → Session; hide the Owlbear mid-fight | Players don't get "Most damage dealt" when hidden damage would change its winner (you still do); Player 2 loses the Owlbear entirely while hidden and gets it back when you show it; Player 1 (owner) unchanged |

### Known gaps (backlog)

- Fit with an untouched Party Manager mid-map at 1440 still zooms to the PCs-only view (BL-107); the pending-actions toast can still cover window content when no clear spot exists (BL-108); a player's Rules beside Recap + Stats puts both away (BL-109).
- Next skips a downed companion without the "Skipped" toast (BL-110); the Dice tray stays open after an Alt → tray prompt answer (BL-112); small items (BL-113).
- Decided at the recap (#343): BL-111 and BL-114 are built (row 14). The DM's dev loop got faster (#345): `bun run check` ~2 min, full e2e ~10 min.

## Check `main` any time (DM)

Bundle **`session-sim-13`**.

```powershell
bun install
bun run build
bun run fixtures:reset-load session-sim-13 --profile verify
bun run start --profile verify
```

Open `http://127.0.0.1:4112` (hard-reload a tab that was open before the restart: Ctrl+Shift+R).
