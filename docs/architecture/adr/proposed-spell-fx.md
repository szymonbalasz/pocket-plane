# Proposed — Spell FX: client-drawn map effects on effect rows, transient hit cues

- Status: proposed (integrator numbers it at merge). The DM picked option A for the hit-cue path (OQ-VFX-05, 2026-10-28)
- Date: 2026-10-28
- Extends: [ADR-0016](0016-domain-events-pending-actions.md) (domain events → listeners → visibility filter → WS), [ADR-0035](0035-combat-rule-hooks.md) (no post-commit listener writes state), [ADR-0033](0033-signal-audience.md) (transient messages routed by audience).
- Raised by: the DM (2026-10-28): animated Spirit Guardians and Shadow of Moil, hit looks by damage type, a per-player off switch.
- Affects: [spell-fx](../../specs/spell-fx.md) (VFX); [combat-extras](../../specs/combat-extras.md) (`effect.fx`), [character-sheet-full](../../specs/character-sheet-full.md) (`spells[].fx`, Cast), [scenes-map](../../specs/scenes-map.md) (two layer entries), [live-sync](../../specs/live-sync.md) (a server-sent transient message), [combat-tracker](../../specs/combat-tracker.md) (cue source), AGENTS §9.9 (two new append-only registries).

## Context

- Auras must last exactly as long as a spell: concentration ends in many ways (End, failed save, condition, duration, a new concentration) and combat-extras already handles all of them inside the causing transaction.
- Effect rows already have a player visibility rule, survive restarts and reach every client in the snapshot.
- Animation is per-frame and per-device. Sending frames or particle state would cost bandwidth over the tunnel and could leak positions.
- Players don't receive `hp-change` rows (`audience: dm`); the player-safe outcome line names the target but carries no token id. A client therefore can't tell which of three goblins was hit.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. `fx` JSON leaf on the existing effect row; clients draw from it; hit cues as a transient server message per applied change, filtered per connection by token visibility** | No new record type, lifetime and visibility inherited; one small field; cues never stored so nothing replays or grows | One new transient path from an after-commit listener; a column on a combat-extras table |
| B. A new `fx-instance` record type anchored to a token, ended by an effect hook | FX independent of effects (cast without an effect) | Second lifetime to keep in step with concentration; new visibility rule; more snapshot |
| C. Everything client-side: auras from effect labels, hits from the outcome line text | Zero server change | Fragile name matching; can't tell which token was hit; leaks nothing only by luck |

## Decision

**A** (pending DM review).

1. **State is one field.** `effect.fx = {preset, params, spellId?} | null` (≤ 200 B). An aura exists while its effect is active; there is no FX lifetime of its own. Ending the effect ends the aura on every client.
2. **Drawing is client-only.** Presets live in a shared catalogue (keys, params schemas, spell names, radius, reactions) and a client renderer registry; each client animates locally from records, with a PRNG seeded by the record id. No FX intent, event or signal carries frames.
3. **Hit cues are transient.** After `AttackApplied` / `HpApplied` commit, a listener emits one cue per target (token ids, kind, typed parts, multiplier, crit). It writes nothing (ADR-0035 holds). The hub sends it to the DM and to each player who receives the target token and the outcome line now; the attacker's token id is stripped for a player who doesn't receive that token. Never logged, never in a snapshot, never replayed.
4. **Layers stay at four.** FX render as two registry entries on the existing `objects` Konva layer (under and over tokens, below labels), per FR-MAP-29.
5. **Comfort is per browser.** A Preferences level (Full, Reduced, Still, Off) and an automatic tier drop on slow frames; the DM also gets a Layers switch. No server setting.

## Consequences

- combat-extras gains a push-safe column and a field in the player-redacted effect record; docs/data-model and docs/protocol change in the same merge.
- live-sync gains a server-originated transient message type with a per-connection filter (first of its kind; signals today are client-originated).
- AGENTS §9.9 lists `src/shared/spell-fx/presets.ts`, the client renderer registry and `hit-looks.ts` as append-only.
- A new preset is one catalogue line, one renderer file and one registry line; a new trigger reuses the cue path or the client's own turn state.
- Revisit if FX need to exist without an effect (one-shot cast bursts, template anchors): option B's record type can be added for those without moving auras.
