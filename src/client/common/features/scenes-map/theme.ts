// Canvas colours from the semantic CSS tokens (visual-direction: no hard-coded colours). Konva
// draws on a 2D canvas, which accepts the same CSS colour strings (incl. oklch).
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
}

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
    }),
    [],
  );
}
