---
title: Character sheet (full)
prefix: CHARX
status: stub
owner: —
phase: post-mvp
---

# Character sheet — full 5e (post-MVP stub)

The long-term target from [ADR-0007](../../architecture/adr/0007-product-scope.md); MVP ships [basics](../character-sheet.md) per [ADR-0014](../../architecture/adr/0014-mvp-scope.md).

- **What:** Abilities, skills, saving throws, speed, hit dice, temp HP, spells and slots, features, multiple attacks, inventory, currency, proficiencies, notes. Click-to-roll everything.
- **Tiered extras** ([feature tiers](../../feature-tiers.md#3-character-sheet-and-dice)): roll from any number (A), spell slots (B), encumbrance (C), rest buttons (C). No inspiration toggle (D), no D&D Beyond import (F).
- **Builds on:** [character-sheet](../character-sheet.md), [ADR-0012](../../architecture/adr/0012-character-derived-values.md), [compendium](compendium.md) (spells/items), [levelling](levelling.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Derived vs stored, homebrew overrides | See [ADR-0012](../../architecture/adr/0012-character-derived-values.md) |
| Players see each other's sheets? | **Summary only** / full read-only / none |
| Multiclassing | **Model supports; UI basic** / single class |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
