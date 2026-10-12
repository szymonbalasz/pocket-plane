// Tool rail content (MAP §7): Select, Ruler, Ping for both clients; DM extras as children.
import { MousePointer2Icon, RadarIcon, RulerIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { type MapTool, useMapTool } from "./tool-store";

const TOOLS: { tool: MapTool; label: string; icon: typeof RulerIcon; hint?: string }[] = [
  { tool: "select", label: "Select", icon: MousePointer2Icon, hint: "Drag tokens, pan the map" },
  { tool: "ruler", label: "Ruler", icon: RulerIcon, hint: "Drag to measure" },
  { tool: "ping", label: "Ping", icon: RadarIcon },
];

export function ToolRail({
  pingHint = "Click to ping",
  children,
}: {
  pingHint?: string;
  children?: React.ReactNode;
}) {
  const tool = useMapTool((s) => s.tool);
  const setTool = useMapTool((s) => s.setTool);
  return (
    <div
      data-testid="map-tool-rail"
      className="ml-2 flex flex-col gap-1 rounded-md border bg-background/85 p-1 backdrop-blur"
    >
      <ToggleGroup
        type="single"
        orientation="vertical"
        className="flex-col"
        value={tool}
        onValueChange={(v) => v && setTool(v as MapTool)}
        aria-label="Map tools"
      >
        {TOOLS.map((t) => (
          <Tooltip
            key={t.tool}
            content={`${t.label} — ${t.tool === "ping" ? pingHint : (t.hint ?? "")}`}
          >
            <ToggleGroupItem value={t.tool} aria-label={t.label} data-testid={`map-tool-${t.tool}`}>
              <t.icon />
            </ToggleGroupItem>
          </Tooltip>
        ))}
      </ToggleGroup>
      {children}
    </div>
  );
}
