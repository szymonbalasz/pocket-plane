// DM client-only map state (FR-MAP-08, -10, -17): viewed scene, selection, grid preview.
import { sceneOrder } from "@shared/scenes-map/geometry";
import type { SceneFolderRecord, SceneRecord } from "@shared/scenes-map/schemas";
import type { EffectiveGrid } from "@ui/features/scenes-map/canvas-context";
import { create } from "zustand";

interface DmMapState {
  /** Requested viewed scene; resolved against the store by `viewedScene`. */
  viewedSceneId: string | null;
  selectedTokenId: string | null;
  /** Local grid preview (FR-MAP-10): never sent until Save. */
  gridDraft: { sceneId: string; grid: EffectiveGrid } | null;
  view(sceneId: string | null): void;
  select(tokenId: string | null): void;
  setGridDraft(d: { sceneId: string; grid: EffectiveGrid } | null): void;
}

export const useDmMap = create<DmMapState>((set) => ({
  viewedSceneId: null,
  selectedTokenId: null,
  gridDraft: null,
  view: (viewedSceneId) => set({ viewedSceneId, selectedTokenId: null }),
  select: (selectedTokenId) => set({ selectedTokenId }),
  setGridDraft: (gridDraft) => set({ gridDraft }),
}));

/**
 * FR-MAP-08: the requested scene if it still exists; else the active scene; none active → the
 * first scene in list order; no scenes → null (shell empty state). A campaign switch replaces
 * the store, so a stale id falls through to the default.
 */
export function viewedScene(
  scenes: readonly SceneRecord[],
  folders: readonly SceneFolderRecord[],
  requested: string | null,
): SceneRecord | null {
  return (
    scenes.find((s) => s.id === requested) ??
    scenes.find((s) => s.active) ??
    sceneOrder(folders, scenes)[0] ??
    null
  );
}
