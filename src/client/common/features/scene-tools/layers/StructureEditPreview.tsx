// Structure tool previews on `scn-edit` (FR-SCN-02, -08), while the tool is active: the snapped
// hover vertex (`scn-edit-vertex`), the polyline / door in progress to the hover
// (`scn-edit-polyline`, attr `count` = clicked vertices), the erase target (`scn-edit-erase`) and
// box (`scn-edit-box`).
import { vertexToPx } from "@shared/scene-tools/geometry";
import { Circle, Group, Line, Rect } from "react-konva";
import { useStore } from "zustand";
import { useCanvas } from "../../scenes-map/canvas-context";
import { structureTool } from "../structure-store";
import { segmentPx } from "../structure-view";
import { useShownStructure } from "./StructureLayer";

export function StructureEditPreview() {
  const { activeTool, grid, cam, colors } = useCanvas();
  const st = useStore(structureTool);
  const view = useShownStructure();
  if (activeTool?.id !== "structure") return null;
  const px = (v: { x: number; y: number }) => vertexToPx(grid, v);
  const path = st.mode === "erase" ? [] : [...st.points, ...(st.hover ? [st.hover] : [])];
  const line = path.flatMap((v) => {
    const p = px(v);
    return [p.x, p.y];
  });
  const sw = 2 / cam.scale;
  const erase = (() => {
    if (st.hoverN === null) return null;
    const w = view.walls.find((x) => x[0] === st.hoverN);
    const d = view.doors.find((x) => x.n === st.hoverN);
    const seg = w ? ([w[1], w[2], w[3], w[4]] as const) : d?.seg;
    return seg ? segmentPx(grid, [...seg] as [number, number, number, number]) : null;
  })();
  return (
    <Group name="scn-edit-structure" listening={false}>
      {line.length >= 4 && (
        <Line
          name="scn-edit-polyline"
          points={line}
          count={st.points.length}
          stroke={colors.primary}
          strokeWidth={sw * 1.5}
          dash={[6 / cam.scale, 4 / cam.scale]}
        />
      )}
      {st.mode !== "erase" && st.hover && (
        <Circle
          name="scn-edit-vertex"
          {...px(st.hover)}
          radius={5 / cam.scale}
          fill={colors.primary}
        />
      )}
      {erase && (
        <Line
          name="scn-edit-erase"
          points={erase}
          stroke={colors.destructive}
          strokeWidth={sw * 3}
          lineCap="round"
        />
      )}
      {st.box && (
        <Rect
          name="scn-edit-box"
          x={Math.min(st.box.x0, st.box.x1)}
          y={Math.min(st.box.y0, st.box.y1)}
          width={Math.abs(st.box.x1 - st.box.x0)}
          height={Math.abs(st.box.y1 - st.box.y0)}
          stroke={colors.destructive}
          strokeWidth={sw}
          dash={[4 / cam.scale, 4 / cam.scale]}
        />
      )}
    </Group>
  );
}
