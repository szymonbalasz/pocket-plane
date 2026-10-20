---
title: Gems (homebrew)
prefix: GEM
status: complete
owner: spec-gems
phase: post-mvp-7
---

# Gems (homebrew)

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Sprint 7, track GM ([sprint-7](../agents/sprint-7.md)); seams and review-a rulings applied.

## 1. Summary

- The DM's homebrew reward rule ([#140](../decisions-log.md)): the DM **awards / removes** gems per character; the player **spends** one and the log says so. Gems: **Inspiration**, **Fortune**, **Combat**, **Divine Knowledge**, **Action**.
- **Optional, off by default** ([#312](../decisions-log.md)): a per-campaign switch; while off nothing of gems reaches anyone. Generic **feature switch**: [proposed ADR](../architecture/adr/proposed-s7-gm-feature-switches.md), [campaign-management](campaign-management.md) FR-CAMP-38–45.
- **Inspiration** rerolls a d20 roll from the log, the old line struck through ([dice-roll-log](dice-roll-log.md) FR-DICE-62–71). **Combat** maxes 1 damage die (2 at level 6, 3 at level 12) on a pending card, also after Apply hit; the server recomputes the total ([combat-tracker](combat-tracker.md) FR-CBT-126–135). Fortune, Divine Knowledge, Action: spend + line.
- Counts on the sheet ([character-sheet-full](character-sheet-full.md) FR-CHARX-71–76); built-in icons now, art later (BL-29).

## 2. Scope

- Switch; counts; award / remove; spend (owner, or the DM for them); one line per spend; Inspiration reroll; Combat max dice; sheet block, summary counts, Players-window counts, Campaign options.

## 3. Goals

- The DM runs the gem rule without paper. Rerolls and maxed dice are server-made, reach exactly the right people, survive reload and crash. A campaign that never turns gems on carries **0 B** of gem data.

## 4. Non-goals

- Enforcing max 5; automating Fortune, Divine Knowledge or the action economy ([ADR-0014](../architecture/adr/0014-mvp-scope.md)); gem art; monster / companion gems (OQ-GEM-15); undo (OQ-GEM-09); rule-driven rerolls (OQ-GEM-20).

## 5. User stories

- **DM:** gems on for this campaign only; award in two clicks; see each spend and maxed die before I apply.
- **Player:** see my gems; reroll a bad d20 from its line; max a die on my pending card without the DM doing maths.

## 6. Functional requirements

### Switch (feature `gems`)

| ID | Requirement |
|---|---|
| FR-GEM-01 | Feature key `gems` (FR-CAMP-41); **off by default** for every campaign; the DM switches it per campaign (FR-CAMP-39). |
| FR-GEM-02 | **Off = nothing:** no `character-gems` row or `gem.*` entry in any snapshot, frame, `sync.load` ack or stats read (DM included); no `features` key (FR-CAMP-38); no gem UI. Server-side, by feature tags (ADR). |
| FR-GEM-03 | Every `gem.*` intent while off → `forbidden` "Gems are off in this campaign"; nothing written. |
| FR-GEM-04 | **Off keeps counts, hidden** *(OQ-GEM-04)*; on again shows them. All connections resync (FR-CAMP-40); client-only UI state survives. |
| FR-GEM-05 | **Gem traces while off** *(OQ-GEM-21 B, #315)*: entries superseded by a reroll are hidden; `replaces`, `maxed`, `diceMaxed` are stripped; only final rolls show; on again restores them. Declared as feature traces (ADR). |

### Counts

| ID | Requirement |
|---|---|
| FR-GEM-06 | Record type **`character-gems`**: one row per character (`id` = entity id), counts `inspiration`, `fortune`, `combat`, `divine`, `action` 0–99; created on first award. Not on `entity` (ADR-0036). |
| FR-GEM-07 | `gem.adjust {characterId, gem, delta}` (DM): `delta` −5…+5, ≠ 0; result 0–99 else `invalid`; unknown character → `not_found`. Count + line + `GemsAdjusted`, one transaction. |
| FR-GEM-08 | **Max 5 is a label** *(OQ-GEM-11 D, #315)*: the gem block shows a static "max 5" label (Tooltip "A table rule, not enforced"); counts above 5 are allowed and shown plainly: no over-limit colour, hint or warning anywhere. |
| FR-GEM-09 | **Award lines** *(OQ-GEM-10)*: public `gem.award` "DM awards Mira an Inspiration gem (2 held)"; removals write none. |
| FR-GEM-10 | **Visibility** *(OQ-GEM-01)*: DM full; players full (counts only). Off → hidden. |
| FR-GEM-11 | **Owner check** (OQ-GEM-01 A, #315): no owner copy on the row; `gem.spend` checks the entity's `ownerPlayerId`. |

### Spend

| ID | Requirement |
|---|---|
| FR-GEM-12 | `gem.spend {characterId, gem, …}`: player own character (else `forbidden`), DM any *(OQ-GEM-14)*. Too few → `conflict` "No Fortune gem left". Count − cost + `gem.spend` line + `GemSpent`, one transaction. |
| FR-GEM-13 | **Lines public** *(OQ-GEM-02)* whoever sends; roller = sender. **Target detail** (label, totals, dice) takes the target's audience: public target → `payload`; DM-only target (hidden roll, DM-made card) → `dmPayload`, public text only "**Mira** spends an Inspiration gem". Hidden targets stay eligible. |
| FR-GEM-14 | **Fortune**: "Mira spends a Fortune gem — searching for treasure"; the DM rolls the d100. |
| FR-GEM-15 | **Divine Knowledge**: "… — asks the gods a question". |
| FR-GEM-16 | **Action** `use: bonus \| reaction \| action` *(OQ-GEM-12)*: cost 1, 1, **2**; "Brakka spends 2 Action gems — a full action". |
| FR-GEM-17 | Client confirms once ("Spend? ✓ ✗", 4 s). No undo *(OQ-GEM-09)*: the DM corrects with `gem.adjust`. |

### Inspiration

| ID | Requirement |
|---|---|
| FR-GEM-18 | `{gem: "inspiration", entryId, manual?}`. **Eligible** *(OQ-GEM-05)*: `rerollableRoll(entry)` (FR-DICE-70); actor = the character; in the newest-100 window; written by an **allowlisted** command (sheet checks, saves, skills, to-hits; free `dice.roll`; combat to-hits); **not** initiative, death saves, concentration saves or roll-request DCs *(OQ-GEM-20 A)*; an attack only while its card is pending and unruled. Else `conflict` with the reason. |
| FR-GEM-19 | `dice.reroll` (FR-DICE-62): new roll row (`replacesRollId`), only d20 dice new; roll hooks **not** re-run (a `natural` rule trigger doesn't fire); new entry; old entry superseded (FR-DICE-63). Spend line ("… rerolls Perception (4)"), then the new roll line. |
| FR-GEM-20 | The old roll never comes back (#140); the new entry may take a second gem. |
| FR-GEM-21 | **Physical** *(OQ-GEM-13)*: physical mode asks for the new d20 (adv / dis: both) or "Roll for me". |
| FR-GEM-22 | **To-hit:** the pending card follows (FR-CBT-126); a crit flip sends attached damage to "not used", the card waits (FR-CBT-127, OQ-CBT-85). |
| FR-GEM-23 | **Stats** (S2): the final roll counts (FR-DICE-67), incl. nat 20 / 1; a maxed die only via applied damage; no "gems spent" stat ([stats](stats.md)). |
| FR-GEM-24 | The new entry copies the old one's `public` / `audiencePlayerId` (FR-DICE-62). |

### Combat

| ID | Requirement |
|---|---|
| FR-GEM-25 | `{gem: "combat", cardId, dice: [{part, index}] 1–3, known?}`. **Eligible** *(OQ-GEM-07)*: card pending with damage (incl. the damage step after Apply hit); attacker = the character's combatant (OQ-GEM-15); `diceMaxed` unset. Else `conflict`. |
| FR-GEM-26 | **Level limit** (at spend): 1 die at 1–5, 2 at 6–11, 3 at 12+; more → `invalid` "Level 6 needed for 2 dice". |
| FR-GEM-27 | **Dice** *(OQ-GEM-08)*: kept dice of the base or a weapon extra part, crit dice included; never `mods` / `triggers`; already max → `invalid`. |
| FR-GEM-28 | **Physical totals** *(OQ-GEM-13)*: a part without per-die values needs `known` (sum = stored total). |
| FR-GEM-29 | `cards.maxDice` (FR-CBT-128): new roll rows, totals, `maxed`, `diceMaxed`; popup refresh (FR-CBT-132). |
| FR-GEM-30 | Line: "Mira spends a Combat gem — Light crossbow: d8 3 → 8 (rolled 7 → 12)"; parts named by type when > 1; "rolled" because the DM may apply a typed value. |
| FR-GEM-31 | Apply uses maxed totals; Undo keeps `maxed`; End / Dismiss leave the gem spent. A crit flip clears `diceMaxed` with the moved damage: a new Combat gem may go on the new damage; the first stays spent (DM may `+1`). |

### UI

| ID | Requirement |
|---|---|
| FR-GEM-32 | **Sheet block** (FR-CHARX-71, -72): five icon + count chips; owner Spend menu (Fortune, Divine Knowledge, Action, Inspiration "to recall" per OQ-GEM-06); DM ±. |
| FR-GEM-33 | **Log action** (FR-DICE-68): "Inspiration" on an eligible line, for the owner and the DM, while ≥ 1 held. |
| FR-GEM-34 | **Card action** (FR-CBT-130): "Combat gem" on the owner's pending card and in the DM's popup while eligible; a die picker up to the level limit. |
| FR-GEM-35 | **Look** *(OQ-GEM-03)*: lucide `sparkles`, `coins`, `swords`, `eye`, `zap` in `text.primary`; name in Tooltip and `aria-label`. |
| FR-GEM-36 | **Campaign options** (FR-CAMP-42): "Gems (homebrew)" Switch; off asks once ("Hide gems? Counts are kept"). |

### Edge rules

| ID | Requirement |
|---|---|
| FR-GEM-37 | Spends serialise: a second Inspiration per entry or Combat per card → `conflict`; spend vs switch-off → first commit wins. |
| FR-GEM-38 | Apply carries every part's roll id (`partRollIds`, required, FR-CBT-129): after a reroll or max → `conflict` "The card changed — check and Apply again". |
| FR-GEM-39 | An owner change keeps the gems; no delete exists (FR-ENT-14). |
| FR-GEM-40 | Rows and switch are per campaign; never in another campaign's snapshot (ADR-0020). |

## 7. UI/UX notes

[visual-direction](../design/visual-direction.md), shadcn, existing tokens; layouts in CHARX, DICE, CBT, CAMP §7.

- **DM view:** options dialog; block with ± on PC sheets; Players-window counts; log and popup actions. **Player view:** own block + Spend; others' summary-card counts; Inspiration on own lines; Combat gem on own card.
- **States:** off → nothing rendered or stored; disconnected → controls disabled; reject → inline / Toast.
- **Test IDs:** `gem-block`, `gem-count` (+ `data-value`, `data-count`), `gem-max-label`, `gem-award`, `gem-remove`, `gem-spend-menu`, `gem-spend` (+ `data-value`), `gem-spend-confirm`, `gem-reroll`, `gem-combat`, `gem-combat-die` (+ `data-part`, `data-index`, `data-state`), `gem-combat-submit`, `gem-error`, `gem-summary-count`; records via `data-record-id`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| `character-gems` | id (= characterId), campaignId, characterId | ID | One per character |
| | inspiration … action | int 0–99 ×5 | |
| | updatedAt | timestamp | `ctx.clock` |
| `gem.spend` payload | `{characterId, gem, count, use?, target? {kind, id, label, from, to}, dice? ≤ 3}` | JSON leaf | `target` / `dice` in `dmPayload` for a DM-only target |
| `gem.award` payload | `{characterId, gem, count, held}` | JSON leaf | |

- Elsewhere: `campaign.features` (CAMP §8); `supersededBy`, `replacesRollId`, `replaces` (DICE §8); `maxed`, `diceMaxed` (CBT §8). Confirm and picker state: client memory.

## 9. API & events

| Intent | Who | Result |
|---|---|---|
| `gem.adjust {characterId, gem, delta}` | DM | `{held}` |
| `gem.spend {characterId, gem, use?, entryId?, manual?, cardId?, dice?, known?}` | DM, player (own) | `{held, entryId, rerollEntryId?}` |

| Record / kind | Visibility |
|---|---|
| `character-gems` (tag `gems`) | Off: hidden. On: DM and every player full (counts only) |
| `gem.award`, `gem.spend` (tag `gems`) | Off: hidden. On: public; detail in `dmPayload` for a DM-only target |
| Traces on `roll` entries, damage cards | Off: superseded hidden, `replaces` / `maxed` / `diceMaxed` stripped (OQ-GEM-21 B) |

| Event (logged, not undoable) | Changes | Player sees |
|---|---|---|
| `GemsAdjusted {characterId, gem, delta, held, entryId?}` | row, award line | both |
| `GemSpent {characterId, gem, cost, held, entryId, rerollEntryId?, supersededEntryId?, cardId?, rollIds}` | row, line; old + new entry; card | per each record's rule |

## 10. Permissions

| Action | DM | Player | Check |
|---|---|---|---|
| Switch, award / remove | ✓ | ✗ | role |
| Spend, reroll, Combat gem | ✓ any PC | ✓ own PC | entity owner |
| Read counts | ✓ | ✓ | visibility + tag |

## 11. Edge cases & failure modes

- **Disconnect / reconnect:** controls disabled; an in-flight spend → `disconnected`, never resent; the snapshot shows it if committed.
- **Crash:** everything commits in one transaction (`PP_TEST_CRASH=gem.spend:before-commit` / `:after-commit`).
- **Switch mid-session:** resync; client-only UI state kept; gem UI goes; a later spend → `forbidden`.
- **Invalid:** another's character → `forbidden`; bad fields → `invalid`; an entry a player can't see → `not_found`.

## 12. Performance & bandwidth

Measured 2026-10-20 (throwaway probe, `session-sim` + `buildRealisticHeavy`; deleted). Off **0 B**. On, worst (switch, 8 rows at 99, 33 + 33 supersede markers, `maxed` on every card): **DM +5,351 B → ≈ 940.7 KB** of 1.5 MiB; **players +5,095 B → ≈ 298.4 KB** of 512 KiB. Frames 0.5–2.7 KB per spend. Breakdown: CAMP, DICE, CBT §12.

## 13. Test plan

Per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md) / [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `:memory:` + seeded dice.

| Fixture | Contents |
|---|---|
| `gems-on` | `camp.setFeature {gems, on}` |
| `gems-awarded` | Mira: Inspiration 2, Combat 1, Fortune 1. Brakka: Combat 2, Action 3, Divine 1, Fortune 6. Thorn: Inspiration 1 |
| `gems-rolls` | player-1: Mira Perception (e-perc), adv Stealth (e-adv); DM: hidden Mira Insight "DM-SECRET-GEM"; Mira initiative + death save (ineligible) |
| `gems-hidden` | gems off again |

- Bundles **`gems`** = `session-sim-10` + the first three; **`gems-hidden`**; e2e alias **`gems-e2e`**. Existing bundles stay off; `session-sim-11` adds none.

| Level | Named tests |
|---|---|
| Unit | `FR-GEM-18 eligible` (initiative, death / concentration saves ✗), `FR-GEM-26 levels`, `FR-GEM-27 dice`, `FR-GEM-16 action costs 2`, `FR-GEM-08 max 5 label shown, no over-limit styling at 6`, `FR-GEM-30 line wording`, `FR-GEM-13 detail by audience`, kind contract |
| Integration | `FR-GEM-01 bundles off`, `-02 off: no gem bytes`, `-03 off refuses`, `-04 kept hidden`, `-05 off hides gem traces`, `-07 adjust`, `-09 award public, removal silent`, `-10 visibility`, `-11 owner check`, `-12 spend each kind`, `-13 public whoever sends`, `-13 hidden target leak scan` (DM-SECRET-GEM), `-19 reroll supersedes`, `-19 adv`, `-19 no hook re-run`, `-20 second gem`, `-21 physical reroll`, `-22 card follows to-hit`, `-23 final value`, `-24 audience`, `-25 combat on pending card`, `-25 late damage`, `-28 physical`, `-29 apply hit order`, `-31 undo keeps maxed`, `-31 crit flip clears diceMaxed`, `-37 races`, `-38 stale apply`, `-39 owner change`, `-40 campaign isolation`; leak scan per player (snapshot, frames, fresh connection, resync; off and on); crash + `state:digest`; reconnect mid-spend |
| DOM | `FR-GEM-33 log action available`, `FR-GEM-34 card action available`, `FR-GEM-04 resync keeps UI state` |
| E2E | `gems-e2e`: P1 spends Fortune, rerolls e-perc; DM off → all gem traces gone without reload |

**Walkthrough** — build; `fixtures:reset-load session-sim-10 --profile verify` (gems off, Goblin Ambush running); `start --profile verify`; `PP_TEST_MODE=1`. **A** DM, **B** `player-1` (Mira, Brakka), **C** `player-2`. Evidence AGENTS §9.6.

| # | Step | Expected |
|---|---|---|
| 1 | A, B, C open sheets, log, a card | Gems off: nothing; no `character-gems`, `gem.`, `features` in frames |
| 2 | A: Campaign options → on | All resync; blocks (0s) |
| 3 | A: Mira + Inspiration ×2, + Combat; Brakka + Combat, + Action ×3, + Fortune ×6 | Counts ≤ 1 s; award lines; Fortune 6 shown plainly beside the "max 5" label |
| 4 | B: Mira Perception → Inspiration on its line | Spend + new line; old struck, "rerolled" |
| 5 | B: Brakka Attack + damage (Flame Tongue) → Combat gem, one d6 | Total up; A's popup refreshes; C never gets the card |
| 6 | A: Apply | HP drops by the maxed total |
| 7 | B: Mira Attack; A: Apply hit; B: Damage → Combat gem in the damage step | Step updates; A applies |
| 8 | A: hidden Mira Insight → Inspiration | C sees "Mira spends an Inspiration gem" only |
| 9 | B: Brakka Fortune; Action (2) | Two lines; Action 3 → 1 |
| 10 | C: Mira's summary card, Mira's lines | Counts only; no controls |
| 11 | Hard-kill + restart | Everything unchanged |
| 12 | A: gems off | Blocks, gem lines, struck lines, max badges gone; final rolls stay; on → back |

## 14. Dependencies

| On | Need | Status |
|---|---|---|
| CAMP, DICE, CBT, CHARX | FR ranges in §1 | revised with this spec |
| [live-sync](live-sync.md) / protocol | Viewer `features`, tag + trace rule (OQ-GEM-17) | proposed ADR |
| [stats](stats.md) | Reads per FR-GEM-23 | settled (S2) |
| Package | **None** | — |

| Slice | Branch | What | Shared files | After |
|---|---|---|---|---|
| **GM0** | `fix/gems-core` | Switch, viewer features, tag + trace rule, table, `gem.adjust`, plain spends, kinds, events, fixtures | **schema lane 1st**, `src/server/ws/` (S4), `src/shared/events/`, record-type registry; append `features/index.ts`, `kinds.ts`, `bundles/index.ts`; new `features.ts` | — |
| **GM1** | `build/gems-reroll` | Reroll, struck line, entry actions, to-hit follow, crit flip | DICE §14, CBT §14.4 | GM0; ∥ ST core, merges first |
| **GM2** | `build/gems-combat` | Max dice, `partRollIds`, markers, card actions | CBT §14.4 | GM1 + ST core (S3) |
| **GM3** | `build/gems-sheet` | Sheet, summary, ±, options dialog | `sheet-sections.ts` (append); CHARX, CAMP §14 | GM0 |

- New folders `src/{server/features,shared,client/common/features}/gems/`, `fixtures/units/gems/`.

## 15. Open questions

Decided before the spec (#140, #311, #312): optional, off by default, off = nothing; five gems; max 5 not enforced; reroll replaces, old struck; Combat 1 / 2 / 3 by level; built-in icons now. **Every row below decided at DM gate 1 (#315)** as picked, except OQ-GEM-11 (DM's D); options kept for the record.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-GEM-01 | Others see a character's gems? | **Decided (#315): A.** **A. Counts (party flavour; +2.2 KB per player)** / B. Owner + DM (secret; needs an owner hook) | — · decided | CHARX |
| OQ-GEM-02 | Spend lines always public? | **Decided (#315): A.** **A. Yes (hidden targets show no detail)** / B. Per log category (spends go secret by surprise) | — · decided | DICE |
| OQ-GEM-03 | Built-in look | **Decided (#315): B.** A. One gem in five colours (5 new tokens; colour-only cue) / **B. A lucide icon per gem (shapes carry meaning)** / C. Letters | — · decided | — |
| OQ-GEM-04 | Off: awarded gems? | **Decided (#315): A.** **A. Kept, hidden (misclick-safe)** / B. Cleared after confirm (clean slate) | — · decided | CAMP |
| OQ-GEM-05 | Which rolls Inspiration rerolls | **Decided (#315): A.** **A. Own d20 rolls in the newest 100, no initiative, attacks while pending and unruled; rerolls may chain** / B. Latest roll only (simplest) / C. Any, even after Apply (DM fixes outcomes) | — · decided | DICE, CBT |
| OQ-GEM-06 | Inspiration "help me recall" | **Decided (#315): A.** **A. Plain spend "— to recall"** / B. Table talk + `−1` | — · decided | — |
| OQ-GEM-07 | Combat timing | **Decided (#315): A.** **A. Pending with damage, incl. after Apply hit** / B. Before Apply hit only (no late damage) / C. Also after Apply (Undo + re-apply) | — · decided | CBT |
| OQ-GEM-08 | Which dice | **Decided (#315): A.** **A. Weapon dice of any part, crits too; no effect / trigger dice** / B. Base part only / C. Any incl. Bless (bytes + MOD change) | — · decided | CBT, MOD |
| OQ-GEM-09 | Undo spend / award | **Decided (#315): A.** **A. None; ± corrects (dice stand)** / B. Latest plain spend / C. Full (compensating events, card rewind) | — · decided | DICE, CBT |
| OQ-GEM-10 | Award / remove lines | **Decided (#315): A.** **A. Awards public, removals silent** / B. Both / C. Neither | — · decided | DICE |
| OQ-GEM-11 | Max-5 hint | **Decided (#315): D (DM): "The max 5 is not enforced, just a label is fine"**: a static "max 5" label, no over-limit styling (FR-GEM-08). Proposed: ~~A. Per kind over 5~~ / ~~B. Per character total~~ / ~~C. None~~ | — · decided | CHARX, CAMP |
| OQ-GEM-12 | Action 2-for-1 | **Decided (#315): A.** **A. Menu Bonus (1) / Reaction (1) / Action (2)** / B. One Spend, said at the table | — · decided | — |
| OQ-GEM-13 | Physical dice | **Decided (#315): A.** **A. Reroll follows physical mode; Combat asks each die** / B. App dice only | — · decided | DICE |
| OQ-GEM-14 | DM spends for a player? | **Decided (#315): A.** **A. Yes (speed)** / B. Owner only | — · decided | — |
| OQ-GEM-15 | Companions / pets | **Decided (#315): A.** **A. Not in v1** / B. Owner's companions too | — · decided | CBT |
| ~~OQ-GEM-16~~ | ~~Stats~~ | **Resolved (integrator, sprint-7 seams / rulings)** (S2): final roll; max via applied damage; no award | — · resolved | stats |
| OQ-GEM-17 | live-sync: features, tags, traces | **Resolved (integrator, sprint-7 seams / rulings): A** (ADR accepted at #315). **A. Per the ADR; one live-sync FR at integration** / B. Each feature filters itself (breaks ADR-0021 B) | — · resolved | live-sync |
| OQ-GEM-18 | Glossary: **feature switch**, **reroll**, **superseded entry**, **maxed die**; amend **gem** | **Resolved (integrator, sprint-7 seams / rulings): A.** **A. As worded here** | — · resolved | glossary |
| ~~OQ-GEM-19~~ | ~~Popup order~~ | **Resolved (integrator, sprint-7 seams / rulings)** (S3): GM1 ∥ ST core → GM2 | — · resolved | CBT |
| OQ-GEM-20 | Rerolling rule-driven rolls (death / concentration saves, roll-request DCs) | **Decided (#315): A.** **A. Excluded in v1 (table rerolls by hand, DM fixes state)** / B. Death saves follow, concentration excluded / C. Both follow (restoring ended effects: large) | — · decided | CBTX, DICE |
| OQ-GEM-21 | Dice history while off | **Decided (#315): B.** A. Keep struck lines and max badges (simpler; traces stay) / **B. Hide them; only final rolls; on restores (#312 literally; one more hub rule)** | — · decided | DICE, CBT |

## 16. Out of scope

- Gem art; Fortune tables; action tracking; trading; monster / companion gems; a "gems spent" stat; other features on the switch (allowed, none now).
