// Token mirrors on the canvas (MIR §7): the pure look and hit rules, and the DM's right-click menu.
// DOM-free, so it runs under `bun test`. Players never get a menu: a mirror does nothing for them.
import { cellToPx, footprint, type Grid } from "@shared/scenes-map/geometry";
import type { MirrorMode, MirrorView } from "@shared/token-mirrors/schemas";
import { TOKEN_MIRROR_TYPE } from "@shared/token-mirrors/schemas";
import { create } from "zustand";
import type { LayerContextMenu, MenuPoint } from "../scenes-map/layers";

/** FR-MIR-16: the menu's words, in its order. */
export const MODE_LABELS: readonly (readonly [MirrorMode, string])[] = [
  ["visible", "Visible"],
  ["transparent", "Transparent"],
  ["shadow", "Shadow"],
  ["hidden", "Hidden"],
];

const labelOf = (mode: MirrorMode): string =>
  MODE_LABELS.find(([m]) => m === mode)?.[1] ?? "Visible";

/** The DM's copy: what players see now, or that they see nothing. */
export const offForPlayers = (m: Pick<MirrorView, "mode" | "suppressed">): boolean =>
  m.mode === "hidden" || m.suppressed === true;

/** FR-MIR-15: how solid a mirror draws. The DM sees what players get; hidden ones stay faint. */
export function mirrorOpacity(m: Pick<MirrorView, "mode" | "suppressed">): number {
  if (offForPlayers(m)) return 0.3;
  if (m.mode === "transparent") return 0.45;
  if (m.mode === "shadow") return 0.6;
  return 1;
}

/** FR-MIR-15: the shadow is a dark shape: players hold no art for it, the DM sees the same. */
export const drawsAsShadow = (m: Pick<MirrorView, "mode">): boolean => m.mode === "shadow";

/** FR-MIR-15: the DM's clear label. `Mirror · Goblin · Transparent`. */
export function dmLabel(m: Pick<MirrorView, "mode" | "suppressed" | "name">): string {
  const state = m.suppressed === true ? "Hidden with its token" : labelOf(m.mode);
  return `Mirror · ${m.name ?? ""} · ${state}`;
}

/** FR-MIR-15: a player's label: the name, none on a shadow (they don't have it). */
export const playerLabel = (m: Pick<MirrorView, "name">): string | null => m.name ?? null;

/** Mirrors of a scene, in drawing order (`seq` on the DM's wire; ids on a player's). */
export function sceneMirrorsOf(
  byId: Readonly<Record<string, unknown>> | undefined,
  sceneId: string,
): MirrorView[] {
  const all = Object.values(byId ?? {}) as MirrorView[];
  return all
    .filter((m) => m.sceneId === sceneId)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id));
}

/** The topmost mirror whose footprint holds map point `p`. */
export function mirrorAt(
  mirrors: readonly MirrorView[],
  grid: Grid,
  p: MenuPoint,
): MirrorView | null {
  for (let i = mirrors.length - 1; i >= 0; i--) {
    const m = mirrors[i] as MirrorView;
    const { x, y } = cellToPx(grid, m.col, m.row);
    const side = footprint(m.size) * grid.gridCellSize;
    if (p.x >= x && p.x < x + side && p.y >= y && p.y < y + side) return m;
  }
  return null;
}

export interface MirrorMenuOpen {
  mirrorId: string;
  at: MenuPoint;
}

export const useMirrorMenu = create<{ open: MirrorMenuOpen | null }>(() => ({ open: null }));

export function closeMirrorMenu(): void {
  if (useMirrorMenu.getState().open) useMirrorMenu.setState({ open: null });
}

/** FR-MIR-16: the DM's right-click on a mirror (FR-MAP-71 step 4). */
export const mirrorContextMenu: LayerContextMenu = {
  hit: (p, ctx) =>
    ctx.client === "dm" &&
    mirrorAt(sceneMirrorsOf(ctx.store.records[TOKEN_MIRROR_TYPE], ctx.scene.id), ctx.grid, p) !==
      null,
  open(p, screen, ctx) {
    const m = mirrorAt(
      sceneMirrorsOf(ctx.store.records[TOKEN_MIRROR_TYPE], ctx.scene.id),
      ctx.grid,
      p,
    );
    if (m) useMirrorMenu.setState({ open: { mirrorId: m.id, at: screen } });
  },
};
