# Proposed — Dice landing, popup line and compressed client

- Status: proposed (sprint 5, track D; for DM gate 1)
- Date: 2026-10-18
- Amends: [ADR-0044](0044-3d-dice.md) row **Truth** ("the log line never waits"); [ADR-0048](0048-dice-display.md) rows **Popup: dice**, **Cost**
- Keeps: [ADR-0001](0001-tech-stack.md) server-authoritative dice, [ADR-0022](0022-deterministic-seams.md) `ctx.dice`, ADR-0044 Visibility / Randomness / Looks, ADR-0048 Where / Which rolls / DM-only / Timing / Library
- Affects: [dice-extras](../../specs/dice-extras.md) (FR-DICEX-46–52), [dice-roll-log](../../specs/dice-roll-log.md) (FR-DICE-40, 41), [play-shell](../../specs/play-shell.md) (toast region constants), server core (static serving), tooling (build)

## Context

- DM [#250](../../decisions-log.md) [2]: the popup's dice keep their scene positions and shrink (BL-22: 10d6 = dots); show them in a line at full size. [3]: the tray shows the 3D dice that will be rolled.
- Session-sim-8 glitch 8 (#251 track D): the tray and log totals show while the die is still flying. ADR-0044 decided "the log line never waits".
- BL-21: the 632 KB `dice3d` chunk is served raw and uncached; a reload on a slow link re-downloads it and the first throw goes flat.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Per-client landing (numbers wait for this client's dice; line at once); popup dice in fixed slots; tray stills on the one context; precompressed + immutable static files** | No server, event or field change (0 B, measured baseline); every surface consistent; no new dependency; brotli `dice3d` 132 KB (−79 %) | Clients show numbers at different moments (by design); `app.ts` + `vite.config.ts` edits (shared, sequenced) |
| B. Server delays the result (or broadcasts a "landed" signal) | Everyone sees numbers together | Breaks ADR-0001 / 0044 (server never waits); new signal with its own visibility |
| C. Keep "line at once with numbers"; only the popup holds | Nothing changes | Leaves glitch 8 as is |

## Decision

**A** (proposed; framing in dice-extras OQ-DICEX-33–41, dice-roll-log OQ-DICE-30).

| Rule | Detail |
|---|---|
| Truth (amended) | Unchanged: the server's values, relabelled faces, pre-computed motion. **The line still renders on arrival; its die values and total wait for this client's landing** (its dice rest; flat after the chip fade; nothing animating → at once; cap 6 s). Snapshots never hold |
| Popup: dice (amended) | The same dice, laid out in a line of fixed slots (44 px pick), wrapping to 2 lines, then "+N" (pick); big dice fly to their slots; miniatures tumble into them; chips use the same slots |
| Previews (new) | The tray draws the staged dice as 3D stills on the page's one WebGL context, copied into the tray's own canvas; no render loop |
| Cost (amended) | Built JS / CSS precompressed at build (`.br`, `.gz`, `node:zlib`) and served by Hono `serveStatic({ precompressed: true })`; `/assets/*` immutable, HTML `no-cache` |

## Consequences

- No protocol, schema, event or record change; CON-44 0 B (re-run 2026-10-18: heavy DM 674,452 B, players ≤ 284,256 B).
- `toast-region.ts` popup constants 320 × 190, set by track W's W1 with the toast corner sized for them (seams S2); D's popup slice edits only the popup's internals.
- Whole client lighter on the wire: player initial 1.21 MB → 322 KB brotli; repeat loads transfer nothing unchanged.
- Numbers outside the dice surfaces (Initiative order, combat cards) are not held unless the DM picks otherwise (OQ-DICEX-39).
