---
title: Combat extras
prefix: CBTX
status: in-review
owner: spec-combat-extras
phase: post-mvp-1
---

# Combat extras

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Builds on [combat-tracker](combat-tracker.md) (CBT); sprint plan [sprint-1](../agents/sprint-1.md) track D (#177).

## 1. Summary

- Combat depth on top of the MVP tracker: **effects** (5e conditions, custom round-based effects like "Bless: 10 rounds", **concentration**), **temp HP**, **death saves**, **add combatants mid-fight**, and two token overlays: **HP bar** and **condition icons**.
- Every capability is a server command ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Rules (expiry, concentration prompts, death-save failures, temp HP absorption) run **inside the causing command's transaction** as rule hooks and the HP rules helper; no post-commit listener writes state (proposed ADR, OQ-CBTX-01). A crash loses nothing.
- Players see what the table sees: conditions and effects on visible creatures, their own PC's numbers, a monster's health band only (#138), other PCs' death state but no HP.

## 2. Scope

Proposed for the DM gate (#177). *(proposed)* = picked here, not in the brief.

- **Effects**: 15 conditions (5e list incl. exhaustion 1–6), custom effects with a label and optional duration in rounds, concentration (one per creature). Effects on monsters (combatant) and PCs (character; persist outside combat *(proposed, OQ-CBTX-05)*).
- **Durations**: round-based, end at the start of the anchor's turn; auto-expire on Next, restored on Prev *(proposed, OQ-CBTX-02/04)*. Effects linked to a concentration end with it.
- **Concentration**: on damage, a **concentration card** (notification with action "Roll save", DC = max(10, ⌊damage / 2⌋)); click-to-roll CON save; fail → concentration and linked effects end.
- **Temp HP**: PCs and monsters; absorbs damage first; undo-safe.
- **Death saves** (PCs at 0 HP): successes / failures, nat 1 = 2 failures, nat 20 = 1 HP, 3 successes = stable, 3 failures = dead; damage at 0 HP = 1 failure (crit 2); DM stabilise.
- **Add combatants mid-fight**: tokens from the map, characters or monsters from a picker; initiative per [FR-CBT-46/47](combat-tracker.md#6-functional-requirements) (#172).
- **Token overlays**: HP bar (DM: all; player: own PC proportional, monsters band only), condition / effect icons, PC death badge.
- **UI**: Initiative rows and menus (DM, player), token menu entries, notification views, and three sheet sections registered through character-sheet-full's seam (§7.1).

## 3. Goals

- The DM runs conditions, concentration and durations without paper: nothing to remember at turn start, a concentration save prompt on every hit.
- A dying PC's player rolls their own death saves from the sheet; everyone sees who is dying, stable or dead.
- A wrong apply is still fixed in two clicks (Undo): temp HP, death-save failures and effects ended by that damage come back too.
- Hard kill at any point → restart → effects, temp HP, death saves, pending concentration cards intact.
- No hidden creature, secret effect, monster HP or temp HP reaches a player.

## 4. Non-goals

- Rules automation beyond §6: no advantage / disadvantage from conditions, no speed 0 from grappled, no auto-crit vs paralysed, no condition immunities (reminders only, OQ-CBTX-06).
- Undo of effect, temp HP or death-save commands (corrected by the inverse command; undo stays combat log entries only, ADR-0016, OQ-CBTX-20).
- Sheet layout and editing (→ [character-sheet-full](post-mvp/character-sheet-full.md), CHARX). Spells and slots (CHARX).
- Items in §16.

## 5. User stories

- **DM:** As the DM, I want to box-select three goblins and mark them Frightened from the token menu, and see the icons on their tokens, so that I don't track conditions on paper.
- **DM:** As the DM, I want Bless to drop off Mira and Thorn when Mira loses concentration or after 10 rounds, so that I never forget an expired buff.
- **DM:** As the DM, I want to drop two more goblins on the map mid-fight, add them to combat and roll their initiative, so that reinforcements cost seconds.
- **Player:** As a player, when my concentrating cleric is hit, I want a prompt with the DC and one click to roll my CON save, so that nobody has to remember.
- **Player:** As a player at 0 HP, I want to roll my death save on my sheet and see my successes and failures, so that the drama stays at the table, not in arithmetic.
- **Player:** As a player, I want to set my temp HP after False Life and see hits eat it first.

## 6. Functional requirements

All commands: rows + event-log entry + domain event in one transaction; IDs, time from `ctx`, dice from `ctx.dice` ([AGENTS §9.3](../../AGENTS.md#93-fixtures), #137). Failure → no change, event or log entry. "Started encounter" = the campaign's `started` encounter ([FR-CBT-07](combat-tracker.md#6-functional-requirements)). Target ref = `{combatantId}` (an active combatant of the started encounter; a PC combatant resolves to its character) or `{characterId}` (any character of the campaign).

| ID | Requirement | Notes |
|---|---|---|
| **Rule mechanism** | | |
| FR-CBTX-01 | **Rules run in the causing command's transaction** (OQ-CBTX-01, proposed ADR [combat-rule-hooks](../architecture/adr/proposed-combat-rule-hooks.md)). Two seams: (a) `hpRules.apply(env, target, {kind, raw, crit, source})` (CBTX, server) is the **only** path that changes a creature's HP, temp HP or death saves from damage / heal; (b) `combatRuleHooks` (append-only server registry, created by this build) with hook points `started`, `added`, `turnChanged`, `ended`, each `(env, encounter, detail) → RecordChange[]`, may call `notify`; rows go into the causing event's `changes`. A hook error rolls back the command. No listener writes state. | ADR-0027 C |
| FR-CBTX-02 | Callers of `hpRules.apply`: `cbt.applyCard`, `cbt.applyHp` (replaces [FR-CBT-22](combat-tracker.md#6-functional-requirements)'s HP step), `cbt.undo` (`hpRules.revert`), `char.adjustHp` (OQ-CBTX-13). It writes monster HP on the combatant and PC HP via `characters.adjustHp` ([FR-CHAR-13](character-sheet.md#6-functional-requirements)), and returns the facts in FR-CBTX-21. Hook callers: `cbt.start` (`started`), `cbtx.addCombatants` (`added`), `cbt.nextTurn` / `prevTurn` (`turnChanged`), `cbt.end` (`ended`). | |
| **Effects** | | |
| FR-CBTX-03 | **Effect** = one row: `kind` `condition` \| `custom` \| `concentration`, a target (combatant for monsters, character for PCs), optional duration, optional link to a concentration, `secret` flag (§8). Conditions: blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralysed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion (level 1–6). Keys and one-line reminder text in `@shared/combat-extras/conditions.ts` (own words, no rules text). | 5e 2014 list |
| FR-CBTX-04 | `cbtx.addEffect {targets [ref] 1–20, kind: condition \| custom, condition?, level?, label?, durationRounds? 1–100, sourceCombatantId?, linkConcentration?, secret?}` (DM). `condition` needs a key (level 1–6 iff exhaustion); `custom` needs `label` 1–40 (trimmed, no control chars). A target already having that condition: skipped (exhaustion: level set). Monster refs need the started encounter (`not_found`). ≤ 20 active effects per target, ≤ 300 active per campaign (`conflict`). Emits `EffectsAdded`. | |
| FR-CBTX-05 | **Duration** (needs the started encounter, else `conflict` "Durations need a running encounter"): `endsRound = max(round, 1) + durationRounds`; **anchor** = `sourceCombatantId` if given, else the turn combatant, else the target's combatant. The effect ends **at the start of the anchor's turn in `endsRound`**, i.e. on the `cbt.nextTurn` that makes the anchor the turn combatant with `round = endsRound`, or the first Next into a round > `endsRound` (anchor removed or skipped). Shown as "N rounds left" = `endsRound − round`. | OQ-CBTX-03 |
| FR-CBTX-06 | **Expiry** (`turnChanged` hook, Next): ends every effect FR-CBTX-05 says ends, `endedReason: expired`, `endedRound` / `endedTurnId` = the new turn; one DM info notification `cbtx-expired` "Ended: Bless (Mira, Thorn)" per Next with ≥ 1 expiry. Rows in `TurnChanged.changes`. | OQ-CBTX-02 |
| FR-CBTX-07 | **Prev restores** (`turnChanged` hook, Prev): effects with `endedReason: expired` whose `endedRound` / `endedTurnId` = the turn being left are active again (concentration links too). No notification. | OQ-CBTX-04; as FR-CBT-40 |
| FR-CBTX-08 | `cbtx.updateEffect {effectId, level?, durationRounds?, secret?}` (DM): duration recomputes `endsRound` from now. `cbtx.endEffect {effectId}` (DM; owning player: own PC's concentration only): `endedReason: removed`. Emits `EffectUpdated` / `EffectsEnded`. | |
| FR-CBTX-09 | **Concentration**: `cbtx.setConcentration {target: ref, label, durationRounds?}` (DM; owning player: own PC): creates a `concentration` effect; an active one on the same target ends first (`replaced`). One active per target (partial unique index). Emits `ConcentrationSet`. | |
| FR-CBTX-10 | **Linked effects**: `addEffect` with `linkConcentration: true` and a `sourceCombatantId` that has an active concentration sets `concentrationId`; none → `conflict` "‹source› is not concentrating". When a concentration ends for **any** reason, every active linked effect ends with it (`endedReason: concentration`) and every pending `cbtx-concentration` card for it is resolved `{outcome: "ended"}`, same transaction. | |
| FR-CBTX-11 | **Incapacitating conditions end concentration**: adding incapacitated, paralysed, petrified, stunned or unconscious to a concentrating target ends its concentration (`endedReason: incapacitated`) in `addEffect`'s transaction. Every other condition is a reminder only (icon + reminder text). | OQ-CBTX-06 |
| FR-CBTX-12 | **End** (`ended` hook): effects on the encounter's monster combatants and every effect with a duration in it end (`endedReason: encounter-ended`); PC effects without duration (incl. concentration) stay. Rows in `EncounterEnded.changes`. Pending `cbtx-concentration` cards stay pending (FR-CBTX-10 closes them if the concentration ends). | OQ-CBTX-05, OQ-CBTX-15 |
| FR-CBTX-13 | **Hidden copy**: `effect.hidden` = the target's bound combatant `hidden` (PCs: their active combatant's; none → false). Written by `addEffect`, the `started` / `added` hooks and CBTX's token-changed hook line ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) on hide / reveal, in the token command's transaction. | ADR-0021: fns read only the record |
| **Temp HP** | | |
| FR-CBTX-14 | `tempHp` int 0–999 (default 0) on monster combatants and on characters. `cbtx.setTempHp {target: ref, value}` (DM; owning player: own PC) **replaces** the value (5e: no stacking; the UI hints "keep the higher"). `TempHpSet`; not a combat log entry, no game-log line, not undoable. Same value → no-op, no event. | OQ-CBTX-07 |
| FR-CBTX-15 | **Absorption** (`hpRules.apply`, damage): `absorbed = min(tempHp, raw)`; `tempHp −= absorbed`; HP loses `raw − absorbed` (clamped). `applied` keeps its meaning (HP lost); `overkill = max(0, raw − absorbed − hpBefore)`. Heal never touches temp HP. Health band uses `hpCurrent` only. | FR-CBT-22 |
| **HP rules and undo** | | |
| FR-CBTX-16 | **0 HP ends concentration**: damage that leaves the target at 0 HP ends its concentration (`endedReason: down`, `endedByHpChangeId` = the row). | 5e: unconscious |
| FR-CBTX-17 | **Concentration card**: damage with `raw > 0` (before absorption) to a target with active concentration and HP > 0 afterwards → `notify` kind `cbtx-concentration`, one per damage row: text "‹name›: concentration save DC N (‹label›)", payload §8, action "Roll save". PC → audience `player` = owner, action owner the owner (if the owner can see the PC; hidden PC, #141 → `dm`); monster → `dm`. Emitted after the row's owner event (`AttackApplied` / `HpApplied` / `CharacterHpAdjusted`). | ADR-0027 A |
| FR-CBTX-18 | `cbtx.rollConcentration {notificationId, mode?, manual?, public?}` (DM; action owner): card pending (`conflict`), concentration still active (else the card is already closed, FR-CBTX-10). Rolls `1d20 + CON save bonus` (FR-CBTX-42) via `dice.evaluate`, one `roll` entry, category `saving-throw`, label "Concentration save (DC N)"; public per [FR-DICE-13](dice-roll-log.md#6-functional-requirements) (player → public; hidden monster → never). `total ≥ DC` → kept; else concentration ends (`save-failed`, FR-CBTX-10). `resolveNotification` `{total, dc, success}`. Emits `ConcentrationRolled`, then `NotificationResolved`. Player `public` → `forbidden`. | |
| FR-CBTX-19 | **Death saves** (characters): `deathSuccesses`, `deathFailures` int 0–3. Derived `deathState`: `dead` if failures = 3; else `stable` if hp = 0 and successes = 3; else `dying` if hp = 0; else null. | |
| FR-CBTX-20 | `hpRules.apply` on a **character**: damage with `raw > 0` at `hpBefore = 0` (not dead) → failures + 1 (+ 2 if the card is a crit), successes 0 if it was stable; heal to HP > 0 → both counters 0. Massive damage is not automated (OQ-CBTX-11). | 5e |
| FR-CBTX-21 | **Combat log entry** (`hp_change`) gains `tempBefore`, `tempAfter`, `deathBefore`, `deathAfter` (`{successes, failures}` \| null when unchanged), `noteIds` (concentration cards it created). `…facts` in `AttackApplied` / `HpApplied` carry them. | stats #54 |
| FR-CBTX-22 | **Undo** (`hpRules.revert`, in `cbt.undo` per row, [FR-CBT-35](combat-tracker.md#6-functional-requirements)): HP inverse as today; `tempHp += tempBefore − tempAfter` (clamp 0–999); death counters set to `deathBefore` if the row changed them; effects with `endedByHpChangeId` = the row active again; pending cards in `noteIds` resolved `{outcome: "undone"}`; closed ones stay. Rows in `CombatEntryUndone.changes`. | ADR-0016 A |
| **Death saves** | | |
| FR-CBTX-23 | `cbtx.rollDeathSave {characterId, mode?, manual?, public?}` (DM; owner): `deathState = dying` (else `conflict` "Not dying"). Rolls `1d20` (mode allowed), one `roll` entry, category `saving-throw`, label "Death save", actor = character name; public per FR-DICE-13. Natural 20 → `hpRules.apply` heal 1 (counters reset); natural 1 → failures + 2; ≥ 10 → successes + 1; else failures + 1 (cap 3). Emits `DeathSaveRolled` (+ `CharacterHpAdjusted` changes inside it on a 20). In or out of combat. | |
| FR-CBTX-24 | `cbtx.setDeathSaves {characterId, successes, failures}` (DM): any values 0–3 at 0 HP (`conflict` above 0). **Stabilise** = successes 3. `DeathSavesSet`. | |
| FR-CBTX-25 | **Dead PCs skip turns** (amends [FR-CBT-14](combat-tracker.md#6-functional-requirements) eligibility and the FR-CBT-50 skip cue: "Skipped Thorn (dead)"). Dying and stable PCs keep their turn. | OQ-CBTX-10 |
| **Add combatants mid-fight** | | |
| FR-CBTX-26 | `cbtx.addCombatants {encounterId, items [{tokenId} \| {characterId} \| {definitionId}] 1–20}` (DM): encounter `started` (any round), total combatants ≤ 56 (`conflict`). `tokenId`: on the encounter's scene, not bound to an active combatant of it, its `definitionId` a monster or character; `characterId`: a character of the campaign; `definitionId`: a monster (`resolveDefinition`). A character already an active combatant → `conflict` "Mira is already in combat". All or nothing. | |
| FR-CBTX-27 | Binding as [FR-CBT-08](combat-tracker.md#6-functional-requirements): a token item binds that token; character / definition items take the next unbound token on the scene with that `definitionId`, else token-less (FR-MAP-16 numbering, portrait, visible). Monsters `hpMax = hpCurrent = effectiveStats.hpMax`, `tempHp 0`, `movedFt 0`. `initiative` null: sorts last, rolls once per FR-CBT-46/47, no change there. Ranks (FR-CBT-13) and `playerTurnCombatantId` rewritten; `added` hook (FR-CBTX-13). Emits `CombatantsAdded {encounterId, combatantIds}`. Encounter entries unchanged (OQ-CBTX-17). | #172 |
| **Token overlays** (`tokenOverlays` line `cbtx`, [FR-MAP-34](scenes-map.md#6-functional-requirements); tokens bound to an active combatant of the started encounter) | | |
| FR-CBTX-28 | **HP bar** (new overlay field `bar`, OQ-CBTX-21): DM: every bound token, `hpCurrent / hpMax` in band tone (`hp.full` / `hp.bloodied`; none at 0, the Down X shows it), temp HP as a neutral segment after it (≤ 100 % total). Player: own PC (full `entity`) the same; other PCs none; monsters a **full-width bar in the band's tone, no proportion** (#138, OQ-CBTX-08). | #138 |
| FR-CBTX-29 | **Effect icons** (new overlay field `icons`): one icon per active effect the viewer receives (conditions: per-key lucide icon; custom: one generic icon; concentration: its own icon; exhaustion with level), max 4 then "+N", test id `cbtx-token-effect` + `data-value` = key. Not shown for ended or secret effects to players. | |
| FR-CBTX-30 | **Death badge** (existing `badges`, label row): PC token with `deathState` dying → "Dying" (`hp.down`), stable → "Stable" (neutral), dead → "Dead" (`hp.down`), for everyone who receives the token (players from the redacted `deathState`, FR-CBTX-32). | as FR-CBT-38 |
| **Visibility** | | |
| FR-CBTX-31 | `effect` record (scope `campaign`): DM full. Player: hidden if `secret`, `hidden`, or ended; else redacted `{id, kind, condition, level, label, targetCombatantId, targetCharacterId, encounterId, endsRound}` (no source, anchor or concentration link: they may name hidden creatures). Snapshot: active effects (not windowed; capped by FR-CBTX-04). | ADR-0021 |
| FR-CBTX-32 | `tempHp` on `combatant`: never in a player redaction. On `entity` (character): DM + owner full; other players' redaction ([FR-ENT-15](entities.md#6-functional-requirements)) gains `deathState` (no counters, no temp HP). | #138, #154; OQ-CBTX-09 |
| **Client** | | |
| FR-CBTX-33 | **DM Initiative row** additions (`cbt.initiative`): temp HP "+5" after HP; effect chips on the name line (icon + label / condition, "3r" if timed, eye-off if secret; click → menu Edit / End); PC death pips (●●○ / ✗✗○) and state. Row menu gains **Conditions ▸** (15 toggles, exhaustion level submenu), **Effect…**, **Concentration…**, **Temp HP…**; for a dying PC **Death save** (roll control) and **Stabilise**; **Set death saves…**. Header **Add…** (Dialog: picker over monsters + characters × quantity, binding preview as Start). | CBT §7 |
| FR-CBTX-34 | **Player Initiative row**: effect chips the player receives (rounds left); PCs' death state Badge (own PC with pips). | |
| FR-CBTX-35 | **Token menu** (DM, registry FR-MAP-29): **Conditions ▸**, **Effect…**, **Temp HP…** on tokens bound to an active combatant: act on every selected bound token if the right-clicked one is in the selection, else on it alone. **Add to combat** on tokens not bound to an active combatant while an encounter is started (all selected unbound tokens likewise). | FR-MAP-31 |
| FR-CBTX-36 | **Effect dialog**: Condition / Custom tab; label; duration (rounds, blank = until removed); source (default turn combatant) with "Ends at the start of ‹source›'s turn, round N"; "Ends with ‹source›'s concentration (‹label›)" checkbox (shown iff the source concentrates); "Hidden from players". Concentration dialog: spell label + duration. | |
| FR-CBTX-37 | **Notification views** (both clients): `cbtx-concentration`: brain icon, text; `onAction` opens a roll popover (shared roll control, [FR-DICE-24](dice-roll-log.md#6-functional-requirements): Shift / Ctrl, physical dice, DM public toggle) → `cbtx.rollConcentration`; resolved "DC 12: 14 — kept" / "DC 12: 7 — lost" / "Ended" / "Undone". `cbtx-expired` (DM): info row. | FR-NOTE-19 |
| FR-CBTX-38 | **Turn alert detail** for a dying own PC: "Your turn — Mira (death save)" ([FR-CBT-41](combat-tracker.md#6-functional-requirements), client only). | |
| FR-CBTX-39 | **Log lines**: death and concentration saves are `roll` entries (FR-DICE-20 formatting; "Mira — Death save: 14 — success (2 / 0)" via label + payload note). The `cbt.attack` / `cbt.hp` line's `dmPayload` gains `absorbed`; the DM line shows "(3 absorbed by temp HP)"; players' line unchanged (OQ-CBTX-12). | FR-CBT-53 |
| FR-CBTX-40 | Controls disabled unless `live`; one intent in flight per control; lost in-flight intent → Toast "Connection lost — check …"; reject → Toast ([FR-CBT-29](combat-tracker.md#6-functional-requirements)). | |
| **Character sheet seam** (§7.1) | | |
| FR-CBTX-41 | CBTX registers three sheet sections through character-sheet-full's section registry (OQ-CBTX-14): `cbtx.temp-hp`, `cbtx.death-saves`, `cbtx.effects` (§7.1). They read only records in the store and send only CBTX intents. | |
| FR-CBTX-42 | **CON save bonus** for concentration: the value the sheet's CON Save button shows. Today `saveBonus(effectiveStats(entity), "con")` ([FR-ENT-24](entities.md#6-functional-requirements), [ADR-0032](../architecture/adr/0032-ability-derivation.md)) for PCs and monsters; if CHARX adds save overrides, its resolver (OQ-CBTX-14). No ability scores → `conflict` "No ability scores" (the DM rolls by hand and resolves with `setConcentration` / `endEffect`). | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, dense; `hp.full` / `hp.bloodied` / `hp.down`, `visibility.hidden`; lucide icons. No new window.

- **DM view:** Initiative rows carry chips and pips (FR-CBTX-33); a row with effects wraps to a second line, so fewer than 6 rows fit at 1440×900 (FR-SHELL-32 measured without effects; accepted). Token bars + icons on every bound token; concentration cards in Pending and as sticky toasts only when the DM is the action owner (monsters).
- **Player view:** chips on visible creatures; bars on own PC and band bars on monsters; own concentration cards as sticky toasts; own sheet sections (§7.1).
- **Map layout:** bar on the footprint's top edge inside the token group (moves with drags and previews); icons in a row below it, top-left; death badge in the label row. Exact pixels per scenes-map's renderer; screenshot at §13 step 1.
- **States:** no encounter: DM effect / temp HP / death controls still work on characters (sheet sections); Initiative empty as CBT. Disconnected: last state + banner, controls disabled. Errors: Toast.
- **Test IDs:** `cbtx-init-row-<temp|effect|death|conditions|effect-new|concentration|temp-set|death-roll|stabilise|death-set>` (`effect` + `data-record-id` = effect id, `data-value` = key or `custom`; `death` + `data-value` = state), `cbtx-init-add`, `cbtx-add-<picker|qty|binding|confirm>`, `cbtx-effect-<tab|label|duration|source|link|secret|save|end>`, `cbtx-conc-<label|duration|save>`, `cbtx-temp-<input|save>`, `cbtx-death-<success|failure|state>`, `cbtx-token-menu-<conditions|effect|temp|add>`, `cbtx-note-roll`; Konva `cbtx-token-bar` (attr `tone`, `fraction`), `cbtx-token-effect`, `cbtx-token-death` (id = token id).

### 7.1 Character sheet seam (CHARX boundary)

CBTX owns data, rules, intents and visibility; CHARX owns the sheet layout and the section registry (expected: append-only client registry, CHARX's file; OQ-CBTX-14). CBTX registers:

| Section | Shows | Intents | Who may call |
|---|---|---|---|
| `cbtx.temp-hp` | Temp HP next to HP (`entity.tempHp`); number input + Set; hint "Temp HP doesn't stack — keep the higher" | `cbtx.setTempHp {target: {characterId}, value}` | owner, DM |
| `cbtx.death-saves` | Only while `deathState` ≠ null: 3 success + 3 failure pips, state (Dying / Stable / Dead); **Death save** roll control (Shift / Ctrl, physical dice, DM public toggle); DM: Stabilise, Set… | `cbtx.rollDeathSave` (owner, DM); `cbtx.setDeathSaves` (DM) | as listed |
| `cbtx.effects` | Active effects on this character: conditions (+ level), custom with "N rounds left", concentration ("Concentrating: Bless" + End); owner: **Concentrate…** (label, duration); DM: add / edit / end any | `cbtx.setConcentration`, `cbtx.endEffect` (owner: own concentration only); `cbtx.addEffect`, `updateEffect`, `endEffect` (DM) | as listed |

- **Fields consumed from the sheet side:** `entity.hpCurrent`, `statBlock.hpMax`, `statBlock.abilities` / `saveProficiencies` → CON save bonus (FR-CBTX-42). Fields CBTX adds to the character: `tempHp`, `deathSuccesses`, `deathFailures` (play state, not in `statBlock`; `PUT /api/entities` never touches them).
- **Sheet HP control** (`char.adjustHp`, CHAR / CHARX): its damage goes through `hpRules.apply` (temp absorbs, death failure, concentration card) (OQ-CBTX-13). The sheet's "Down" badge reads `deathState` when present.
- Until the section registry merges, the DM Initiative row and token menu cover every control; players get the sections when it lands.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| **Effect** (`effect`, new) | id, campaignId, seq | ID, ID, int | `seq` DB-assigned |
| | kind, condition, level, label | `condition` \| `custom` \| `concentration`; key \| null; int 1–6 \| null; text 1–40 \| null | FR-CBTX-03 |
| | targetCombatantId, targetCharacterId | ID → Combatant \| null, ID → Entity \| null | Exactly one; monsters → combatant, PCs → character |
| | encounterId, sourceCombatantId, sourceName | ID \| null, ID \| null, text \| null | Copies at the time |
| | concentrationId | ID → Effect \| null | Linked effects (FR-CBTX-10) |
| | durationRounds, endsRound, anchorCombatantId | int \| null ×2, ID \| null | FR-CBTX-05 |
| | secret, hidden | bool ×2 | `hidden` = copy (FR-CBTX-13) |
| | endedAt, endedReason, endedRound, endedTurnId, endedByHpChangeId | timestamp \| null, `removed` \| `expired` \| `replaced` \| `concentration` \| `incapacitated` \| `save-failed` \| `down` \| `encounter-ended` \| null, int \| null, ID \| null, ID \| null | Soft end (Prev, undo) |
| | createdAt, updatedAt | timestamp | |
| Combatant *(CBT)* | + tempHp | int 0–999, default 0 | Monsters only |
| Entity *(ENT, character)* | + tempHp, deathSuccesses, deathFailures | int 0–999, int 0–3 ×2, default 0 | Play state, like `hpCurrent` |
| Combat log entry *(CBT, `hp_change`)* | + tempBefore, tempAfter, deathBefore, deathAfter, noteIds | int ×2 (default 0), **JSON leaf** `{successes, failures}` \| null ×2, **JSON leaf** ID[] | FR-CBTX-21 |
| Concentration card (`notification`, kind `cbtx-concentration`) | payload (≤ 1 KB) | **JSON leaf** | `{effectId, targetName, dc, damage, hpChangeId \| null, encounterId \| null}` |
| | resolution | **JSON leaf** | `{total, dc, success}` \| `{outcome: "ended" \| "undone"}` |
| Expiry info (`notification`, kind `cbtx-expired`) | payload | **JSON leaf** | `{effectIds}`; audience `dm`, no action |

- **Constraints:** one active concentration per target, one active condition per (target, key): partial unique indexes on rows with `endedAt` null. FKs: `targetCombatantId` / `concentrationId` set null on delete (combatants are never deleted today).
- **Relations:** Effect → Combatant or Character; Effect → Effect (concentration); combat log entry → its concentration cards.
- **Derived:** `deathState` (FR-CBTX-19), rounds left, bar fraction / tone, DC, whether a PC is skipped (dead).
- **Persisted runtime state:** effects (incl. soft-ended), temp HP, death counters, cards. Dialog edits are client memory.

## 9. API & events

**REST:** none.

**WS intents** (strict zod; none optimistic; DM-only unless listed)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `cbtx.addEffect`, `cbtx.updateEffect` | DM | FR-CBTX-04, -05, -08, -10, -11 | `{effectIds}` / — |
| `cbtx.endEffect {effectId}` | DM, owner | Player: own PC's active concentration only (else `forbidden`; invisible → `not_found`) | — |
| `cbtx.setConcentration {target, label, durationRounds?}` | DM, owner | Player: `{characterId}` of own PC | `{effectId}` |
| `cbtx.setTempHp {target, value}` | DM, owner | Player: own PC; monsters DM only | — |
| `cbtx.rollConcentration {notificationId, mode?, manual?, public?}` | DM, action owner | FR-CBTX-18; player `public` → `forbidden` | `{rollIds, entryId, success}` |
| `cbtx.rollDeathSave {characterId, mode?, manual?, public?}` | DM, owner | FR-CBTX-23 | `{rollIds, entryId}` |
| `cbtx.setDeathSaves {characterId, successes, failures}` | DM | FR-CBTX-24 | — |
| `cbtx.addCombatants {encounterId, items}` | DM | FR-CBTX-26 | `{combatantIds}` |

**Record types:** `effect` (new, FR-CBTX-31). Changed redactions: `combatant` (unchanged whitelist; test that `tempHp` never reaches players), `entity` (+ `deathState`; `tempHp`, counters only DM + owner).

**Domain events** (all logged; WS = generic record changes, `cause.name` = event; `src/shared/events/combat-extras.ts`)

| Event | Changes | Visibility (player) | Undoable |
|---|---|---|---|
| `EffectsAdded {effectIds}` | `effect` creates; ended concentration + linked (incapacitating) | per FR-CBTX-31 | no |
| `EffectUpdated {effectId}` / `EffectsEnded {effectIds, reason}` | `effect`; linked effects; closed cards (+ `NotificationResolved`) | upsert / delete per FR-CBTX-31 | no |
| `ConcentrationSet {effectId, replacedId?}` | `effect`s | per FR-CBTX-31 | no |
| `TempHpSet {targetKind, targetId, before, after}` | `combatant` or `entity` | own PC full; others nothing new | no |
| `ConcentrationRolled {notificationId, effectId, rollIds, entryId, total, dc, success}` (+ `NotificationResolved`) | `game-log-entry`; `effect`s on fail | entry iff public; card to its audience | no |
| `DeathSaveRolled {characterId, rollIds, entryId, natural, before, after}` | `entity`; `game-log-entry` | owner full; others `deathState` upsert; entry iff public | no |
| `DeathSavesSet {characterId, successes, failures}` | `entity` | as above | no |
| `CombatantsAdded {encounterId, combatantIds}` | `combatant` creates + ranks; `encounter`; `effect` hidden copies | per [combatant rule](combat-tracker.md#9-api--events) | no |
| *Existing:* `AttackApplied`, `HpApplied`, `CharacterHpAdjusted` | + temp / death fields, `effect`s ended `down`; then `NotificationCreated` per concentration card | as today + FR-CBTX-31/32 | as today |
| *Existing:* `CombatEntryUndone` | + restored temp / death / effects; then `NotificationResolved` per closed card | as today | compensating |
| *Existing:* `TurnChanged`, `EncounterStarted`, `EncounterEnded`, token events | + `effect` rows (expiry, restore, End, hidden copy); Next + `NotificationCreated` (`cbtx-expired`, DM) | per FR-CBTX-31 | no |

- **Order** in one command: owner event → its helper events. Apply: per target `AttackApplied` → that target's `NotificationCreated`(s) → … → the damage card's `NotificationResolved`.
- **Notification kinds:** `cbtx-concentration` (audience owner player or `dm`; action "Roll save"; `genericResolve` false), `cbtx-expired` (`dm`, info).
- **Helpers:** `hpRules.apply` / `revert` (CBTX); uses `dice.evaluate`, `gameLog.append`, `notify`, `resolveNotification`, `characters.adjustHp`, `effectiveStats`, `saveBonus`, `resolveDefinition`. **Signals:** none.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Conditions, custom effects, edit / end any effect | ✓ | ✗ | role |
| Start / end concentration | any target | own PC | ownership |
| Set temp HP | any | own PC | ownership |
| Roll concentration save | any card | cards they own (own PC) | FR-NOTE-08 |
| Roll death save | any PC | own PC | ownership |
| Set death saves, stabilise, add combatants | ✓ | ✗ | role |
| See effects | all | non-secret on creatures they receive | FR-CBTX-31 |
| See temp HP, death counters | all | own PC; other PCs' `deathState` only | FR-CBTX-32 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** a concentration card waits pending; summary toast on return (FR-NOTE-15); the DM may roll it meanwhile. Chips, bars, pips rebuild from the snapshot; nothing replays.
- **DM disconnect:** players still roll death and concentration saves; expiry needs Next, so nothing expires while the DM is away.
- **Server crash:** every rule runs in its command's transaction: apply ⇔ temp ⇔ death counters ⇔ concentration card ⇔ effects ended; Next ⇔ expiry ⇔ info card; undo ⇔ restores. Restart → identical snapshots. No post-commit work.
- **Concurrent:** two tabs roll one card → second `conflict`. Player rolls a death save while the DM heals → serial: the roll after the heal → `conflict` "Not dying". Concentration ends (save failed) while a second card is open → that card closes `ended` in the same transaction.
- **Prev / Next races:** `expected*` guards (FR-CBT-14). Next + Prev restores exactly the effects that Next expired.
- **Undo** after a later sheet heal: inverse deltas, clamped (I2); temp restore clamped; death counters restored only if the row changed them.
- **Removed combatant:** effects stay (shown with Out); expiry still runs. **Token deleted / unbound:** effects stay on the combatant; no icon.
- **Added mid-fight to a hidden token:** hidden combatant; its effects `hidden`. Reveal → token hook upserts both.
- **Leaks accepted:** the band bar (players had the band); a PC's `deathState` (players see Down already, #154); the rolling player's own card shows damage dealt (#138) and a concentration card names the DC (owner only); effect chips on visible monsters ("Goblin: Bless") reveal what the party saw.
- **Invalid input:** strict zod; labels as text; a player can't target another PC, a monster, or send `public`.

## 12. Performance & bandwidth

- `effect` ≈ 300 B (DM), ≈ 200 B (player); cap 300 active per campaign → ≤ 90 KB DM snapshot worst, typ. < 5 KB. CON-44 heavy DM snapshot 491 KB + 5 KB.
- One `TurnChanged` frame grows by the expired rows (typ. 0–3 × 300 B). An apply adds ≤ 1 card per target (≤ 20 × 1.5 KB worst). Bulk condition on 20 tokens = one event ≤ 6 KB.
- Overlays are pure, per token per render; `bar` + `icons` add ≤ 6 Konva nodes per token; 60 active tokens stay within the canvas budget.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)): `bun test` on `:memory:`, port 0, seeded `ctx.dice`; walkthrough on the `verify` profile ([AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Tests named after FRs. Manual rolls where values must be exact.

**Fixtures** (`fixtures/units/combat-extras/`; setups run as DM)

| Key | Requires | Contents |
|---|---|---|
| `cbtx-effects` | `combat-1` | Mira concentrates on "Bless" 10 rounds; Bless (custom, source Mira, linked) on Mira and Thorn; Goblin prone; Elite (hidden) poisoned; Goblin 2 custom "Hex" **secret** |
| `cbtx-temp` | `combat-1` | Thorn temp HP 5; Goblin temp HP 3 |
| `cbtx-reinforcement` | `combat-1` | Unbound tokens on Goblin Ambush: "Goblin 3" (`enemy-1`, visible, (14, 8)), "Wolf 2" (`enemy-2`, hidden, (15, 3)) |

- **Bundle `combat-extras`** = `combat` + `combat-1` + `cbtx-effects` + `cbtx-temp` + `cbtx-reinforcement` (round 1, Wolf's turn). `PP_TEST_MODE=1` for the walkthrough.
- **Leak strings** (player frames): "Hex", "Wolf 2", the Elite's and Wolf 2's effect ids, `sourceCombatantId`, `anchorCombatantId`, `concentrationId`, `tempHp` on any `combatant`, `deathSuccesses` / `deathFailures` / `tempHp` on another player's character, `cbtx-expired`; plus CBT §13's list.

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-CBTX-05` endsRound + anchor (round 0 → 1; source vs turn vs target); expiry predicate (anchor's turn, round past, removed anchor); `FR-CBTX-15` absorption table (temp ≥ raw, < raw, 0; overkill); `FR-CBTX-19/20/23` death state machine (success, fail, nat 1, nat 20, 3 / 3, stable then damage, crit at 0, heal resets); DC (damage 1 → 10, 23 → 11, 30 → 15); `FR-CBTX-28/29/30` overlay decorate × DM / owner / other player (bar fraction, temp segment, band bar, icons max 4 + "+N", secret hidden, death badges); effect visibility fn (secret, hidden, ended, redaction fields) | In-code |
| Integration | `FR-CBTX-04/10/11`: bulk add 3, skip duplicate, exhaustion level, link needs concentration, stunned ends concentration + linked. `FR-CBTX-06/07`: Next to Mira in round 11 ends Bless ×2 + `cbtx-expired`; Prev restores; Next again. `FR-CBTX-12`: End ends monster + timed, keeps PC no-duration. `FR-CBTX-15/17/22`: apply 2 targets (Goblin temp 3, Mira concentrating) → absorption, one card to `player-1`; undo → temp 3, card `undone`. `FR-CBTX-16`: Mira to 0 → concentration + Bless end `down`; undo restores. `FR-CBTX-18`: kept / lost; player `public` → `forbidden`; `player-2` → `not_found`. `FR-CBTX-23/24/25`: rolls, conflicts, dead PC skipped. `FR-CBTX-26/27`: token / character / definition items, duplicate PC `conflict`, hidden token → hidden + no player upsert, roll once then `conflict` (FR-CBT-47). `FR-CBTX-13`: reveal Elite → effect upsert to players. **Rollback:** each command with a throwing hook → nothing. **Crash:** `PP_TEST_CRASH cbt.applyCard:before-commit` / `after-commit` → card + temp + effects all or nothing; restart → identical snapshots. **Leak scan** per player over the whole suite | `combat-extras` |
| E2E (thin) | DM + `player-1`: Mira hit while concentrating → `player-1` toast → Roll save (manual) → card resolved for both; Goblin token shows `cbtx-token-bar` and `cbtx-token-effect` (prone) for both | `combat-extras` |

**Browser walkthrough** — needs CBT, notifications, scenes-map overlays (`bar`, `icons`) and, for B / C sheet steps, CHARX's sections (else use the DM row controls and mark sheet checks N/A). A at 1440×900. `bun run build`; `fixtures:reset-load combat-extras --profile verify`; `start --profile verify` in the test agent's Herdr pane. Contexts **A** DM (`pw-dm`), **B** `player-1` (Mira), **C** `player-2` (Thorn); B, C frame logs via `page.on('websocket')`. Evidence + teardown per AGENTS §9.6.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Open Initiative; screenshot map | B, C open links | A: Mira "Concentrating: Bless 10r", Bless chips on Mira, Thorn; Goblin prone + "+3"; Elite poisoned (eye-off row); Goblin 2 "Hex" eye-off; bars on all bound tokens. B: own bar proportional, Goblin band bar, no bar on Thorn, prone icon; C likewise with Thorn's bar "+5". No leak string |
| 2 | Box-select Goblin, Goblin 2 → token menu Conditions ▸ Frightened | — | Both tokens + rows show Frightened for A, B, C ≤ 1 s |
| 3 | Next (Mira). Add effect via Mira's row: Custom "Bane", 1 round, target Goblin 2 | — | "Bane 1r" on Goblin 2 for A, B, C (source hidden from B, C) |
| 4 | Goblin row → Attack; popup: target Mira, Hit, damage total 3, Apply | B: Roll save on the sticky toast, manual 8 | Mira 9 / 12. B: toast "Mira: concentration save DC 10 (Bless)"; A sees it pending. B: 8 + 4 = 12 → "kept" for A, B; public line "Mira — Concentration save (DC 10): …" for A, B, C |
| 5 | Elite row → Attack; target Mira, Hit, damage total 5, Apply | B: Roll save, manual 2 | Mira 4 / 12. 2 + 4 = 6 → "lost"; Bless chips gone on Mira and Thorn (A, B, C); concentration chip gone |
| 6 | Goblin row → Attack; target Thorn, Hit, damage total 4, Apply; then Undo | C: before it, sheet Temp HP 8 → Set | C: temp 8 → 4, HP 10 / 10 unchanged; A's outcome line "(4 absorbed by temp HP)", B, C's line without it. Undo → temp 8 for C ≤ 1 s |
| 7 | Next × N to Mira's turn in round 2 | — | At Mira's turn: Bane gone (A, B, C); A info "Ended: Bane (Goblin 2)". A: Prev → Bane back "1r"; Next → gone again |
| 8 | Thorn's token → Damage / heal… 99 | C: Death save manual 15, then manual 1 | Thorn: X + "Dying" badge (A, B, C); C pips 1 / 0 then 1 / 2; B frames: Thorn `deathState: dying`, no counters, no `tempHp` |
| 9 | Goblin row → Attack; target Thorn, Hit, damage total 3, Apply; then Undo | C: after the Undo, Death save manual 20 | After apply: failures 3, "Dead" for A, B, C; Thorn's row muted with the skip icon (FR-CBTX-25). After Undo: Dying 1 / 2. Nat 20 → Thorn 1 HP, badge gone, pips reset |
| 10 | Mira's token Damage 99; Mira row → Stabilise | B: sees section | Mira "Dying" then "Stable" (A, B, C); B pips 3 / 0 |
| 11 | Select Goblin 3 + Wolf 2 → token menu Add to combat; Roll monsters; Initiative Add… → Goblin × 1 | — | Two rows sorted last with Roll, then ranked; B, C see Goblin 3 only (no "Wolf 2" anywhere); "Goblin 4" token-less row; no Roll for others |
| 12 | Goblin row → Concentration… "Hold Person"; then Conditions ▸ Stunned | — | Concentration chip, then gone with Stunned (A, B, C) |
| 13 | Hard-kill + restart | — | All rejoin; effects, temp HP, pips, bars, icons, any pending card intact |
| 14 | End encounter (confirm) | — | Monster effects and Bane-style timed effects gone; Mira's Stunned (no duration) stays on her sheet section; bars and icons gone; no leak string; no app console errors |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| ADR-0016, 0021, 0022, 0024, 0027, 0028, 0029, 0032; #134–#141, #154, #172 | Events + undo, sync, seams, in-tx notifications, token hooks, windows, save bonus | accepted |
| Proposed [combat-rule-hooks](../architecture/adr/proposed-combat-rule-hooks.md) | Rules in-tx; no post-commit state writes | proposed (OQ-CBTX-01) |
| [combat-tracker](combat-tracker.md) | Apply / undo / turns / start / end call `hpRules` and `combatRuleHooks`; Initiative window, token menu, alert; FR-CBT-46/47 roll rule | complete; track P revising (R2, R4, R5) |
| [character-sheet](character-sheet.md) / [character-sheet-full](post-mvp/character-sheet-full.md) | `characters.adjustHp`; `char.adjustHp` through `hpRules`; section registry; CON save bonus | complete / in spec (track S) |
| [scenes-map](scenes-map.md) | `tokenOverlays` + `bar`, `icons` fields; token menu; token-changed hooks; selection | complete; contract change |
| [entities](entities.md) | Columns on character, redaction + `deathState`, `effectiveStats`, `saveBonus` | complete; shared change |
| [notifications](notifications.md), [dice-roll-log](dice-roll-log.md), [play-shell](play-shell.md) | `notify` / `resolveNotification`, kinds + views; `dice.evaluate`, `gameLog.append`, roll control; `alert()` | complete |

### Shared changes

Builders report `shared change needed:`; the orchestrator sequences (sprint-1: schema by shared branch first or lock; P's combat fixes merge before this build).

- **`src/server/db/`:** table `effect` (+ partial unique indexes); `combatant.temp_hp`; `entity.temp_hp`, `death_successes`, `death_failures`; `hp_change.temp_before`, `temp_after`, `death_before`, `death_after`, `note_ids`. All default-safe for push on old dev DBs.
- **`src/shared/events/`:** `combat-extras.ts` (9 events) + `index.ts` line; `HpChangeFacts` gains the new columns.
- **Record types / visibility:** `effect` line (CBTX fn); `combatant` fn unchanged (its player whitelists omit `tempHp`); `entity` fn adds `deathState`, strips the new fields for other players (ENT's file).
- **New append-only registry:** `combatRuleHooks` (`src/server/features/combat-tracker/rule-hooks.ts`, created empty by this build; add to the AGENTS §9.9 list).
- **Append-only lines:** server features `combatExtras`; notification kinds `cbtx-concentration`, `cbtx-expired` (+ both client view files); `tokenOverlays` `cbtx`; token-changed hooks `cbtx` (hidden copy); token menu entries; bundle `combat-extras`; CHARX's sheet section registry (3 lines).
- **Contract change (scenes-map's files):** `TokenDecoration` gains `bar {id, fraction \| null, temp?, tone}` and `icons [{id, icon, tone, label}]` + renderer (`token-overlays.ts` and the token renderer).
- **Other features' files this build edits** (orchestrator assigns, after P): combat-tracker `hp.ts` (apply / applyHp / undo via `hpRules`), `turns.ts` (eligibility, hooks), `lifecycle.ts` (hooks), `card-kind` untouched, `log-kinds.ts` (`absorbed`), DM / player `initiative-window.tsx`, turn alert detail; character-sheet `char.adjustHp` via `hpRules` (or CHARX's successor).
- **Docs** (integrator): data model §11 / §17 + new CBTX section; protocol new section; glossary (OQ-CBTX-19); AGENTS §9.9 registry list; FIX §8 rows.

## 15. Open questions

**Bold** = suggested pick (not decided). "DM" = needs the DM at the gate.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CBTX-01 | How do rules (expiry, concentration, death failures) close ADR-0027 C's crash gap? | **In the causing command's transaction: `hpRules` + `combatRuleHooks`** (atomic, as token hooks) / post-commit listener + boot reconciliation (decoupled; needs core re-entrancy) | yes · owner: integrator → DM ([proposed ADR](../architecture/adr/proposed-combat-rule-hooks.md)) | ADR-0016, ADR-0027, combat-tracker |
| OQ-CBTX-02 | Timed effect reaches its end | **Auto-end on Next + DM info** / pending prompt "Bless ends — remove?" (one click per expiry) | no · DM | — |
| OQ-CBTX-03 | Duration timing | **Start of the anchor's turn only** (covers "1 minute", "until your next turn") / also "end of turn" (another field, more UI) | no · DM | — |
| OQ-CBTX-04 | Prev after an expiry | **Restore what that Next expired** / DM re-adds (simpler) | no · DM | combat-tracker (as FR-CBT-40) |
| OQ-CBTX-05 | Effects outside combat | **PC effects live on the character and survive End unless timed; monster effects end at End** / every effect ends at End (no sheet persistence) | no · DM | character-sheet-full |
| OQ-CBTX-06 | Condition mechanics | **Only incapacitating conditions end concentration; rest are reminders** / also preset adv / dis on rolls (more rules, more code) | no · DM | combat-tracker, dice-roll-log |
| OQ-CBTX-07 | Player rights on own PC | **Temp HP, death save roll, concentration start / end; conditions DM only** / players also add own conditions | no · DM | character-sheet-full |
| OQ-CBTX-08 | Monster HP bar for players (#138 "never a bar") | **Full-width bar in band tone, no proportion** / no bar on monsters for players | no · DM | scenes-map |
| OQ-CBTX-09 | Other players see a PC's death saves | **`deathState` only (dying / stable / dead)** / counters too / nothing beyond Down | no · DM | entities |
| OQ-CBTX-10 | Dead PCs skip turns (amends FR-CBT-14 / -50) | **Yes** / no, DM presses Next | no · DM | [combat-tracker](combat-tracker.md) |
| OQ-CBTX-11 | Massive damage (overkill ≥ HP max → dead) | **Not automated; DM sets failures 3** / automated | no · DM | — |
| OQ-CBTX-12 | Temp HP absorbed in public outcome lines | **DM view only** (monster temp HP stays secret) / public for PCs | no · owner: spec-combat-extras | dice-roll-log |
| OQ-CBTX-13 | Sheet damage (`char.adjustHp`) through `hpRules` | **Yes** (one rule for every damage path) / combat only (sheet ignores temp HP) | no · owner: orchestrator with character-sheet-full | [character-sheet](character-sheet.md), [character-sheet-full](post-mvp/character-sheet-full.md) |
| OQ-CBTX-14 | Sheet seam with character-sheet-full: registry name / shape; CON save bonus source if CHARX adds overrides | **CHARX's append-only section registry `{id, render(store, characterId, client)}`; CBTX registers §7.1; save bonus = CHARX's resolver, today `saveBonus`** / CBTX ships its own sheet tab | **yes** · owner: orchestrator (settles with spec-character-sheet-full) | [character-sheet-full](post-mvp/character-sheet-full.md) |
| OQ-CBTX-15 | Pending concentration cards at End (track P R5 decides damage cards) | **Stay pending** (concentration outlives combat) / follow R5's rule for damage cards | no · owner: orchestrator with spec-polish-r | [combat-tracker](combat-tracker.md), notifications |
| OQ-CBTX-16 | Auto-add Unconscious to a PC at 0 HP | **No** (Down X + Dying say it) / yes, removed on heal | no · DM | — |
| OQ-CBTX-17 | Mid-fight additions update encounter entries (XP) | **No: entries are the plan, combatants and the log are what happened** / yes | no · owner: spec-combat-extras | stats |
| OQ-CBTX-18 | Where PC play state lives | **Columns on `entity` (character), like `hpCurrent`** / own table + record type (sheet reads two types) | no · owner: integrator | entities, data model |
| OQ-CBTX-19 | Glossary | **Add** Effect, Temp HP, Death save, Concentration card, Rule hook; **amend** Combatant ("conditions" → effects on combatant or character), Condition, Concentration | no · owner: integrator | glossary |
| OQ-CBTX-20 | Undo scope | **HP path only (temp, death counters, effects ended by that damage follow the apply)**; effect / temp / death commands corrected by their inverse / undo every CBTX command | no · DM | ADR-0016 |
| OQ-CBTX-21 | Token overlay contract gains `bar`, `icons` | **Yes, scenes-map renders both** (lock on scenes-map's renderer) / reuse `badges` (pills in the label row, crowded) | no · owner: orchestrator | [scenes-map](scenes-map.md) FR-MAP-34/43 |
| ~~Carried over~~ | ~~Multiple simultaneous combats; session tagging~~ | Decided earlier: one started encounter per campaign (#139 P15); encounters, not sessions ([ADR-0013](../architecture/adr/0013-session-journal-scope.md)) | — | — |

## 16. Out of scope

- Custom monster / NPC actions auto-rolled vs targets ([compendium](post-mvp/compendium.md) first); AoE / multi-target **saves** (multi-target damage is MVP, FR-CBT-34).
- Drag-to-reorder initiative (tier B); legendary / lair actions, reaction-used tracker (tier C).
- Advantage / disadvantage from conditions, condition immunities, exhaustion effects, massive damage (OQ-CBTX-06, -11).
- Effects on tokens or monsters outside an encounter; end-of-turn durations (OQ-CBTX-03); concentration on non-creatures.
- Spells, slots, hit dice (→ character-sheet-full / levelling); stats UI (→ [stats](post-mvp/stats.md)).
