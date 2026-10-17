// `fog` canvas layer (order 30, FR-FOG-20/21; no new Konva layer): the shown scene's fog as one
// painted shape (`fog-mask`, `listening: false`, attrs `shapes`, `darkness`, `fogged-cells`,
// `explored-cells`, `fog-alpha`), clipped to the map; translucent for the DM. Players: their view
// (`vision-render.ts`: static fog with their explored memory, then sight, darkvision, seen-through
// darkness, or the blind screen) from their redacted `fog` record (darkness filtered, FR-FOG-44;
// no row → no fog) and their own `vision` / `fog-explored` rows. On the DM client also the View
// as P render (`fog-view-as`, attr `player`, at 70 %, FR-FOG-20 / -43), each darkness shape
// hatched (`fog-darkness`, id = darkness id, attr `selected`; a drag draws it at its offset), the
// Fog tool's draft (`fog-draft`, `fog-draft-vertex` with attr `free`, the circle's radius label)
// and the shown scene the fog bar acts on. Non-drawing markers `fog-vision` / `fog-explored`
// (attr `player`) carry the drawn rows: the player's own, the DM's View-as pair. Sprint 4: the
// DM's layer draws only with the Fog tool or the Layers "Fog" switch on (`fog-layer` attr
// `visible`, `plain-map.ts`); the View-as pick and its rows stay loaded meanwhile. Sight preview
// while dragging (FR-FOG-54, `sight-preview.ts`): the drawn `vision` takes the dragged source's
// previewed polygons; the `fog-vision` marker then carries them and attr `preview` (token ids).
// The brush's stroke drafts and cursor: `BrushNodes.tsx` (FR-FOG-55).
import { FOG_SIGNALS, FOG_TYPE, FogSightPayload } from "@shared/fog-of-war/schemas";
import type { DarknessShape } from "@shared/fog-of-war/shapes";
import { samePair, type ViewAsPair } from "@shared/protocol/scene-window";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Line, Rect, Shape, Text } from "react-konva";
import { useStore } from "zustand";
import { IntentRejected } from "../../sync/connection";
import { useSignal, useSync } from "../../sync/store";
import { diagonalRuleIn } from "../scene-tools/diagonal-rule";
import { useCanvas } from "../scenes-map/canvas-context";
import { toastReject } from "../scenes-map/intents";
import type { CanvasClient } from "../scenes-map/layers";
import { useLayerToggles } from "../scenes-map/tool-store";
import { BrushNodes } from "./BrushNodes";
import { type FogDraft, type GestureState, radiusLabel } from "./gesture";
import { fogLayerShown } from "./plain-map";
import {
  DM_DARKNESS_FALLBACK,
  FOG_ALPHA,
  FOG_COLOR_FALLBACK,
  FOG_COLOR_VARS,
  type FogRecordLike,
  fogStats,
  ownFogRows,
  type PaintCtx,
  paintDarknessDm,
  paintFog,
} from "./render";
import {
  clearRemote,
  createSightPreviewStore,
  followDrags,
  followProbe,
  previewList,
  previewVision,
  receiveSight,
} from "./sight-preview";
import { FOG_TOOL_ID, fogRecordOf, setFogReader, useFogTool } from "./store";
import { pairRows, setViewAs, shownPair, useViewAs } from "./view-as";
import {
  DARKNESS_SEEN_FALLBACK,
  DARKVISION_FALLBACK,
  type GridLines,
  memoryRuns,
  paintPlayerView,
  VIEW_AS_OPACITY,
  VISION_ALPHA,
  VISION_COLOR_VARS,
  type ViewPaints,
} from "./vision-render";

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function paintsFor(client: CanvasClient): ViewPaints {
  const v = FOG_COLOR_VARS[client];
  const a = FOG_ALPHA[client];
  const dark = client === "dm" ? DM_DARKNESS_FALLBACK : FOG_COLOR_FALLBACK;
  return {
    fog: { color: cssVar(v.fog) || FOG_COLOR_FALLBACK, alpha: a.fog },
    explored: { color: cssVar(v.explored) || FOG_COLOR_FALLBACK, alpha: a.explored },
    darkness: { color: cssVar(v.darkness) || dark, alpha: a.darkness },
    darkvision: {
      color: cssVar(VISION_COLOR_VARS.darkvision) || DARKVISION_FALLBACK,
      alpha: VISION_ALPHA.darkvision,
    },
    darknessSeen: {
      color: cssVar(VISION_COLOR_VARS.darknessSeen) || DARKNESS_SEEN_FALLBACK,
      alpha: VISION_ALPHA.darknessSeen,
    },
  };
}

function Draft({
  draft,
  pending,
}: {
  draft: Exclude<FogDraft, { kind: "brush" }>;
  pending: boolean;
}) {
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
  paints: ViewPaints;
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

/** Browser canvas used to draw the View-as render isolated (its erases must not cut the DM's). */
let scratch: HTMLCanvasElement | null = null;

/**
 * FR-FOG-20: paints into a scratch canvas with the same transform, then draws it over `ctx` at
 * `alpha` (the active clip applies), so the player's painter erases only its own pixels.
 */
function drawIsolated(ctx: CanvasRenderingContext2D, alpha: number, paint: (c: PaintCtx) => void) {
  const { width, height } = ctx.canvas;
  if (width === 0 || height === 0) return;
  scratch ??= document.createElement("canvas");
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const o = scratch.getContext("2d");
  if (!o) return;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "source-over";
  o.globalAlpha = 1;
  o.clearRect(0, 0, width, height);
  o.setTransform(ctx.getTransform());
  paint(o as unknown as PaintCtx);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/**
 * FR-FOG-43, DM: keeps the connection's one loaded `(sceneId, playerId)` pair in step with the
 * View as pick and the shown scene (a new pick or scene loads the new pair; "DM" drops it; a
 * snapshot resets it and this loads it again). A reject → Toast and View as back to "DM".
 * Returns the pair to draw (loaded and matching), else null.
 */
function useViewAsSync(client: CanvasClient, sceneId: string): ViewAsPair | null {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const loaded = useSync((s) => s.viewAs.loaded);
  const loading = useSync((s) => s.viewAs.loading);
  const playerId = useViewAs((s) => s.playerId);
  const dm = client === "dm";
  const pair = dm ? shownPair(loaded, playerId, sceneId) : null;
  useEffect(() => {
    if (!dm) return;
    if (!samePair(useViewAs.getState().loaded, pair)) useViewAs.setState({ loaded: pair });
  }, [dm, pair]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a snapshot reset (`loaded` / `loading` back to null) loads again.
  useEffect(() => {
    if (!dm) return;
    if (playerId === null) {
      connection.clearViewAs();
      return;
    }
    if (!live) return;
    connection.loadViewAs(sceneId, playerId)?.catch((err: unknown) => {
      // Dropped connection: the next snapshot resets the pair and this loads it again.
      if (err instanceof IntentRejected && (err.code === "disconnected" || err.code === "offline"))
        return;
      toastReject(err);
      if (useViewAs.getState().playerId === playerId) setViewAs(null);
    });
  }, [dm, connection, live, sceneId, playerId, loaded, loading]);
  // Leaving the DM canvas keeps the pick; the pair follows the next shown scene.
  return pair;
}

/**
 * FR-FOG-54: the sight previews of this canvas (own drag from the probe, others' `fog.sight`
 * beside their drag preview) applied to the drawn `vision`; a `vision` change mid-drag re-probes.
 */
function useSightPreview<V extends Parameters<typeof previewVision>[0]>(vision: V) {
  const { scene, probe, previews, tokens, live } = useCanvas();
  const [sight] = useState(createSightPreviewStore);
  useEffect(() => followProbe(sight, probe), [sight, probe]);
  useEffect(() => followDrags(sight, previews), [sight, previews]);
  useEffect(() => {
    if (!live) clearRemote(sight);
  }, [sight, live]);
  useSignal(FOG_SIGNALS.sight, (s) => {
    const d = FogSightPayload.safeParse(s.data);
    if (!d.success) return;
    receiveSight(sight, d.data, {
      sceneId: scene.id,
      previewing: (id) => id in previews.getState().previews,
    });
  });
  // FR-FOG-54: a `vision` change for the drawn player mid-drag re-sends the current cell.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new `vision` record.
  useEffect(() => {
    if (probe.current()) probe.recheck();
  }, [probe, vision]);
  const st = useStore(sight);
  return useMemo(() => {
    const owners = new Map(tokens.map((t) => [t.id, t.ownerPlayerId]));
    return previewVision(
      vision,
      previewList(st, (id) => owners.get(id)),
    );
  }, [vision, st, tokens]);
}

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
  const pair = useViewAsSync(client, scene.id);
  // Whose `vision` / `fog-explored` rows draw: the player's own; the DM's View-as pair.
  const viewer = client === "player" ? myPlayerId : (pair?.playerId ?? null);
  const own = useMemo(
    () => ownFogRows(store.records, scene.id, viewer),
    [store.records, scene.id, viewer],
  );
  const rows = useMemo(
    () =>
      viewer === null ? null : pairRows(store.records, { sceneId: scene.id, playerId: viewer }),
    [store.records, scene.id, viewer],
  );
  const memory = useMemo(() => memoryRuns(rows?.explored ?? null, map), [rows, map]);
  const preview = useSightPreview(rows?.vision ?? null);
  const paints = useMemo(() => paintsFor(client), [client]);
  const playerPaints = useMemo(() => paintsFor("player"), []);
  const gridLines: GridLines = {
    visible: grid.gridVisible,
    color: grid.gridColor,
    opacity: grid.gridOpacity,
    width: hairline,
  };
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
    if (client === "dm")
      setFogReader(
        (id) => fogRecordOf(records.current, id),
        () => diagonalRuleIn(records.current),
      );
  }, [client]);
  const gesture = useFogTool((s) => s.gesture);
  const toolOn = client === "dm" && activeTool?.id === FOG_TOOL_ID;
  const drafting = toolOn && gesture.draft !== null;
  // FR-FOG-20 (sprint 4): the plain battlemap for the DM outside the Fog tool.
  const off = useLayerToggles((s) => s.off);
  const shown = fogLayerShown(client, toolOn, off);
  const view = (r: FogRecordLike) => ({ fog: r, memory, vision: preview.vision });
  const marker = own.vision && {
    ...own.vision,
    ...(preview.applied.length > 0
      ? { see: preview.vision?.see, dark: preview.vision?.dark, preview: preview.applied.join(",") }
      : {}),
  };
  return (
    <Group name="fog-layer" listening={false} visible={shown}>
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
            sceneFunc={(kctx) => {
              const ctx = kctx._context as unknown as PaintCtx;
              if (client === "player") paintPlayerView(ctx, view(rec), map, paints, gridLines);
              else paintFog(ctx, rec, map, client, paints, hairline);
            }}
          />
          {client === "dm" && pair && (
            // FR-FOG-20: View as P, P's render (FR-FOG-21) at 70 % over the DM view.
            <Shape
              name="fog-view-as"
              player={pair.playerId}
              perfectDrawEnabled={false}
              sceneFunc={(kctx) =>
                drawIsolated(kctx._context, VIEW_AS_OPACITY, (ctx) =>
                  paintPlayerView(ctx, view(rec), map, playerPaints, gridLines),
                )
              }
            />
          )}
          {client === "dm" && (
            <DmDarkness
              darkness={rec.darkness ?? []}
              gesture={toolOn ? gesture : { ...gesture, selected: null, move: null }}
              paints={paints}
            />
          )}
        </Group>
      )}
      {drafting && gesture.draft && gesture.draft.kind !== "brush" && (
        <Draft draft={gesture.draft} pending={gesture.pending} />
      )}
      {toolOn && <BrushNodes gesture={gesture} />}
      {/* FOG §7 markers (draw nothing): the viewer's vision and explored memory. */}
      {marker && <Shape name="fog-vision" player={viewer} {...marker} sceneFunc={noDraw} />}
      {own.explored && (
        <Shape name="fog-explored" player={viewer} cells={own.explored.cells} sceneFunc={noDraw} />
      )}
    </Group>
  );
}
