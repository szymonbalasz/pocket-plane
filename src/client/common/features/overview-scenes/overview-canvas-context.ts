// The overview canvas's tool store and what its item nodes read. Stable across camera changes, so
// a pan or zoom never re-renders the items (OVW §12).
import { createContext, useContext } from "react";
import { create } from "zustand";
import type { CanvasClient } from "../scenes-map/layers";
import type { CanvasColors } from "../scenes-map/theme";
import { SELECT_TOOL_ID } from "./overview-tools";

/** Apart from the battle scene's tool: leaving an overview hands the DM their tool back. */
export const useOverviewTool = create<{ tool: string; setTool(t: string): void }>((set) => ({
  tool: SELECT_TOOL_ID,
  setTool: (tool) => set({ tool }),
}));

export interface OverviewCanvasContextValue {
  client: CanvasClient;
  overviewId: string;
  colors: CanvasColors;
  live: boolean;
  myPlayerId: string | null;
}

export const OverviewCanvasContext = createContext<OverviewCanvasContextValue | null>(null);

export function useOverviewCanvas(): OverviewCanvasContextValue {
  const c = useContext(OverviewCanvasContext);
  if (!c) throw new Error("useOverviewCanvas outside OverviewCanvas");
  return c;
}
