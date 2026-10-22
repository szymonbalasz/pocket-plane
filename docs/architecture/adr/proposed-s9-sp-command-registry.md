# Proposed — One client command registry for the palette and keyboard shortcuts

- Status: proposed (sprint 9, track SP; the integrator numbers it at merge)
- Date: 2026-10-22
- Extends: [ADR-0025](0025-play-shell-windows.md) (features register, the shell never changes for them), [ADR-0060](0060-one-window-placer.md) §7 (overlays are registered, never placed).
- Raised by: DM [#338](../../decisions-log.md) (keyboard shortcuts + command palette, Obsidian / VS Code style).
- Affects: [play-shell](../../specs/play-shell.md) FR-SHELL-180–199; every spec that adds a command or a search group ([compendium](../../specs/compendium.md) FR-CMP-69, [session-recap](../../specs/session-recap.md) FR-RECAP-28, later tracks); AGENTS §9.9 (a new append-only registry).

## Context

- The palette lists commands from many features (Reset layout, Next turn, Pause, Session recap, Rules…) and every feature's window; the shortcuts sheet must list every key. If each feature wires its own `keydown`, keys collide (Space-pan, Ctrl+D, Ctrl+Z already exist) and the sheet drifts from reality.
- Every feature action already exists as a click that sends an intent the server checks. A palette or a key needs no new server path.
- Window types are already one registry per client (`windows.ts`), so windows need no extra lines.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One append-only client registry `src/client/common/features/play-shell/commands.ts`: commands `{id, title, keywords?, group, clients, keys?, when?, run}` and search providers `{id, group, clients, search}`; one dispatcher owns all shortcuts; windows generated from `windows.ts`** | One place lists every command and key; a `bun test` catches collisions and keys outside the table; the sheet is generated; no server change | Another append-only file for the integrator; features must not bind keys elsewhere |
| B. Each feature binds its own keys and exports palette items it builds | No shared file | Collisions found by players; the sheet is hand-written; typing / pause guards copied N times |
| C. Commands as server intents ("command bus") | One permission story | Duplicates the intents we have; adds round trips for opening a window |

## Decision (proposed)

**A.**

1. **Client-only.** A command does only what its UI does: open / focus a window, or send an intent that already exists (the server checks it as today). No new intent, event, record or snapshot field. Layout effects go through the shell (`openWindow` `by: "user"`), so window memory applies.
2. **One dispatcher** for shortcuts, mounted by the palette overlay: never while a `blocksInput` overlay is up, never from a typing target or an open dialog / menu (except the palette chord), no repeats, exact modifiers; existing keys (Space, Escape, Ctrl+D, Ctrl+Z, roll modifiers, list arrows, fog Backspace / Delete) are reserved and a test fails if a registry key uses one.
3. **Append-only**: features add their own lines (AGENTS §9.9); a key is assigned in play-shell's §7 table, changed only via the integrator.
4. **Single-key shortcuts can be switched off** (WCAG 2.1.4), per browser.

## Consequences

- AGENTS §9.9 lists `commands.ts` among the append-only registries; protocol §26 lists it with the other registries.
- A feature that wants a key asks for a free letter; the shortcuts sheet and palette pick it up with no other change.
- Rebinding (per-browser key maps) can come later on top of the same registry: the dispatcher reads keys from the registry, so a map is an overlay on `keys`.
- Revisit if a feature needs a key that must work while typing (only the palette chord does today).
