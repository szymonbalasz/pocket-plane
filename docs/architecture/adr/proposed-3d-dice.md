# 0044 — 3D dice: cosmetic throws from received roll entries

- Status: accepted (#207, 2026-10-16)
- Date: 2026-10-16
- Amends: [ADR-0001](0001-tech-stack.md) (stack table gains a client-side "3D dice" row: `three` 0.186 + `cannon-es` 0.20, MIT, lazy-loaded; [OQ-DICEX-01](../../specs/dice-extras.md#15-open-questions), #207 G1)
- Keeps: [ADR-0001](0001-tech-stack.md) "dice results are server-authoritative", [ADR-0022](0022-deterministic-seams.md) (`ctx.dice` is the only source of results), [ADR-0021](0021-sync-protocol-conventions.md) (no optimistic intents)
- Affects: [dice-extras](../../specs/dice-extras.md), [dice-roll-log](../../specs/dice-roll-log.md), [play-shell](../../specs/play-shell.md), [effect-modifiers](../../specs/effect-modifiers.md) (tier-2 boxes sit on the tray)

## Context

- DM (#188, #203): 3D dice, tier S; "every roll in the app eventually goes through it"; results stay server-side.
- Every dice-making command already writes a `roll`-kind game-log entry with per-die results in its transaction ([FR-DICE-19](../../specs/dice-roll-log.md#6-functional-requirements), [-26](../../specs/dice-roll-log.md#6-functional-requirements)); players receive exactly the public ones ([FR-DICE-15](../../specs/dice-roll-log.md#6-functional-requirements)). DM-only dice live in `dmPayload` ([FR-DICE-28](../../specs/dice-roll-log.md#6-functional-requirements)).
- A 3D / physics library is the first heavy client dependency; the player client loads over a tunnel ([ADR-0003](0003-local-hosting.md)).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Throws derived on each client from `roll` entries it received (live frames only); settle-to-result locally** | No new event, signal or visibility path; hidden rolls can't animate for players by construction; reload never replays; no server change | Each client simulates (seeded by entry id, so the tumble matches anyway); dice start only when the entry arrives (pending shake covers latency) |
| B. Roller's client broadcasts a "dice thrown" signal with throw parameters, others replay | Identical motion everywhere, motion can start before the commit | New signal with its own visibility rule that must mirror the entry's (leak risk for hidden rolls); motion before the result exists |
| C. Client rolls, server verifies | Instant | Contradicts ADR-0001 / ADR-0022; rejected |

## Decision

**A** (DM, sprint-3 gate 1, #207).

| Rule | Detail |
|---|---|
| Library | `three` 0.186 + `cannon-es` 0.20 (159 KB gz, MIT, no assets, no CDN); we write meshes, face textures and settle-to-result |
| Where | Throw zone over the shell's free area (overlay layer, never over a window); the dice tray window is for composing |
| Looks | Server record `dice-look` per owner (style + colours + material), full visibility; every client draws the roller's look |
| Source | A throw = the live `game-log-entry` upserts of kind `roll` in one frame with `n` above the client's highest seen `n` (coalesced, ≤ 20 3D dice). Snapshots, resyncs and undo upserts never throw |
| Truth | Dice rest on the server's values; the client relabels faces after a headless simulation (≤ 2.5 s, tested headless in `bun test`). The log line never waits for the animation |
| Visibility | Exactly the entry's; a throw reads `payload` only, never `dmPayload` |
| Randomness | Throw motion uses a client PRNG seeded by the throw's first entry id; cosmetic only, never `ctx.dice`, never sent |
| Cost | 3D code in a lazy chunk, loaded on the first 3D throw; per-device render setting (3D / flat / off), reduced motion → flat; no render loop when idle |
| Roll control | The dice tray is the roll control's staging host (buttons roll at once, Alt+click stages); roll intents and server commands are unchanged |
| Limits | ≤ 20 3D dice per throw, rest as chips; no sound |

## Consequences

- No protocol change for animation; `dice-look` is the only new record type (OQ-DICEX-06, #207; ≈ 2.2 KB in the heavy DM snapshot, not lazy).
- New client dependency must stay out of initial chunks; the 3D chunk has its own size cap (bundle-size test in the build).
- A future log kind that carries fresh dice must map them for throws (only `roll` throws today). MOD bonus dice and offered trigger parts (Divine Fury) ride on the `roll` entry's damage item as MOD parts and `offered` items, each with per-die `dice` (effect-modifiers, sprint-3 review R1), so they throw with no special case.
