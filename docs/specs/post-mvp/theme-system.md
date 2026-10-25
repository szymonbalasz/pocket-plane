---
title: Theme system
prefix: THEME
status: in-review
owner: spec-theme-system
phase: post-mvp
---

# Theme system

> First theme: **Gilt & Stone**, the BG2/NWN-inspired skin. Source of truth for its look: the kit page [gilt-stone.html](../../design/art/kit/gilt-stone.html) (open it in a browser), with the concept rounds in [art/prompts](../../design/art/prompts/). Mechanism: [proposed ADR](../../architecture/adr/proposed-theme-switch.md).

## 1. Summary

- A **theme** is a named look for the whole client. Each person picks one per browser in **Preferences**. Two themes: **Default** (today's shadcn look) and **Gilt & Stone**.
- A theme changes only colour, type, frames, textures and motion. It never changes layout, window sizes or behaviour, so the placer, Fit and every layout test hold under both.
- Browser only: nothing stored on the server, 0 bytes on the wire.

## 2. Scope

- Theme switch: a Preferences section, browser storage, applied without a reload or a flash.
- Gilt & Stone covers every shared component in `src/client/common/components/ui/` and the play shell's chrome: window frame, title bar, close and minimise, top bar, launcher, tool rail, toasts, tooltips (the **scroll tooltip**), scrollbars.
- Fonts bundled with the app (Old book pairing), loaded only while Gilt & Stone is on.
- Prerequisite cleanup: the 15 files that use raw Tailwind colour classes move to tokens, and every component in `components/ui/` gets a `data-slot` attribute (they have none today). No visible change in Default.

## 3. Goals

- The app feels like a classic CRPG table, not a generic web app, for anyone who picks Gilt & Stone.
- Default stays pixel-identical, so nobody is forced into the new look.
- Later themes are a token block plus one stylesheet, with no component edits.

## 4. Non-goals

- Layout changes: bottom action bar, portrait strip (BG2 motifs, later, [visual-direction](../../design/visual-direction.md)).
- The printed-style character sheet layout ([OQ-THEME-06](#15-open-questions)) and the Game log cleanup: feature work in their own specs.
- Light themes (dark only, visual-direction).
- Restyling the map canvas, tokens or 3D dice (v1; [OQ-THEME-09](#15-open-questions)).
- Per-campaign or DM-forced themes (v1; [OQ-THEME-02](#15-open-questions)).

## 5. User stories

**DM**
- As the DM, I want my table to look like the CRPGs we grew up with, so the session feels like an adventure, not a dashboard.
- As the DM, I want to switch back to the plain look in one click when I need maximum density or I'm troubleshooting.

**Player**
- As a player, I want to pick the look on my own device without affecting anyone else.
- As a player, I want hover details to appear on a small parchment scroll, like the old games.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-THEME-01 | Themes: `default` "Default", `gilt` "Gilt & Stone". The active theme is a `data-theme` attribute on `<html>`; `default` = no attribute. | ADR proposed |
| FR-THEME-02 | **Appearance** section in Preferences, both clients (`theme.appearance`, one line in each pref-sections registry, append). Two option cards, each with a small preview swatch (panel, frame, accent, display type sample); selecting one applies it at once. | FR-SHELL-72 |
| FR-THEME-03 | Stored per browser in `localStorage` `pp.theme.v1` = `{theme}` (zod-parsed), shared by both clients and all campaigns on that browser. Never sent. Invalid or unavailable storage → `default`, console warning. | OQ-THEME-02, -08 |
| FR-THEME-04 | **No flash:** the stored theme is set on `<html>` before first paint (inline boot script in both `index.html` files), including pre-play pages. | |
| FR-THEME-05 | **Geometry invariance:** under `gilt`, every layout metric the shell uses stays the same: title bar 32 px (`TITLE_H`), top bar 48 px, window body padding, launcher button padding and gap, tool rail size, every `defaultSize` / `minSize`. Frames, corners and glows are drawn with box-shadows, outlines and pseudo-elements, never with extra layout borders or padding. | FR-SHELL-61, placer |
| FR-THEME-06 | **Font sizes** follow the existing Tailwind scale in both themes (proposed, OQ-THEME-05). Content that grows to fit is measured live, so different glyph widths are allowed. | |
| FR-THEME-07 | **Launcher measurement** uses the computed font of a launcher button, not a fixed font string, so FR-SHELL-43's fit holds under both themes. | `Launcher.tsx` |
| FR-THEME-08 | **Tokens:** Gilt & Stone redefines the shadcn tokens in `styles.css` (`--background`, `--card`, `--primary`, …, `--radius`) and adds theme tokens (`--frame-*`, `--gem-*`, `--parchment-*`, `--font-title`, `--font-label`, `--font-num`, `--font-body`). Every theme token also has a Default value that reproduces today's look. Values: kit page `:root`. | Token names: §8 |
| FR-THEME-09 | **Meaning tokens are not themed:** `hp.*`, `visibility.hidden`, `creature.*`, `player.*` keep their values in every theme. | visual-direction |
| FR-THEME-10 | **Window frame** (`ui-window`): gold double rule, four SVG corner pieces, grain texture on the panel; title in `--font-title`; close = red **gem** (`ui-window-close`); minimise = small stone square with a gold bar. Focused window: brighter rule. | Kit "At the table" |
| FR-THEME-11 | **Controls** per the kit: Button (stone, gold label; hover, pressed, on, disabled states), Tabs (gem underline + diamond on the active tab, inside the tab's box), Checkbox (gem diamond), Switch, Input, Select, Slider, ToggleGroup, Badge (chip), Alert, Skeleton, Progress, Table, Card, Collapsible, Dialog, Popover, DropdownMenu. | Kit draft 3 "Controls" |
| FR-THEME-12 | **Scroll tooltip:** Tooltip and ToggleTip content render as a parchment strip with rolled ends, dark ink in `--font-num`, unrolling from the centre in 260 ms. The open delay stays FR-SHELL-29's. Reduced motion → no animation. | BG2 motif |
| FR-THEME-13 | **Toasts** (ShellToaster, notification cards, damage-card popup): framed like a small window without corner pieces; actions as stone buttons. | |
| FR-THEME-14 | **Scrollbars:** always visible, thin gold thumb on a dark track, in every scroll container (`scrollbar-color` + WebKit fallback). Horizontal tab strips scroll with the mouse wheel and show arrow buttons while they overflow. | Kit draft 2 feedback |
| FR-THEME-15 | **Numbers** use `--font-num` with lining, tabular figures everywhere digits are shown in boxes, tables, rows and results. | |
| FR-THEME-16 | **Fonts:** IM Fell English SC (titles, labels), EB Garamond 500/700 (numbers, names), Alegreya Sans 400/500/700 + italic (body). Committed as Latin-subset woff2 with their OFL licence files (decided, OQ-THEME-04); declared by `@font-face` so they download only while `gilt` is on. Fallback stacks keep the page usable if a font fails. | ADR-0018 attribution style |
| FR-THEME-17 | **Contrast:** under `gilt`, body text ≥ 7 : 1 and labels, numbers and gold text ≥ 4.5 : 1 on `--card`; focus ring visible on every surface. | Test `FR-THEME-17 contrast` |
| FR-THEME-18 | **Player colours:** FR-CAMP-31's contrast check runs against both themes' window surfaces; a colour must pass both. | OQ-THEME-12 |
| FR-THEME-19 | **Default unchanged:** the token cleanup (§2) and the theme layer change no pixel under `default`. | Walkthrough step D1 |
| FR-THEME-20 | **Test IDs** unchanged; new: `theme-option` (+ `data-value` = theme id, `data-state` = `on` \| `off`), `theme-section`. | AGENTS §9.5 |

## 7. UI/UX notes

- **Look:** the kit page is binding for Gilt & Stone. Palette sampled from concept A (`#101414` panel, `#e2c27c` gold, `#c81f22` gem); Old book type; compact rows from concept B; the active tool's bright frame and the Game log's boxed results from concept C.
- **Preferences → Appearance:** two cards side by side (Default, Gilt & Stone), selected card outlined; a one-line hint "Only on this browser".
- **States:** fonts still loading → fallback stack, no layout jump beyond glyph widths; storage blocked → Default, choice works for the session.
- **DM view / player view:** identical, each person's own choice.

## 8. Data model

No server data.

| Store | Key | Shape | Notes |
|---|---|---|---|
| `localStorage` | `pp.theme.v1` | `{ theme: "default" \| "gilt" }` | Per browser, zod-parsed |

- **Theme tokens** (CSS custom properties, new): `--frame-rule`, `--frame-rule-strong`, `--frame-shadow`, `--frame-corner` (SVG url), `--panel-grain` (url or `none`), `--gem`, `--gem-deep`, `--gem-hi`, `--gold`, `--parchment`, `--parchment-ink`, `--font-title`, `--font-label`, `--font-num`, `--font-body`. Exact values: kit page.
- **Derived values:** none.

## 9. API & events

None. No REST, intents or events; 0 bytes on the wire.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Choose own theme | ✓ | ✓ | none (browser only) |

## 11. Edge cases & failure modes

- **Disconnect / reconnect, server crash:** no effect; the theme is local.
- **Two tabs:** a change in one tab applies to the other on its next load (no `storage` event sync, proposed).
- **Font file missing or blocked:** fallback stack; layout metrics unaffected (FR-THEME-05).
- **Old browser without `scrollbar-color`:** WebKit pseudo-elements; else native bars.
- **Invalid stored value:** Default, one console warning.

## 12. Performance & bandwidth

- 0 bytes on the wire. JS: the section component and token map, < 3 KB; CON-44 unaffected.
- Fonts: about 6 woff2 files, ≈ 250 KB total, fetched only under `gilt` and cached; over the tunnel only on first use per player.
- Grain texture and corners are inline SVG data URIs in CSS (< 4 KB). No raster textures.

## 13. Test plan

| Level | What | Fixtures |
|---|---|---|
| Unit | `FR-THEME-03 storage` (parse, invalid, blocked); `FR-THEME-08 token completeness` (every theme token defined for both themes); `FR-THEME-17 contrast` (token pairs); `FR-THEME-18 player colours on both surfaces`; `FR-THEME-02 appearance section` (both clients) | none |
| Integration | `FR-THEME-07 launcher measures computed font`; `FR-THEME-04 boot script` (attribute set before React mounts) | none |
| E2E (thin) | `theme-geometry.e2e.ts`: open Initiative, Game log, sheet, Preferences under each theme; every `ui-window` and `ui-window-body` rect equal across themes; launcher labels the same | bundle `theme-gilt` |

**Browser walkthrough** (agent): bundle `theme-gilt` (new: `base` + `char-mira` full sheet, a combat in round 3 with 6 combatants, 4 game-log entries, a goblin stat block).
- D1: DM, Default: screenshot top bar, Initiative, Game log, sheet, Preferences. Compare with the same screens on `main`: identical.
- D2: Preferences → Gilt & Stone: everything restyles at once, no reload; window rects unchanged (compare `ui-window` boxes).
- D3: hover a log result, a skill roll, a condition: scroll tooltip after ≈ 400 ms; keyboard focus opens it too.
- D4: reload: still Gilt & Stone, no flash of Default.
- P1: `player-1` keeps Default while the DM uses Gilt & Stone; picks Gilt & Stone; the DM's browser is unaffected.
- P2: player sheet at 320 × 440: tab strip scrolls with the wheel, arrows show, scrollbars visible.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [play-shell](../play-shell.md) | Pref-sections registries (FR-SHELL-72); a new storage key next to FR-SHELL-76 (OQ-THEME-08); frame hooks on `ShellWindow` (title, close, minimise test IDs exist) | complete |
| [campaign-management](../campaign-management.md) | FR-CAMP-31 run per theme surface (FR-THEME-18) | complete |
| Shared UI | Edits to `components/ui/*` and `styles.css` (shared files, §9.9): token cleanup + `data-slot` on every component (none today) | orchestrator |

**Proposed build split** (one commit per slice):

| Slice | Branch | Does |
|---|---|---|
| T0 | `fix/theme-tokens` | 15 files' raw colour classes → tokens; `data-slot` on every `components/ui/` part; Launcher measures computed font. No visible change |
| T1 | `build/theme-switch` | Tokens, `data-theme`, boot script, storage, Appearance section, fonts |
| T2 | `build/theme-gilt` | `themes/gilt.css`: frame, controls, scrollbars, toasts, scroll tooltip; bundle `theme-gilt`; walkthrough |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-THEME-01 | How do themes style components? | **Decided (DM, 2026-10-25): A**, one stylesheet per theme, keyed on `[data-theme] [data-slot=…]` and test IDs, no theme logic in components · ~~B: Tailwind `gilt:` variants in every className~~ | decided | ADR proposed, shared UI |
| OQ-THEME-02 | Who picks the theme? | **A: each person, per browser** · B: per user, stored on the server · C: the DM sets a campaign default, people can override | no | SHELL |
| OQ-THEME-03 | Default for a browser with no choice yet | **A: Default** until the T2 walkthrough passes, then the DM decides · B: Gilt & Stone | no | owner: DM |
| OQ-THEME-04 | How are fonts shipped? | **Decided (DM, 2026-10-25): A**, committed Latin-subset woff2 + OFL licences · ~~B: `@fontsource/*` packages~~ · ~~C: Google Fonts CDN~~ | decided | tooling |
| OQ-THEME-05 | Alegreya Sans looks smaller than the system sans at 14 px. Bump body text under Gilt & Stone? | **A: same scale (FR-THEME-06), judge in the walkthrough** · B: +1 px body under `gilt` (grown windows change height) | no | SHELL layout tests |
| OQ-THEME-06 | The printed-sheet layout (shield AC, ability blocks with saves, boxed skills, passives row): where? | **A: a CHARX amendment, same markup in both themes, styled per theme** · B: Gilt-only markup | no | [character-sheet-full](../character-sheet-full.md) |
| OQ-THEME-07 | The sheet's default window is 320 × 440; the printed look wants more room | **A: keep 320 × 440 (it holds, kit draft 2)** · B: a larger default, needs a placer check | no | CHARX, SHELL |
| OQ-THEME-08 | FR-SHELL-76 says Preferences adds no new keys. A theme is a new setting, so it needs one | **A: allowed: FR-SHELL-76 covers moved settings, not new ones** · B: store it inside an existing key | no | [play-shell](../play-shell.md) |
| OQ-THEME-09 | Theme the map canvas (selection ring, measure line, pings) later? | **A: not in v1** · B: v1 with `scenes-map/theme.ts` reading tokens | no | scenes-map |
| OQ-THEME-10 | Glossary: **Theme**: "A named look for the whole client (colour, type, frames), chosen per browser in Preferences: Default or Gilt & Stone." Avoid: skin, style | **A: add** | no | glossary |
| OQ-THEME-11 | [visual-direction](../../design/visual-direction.md) "Long-term reference" should point at the kit and this spec | **A: integrator updates at merge** | no | visual-direction |
| OQ-THEME-12 | FR-CAMP-31 measures player colours on `#171717`; Gilt's surface is `#101414` (darker, so contrast only rises) | **A: check both (FR-THEME-18)** · B: Default only | no | campaign-management |

## 16. Out of scope

- Layout motifs (action bar, portrait strip): a later spec.
- Printed-sheet layout: CHARX (OQ-THEME-06). Game log cleanup (shorter lines, details on hover): [dice-roll-log](../dice-roll-log.md).
- Map canvas, token art, 3D dice looks (OQ-THEME-09; dice looks are [dice-extras](../dice-extras.md)).
- More themes; a theme editor.
