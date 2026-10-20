---
title: Gems (homebrew)
prefix: GEM
status: in-review
owner: spec-gems
phase: post-mvp-7
---

# Gems (homebrew)

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Sprint 7, track GM ([sprint-7](../agents/sprint-7.md)).

## 1. Summary

- The DM's homebrew reward rule ([#140](../decisions-log.md)): the DM **awards / removes** gems per character; the player **spends** one and the game log says so. Five gems: **Inspiration**, **Fortune**, **Combat**, **Divine Knowledge**, **Action**.
- **An optional feature, off by default** ([#312](../decisions-log.md)): a per-campaign switch the DM turns on. While off: no gem UI, counts, spend actions or log lines for anyone (DM included), nothing gem-related in any snapshot or frame. The switch is a generic **feature switch** ([proposed ADR](../architecture/adr/proposed-s7-gm-feature-switches.md)); [campaign-management](campaign-management.md) FR-CAMP-38–45 owns it.
- Two gems change dice, server-side: **Inspiration** rerolls one d20 roll from the log (the old line stays, struck through; [dice-roll-log](dice-roll-log.md) FR-DICE-62–71). **Combat** sets 1 damage die to max (2 at level 6, 3 at level 12) on a pending damage card, also in the damage step after Apply hit; the card total is recomputed ([combat-tracker](combat-tracker.md) FR-CBT-126–135). Fortune, Divine Knowledge, Action: spend + log line; the effect happens at the table.
- Counts sit on the character sheet ([character-sheet-full](character-sheet-full.md) FR-CHARX-71–80), built-in icons now; art waits for the UI sprint (BL-29).

**At a glance**

| Need | FRs | Slice (§14) |
|---|---|---|
| Switch, off = nothing | FR-GEM-01–05, FR-CAMP-38–45 | GM0 core |
| Counts, award / remove, visibility | FR-GEM-06–11 | GM0 core |
| Spend: Fortune, Divine Knowledge, Action | FR-GEM-12–17 | GM0 core (server), GM3 (sheet UI) |
| Inspiration reroll | FR-GEM-18–24, FR-DICE-62–71 | GM1 |
| Combat gem (max dice) | FR-GEM-25–31, FR-CBT-126–135 | GM2 (after GM1 + ST core, seams S3) |
| Sheet block, options dialog, icons | FR-GEM-32–36, FR-CHARX-71–80 | GM3 |
| Edge rules | FR-GEM-37–40 | per slice |

## 2. Scope

- Per-campaign switch (via CAMP); gem counts per character; DM award / remove; player (and DM on their behalf) spend; one public log line per spend.
- Inspiration: reroll a d20 roll from the log; new roll replaces old; a pending attack card follows the new to-hit.
- Combat: max 1–3 damage dice on a pending card (before Apply, incl. late damage and the damage step after Apply hit).
- Gem block on the sheet; counts on other players' summary cards *(per OQ-GEM-01)*; built-in icons.
- *(proposed)* Award lines in the log (OQ-GEM-10); the DM spending on a player's behalf (OQ-GEM-14).

## 3. Goals

- The DM runs the gem rule in the app without paper: award in two clicks, see who holds what, read every spend in the log.
- A reroll or a maxed die is server-rolled / server-computed, visible to the right people, and survives reload, reconnect and a crash.
- A campaign that never turns gems on carries **0 B** of gem data and shows nothing.

## 4. Non-goals

- Enforcing the max-5 rule (#140: shown, not enforced). Automating Fortune (the DM rolls d100 at the table), Divine Knowledge (the DM answers) or Action (the action economy isn't tracked, [ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- Inspiration's "help recall an event" use (table talk; spend it as a plain spend? see OQ-GEM-05 note). Gem art (BL-29, UI sprint). Gems for monsters or companions (OQ-GEM-15). Undo of spends (OQ-GEM-09).

## 5. User stories

**DM**
- As the DM, I want to turn gems on for this campaign only, so a campaign that doesn't use them stays clean.
- As the DM, I want to award a gem from the sheet or the Players window in two clicks and see everyone's counts, so I reward at the moment it happens.
- As the DM, I want each spend in the log and a Combat gem reflected in the card before I apply it, so I never apply a stale total.

**Player**
- As a player, I want to see my gems on my sheet and spend one with a click, so the table sees it in the log.
- As a player, I want to reroll a bad d20 from its log line, and max a damage die on my pending card, so the gem does what it says without the DM doing maths.

## 6. Functional requirements

### Switch (feature `gems`)

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-01 | Gems are the feature key `gems` in CAMP's feature registry (FR-CAMP-41). **Off by default** for every existing and new campaign; the DM turns it on / off per campaign (`camp.setFeature`, FR-CAMP-39). | #312 |
| FR-GEM-02 | **Off = nothing gem-related anywhere:** no `character-gems` row and no `gem.*` log entry in any snapshot, frame or `sync.load` ack (DM included); the campaign record carries no `features` key ([FR-CAMP-38](campaign-management.md#6-functional-requirements)); no gem UI (sheet block, summary-card counts, Spend menus, log "Inspiration" action, card "Combat gem" button, DM popup chip, options other than the switch itself). Server-side by the feature tag on the record type and log kinds ([ADR](../architecture/adr/proposed-s7-gm-feature-switches.md)), not by client hiding. | Test `FR-GEM-02 off: no gem bytes` |
| FR-GEM-03 | Every `gem.*` intent while off → `forbidden` "Gems are off in this campaign"; nothing written, no event. Internal callers can't reach gem code paths while off (the commands check first). | |
| FR-GEM-04 | **Switching off keeps awarded counts, hidden** *(OQ-GEM-04 pick A)*: rows stay in the DB; switching on again shows them unchanged. Every connection of the campaign gets a fresh snapshot after the switch commits (FR-CAMP-40), so rows and lines appear / disappear without reload. | |
| FR-GEM-05 | **Dice history stays dice history:** a reroll's new `roll` entry, a superseded entry's `supersededBy` and a card's maxed dice (FR-DICE-62–66, FR-CBT-128) are generic dice facts and stay visible while off; none of them names a gem (only `gem.*` lines do). | #312 "nothing gem-related" |

### Counts, award, remove

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-06 | Record type **`character-gems`**: one row per character (`id` = character entity id), five counts `inspiration`, `fortune`, `combat`, `divine`, `action`, each int 0–99. Created on the first award; a character without a row holds 0 of each. Separate from `entity` (ADR-0036: the entity row is resent on every HP change). | §8 |
| FR-GEM-07 | `gem.adjust {characterId, gem, delta}` (DM only): `gem` ∈ the five keys; `delta` −5…+5, ≠ 0; result 0–99, else `invalid` "Mira has 0 Fortune gems"; `characterId` a character entity of the campaign, else `not_found`. Count + log line (FR-GEM-09) + event `GemsAdjusted` in one transaction. | |
| FR-GEM-08 | **Max 5 is shown, never enforced** *(OQ-GEM-11 pick A)*: a count above 5 shows in the existing `hp.bloodied` token with Tooltip "Table rule: at most 5 gems"; award stays enabled. Per gem kind *(OQ-GEM-11: per kind vs per character total)*. | #140 |
| FR-GEM-09 | **Award lines** *(OQ-GEM-10 pick A)*: an award writes a public `gem.award` line "DM awards Mira an Inspiration gem (2 held)"; a removal writes nothing to the log (the count changes quietly). | |
| FR-GEM-10 | **Visibility `character-gems`** *(OQ-GEM-01 pick A)*: DM full; the owner (`ownerPlayerId = ctx.playerId`) full; other players full too (counts only exist; party flavour). Feature off → hidden for everyone (feature tag). | |
| FR-GEM-11 | `ownerPlayerId` is copied onto the row at creation and refreshed in the same transaction as an ownership change (entities' character owner edit), so the visibility fn stays pure ([ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) B). Only needed if OQ-GEM-01 picks B; under A the field still serves the sheet's "can spend" check. | |

### Spend (all gems)

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-12 | `gem.spend {characterId, gem, …per gem}` (player: own character, else `forbidden`; DM: any character *(OQ-GEM-14 pick A)*). Count < cost → `conflict` "No Fortune gem left". Count − cost + one `gem.spend` line + event `GemSpent` (+ the gem's own changes) in one transaction. | |
| FR-GEM-13 | **Spend lines always public** *(OQ-GEM-02 pick A)*: `public: true` whoever sends; `rollerRole` / `rollerPlayerId` = the sender. Line: "**Mira** spends a Fortune gem". | |
| FR-GEM-14 | **Fortune** `{gem: "fortune"}`: line "Mira spends a Fortune gem — searching for treasure". The DM rolls the d100 at the table or in the roll bar; nothing automated. | #140 |
| FR-GEM-15 | **Divine Knowledge** `{gem: "divine"}`: line "Mira spends a Divine Knowledge gem — asks the gods a question". | |
| FR-GEM-16 | **Action** `{gem: "action", use: "bonus" \| "reaction" \| "action"}` *(OQ-GEM-12 pick A)*: cost 1 for `bonus` / `reaction`, **2** for `action`; line "Brakka spends 2 Action gems — a full action" / "… an Action gem — a bonus action". A bonus action can't be upgraded (no command does). | #140 |
| FR-GEM-17 | The sender's client asks once before sending (button turns into "Spend? ✓ ✗" for 4 s; no dialog). No undo command *(OQ-GEM-09 pick A)*: the DM fixes mistakes with `gem.adjust +1`; a reroll or a maxed die stands. | |

### Inspiration (reroll)

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-18 | `gem.spend {gem: "inspiration", characterId, entryId, manual?}`: rerolls the **d20 roll** in one log entry. **Eligible** *(OQ-GEM-05 pick A)*: kind `roll`; not `undone`, not superseded; one of its rolls has a d20 term and `actorKind = entity`, `actorId = characterId` (rolled as the character, by its player or by the DM); category ≠ `initiative`; the entry is in the log window (newest 100, FR-DICE-17); if that roll is a to-hit on a damage card, the card is `pending` and not hit-ruled (FR-CBT-126). Else `conflict` with the reason ("Already rerolled", "The DM already ruled on this attack", "Too far back"). | |
| FR-GEM-19 | The reroll uses dice-roll-log's `dice.reroll` (FR-DICE-62): new roll row with `replacesRollId`, only the d20 dice rerolled (both for adv / dis), everything else copied; new `roll` entry; old entry `supersededBy` = new entry (FR-DICE-63). Order in the log: the `gem.spend` line ("Mira spends an Inspiration gem — rerolls Perception (4)") then the new roll line. | |
| FR-GEM-20 | **Must keep the new roll** (#140): the old roll can't come back (no undo, OQ-GEM-09). The new entry may take a **second** Inspiration gem (it is not superseded) *(OQ-GEM-05 pick A)*. | |
| FR-GEM-21 | **Physical dice** *(OQ-GEM-13 pick A)*: with physical-dice mode on, the Inspiration action opens the manual popover for one d20 (`manual: {diceTotal}`, "Roll for me" too); adv / dis asks for both d20s. The new roll is marked manual. | FR-DICE-07 |
| FR-GEM-22 | **Attack to-hit:** the pending card follows the new to-hit (`toHit`, `natural`, crit) server-side (FR-CBT-126); a crit that appears or disappears with damage already on the card moves that damage to `unusedRolls` and the card waits for a new damage roll *(OQ-CBT-85 pick A)* (FR-CBT-127). | |
| FR-GEM-23 | **Final value for stats:** the superseding roll counts; a superseded entry's rolls don't (FR-DICE-67); natural 20 / 1 count on the final roll; a reroll is not an extra roll in counts; a maxed die counts only through the applied damage (`hp_change`). No "gems spent" stat (stats stay independent of an optional feature). [stats](post-mvp/stats.md) reads it that way (OQ-GEM-16, resolved by seams S2). | GM ↔ ST |
| FR-GEM-24 | **Audience kept:** the new entry copies `public` and `audiencePlayerId` of the old one (FR-DICE-62), so a DM-hidden roll's reroll stays hidden and a reroll never reveals more. | ADR-0056 |

### Combat (max dice)

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-25 | `gem.spend {gem: "combat", characterId, cardId, dice: [{part, index}] (1–3), known?}`: **Eligible** *(OQ-GEM-07 pick A)*: card `pending`; damage attached; also in the **damage step** after Apply hit (FR-CBT-89); the card's attacker is the character's combatant (`combatant.entityId = characterId`, not a companion, OQ-GEM-15); no Combat gem used on this card yet ("one attack or spell", #140). Else `conflict` ("Already applied", "Roll damage first", "A Combat gem is already on this attack"). | |
| FR-GEM-26 | **Limit by level** (`statBlock.level` at spend time): 1 die at level 1–5, 2 at 6–11, 3 at 12+; more → `invalid` "Level 6 needed for 2 dice". Fewer allowed; one gem either way. | #140 |
| FR-GEM-27 | **Which dice** *(OQ-GEM-08 pick A)*: any kept die of the base damage part or a weapon extra part (`extra[]`, e.g. Flame Tongue fire), crit dice included; `part` = `base` \| extra index; not effect bonus dice (`mods`) or trigger parts (`triggers`). A die already at its max → `invalid` "That die is already 8". | |
| FR-GEM-28 | **Physical totals** *(OQ-GEM-13 pick A)*: a manual part stored without per-die values needs `known` (that part's die values, count / faces matching, sum = the stored dice total), else `invalid` "Enter each die first". | FR-DICE-06 |
| FR-GEM-29 | Server: combat-tracker's `cards.maxDice` (FR-CBT-128) writes a new roll row per touched part (`replacesRollId`), updates the card's part (`rollId`, `dice`, `total`, `maxed`) and sets `diceMaxed`, `NotificationUpdated`. "Already on this attack" = `diceMaxed` set. The DM's popup refreshes per the late-damage fill rule; an Apply built on the old damage → `conflict` (FR-CBT-129). | ADR-0053 |
| FR-GEM-30 | Line: "Mira spends a Combat gem — Light crossbow: d8 3 → 8 (damage 7 → 12)" (per die "dN a → N"; parts named by type when > 1). Public (player damage dice are public, FR-DICE-13). | |
| FR-GEM-31 | Apply, Undo, End: the card applies the maxed total; Undo of the apply reopens it with the maxed dice kept (no refund, no second Combat gem: FR-GEM-25's "already on this attack" holds); End / Dismiss leaves the gem spent. | FR-CBT-133 |

### UI and look

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-32 | **Sheet gem block** (FR-CHARX-71): five icon + count chips; owner: a Spend menu for Fortune / Divine Knowledge / Action; Inspiration and Combat chips say where they're spent (Tooltip "Spend from a log line" / "Spend from your damage card"); DM: + / − per gem. | |
| FR-GEM-33 | **Log action** (FR-DICE-68): an eligible entry shows an "Inspiration" icon button on hover / focus to its character's owner and the DM, only while the character holds ≥ 1 Inspiration gem. | |
| FR-GEM-34 | **Card action** (FR-CBT-130, -131): the owner's pending damage card (toast + History) and the DM's popup show "Combat gem" while eligible; it opens a die picker (dice as chips, up to the level limit). | |
| FR-GEM-35 | **Look now** *(OQ-GEM-03 pick B)*: one built-in lucide icon per gem in `text.primary` (no new colour token; the gem colours of #140 come with the art): Inspiration `sparkles`, Fortune `coins`, Combat `swords`, Divine Knowledge `eye`, Action `zap`; name in the Tooltip and `aria-label`. Shapes carry the meaning, so no colour cue is needed. DM images later (BL-29). | |
| FR-GEM-36 | **Campaign options** (FR-CAMP-42): the DM's switch "Gems (homebrew)" with a one-line description; turning off asks once ("Hide gems? Counts are kept"). | |

### Edge rules

| ID | Requirement | Notes |
|---|---|---|
| FR-GEM-37 | **Races:** spends serialise. Two Inspirations on one entry → second `conflict` "Already rerolled"; two Combat gems on one card → second `conflict`; a spend racing the switch-off → whichever commits first wins; after off, `forbidden`. Count races resolve on the committed count. | |
| FR-GEM-38 | **Apply racing a Combat gem:** Apply carries every part's roll id (FR-CBT-94, -129); a maxed part or a rerolled to-hit changes it, so a stale Apply → `conflict` "The card changed — check and Apply again"; nothing applied. | |
| FR-GEM-39 | **Character changes:** a character whose owner changes keeps its gems (row follows the character); a character with gems that becomes a draft / is removed: no delete exists (FR-ENT-14), the row stays. | |
| FR-GEM-40 | **Campaign switch:** gems are per campaign; another campaign's switch and rows never reach this one's snapshot. | ADR-0020 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn defaults, dark, existing tokens; lucide icons (FR-GEM-35). No custom styling.

- **Screens:** sheet block (CHARX §7); the Game log line action (DICE §7); the damage card / DM popup (CBT §7); Campaign options (CAMP §7).
- **DM view:** Campaign options switch; gem block on every PC sheet with + / −; Players window rows show "◆ 2 1 0 0 3"-style icon counts under each character line *(proposed, CAMP FR-CAMP-43)*; log actions on every eligible entry; the popup's "Combat gem" chip on a PC's card.
- **Player view:** own sheet: block with counts and the Spend menu; other PCs' summary cards: counts only (OQ-GEM-01); own log lines: "Inspiration" action; own pending card: "Combat gem".
- **Spend lines** in the log: gem icon (sm) + text; no dice chips (the reroll line has them).
- **States:** off → none of this renders (and nothing is in the store); disconnected → buttons disabled (not `live`), counts stay; a reject → inline message under the control (Toast for log / card actions).
- **Test IDs** (`gem-` prefix): `gem-block` (+ `data-record-id` = character id), `gem-count` (+ `data-value` = gem key, `data-count`, `data-over` when > 5), `gem-award`, `gem-remove` (+ `data-value`), `gem-spend-menu`, `gem-spend` (+ `data-value` = `fortune` \| `divine` \| `action-bonus` \| `action-reaction` \| `action-full`), `gem-spend-confirm`, `gem-reroll` (+ `data-record-id` = entry id), `gem-combat` (+ `data-record-id` = card id), `gem-combat-die` (+ `data-part`, `data-index`, `data-state=picked|free|max`), `gem-combat-submit`, `gem-error`; summary card `gem-summary-count`; CAMP `camp-options-open`, `camp-feature` (+ `data-value` = feature key, `data-state=on|off`), `camp-feature-confirm`. Log: `dice-log-entry` gains `data-superseded` (DICE §7).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Campaign (CAMP) | features | **JSON leaf** `string[]` (registered keys) | FR-CAMP-38; `[]` default; omitted on the wire when empty |
| Character gems (`character-gems`) | id (= characterId), campaignId | ID, ID → Campaign | One per character; created on first award |
| | characterId | ID → Entity (character) | |
| | ownerPlayerId | ID → Player \| null | Copy, refreshed with the owner (FR-GEM-11) |
| | inspiration, fortune, combat, divine, action | int 0–99 ×5 | Not JSON: 5 columns (fixed set) |
| | updatedAt | timestamp | `ctx.clock` |
| Roll (DICE) | replacesRollId | ID \| null | **Now written**: a reroll (FR-DICE-62) or a maxed part (FR-CBT-128) |
| Game log entry (DICE) | supersededBy | ID \| null | **Now written**, once (FR-DICE-63) |
| | payload (`roll`) | + optional `replaces {entryId, total}` per roll | FR-DICE-64 |
| | kinds | + `gem.award`, `gem.spend` | feature `gems` |
| Damage card payload (CBT) | damage.maxed, extra[i].maxed | int[] ≤ 3 (die indices) | FR-CBT-128; `diceMaxed: true` on the card (generic, no gem named) |

- `gem.spend` payload: `{characterId, gem, count, use?, target? {kind: entry \| card, id, label, from, to}, dice? [{faces, from, to}] ≤ 3}`; no `dmPayload`. `gem.award`: `{characterId, gem, count, held}`.
- **Relations:** Character 1—0..1 character-gems; spend line → entry / card by id (no FK); new roll → old roll (`replacesRollId`); old entry → new entry (`supersededBy`).
- **Derived:** cost (Action), level limit, eligibility (FR-GEM-18, -25), "over 5" hint; the chain's final roll (stats).
- **Persisted runtime state:** counts, the switch. Confirm states and the die picker: client memory.

## 9. API & events

**WS intents** (none optimistic, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) E)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `gem.adjust {characterId, gem, delta}` | DM | FR-GEM-03, -07 | `{held}` |
| `gem.spend {characterId, gem, use?, entryId?, manual?, cardId?, dice?, known?}` (discriminated by `gem`) | DM, player (own character) | FR-GEM-03, -12, -16, -18, -25–28 | `{held, entryId, rerollEntryId?}` |
| `camp.setFeature {feature, on}` (CAMP) | DM | FR-CAMP-39 | `{}` |

**Record types** (scope `campaign`; feature tag `gems`)

| Type | Visibility rule | Snapshot |
|---|---|---|
| `character-gems` | Feature off → hidden (all). On: DM full; players full (OQ-GEM-01 A; B: owner full, others hidden) | All rows of the campaign |
| `game-log-entry` kinds `gem.award`, `gem.spend` | Feature off → hidden (all). On: as any entry (public → every player) | In the window |

**Domain events** (all logged; none undoable, none transient)

| Event | Emitted by | Payload | Changes | Player sees |
|---|---|---|---|---|
| `GemsAdjusted` | `gem.adjust` | `{characterId, gem, delta, held, entryId?}` | `character-gems` upsert; award line | upsert + line (feature on) |
| `GemSpent` | `gem.spend` | `{characterId, gem, cost, held, entryId, rerollEntryId?, supersededEntryId?, cardId?, rollIds}` | `character-gems` upsert; spend line; Inspiration: new + old entry; Combat: `notification` upsert | row + line; Inspiration: both entries per entry rule; Combat: card to its audience only |
| `CampaignFeatureSet` (CAMP) | `camp.setFeature` | `{feature, on}` | `campaign` upsert | then a fresh snapshot (FR-CAMP-40) |

- No REST, no signal, no listener writes state. Hooks: none new.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Switch gems on / off | ✓ | ✗ | role |
| Award / remove | ✓ | ✗ | role |
| Spend | ✓ any character *(OQ-GEM-14)* | ✓ own character | `ownerPlayerId` |
| Reroll an entry | ✓ any eligible | ✓ own character's eligible | FR-GEM-18 |
| Combat gem on a card | ✓ PC cards | ✓ own PC's card | FR-GEM-25 |
| Read counts | all | all (OQ-GEM-01 A) | visibility fn + feature tag |
| Undo a spend | ✗ | ✗ | no command (OQ-GEM-09) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** Spend controls disabled (not `live`); an in-flight spend is rejected `disconnected`, never resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)); the reconnect snapshot shows the result if it committed (count, lines, card).
- **DM disconnect / reconnect:** same; the popup re-reads the card from the snapshot (maxed dice included).
- **Server crash mid-spend:** count, line(s), new roll rows, card update and event-log row commit together or not at all (one transaction). Hard kill before commit → nothing spent; after → everything. Test with `PP_TEST_CRASH=gem.spend:before-commit` / `:after-commit`.
- **Switch flipped mid-session:** clients resync; a player with the die picker open loses it (UI gone with the feature) and a spend sent after the commit → `forbidden`.
- **Concurrent edits:** FR-GEM-37, -38. DM awards while the player spends → serial; both see the final count.
- **Reload:** counts, superseded lines and maxed dice come from the snapshot; pickers and confirms reset.
- **Old entries:** an entry below the window floor is never eligible; its `supersededBy` upsert (if any) still reaches clients live (FR-DICE-21 window rule).
- **Invalid / malicious input:** another player's character → `forbidden`; unknown gem / bad `use` / > 3 dice / a die index out of range / `known` mismatch → `invalid`; a hidden entry id a player can't see → `not_found` (never "exists but hidden").

## 12. Performance & bandwidth

Measured 2026-10-20 (throwaway probe on `src/server/ws/testing/snapshot-size.ts`: `session-sim` + `buildRealisticHeavy`, 6 players, 8 characters, 100 log entries, 20 pending cards; deleted before commit). Baseline: DM 690,561 B, players 285,595–288,895 B; cumulative worst from `snapshot-size.test.ts` today: **DM 935,356 B**, players ≤ **293,293 B**.

| What | DM | Each player |
|---|---|---|
| Feature off (never on) | **0 B** | **0 B** |
| Switch on (`features: ["gems"]` on the campaign row) | +20 B | +20 B |
| `character-gems`, 8 rows, counts 5 / worst 99 | +2,155 / +2,195 B | A (all): +2,195 B; B (own only): +291–563 B |
| 33 superseded entries (`supersededBy` set) + 33 `replaces` markers | +2,816 B | +2,816 B |
| `gem.spend` lines (739 B each) replacing average entries (945 / 825 B) | −12,208 B | −7,865 B (smaller than average) |
| `maxed` [3 dice] on every pending card (DM 20, a player 3–4) | +320 B | +48–64 B |
| **Worst, on** (switch + 99s + supersede, spend lines counted as 0) | **+5,351 B → ≈ 940.7 KB** of 1.5 MiB | **+5,095 B → ≈ 298.4 KB** of 512 KiB |

- Per event (JSON frame, one connection): `gem.adjust` 474 B (with the award line 1,126 B); plain spend 1,126 B; Inspiration 2,702 B (row + spend line + old + new entry); Combat 2,399 B to the DM / card owner, ≈ 1,126 B to other players (no card). Human-paced; `camp.setFeature` = one resync per connection (as a scene switch, FR-SYNC-11).
- No new perf gate; no bench.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:` + seeded `ctx.dice`.

**Fixtures** (setups run as DM; dice seeded per fixture key)

| Key | Kind | Requires | Contents |
|---|---|---|---|
| `gems-on` | setup | `campaign` | `camp.setFeature {gems, on: true}` |
| `gems-awarded` | setup | `gems-on`, `char-mira`, `char-thorn`, `char-brakka` | Mira: Inspiration 2, Combat 1, Fortune 1. Brakka: Combat 2, Action 3, Divine 1, Fortune 6 (over 5). Thorn: Inspiration 1 |
| `gems-rolls` | setup | `gems-awarded`, `dice-settings` | As player-1: Mira Perception `1d20+3` (e-perc), Mira Stealth `2d20kh1+5` adv (e-adv); as DM: Mira Insight `1d20+1` hidden (`public: false`, label "DM-SECRET-GEM"); Mira initiative entry (ineligible) |
| `gems-hidden` | setup | `gems-awarded` | `camp.setFeature {gems, on: false}` (counts kept, hidden) |

- **Every existing bundle stays gems-off** (no unit in them sets the switch); test `FR-GEM-01 bundles off` loads each registered bundle and asserts `features` empty.
- **Bundle `gems`** = `session-sim-10` + `gems-on` + `gems-awarded` + `gems-rolls` (Mira and Brakka both `player-1`; Thorn `player-2`; `late-hit-ruled` gives a ruled card waiting for damage). **`gems-hidden`** = `gems` + `gems-hidden`. E2E alias **`gems-e2e`** (= `gems`, its own temp dir). `session-sim-11` adds no gem unit: gems start off there and the DM turns them on live.

| Level | What | Fixtures |
|---|---|---|
| Unit | Eligibility (`FR-GEM-18 eligible`: own d20 `roll` entry ✓; initiative ✗; superseded ✗; undone ✗; below window ✗; another character ✗; ruled card ✗); level limit (`FR-GEM-26 levels`: level 5 → 1, 6 → 2, 11 → 2, 12 → 3; 4 dice → invalid); die picks (`FR-GEM-27 dice`: base + extra + crit ✓, mods ✗, triggers ✗, already max ✗); Action cost (`FR-GEM-16 action costs 2`); line formatters + kind contract (`gem.award`, `gem.spend`: no `dmPayload`); `FR-GEM-08 over five` hint | in-code |
| Integration | `FR-GEM-02 off: no gem bytes` (default-off campaign: every snapshot (DM, P1, P2), every frame of a session-sim run, `sync.load` acks: no `character-gems`, no `gem.` kind, no `features` key); `FR-GEM-03 off refuses` (each `gem.*` → `forbidden`, state digest unchanged); `FR-GEM-04 kept hidden` (on → award → off: rows in DB, absent from snapshots; on → back, same counts; every connection resynced); `FR-GEM-07 adjust` (± bounds, 0–99, not_found, player → forbidden); `FR-GEM-10 visibility` (DM, owner, other player per OQ-GEM-01); `FR-GEM-12 spend each kind` (Fortune, Divine, Action bonus / reaction / full (2), no gem → conflict, another's character → forbidden, DM on behalf ✓); `FR-GEM-19 reroll supersedes` (e-perc: new roll `replacesRollId`, only the d20 changed, constant same; new entry `replaces`, old `supersededBy`; spend line before the new line; struck through on both clients); `FR-GEM-19 adv` (both d20s rerolled); `FR-GEM-24 audience` (DM-SECRET-GEM reroll stays hidden; never in P1 / P2 frames); `FR-GEM-22 card follows to-hit` (pending card's `toHit` replaced; miss → natural 20 with damage attached → damage in `unusedRolls`, card waits; ruled card → conflict); `FR-GEM-23 final value` (stats helper sees one roll, the new one); `FR-GEM-25 combat on pending card` (Brakka Flame Tongue: base d6 → 6, total recomputed from the new roll row, `maxed` set; second gem → conflict); `FR-GEM-25 late damage` (`late-hit-ruled`: after `cbt.applyHit`, `cbt.rollDamage`, gem → damage step total updated; Apply applies the maxed total); `FR-GEM-29 apply hit order` (gem before / after Apply hit both valid); `FR-GEM-38 stale apply` (Apply with the old `damageRollId` → conflict, nothing written); `FR-GEM-28 physical` (manual total-only → `known` required, sum mismatch → invalid); `FR-GEM-31 undo keeps maxed`; `FR-GEM-37 races`; **leak scan per player** (P1, P2: snapshot, every frame, a fresh connection, a `resync`; off: no `gem` key / kind / `"character-gems"`; on: no "DM-SECRET-GEM", no other player's card); **crash** (`PP_TEST_CRASH=gem.spend:before-commit` → count and log unchanged; `:after-commit` → all written; `state:digest` equal after restart); reconnect mid-spend (`disconnected`, not resent) | `gems`, `gems-hidden`, `late-damage` |
| E2E (thin) | `gems-e2e`: DM + `player-1`: P1 spends Fortune → line on both; P1 rerolls e-perc → old struck, new shown; DM turns gems off → P1's block and lines gone without reload | `gems-e2e` |

**Browser walkthrough** — `bun run build`; `fixtures:reset-load session-sim-10 --profile verify` (gems off); `start --profile verify`; `PP_TEST_MODE=1` for "drop connection". Contexts **A** DM, **B** `player-1` (Mira, Brakka), **C** `player-2` (Thorn). Evidence per AGENTS §9.6. Teardown: stop, `fixtures:reset --profile verify`.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Open Mira's sheet, the Game log, a damage card | B, C: own sheets, log | **Gems off: nothing anywhere** — no gem block, chips, log actions, card button; frames / snapshot without `character-gems`, `gem.` or `features` |
| 2 | Campaign options → Gems on | — | A, B, C: resync; empty gem blocks (0s) appear on PC sheets |
| 3 | Mira: + Inspiration ×2, + Combat; Brakka: + Action ×3, + Fortune ×6 | — | Counts on all three clients ≤ 1 s; award lines public; Brakka Fortune "6" amber + Tooltip |
| 4 | — | B: Mira Perception `1d20+3` from the sheet, then "Inspiration" on that line, confirm | Spend line, then the new roll line; old line struck through + "rerolled" on A, B, C; Mira Inspiration 1 |
| 5 | Start "Ambush at the Ford" | B: Brakka **Attack + damage** (Flame Tongue) | Card pending; A's popup; B's card toast shows "Combat gem" |
| 6 | — | B: Combat gem → picks one d6 → submit | Card total up by (6 − old); A's popup updates untouched fields, "rolled N"; spend line on A, B, C; C never gets the card |
| 7 | Apply on Goblin | — | HP drops by the maxed total; outcome line; Combat chip gone (gem used) |
| 8 | Next attack: Mira **Attack** only; A: Apply hit | B: Mira **Damage** (late) → Combat gem in the damage step | Damage step total updates; A applies it |
| 9 | — | B: Brakka Fortune; Action → "Action (2)" | Two lines; Action 3 → 1 |
| 10 | — | C: Thorn's sheet; Mira's summary card | C sees counts only (OQ-GEM-01 A); no Spend controls on Mira; no Inspiration action on Mira's lines |
| 11 | Hard-kill + restart | — | All rejoin; counts, lines, struck lines, maxed dice unchanged |
| 12 | Campaign options → Gems off, confirm | — | A, B, C: blocks, lines, actions gone without reload; the rerolled roll line stays (no gem named); leak scan of B, C frames clean; on again → counts as before |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [campaign-management](campaign-management.md) | Feature registry, `features`, `camp.setFeature`, resync, Campaign options (FR-CAMP-38–45) | revised with this spec |
| [dice-roll-log](dice-roll-log.md) | `dice.reroll`, `gameLog.supersede`, `replaces`, struck line, entry-action registry, stats contract (FR-DICE-62–71) | revised with this spec |
| [combat-tracker](combat-tracker.md) | To-hit follow, crit flip, `cards.maxDice`, stale Apply wording, popup + card UI (FR-CBT-126–135) | revised with this spec |
| [character-sheet-full](character-sheet-full.md) | Gem block section, summary counts (FR-CHARX-71–80) | revised with this spec |
| [live-sync](live-sync.md) / protocol | Viewer `features`; feature tag on record types and log kinds (hub filter) | **needs** OQ-GEM-17 (proposed ADR) |
| [stats](post-mvp/stats.md) (track ST) | Reads the final roll and applied damage (FR-GEM-23) | settled (seams S2) |
| [play-shell](play-shell.md) | Nothing: no window, no Preferences section (FR-SHELL-75: campaign rules aren't preferences) | — |
| [notifications](notifications.md), [dice-extras](dice-extras.md), [effect-modifiers](effect-modifiers.md) | Nothing new: `updateNotification` exists (ADR-0037); a new entry throws, a superseded upsert doesn't (DICEX §11); mods are copied on a reroll, never re-run | — |
| Dependency (package) | **None.** lucide (already in) for icons | — |

### Build split (AGENTS §9.9 shared files per slice)

| Slice | Branch | What | Shared files | After |
|---|---|---|---|---|
| **GM0** core | `fix/gems-core` | Feature registry + `features` column + `camp.setFeature` + resync; viewer `features` + hub feature filter; `character_gems` table + record type; `gem.adjust`; plain `gem.spend` (Fortune / Divine / Action); kinds `gem.award`, `gem.spend`; events; fixtures `gems-on`, `gems-awarded`, `gems-hidden`, bundles `gems`, `gems-hidden` (+ `gems-rolls` stub) | **schema lane 1st**: `src/server/db/schema.ts`; `src/shared/events/`; `src/server/ws/` (viewer, filter); record-type registry; `src/server/features/index.ts` (append `gems`); `src/shared/dice-roll-log/kinds.ts` (append); `src/shared/campaign-management/features.ts` (new registry); `fixtures/bundles/index.ts` (append); `docs/data-model/`, `docs/protocol/` | — (first in the schema lane; ST core / FU column after) |
| **GM1** Inspiration | `build/gems-reroll` | `dice.reroll`, `gameLog.supersede`, `replaces`, struck line, entry-action registry + "Inspiration" action, to-hit follow + crit flip on the card (FR-CBT-126, -127 server) | dice-roll-log server / shared / `GameLog.tsx` (feature-owned; **GameLog holder**); combat-tracker server `cards.ts` (new), `hp.ts`, `hit.ts` + `@shared/combat-tracker/schemas.ts` (`partRollIds`) (one holder with GM2, [CBT §14.4](combat-tracker.md#144-build-split-sprint-7-track-gm)); new registry `src/client/common/features/dice-roll-log/entry-actions.ts` (AGENTS §9.9 list at integration) | GM0. ST's log reads after GM1's `supersede` |
| **GM2** Combat gem | `build/gems-combat` | `cards.maxDice`, stale wording, DM popup chip + die picker, player card button | combat-tracker server (`cards.ts`, `hp.ts`), `@shared/combat-tracker/{schemas.ts, log-kinds.ts}`, DM popup files + the player damage-card view (feature-owned; **popup holder**); new append-only `src/client/common/features/combat-tracker/card-actions.ts` (AGENTS §9.9 at integration) | GM1 **and ST core** merged (apply-path holder, seams S3: GM1 ∥ ST core, GM1 merges first, ST core rebases, then GM2). FU needs no turn. GM2 never edits DM `initiative-window.tsx` (if it must: rebase after FU's combat-rows slice) |
| **GM3** UI | `build/gems-sheet` | Sheet block (`sheet-sections.ts` append), summary counts, Spend menu, DM ± , Players-window counts, Campaign options dialog | `src/client/common/features/character-sheet/sheet-sections.ts` (append); CAMP DM client files (feature-owned) | GM0 |

- **Feature-owned (new) folders:** `src/server/features/gems/`, `src/shared/gems/` (intent zod, kinds `gem.award` / `gem.spend`, eligibility helpers), `src/client/common/features/gems/` (`GemBlock`, icons, the log and card actions), `fixtures/units/gems/`, bundles `gems`, `gems-hidden`, `gems-e2e`.
- **Parallel (seams build plan):** wave 1 GM0; wave 2 GM1 ∥ GM3 (∥ ST core; GM1 merges before ST core); wave 3 GM2 after GM1 + ST core (GM3 may run beside it). One builder for GM1 + GM2 if slots are short (both touch `cards.ts`, `hp.ts`, `schemas.ts`).

## 15. Open questions

**Bold** option = suggested pick (not decided). Decided before the spec (DM #140, #311, #312): optional per campaign, off by default, off = nothing; five gems; DM awards / removes; max 5 shown, not enforced; spend → log line; Inspiration reroll replaces, old struck through; Combat max dice 1 / 2 / 3 by level, total server-side; built-in icons now, art in the UI sprint.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-GEM-01 | Do other players see a character's gems? | **A. Yes, counts (party flavour; 0 extra B vs B for the DM; +2.2 KB per player)** / B. Owner + DM only (+291–563 B per player; others never know) | no (DM) | CHARX summary card |
| OQ-GEM-02 | Gem spends in the log: always public? | **A. Always public (the table should see it; one rule)** / B. Follow a log category (DM can hide; spends become secret by surprise) | no (DM) | dice-roll-log |
| OQ-GEM-03 | Gem look now (built-in icons decided; which)? | A. One `gem` icon in five colours (closest to #140's looks; needs five new colour tokens before the art sprint, and colour is the only cue) / **B. A distinct lucide icon per gem, one colour (sparkles, coins, swords, eye, zap: shapes carry the meaning, no new token; less "gem-like" until the art)** / C. Letter badges I F C D A (plainest) | no (DM) | — |
| OQ-GEM-04 | Switching gems off: what happens to awarded gems? | **A. Kept and hidden (turning on again restores them; nothing lost by a misclick)** / B. Cleared, with a confirm (clean slate; a misclick costs the table its gems) | no (DM) | CAMP |
| OQ-GEM-05 | Which rolls can Inspiration reroll? (a) kinds, (b) how far back, (c) after the DM ruled | **A. The character's own d20 rolls (checks, saves, attacks, free rolls; not initiative) still in the log window (newest 100); an attack only while its card is pending and not ruled; a second gem may reroll the new roll** / B. Only the character's latest d20 roll (simplest; misses "the one before") / C. Any own d20 roll, even after the DM applied (the DM fixes the outcome by hand; HP isn't recomputed) | no (DM) | DICE, CBT |
| OQ-GEM-06 | Inspiration's "ask the DM to recall something" use | **A. Not in the app: the player spends it as a plain spend ("Mira spends an Inspiration gem — to recall") from the sheet menu** / B. Leave it to table talk + `gem.adjust −1` | no | — |
| OQ-GEM-07 | Combat gem timing | **A. While the card is pending with damage, incl. the damage step after Apply hit (late damage); not after Apply** / B. Before Apply hit only (simpler; late damage can't use it) / C. Also after Apply (the DM Undoes and re-applies) | no (DM) | CBT |
| OQ-GEM-08 | Combat gem: which dice with mixed types / effects | **A. Any weapon die of any part (base, extra type, crit dice); the player picks; not effect bonus dice or trigger parts** / B. Base part only / C. Any die on the card incl. Bless / Hunter's Mark dice (needs mods' per-die values on the card: +bytes, MOD change) | no (DM) | CBT, MOD |
| OQ-GEM-09 | Can the DM undo a spend / an award? | **A. No undo; the DM corrects with + / − (a reroll or maxed die stands, like a real die)** / B. "Undo spend" for the latest plain spend only / C. Full undo incl. un-superseding a reroll (new compensating events, card rewind) | no (DM) | DICE, CBT |
| OQ-GEM-10 | Award / remove in the log? | **A. Awards public ("DM awards Mira an Inspiration gem"), removals silent** / B. Both public / C. Neither (counts only) | no (DM) | DICE |
| OQ-GEM-11 | Max-5 hint | **A. Per gem kind: a count over 5 turns `hp.bloodied` + Tooltip; award still works** / B. Per character total over 5 (if the table rule means 5 gems in all) / C. No hint | no (DM: which "5" does #140 mean?) | CHARX |
| OQ-GEM-12 | Action gem's 2-for-1 | **A. Spend menu: Bonus action (1), Reaction (1), Action (2); the line names it** / B. One "Spend"; the player says what at the table (2 = two spends) | no (DM) | — |
| OQ-GEM-13 | Physical dice vs gems | **A. Reroll follows physical mode (type the new d20); Combat gem on a total-only physical roll asks each die first** / B. Gems need app-rolled dice (physical rolls not eligible) | no (DM) | DICE |
| OQ-GEM-14 | May the DM spend on a player's behalf? | **A. Yes (absent player, table speed); the line says "Mira spends…", roller DM** / B. Owner only | no (DM) | — |
| OQ-GEM-15 | Companions and pets | **A. Not in v1: gems are the character's, its own rolls and attacks only** / B. The owner's companions' rolls / cards too | no (DM) | CBT |
| OQ-GEM-16 | **stats (ST):** what counts after a reroll / maxed die | **Resolved (integrator, seams S2): A.** Final roll only (superseded and undone entries skipped; nat 20 / 1 on the final roll; a reroll is no extra roll); a maxed die only through the applied damage (`hp_change`); **no "gems spent" award**. Rejected: ~~B. Count both rolls~~ | — · resolved | [stats](post-mvp/stats.md) |
| OQ-GEM-17 | **live-sync / protocol:** viewer `features` and the feature tag on record types / log kinds | **A. As the [proposed ADR](../architecture/adr/proposed-s7-gm-feature-switches.md): GM0 changes `src/server/ws/` (shared, orchestrator-routed); live-sync gains one FR at integration** / B. Each feature filters in its own visibility fn (needs the campaign row: breaks ADR-0021 B) | no (seams; owner: orchestrator) | [live-sync](live-sync.md) |
| OQ-GEM-18 | Glossary: add **feature switch**, **reroll**, **superseded entry**, **maxed die**; amend **gem** (optional per campaign) | **A. Add as worded in §1 / §8** | no (owner: integrator) | glossary |
| OQ-GEM-19 | **FU:** popup holder order with the End dialog / concentration slice | **Resolved (integrator, seams S3):** FU's End dialog / concentration files aren't apply-popup / card files, so FU takes no turn; the apply path goes GM1 ∥ ST core (GM1 merges first) → GM2. Rejected: ~~GM0 → FU → GM2~~, ~~GM2 before FU~~ | — · resolved | CBT, ST |

## 16. Out of scope

- Gem art and DM-supplied images (BL-29, UI sprint). Fortune's d100 tables; tracking actions per turn; gem trading between characters; gems for monsters / companions (OQ-GEM-15).
- Stats over gems: no "gems spent" award (seams S2; tier B at best). Other optional features reusing the switch (the ADR allows them; none this sprint).
