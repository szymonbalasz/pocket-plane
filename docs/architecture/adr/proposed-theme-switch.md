# Proposed ADR: Theme switch

- **Status:** proposed ([theme-system](../../specs/post-mvp/theme-system.md), OQ-THEME-01)
- **Context:** The DM wants a BG2/NWN-inspired look (Gilt & Stone) as an option next to today's shadcn look. The client already styles almost everything through shadcn tokens (≈ 970 token class uses; 21 raw colour classes in 15 files; raw hex mostly in the map canvas). The play shell's placer, Fit and layout tests depend on exact window and chrome sizes.

## Decision

1. The active theme is `data-theme="<id>"` on `<html>`; Default has no attribute. Set before first paint by a boot script, from `localStorage` `pp.theme.v1`.
2. A theme is **a token block plus one stylesheet** (`src/client/common/themes/<id>.css`) that targets `[data-theme="<id>"]` with component `data-slot` attributes and existing test IDs. Components don't branch on the theme and carry no theme-specific classes.
3. **Themes never change geometry.** Layout metrics the shell relies on (title bar, top bar, paddings, default and min sizes) are the same in every theme; decoration uses box-shadows, outlines, pseudo-elements and backgrounds only.
4. **Meaning colours are not themed:** HP, visibility, creature type and player colours keep their values.
5. Theme fonts are `@font-face` files bundled with the app, so they download only when a theme uses them.

## Consequences

- Adding a theme touches no component and no layout test, only its stylesheet, its tokens and one Preferences option.
- Our `components/ui/` parts have no `data-slot` today; the first slice adds one to each (shared-file edit). A later component without one can't be themed until it gets it.
- One e2e (`theme-geometry`) guards invariance: every window rect is equal across themes.
- Rejected: Tailwind `gilt:` variants in every className. That spreads the theme across ~600 files, and every new component would need both looks.
