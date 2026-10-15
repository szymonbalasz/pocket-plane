// Client-only map UI state shared by the tool rail and the canvas (both live in the play frame).
import { create } from "zustand";
import type { CanvasClient } from "./layers";
import { BASE_TOOLS, type BaseTool } from "./tools";

/** A base tool or a registry tool's id (`canvas-tools.ts`, FR-SCN-06). */
export type MapTool = BaseTool | (string & {});

export const MAP_TOOLS: readonly BaseTool[] = BASE_TOOLS;

interface ToolState {
  tool: MapTool;
  setTool(t: MapTool): void;
  /** The client whose canvas is mounted (filters registry tools on the rail); set by MapCanvas. */
  client: CanvasClient | null;
}

export const useMapTool = create<ToolState>((set) => ({
  tool: "select",
  setTool: (tool) => set({ tool }),
  client: null,
}));

/** FR-MAP-45: the rail's Fit button bumps `requests`; the canvas fits on each bump. */
export const useMapFit = create<{ requests: number; requestFit(): void }>((set) => ({
  requests: 0,
  requestFit: () => set((s) => ({ requests: s.requests + 1 })),
}));

/**
 * FR-SCN-05: DM layer switches, by toggle key (`true` = off). Client only, never sent; the Layers
 * popover (build/scene-tools-settings) sets them and keeps them per campaign in `localStorage`.
 */
export const useLayerToggles = create<{
  off: Readonly<Record<string, boolean>>;
  setOn(key: string, on: boolean): void;
  replace(off: Record<string, boolean>): void;
}>((set) => ({
  off: {},
  setOn: (key, on) => set((s) => ({ off: { ...s.off, [key]: !on } })),
  replace: (off) => set({ off }),
}));
