// Tool rail content (MAP §7): Select, Ruler, Ping, then the canvas tool registry's tools for this
// client (FR-SCN-06; off while not live, FR-SCN-34) and Fit (FR-MAP-45); DM extras as children.
// The active registry tool's panel (or a base tool's, `basePanels`) shows at its home spot beside
// the rail, below shell windows, and pushes windows off it (`ToolPanel`, FR-MAP-60).
import { MousePointer2Icon, RadarIcon, RulerIcon, ScanIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { ToggleTip } from "../../components/ui/toggle-tip";
import { cn } from "../../lib/utils";
import type { Rect } from "../play-shell/geometry";
import { reportKeepOut } from "../play-shell/keep-outs";
import { usePushWindows } from "../play-shell/ShellContext";
import { canvasTools } from "./canvas-tools";
import { useLive } from "./intents";
import {
  BAR_GROUP_ATTR,
  barRect,
  barRows,
  TOOL_BAR_KEEP_OUT,
  toolBarMaxWidth,
  toolBarSpot,
} from "./tool-bar-spot";
import { type MapTool, useMapFit, useMapTool } from "./tool-store";
import { activeTool, type BaseTool, toolsFor } from "./tools";

const TOOLS: { tool: MapTool; label: string; icon: typeof RulerIcon; hint?: string }[] = [
  { tool: "select", label: "Select", icon: MousePointer2Icon, hint: "Drag tokens, pan the map" },
  { tool: "ruler", label: "Ruler", icon: RulerIcon, hint: "Drag to measure" },
  { tool: "ping", label: "Ping", icon: RadarIcon },
];

/** FR-MAP-08: ping, pull and laser are off while the DM views a scene players don't see. */
export const SIGNALS_OFF_HINT = "Only on the scene players see";
/** FR-SCN-34: canvas tools are off while not live. */
export const NOT_LIVE_HINT = "Off while reconnecting";

/**
 * Stacking of the tool panel in the play page (PlayFrame: base z-0 < windows z-10 < chrome z-20):
 * between the base and the windows, so a shell window opened over it is on top and gets its
 * clicks; the panel still sits above the canvas.
 */
export const TOOL_PANEL_Z = 5;

/** K10 (K6 gap 12): a rail button, the kit's 38 px tool square with a 20 px icon (every theme). */
export const RAIL_TOOL = "size-[38px] [&_svg]:size-5";

/** The panel's spot in `host` coordinates: beside the rail, 8 px right of it, top-aligned. */
export function panelSpot(
  rail: { top: number; right: number },
  host: { top: number; left: number },
): { top: number; left: number } {
  return { top: rail.top - host.top, left: rail.right - host.left + 8 };
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * The active tool's panel at its home spot (FR-MAP-60): beside the rail, max width per
 * `toolBarMaxWidth` (wider content wraps by control group, FR-FOG-58). The rail lives in the
 * chrome (z-20), so a panel inside it would cover shell windows; it is portalled into the play
 * page at `TOOL_PANEL_Z`. While shown it reports its rect as keep-out `map.toolbar` (FR-SHELL-48)
 * and, when it appears or changes size (tool change, viewport resize, its own content) or its tool
 * is pressed again (`reselect`, FR-SHELL-105), pushes windows off it through the placer
 * (FR-SHELL-104); never on window changes. Outside a play page (no host) it renders inline.
 */
function ToolPanel({
  rail,
  id,
  reselect,
  children,
}: {
  rail: React.RefObject<HTMLDivElement | null>;
  id: string;
  /** Bumped when the active tool is pressed again: push with the current rect (FR-SHELL-105). */
  reselect: number;
  children: React.ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const [maxW, setMaxW] = useState<number | undefined>(undefined);
  const [rows, setRows] = useState(1);
  const client = useMapTool((s) => s.client);
  const { push, layoutKey } = usePushWindows();
  const panelRef = useRef<HTMLDivElement>(null);
  const lastPush = useRef<{ trigger: string; rect: Rect } | null>(null);
  useLayoutEffect(() => {
    const el = rail.current;
    const page = el?.closest<HTMLElement>('[data-testid="ui-play-page"]') ?? null;
    setHost(page);
    if (!el || !page) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const h = page.getBoundingClientRect();
      setSpot(panelSpot(r, h));
      const vp = { w: window.innerWidth, h: window.innerHeight };
      setMaxW(client ? toolBarMaxWidth(client, toolBarSpot(r), vp) : undefined);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [rail, client]);
  // Measure after layout: rows, keep-out, push when the rect changed. A new tool (`id`), a layout
  // applied after a reload with the tool active (`layoutKey`) or the tool pressed again
  // (`reselect`, FR-SHELL-105) pushes again.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !host || !spot) return;
    const trigger = `${id}|${layoutKey}|${reselect}`;
    const measure = () => {
      const groups = [...el.querySelectorAll<HTMLElement>(`[${BAR_GROUP_ATTR}]`)];
      let prevTop: number | null = null;
      for (const g of groups) {
        const top = g.getBoundingClientRect().top;
        g.toggleAttribute("data-row-start", prevTop === null || Math.abs(top - prevTop) > 2);
        prevTop = top;
      }
      setRows(barRows(groups.map((g) => g.getBoundingClientRect().top)));
      const b = el.getBoundingClientRect();
      const rect = barRect([{ x: b.x, y: b.y, w: b.width, h: b.height }]);
      if (!rect || rect.w === 0 || rect.h === 0) return;
      reportKeepOut(TOOL_BAR_KEEP_OUT, rect);
      const last = lastPush.current;
      if (last?.trigger === trigger && sameRect(last.rect, rect)) return;
      lastPush.current = { trigger, rect };
      push(rect);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [host, spot, id, layoutKey, reselect, push]);
  useEffect(() => () => reportKeepOut(TOOL_BAR_KEEP_OUT, null), []);
  const panel = (inline: boolean) => (
    <div
      ref={panelRef}
      data-testid="map-tool-panel"
      data-tool={id}
      data-spot={inline ? undefined : "home"}
      data-rows={inline ? undefined : rows}
      className={cn(
        "pointer-events-none flex flex-col items-start gap-1 *:pointer-events-auto",
        inline ? "absolute top-0 left-full ml-2" : "absolute",
      )}
      style={inline ? undefined : { ...spot, maxWidth: maxW, zIndex: TOOL_PANEL_Z }}
    >
      {children}
    </div>
  );
  if (!host) return panel(true);
  return spot ? createPortal(panel(false), host) : null;
}

export function ToolRail({
  pingHint = "Click to ping, right-drag for the laser",
  selectHint,
  signalsOff = false,
  selectOnly = false,
  basePanels,
  children,
}: {
  pingHint?: string;
  selectHint?: string;
  /** Greys out Ping (and with it pull + laser). */
  signalsOff?: boolean;
  /** DM targeting (FR-MAP-33): the tool is forced to Select; the others are off. */
  selectOnly?: boolean;
  /** Panels for base tools, shown like a registry tool's (DM Ruler: Diagonals, FR-SCN-29). */
  basePanels?: Partial<Record<BaseTool, React.ComponentType>>;
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
  const Panel =
    (current?.panel as React.ComponentType | undefined) ??
    (selectOnly ? undefined : basePanels?.[tool as BaseTool]);
  const panelId = current?.id ?? tool;
  const railRef = useRef<HTMLDivElement>(null);
  // FR-SHELL-105 (BL-52): pressing the active tool again (the group reports "") re-pushes.
  const [reselect, setReselect] = useState(0);
  return (
    <div
      ref={railRef}
      data-testid="map-tool-rail"
      className="relative ml-2 flex flex-col gap-1 rounded-md border bg-background/85 p-1 backdrop-blur"
    >
      <ToggleGroup
        type="single"
        orientation="vertical"
        className="flex-col"
        value={tool}
        onValueChange={(v) => (v ? setTool(v as MapTool) : setReselect((n) => n + 1))}
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
              className={RAIL_TOOL}
            >
              <t.icon />
            </ToggleGroupItem>
          );
          return (
            <ToggleTip
              key={t.tool}
              content={`${t.label} — ${hint}`}
              offTestId={off ? `map-tool-${t.tool}-off` : undefined}
            >
              {item}
            </ToggleTip>
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
              className={RAIL_TOOL}
            >
              <Icon />
            </ToggleGroupItem>
          );
          const hint = !live ? NOT_LIVE_HINT : selectOnly ? "Off while picking targets" : null;
          return (
            <ToggleTip
              key={t.id}
              content={hint ? `${t.label} — ${hint}` : t.label}
              offTestId={off ? `map-tool-${t.id}-off` : undefined}
            >
              {item}
            </ToggleTip>
          );
        })}
      </ToggleGroup>
      {/* FR-MAP-45: camera only, so it works while not live too. */}
      <Tooltip content="Fit tokens to the free area">
        <Button
          size="icon"
          variant="ghost"
          className={RAIL_TOOL}
          aria-label="Fit"
          data-testid="map-tool-fit"
          onClick={requestFit}
        >
          <ScanIcon />
        </Button>
      </Tooltip>
      {children}
      {Panel && (
        <ToolPanel rail={railRef} id={panelId} reselect={reselect}>
          <Panel />
        </ToolPanel>
      )}
    </div>
  );
}
