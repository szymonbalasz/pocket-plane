// The Fog tool (FR-FOG-17): a DM line in SCN's canvas tool registry. Its panel is the fog bar; its
// pointer handlers draw rectangles, polygons and circles and edit darkness (`store.ts`,
// `gesture.ts`).
import { CloudFogIcon } from "lucide-react";
import type { CanvasToolDef } from "../scenes-map/tools";
import { FogBar } from "./FogBar";
import { FOG_TOOL_ID, fogPointer } from "./store";

export const fogTool: CanvasToolDef = {
  id: FOG_TOOL_ID,
  label: "Fog",
  icon: CloudFogIcon,
  clients: ["dm"],
  order: 40,
  panel: FogBar,
  cursor: "crosshair",
  pointer: fogPointer,
};
