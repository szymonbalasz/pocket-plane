// Teleport's cell pick (FR-MAP-121), DM: a drawing tool off the rail, picked by the token menu.
// The next left press on the map sends `map.teleportToken` for the token (its footprint's top-left
// on the pressed cell, as a drop) and goes back to the tool in use before. Its own cell or off the
// map: keeps picking. Esc, Cancel, leaving `live` or another scene drop the pick. Space and the
// middle mouse still pan (FR-SCN-06). Which token sits on the cell doesn't matter: the DM decides.
// The same pick places a token's mirror (`mirror`, FR-MIR-01): `mir.create` instead of the jump.
import { overlapsMap } from "@shared/scenes-map/geometry";
import { MAP_INTENTS, type TokenRecord, type TokenView } from "@shared/scenes-map/schemas";
import { MIR_INTENTS } from "@shared/token-mirrors/schemas";
import { WandSparklesIcon } from "lucide-react";
import { create } from "zustand";
import { Button } from "../../components/ui/button";
import { toastReject } from "./intents";
import { useMapTool } from "./tool-store";
import type { CanvasToolDef, ToolCancelReason, ToolPointer } from "./tools";

export const TELEPORT_TOOL_ID = "teleport";

type PickToken = Pick<TokenRecord | TokenView, "id" | "name" | "size" | "col" | "row">;

interface TeleportPick {
  /** The token being teleported; null when no pick runs. */
  token: PickToken | null;
  /** The tool to go back to. */
  returnTo: string;
  /** The cell under the pointer (the target footprint's top-left), if a valid one. */
  hover: { col: number; row: number } | null;
  /** FR-MIR-01: the click places a mirror of the token instead of moving it. */
  mirror: boolean;
}

const IDLE: TeleportPick = { token: null, returnTo: "select", hover: null, mirror: false };

export const useTeleportPick = create<TeleportPick>(() => IDLE);

/** The token menu entry: starts picking a cell for `token`. */
export function startTeleport(token: PickToken, mirror = false): void {
  const { tool, setTool } = useMapTool.getState();
  const { returnTo } = useTeleportPick.getState();
  useTeleportPick.setState({
    token,
    returnTo: tool === TELEPORT_TOOL_ID ? returnTo : tool,
    hover: null,
    mirror,
  });
  setTool(TELEPORT_TOOL_ID);
}

/** The token menu's Mirror entry (FR-MIR-01). */
export const startMirrorPick = (token: PickToken): void => startTeleport(token, true);

/** Ends the pick and returns to the previous tool. */
export function endTeleport(): void {
  const { returnTo } = useTeleportPick.getState();
  useTeleportPick.setState(IDLE);
  const { tool, setTool } = useMapTool.getState();
  if (tool === TELEPORT_TOOL_ID) setTool(returnTo);
}

/** The cell a pointer event may teleport to, or null (off the map, or the token's own cell). */
export function teleportTarget(
  token: PickToken,
  e: Pick<ToolPointer, "cell" | "scene" | "grid">,
): { col: number; row: number } | null {
  const { col, row } = e.cell;
  if (col === token.col && row === token.row) return null;
  const map = { ...e.grid, mapWidth: e.scene.mapWidth, mapHeight: e.scene.mapHeight };
  return overlapsMap(map, col, row, token.size) ? { col, row } : null;
}

function TeleportPanel() {
  const name = useTeleportPick((s) => s.token?.name);
  const mirror = useTeleportPick((s) => s.mirror);
  if (name === undefined) return null;
  return (
    <div
      data-testid={mirror ? "mir-pick-panel" : "map-teleport-panel"}
      className="flex items-center gap-2 text-sm"
    >
      <span className="max-w-64 truncate">
        {mirror ? "Mirror" : "Teleport"} {name}: click a cell
      </span>
      <Button
        size="sm"
        variant="ghost"
        data-testid={mirror ? "mir-pick-cancel" : "map-teleport-cancel"}
        onClick={() => endTeleport()}
      >
        Cancel
      </Button>
    </div>
  );
}

export const teleportTool: CanvasToolDef = {
  id: TELEPORT_TOOL_ID,
  label: "Teleport",
  icon: WandSparklesIcon,
  clients: ["dm"],
  order: 90,
  offRail: true,
  panel: TeleportPanel,
  pointer: {
    down(e) {
      const { token, mirror } = useTeleportPick.getState();
      if (!token) return endTeleport();
      const to = teleportTarget(token, e);
      if (!to) return;
      endTeleport();
      const name = mirror ? MIR_INTENTS.create : MAP_INTENTS.teleportToken;
      e.intent(name, { tokenId: token.id, ...to }).catch(toastReject);
    },
    move(e) {
      const { token, hover } = useTeleportPick.getState();
      if (!token) return;
      const next = teleportTarget(token, e);
      if (next?.col !== hover?.col || next?.row !== hover?.row) {
        useTeleportPick.setState({ hover: next });
      }
    },
    cancel(reason: ToolCancelReason) {
      if (!useTeleportPick.getState().token) return false;
      // "tool": another tool is already picked, so there is nothing to go back to.
      if (reason === "tool") useTeleportPick.setState(IDLE);
      else endTeleport();
      return true;
    },
  },
};
