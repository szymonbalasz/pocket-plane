// The tool rail's overview set (FR-OVW-13): the tool list's buttons, then Fit. The rail keeps
// `map-tool-rail`: the same chrome, so the themes frame it alike. Ping off: FR-OVW-10.
import { ScanIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { useLive } from "../scenes-map/intents";
import type { CanvasClient } from "../scenes-map/layers";
import { NOT_LIVE_HINT, RAIL_TOOL, SIGNALS_OFF_HINT, ToolPanel } from "../scenes-map/ToolRail";
import { useMapFit } from "../scenes-map/tool-store";
import { useOverviewTool } from "./overview-canvas-context";
import { useOverviewEditor } from "./overview-editor";
import { activeOverviewTool, overviewToolsFor, SELECT_TOOL_ID } from "./overview-tools";

export function OverviewToolRail({
  client,
  signalsOff = false,
}: {
  client: CanvasClient;
  /** Greys out Ping (and with it pull + laser). */
  signalsOff?: boolean;
}) {
  const tool = useOverviewTool((s) => s.tool);
  const setTool = useOverviewTool((s) => s.setTool);
  const requestFit = useMapFit((s) => s.requestFit);
  const live = useLive();
  const current = activeOverviewTool(tool, client);
  useEffect(() => {
    if (signalsOff && current.signal) setTool(SELECT_TOOL_ID);
  }, [signalsOff, current, setTool]);
  const railRef = useRef<HTMLDivElement>(null);
  // FR-SHELL-105: pressing the active tool again (the group reports "") re-pushes its panel.
  const [reselect, setReselect] = useState(0);
  const Panel = current.panel as React.ComponentType | undefined;
  const panelOn = useOverviewEditor((s) => current.panelWhen?.(s) ?? true);
  return (
    <div
      ref={railRef}
      data-testid="map-tool-rail"
      data-rail="overview"
      className="relative ml-2 flex flex-col gap-1 rounded-md border bg-background/85 p-1 backdrop-blur"
    >
      <ToggleGroup
        type="single"
        orientation="vertical"
        className="flex-col"
        value={current.id}
        onValueChange={(v) => (v ? setTool(v) : setReselect((n) => n + 1))}
        aria-label="Overview tools"
      >
        {overviewToolsFor(client).map((t) => {
          const hint =
            t.signal && signalsOff
              ? SIGNALS_OFF_HINT
              : t.edits && !live
                ? NOT_LIVE_HINT
                : t.hint?.[client];
          const off = (t.signal === true && signalsOff) || (t.edits === true && !live);
          const Icon = t.icon as React.ComponentType<{ className?: string }>;
          return (
            <ToggleTip
              key={t.id}
              content={hint ? `${t.label} — ${hint}` : t.label}
              offTestId={off ? `ovw-tool-${t.id}-off` : undefined}
            >
              <ToggleGroupItem
                value={t.id}
                aria-label={t.label}
                data-testid={`ovw-tool-${t.id}`}
                disabled={off}
                className={RAIL_TOOL}
              >
                <Icon />
              </ToggleGroupItem>
            </ToggleTip>
          );
        })}
      </ToggleGroup>
      {/* FR-OVW-12: camera only, so it works while not live too. */}
      <Tooltip content="Fit everything to the free area">
        <Button
          size="icon"
          variant="ghost"
          className={RAIL_TOOL}
          aria-label="Fit"
          data-testid="ovw-tool-fit"
          onClick={requestFit}
        >
          <ScanIcon />
        </Button>
      </Tooltip>
      {Panel && panelOn && (
        <ToolPanel rail={railRef} id={`ovw-${current.id}`} reselect={reselect}>
          <Panel />
        </ToolPanel>
      )}
    </div>
  );
}
