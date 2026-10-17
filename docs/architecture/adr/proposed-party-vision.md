# Proposed — Party vision, sight while dragging, 999 ft default vision

- Status: **proposed** (sprint 4, track V; for DM gate 1). Picks are marked as picks, not decisions. The integrator numbers it at merge
- Date: 2026-10-17
- Refines: [ADR-0042](0042-dynamic-vision.md) (dynamic vision). Supersedes in part its picks OQ-FOG-20 A (own characters only → still the default, plus a party switch), OQ-FOG-26 A (vision on drop only) and OQ-FOG-35's senses numbers (0–120 ft, default 0)
- Extends: [ADR-0021](0021-sync-protocol-conventions.md) (fns read record + viewer: kept), [ADR-0033](0033-signal-audience.md) (a server-originated signal from an intent result), [ADR-0040](0040-token-move-guards.md) (a never-refusing guard line that only adds a dry-run hint), [ADR-0041](0041-active-scene-window.md) (`sync.loadScene {viewAs: "party"}`)
- Affects: [fog-of-war](../../specs/fog-of-war.md) (FR-FOG-48–57), [scenes-map](../../specs/scenes-map.md) (FR-MAP-39), [character-sheet-full](../../specs/character-sheet-full.md) (FR-CHARX-49), [live-sync](../../specs/live-sync.md) (OQ-FOG-58), [combat-extras](../../specs/combat-extras.md) (OQ-FOG-57), [protocol](../../protocol/README.md), [AGENTS §9.9](../../../AGENTS.md#99-shared-files)

## Context

- Sprint 3 shipped per-player vision (ADR-0042): server-written `seenBy` copies, a derived `vision` record per (scene, player) sent to that player only, sight recomputed on drop only, senses absent = no sight.
- DM feedback #243: [1] vision 999 ft by default, reduced only by blinding effects; [2] vision recomputed while a token is dragged; [3] a campaign **party vision** switch, off by default: on = every player sees the union of all players' vision, darkness and Invisible / Sees invisible included; [7] View as gains Party vision.
- Constraints: visibility fns read only record + viewer (ADR-0021); players never get walls (FR-SCN-14); CON-44 ceilings DM 1 MiB, players 512 KiB (#208); a move ≤ 30 ms at caps (V0 exit gate).

## Decided by the DM (not open)

| Topic | Decision |
|---|---|
| Party vision | Campaign toggle, off by default; on = the union of all players' vision incl. darkness and Invisible / Sees invisible |
| Drag | Vision recomputed while dragging, not only on drop |
| Default | 999 ft, reduced only by blinding effects |
| View as | Gains "Party vision" |

## Options

**1. Where the party union is applied**

| Option | Pros | Cons |
|---|---|---|
| **A. Write time (pick): `derive` / re-derive write `seenBy` from the party's sight while the switch is on; the switch command re-derives the active scene and marks the rest `visionStale`** | Fns unchanged (record + viewer); the transition matrix gives every player's upserts / deletes on the switch; crash-safe (one transaction); reconnect = the stored state | The switch is a re-derive (≈ 102 ms at caps, arithmetic); prep scenes stale until activation (as senses edits today) |
| B. Read time: fns read a campaign flag | No re-derive on the switch | Breaks ADR-0021 (fn reads campaign state); the matrix has no before-state for the flag, so every switch needs a full resync of every player |
| C. A second column `partySeenBy` | Both answers stored | Two writes per subject per derive; every fn picks a column by a flag it can't read |

**2. How a player gets the union to draw**

| Option | Pros | Cons |
|---|---|---|
| **A. Share each player's `vision` record (pick): unchanged content (own sources) + `src`; server-only `shared` flag; others get it redacted without `inv`; the client draws every record it holds** | A move changes only the mover's record: 591 B to each player (measured); no geometry dependency; one record shape | Each player holds N records (+3,297 B typical, measured); over 512 KiB at caps without a source cap (→ option 5) |
| B. One `party-vision` record per scene with every polygon | One record | Every move resends all polygons to everyone (3.9 KB × 6 typical, ≈ 125 KB × 6 at caps) |
| C. A geometric union on the server | Fewest bytes | Needs a clipping dependency (below), CPU per move, robustness work |

**3. Sight while dragging** (rate and audience are DM questions, OQ-FOG-49)

| Option | Pros | Cons |
|---|---|---|
| **A. Server, through the existing per-cell `map.checkMove` (pick): fog adds a never-refusing guard line whose dry-run hint is the source's polygon at that cell, only when every other guard passes; the hub fans it out as signal `fog.sight` to the owner (if the DM drags) and, with party vision on, to every other player** | No new intent; one in flight per dragger; refused cells give no sight (no peeking past walls); nothing written | Needs a hub capability: signals from an intent result (OQ-FOG-58) |
| B. A separate `fog.preview` intent per cell | Independent of guards | Two round trips per cell; must re-check guards anyway |
| C. Client-predicted sight | No server cost | Needs walls on players: FR-SCN-14 leak (rejected in sprint 3 too) |

**4. The 999 ft default**

| Option | Pros | Cons |
|---|---|---|
| **A. `visionFt` absent = 999 ft (199.8 cells); stored values kept; the map rectangle's edges join the occluders; `dark` omitted when ≤ vision (pick)** | No row rewrite; sprint-3 fixtures stay exact; −42 % `vision` bytes from the map edges (measured: 609–720 B vs 761–1,235 B) | A sheet saved with 0 in sprint 3 stays sightless beyond darkvision until set to Normal (DM question OQ-FOG-51) |
| B. Unbounded radius | "Infinite" | Same polygon as A once the map edges bound it; an extra code path |
| C. Keep default 0 | Nothing changes | Contradicts #243 [1] |

**5. Party source cap** (measured: 24 sources at caps put a player at 526,660 B, 2,372 B over 512 KiB): **A ≤ 12 sources for the party, round robin by player (pick)** · B 4 per player · C 2 per player.

**Dependency.** None needed: party sight is a list of polygons (drawn with nonzero fill, tested "any polygon holds it"), the brush is a distance test and whole cells. Only option 2C would need one: `polygon-clipping` 0.15.7 (MIT, 29 KB UMD min, last release 2023-12), `martinez-polygon-clipping` 0.9.0 (MIT, ~11 KB + splaytree / tinyqueue / robust-predicates), `polyclip-ts` 0.16.8 (MIT, 42 KB + bignumber.js) — figures as recorded in ADR-0042, not re-checked; all run in Bun and browsers. Pick: **hand-rolled / none** (as ADR-0042 G2).

## Proposed decision

Picks: 1 **A**, 2 **A**, 3 **A**, 4 **A**, 5 **A**; no new dependency. Why a new ADR rather than amending ADR-0042: ADR-0042 is accepted and records sprint 3's picks (own sight only, drop only, default 0); the gate should accept or reject party vision on its own, and an accepted record shouldn't change under it.

| Contract | Rule |
|---|---|
| Setting | `fog_settings {campaignId, partyVision}`, record `fog-settings` (campaign scope, everyone); `fog.setPartyVision {on}` (DM): row + active-scene re-derive + `visionStale` elsewhere + `PartyVisionSet`, one transaction |
| Union | While on: a point is in any player's sight iff any player's polygon holds it (each polygon under its own see-through rule); unowned invisible tokens via any Sees-invisible polygon; party-blind = sources exist and no polygon; owned tokens: owner always, others unless party-blind; `fogged` / `tokenHiddenForPlayers` unchanged (seen by nobody) |
| Records | `vision` + `src` (token id per polygon) + server-only `shared`; visibility: owner full; other players redacted (no `inv`) iff `shared`; DM via View as only. `fog-explored` stays own-only; it grows from the party's sight while on |
| Filter guarantees | **Off:** exactly ADR-0042 (own sight). **On:** a player's frames carry exactly the subjects some player sees, every player's `vision` (no `inv`), own memory; never walls, `seenBy`, others' memory, senses or `inv`. **On → off:** one event deletes others' `vision` and everything not in own sight; after it, each store equals that player's fresh snapshot (convergence test). **Reconnect:** snapshot from stored `seenBy` + `vision` computed with the stored setting |
| Cost per move | Sight cache per (scene, player) as today (only the mover's player recomputes). Subject tests short-circuit at the first seeing player. Memory: only the moved source's new polygon is rasterised, OR'ed into ≤ 6 rows. Polygon at r 199.8: 0.17 ms typical, 1.44 ms at 2,000 walls (measured). Target unchanged: ≤ 30 ms at caps; the switch ≤ 150 ms at caps |
| Drag sight | fog's last line in `move-guards.ts`: hint `{guard: "fog-sight", tokenId, see, dark}` on dry runs only, only when `ok`; cached per (token, cell, senses, Blinded, fog rev, structure rev) in its own small LRU (64) so drags never evict players' sight; read-only. Hub: an intent result may carry `signals {name, payload, audience: playerId[]}`, sent right after the ack (frame order kept, so every preview precedes the drop's `TokenMoved`); `fog.sight` ≤ 4 / s per token per receiver, never to the DM. Drop refused → nothing written; previews only came from cells the guards allowed |
| Blinded | A source whose character has an active `blinded` effect has no polygon; effect writes re-derive via a CBTX effect-changed hook line (OQ-FOG-57) |
| Budget | Measured (FOG §12 "Sprint 4"): players 281,044–284,104 B with party vision on (typical), ≈ 405 KB at caps with the 12-source cap; DM unchanged; drag ack 651 B typical / 10,598 B caps at ≤ 10 / s; `fog.sight` ≤ 4 / s |

## Consequences

- fog-of-war gains FR-FOG-48–57 (Blinded, party vision, shared records, source cap, sight preview, brush, redo); scenes-map's drag sender gains the shared probe (FR-MAP-39); the sheet's vision field becomes optional (FR-CHARX-49).
- live-sync: the hub sends signals carried by an intent result; `sync.loadScene` accepts `viewAs: "party"`; CON-44 adds a per-player bound for shared `vision` (≤ 192 KiB). combat-extras: an effect-changed hook registry (append-only) for Blinded.
- Accepted leaks added: under party vision, other players' sight polygons, `blind` flags, source token ids and drag previews; for everyone, map geometry seen from cells a source was dragged over but not dropped on (legal cells only).
- Build: `fix/vision-s4-core` takes the schema, ws and sheet locks first this sprint; canvas slices follow before track M's (FOG §14).
- Tests: per-player leak tests with the switch off, on, and across both transitions and a resync; convergence after each switch; the sprint-3 exit-gate benchmark re-run at r 199.8 and 12 party sources.
