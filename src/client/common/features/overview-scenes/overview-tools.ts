// Overview tool list (FR-OVW-13). APPEND-ONLY for the add-tool slices: Add image, Label, Add party
// and Add miniature each add one entry to `overviewTools` (`order` between Select and Ping). There
// is no grid, ruler, wall, fog or template tool here. OverviewCanvas sends every stage pointer event
// to the active tool's `pointer`, and draws its `layer` (Konva, top layer) and `overlay` (DOM, over
// the canvas, e.g. FR-OVW-25's field); `panel` shows beside the rail (FR-MAP-60). The handlers are
// DOM-free, so they run under `bun test`.
import { MAP_SIGNALS } from "@shared/scenes-map/schemas";
import { ImagePlusIcon, MousePointer2Icon, RadarIcon } from "lucide-react";
import type { CanvasClient } from "../scenes-map/layers";
import { AddImagePanel } from "./AddImagePanel";
import type { OverviewItemView } from "./item-layout";
import { SELECT_TOOL_ID } from "./overview-canvas-context";
import { selectPointer } from "./select-tool";

export { SELECT_TOOL_ID };

/** One stage pointer event, as the active overview tool receives it. */
export interface OverviewPointer {
  /** Units (stage-relative). */
  x: number;
  y: number;
  /** Screen px (menus, DOM fields over the canvas). */
  screen: { x: number; y: number };
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  clicks: number;
  client: CanvasClient;
  overviewId: string;
  /** The topmost item under the pointer; null on empty canvas. */
  item: OverviewItemView | null;
  /** FR-OVW-47: editing is off while not live; a tool checks this (selection still works). */
  live: boolean;
  /** Ping, pull and laser on: live, and the DM views what players see (FR-OVW-10). */
  signalsLive: boolean;
  scale: number;
  /** Sends a WS intent; resolves on `ack`, rejects on `reject` (show it with `toastReject`). */
  intent(name: string, input: unknown): Promise<unknown>;
  signal(name: string, data: unknown): void;
  /** Draws this client's own ping (others get the signal). */
  markPing(x: number, y: number): void;
  /** This press won't pan the stage (FR-OVW-16's box), until its release. */
  holdPan(): void;
}

export type OverviewToolCancel = "escape" | "tool" | "live";

export interface OverviewPointerHandlers {
  /** Left press (not while Space pans). Fires on panning tools too: a press may become a pan. */
  down?(e: OverviewPointer): void;
  /** Every pointer move over the stage. */
  move?(e: OverviewPointer): void;
  /** Release of a press this tool received, anywhere on the page. */
  up?(e: OverviewPointer): void;
  /** Drop any gesture in progress; true if one was dropped (Esc stops there). */
  cancel?(reason: OverviewToolCancel): boolean | undefined;
  /**
   * Right press (FR-OVW-16's menus). `true`: the tool took it. A function: runs on a release < 4 px
   * (the menu); ≥ 4 px starts the laser (FR-MAP-71 step 4). Otherwise the laser starts at once.
   */
  menu?(e: OverviewPointer): boolean | (() => void);
}

export interface OverviewToolDef {
  /** Unique; the tool store's value and the `ovw-tool-<id>` test ID. */
  id: string;
  label: string;
  icon: (props: { className?: string }) => unknown;
  clients: readonly CanvasClient[];
  order: number;
  /** The rail's hover hint per client. */
  hint?: Partial<Record<CanvasClient, string>>;
  /** A left-drag pans the stage (else only with Space or the middle button). */
  pans?: boolean;
  /** Off while the DM views an overview players don't see (ping and with it pull, laser). */
  signal?: boolean;
  /** Off while not live (FR-OVW-47): the add tools. */
  edits?: boolean;
  /** CSS cursor over the canvas (default: none if it pans, else `crosshair`). */
  cursor?: string;
  pointer?: OverviewPointerHandlers;
  panel?: () => unknown;
  layer?: () => unknown;
  overlay?: () => unknown;
}

const selectTool: OverviewToolDef = {
  id: SELECT_TOOL_ID,
  label: "Select",
  icon: MousePointer2Icon,
  clients: ["dm", "player"],
  order: 0,
  hint: {
    dm: "Click, Ctrl/Shift+click or Ctrl/Shift+drag to select; drag items, pan the map",
    player: "Drag to pan the map",
  },
  pans: true,
  pointer: selectPointer,
};

/** FR-OVW-22: the panel's button opens the picker; the canvas still pans under it. */
const addImageTool: OverviewToolDef = {
  id: "add-image",
  label: "Add image",
  icon: ImagePlusIcon,
  clients: ["dm"],
  order: 10,
  hint: { dm: "Place an image: a map, a scroll, a portrait" },
  pans: true,
  edits: true,
  panel: AddImagePanel,
};

/** FR-OVW-13: `map.ping` / `map.pull` with the overview's ID as `sceneId`. Shift = pull, DM only. */
export const pingTool: OverviewToolDef = {
  id: "ping",
  label: "Ping",
  icon: RadarIcon,
  clients: ["dm", "player"],
  order: 90,
  hint: {
    dm: "Click to ping, Shift+click to pull everyone's view, right-drag for the laser",
    player: "Click to ping, right-drag for the laser",
  },
  signal: true,
  pointer: {
    down(e) {
      if (!e.signalsLive) return;
      const pull = e.client === "dm" && e.shift;
      e.signal(pull ? MAP_SIGNALS.pull : MAP_SIGNALS.ping, {
        sceneId: e.overviewId,
        x: e.x,
        y: e.y,
      });
      e.markPing(e.x, e.y);
    },
  },
};

/** Validated, sorted copy; duplicate ids or orders throw at load. */
export function orderOverviewTools(tools: readonly OverviewToolDef[]): OverviewToolDef[] {
  if (new Set(tools.map((t) => t.id)).size !== tools.length) {
    throw new Error("Overview tool id registered twice");
  }
  if (new Set(tools.map((t) => t.order)).size !== tools.length) {
    throw new Error("Overview tool order used twice");
  }
  return [...tools].sort((a, b) => a.order - b.order);
}

export const overviewTools: readonly OverviewToolDef[] = orderOverviewTools([
  selectTool,
  addImageTool,
  pingTool,
]);

export const overviewToolsFor = (client: CanvasClient) =>
  overviewTools.filter((t) => t.clients.includes(client));

/** The active tool for a client: `id` if it has it, else Select. */
export function activeOverviewTool(id: string, client: CanvasClient): OverviewToolDef {
  return overviewToolsFor(client).find((t) => t.id === id) ?? selectTool;
}
