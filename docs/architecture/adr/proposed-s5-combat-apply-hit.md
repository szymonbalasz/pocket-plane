# Proposed — Apply hit: a damage card applied in two steps

- Status: proposed (spec-combat, sprint 5 track R; for DM gate 1)
- Date: 2026-10-18
- Refines: [ADR-0037](0037-split-attack-damage.md) ("`cbt.applyCard` accepts a missing damage total only when every target misses"; "Undo: unchanged"). Keeps [ADR-0016](0016-domain-events-pending-actions.md) (one undo step per apply) and [ADR-0027](0027-notification-creation.md) (notifications change only in the causing transaction).
- Affects: [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-87–94, §6.2), [effect-modifiers](../../specs/effect-modifiers.md) (FR-MOD-63), [data model](../../data-model/README.md) (new `hit_ruling` table), [protocol](../../protocol/README.md) (intent `cbt.applyHit`, event `HitApplied`, record type `hit-ruling`), [glossary](../../glossary.md) (OQ-CBT-68)
- Raised by: DM [#250](../../decisions-log.md) [8]: "a damage roll after the DM applied the attack joins the open apply-to-targets popup, never overriding a value already there".

## Context

- ADR-0037 made "roll to hit, DM says hit, roll damage" possible on one card, but the DM can only *say* hit: Apply stays disabled on a Hit row until a damage total exists. So the DM can't apply the attack first, and the table hears nothing until the damage is in.
- [8] assumes an attack the DM has applied, with the popup still open for the damage.
- The hit must survive a reload or a server restart (combat's goal: "pending cards intact"), and the card's payload reaches its roller, so a hidden target can't be named there.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Two steps on one card: `cbt.applyHit` writes the hit / miss lines and a DM-only hit ruling, the card stays pending; the popup's damage step takes the late roll; `cbt.applyCard` then applies the damage to the ruled hits** | One card, one toast, one Pending row; players hear "— DM: hit." at once; reload- and crash-safe; undo stays one step per apply | New intent, event, table; two lines per hit target; Apply hit itself isn't undoable |
| B. Keep one apply; the popup only stays open with Hit set until damage | No server change | Nothing public until damage; a reload loses the Hit; doesn't match "after the DM applied the attack" |
| C. Resolve the to-hit card at Apply hit; the damage makes a follow-up card the open popup adopts | No new record (the link sits on the card) | Two cards and two resolutions per attack (ADR-0037 option B's cons); a hidden target's id on a player-visible card |

## Decision (proposed)

**A.** `cbt.applyHit` (DM) on a pending card with a to-hit roll: one `hit_ruling` row (DM-only record type, never on a player wire), one outcome line per target without damage (`awaitingDamage`), event `HitApplied` (logged, not undoable); card, payload and text unchanged, no HP change. The late `cbt.rollDamage` attaches by ADR-0037's rule (attacker + row, latest pending card without damage). `cbt.applyCard` on a ruled card takes its to-hit facts from the ruling, accepts only ruled hit targets and writes damage-only lines. A second damage roll on a completed pending card makes no card (kept as `unusedRolls`).

## Consequences

- combat-tracker: FR-CBT-87–94; the popup has a to-hit step and a damage step; Undo reopens into the damage step; Dismiss ends a ruled card (its hit lines stay).
- Schema: one table in R's schema slot (R0). CON-44 measured: ≤ +39.7 KB DM worst (20 rulings × 20 targets), 0 B for players.
- notifications: none (no new kind, `updateNotification` as built for `unusedRolls`).
- If the DM picks B for OQ-CBT-65 (ruling in popup memory), this ADR keeps its intent and event but drops the table; a reload then loses who was hit.
