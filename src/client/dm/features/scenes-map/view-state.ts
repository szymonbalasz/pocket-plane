// DM client-only map state (FR-MAP-08, -10, -51; FR-OVW-10): viewed scene or overview, grid preview,
// Scenes row focus. Selection: `./selection`.
import { OVERVIEW_TYPE, type OverviewRecord } from "@shared/overview-scenes/schemas";
import { sceneOrder } from "@shared/scenes-map/geometry";
import {
  SCENE_FOLDER_TYPE,
  SCENE_TYPE,
  type SceneFolderRecord,
  type SceneRecord,
} from "@shared/scenes-map/schemas";
import type { EffectiveGrid } from "@ui/features/scenes-map/canvas-context";
import { useRecords } from "@ui/sync/store";
import { useMemo } from "react";
import { create } from "zustand";

interface DmMapState {
  /** Requested view, a scene's or an overview's ID; resolved against the store by `useViewedScene`. */
  viewedSceneId: string | null;
  /** Local grid preview (FR-MAP-10): never sent until Save. */
  gridDraft: { sceneId: string; grid: EffectiveGrid } | null;
  /** FR-MAP-51: a Scenes row to scroll into view and focus once it renders; taken once. */
  rowFocus: string | null;
  view(sceneId: string | null): void;
  setGridDraft(d: { sceneId: string; grid: EffectiveGrid } | null): void;
  focusRow(sceneId: string | null): void;
}

export const useDmMap = create<DmMapState>((set) => ({
  viewedSceneId: null,
  gridDraft: null,
  rowFocus: null,
  view: (viewedSceneId) => set({ viewedSceneId }),
  setGridDraft: (gridDraft) => set({ gridDraft }),
  focusRow: (rowFocus) => set({ rowFocus }),
}));

/**
 * FR-OVW-10, the order's overview steps: the requested overview; a requested scene means none;
 * else the shown overview; else none. IDs of both kinds come from one generator, and a stale ID
 * falls through to the default.
 */
export function viewedOverview(
  overviews: readonly OverviewRecord[],
  scenes: readonly SceneRecord[],
  requested: string | null,
): OverviewRecord | null {
  const asked = overviews.find((o) => o.id === requested);
  if (asked) return asked;
  if (scenes.some((s) => s.id === requested)) return null;
  return overviews.find((o) => o.active) ?? null;
}

/**
 * FR-OVW-10 (extends FR-MAP-08): null while an overview is viewed. Else the requested scene if it
 * still exists; else the active scene; none active → the first scene in list order; no scenes →
 * null (shell empty state). A campaign switch replaces the store, so a stale id falls through to
 * the default. Every reader goes through `useViewedScene`, so battle tools, Encounters Start,
 * creature drops and View as switch off in one place.
 */
export function viewedScene(
  scenes: readonly SceneRecord[],
  folders: readonly SceneFolderRecord[],
  requested: string | null,
  overviews: readonly OverviewRecord[] = [],
): SceneRecord | null {
  if (viewedOverview(overviews, scenes, requested)) return null;
  return (
    scenes.find((s) => s.id === requested) ??
    scenes.find((s) => s.active) ??
    sceneOrder(folders, scenes)[0] ??
    null
  );
}

export interface Viewed {
  /** The viewed battle scene; null while an overview is viewed (FR-OVW-10). */
  viewed: SceneRecord | null;
  /** The active battle scene. */
  active: SceneRecord | null;
  /** The viewed overview. */
  overview: OverviewRecord | null;
}

/** What the DM views, resolved against the store (FR-MAP-08, FR-OVW-10). */
export function useViewedScene(): Viewed {
  const scenes = useRecords<SceneRecord>(SCENE_TYPE);
  const folders = useRecords<SceneFolderRecord>(SCENE_FOLDER_TYPE);
  const overviews = useRecords<OverviewRecord>(OVERVIEW_TYPE);
  const requested = useDmMap((s) => s.viewedSceneId);
  return useMemo(
    () => ({
      viewed: viewedScene(scenes, folders, requested, overviews),
      active: scenes.find((s) => s.active) ?? null,
      overview: viewedOverview(overviews, scenes, requested),
    }),
    [scenes, folders, overviews, requested],
  );
}
