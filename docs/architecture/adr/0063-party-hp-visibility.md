# 0063 — Party status: other players see a PC's HP, temp HP and AC

- Status: accepted (DM gate, [#335](../../decisions-log.md))
- Date: 2026-10-21
- **Amends DM decision #178 G6 and [ADR-0036](0036-full-sheet-derivation.md)'s "No HP, AC, scores, counters or text"** for the other-player character whitelist: a **decision reversal** for the DM (OQ-PARTY-30). Answers the [ADR-0024](0024-definition-visibility.md) consequence "other PCs' HP for a party view is a Combat-phase question" ([OQ-ENT-15](../../specs/entities.md#15-open-questions)). [ADR-0056](0056-companion-visibility.md) unchanged
- Affects: [party-board](../../specs/party-board.md) (FR-PARTY-51–58), [entities](../../specs/entities.md) (visibility fn, FR-ENT-15), [character-sheet-full](../../specs/character-sheet-full.md) (ADR-0036's table), [combat-extras](../../specs/combat-extras.md) (FR-CBTX-32: `tempHp` to others), [play-shell](../../specs/play-shell.md) (FR-SHELL-140); data model, protocol, leak tests
- Raised by: DM [#334](../../decisions-log.md) (party HP / AC summary for players), OQ-PARTY-30, -31, -32

## Context

- DM #334: a compact party view for players with **each PC's HP and AC**; companions per ADR-0056; monsters never.
- Today other players receive a character redacted to one whitelist (ADR-0036): `id`, `kind`, `name`, `portraitAssetId`, `ownerPlayerId`, `down`, `level`, `className`, `species`, `deathState`. No HP, AC or temp HP (code: `RedactedCharacter`, `REDACTED_CHARACTER_KEYS`, entities' `records.ts`).
- Visibility fns read only the record and the connection context (ADR-0021). HP and temp HP are columns on the character; AC is `statBlock.ac`. Effective AC (FR-MOD-24) needs effect modifiers that players never receive.
- A character row is already upserted to every player on each HP change (the `down` key), so new keys ride existing frames.
- A PC hidden from players (#141) is hidden through its **combatant**; its character row still reaches other players (with `down` and `deathState`, accepted before).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Whitelist + `hpCurrent`, `hpMax`, `tempHp`, `ac` (stored AC)** | What #334 asks; what a table says aloud; plain fields, pure fn; measured +343 B a player | HP is no longer private between players; a hidden PC's figures still reach others (as `down` does) |
| B. Whitelist + a derived `band` (healthy / bloodied / down) + `ac` | HP numbers stay private; still a glance | Not "HP" as asked; one more derived key |
| C. Whitelist + `band` only | Closest to today | No AC; fails #334's "HP / AC" |
| D. A per-campaign switch (ADR-0058 feature switch) choosing A or B | The DM decides per table | Two redactions to test; a switch flip must resend every character to every player |

Sub-choices (any of A / B): **hidden PC** — accept (a) or add a server-written copy flag on the character set by combat's hide / reveal paths (b, one column, ADR-0039 pattern); **AC** — stored (a) or effective via a server-written copy column refreshed by every effect change (b).

## Decision

> **A**, hidden PC **(a)**, AC **(a)** (DM gate, #335: OQ-PARTY-30 A, -31 A, -32 A).

- Entities' other-player character redaction gains `hpCurrent`, `hpMax` (`statBlock.hpMax`), `tempHp`, `ac` (`statBlock.ac`). ADR-0036's table gains one row: "`hpCurrent`, `hpMax`, `tempHp`, `ac` — party status (this ADR)". Own PC and the DM: unchanged (full).
- Monsters, NPC allies, pets and companion combatants: unchanged (ADR-0024, ADR-0056): others see a band, never numbers.
- No new record type, event or intent. Existing events that change these fields (`AttackApplied`, `HpApplied`, `CharacterHpAdjusted`, `CombatEntryUndone`, `TempHpSet`, `DeathSaveRolled`, sheet / entity edits) now deliver the new keys to other players; the hub's identical-change drop keeps sending nothing when none of them changed.

## Consequences

- **Leak surface, stated:** other players learn each PC's HP, temp HP and stored AC at all times (in and out of a fight), and a hidden PC's figures (as its `down` / `deathState` today). Still never: scores, counters, sheet text, `creature-sheet`, a pet's `statBlock`, any monster number.
- **Leak tests:** the CBTX / CHARX / CBT scans assert against the new list (FR-CBTX-32's "against that list" rule); `tempHp` on another player's character leaves the leak-string list; `tempHp` / HP on a `combatant`, a monster or another player's companion stays on it.
- **CON-44 (measured,** heavy harness, worst-width values**):** players +343 B (7 other PCs × 49 B; worst player 289,620 B of 512 KiB); DM 0 B. Per HP change other players get +49 B on an upsert they already receive; a temp HP set sends them one ≈ 286 B upsert.
- ADR-0036's "No HP, AC, scores, counters or text" becomes "No scores, counters or text; HP, temp HP and stored AC per this ADR".
- **Build:** CB3's server part (entities' `records.ts` + `schemas.ts`, ENT-owned, assigned to CB3, seams S12), before the window. **Docs updated in CB3's merge** (integrator): protocol README's `entity` redaction rows (≈ lines 387, 936, 965), data-model §372 (other-player character fields), [entities](../../specs/entities.md) FR-ENT-15 and OQ-ENT-15 (answered here), [character-sheet-full](../../specs/character-sheet-full.md) FR-CHARX-35, ADR-0036's whitelist table (one row).
