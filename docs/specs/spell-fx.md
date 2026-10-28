---
title: Spell FX
prefix: VFX
status: in-review
owner: spec-spell-fx
phase: post-mvp
---

# Spell FX

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Raised by the DM (2026-10-28): moving map graphics for the party's favourite spells, a subtle look for every hit by damage type, and a way to switch it all off. Cross-cutting choices: [ADR-0071](../architecture/adr/0071-spell-fx.md) (accepted, #373). Every term in *italics* below is a [glossary](../glossary.md#play) term (OQ-VFX-07 A, added at merge).

## 1. Summary

- A spell row on the sheet can carry a *map effect*. **Cast** starts the spell's effect (concentration or custom) and the map animates it around the caster's token for everyone who can see that token: an *aura*.
- Every damage or healing applied in combat plays a short *hit look* on the target for its damage type, aimed from the attacker.
- Effects are client-drawn from state the server already keeps. The server stores one small field on the existing effect row and sends one unsaved *hit cue* per applied change. Each player can turn them down or off in Preferences.

## 2. Scope

- Two *FX presets*: **Spirit Guardians** (radiant or necrotic) and **Shadow of Moil**.
- A *map effect* (`fx`) on spell rows and on effect rows; **Cast** on a spell row with one; a DM picker on any effect.
- *Hit looks* for the 13 damage types, healing, untyped damage and a *glance* (immune); shrunk when resisted, grown when vulnerable.
- Two strike moments, visual only: a spirit strikes a creature that starts its turn inside Spirit Guardians; shadows lash an attacker who hits the Shadow of Moil caster.
- **Show affected cells** in the caster's token menu, for that viewer only.
- Preferences **Map effects**: Full · Reduced · Still · Off, per browser; Still by default under reduced motion; a tier drops on slow frames. DM Layers popover switch **Effects**.
- Registries so a new preset or hit look is one file and one line.

## 3. Goals

- The cleric casts Spirit Guardians from the sheet in one click and every screen at the table shows it within a second, moving with the token.
- A hit reads at a glance: fire looks like fire, without reading the log.
- Nothing about FX can reveal a hidden token, a fogged creature or a DM-only roll.
- No FX state is lost or duplicated by a reconnect or a server crash; cues never replay.
- A new preset costs one shared catalogue line, one renderer file and one registry line.

## 4. Non-goals

- Rules automation: no saves, damage, slot use or HP change from an FX. Strike and lash flashes are pictures only.
- Vision or light rules (Moil's darkness does not change fog vision; OQ-VFX-02).
- Sound.
- FX outside the map (sheet, Initiative, dice tray).
- WebGL. Canvas 2D on the existing Konva stage only.

## 5. User stories

**DM**
- As the DM, I want Spirit Guardians to show around the cleric and vanish when concentration drops, so that I never forget it is up.
- As the DM, I want to give a monster's effect a map effect (the cultist's Spirit Guardians), so that the players see it too.
- As the DM, I want to see exactly which squares are inside an aura when someone asks, without the shading on all the time.

**Player**
- As the cleric's player, I want to press Cast on my spell row and see the spirits on the map, so that my turn feels like a spell.
- As the warlock's player, I want the shadows to lash out when a goblin hits me, so that I remember the 2d8 necrotic.
- As a player on an old laptop, I want to turn effects down or off for my browser only.

## 6. Functional requirements

### 6.1 Presets and the map effect

| ID | Requirement | Notes |
|---|---|---|
| FR-VFX-01 | **Preset catalogue** (new, append-only, AGENTS §9.9 once integrated): `src/shared/spell-fx/presets.ts`, `FxPreset[]` = `{key, label, names: string[], params: zod schema, radiusFt?(params) → int, reactions?: ("turnInside" \| "hitOnAnchor")[]}`. Keys kebab-case, unique; `names` lower-case spell names, unique across presets (`bun test` checks both). | Shared: server validates, clients draw |
| FR-VFX-02 | Built-in presets: `spirit-guardians` params `{variant: "radiant" \| "necrotic" = "radiant", radiusFt: 5–60 step 5 = 15}`, names `["spirit guardians"]`, reactions `turnInside`; `shadow-of-moil` params `{radiusFt: 5–30 step 5 = 10}`, names `["shadow of moil"]`, reactions `hitOnAnchor`. | §7.1 looks |
| FR-VFX-03 | **Map effect** `Fx = {preset, params, spellId?}`, JSON ≤ 200 B, params parsed by the preset's schema (defaults filled). Unknown preset or bad params → `invalid`. | §8 |
| FR-VFX-04 | **Suggestion**: `suggestPreset(spellName)` (pure, `@shared/spell-fx`) = the preset whose `names` holds the trimmed, lower-cased name, else null. | "Spirit Guardians" picks itself |

### 6.2 Sheet and Cast

| ID | Requirement | Notes |
|---|---|---|
| FR-VFX-05 | Spell rows (CHARX `spells[]`) gain optional `fx: {preset, params}`. The row editor shows **Map effect**: None + every preset by label, then the preset's params (Spirit Guardians: Radiant / Necrotic; radius). New row or name change with no `fx` yet → pre-picked by FR-VFX-04 (still saved only with the row). | Additive; seam OQ-VFX-06 |
| FR-VFX-06 | Spell rows with `fx` show a **Cast** button after the roll buttons, in the view and on Main's Spells box; label **Cast** while no active effect has `fx.spellId` = the row id on that creature, else **End** (sends `cbtx.endEffect`). | Who: OQ-VFX-01 (decided A) |
| FR-VFX-07 | `vfx.cast {creatureId, spellId}` → `{effectId}`: row with `concentration` → the same path and rules as `cbtx.setConcentration` (target = the creature, label = the spell name, replaces a current concentration and ends its linked effects); else a `custom` effect, label = spell name, no duration (ended by hand; OQ-VFX-09). Either way `fx = {…row.fx, spellId}`. One transaction, the effect's own events. Row without `fx` → `conflict` "No map effect on ‹spell›"; an active effect from this row → `conflict` "‹spell› is already active". | Works in and out of combat *(2026-10-28, fix/vfx-core: a monster casts only with exactly one active combatant of it in the started encounter, else `conflict`; the label is the spell name cut to 40, FR-CBTX-04)* |
| FR-VFX-08 | Cast never uses a slot, rolls or changes HP (CHARX keeps slot pips by hand). | §4 |
| FR-VFX-09 | `vfx.setEffectFx {effectId, fx \| null}` sets or clears the map effect on any active effect. DM: any. Player: non-secret effects targeting their own character. Event `EffectFxSet {effectId}`, logged. | Monsters, Bless, by hand |
| FR-VFX-10 | Effect row menus (Initiative effect chip, sheet Active effects) gain **Map effect…** (DM; owner per FR-VFX-09): the FR-VFX-05 picker in a small dialog; Save sends FR-VFX-09. | |

### 6.3 Auras on the map

| ID | Requirement | Notes |
|---|---|---|
| FR-VFX-11 | An **aura** is drawn for each active effect with `fx` the viewer receives, at each token on the viewed scene that is the effect's target: `targetCharacterId` → tokens with that `characterId`; `targetCombatantId` → the combatant's `tokenId`. No such token the viewer has → nothing drawn. | No new record type |
| FR-VFX-12 | The aura follows its token's drawn position, including drag previews (own and others', FR-MAP-39/40), with the preset's own lag. Hidden tokens: DM only, at the DM's hidden-token opacity. | |
| FR-VFX-13 | Each aura has an **under** pass (below tokens) and an **over** pass (above tokens, below labels: FR-MAP-56 still holds). Layer entries `vfx-under` (order 38) and `vfx-over` (order 43), both on the `objects` Konva layer (FR-MAP-29: no new layer). Redraw policy: OQ-VFX-04. | §12 |
| FR-VFX-14 | Randomness in a renderer comes from a PRNG seeded by the effect id (aura) or the cue id (hit); time from one FX clock per client. The **Still** frame of an aura is a pure function of (seed, params, token position): the same pixels on every load. | Screenshot baselines |
| FR-VFX-15 | **Turn reaction** (`turnInside`): when the turn the viewer is shown (FR-MAP-108) passes to a combatant on the other side whose token the viewer has and whose footprint is inside the aura's radius, the aura plays its strike on that token. Other side: an aura on a PC or owned token → monster combatants; an aura on a monster → PCs and owned tokens. Client only. | OQ-VFX-03 |
| FR-VFX-16 | **Hit reaction** (`hitOnAnchor`): a hit cue (FR-VFX-21) whose target token anchors such an aura and that names an attacker token → the aura plays its lash toward the attacker token. No attacker → no lash. | |
| FR-VFX-17 | Shadow of Moil's shadow covers its token: eyes only for players who don't own it; half covered for the DM and the owner. Labels and badges stay on top. | OQ-VFX-08 |

### 6.4 Hit looks

| ID | Requirement | Notes |
|---|---|---|
| FR-VFX-18 | **Hit look registry** (new, append-only): `src/client/common/features/spell-fx/hit-looks.ts`, one look per key: the 13 `DAMAGE_TYPES`, `healing`, `untyped`, `glance`. `bun test`: every damage type has a look. Each look lasts 0.4–1.4 s, draws on the over pass within 1.6 × the token's footprint and is subtle (no screen flash, no camera move). | §7.2 *(2026-10-28, fix/vfx-core: registry created empty with its type; "every damage type has a look" lands with the build slice's looks)* *(2026-10-28, build/vfx: filled, all 16 keys; "within 1.6 ×" tested as every drawn point ≤ 0.8 × the side from the centre at scale 1.56)* |
| FR-VFX-19 | **Choice** (pure, `hitLooks(cue)`): damage with `multiplier: none` → `glance`; else the cue's parts by value, the largest two typed parts, each its type's look (both play together); no typed part → `untyped`. Heal → `healing`. Scale: `half` × 0.7, `double` × 1.3, crit × 1.2 (stacked). | |
| FR-VFX-20 | A miss, or a change that applied 0 and raw 0, plays nothing. Undo plays nothing. | *(2026-10-28, fix/vfx-core: the server sends no cue for these; an immune hit, `raw` 0 with `multiplier: none`, still cues its glance, FR-VFX-19)* |
| FR-VFX-21 | **Hit cue** (transient, never stored, logged or in a snapshot): after `AttackApplied` / `HpApplied` commit, one cue per target row: `{id, targetTokenId, attackerTokenId?, kind: damage \| heal, parts: [{type \| null, value}] ≤ 4, multiplier, crit}`. Sent to the DM always; to a player only if that player receives the target token now (hidden, fog per FR-FOG-11) **and** that apply's outcome line. `attackerTokenId` only if the player also receives the attacker's token. Combatant without a token → no cue. | Transport: OQ-VFX-05 *(2026-10-28, fix/vfx-core: sent as server signal `vfx.hit`, `from` = the applying actor; `id` = the `hp_change` row id; `parts` = base (`raw` minus extras and triggers), extra weapon and trigger parts after the multiplier, largest four; `crit` from the outcome line. It may arrive just before that apply's event frame. Protocol §179)* |
| FR-VFX-22 | Cues are played on arrival only; a client that was offline, on another scene or in the background tab drops them (no queue, no replay). | |

### 6.5 Affected cells, preferences, layers

| ID | Requirement | Notes |
|---|---|---|
| FR-VFX-23 | Token menu (FR-MAP-29 registry) entry **Show affected cells** / **Hide affected cells** on a token that anchors an aura with `radiusFt`, for anyone who sees the aura. Client only, this viewer only, per (effect, token); cleared when the aura ends or the scene changes. Several auras on one token → one entry per aura ("Show cells: Spirit Guardians"). | DM pick, 2026-10-28 *(2026-10-28, build/vfx: players have no token menu (FR-MAP-18), so for them a right-click on such a token opens a small menu with the same entries through the `vfx-under` entry's layer `contextMenu` (FR-MAP-71 step 4); the DM's are in the token menu)* |
| FR-VFX-24 | Cells = the squares whose FR-MAP-22 distance from any square of the token's footprint is ≤ `radiusFt` (5e emanation), the footprint's own squares excluded. Pure `emanationCells(footprint, radiusFt, grid)` in `@shared/spell-fx`. Drawn on `vfx-under` in scene-tools' affected-squares style (FR-SCN-41), following the token while dragged. | |
| FR-VFX-25 | **Preferences** section `vfx.level` "Map effects", order 35, both clients (FR-SHELL-72): a four-way choice **Full · Reduced · Still · Off**. Stored per browser (`localStorage` key `pp.vfx`, zod-parsed; unreadable → default, kept in memory, like DICEX settings). Default: Still when `prefers-reduced-motion: reduce`, else Full. | |
| FR-VFX-26 | Levels: **Full** as designed; **Reduced** ≤ 45 % of each preset's particles and short trails; **Still** no ambient motion (aura drawn once as its Still frame, redrawn on token moves), hit looks and reactions still play once; **Off** the two layer entries render nothing and cues are dropped on arrival. | |
| FR-VFX-27 | **Slow frames**: while anything FX is animating, a median FX frame > 33 ms over 2 s drops one tier (Full → Reduced → Still, never to Off) for the rest of the page's life; the section shows "Lowered to ‹tier› on this device: slow frames". | As FR-DICEX-23 |
| FR-VFX-28 | DM Layers popover switch **Effects** (toggle key `vfx`, kind `hide`): off hides both passes and cues on the DM's screen only, like the other switches (FR-SCN-05). | |
| FR-VFX-29 | Budget: ≤ 400 live particles per client across every aura and look; past it, the oldest looks end early. | §12 |

## 7. UI/UX notes

Reference [visual-direction](../design/visual-direction.md). FX colours are preset constants (like dice looks), not theme tokens; DOM controls use shadcn primitives and theme tokens. Prototype: the DM-reviewed page (2026-10-28) drew every look below.

### 7.1 Presets

| Preset | Under pass | Over pass | Reaction |
|---|---|---|---|
| Spirit Guardians | Faint radial wash rising to the radius edge; double ring at the edge with ~30 runes turning slowly; breathing alpha (≈ 4 s) | 6 spirits orbiting at 50–90 % of the radius on comet trails, each lagging the token a little; ~48 motes drifting inside. Radiant gold-white, necrotic green | Strike: the nearest free spirit darts to the creature and back (0.9 s), flash ring on it |
| Shadow of Moil | Three stacked ragged pools of darkness to 10 ft (+ half a square), edges breathing; faint violet rim | Black flame particles with a violet fringe rising off the token (≈ 75/s at Full), trailing when it moves; the token covered (FR-VFX-17) with two violet eyes that blink every 2.5–5.5 s | Lash: three shadow tendrils whip to the attacker (0.9 s) with a dark puff there |

### 7.2 Hit looks

| Key | Look | Key | Look |
|---|---|---|---|
| acid | Green droplets splash and fall; the token fizzes | piercing | A streak through the token along the attack, sparks at the exit |
| bludgeoning | Dust puff and impact lines on the struck side; small shake | poison | A murky green cloud drifts off |
| cold | Ice shards grow from the rim in a pale mist | psychic | Pink rings closing in |
| fire | A flare and rising embers | radiant | Golden rays and a flash |
| force | Two hexagonal ripples | slashing | Two crescent cuts across the token |
| lightning | Forked bolts flickering across | thunder | Shock rings and a shake |
| necrotic | Life drawn in, then lifted away as green wisps | healing | Green motes and small crosses rising |
| untyped | One white impact ring | glance | A dull grey ring that stops short |

- Direction: from the attacker token's centre to the target's; no attacker → a seeded random angle.
- No numbers drawn on the map: the log and the card already say "7 fire".

### 7.3 Screens

- **Sheet (both):** Spells row editor gains **Map effect** (Select + params). Row view and Main's Spells box: **Cast** / **End** (stone button, kit style) and a "Concentrating" chip (CBTX's) while active.
- **Effect menus:** **Map effect…** dialog (FR-VFX-10).
- **Map:** auras, hit looks, token menu entry; DM Layers popover **Effects**.
- **Preferences:** "Map effects" four-way segmented control with a one-line hint and the slow-frames note.
- **States:** no token on this scene → nothing on the map, sheet still shows End; disconnected → auras keep animating from the last state, Cast disabled (as every intent button); Off → map plain, sheet unchanged.
- **DM view:** everything; hidden tokens' auras dimmed; picker on any effect.
- **Player view:** auras and cues only for tokens they receive; Cast on their own sheet (OQ-VFX-01, decided); Show affected cells on any aura they see.
- **Test IDs:** `vfx-row-fx` (Select, `data-record-id` = spell id), `vfx-row-fx-variant`, `vfx-row-fx-radius`, `vfx-cast` (`data-record-id` = spell id, `data-state` = `cast` \| `end`), `vfx-effect-fx` (menu item, `data-record-id` = effect id), `vfx-effect-fx-save`, `vfx-pref-level-<full|reduced|still|off>`, `vfx-pref-lowered`, `vfx-token-menu-cells` (`data-record-id` = effect id). Canvas: one non-listening Group per aura `vfx-aura` (id = effect id; attrs `preset`, `tokenId`, `radiusFt`, `level`), per playing look `vfx-hit` (id = cue id; attrs `look`, `tokenId`), `vfx-cells` (id = effect id; attr `count`); `vfx-over` Group attr `frameMs` (median, for walkthroughs).

## 8. Data model

JSON leaf fields per [ADR-0006](../architecture/adr/0006-persistence.md). No new table or record type.

| Entity | Field | Type | Notes |
|---|---|---|---|
| Effect (`effect`, CBTX) | `fx` *(new)* | **JSON leaf** `{preset, params, spellId?}` \| null, default null | ≤ 200 B; written by `vfx.cast`, `vfx.setEffectFx`; push-safe `ADD COLUMN` |
| Creature sheet (`creature-sheet`, CHARX) | `spells[].fx` *(new)* | inside the existing **JSON leaf**: `{preset, params}` optional | Old rows parse unchanged |
| Hit cue | — | transient message, FR-VFX-21 | Never stored |
| Client prefs | `pp.vfx` | `localStorage` `{level: full \| reduced \| still \| off}` | Per browser, not synced |

- **Relations:** `fx.spellId` → a row id in the target creature's sheet (soft; a deleted row leaves the effect running, Cast button gone).
- **Visibility:** `fx` rides the effect's rule ([FR-CBTX-31](combat-extras.md#6-functional-requirements)): DM full; players receive it on effects they already receive (not secret, not hidden, not ended); the redacted player record gains `fx`.
- **Derived values:** aura anchor tokens (FR-VFX-11), `emanationCells`, `hitLooks(cue)`, the turn reaction's "inside" test (centre distance ≤ radius + half the target's footprint).
- **Persisted runtime state:** only `effect.fx`. Particles, trails, cells shown, the lowered tier: memory only.

## 9. API & events

**REST:** none.

**WS intents (client → server)**

| Intent | Who | Validation / ownership |
|---|---|---|
| `vfx.cast {creatureId, spellId}` → `{effectId}` | DM; owner player (OQ-VFX-01, decided) | Sheet row exists (`not_found` "Row was deleted"), has `fx` (`conflict`), not already active (`conflict`); then `cbtx.setConcentration` / `cbtx.addEffect` rules (locked sheet: allowed, like counters) |
| `vfx.setEffectFx {effectId, fx \| null}` | DM; player on own character's non-secret effects | Active effect (`not_found`), FR-VFX-03 (`invalid`), ownership (`forbidden`) |

**WS events (server → client)**

| Event | Payload | Visibility rule |
|---|---|---|
| CBTX's effect events (`ConcentrationSet`, `EffectsAdded`, `EffectsEnded`, …) | the effect row, now with `fx` | Unchanged (FR-CBTX-31) |
| `EffectFxSet {effectId}` *(new, logged)* | effect record change | As the effect |
| Hit cue *(new, transient)* | FR-VFX-21 | DM; per player: target token received now **and** the outcome line received; attacker id stripped unless that token is received |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Set a spell row's map effect | any sheet | own sheet (CHARX row rules) | `char.putRow` |
| Cast / End from a row | any creature | own character (OQ-VFX-01, decided) | `vfx.cast` owner check; End = `cbtx.endEffect` rules |
| Map effect on an effect | any | own character's non-secret effects | `vfx.setEffectFx` |
| See an aura | always | effect received + token received | effect visibility + token visibility |
| Receive a hit cue | always | FR-VFX-21 | server, per connection |
| Show affected cells, Preferences, Layers switch | yes | cells, Preferences | client only |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** the snapshot carries active effects with `fx`; auras rebuild at their Still frame then animate. Cues sent while away are gone (FR-VFX-22).
- **DM disconnect / reconnect:** same; players keep their auras.
- **Hit cue size** *(2026-10-28, orchestrator ruling)*: ≤ 480 B per target frame, worst case (typical ~307 B, worst measured 466 B); see §12.
- **Server crash mid-action:** `vfx.cast` and `vfx.setEffectFx` are one transaction each: before commit → nothing; after → effect + `fx` on restart. A cue lost in a crash is never resent. Crash hooks `vfx.cast:before-commit`, `vfx.cast:after-commit`.
- **Concurrent edits:** two Casts of the same row → one wins, the other gets `conflict` "already active". Cast while the DM ends the concentration → whichever commits last wins; clients follow records.
- **Concentration ends any way** (End, failed save, incapacitating condition, duration, a new concentration, CBTX FR-CBTX-75) → the effect ends → the aura goes with it, mid-animation, within one frame of the record change.
- **Token moved to another scene / deleted / caster has no token:** no aura there; the effect stays.
- **Two tokens for one character on the scene:** an aura at each.
- **Fog:** passes draw above the fog layer around a token the viewer receives, so they reveal nothing the token doesn't. A fogged creature never gets a cue or a turn strike (the client lacks its token).
- **Hidden attacker, DM-only roll** (BL-135 roll guard): no attacker id or no cue to players, per FR-VFX-21.
- **Unknown preset** (newer server, older client): nothing drawn, one console warning per key.
- **Invalid / malicious input:** zod on both intents; `fx` size cap; params parsed by the preset's schema; a player can't set `fx` on a monster's or another player's effect.

## 12. Performance & bandwidth

- **Bandwidth:** `fx` ≤ 200 B per effect (≤ 300 effects per campaign cap → ≤ 60 KB worst, typically < 1 KB). Hit cue ≤ 200 B per target, human-paced. No per-frame traffic.
  - *(2026-10-28, VFX core walkthrough, orchestrator rulings: no code change)* The hit cue budget is **≤ 480 B per target frame** (worst case), not 200 B: its three ids are 108 characters. Typical ~307 B (measured at walkthrough S3, 244 B data, `.verify/20261028-vfxcore/`); worst case 466 B (4 typed parts sent by a player, whose `from` carries a 36-character `playerId`). Human-paced, negligible. The unit test asserts the worst case ≤ 480 B.
- **CPU:** one FX clock and one requestAnimationFrame per client, paused when no aura or look is on screen and when the tab is hidden. Particles are pre-tinted sprites (`drawImage`), no per-particle gradients.
- **Gate:** DM client at 1280×720, 30 tokens, both auras, one hit look every second: `vfx-over` `frameMs` median ≤ 4 ms on the walkthrough machine, no Konva layer warning (`stage.getLayers().length ≤ 4`).
- **Snapshot:** CON-44 heavy harness gains `fx` on its 6 concentrations; DM frame stays under 768 KiB.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); fixtures per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-VFX-01 catalogue` (unique keys and names; every key has a renderer; params defaults); `FR-VFX-04 suggestPreset`; `FR-VFX-19 hitLooks` (two largest typed parts, glance, untyped, healing, scales); `FR-VFX-24 emanationCells` (Medium 15 ft, Large 10 ft, map edge); `FR-VFX-25 level store` (default, reduced motion → Still, invalid → default); `FR-VFX-27 tier drop`; `FR-VFX-14 Still frame` (same seed → same draw calls); `FR-VFX-18 every damage type has a look` | in-code |
| Integration | `FR-VFX-07 cast` (concentration row → concentration with `fx.spellId`, replaces the old one and its linked effects; non-concentration → custom; no `fx` / already active → `conflict`); `FR-VFX-09 setEffectFx` permissions; visibility: secret / hidden effect `fx` never in player frames; `FR-VFX-21 cue routing` (harness DM + `player-1` + `player-2`: fire card on a visible goblin → all three; hidden goblin → DM only; fogged for `player-2` only → not to `player-2`; hidden attacker → no `attackerTokenId` for players; DM-only outcome line → DM only); reconnect → no cue in the snapshot; crash before / after commit → `state:digest` | bundle `spell-fx` |
| E2E (thin) | `// e2e-bundle: spell-fx`: `player-1` presses `vfx-cast` on Spirit Guardians → `vfx-aura` `preset=spirit-guardians` on DM and both players; DM applies the fire card → `vfx-hit` `look=fire` on all three; DM ends the concentration → no `vfx-aura` anywhere. Visual baselines (`visual-kit`): both auras at Still, both themes | `spell-fx` |

**Fixtures:** units `units/spell-fx/sg-row.ts` (Mira's spell row Spirit Guardians, radiant, `fx` set), `units/spell-fx/moil-row.ts` (Thorn's row Shadow of Moil), `units/spell-fx/fire-card.ts` (a pending fire damage card: Mira → Goblin Sneak). Bundle **`spell-fx`** = `map-tools` (Goblin Ambush; Mira `player-1`, Thorn `player-2`, Goblin Sneak) + a started encounter with the three + the units. Names owned by fixtures-adapters.

> Note (2026-10-28, VFX core walkthrough): S5's "cue without `attackerTokenId`" can't be seen through a **hidden** attacker token: FR-CBT-36 makes that outcome line DM-only, so players get no cue at all (nothing leaks). The stripped id shows only when the attacker token is fogged for one player while the line stays public (`cues-sync.test.ts`). A hit applied by hand (`cbt.applyHp`) has no damage type: its cue is untyped (one `untyped` look), so S5's "cold" look needs a card with cold damage.

> Note (2026-10-28, build/vfx): the visual baselines run on `visual-kit`, which gains unit `vfx-visual-auras` (the DM sets Spirit Guardians on Mira's "Bless" concentration and Shadow of Moil on Thorn's "Marked", existing effects), drawn at Still (`pp.vfx` set before load in every visual test).

> Note (2026-10-28, fix/vfx-core): the bundle adds unit `vfx-fight` (Goblin Ambush live; "Spell FX" round 1: Mira 15, Goblin Sneak 12, Thorn 10). Goblin Sneak is a renamed Goblin, so the merged BL-135 roll guard (#367) keeps **its own attack rolls** DM-only: no cue reaches players for them (FR-VFX-21). S6 therefore applies the hit by hand: Apply HP on Thorn, From = Goblin Sneak, public.

**Browser walkthrough** (`spell-fx`; A = DM, B = `player-1` / Mira, C = `player-2` / Thorn; verify profile):

| # | Step | Expected |
|---|---|---|
| S1 | B: sheet → Spells → Spirit Guardians → **Cast** | ≤ 1 s: spirits around Mira on A, B, C; B's button reads End; Concentrating chip |
| S2 | C: Shadow of Moil → Cast | Shadow on Thorn on all three; C sees Thorn half covered, B eyes only |
| S3 | B drags Mira four squares | The aura follows during the drag on A and C (drag preview) and settles with the token |
| S4 | A applies the fire card to Goblin Sneak | Fire look on the goblin on A, B, C, aimed from Mira |
| S5 | A hides Goblin Sneak, applies 4 cold by hand | Cold look on A only; B, C frames carry no cue (leak check) |
| S6 | A reveals the goblin, applies a hit from Goblin Sneak on Thorn | Lash from Thorn to the goblin on all three |
| S7 | A: Next until Goblin Sneak's turn, goblin inside Mira's 15 ft | Spirit strike on the goblin on all three |
| S8 | B: right-click Mira → Show affected cells | Cells on B only (`vfx-cells` count matches FR-VFX-24); Hide clears |
| S9 | C: Preferences → Map effects → Off; reload | C's map plain, still Off after reload; A, B unchanged |
| S10 | A: Layers → Effects off, then on | A plain, then back; B, C unchanged |
| S11 | A: B's concentration card → fail | Spirits gone on A, B (C has Off); B's button reads Cast |
| S12 | Stop the server mid-way through a Cast (crash hook), restart | Either no effect or effect + aura; never half |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [combat-extras](combat-extras.md) | `effect.fx` column + player redaction field; Cast reuses `setConcentration` / `addEffect` internals; Map effect… on effect menus | Shared change (DB schema, data model, protocol) |
| [character-sheet-full](character-sheet-full.md) | `spells[].fx`; row editor picker; Cast / End on rows and Main | OQ-VFX-06 |
| [scenes-map](scenes-map.md) | `LAYER_ORDER` entries `vfx-under` 38, `vfx-over` 43; token menu entry; drawn token positions incl. drag previews; FR-MAP-108 turn | Registries append-only; `LAYER_ORDER` is a shared edit |
| [scene-tools](scene-tools.md) | Layers popover switch (registry `toggle`); affected-squares style | Append-only |
| [combat-tracker](combat-tracker.md) | `AttackApplied` / `HpApplied` per-target facts for cues | OQ-VFX-05 (decided A) |
| [live-sync](live-sync.md) | A server-originated transient message routed per connection | OQ-VFX-05 (decided A) |
| [play-shell](play-shell.md) | Preferences sections (FR-SHELL-72) | Append-only |
| [compendium](compendium.md) | **Add to sheet** fills `fx` through FR-VFX-04 | One line in CMP's add path |
| [fog-of-war](fog-of-war.md) | Token visibility per player for cue routing | Existing rule |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-VFX-01 | Who presses Cast? | **A. the owner player on their sheet, and the DM on any sheet** · B. DM only. *Decided A (DM, 2026-10-28: "the player presses cast"; the DM keeps their usual reach over every sheet)* | no (decided) | §10, CHARX |
| OQ-VFX-02 | Does Shadow of Moil's darkness change vision? | **A. looks only; light rules later with the vision work** · B. dims fog vision inside the radius now | no (DM) | FOG |
| OQ-VFX-03 | Strike and lash moments | **A. automatic, visual only** · B. only on a DM button | no (DM) | FR-VFX-15/16 |
| OQ-VFX-04 | Redraw of the `objects` layer while FX animate | **A. both passes on `objects`, FX frames capped at 30 fps while an aura or look is on screen; measured by the §12 gate** · B. over pass on `top` at 60 fps (FX may cover labels) · C. ask scenes-map for a fifth Konva layer | no (builder, after the gate). *Decided A (build/vfx, 2026-10-28): the §12 gate in headless Chromium, DM 1280 × 720, both auras at Full, 30 tokens: `frameMs` median 1.4–1.5 ms, 4 Konva layers* | MAP |
| OQ-VFX-05 | How a hit cue reaches clients | **A. transient domain event from an after-commit listener on `AttackApplied` / `HpApplied`, filtered per connection by the token's visibility** (proposed ADR) · B. player-safe token ids on the outcome line, cues derived on the client. *Decided A (DM, 2026-10-28)* | no (decided) | SYNC, CBT, protocol |
| OQ-VFX-06 | How Cast reaches the sheet's spell rows | **A. a new append-only spell-row actions registry in character-sheet (`spell-row-actions.ts`), VFX adds Cast** · B. CHARX's files edited directly in a sequenced slice | no (orchestrator) | CHARX |
| OQ-VFX-07 | Glossary: *FX preset*, *map effect*, *aura*, *hit look*, *hit cue*, *glance*, "Map effects" (Preferences) | **A. add as written in §1–6** · B. other names | no (integrator) | glossary |
| OQ-VFX-08 | How much does Moil hide its token? | **A. eyes only for other players; half covered for the DM and the owner** · B. half covered for everyone | no (DM) | FR-VFX-17 |
| OQ-VFX-09 | A non-concentration spell with a map effect | **A. custom effect, no duration, ended by hand** · B. ask for a duration in rounds on Cast | no (DM) | FR-VFX-07 |

## 16. Out of scope

- Further presets (Bless, Spiritual Weapon, Darkness, Hunger of Hadar, Cloud of Daggers, Faerie Fire): one catalogue line + one renderer each, later.
- Point and template anchors; tethers between two tokens (Hex, Witch Bolt); one-shot cast bursts (Fireball, Misty Step).
- Hit looks for sheet HP changes outside combat (`char.adjustHp`): no combat log entry, no cue.
- Spell slot use on Cast ([CHARX §2](character-sheet-full.md#2-scope) keeps it manual).
- A table-wide DM switch (a campaign feature switch, [ADR-0058](../architecture/adr/0058-feature-switches.md)); per-preset mute; sound.
- Real light and vision rules for Moil (OQ-VFX-02 B, later).
