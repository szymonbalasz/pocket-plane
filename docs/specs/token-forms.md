---
title: Token forms
prefix: FORM
status: draft
owner: spec-token-forms
phase: post-mvp
---

# Token forms

> Five-minute read. Asked by the DM in conversation, 2026-11-13: "when Ulfhild is raging I want her to use a different token". DM picked option C (a forms list **and** presets that switch to a form) and "players see it too". Cross-cutting part: [proposed ADR](../architecture/adr/proposed-token-forms.md). Amends [scenes-map](scenes-map.md), [token-mirrors](token-mirrors.md), [animated-tokens](animated-tokens.md), [effect-modifiers](effect-modifiers.md), [character-sheet-full](character-sheet-full.md), [combat-tracker](combat-tracker.md), [assets-pipeline](assets-pipeline.md).

## 1. Summary

- A character has up to 6 **token forms**: a name and a token image ("Raging", "Enlarged").
- The DM or the character's owner picks the form by hand, from the sheet or the token menu.
- A character preset (a toggle like Rage) can name a form. While its effect is on, the character's tokens show that form. When it ends (toggled off, expired, encounter over, Down…), they go back.

## 2. Scope

- Forms on **characters** (PCs: entity kind `character`, the tokens that carry `characterId`), managed by the DM. Pets and summons that are creatures: OQ-FORM-05.
- Manual choice: DM and owner, sheet header and token menu (DM and player menus).
- Preset link: a character preset's optional **Token form**.
- Every token of the character, on every scene, shows the shown form; so do its mirrors and its Initiative row.
- Animated forms work for free: the form picker is the `token` picker context ([FR-ANIM-08](animated-tokens.md#6-functional-requirements)).

## 3. Goals

- Toggle Rage → Ulfhild's token changes for everyone, with no extra click. Rage ends by any path → it changes back.
- The token's own art (portrait copy or DM custom art) is never lost or overwritten.

## 4. Non-goals

- Forms on monsters and custom NPCs (OQ-FORM-05).
- A form changing size, speed or stats (Enlarge → Large, Wild Shape stat block) (OQ-FORM-04).
- Campaign or built-in presets applied with `mod.apply` naming a form: forms belong to one character, so only that character's presets link one.
- Players adding forms or uploading images (players can't upload, [FR-ASSET-01](assets-pipeline.md#6-functional-requirements)).

## 5. User stories

**DM**
- As the DM, I want to give Ulfhild a "Raging" token form and link it to her Rage toggle, so her token changes when she rages.
- As the DM, I want to switch a character's form from the token menu, so I can show a disguise or a transformation on the spot.

**Player**
- As Ulfhild's player, I want my token to change when I toggle Rage, and to switch forms myself from my sheet or my token's menu.
- As another player, I want to see Ulfhild's raging token on the map.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-FORM-01 | **Forms list.** A character holds `tokenForms`: 0–**6** `{id, name 1–24 (trimmed, unique per character, case-insensitive), imageAssetId}`. Each image through `assets.require` (same campaign, else `not_found`). Characters only: any other entity kind → `invalid`. | DM 2026-11-13 |
| FR-FORM-02 | **`forms.put {characterId, forms}`** (DM only): whole replace. A form sent with `id` keeps it (unknown id → `invalid`); without → `ctx.ids`. A removed form that was the chosen form clears `formId`; a preset naming it gets `formId` null, same transaction. `TokenFormsSaved`. | |
| FR-FORM-03 | **`forms.choose {characterId, formId \| null}`** (DM; owner, also while the sheet is locked, like `mod.toggle`). `formId` must name one of the character's forms. null = **Base** (the token's own art). Same value → success, no event. `TokenFormChosen`. | |
| FR-FORM-04 | **Preset link.** A **character** preset gains optional `formId` (one of its character's forms, else `invalid`), set through `mod.putPreset` by whoever may edit the preset ([FR-MOD-07](effect-modifiers.md#6-functional-requirements)). On a campaign preset → `invalid`. Absent on a replace = kept. | Amends FR-MOD-06/07 |
| FR-FORM-05 | **Shown form** (derived, server, `shownFormOf(tx, characterId)`): among the character's **active effects** whose `presetKey` is the id of one of its presets with a `formId` naming an existing form, the one started last (`createdAt`, then `seq`) gives the form; else the chosen `formId`; else none (Base). Read from effects, like a trigger's `requires.preset` (FR-MOD-54), not from `activeEffectId`, so write order inside a command doesn't matter. A preset form beats the manual choice only while it's on; the manual choice is kept underneath. | OQ-FORM-01, -06 |
| FR-FORM-06 | **Token copy.** Each token with `characterId` = the character (every scene) holds `formImageAssetId` = the shown form's image, or null. A **display copy**: never in an intent. Re-derived in the same transaction by `forms.put`, `forms.choose`, `mod.putPreset` (a `formId` change), `mod.deletePreset` (it doesn't end the effect, so the form must drop here), and by token-forms' **effect hook line** ([`effectHooks`](../architecture/adr/0049-trigger-state.md), runs for every effect insert, end, update and restore, in and out of combat, so expiry, Down, encounter end and undo / Prev need no case of their own). Rows written only where the copy changes. Each changed token then runs scenes-map's **token-changed hooks** ([ADR-0028](../architecture/adr/0028-token-changed-hooks.md)) as an image change, so the mirrors' and combatants' copies follow (FR-FORM-08, -09). | Proposed ADR |
| FR-FORM-07 | **New tokens.** `map.placeToken`, `placeTokenIn`, `map.duplicateToken` and scene duplicate write `formImageAssetId` from `shownFormOf` for a character token. | Amends FR-MAP-13, -18 |
| FR-FORM-08 | **Drawn art** = `formImageAssetId ?? imageAssetId` (`tokenImageOf`, `@shared/scenes-map`). Used by the canvas, `tokenArtOf` ([§64](../data-model/README.md#64-sprint-4-token-art-c-art)), `imageAnimated` (now from the drawn art: amends [FR-ANIM-06/07](animated-tokens.md#6-functional-requirements)) and mirrors (the stored art copy, FR-MIR-08's `sourceCopies`, takes the drawn art; [FR-MIR-07](token-mirrors.md#6-functional-requirements): a Shadow still carries no art). The token's own `imageAssetId` and its portrait-refresh rule ([FR-MAP-20](scenes-map.md#6-functional-requirements)) are untouched; the DM's token menu **Image** still edits the own art. | Amends FR-MAP-18, -20 |
| FR-FORM-09 | **Initiative row.** A bound combatant's `imageAssetId` copy ([FR-CBT-08](combat-tracker.md#6-functional-requirements), refreshed by combat's token-changed hook line) takes the drawn art, and follows it when the form changes (FR-FORM-06's hook run, same transaction). Token-less combatants keep the portrait. | OQ-FORM-03 |
| FR-FORM-10 | **Form overrides custom art.** The shown form applies to every token of the character, including one with DM custom art. Base shows each token's own art again. | OQ-FORM-02 |
| FR-FORM-11 | **Asset in use.** `entity.token_forms` (each `imageAssetId`, `json_each`) and `token.form_image_asset_id` join the "in use" holders ([FR-ASSET-64](assets-pipeline.md#6-functional-requirements)): a form's image can't be deleted. | Amends assets-pipeline |
| FR-FORM-12 | **Visibility.** `tokenForms` and `formId` ride the full character (DM, owner); **not** in the redacted-character whitelist ([FR-CHARX-35](character-sheet-full.md#6-functional-requirements)). Preset `formId`: the preset's rule ([FR-MOD-22](effect-modifiers.md#6-functional-requirements)). `formImageAssetId`: on the token row to everyone who receives the token, only when set. Other players learn the art, never the form's name. | |
| FR-FORM-13 | **Sheet, DM edit mode.** A **Token forms** row under Portrait: per form a 40 px thumbnail, name Input, **Change…** (asset picker, `context="token"`), remove (×); **Add form** (picker first, name defaults to the image's name, cut to 24). Saves with the sheet's edit (one `forms.put`). Max 6 → Add disabled, Tooltip "Up to 6 forms". | §7 |
| FR-FORM-14 | **Sheet header.** With ≥ 1 form, DM and owner see a **Form** Select: Base + the forms. While a preset form is shown, the Select shows it, with a muted line "From Rage"; picking another value sets the manual choice, which shows when Rage ends. | |
| FR-FORM-15 | **Token menus.** DM token menu ([FR-MAP-29](scenes-map.md#6-functional-requirements) registry) and the player token menu (owner's own character tokens only) gain **Form ▸** Base / each form, a check on the chosen one. Shown only for a character token with ≥ 1 form. | Append-only registry lines |
| FR-FORM-16 | **Preset form field.** The preset form ([effect-modifiers §7](effect-modifiers.md#7-uiux-notes)) gains **Token form**: None + the character's forms. Hidden when the character has no forms. The preset row shows a small `Image` icon with the form's name in a Tooltip. | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md); shadcn parts only.

- **Token forms row** (DM, sheet edit mode): a compact list like the Portrait row; empty → "No forms. Add one to switch this character's token, e.g. while raging."
- **Form Select** (header): small, beside the portrait; `form-header-select`.
- **Token menu:** submenu "Form", radio items. No confirm.
- **Map:** a form change is a plain image swap (no animation); name, ring, turn ring, shape and size unchanged.
- **States:** disconnected → the Select, menu items and Add disabled, as other intents. A form image that fails to load → the token art fallback, as any token image.
- **DM view:** all of the above for any character. **Player view:** owner: header Select, token menu Form, the preset's Token form field (while unlocked); others: only the drawn art on the map and in Initiative.
- Test IDs: `form-row`, `form-row-add`, `form-row-change` / `form-row-remove` (+ `data-record-id` = form id), `form-header-select`, `form-menu-item` (+ `data-record-id`, `base` for Base), `form-preset-select`.

## 8. Data model

Columns only; no rename, no drop (`upgrade:check`).

| Entity | Field | Type | Notes |
|---|---|---|---|
| Entity (character) | tokenForms | **JSON leaf** `{id, name, imageAssetId}[]` 0–6, column `token_forms` default `[]` | FR-FORM-01; other kinds always `[]` |
| Entity (character) | formId | text \| null, column `form_id` | Soft id into `tokenForms`: the manual choice |
| EffectPreset | formId | text \| null, column `form_id` | Character presets only; soft id |
| Token | formImageAssetId | ID → Asset \| null, column `form_image_asset_id` | Display copy (FR-FORM-06); asset ref |

- **Relations:** form image → Asset (`assets.require`, no FK, like other JSON leaves); token copy → Asset.
- **Derived:** `shownFormOf` (FR-FORM-05), `tokenImageOf` (FR-FORM-08), `imageAnimated` from the drawn art. Nothing about forms stored on combatants beyond the existing image copy.
- **Persisted runtime state:** `formId`, preset toggle state (existing), the token copies.

## 9. API & events

**REST:** none new.

**WS intents (client → server)**

| Intent | Who | Validation / ownership |
|---|---|---|
| `forms.put {characterId, forms}` | DM | FR-FORM-01, -02 |
| `forms.choose {characterId, formId \| null}` | DM; owner | FR-FORM-03 |
| `mod.putPreset` + `formId?` | as today | FR-FORM-04 |

**WS events (server → client)**

| Event | Payload / changes | Visibility rule |
|---|---|---|
| `TokenFormsSaved` | `{characterId}`; entity, presets, tokens, combatants changed | Each row by its record type's rule (FR-FORM-12) |
| `TokenFormChosen` | `{characterId, formId}`; entity, tokens, combatants | Event: DM + owner; rows by their rules |
| Effect events (`EffectToggled`, CBTX effect events…) | + token / combatant rows from the hook line | Rows by their rules |

## 10. Permissions

| Action | DM | Owner | Other player | Server check |
|---|---|---|---|---|
| Add / edit / remove forms | ✓ | ✗ | ✗ | DM secret |
| Choose a form | ✓ | ✓ (locked too) | ✗ | `ownerPlayerId` |
| Link a preset to a form | ✓ | ✓ while unlocked | ✗ | FR-MOD-07 |
| See the drawn art | ✓ | ✓ | ✓ tokens they receive | token visibility |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** the snapshot carries the copies; nothing client-side to restore.
- **DM disconnect:** controls disabled; forms keep showing.
- **Server crash mid-action:** every write (choice, copies, combatants) is in the command's one transaction; a crash leaves the old form everywhere.
- **Concurrent edits:** `forms.put` last write wins; `forms.choose` is idempotent; two toggles → FR-FORM-05 picks the later effect.
- **Rage and Enlarge both on, both with forms:** the later one shows; ending it shows the other (OQ-FORM-06).
- **Rage ends while the character is chosen as "Disguised":** back to Disguised, not Base (OQ-FORM-01).
- **Effect undone or restored (Prev, HP undo):** the hook runs on restore, so the form comes back.
- **Token on a scene players can't see, hidden or fogged:** copy written anyway; players only get it if they get the token.
- **Form removed or its preset deleted while on:** FR-FORM-02 clears links; the hook / command re-derives; tokens fall back.
- **Character deleted:** its tokens go with it (existing rules); preset rows cascade.
- **Invalid / malicious input:** strict zod; a player sending `forms.put` → `forbidden`; `formId` of another character's form → `invalid`; an asset of another campaign → `not_found`.

## 12. Performance & bandwidth

- DM / owner snapshot: ≤ 6 forms × ≈ 90 B per character with forms. Token rows: + ≈ 55 B each only while a form shows. Heavy scenario: 0 B (no forms); measure with one character at 6 forms and 4 tokens under CON-44.
- A form change touches ≤ the character's tokens + combatants (a handful of rows). Images load once per browser (immutable cache).

## 13. Test plan

| Level | What | Fixtures |
|---|---|---|
| Unit (shared) | `FR-FORM-05 shown form`: none / manual / preset on / two presets (later wins) / preset ended → manual / dangling ids ignored. `FR-FORM-08 tokenImageOf`, `tokenArtOf` and `imageAnimated` from the drawn art | in-code |
| Integration (server) | `FR-FORM-01/02` caps, names, ids kept, `assets.require`, removal clears `formId` and preset links; `FR-FORM-03` DM / owner / locked owner / other player; `FR-FORM-04` campaign preset → `invalid`; `FR-FORM-06` toggle on / off, expiry at the anchor's turn, Down ends Rage, encounter End, HP undo restores, tokens on two scenes, rows only where changed; `FR-FORM-07` place and duplicate while raging; `FR-FORM-09` combatant copy follows; `FR-FORM-10` custom-art token; `FR-FORM-11` delete refused; `FR-FORM-12` DM / owner / other player snapshot and live (no `tokenForms` in the redacted character, art on the token); crash: `PP_TEST_CRASH=forms.choose:before-commit` → old form; `upgrade:check` clean | bundle `token-forms` |
| Unit (client) | Forms row (add, change, remove, cap), header Select with "From Rage", token menu entries (DM; player own only), preset Token form field | jsdom |
| E2E | `e2e/token-forms.e2e.ts`, bundle `token-forms`: player-1 toggles Rage on Mira's sheet → Mira's canvas node shows the Raging image for DM and player-2; off → back; DM picks Enlarged from the token menu → both see it | bundle |

- **Fixtures:** `fixtures/assets/tokens/mira-raging.svg`, `mira-enlarged.svg` (CC0, in-repo). Unit `units/token-forms/mira-forms.ts`: `char-mira` (owner `player-1`) with forms Raging and Enlarged, character preset Rage → Raging. Bundle `token-forms` on `base` + `player-2`: Mira's token on the active scene and one on a second scene, a DM custom-art token of Mira.
- **Browser walkthrough** (bundle `token-forms`): DM opens Mira's sheet → edit → Token forms row lists both → adds a third from the library → saves. `player-1` toggles Rage → Mira's tokens show Raging on the DM's and both players' maps, and in Initiative after DM starts combat. `player-1` picks Enlarged in the header ("From Rage" shown, Raging still on the map) → toggles Rage off → Enlarged shows. DM token menu → Form ▸ Base → own art again (custom-art token shows its custom art). `player-2` has no Form entry on Mira's token. Reload both → same. DM tries to delete the Raging image in Assets → refused, in use.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [effect-modifiers](effect-modifiers.md) | preset `formId`, toggle state, preset form field | Amended here |
| [combat-extras](combat-extras.md) | `effectHooks` registry line (append-only) | Exists |
| [scenes-map](scenes-map.md) | token column, place / duplicate copy, drawn art, both token menu registries (append) | Amended here |
| [token-mirrors](token-mirrors.md), [animated-tokens](animated-tokens.md) | mirror art and `imageAnimated` from the drawn art | Amended here |
| [combat-tracker](combat-tracker.md) | combatant image copy follows the drawn art | Amended here |
| [character-sheet-full](character-sheet-full.md) | Token forms row, header Select | Amended here |
| [assets-pipeline](assets-pipeline.md) | in-use holders | Amended here |
| `docs/data-model/`, `docs/protocol/` | the columns, intents, events | Written at build (§9.9) |

## 15. Open questions

**Bold** = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-FORM-01 | A manual form is on, then Rage starts and ends: where does the token go? | **A. Back to the manual form** (it's kept underneath) / B. Back to Base | yes (DM) | FR-FORM-05 |
| OQ-FORM-02 | Does a form replace a token's DM custom art? | **A. Yes, every token of the character** / B. Custom-art tokens keep their art | yes (DM) | FR-FORM-10 |
| OQ-FORM-03 | Does the Initiative row follow the form? | **A. Yes** / B. Always the token's own art | no | FR-FORM-09 |
| OQ-FORM-04 | Should a form carry a size (Enlarge → Large) or more? | **A. Not now; image only** / B. Optional size per form | no | §4 |
| OQ-FORM-05 | Forms on monsters and custom NPCs? | **A. Later** (per-definition vs per-token needs its own call) / B. Now, per definition | no | §4 |
| OQ-FORM-06 | Two preset forms on at once: which shows? | **A. The one started last** / B. The preset listed first | no | FR-FORM-05 |
| OQ-FORM-07 | Glossary: *token form* (a character's named alternate token image), *shown form* (FR-FORM-05), *Base* (no form: the token's own art), *drawn art* (form image, else the token's own; sits next to the existing *Token art*, the glyph fallback when a token has no image) | **A. Add all four** | no | glossary |
| OQ-FORM-08 | Agent API: set forms and links from the MCP tools? | **A. Later**, follow-up to [agent-api](agent-api.md) / B. In this build | no | agent-api |

## 16. Out of scope

- Size / stat changes with a form, monster forms (§4, OQ-FORM-04, -05).
- A transition animation on the swap.
- MCP tools for forms (OQ-FORM-08).
