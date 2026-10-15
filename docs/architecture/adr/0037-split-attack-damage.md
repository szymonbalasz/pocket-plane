# 0037 — Attack and damage as separate rolls on one damage card

- Status: accepted (DM gate 1, decision #190, 2026-10-15; raised by spec-polish-2a)
- Date: 2026-10-15
- Refines: [ADR-0016](0016-domain-events-pending-actions.md) (a pending action's payload can change while it is pending), [ADR-0027](0027-notification-creation.md) (notifications change only in the causing command's transaction; now also an update)
- Affects: [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-70–74, §6.1), [notifications](../../specs/notifications.md) (FR-NOTE-25; drops "editing" from the non-goals for pending rows), [character-sheet-full](../../specs/character-sheet-full.md) (new kinds `toHit` / `spellToHit`, FR-CHARX-24 claim list; seam settled S1, OQ-CBT-51 / OQ-CHARX-21), [protocol §21–23](../../protocol/README.md#23-combat-notification-kinds)
- Raised by: DM playtest note N7 (#188): "Main's Attack also rolls damage; Actions' Attack / Damage differ in and out of combat. Add a third button, **Attack + damage**, and make the three behave the same everywhere."

## Context

- Today a sheet **Attack** in combat makes a damage card with to-hit **and** damage (`cbt.attack`). Out of combat the same button rolls both too; the Actions tab's **Damage** rolls damage only and is never routed into combat (FR-CHARX-24).
- The DM wants three actions that mean the same in and out of combat: **Attack** (to-hit), **Damage**, **Attack + damage**. At a table the usual flow is "roll to hit, DM says hit, roll damage". In combat that needs a card that exists before its damage is rolled.
- A damage card is a notification. Notifications are immutable once created, except for state changes (resolve, dismiss, reopen). The notifications spec already expected a post-MVP `updateNotification` (pending only) for gems.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One card, filled in two steps: Attack makes a to-hit-only card; Damage completes the attacker's latest pending to-hit-only card of the same row (`updateNotification`, new `NotificationUpdated` event), else makes a damage-only card** | One card per attack, so one popup, one toast, one Pending row; the DM can rule hit / miss before damage exists; crit doubling known from the card's natural 20; reuses the apply, undo and resolution paths | New helper and event in notifications; card payload fields become nullable; a stray Damage makes an extra card the DM dismisses |
| B. Two cards (to-hit card, then damage card), linked by id; the popup merges them | No notification change | Two toasts, two Pending rows, two resolutions per attack; the popup must merge and resolve both atomically; targets picked twice or carried over in client memory |
| C. Attack (to-hit) never makes a card in combat: a plain roll line; only Damage and Attack + damage make cards | No new shapes | The DM can't rule hit / miss on a card; damage-only cards for every split attack lose the to-hit facts (stats #54, natural markers) |
| D. Keep one combined action in combat (Attack = Attack + damage) | No change | Contradicts N7 ("the same everywhere") |

## Decision

**A.** `cbt.attack` gains `rolls: "toHit"`; new `cbt.rollDamage` completes or creates a card; `cbt.applyCard` accepts a missing damage total only when every target misses; notifications gain `updateNotification` for **pending** rows only, called by the kind owner in its transaction, emitting `NotificationUpdated` (no toast, same `seq`). Out of combat the sheet's `char.roll` rolls exactly the same dice without a card. Healing never routes.

## Consequences

- notifications: FR-NOTE-25; the "editing" non-goal now excludes kind-owner updates of pending rows; users still can't edit. protocol §8 / §22 gain `NotificationUpdated`.
- combat-tracker: FR-CBT-70–74 and the §6.1 table; card payload `toHit` / `damage` nullable (never both), plus `attackId?` / `spellId?` / `saveDc?`; new `DamageRolled` event; outcome lines for to-hit-only (miss) and damage-only applies.
- character-sheet-full (settled S1): new kinds `toHit` / `spellToHit` (Attack); `damage` / `spellDamage` (Damage); `attack` / `spellAttack` keep their stored meaning (Attack + damage), so old `CharacterRolled` events and log entries read the same. Combat's route claims all three per row while in combat; P2b's sheet build merges first (unclaimed `toHit` = a plain roll).
- Undo: unchanged (one apply = one undo step; completing a card is not undoable, like rolling it).
- Gems ([gems](../../specs/post-mvp/gems.md), FR-CBT-32) can use the same helper later.
