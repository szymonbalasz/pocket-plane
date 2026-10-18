# Proposed — Apply hit: a damage card applied in two steps

- Status: proposed (spec-combat, sprint 5 track R; for DM gate 1)
- Date: 2026-10-18
- Refines: [ADR-0037](0037-split-attack-damage.md) in three places: "`cbt.applyCard` accepts a missing damage total only when every target misses"; "Undo: unchanged"; and **`cbt.rollDamage` "completes or creates a card"**: a second roll by the card's owner on a completed pending card of that row now creates no card (kept as `unusedRolls`); every other case still completes or creates as ADR-0037 says. Keeps [ADR-0016](0016-domain-events-pending-actions.md) (one undo step per apply) and [ADR-0027](0027-notification-creation.md) (notifications change only in the causing transaction).
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

**A.** `cbt.applyHit` (DM) on a pending card with a to-hit roll: one `hit_ruling` row (DM-only record type, never on a player wire), one outcome line per target without damage (`awaitingDamage`), event `HitApplied` (logged, not undoable); card, payload and text unchanged, no HP change. The late `cbt.rollDamage` attaches by ADR-0037's rule (attacker + row, latest pending card without damage). `cbt.applyCard` on a ruled card takes its to-hit facts from the ruling, accepts only ruled hit targets and writes damage-only lines (ruled misses get `raw 0` `hp_change` rows); every `cbt.applyCard` carries the damage `rollId` the popup was built from, and a stale one is a `conflict`, so the DM never applies parts they didn't see. A second damage roll **by the card's owner** on a completed pending card makes no card (kept as `unusedRolls`); the DM's extra roll on a player's card creates a DM card as before.

## Consequences

- combat-tracker: FR-CBT-87–94; the popup has a to-hit step and a damage step; Undo reopens into the damage step; Dismiss ends a ruled card (its hit lines stay). The ruling leaves the DM's store with its card (delete at Apply / Dismiss / End, upsert at Undo).
- ADR-0037's `cbt.rollDamage` "completes **or creates**" now has one exception (the owner's second roll on a completed pending card); its "a stray Damage makes an extra card the DM dismisses" no longer holds for that case.
- Schema: one table in R's schema slot (R0). CON-44 measured: ≤ +39.7 KB DM worst (20 rulings × 20 targets), 0 B for players.
- notifications: none (no new kind, `updateNotification` as built for `unusedRolls`).
- If the DM picks B for OQ-CBT-65 (ruling in popup memory), this ADR keeps its intent and event but drops the table; a reload then loses who was hit.
