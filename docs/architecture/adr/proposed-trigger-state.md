# Proposed — Trigger state for clients and effect-changed hooks

- Status: **proposed** (sprint 4, track R; review-b B1, rulings B1). The DM accepts it at sprint-4 gate 1; the integrator numbers it at merge
- Date: 2026-10-17
- Supersedes: [ADR-0043](0043-rule-triggers.md) D3 / D4 **visibility consequence only** ("use rows never sent", "0 B in the snapshot", trigger rows to the DM and the owner only via the lazy load). ADR-0043's model (rule, offers, window keys, `trigger_use` as the truth) stays
- Refines: [ADR-0035](0035-combat-rule-hooks.md) (rules in the causing transaction) with a new append-only `effectHooks` registry that also runs out of combat
- Affects: [effect-modifiers](../../specs/effect-modifiers.md) (FR-MOD-53–56, -60), [combat-extras](../../specs/combat-extras.md) (FR-CBTX-51–53), [fog-of-war](../../specs/fog-of-war.md) (Blinded line, seams S6), [live-sync](../../specs/live-sync.md) (a new record type in the snapshot), [data model](../../data-model/README.md), [protocol](../../protocol/README.md) §26, [AGENTS §9.9](../../../AGENTS.md#99-shared-files)
- Raised by: DM [#243](../../decisions-log.md) [19] (trigger badges on Initiative rows and tokens, detail on hover and in the sheet) and session-sim-7 glitch 11 (the tray offers "Divine Fury +1d6" after it was used this turn)

## Context

- Charges live only in server-only `trigger_use` rows (ADR-0043 D3). No client can tell "used this turn", so the tray preview lists every trigger that might fire (sim-7), and no badge can show a trigger's state.
- Whether a trigger is "in effect" (its `requires` met, e.g. Divine Fury while raging) changes whenever an effect starts or ends. Effects change on many CBTX paths (add, end, concentration, 0 HP, expiry, Prev restore, undo, End) and in MOD's commands, in and out of combat. Fog-of-war's Blinded vision (track V) needs the same signal (seams S6).
- `combatRuleHooks` (ADR-0035) fires only on combat lifecycle points (`started`, `added`, `turnChanged`, `ended`), never out of combat.

## Decision 1 — How clients learn a trigger's state

| Option | Pros | Cons |
|---|---|---|
| **A. A derived `trigger-state` record per (enabled trigger, owner combatant) while an encounter is started: `armed`, `charge` (`ready` / `used` / `waiting` / none), `featureId`; rewritten in the causing transaction; in the snapshot; `trigger_use` stays the truth** | One small row per badge (428 B max); no client reasoning about windows; crash-safe like every other row; commands never read it | A display copy to keep right on every path (MOD-54 lists them); a new record type in the snapshot (measured, MOD §12) |
| B. Send `trigger_use` rows (or a window summary) and let clients compute | No copy | Leaks window keys (turn combatant ids, incl. hidden ones); clients reimplement FR-MOD-42; contradicts D3's reason for server-only rows |
| C. Load state on demand with the lazy `rule-trigger` rows | Nothing in the snapshot | Badges on Initiative rows and tokens need it at once for every viewer; stale between loads |

**A (proposed).** Visibility per MOD OQ-MOD-41 (DM gate): suggested **DM all, owner own rows only**. The alternative (other PCs' public triggers to other players) would also amend #178's other-players whitelist / [ADR-0036](0036-full-sheet-derivation.md) and FR-MOD-47, and redefine `public` from "label shown in lines" to "visible to the party"; this ADR then records that too.

## Decision 2 — Where "effects changed" runs

| Option | Pros | Cons |
|---|---|---|
| **A. A new append-only registry `effectHooks` (`src/server/features/combat-extras/effect-hooks.ts`): `effectsChanged(env, {creatures, encounter \| null})`, run once per command after the effect rows are written, in the causing transaction, in or out of combat, on every effect insert / end / restore (CBTX's helpers are the choke point)** | One signal for MOD (armed) and fog-of-war (Blinded); same in-transaction rule as ADR-0035 / ADR-0028; no listener writes | Every effect path must go through CBTX's helpers (tested); a slow line slows effect commands |
| B. A new point in `combatRuleHooks` | Existing registry | Combat-only by contract; fog's Blinded must work out of combat |
| C. Each consumer recomputes from its own call sites | No registry | Misses CBTX paths (expiry, 0 HP, undo restore); duplicated in V and R |

**A (proposed).** Created empty by `fix/rules4-core` (S4-0); AGENTS §9.9 gains it. A line error rolls the command back.

## Consequences

- ADR-0043: the consequence "a stale popup meets a `conflict` instead of a live used marker" and MOD's non-goal "no live charge indicator for players" end. Offers, settling, window keys, Undo and Prev are unchanged; a command never reads `trigger-state`.
- ADR-0035: rules may also run out of combat through `effectHooks`; still never post-commit.
- CON-44 (measured, MOD §12): DM +22,326 B realistic / +84,102 B worst; a player with pick A ≤ 2,592 B.
- Snapshot convergence and leak tests cover `trigger-state` (no monster row, no other player's row under pick A).
- Glossary: Trigger state (MOD OQ-MOD-45).
