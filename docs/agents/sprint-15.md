# Sprint 15: safer upgrades, play fixes, window memory, linked notes

DM decision [#416](../decisions-log.md): items 1–4 of the [priority build list](../roadmap.md#priority-build-list-2026-10-31). Evidence for the play fixes: `.verify/20261031-102757-session-sim-17/` in the main checkout (copy what a slice needs into its worktree).

## Work

| # | Work | Branch | Items | Starts |
|---|---|---|---|---|
| 1 | Upgrade guards | `fix/upgrade-guards` | BL-172, BL-173 | Now |
| 2a | Play fixes: toasts | `fix/s15-toasts` | BL-175, BL-151 | Now |
| 2b | Play fixes: frame and map | `fix/s15-frame` | BL-174, BL-176, BL-164, BL-171 | Now |
| 3 | Window position memory | `fix/window-memory` | BL-146 with BL-143–145 | After 2b merges (same placer files) |
| 4a | Linked notes spec | `spec/linked-notes` | [world-builder](../specs/post-mvp/world-builder.md), [ADR-0011](../architecture/adr/0011-cross-references.md) | Now |
| 4b | Linked notes build | split by the spec | | After the DM's gate on 4a, and after 1 merges |

## What each one has to do

**1. Upgrade guards**
- A schema change that makes drizzle-kit prompt (a table gains one column and loses another, or a table is swapped for another) must become a `SchemaPushError` with a clear message. It says to add the new column or table and copy at boot, as [ADR-0076](../architecture/adr/0076-explored-memory-shapes.md) did.
- It must not wait on a hidden prompt in a real terminal either: `pushSchema` hides stdout. Only the no-terminal crash has been reproduced, so test the terminal case.
- The "would lose data" refusal only suggests `fixtures:reset`, which refuses a real campaign. Say what to do on real data too.
- CI check: build a DB from the merge base's schema, load a bundle, boot the branch on it, expect a clean start and a readable snapshot. Prove it with a deliberately bad change. On `main`, compare with the previous commit.
- Update AGENTS §9.4 for the new check and add a builder's rule: never rename or drop in place, add and copy at boot.

**2a. Toasts**
- BL-175: damage cards, notices and the tray roll popup stay off PCs where a clear spot exists. The popup's size stays as #348 accepted it. If this needs a spec call, take it to the DM with a pick.
- BL-151: a player's sticky toast keeps off the sheet's Cast / End buttons.

**2b. Frame and map**
- BL-174: Attack on a stat block must not put the stat block away, so Damage is one click away.
- BL-176: a player's map comes back after the Dice tray closes.
- BL-164, BL-171: the reconnect banner never blocks the tool rail or a window's close button.

**3. Window position memory**
- The zone round-trip memory the DM approved in #381: a protected window sent to its zone by a resize comes back on the way up.
- Retire the replay exemptions it and BL-143–145 cover, and report the count before and after. [ADR-0060](../architecture/adr/0060-one-window-placer.md) and [ADR-0064](../architecture/adr/0064-window-memory.md) govern; a conflict goes to the DM.

**4a. Linked notes spec**
- New spec `docs/specs/linked-notes.md`, proposed prefix `NOTES`, from the template. In scope: notes, wikilinks, backlinks, reveal to players, search.
- Out of scope, but must not be designed out: quest log, calendar and session timeline, which build on it next; NPC directory; journal sections; map pins; Obsidian import.
- Bring to the DM's gate, each with options and a pick:
  - ADR-0011's cross-reference model and its four open questions, above all what a player sees when a note they can read mentions something hidden
  - the rich-text format, and whether the DM wants notes reachable from the MCP tools in this slice
  - player-visible parts of a note, and who may search what
- Treat it as leak-sensitive: every note field gets a visibility rule and a leak test per player.
- UI follows [visual-direction](../design/visual-direction.md) and the Gilt & Stone kit.

**4b. Linked notes build**
- Slices come from the spec's build split, then session-sim-18 with notes in the leak scan, then a playtest script for the DM.

## Rules for this sprint

- **Real campaign off limits:** `%LOCALAPPDATA%/PocketPlane`, its backups, port 4090. No builds or servers in the main checkout: its `dist/client` may be serving the real campaign. Walkthroughs run in worktrees.
- **Other sessions are merging to `main`.** Fetch before every worktree and landing; base on `origin/main`; merge, never rebase or force-push. `fix/sheet-full-text` belongs to another session: leave it alone.
- **Upgrade rule from today:** every schema change in this sprint adds, never renames or drops in place. Item 1's check enforces it once merged.
- **Backfill** (between items, [§3a](orchestrator-prompt.md#3a-use-idle-slots-backfill)): BL-177, BL-155–157, BL-150, BL-149, BL-153, BL-142, BL-152, BL-154, BL-158, BL-159.
- **DM gates:** the linked notes spec. Otherwise run autonomously (#141) and report at the end.

## Progress

| Date | What |
|---|---|
| 2026-10-31 | Planned (DM #416) |
| 2026-10-31 | Started: upgrade guards, toasts, frame and map, linked notes spec, all from `origin/main` @ 69bf60c1 |
