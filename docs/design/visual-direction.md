# Visual direction

Feature specs reference this in their UI/UX section. Don't invent styling in specs.

## MVP (binding)

- Dark mode only. No light theme.
- shadcn/ui defaults with a dark theme. Tailwind utilities. No custom styling effort.
- Function over decoration. Dense, legible, keyboard-friendly.
- Laptop viewports only (≈1280px+ wide). No touch, no mobile layouts.
- Map canvas is the hero on play screens; panels around it.
- Use shadcn primitives (Dialog, Sheet, Tabs, Table, Command, Tooltip, Toast) before building anything bespoke.

## Long-term reference (not MVP)

A modernised-for-web take on the **Baldur's Gate 2** UI: what BG2's interface would look like if designed today as a responsive web app, without 800×600 constraints.

Delivered via the [theme system](../specs/post-mvp/theme-system.md). MVP markup should not block it: use semantic tokens, not hard-coded colours.

## BG2 motifs

| Keep | Why |
|---|---|
| Framed panels with ornamental borders | Strong identity; maps to cards/panels |
| Parchment and stone textures | Atmosphere; apply to surfaces, not text areas |
| Bottom action bar | Fast access to common play actions |
| Party portrait strip | At-a-glance HP/conditions for the party |
| Serif display type | Headings and names; body stays sans for legibility |
| Gem/jewel-style buttons and status indicators | Recognisable, decorative state cues |

| Drop | Why |
|---|---|
| Fixed 800×600 layout | Must be responsive across laptop sizes |
| Tiny pixel fonts | Legibility |
| Heavy chrome around the map | Map needs the space |
| Modal-heavy flows | Prefer side panels / sheets |
| Low-contrast text on texture | Accessibility |

## Theme token placeholders

> TODO (spec phase): define via [theme-system](../specs/post-mvp/theme-system.md). Names below are placeholders, not decided.

| Token group | Examples (placeholder) |
|---|---|
| Surface | `surface.base`, `surface.panel`, `surface.raised` |
| Text | `text.primary`, `text.muted`, `text.display` |
| Accent | `accent.primary`, `accent.danger`, `accent.success` |
| Border | `border.subtle`, `border.frame` |
| Typography | `font.display`, `font.body`, `font.mono` |
| Texture | `texture.panel`, `texture.parchment` |
| Game state | `hp.full`, `hp.bloodied`, `hp.down`, `visibility.hidden` |
| Creature type (canvas) | `creature.<type>`, 14 tokens, values below |
| Player colour | `player.<key>`, 8 tokens, values below |

### Creature type colours (proposed)

Token art backdrops ([entities §7](../specs/entities.md#7-uiux-notes), [OQ-ENT-30](../specs/entities.md#15-open-questions)). Proposed values, dark mode; the theme system may restyle them. White glyph on each, WCAG contrast measured: every value ≥ 4.99 : 1 (AA text 4.5, non-text 3). Against the app background `oklch(0.145 0 0)` ≈ `#09090b` the backdrops reach 2.2–4.0 : 1; the token's outline separates them from the map.

| Token | Colour | White on it | | Token | Colour | White on it |
|---|---|---|---|---|---|---|
| `creature.aberration` | `#6d3fa3` | 7.27 | | `creature.giant` | `#7a4f2c` | 7.04 |
| `creature.beast` | `#5c6f2b` | 5.58 | | `creature.humanoid` | `#355f9e` | 6.40 |
| `creature.celestial` | `#8a6a00` | 5.07 | | `creature.monstrosity` | `#8a3f8f` | 6.59 |
| `creature.construct` | `#56636c` | 6.18 | | `creature.ooze` | `#1f7a78` | 5.11 |
| `creature.dragon` | `#b3261e` | 6.54 | | `creature.plant` | `#3b7a32` | 5.23 |
| `creature.elemental` | `#b4530f` | 5.02 | | `creature.undead` | `#4b4f63` | 8.08 |
| `creature.fey` | `#2f7d5b` | 4.99 | | `creature.fiend` | `#8c1d40` | 8.88 |

### Player colours (proposed)

Each player's and the DM's colour ([campaign-management §7](../specs/campaign-management.md#7-uiux-notes), FR-CAMP-28; OQ-CAMP-17 decided #256): it marks their laser, pings, templates, drag paths, log names and notification stripes. Tuned from the Okabe–Ito colour-blind-safe set, dark mode; CSS `--player-<key>`; stored as a key, so the theme system may restyle them. WCAG contrast on the app background `#0a0a0a`, the window surface `#171717` and the `#000` casing drawn under every coloured map mark:

| Token | Colour | On `#0a0a0a` | On `#171717` | On casing | | Token | Colour | On `#0a0a0a` | On `#171717` | On casing |
|---|---|---|---|---|---|---|---|---|---|---|
| `player.amber` *(DM default)* | `#e69f00` | 8.79 | 7.96 | 9.32 | | `player.yellow` | `#f0e442` | 14.97 | 13.56 | 15.88 |
| `player.jade` | `#19b98a` | 7.87 | 7.13 | 8.35 | | `player.blue` | `#5b8ff0` | 6.25 | 5.66 | 6.63 |
| `player.sky` | `#56b4e9` | 8.58 | 7.77 | 9.10 | | `player.vermillion` | `#d55e00` | 5.12 | 4.64 | 5.43 |
| `player.rose` | `#e08ab8` | 8.01 | 7.25 | 8.50 | | `player.bronze` | `#a07850` | 4.99 | 4.52 | 5.30 |

- Every key ≥ 4.5 : 1 on the window surface (log names are text) and ≥ 5 : 1 on the casing. No white or grey key (selection outline, `visibility.hidden`); no pure red (`accent.danger`: every key ΔE2000 ≥ 15 from it).
- Colour-blind check (CIEDE2000 between every pair after the Machado 2009 simulation at full severity): normal min 14.1 (sky–blue), deuteranopia 9.7 (sky–blue), protanopia 9.6 (sky–rose), tritanopia 6.8 (sky–jade). Name chips and "by ‹name›" labels back colour up (OQ-CAMP-25). Checked by `FR-CAMP-28 palette contrast`.
