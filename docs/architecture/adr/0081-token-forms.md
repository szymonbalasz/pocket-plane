# 0081 — Token forms: a derived form copy beside the token's own art

- Status: accepted (DM, 2026-11-13)
- Date: 2026-11-13
- Consistent with: [ADR-0024](0024-definition-visibility.md) (display copies on tokens), [ADR-0049](0049-trigger-state.md) (`effectHooks` on every effect change), [ADR-0080](0080-animated-tokens.md) (`imageAnimated` derived on the token row)
- Refines: [ADR-0080](0080-animated-tokens.md): `imageAnimated` is derived from the drawn art, not `imageAssetId` alone
- Affects: [token-forms](../../specs/token-forms.md), [scenes-map](../../specs/scenes-map.md), [token-mirrors](../../specs/token-mirrors.md), [animated-tokens](../../specs/animated-tokens.md), [combat-tracker](../../specs/combat-tracker.md), [effect-modifiers](../../specs/effect-modifiers.md), [assets-pipeline](../../specs/assets-pipeline.md); protocol, data model

## Context

- The DM wants a character's token to change while a preset is on (Ulfhild's Rage), and on demand.
- `token.imageAssetId` is already a display copy with rules: it follows the portrait only while it equals the old one (FR-MAP-20), and the DM may set custom art (FR-MAP-18).
- A preset's effect ends by many paths: toggle off, expiry, Down, incapacitated, encounter end. It also comes back through undo and Prev.
- Players receive tokens, not other players' full characters.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. Overwrite `token.imageAssetId` on form change, restore on end | No new column; clients unchanged | Needs a stored "previous image"; breaks the portrait-refresh and custom-art rules; every end path must restore |
| B. Clients derive the art from the character's forms and effects | No server copy | Players don't get other characters' forms or toggle states; would leak form names; logic in clients (against ADR-0016) |
| **C. A separate token copy `formImageAssetId` of the character's derived shown form; drawn art = form copy, else own art** | Own art never touched; revert is just null; one derivation run from the existing effect choke point covers every end path | One column; every consumer of token art must use the drawn art |

## Decision

**C.**

- **Shown form is derived, never toggled by hand into tokens**: `shownFormOf(character)` = the newest active preset effect whose preset names a form, else the manual choice, else none.
- **One writer** re-derives the copy on the character's tokens: the form commands, `mod.putPreset` / `mod.deletePreset`, placement / duplicate, and token-forms' line in `effectHooks`. That hook already runs for every effect insert, end and restore, so no end path needs its own case. A changed token runs the token-changed hooks as an image change, so mirror and combatant copies follow through their existing lines.
- **"On" is read from active effects (`presetKey`)**, like trigger `requires.preset`, not from `activeEffectId`: no dependence on write order inside a command.
- **Drawn art = `formImageAssetId ?? imageAssetId`** everywhere a token's art is used: canvas, `tokenArtOf`, `imageAnimated`, mirrors, the combatant image copy. One shared helper (`tokenImageOf`).
- **Players get the art, not the forms**: `formImageAssetId` rides the token row; forms stay on the full character (DM, owner).

## Consequences

- New columns only (`entity.token_forms`, `entity.form_id`, `effect_preset.form_id`, `token.form_image_asset_id`); nothing for `upgrade:check` to move.
- Code that reads `token.imageAssetId` for display must switch to `tokenImageOf`; a `bun test` sweep should find raw reads in clients.
- Monster forms and size-changing forms can reuse the copy later (OQ-FORM-04, -05).
