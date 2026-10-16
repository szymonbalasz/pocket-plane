// `fog` canvas layer (order 30, FR-FOG-20/21; no new Konva layer): the shown scene's static fog
// as one painted shape (`fog-mask`, `listening: false`, attrs `shapes`, `darkness`,
// `fogged-cells`, `explored-cells`, `fog-alpha`), clipped to the map; translucent for the DM,
// opaque for players. On the DM client also each darkness shape, hatched (`fog-darkness`, id =
// darkness id, attr `selected`; a drag draws it at its offset), the Fog tool's draft
// (`fog-draft`, `fog-draft-vertex` with attr `free`, the circle's radius label) and the shown
// scene the fog bar acts on. Players: from their redacted `fog` record (darkness filtered,
// FR-FOG-44; no row → no fog), plus non-drawing markers `fog-vision` / `fog-explored` from their
// own rows (V2 writes them; V3 draws vision).
import { FOG_TYPE } from "@shared/fog-of-war/schemas";
import type { DarknessShape } from "@shared/fog-of-war/shapes";
import { useEffect, useMemo, useRef } from "react";
import { Circle, Group, Layer, Line, Rect, Shape, Text } from "react-konva";
import { useCanvas } from "../scenes-map/canvas-context";
import type { CanvasClient } from "../scenes-map/layers";
import { type FogDraft, type GestureState, radiusLabel } from "./gesture";
import {
  DM_DARKNESS_FALLBACK,
  FOG_ALPHA,
  FOG_COLOR_FALLBACK,
  FOG_COLOR_VARS,
  type FogPaints,
  type FogRecordLike,
  fogStats,
  ownFogRows,
  type PaintCtx,
  paintDarknessDm,
  paintFog,
} from "./render";
import { FOG_TOOL_ID, fogRecordOf, setFogReader, useFogTool } from "./store";

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function paintsFor(client: CanvasClient): FogPaints {
  const v = FOG_COLOR_VARS[client];
  const a = FOG_ALPHA[client];
  const dark = client === "dm" ? DM_DARKNESS_FALLBACK : FOG_COLOR_FALLBACK;
  return {
    fog: { color: cssVar(v.fog) || FOG_COLOR_FALLBACK, alpha: a.fog },
    explored: { color: cssVar(v.explored) || FOG_COLOR_FALLBACK, alpha: a.explored },
    darkness: { color: cssVar(v.darkness) || dark, alpha: a.darkness },
  };
}

function Draft({ draft, pending }: { draft: FogDraft; pending: boolean }) {
  const { grid, cam, colors } = useCanvas();
  const cs = grid.gridCellSize;
  const X = (i: number) => grid.gridOffsetX + i * cs;
  const Y = (j: number) => grid.gridOffsetY + j * cs;
  const stroke = colors.primary;
  const strokeWidth = 2 / cam.scale;
  const mode = useFogTool((s) => s.mode);
  if (draft.kind === "rect") {
    const [x0, x1] = [Math.min(draft.a[0], draft.b[0]), Math.max(draft.a[0], draft.b[0])];
    const [y0, y1] = [Math.min(draft.a[1], draft.b[1]), Math.max(draft.a[1], draft.b[1])];
    return (
      <Rect
        name="fog-draft"
        kind="rect"
        op={mode}
        pending={pending}
        free={draft.free}
        shape={[x0, y0, x1, y1]}
        x={X(x0)}
        y={Y(y0)}
        width={(x1 - x0) * cs}
        height={(y1 - y0) * cs}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={stroke}
        fillAfterStrokeEnabled
        opacity={0.35}
      />
    );
  }
  if (draft.kind === "circle") {
    const label = radiusLabel(draft.r, draft.free);
    return (
      <Group
        name="fog-draft"
        kind="circle"
        op={mode}
        pending={pending}
        free={draft.free}
        shape={[draft.c[0], draft.c[1], draft.r]}
        label={label}
      >
        <Circle
          x={X(draft.c[0])}
          y={Y(draft.c[1])}
          radius={draft.r * cs}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={stroke}
          opacity={0.35}
        />
        {!pending && (
          <Text
            name="fog-draft-label"
            text={label}
            x={X(draft.c[0]) + 6 / cam.scale}
            y={Y(draft.c[1]) - draft.r * cs - 18 / cam.scale}
            fontSize={13 / cam.scale}
            fill={stroke}
          />
        )}
      </Group>
    );
  }
  const pts = draft.points.flatMap((v) => [X(v.p[0]), Y(v.p[1])]);
  const band = !pending && draft.hover ? [X(draft.hover[0]), Y(draft.hover[1])] : [];
  return (
    <Group name="fog-draft" kind="polygon" op={mode} pending={pending}>
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
        draft.points.map((v, k) => (
          <Circle
            // biome-ignore lint/suspicious/noArrayIndexKey: a vertex is its index (test id `id`).
            key={k}
            name="fog-draft-vertex"
            id={String(k)}
            free={v.free}
            at={[v.p[0], v.p[1]]}
            x={X(v.p[0])}
            y={Y(v.p[1])}
            radius={(k === 0 ? 6 : 4) / cam.scale}
            fill={k === 0 ? stroke : colors.background}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ))}
    </Group>
  );
}

/** FR-FOG-20 / -42: the DM's hatched darkness shapes; the selected one outlined, a drag offset. */
function DmDarkness({
  darkness,
  gesture,
  paints,
}: {
  darkness: readonly DarknessShape[];
  gesture: GestureState;
  paints: FogPaints;
}) {
  const { grid, cam, colors } = useCanvas();
  const hairline = 1 / cam.scale;
  return (
    <>
      {darkness.map((d) => {
        const mv = gesture.move?.id === d.id ? gesture.move : null;
        const selected = gesture.selected === d.id;
        return (
          <Shape
            key={d.id}
            name="fog-darkness"
            id={d.id}
            selected={selected}
            dx={mv?.dx ?? 0}
            dy={mv?.dy ?? 0}
            perfectDrawEnabled={false}
            sceneFunc={(kctx) => {
              const ctx = kctx._context as unknown as PaintCtx;
              paintDarknessDm(ctx, d, grid, paints.darkness, hairline, mv?.dx, mv?.dy);
              if (!selected) return;
              ctx.save();
              ctx.globalAlpha = 1;
              ctx.strokeStyle = colors.primary;
              ctx.lineWidth = 2 * hairline;
              ctx.beginPath();
              shapeOutline(ctx, d, grid, mv?.dx ?? 0, mv?.dy ?? 0);
              ctx.stroke();
              ctx.restore();
            }}
          />
        );
      })}
    </>
  );
}

/** The selected shape's outline (`shapePath` without the fill rules). */
function shapeOutline(
  ctx: PaintCtx,
  d: DarknessShape,
  grid: { gridCellSize: number; gridOffsetX: number; gridOffsetY: number },
  dx: number,
  dy: number,
) {
  const cs = grid.gridCellSize;
  const X = (x: number) => grid.gridOffsetX + (x + dx) * cs;
  const Y = (y: number) => grid.gridOffsetY + (y + dy) * cs;
  if ("circle" in d) {
    const [cx, cy, r] = d.circle;
    ctx.moveTo(X(cx) + r * cs, Y(cy));
    ctx.arc(X(cx), Y(cy), r * cs, 0, 2 * Math.PI);
    return;
  }
  const pts: number[] =
    "rect" in d
      ? [d.rect[0], d.rect[1], d.rect[2], d.rect[1], d.rect[2], d.rect[3], d.rect[0], d.rect[3]]
      : d.polygon;
  ctx.moveTo(X(pts[0] as number), Y(pts[1] as number));
  for (let i = 2; i + 1 < pts.length; i += 2)
    ctx.lineTo(X(pts[i] as number), Y(pts[i + 1] as number));
  ctx.closePath();
}

const noDraw = () => {};

export function FogLayer() {
  const { client, scene, grid, store, activeTool, cam, myPlayerId } = useCanvas();
  const hairline = 1 / cam.scale;
  const rec = (store.records[FOG_TYPE]?.[scene.id] ?? null) as FogRecordLike | null;
  const { mapWidth, mapHeight } = scene;
  const { gridCellSize, gridOffsetX, gridOffsetY } = grid;
  const map = useMemo(
    () => ({ mapWidth, mapHeight, gridCellSize, gridOffsetX, gridOffsetY }),
    [mapWidth, mapHeight, gridCellSize, gridOffsetX, gridOffsetY],
  );
  const stats = useMemo(() => fogStats(rec, map), [rec, map]);
  const own = useMemo(
    () => ownFogRows(store.records, scene.id, client === "player" ? myPlayerId : null),
    [store.records, scene.id, client, myPlayerId],
  );
  const paints = useMemo(() => paintsFor(client), [client]);
  // The fog bar acts on the scene this DM canvas shows (FR-FOG-17, FR-MAP-08).
  useEffect(() => {
    if (client !== "dm") return;
    useFogTool.setState({ sceneId: scene.id });
    return () => {
      if (useFogTool.getState().sceneId === scene.id) useFogTool.setState({ sceneId: null });
    };
  }, [client, scene.id]);
  // Darkness hit tests read the latest record (FR-FOG-42).
  const records = useRef(store.records);
  records.current = store.records;
  useEffect(() => {
    if (client === "dm") setFogReader((id) => fogRecordOf(records.current, id));
  }, [client]);
  const gesture = useFogTool((s) => s.gesture);
  const toolOn = client === "dm" && activeTool?.id === FOG_TOOL_ID;
  const drafting = toolOn && gesture.draft !== null;
  return (
    <Layer name="fog-layer" listening={false}>
      {rec && (
        <Group clipX={0} clipY={0} clipWidth={mapWidth} clipHeight={mapHeight}>
          <Shape
            name="fog-mask"
            fog-alpha={paints.fog.alpha}
            shapes={stats.shapes}
            darkness={stats.darkness}
            fogged-cells={stats.fogged}
            explored-cells={stats.explored}
            perfectDrawEnabled={false}
            sceneFunc={(kctx) =>
              paintFog(kctx._context as unknown as PaintCtx, rec, map, client, paints, hairline)
            }
          />
          {client === "dm" && (
            <DmDarkness
              darkness={rec.darkness ?? []}
              gesture={toolOn ? gesture : { ...gesture, selected: null, move: null }}
              paints={paints}
            />
          )}
        </Group>
      )}
      {drafting && gesture.draft && <Draft draft={gesture.draft} pending={gesture.pending} />}
      {/* FOG §7 markers (draw nothing): the player's own vision and explored memory. */}
      {own.vision && <Shape name="fog-vision" {...own.vision} sceneFunc={noDraw} />}
      {own.explored && <Shape name="fog-explored" cells={own.explored.cells} sceneFunc={noDraw} />}
    </Layer>
  );
}
