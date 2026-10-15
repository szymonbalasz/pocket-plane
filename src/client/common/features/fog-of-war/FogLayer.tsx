// `fog` canvas layer (order 30, FR-FOG-20/21): the shown scene's fogged cells as one shape of
// row-run rects (`fog-mask`, `listening: false`), clipped to the map; translucent for the DM. On the
// DM client also the Fog tool's draft (`fog-draft`, `fog-draft-vertex`) and the shown scene the fog
// bar acts on. Players: opaque, from their redacted `fog` record (FR-FOG-21); no row → no fog.
import { FOG_TYPE } from "@shared/fog-of-war/schemas";
import { useEffect, useMemo } from "react";
import { Circle, Group, Layer, Line, Rect, Shape } from "react-konva";
import { useCanvas } from "../scenes-map/canvas-context";
import type { FogDraft } from "./gesture";
import {
  FOG_COLOR_FALLBACK,
  FOG_COLOR_VARS,
  type FogRecordLike,
  fogOpacity,
  fogRuns,
} from "./render";
import { FOG_TOOL_ID, useFogTool } from "./store";

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function Draft({ draft, pending }: { draft: FogDraft; pending: boolean }) {
  const { grid, cam, colors } = useCanvas();
  const cs = grid.gridCellSize;
  const px = (i: number, j: number) => [grid.gridOffsetX + i * cs, grid.gridOffsetY + j * cs];
  const stroke = colors.primary;
  const strokeWidth = 2 / cam.scale;
  const op = useFogTool((s) => s.op);
  if (draft.kind === "rect") {
    const c = Math.min(draft.c0, draft.c1);
    const r = Math.min(draft.r0, draft.r1);
    const [x, y] = px(c, r) as [number, number];
    return (
      <Rect
        name="fog-draft"
        kind="rect"
        op={op}
        pending={pending}
        x={x}
        y={y}
        width={(Math.abs(draft.c1 - draft.c0) + 1) * cs}
        height={(Math.abs(draft.r1 - draft.r0) + 1) * cs}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={stroke}
        fillAfterStrokeEnabled
        opacity={0.35}
      />
    );
  }
  const pts = draft.points.flatMap(([i, j]) => px(i, j));
  const band = !pending && draft.hover ? px(draft.hover[0], draft.hover[1]) : [];
  return (
    <Group name="fog-draft" kind="polygon" op={op} pending={pending}>
      <Line
        points={[...pts, ...band]}
        closed={pending}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={pending ? stroke : undefined}
        opacity={pending ? 0.35 : 0.9}
        lineJoin="round"
      />
      {!pending &&
        draft.points.map(([i, j], k) => {
          const [x, y] = px(i, j) as [number, number];
          return (
            <Circle
              // biome-ignore lint/suspicious/noArrayIndexKey: a corner is its index (test id `id`).
              key={k}
              name="fog-draft-vertex"
              id={String(k)}
              x={x}
              y={y}
              radius={(k === 0 ? 6 : 4) / cam.scale}
              fill={k === 0 ? stroke : colors.background}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          );
        })}
    </Group>
  );
}

export function FogLayer() {
  const { client, scene, grid, store, activeTool } = useCanvas();
  const rec = (store.records[FOG_TYPE]?.[scene.id] ?? null) as FogRecordLike | null;
  const { mapWidth, mapHeight } = scene;
  const { gridCellSize, gridOffsetX, gridOffsetY } = grid;
  const render = useMemo(
    () => fogRuns(rec, { mapWidth, mapHeight, gridCellSize, gridOffsetX, gridOffsetY }),
    [rec, mapWidth, mapHeight, gridCellSize, gridOffsetX, gridOffsetY],
  );
  const fill = useMemo(() => cssVar(FOG_COLOR_VARS[client]) || FOG_COLOR_FALLBACK, [client]);
  // The fog bar acts on the scene this DM canvas shows (FR-FOG-17, FR-MAP-08).
  useEffect(() => {
    if (client !== "dm") return;
    useFogTool.setState({ sceneId: scene.id });
    return () => {
      if (useFogTool.getState().sceneId === scene.id) useFogTool.setState({ sceneId: null });
    };
  }, [client, scene.id]);
  const gesture = useFogTool((s) => s.gesture);
  const drafting = client === "dm" && activeTool?.id === FOG_TOOL_ID && gesture.draft !== null;
  return (
    <Layer name="fog-layer" listening={false}>
      {rec && (
        <Group clipX={0} clipY={0} clipWidth={mapWidth} clipHeight={mapHeight}>
          <Shape
            name="fog-mask"
            fill={fill}
            opacity={fogOpacity(client)}
            fogged-cells={render.cells}
            perfectDrawEnabled={false}
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              for (const [x, y, w, h] of render.runs) ctx.rect(x, y, w, h);
              ctx.fillShape(shape);
            }}
          />
        </Group>
      )}
      {drafting && gesture.draft && <Draft draft={gesture.draft} pending={gesture.pending} />}
    </Layer>
  );
}
