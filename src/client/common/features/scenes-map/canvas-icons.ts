// Icon chips on the canvas (FR-MAP-57): the lucide icons badges name (`TokenBadge.icon`), as SVG
// path data on lucide's 24 × 24 stroke grid (lucide, ISC licence; circles written as arcs), so
// Konva draws them as one `Path` without the React component. An icon not listed here draws as
// its label's first letter. DOM-free (tested under bun).

/** lucide's grid and stroke width. */
export const ICON_GRID = 24;
export const ICON_STROKE = 2;

const ICON_PATHS: Readonly<Record<string, string>> = {
  // fog-of-war: Fog, Invisible (FR-FOG-20, -47)
  "cloud-fog": "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242 M16 17H7 M17 21H9",
  ghost:
    "M15 10v1 M7.528 20.472a1.6 1.6 0 012.277 0l1.057 1.056a1.6 1.6 0 002.276 0l1.057-1.056a1.6 1.6 0 012.277 0l1.114 1.114a1.4 1.4 0 002.414-1V10a8 8 0 00-16 0v10.586a1.4 1.4 0 002.414 1z M9 10v1",
  // combat-tracker: Out (FR-CBT-38)
  "log-out": "m16 17 5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
  // combat-tracker: side badge Ally / Enemy (FR-CBT-104)
  handshake:
    "m11 17 2 2a1 1 0 1 0 3-3 m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4 m21 3 1 11h-2 M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3 M3 4h8",
  swords:
    "m13 19 6-6 M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5 m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586 m16 16 4 4 m19 21 2-2 m5 14 4 4 m5 21-2-2 M7.5 16.5 4 20",
  // combat-extras: Stable / Dying, Dead (FR-CBTX-30)
  "heart-pulse":
    "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5 M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27",
  skull:
    "m12.5 17-.5-1-.5 1h1z M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z M16 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0 M10 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0",
  // effect-modifiers: triggers (FR-CBTX-53)
  zap: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
  "eye-off":
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49 M14.084 14.158a3 3 0 0 1-4.242-4.242 M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143 M2 2l20 20",
  // combat-tracker: companion marker (FR-MAP-76)
  "paw-print":
    "M13 4a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M20 8a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M22 16a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z",
};

/** What an icon chip draws: the icon's path data, else the label's first letter (upper case). */
export function chipGlyph(icon: string, label: string): { path: string } | { letter: string } {
  const path = ICON_PATHS[icon];
  if (path) return { path };
  return { letter: [...label.trim()][0]?.toUpperCase() ?? "?" };
}
