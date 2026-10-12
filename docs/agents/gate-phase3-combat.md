# Gate Combat — questions for the DM

Sources:
- Specs: character-sheet (CHAR), dice-roll-log (DICE), notifications (NOTE), combat-tracker (CBT).
- Proposed ADRs: windowed record types (WIN), notification creation (NCR), token-changed hooks (TOK).
- Reviews: review-combat-1, review-combat-2 (orchestrator scratch, not committed).

Picks are recommendations. Nothing here is decided until the DM answers.

**Counts**
- DM questions: **36** (8 blocking + 28 non-blocking).
- 22 of the non-blocking ones can be bulk-accepted (§2.2).
- Integrator-only items: 31 (§3). Shared-file changes: §4.

---

## 1. Blocking — DM decision needed before any spec can be `complete`

| # | ID(s) | Question | Options | Pick | Why |
|---|---|---|---|---|---|
| B1 | OQ-NOTE-05, OQ-CBT-19, OQ-CHAR-07 (listener part), **NCR** | How are notifications (damage cards) created? | **A** in the causing command's transaction via `notify` / B post-commit listener (CHAR's pick) / **C** = A now, B later for rule reminders | **C (A in MVP)** | A card can't be lost between two commits. Apply and resolve are exactly-once. No core change (verified against `commands.ts`). CHAR's listener pick contradicts its own note that listeners can't mutate state. |
| B2 | OQ-CHAR-07 (attack part), OQ-CHAR-10, OQ-CBT-18, OQ-DICE-22 | Which command is a player's attack in combat? What do the sheet's Attack and Initiative buttons do during a fight? | **CHAR:** `char.roll` + listener + `targetTokenId` on `char.roll`. <br>**CBT:** `cbt.attack` / `cbt.rollInitiative`; the sheet buttons route to them while the PC is an active combatant, `char.roll` otherwise. <br>**DICE:** combat supplies the in-combat attack. <br>**Review-1:** `char.roll` + an in-transaction attack hook registry. <br>Or: the sheet stays plain and combat runs only from the Initiative window (two different Attack buttons). | **CBT's pick** | One crash-safe path that owns target, card and log line. No new server hook registry. Matches NCR and DICE. One Attack button per player. Cost: the sheet's client buttons need a small client registry, or path access for the combat build (§4). |
| B3 | OQ-NOTE-01 (and ADR-0016's open row "named actor") | Who may resolve a pending action? | **The action's actor + the DM always** / anyone in the audience | **Actor + DM** | Matches ADR-0016's suggestion. One player can't apply another's card. The DM can always unblock. |
| B4 ✔ #134: A | OQ-CBT-17, **TOK** (answers #124's token-delete rule) | How does a combatant stay hidden or renamed with its token, and what happens when a bound token is deleted? | **A** scenes-map token commands run registered hooks in their own transaction (like FR-ENT-19); combat copies name / image / hidden; deleting a token bound to an active combatant → `conflict` / B DM hides combatants separately / C visibility fn reads the token (breaks ADR-0021) | **A** | Hiding a token and its combatant together is atomic, so there is no leak and no double work. Amends complete scenes-map (one FR + FR-MAP-05 wording). Decide now: `build/scenes-map` is still queued. Add FR-MAP-20 coverage (review-2 T1). |
| B5 ✔ #134: DM picks | OQ-CBT-07 | How is the damage-card target chosen? | **Player clicks any visible token (scenes-map exposes the selected token; click = select, drag on a non-owned token still pans); the DM confirms or changes it in the popup** / DM picks only (no scenes-map change) | **Player picks, DM confirms** | Matches "no one reads numbers aloud" (roadmap exit). Needs: FR-MAP-12 amended in the queued scenes-map build, and `tokenId` in redacted combatants (review-2 A3). If the DM wants zero scenes-map change, "DM picks only" also works. Card text then shows "?". |
| B6 | OQ-CBT-12 | Difficulty maths | **2014 DMG** (XP thresholds × multiplier ladder) / sum of CR (simpler, wrong at the table) | **2014 DMG** | Matches Shieldmaiden and the DM's expectations. Fix the ladder ends ×0.5 / ×5 (review-2 A11). The tables are DMG numbers, not SRD text (licence note only). |
| B7 | OQ-DICE-03 | Dice seeding for fixtures and tests | **`ctx.dice` on the command context: CSPRNG for real, seeded per fixture key / test, disposable dirs only** / mock the library per test | **`ctx.dice`** | Same seam and guard as ADR-0022. Stable fixture rolls make walkthroughs repeatable. |
| B8 | OQ-DICE-04, OQ-NOTE-03, **WIN** (amends FR-SYNC-20 in complete live-sync) | How much of the game log and notification history goes in a snapshot? How is convergence defined? | Newest N + windowed record types (WIN-A) / full log every snapshot / client trims (WIN-B) | **WIN-A, amended. Game log: newest 100 (WIN-A applies). Notifications: all pending + newest 100 closed (needs the amendment).** | Keeps snapshots bounded over a campaign. As written, WIN-A's count-based comparison fails (review-1 X4). Before accepting, the integrator amends it: compare by an `orderBy` floor taken before filtering, plus `pin(record)` so pending notifications always fit. No "load older" in MVP. |

---

## 2. Non-blocking — DM product picks

### 2.1 Need a real look

These are conflicts between specs, or leaks the reviewers found.

| # | ID(s) | Question | Options | Pick | Why |
|---|---|---|---|---|---|
| P1 | OQ-CHAR-09 vs FR-CBT-11 / -24 (review-1 X9) | The DM rolls *for a PC* (initiative, attack): is it always public? | **CHAR:** always public, like a player roll. <br>**CBT:** DM roll → category tickbox, with per-roll override. | **CBT (category)** | One rule: stamp by who rolls (FR-DICE-13). The DM keeps the per-roll override. Fewer special cases. |
| P2 | OQ-NOTE-11 + review-2 A2 | Who sees a player's damage card, and what of its outcome? | **Rolling player sees Pending → Resolved** / DM only. Resolution sent: full `{hpChangeId, hit, applied}` (CBT) / player-safe `{hit}` | **Rolling player; resolution `{hit}` only** | The player sees their card was handled. `applied` would reveal the monster's remaining HP on a kill. |
| P3 | Review-2 A5 (new) | Hidden combatants and initiative order: may players infer them? | Accept the leak: gaps in `position` show how many hidden combatants there are and where / **the server writes a player-only rank over visible combatants** | **Player rank** | Hidden enemies are the point of the ambush (#76). The rank costs a few extra row updates on hide and reveal. |
| P4 | OQ-NOTE-07, OQ-CBT-24; ADR-0016 open rows "Undo mechanism" and "Redo?" | Undo of an applied card; redo | **Undo reopens the card (pending again); no separate Redo: re-apply the card; compensating events (ADR-0016 A)** / card stays resolved; Redo = replay the event | **Reopen; no Redo; A** | Fixing a wrong damage takes two clicks. Redo can't double-apply, because the card's state guards it. Closes ADR-0016's open rows. |
| P5 | OQ-CHAR-03, OQ-CBT-04 | Who changes PC HP outside the damage-card flow? | **Owner + DM via the sheet (damage / heal), not undoable; all combat damage goes through cards or DM direct HP (undoable)** / DM only / all basics editable | **Owner + DM, current HP only** | Potions without the DM. Matches the trusted table. The sheet says sheet changes aren't undoable. |
| P6 | OQ-DICE-13 | What do players see of monster attacks in the log? | **Roll + modifier + outcome public; target AC and overrides DM-only (`dmPayload`)** / everything / outcome only | **As bold** | BG2-style line ("12 + 4 = 16 — hit!"). AC stays hidden, though players can infer it over time (accepted by #74). |
| P7 | OQ-ENT-15 (combat answer) | Do players see other PCs' HP? | **No in MVP: other PCs appear in initiative as name + portrait (tier B party view)** / band via the redacted character | **No** | Tier B row "Party HP/AC summary". Nothing blocks it later. |
| P8 | OQ-DICE-10 (+ review-1 D6) | Turning a category on: retroactive? Is single-entry reveal/hide in MVP? | **No retroactive; per-roll override at roll time; single-entry reveal/hide moved to tier B** / no retroactive + keep reveal/hide (spec) / retroactive | **No retroactive; reveal/hide → tier B** | Tier S = per-category tickboxes. Reveal adds a convergence edge case (WIN). Keep it if the DM wants surprise reveals. |

### 2.2 Bulk-accept

Each spec's bold pick. Low risk. Any of them can be changed later.

| # | ID | Question | Pick (alternatives) | Why |
|---|---|---|---|---|
| P9 | OQ-CBT-02 | Health band thresholds | **healthy > 50 %, bloodied ≤ 50 %, down = 0** (custom bands) | 5e "bloodied" convention |
| P10 | OQ-CBT-05 | Monster initiative | **Individual roll per monster, one click** (one roll per kind) | Matches the tier S row; varied turns |
| P11 | OQ-CBT-10 | Overkill in stats | **Store applied (capped) and overkill** (capped only) | #54 lists overkill |
| P12 | OQ-CBT-14 | Party for the difficulty maths | **Selectable; `null` = all characters** (always all) | Absent players at the table |
| P13 | OQ-CBT-21 | Crits | **Nat 20 = hit + doubled damage dice; nat 1 = miss** (no rule, DM fudges) | 5e rule; the DM can still override in the popup |
| P14 | OQ-CBT-22 | Turn skipping | **Skip removed combatants and monsters at 0 HP; PCs at 0 keep turns** (skip removed only) | Death saves come later (tier A); PCs at 0 still act at the table |
| P15 | OQ-CBT-23 | Parallel fights | **≤ 1 started encounter per campaign** (several) | Simpler turn and undo scope |
| P16 | OQ-CBT-25 | Token binding at Start | **Auto-bind by definition in token `seq` order; unmatched → token-less, visible; preview in the Start dialog** (DM binds by hand) | #77, no extra clicks |
| P17 | OQ-CBT-09 | Unapplied cards after End | **Stay pending; apply → `conflict`; DM dismisses** (auto-dismiss at End) | Nothing silently lost |
| P18 | OQ-CHAR-05 | Ability scores | **No** (display-only field) | Not tier S |
| P19 | OQ-CHAR-11 | Sheet HP changes in the game log | **No** ("Mira −5 HP" line) | DM sees HP live; event log keeps it |
| P20 | OQ-CHAR-12 | DM edits PC basics in the UI | **No; fixtures + `PUT /api/entities`** (small form) | #100 |
| P21 | OQ-DICE-09 | Hidden category: what do players see? | **Nothing** ("DM rolled something") | No timing tells |
| P22 | OQ-DICE-11 | Per-roll public override | **Yes, preset from the category** (category only) | Exceptions without changing settings |
| P23 | OQ-DICE-14 | New-campaign tickbox defaults | **All hidden** (all public; attack, damage, initiative, healing public) | No accidental leak; the DM ticks once. Fixture `dice-settings` ticks the combat ones |
| P24 | OQ-DICE-15 | Contested checks | **Two entries, no winner computed** (contest flow) | Scope |
| P25 | OQ-DICE-20 | Expression limits | **As proposed (≤ 50 dice, ≤ 10 terms, ≤ 60 chars)** | Covers 5e; blocks abuse |
| P26 | OQ-NOTE-04 | Toast timing | **Info hides after 6 s (paused on hover / hidden tab); pending stays** (all sticky) | Less noise |
| P27 | OQ-NOTE-09 | Where "seen" lives | **Browser localStorage per campaign and owner** (server read-state) | Same as layout (#121); no server state |
| P28 | OQ-NOTE-08 | `loot-received` notification | **Defer to the Reward gate** (spec suggests yes, info to all) | Owned by party-loot, not yet specced |

---

## 3. Integrator can settle alone

Technical or local items, with picks.

| # | ID / source | Pick |
|---|---|---|
| I1 | OQ-CHAR-06 (**blocking**), review-1 X2 | Internal roll API: `dice.evaluate` + `gameLog.append` in `char.roll`'s transaction. `char.roll` emits a new `CharacterRolled` event (logged, not undoable). |
| I2 | OQ-CHAR-08 | Undo applies the inverse delta, clamped (CHAR and CBT agree). |
| I3 | OQ-DICE-07 + review-1 C5 / D9 | Manual entry = dice total, per-die optional. The popover takes N expressions (attack = 2) and shows the doubled damage on a nat 20 (FR-CBT-17). |
| I4 | OQ-DICE-16, -17 | As agreed by DICE and CBT. Roll line at roll time, outcome line at apply. One category per entry. Hidden attacker or target → hidden. |
| I5 | OQ-DICE-21 | Physical-dice mode in browser storage. |
| I6 | OQ-NOTE-02 | Game log and notifications stay separate. |
| I7 | OQ-NOTE-06 | Combat owns kind `damage-card`. |
| I8 | OQ-CBT-11 | Close it: ADR-0014 already gives every roll adv/dis + manual entry, for players too. |
| I9 | OQ-CBT-20 | Undo marker on combat's own table ("combat log entry"), plus a compensating event. Amend the data-model note (:122) that planned it on the event log. |
| I10 | OQ-ENT-10, OQ-ENT-11 | As CBT: the hook clamps HP and follows max; CR 0 = 10 XP. |
| I11 | OQ-FIX-04 | `mid-combat` bundle. Amend the FIX §8 `encounter-1` row (review-2 A13). |
| I12 | OQ-SHELL-06 | Confirm window kinds: `char.sheet`, `dice.log`, `note.history`, `cbt.initiative` (both); `cbt.encounters` (DM). |
| I13 | OQ-DICE-19, OQ-CBT-26 | Glossary: add Log entry, Roll mode, Physical-dice mode, Attack popup, Health band. Reword "Damage card" (notification kind; normal / half / none / double). Name the HP-change row "combat log entry". |
| I14 | review-1 X5 | Helpers take `env: CommandEnv` (`dice.evaluate(env, …)`, `characters.adjustHp(env, id, delta)`, `notify(env, …)`, hooks `(env, before, after)`). Write "`env.actor.campaignId` / `.playerId`". |
| I15 | review-1 X6 | Rule in protocol §8: a helper whose record needs its own `cause` emits its own event, after the owner's event. Others return changes. |
| I16 | review-1 X3 | Narrow the character-sheet goal and leak scan to sheet data (roll lines are public by #73). |
| I17 | review-1 X7 | Per-type snapshot budget table in protocol. Notification payload ≤ 1 KB or history window 50. Count combat's types (A10). |
| I18 | review-1 X8 | Combat's HP-change row covers weapon / damage type. Dice adds optional `actionId` only if the out-of-combat sheet attack needs linking. |
| I19 | review-1 N3 | Summary toast only after the first snapshot of a load or reconnect, not on scene-switch resyncs. |
| I20 | review-2 A1 | `playerTurnCombatantId` copy on the encounter (ADR-0021-safe turn marker). |
| I21 | review-2 A3 | `tokenId` in redacted combatants. |
| I22 | review-2 A6 | Record type `hp-change`, `audience: dm`; snapshot = the started encounter's rows. |
| I23 | review-2 A7, T1 | Combat's definition hook refreshes bound combatants still showing the old portrait. |
| I24 | review-2 A8 | Drop `Roll.entryId`. Entries → rolls via `rollIds`. |
| I25 | review-2 A9 | A player re-rolling initiative that is already set → `conflict`. |
| I26 | review-2 A10 | Encounter snapshot = planned + started + newest 20 ended. |
| I27 | review-2 A11 | DMG ladder `[0.5 … 5]`, clamped; licence note. |
| I28 | review-2 A15 | Undo event order (`CombatEntryUndone`, then reopen). |
| I29 | review-2 A16 | Amend ADR-0014's deferred row and the feature-tiers note: hit/miss vs AC is MVP (#74). |
| I30 | NCR consequence; review-1 §5 | ADR-0016 "MVP use" line: damage cards are created by the attack command via `notify`, not by a listener. |
| I31 | review-1 C4, N5, D10; review-2 A14 | Mark FRs that rest on open OQs *(proposed, OQ-…)* in all four specs. |

---

## 4. Shared-file changes the Combat builds need (AGENTS §9.9)

Each line: path — what — needed by. The orchestrator picks "sequence" or "shared branch first".

**Core and tooling**
1. `src/server/commands/context.ts` (`CommandContext`, `realContext`, seeded factory) — `ctx.dice` engine (CSPRNG / seeded, disposable guard) — DICE (OQ-DICE-18, blocking). **Plus** the fixtures loader (`src/server/features/fixtures-adapters/`, another feature's code) reseeds dice per fixture key — assign that path.
2. `package.json`, `bun.lock` — add `@dice-roller/rpg-dice-roller` (ADR-0001; not installed yet) — DICE.
3. `biome.json` — restricted global `Math.random` in server code; the client backoff legitimately uses it, so scope the rule — DICE (FR-DICE-03).
4. `src/server/ws/` + `src/shared/protocol/` — optional `window` (+ `pin`) on record-type registration; convergence and leak-scan helpers honour it — WIN (DICE, NOTE).

**Schema, events, protocol**

5. `src/server/db/` — tables:
   - `roll`, `game_log_entry` (unique campaignId + n), `game_log_settings` (DICE)
   - `notification` (NOTE)
   - `encounter` (partial unique: one `started` per campaign), `encounter_entry`, `combatant`, `hp_change` (CBT)
   - CHAR: none.
6. `src/shared/events/` — event types:
   - `DiceRolled`, `LogEntryVisibilitySet`, `PublicLogCategorySet`
   - `NotificationCreated` / `Resolved` / `Dismissed` / `Reopened`
   - `CharacterHpAdjusted`, `CharacterRolled` (I1)
   - `EncounterCreated` / `Updated` / `Deleted` / `Started` / `Ended`, `InitiativeRolled` / `Set`, `TurnChanged`, `CombatantRemoved` / `Restored`, `AttackRolled`, `AttackApplied`, `HpApplied`, `CombatEntryUndone`
7. Record-type registry (append-only lines): `game-log-entry`, `game-log-settings`, `notification`, `encounter`, `encounter-entry`, `combatant`, `hp-change` (I22).
8. `src/server/app.ts` route mount (append-only) — `/api/encounters` — CBT.

**Registries**

9. **New append-only registries to add to the AGENTS §9.9 list** (each created empty by its owner's build):
   - `src/shared/dice/kinds.ts` — log-entry kinds (DICE creates; CBT adds `cbt.attack`, `cbt.hp`).
   - Server notification kind registry — NOTE creates; CBT adds `damage-card`. Say where it lives; NOTE says each feature's own module.
   - `src/client/dm/notification-views.ts`, `src/client/player/notification-views.ts` — NOTE creates; CBT adds `damage-card` with DM `onAction` (OQ-NOTE-10).
   - scenes-map server **token-changed hook registry** — created by `build/scenes-map` (TOK); CBT adds a line.
   - scenes-map client **token menu / double-click registry** (FR-MAP-29, CON-33) — CBT is the second registrant ("Damage / heal…", "Remove from combat") (OQ-CBT-27).
   - character-sheet client **roll-action routing** (B2): the sheet's Attack and Initiative buttons call a registered handler. Either a new registry the CHAR build creates and CBT fills, or the orchestrator assigns CBT the sheet's button path.
10. Existing append-only registries (add lines only):
    - `src/client/dm/windows.ts`, `src/client/player/windows.ts` (`char.sheet`, `dice.log`, `note.history`, `cbt.initiative`, `cbt.encounters`)
    - entities' definition-changed hooks (CBT FR-CBT-06)
    - DM `creatureActions` (CBT New / Derive / Edit)
    - `fixtures/bundles/index.ts` (`character-sheet`, `dice-log`, `notifications`, `combat`, `mid-combat`)

**Existing shared UI and complete specs**

11. `src/client/common/` shell (existing files, FR-SHELL-07) — `badge?(store)` on window types (NOTE launcher unread badge). Header actions for the dice gear, or move the gear into the window body (review-1 X10 / D8).
12. scenes-map (spec complete, build queued) — fold into `build/scenes-map` rather than a later `fix/*`:
    - token commands (`map.updateToken`, `setTokenHidden`, `deleteToken`, scene delete; FR-MAP-20 per T1) run token-changed hooks
    - FR-MAP-12: click selects any visible token; selected token id exposed to features (B5)
    - Needs the DM's OK on B4 / B5 first.

**Docs (integrator, at merge)**

13. Protocol §5–§8 rows for the new types, intents and events; §16/§17 rows plus a token-hooks section; close CON-33.
14. Data-model rows for the new tables; amend the :122 undo note (I9).
15. Glossary (I13). ADR-0016 "MVP use" line (I30). ADR-0014 + feature-tiers hit/miss line (I29). FIX §8 rows (`encounter-1` change, new fixtures) (I11). AGENTS §9.9 registry list (item 9).

**Suggested build order**
1. `fix/*` core: items 1–4, plus each spec's tables and events.
2. `build/scenes-map` with item 12.
3. `build/dice-roll-log`, then `build/notifications`.
4. `build/character-sheet`.
5. `build/combat-tracker`.
