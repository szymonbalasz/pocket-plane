// FR-MAP-121: the footprint a Teleport would land on (`map-teleport-target`, attrs `col`, `row`),
// DM only, while the cell pick runs.
import { cellToPx, footprint } from "@shared/scenes-map/geometry";
import { Group, Rect } from "react-konva";
import { useCanvas } from "../canvas-context";
import { TELEPORT_TOOL_ID, useTeleportPick } from "../teleport-tool";

export function TeleportPickLayer() {
  const { activeTool, grid, cam, colors } = useCanvas();
  const token = useTeleportPick((s) => s.token);
  const hover = useTeleportPick((s) => s.hover);
  if (activeTool?.id !== TELEPORT_TOOL_ID || !token || !hover) return <Group listening={false} />;
  const side = footprint(token.size) * grid.gridCellSize;
  const { x, y } = cellToPx(grid, hover.col, hover.row);
  return (
    <Group listening={false}>
      <Rect
        name="map-teleport-target"
        col={hover.col}
        row={hover.row}
        x={x}
        y={y}
        width={side}
        height={side}
        fill={colors.primary}
        opacity={0.35}
        stroke={colors.primary}
        strokeWidth={2 / cam.scale}
      />
    </Group>
  );
}
