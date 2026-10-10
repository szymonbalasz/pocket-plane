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
