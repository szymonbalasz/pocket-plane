// Play-shell layout document (SHELL §8). Browser-only: stored in localStorage, never sent to
// the server (#121, ADR-0025). Shape kept server-ready in case it moves to a record later.
import { z } from "zod";

export const MAX_WINDOWS = 40;
export const GEOMETRY_LIMIT = 10_000;

/** `<prefix>.<name>`, e.g. `camp.players` (FR-SHELL-07, FR-SHELL-17). */
export const WindowKind = z
  .string()
  .max(64)
  .regex(/^[a-z]+\.[a-z0-9-]+$/, "kind must be <prefix>.<name>");
export type WindowKind = z.infer<typeof WindowKind>;

/** MVP uses `main` only; the key is ready for several windows of one kind. */
export const WindowInstance = z
  .string()
  .max(64)
  .regex(/^[a-z0-9-]+$/);
export const MAIN_INSTANCE = "main";

export const WindowStatus = z.enum(["open", "minimised", "closed"]);
export type WindowStatus = z.infer<typeof WindowStatus>;

const coord = z.number().int().min(-GEOMETRY_LIMIT).max(GEOMETRY_LIMIT);
const size = z.number().int().min(1).max(GEOMETRY_LIMIT);

export const WindowState = z.object({
  kind: WindowKind,
  instance: WindowInstance,
  state: WindowStatus,
  x: coord,
  y: coord,
  w: size,
  h: size,
  /** Stacking order; higher = in front. */
  z: coord,
  /**
   * Work area size when this window's geometry was last set (FR-SHELL-15/29). Optional:
   * entries stored before it still parse (fit then skips the window).
   */
  area: z.object({ w: size, h: size }).optional(),
  /**
   * Set at a user resize end on a `growToContent` window type (FR-SHELL-39): the stored height
   * wins, no growth. Absent = grows; entries stored before it still parse.
   */
  fixedH: z.literal(true).optional(),
  /**
   * Set at a user move / resize end (FR-SHELL-56, OQ-SHELL-55 B): the spot is the user's, kept on
   * a reopen even over a PC. Cleared when the shell places the window; entries stored before it
   * parse as absent (the shell chose the spot).
   */
  userSpot: z.literal(true).optional(),
});
export type WindowState = z.infer<typeof WindowState>;

/** The stored entry (FR-SHELL-15/17): ≤ 40 windows, unique (kind, instance). */
export const Layout = z.object({
  windows: z
    .array(WindowState)
    .max(MAX_WINDOWS)
    .superRefine((ws, ctx) => {
      const seen = new Set<string>();
      for (const [i, w] of ws.entries()) {
        const k = `${w.kind}:${w.instance}`;
        if (seen.has(k)) ctx.addIssue({ code: "custom", path: [i], message: `duplicate ${k}` });
        seen.add(k);
      }
    }),
});
export type Layout = z.infer<typeof Layout>;

/** `pp.layout.v1.<campaignId>.<dm | playerId>` (FR-SHELL-15). No secret in the key. */
export function layoutKey(campaignId: string, owner: { role: "dm" } | { playerId: string }) {
  return `pp.layout.v1.${campaignId}.${"playerId" in owner ? owner.playerId : "dm"}`;
}
