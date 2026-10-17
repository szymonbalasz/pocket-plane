// Canvas colours from the semantic CSS tokens (visual-direction: no hard-coded colours). Konva
// draws on a 2D canvas, which accepts the same CSS colour strings (incl. oklch). Token art
// (FR-ENT-28): one `creature.<type>` token per creature type (visual-direction, OQ-ENT-30), read
// from `--creature-<type>` with the proposed values as fallback, and the white glyph colour.
import { CREATURE_TYPES, type CreatureType } from "@shared/entities/schemas";
import { useMemo } from "react";

export interface CanvasColors {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  ring: string;
  primary: string;
  /** Per-role signal accents (theme-system names TBD): DM / player. */
  dmAccent: string;
  playerAccent: string;
  destructive: string;
  /** `visibility.hidden` (DM styling of hidden tokens). */
  hidden: string;
  /** `hp.bloodied` / `hp.down`: movement dash / over (OQ-MAP-27), overlay badge tones. */
  hpBloodied: string;
  hpDown: string;
  /** `hp.full`: overlay bar tone (FR-CBTX-28). */
  hpFull: string;
  /** `creature.<type>`: token art backdrop per creature type (FR-ENT-28). */
  creature: Readonly<Record<CreatureType, string>>;
  /** Token art glyph (white, ≥ 4.99 : 1 on every `creature.<type>`). */
  creatureGlyph: string;
}

/** visual-direction "Creature type colours (proposed)", dark mode. */
export const CREATURE_COLORS: Readonly<Record<CreatureType, string>> = {
  aberration: "#6d3fa3",
  beast: "#5c6f2b",
  celestial: "#8a6a00",
  construct: "#56636c",
  dragon: "#b3261e",
  elemental: "#b4530f",
  fey: "#2f7d5b",
  fiend: "#8c1d40",
  giant: "#7a4f2c",
  humanoid: "#355f9e",
  monstrosity: "#8a3f8f",
  ooze: "#1f7a78",
  plant: "#3b7a32",
  undead: "#4b4f63",
};

const FALLBACK: CanvasColors = {
  background: "#1c1c1c",
  foreground: "#fafafa",
  muted: "#333333",
  mutedForeground: "#a3a3a3",
  border: "rgba(255,255,255,0.1)",
  ring: "#737373",
  primary: "#e5e5e5",
  dmAccent: "#eab308",
  playerAccent: "#22c55e",
  destructive: "#f87171",
  hidden: "rgba(163,163,163,0.55)",
  hpBloodied: "#eab308",
  hpDown: "#ef4444",
  hpFull: "#22c55e",
  creature: CREATURE_COLORS,
  creatureGlyph: "#ffffff",
};

function read(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function useCanvasColors(): CanvasColors {
  return useMemo(
    () => ({
      background: read("--background", FALLBACK.background),
      foreground: read("--foreground", FALLBACK.foreground),
      muted: read("--muted", FALLBACK.muted),
      mutedForeground: read("--muted-foreground", FALLBACK.mutedForeground),
      border: read("--border", FALLBACK.border),
      ring: read("--ring", FALLBACK.ring),
      primary: read("--primary", FALLBACK.primary),
      dmAccent: read("--warning", FALLBACK.dmAccent),
      playerAccent: read("--success", FALLBACK.playerAccent),
      destructive: read("--destructive", FALLBACK.destructive),
      hidden: read("--visibility-hidden", FALLBACK.hidden),
      hpBloodied: read("--hp-bloodied", FALLBACK.hpBloodied),
      hpDown: read("--hp-down", FALLBACK.hpDown),
      hpFull: read("--hp-full", FALLBACK.hpFull),
      creature: Object.fromEntries(
        CREATURE_TYPES.map((t) => [t, read(`--creature-${t}`, CREATURE_COLORS[t])]),
      ) as Record<CreatureType, string>,
      creatureGlyph: read("--creature-glyph", FALLBACK.creatureGlyph),
    }),
    [],
  );
}
