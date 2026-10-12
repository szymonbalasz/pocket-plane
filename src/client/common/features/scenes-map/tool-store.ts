// Client-only map UI state shared by the tool rail and the canvas (both live in the play frame).
import { create } from "zustand";

export type MapTool = "select" | "ruler" | "ping";

export const MAP_TOOLS: readonly MapTool[] = ["select", "ruler", "ping"];

interface ToolState {
  tool: MapTool;
  setTool(t: MapTool): void;
}

export const useMapTool = create<ToolState>((set) => ({
  tool: "select",
  setTool: (tool) => set({ tool }),
}));
