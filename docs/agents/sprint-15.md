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
- **Overtaken at the gate (DM #440):** private and shared notes for players, no reveal, no DM-only parts, no link to tokens, the DM doesn't see private notes, live shared writing. The list below is the original plan.
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
| 2026-10-31 | Upgrade guards merged (#424): CI job `upgrade check` on every push |
| 2026-10-31 | Frame and map fixes merged (#432). Linked notes gate: the DM reframed the feature (player notes, private and shared; no reveal); spec to be rewritten |
| 2026-11-01 | Toast fixes merged (#437); window position memory in walkthrough |
| 2026-11-01 | Window position memory merged (#438): failing replay cells DM 6 → 0, players 10 → 4 |
| 2026-11-01 | Backfill BL-177 merged (#439). Stopped at the linked notes gate (#440) |

## Playtest: Notes

Restart `bun run play` in the main checkout (it backs up first, then builds). You and at least two players, each in their own browser; one on a narrow window or a tablet if you can.

| # | Do | Expect |
|---|---|---|
| 1 | Everyone: Notes from the launcher (or the command palette, "Open Notes"). You: New, title "Session notes" | Everyone sees it in their list at once |
| 2 | All three type in it at the same time, on different lines | Everyone sees the others' coloured cursors and names; the text matches everywhere; status reads Saved |
| 3 | A player sits still for a minute, then you click their name chip at the top | Your view jumps to their cursor |
| 4 | Type `@`, then a few letters; pick a note, or "Create note …" | A link chip appears for everyone; clicking it opens the note; Backspace removes it whole |
| 5 | Open the linked note | "Linked from" lists the note you came from |
| 6 | Type `2d6` in a note and click its die | The game log shows "<name> · Note", never the note's title |
| 7 | Rename the linked note while a player types in the note that links to it | The chip shows the new name for everyone; nobody's typing is lost |
| 8 | Search a word someone typed a moment ago | Found, with the word highlighted |
| 9 | A player deletes a note you have open | You see "This note was deleted" with Restore; the Recycle bin says who deleted it; Restore brings it back, text intact |
| 10 | A player turns off their network for 10 s while typing, then back on | Offline, then Saved; their text reaches everyone |
| 11 | Ctrl+Z after others typed | Only your own typing goes; Ctrl+Shift+Z or Ctrl+Y brings it back |
| 12 | Open Notes at the table with the sheet, Dice tray and Initiative up | Notes sits beside them (narrower when space is tight), covering no buttons |

**Added 2026-11-06 (categories, token notes):**

| # | Do | Expect |
|---|---|---|
| 13 | Open Notes | Notes grouped in fold-outs (Session first); your older notes sit in Other |
| 14 | + New: type a title, pick Session | It shows under Session for everyone |
| 15 | Type `@` and a new name, Create note | The eight categories show in the popup; pick one, the chip goes in |
| 16 | Change a note's category in its header | It moves group for everyone |
| 17 | Click Recent | One list, newest edit first, with who and when; click again for groups |
| 18 | A player right-clicks their character's token (long-press on a tablet) | Create note → a Player note with the character's name opens |
| 19 | Right-click a monster token | Create note → NPC note; on a hidden token you're warned that players will see the title |
| 20 | Right-click the same token again | Open note: the same note |

Known and logged: after closing Notes a player's map may stay small (BL-189); a reload reopens Notes on its list, not the open note (BL-191); name tags can cover a line while someone types (BL-187).

## Playtest: sprint 15 fixes

Restart `bun run play` in the main checkout (it backs up first, then builds). DM at 1440×900 and a player at 1280×720, in a fight.

| # | Do | Expect |
|---|---|---|
| 1 | Initiative ⋯ on a monster → Stat block → Attack, roll, close the tray | Stat block stays open and in place; Damage is one click |
| 2 | Player: Fit, open Dice from the launcher, close it | The map moves aside, then returns to the same spot |
| 3 | Player: open the tray, pan, close it | The map stays where the player put it |
| 4 | Turn off one browser's network for 5 s | A small centred pill; Select and close buttons still click; it goes when back online |
| 5 | Player attacks; DM opens the card, clicks a target | Card stays off the PCs, and targets stay clickable |
| 6 | DM rolls from the tray with no card up | Roll popup stays off the PCs and doesn't jump |
| 7 | Player: big sheet, a concentration card up, scroll the sheet | The card moves once after the scroll and sits on no button |
| 8 | Pan PCs under the sheet's corner, close and reopen the sheet, shrink the browser, grow it back | The sheet returns to its spot; if dragged while small, it stays where dragged |
| 9 | Use as attack on a plain roll; 4+ Pending lines; delete a used image; tick a 5etools book in a fight | One "Attack"; no half-cut row; "Used in" with no confirm; Import selected off, "End combat first" |
| 2026-11-05 | Linked notes spec rewritten to the DM's reframe (#440, #442, #444, #445) and merged complete (#446): every note shared, live co-writing, Recycle bin, `@` picker. Build starts |
| 2026-11-06 | Linked notes built (N1–N6, #447–#452) and session-sim-18 22 / 22 PASS (#453). Sprint 15 done |
