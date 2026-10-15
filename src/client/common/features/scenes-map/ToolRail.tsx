// Tool rail content (MAP §7): Select, Ruler, Ping, then the canvas tool registry's tools for this
// client (FR-SCN-06; off while not live, FR-SCN-34) and Fit (FR-MAP-45); DM extras as children.
// The active registry tool's panel shows beside the rail.
import { MousePointer2Icon, RadarIcon, RulerIcon, ScanIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { canvasTools } from "./canvas-tools";
import { useLive } from "./intents";
import { type MapTool, useMapFit, useMapTool } from "./tool-store";
import { activeTool, toolsFor } from "./tools";

const TOOLS: { tool: MapTool; label: string; icon: typeof RulerIcon; hint?: string }[] = [
  { tool: "select", label: "Select", icon: MousePointer2Icon, hint: "Drag tokens, pan the map" },
  { tool: "ruler", label: "Ruler", icon: RulerIcon, hint: "Drag to measure" },
  { tool: "ping", label: "Ping", icon: RadarIcon },
];

/** FR-MAP-08: ping, pull and laser are off while the DM views a scene players don't see. */
export const SIGNALS_OFF_HINT = "Only on the scene players see";
/** FR-SCN-34: canvas tools are off while not live. */
export const NOT_LIVE_HINT = "Off while reconnecting";

export function ToolRail({
  pingHint = "Click to ping, right-drag for the laser",
  selectHint,
  signalsOff = false,
  selectOnly = false,
  children,
}: {
  pingHint?: string;
  selectHint?: string;
  /** Greys out Ping (and with it pull + laser). */
  signalsOff?: boolean;
  /** DM targeting (FR-MAP-33): the tool is forced to Select; the others are off. */
  selectOnly?: boolean;
  children?: React.ReactNode;
}) {
  const tool = useMapTool((s) => s.tool);
  const setTool = useMapTool((s) => s.setTool);
  const requestFit = useMapFit((s) => s.requestFit);
  const client = useMapTool((s) => s.client);
  const live = useLive();
  const registry = client ? toolsFor(canvasTools, client) : [];
  const current = client ? activeTool(canvasTools, tool, client) : null;
  useEffect(() => {
    if (signalsOff && tool === "ping") setTool("select");
  }, [signalsOff, tool, setTool]);
  const Panel = current?.panel as React.ComponentType | undefined;
  return (
    <div
      data-testid="map-tool-rail"
      className="relative ml-2 flex flex-col gap-1 rounded-md border bg-background/85 p-1 backdrop-blur"
    >
      <ToggleGroup
        type="single"
        orientation="vertical"
        className="flex-col"
        value={tool}
        onValueChange={(v) => v && setTool(v as MapTool)}
        aria-label="Map tools"
      >
        {TOOLS.map((t) => {
          const off = (t.tool === "ping" && signalsOff) || (selectOnly && t.tool !== "select");
          const hint =
            t.tool === "ping" && signalsOff
              ? SIGNALS_OFF_HINT
              : selectOnly && t.tool !== "select"
                ? "Off while picking targets"
                : t.tool === "ping"
                  ? pingHint
                  : t.tool === "select"
                    ? (selectHint ?? t.hint ?? "")
                    : (t.hint ?? "");
          const item = (
            <ToggleGroupItem
              value={t.tool}
              aria-label={t.label}
              data-testid={`map-tool-${t.tool}`}
              disabled={off}
            >
              <t.icon />
            </ToggleGroupItem>
          );
          return (
            <Tooltip key={t.tool} content={`${t.label} — ${hint}`}>
              {/* A disabled button gets no pointer events: the wrapper carries the tooltip. */}
              {off ? (
                <span data-testid={`map-tool-${t.tool}-off`} className="inline-flex">
                  {item}
                </span>
              ) : (
                item
              )}
            </Tooltip>
          );
        })}
        {registry.map((t) => {
          const off = !live || selectOnly;
          const Icon = t.icon as React.ComponentType<{ className?: string }>;
          const item = (
            <ToggleGroupItem
              value={t.id}
              aria-label={t.label}
              data-testid={`map-tool-${t.id}`}
              disabled={off}
            >
              <Icon />
            </ToggleGroupItem>
          );
          const hint = !live ? NOT_LIVE_HINT : selectOnly ? "Off while picking targets" : null;
          return (
            <Tooltip key={t.id} content={hint ? `${t.label} — ${hint}` : t.label}>
              {off ? (
                <span data-testid={`map-tool-${t.id}-off`} className="inline-flex">
                  {item}
                </span>
              ) : (
                item
              )}
            </Tooltip>
          );
        })}
      </ToggleGroup>
      {/* FR-MAP-45: camera only, so it works while not live too. */}
      <Tooltip content="Fit tokens to the free area">
        <Button
          size="icon"
          variant="ghost"
          className="size-9"
          aria-label="Fit"
          data-testid="map-tool-fit"
          onClick={requestFit}
        >
          <ScanIcon className="size-4" />
        </Button>
      </Tooltip>
      {children}
      {Panel && current && (
        <div
          data-testid="map-tool-panel"
          data-tool={current.id}
          className="absolute top-0 left-full ml-2"
        >
          <Panel />
        </div>
      )}
    </div>
  );
}
