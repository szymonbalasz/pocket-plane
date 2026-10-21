# Proposed — DM roll requests as pending actions (and hidden answers)

- Status: proposed (sprint 8, track TT; integrator numbers it at merge)
- Date: 2026-10-21
- Refines: [ADR-0016](0016-domain-events-pending-actions.md) (a pending action whose resolution is a roll), [ADR-0027](0027-notification-creation.md) (created in the causing command's transaction)
- Amends: decisions [#73](../../decisions-log.md) / FR-DICE-13 "player rolls are always public", **for request answers only**
- Affects: [dice-extras](../../specs/dice-extras.md) (FR-DICEX-73–93), [notifications](../../specs/notifications.md) (FR-NOTE-58–64), [dice-roll-log](../../specs/dice-roll-log.md) (FR-DICE-79–84), [character-sheet-full](../../specs/character-sheet-full.md) (the roll helper), [stats](../../specs/stats.md) (what counts)
- Raised by: DM [#334](../../decisions-log.md): "DM requests a roll from players: a notification with a roll action; results back to the DM, hidden or public per the request"

## Context

- ADR-0016 already names "Roll CON save, DC 12" as a pending action: a notification with an action, resolved by its owner or the DM. Concentration saves are built that way (kind `cbtx-concentration`).
- A request has **several** targets (one per PC) and one DM-side view of all answers; a notification has one audience. Something must hold the set.
- The DM wants hidden checks (Perception vs a secret DC). Player rolls are always public today (#73). Companion lines (FR-CBT-114) already reach only the DM and one player (`public: false` + `audiencePlayerId`).
- No wall-clock scheduler (ADR-0016): a timer can't close a request on the server.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. A DM-only `roll-request` record (spec, DC, targets, results) + one pending notification per target (kind `roll-request`); a DICEX command answers by building the roll on the server from the request; the answer line is `public`, or `public: false` + `audiencePlayerId` = the roller** | Fits ADR-0016 as is (each prompt is an ordinary pending action); DC and pass / fail live only in a DM-only row; hidden answers reuse a visibility rule already built and tested; the server owns the roll spec, so a player can't change what was asked | A new record type and table; `char.roll`'s body becomes a helper the answer calls |
| B. Notifications only: one per target, the request's data copied in each payload; the DM's view groups them | No new table | The DM's pass / fail and hidden DC must stay out of player payloads, so they'd live nowhere; grouping by payload is fragile; "Close" must find siblings by payload |
| C. A `requestId` on `char.roll` / `dice.roll`; an answer hook closes the request | No new intent | Two features' intents grow a field; the client chooses kind / skill / mode and the server must re-check them against the request anyway |
| D. A new "pending action" table separate from notifications | Clean model for multi-target actions | Contradicts ADR-0016's "one concept"; a second inbox |

## Decision (proposed)

**A.**

- **Record:** `roll-request`, campaign scope, **DM only**, snapshot window "open pinned + newest 20 closed". Targets 1–12 PCs; ≤ 5 open per campaign.
- **Prompts:** one `roll-request` notification per target, audience = the PC's owner, action "Roll" owned by that player (ADR-0016 "action owner + the DM"). Payload carries the DC only when the DM shows it.
- **Answer:** `dicex.answerRequest` (owner or DM): the server builds the roll from the request (sheet bonuses, overrides and roll hooks as `char.roll`), writes the `roll` entry, marks the target, resolves the prompt, in one transaction. Physical dice and the tray work because the client's Roll is an ordinary roll control whose `onRoll` sends this intent.
- **Hidden answers:** `public: false` + `audiencePlayerId` = the target's player (whoever rolls, the DM included): DM + that player, no one else (the companion-line rule). Answers are marked `answer: true` and are not rerollable (OQ-GEM-20 A).
- **Owner changes:** a PC's owner change marks its open targets `missed` and resolves their prompts (no re-target). Targets must be owned, non-hidden PCs at send. Stamped by the server from the request through an internal `audience` input; no intent field lets a player choose it (#73 stands for every other roll).
- **No timer.** A request closes when no target is open, or by the DM (Close; Roll for missing). Not undoable. Not encounter-scoped.
- **Stats** (ADR-0059): answers are ordinary `roll` facts; hidden ones count for the DM only (players' view = public).

## Consequences

- dice-roll-log: `gameLog.append` and the sheet roll helper take an internal `audience`; FR-DICE-15's rule (public, or `audiencePlayerId` = viewer) is unchanged.
- notifications: a kind view may restore its pending toast from the snapshot (`restoreToast`), for prompts after a reload.
- A future **player whisper** (stub, tier C) can reuse the same audience on a free roll; it would amend #73 for whispers the same way.
- Blind checks (the roller doesn't see the number) would use the existing DM-only stamp (`public: false`, no `audiencePlayerId`) with a resolution that carries no total; offered to the DM as OQ-DICEX-55 B, not in the pick.
