# Gate — Scenes specs (build phase 2)

Scratch for the DM review. All four specs are on `main` at `in-review`. Full reviewer findings (numbered fixes) are kept by the orchestrator and handed to the revision agents.

## Summaries

| Spec | Summary | Review verdict |
|---|---|---|
| [assets-pipeline](../specs/assets-pipeline.md) | 18 FRs. DM uploads (25 MB / 50 MP), content-hashed files, WebP thumb + display derivatives, SVG converted on upload, no delete in MVP, player access to images limited to what they may see. Proposed ADR: asset access by reference. | Solid structure; credential scheme clashes with CON-08; some FRs assume OQ-ASSET-01 decided. |
| [entities](../specs/entities.md) | One entity table, shared creature core (AC, HP, init, attacks) + monster CR / character level; imported = global + read-only; customs/characters per campaign; create/derive/update commands; read-only DM "Creatures" list. Proposed ADR: definition visibility. | Plugs in correctly. Copying size/HP onto instances needs an ADR-0009 refinement; edits must propagate in the same transaction, not via listeners. |
| [play-shell](../specs/play-shell.md) | Canvas base + floating windows for both clients, window registry features plug into, top bar, launcher, where connection/presence/campaign screens live, layout persistence. Proposed ADR: play-shell windows. | Good fit. Server-side layout persistence brings 3 real bugs (campaign switch, stale resend, NULL uniqueness). |
| [scenes-map](../specs/scenes-map.md) | 29 FRs. Scenes, folders, duplicate, grid calibration, tokens (snap, sizes, labels, owner, hide/reveal, Ctrl-D), ruler, ping/pull view, laser, lock map, active scene switch. Moves not logged. | Too long (243 lines). Per-token size edit contradicts ADR-0009; needs small live-sync hooks for signals. |

## DM decisions

### S1 — What players see of creatures ([ADR-0009](../architecture/adr/0009-entity-content-model.md) refinement)
| Option | Tradeoff |
|---|---|
| **A. Monster definitions hidden from players; tokens carry a read-only copy of display name, image and size, refreshed in the same transaction when the definition changes** (pick) | Players never see prepped monster stats; refines ADR-0009 ("instances hold only name, play state, modifiers") with read-only copies, no inline editing |
| B. Players see monster names/size from the definition | Simpler model, but leaks prepped custom monsters |

Players' own character: full. Other PCs: name, portrait, owner (HP for the party view is a combat-phase question).

### S2 — Layout persistence (OQ-SHELL-01)
| Option | Tradeoff |
|---|---|
| **A. Browser storage, keyed by player link / DM** (pick) | Survives reload and crash; ~8 fewer FRs and none of the 3 bugs; lost if a player switches browser |
| B. Server record per campaign and owner | Restores on another browser; more code, sync edge cases |

### S3 — DM preps a non-active scene while players see the active one (OQ-MAP-13)
Tier A ("prepare scenes in background") but near-free with the active-scene model. **Pick: include in MVP.**

### S4 — Player access to images (OQ-ASSET-01)
| Option | Tradeoff |
|---|---|
| **A′. Random, unguessable asset IDs act as the permission; players only learn IDs through the filtered sync** (pick) | Same protection in practice (browsers keep a seen image after hide either way); no new player credential, no custom image loader, no shared-registry change mid-skeleton |
| A. Credential header + server check "is this asset referenced by something you may see" | Also stops IDs leaked outside sync; needs a player REST credential, registry change, custom loader |

### S5 — Accept the remaining picks as written
| ID | Pick |
|---|---|
| OQ-ENT-04 | Characters and monsters share one creature core (already implied by ADR-0009 / #93) |
| OQ-MAP-01 | Ruler: 5 ft per diagonal square (PHB default) |
| OQ-MAP-02 | One owner per token, defaulted from the character's owner; DM reassigns |
| OQ-MAP-03 | Tokens belong to one scene; what happens to a combatant when its token is deleted → combat-tracker decides |

## Integrator rulings (no DM call needed)

- Signals: live-sync gets a small, reviewed change (server stamps the sender; DM-only `map.pull`; receivers filter by scene) via a proposed ADR; built after the skeleton as a sequenced shared change.
- No per-token size editing (ADR-0009); size follows the definition.
- Shell test IDs use `ui-` (AGENTS §9.5); campaign-management owns its screen wording.
- Fixtures act as DM only (FR-FIX-13): drop the player-layout fixture.
- Ordering tiebreaks use an insertion `seq` where lists are sorted by time.
- Every spec ≤ 200 lines; picks that depend on open questions marked *(proposed)*.

## Next after your answers

Fresh revision agents per spec (with the reviewers' findings) → merge → specs `complete` → consolidate Scenes into data model + protocol → Scenes build after the skeleton merges and you've run it.
