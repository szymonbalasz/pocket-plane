// Drag paths and combat trails (FR-MAP-52–55), drawn inside the tokens layer below every token
// (no new Konva layer, FR-MAP-29). Live paths: this client's drag (`pointers.drag`) and each
// remote preview (start = the token's cell, target = `dropCell` of the preview), for the tokens
// `pathShown` allows; per step the footprint cells tinted (25 %), a line through the step centres
// and a dot, all in the **token owner's** player colour (no owner: the DM's; FR-MAP-70, OQ-MAP-52
// A), line and dots over a dark casing (FR-MAP-72). The dragging player's part past the first wall
// crossing is dashed in `destructive` (the wall hint in the probe's ack). Trails (opacity 0.4)
// under the live paths, drawn from each held token's stored `trail` (sprint 5, FR-MAP-67) in the
// same owner colour, derived at draw time (nothing stored; FR-MAP-73 recolours).
// Konva: `map-drag-path` (id = token id; attrs `cells`, `blocked`, `preview` = local | remote,
// `color`, `by`), `map-drag-trail` (id = token id; attrs `segments` = cells − 1, `cells` = the
// stored cells, `color`, `by`), `map-casing` (id = token id) under each line and dot.

import type { Segment } from "@shared/scene-tools/schemas";
import { cellToPx, dragPath, dropCell, footprint } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { useEffect, useMemo, useState } from "react";
import { Circle, Group, Line, Rect } from "react-konva";
import { useStore } from "zustand";
import { subscribeWallHint } from "../../scene-tools/wall-hint";
import { useCanvas } from "../canvas-context";
import {
  type Cell,
  cellsAttr,
  ownDragBlocked,
  pathFootprint,
  pathPaint,
  pathShown,
  trailCellsAttr,
  trailSegments,
} from "../drag-path";
import { CASING_COLOR, CASING_EXTRA_PX, CASING_NAME, casingWidth } from "../mark-colors";

/** Path tint (FR-MAP-52) and trail opacity (FR-MAP-54, -67). */
const TINT = 0.25;
const TRAIL_OPACITY = 0.4;

/** One straight path: tinted footprint cells, the centre line, a dot per step. */
function PathMarks({
  id,
  path,
  n,
  blocked,
  color,
}: {
  id: string;
  path: readonly Cell[];
  n: number;
  blocked: number;
  color: string;
}) {
  const { grid, cam, colors } = useCanvas();
  const cell = grid.gridCellSize;
  const centre = (c: Cell) => {
    const p = cellToPx(grid, c.col, c.row);
    return [p.x + (n * cell) / 2, p.y + (n * cell) / 2];
  };
  const cut = blocked < 0 ? path.length : blocked;
  const clear = path.slice(0, cut);
  const past = blocked < 0 ? [] : path.slice(blocked);
  const pastCells = pathFootprint(past, n);
  const pastKeys = new Set(pastCells.map((c) => `${c.col},${c.row}`));
  const clearCells = pathFootprint(clear, n).filter((c) => !pastKeys.has(`${c.col},${c.row}`));
  const width = 2 / cam.scale;
  const dot = 3 / cam.scale;
  return (
    <>
      {clearCells.map((c) => (
        <Rect
          key={`c${c.col},${c.row}`}
          {...cellToPx(grid, c.col, c.row)}
          width={cell}
          height={cell}
          fill={color}
          opacity={TINT}
        />
      ))}
      {pastCells.map((c) => (
        <Rect
          key={`p${c.col},${c.row}`}
          {...cellToPx(grid, c.col, c.row)}
          width={cell}
          height={cell}
          fill={colors.destructive}
          opacity={TINT}
        />
      ))}
      {clear.length > 1 && (
        <>
          <Line
            name={CASING_NAME}
            id={id}
            points={clear.flatMap(centre)}
            stroke={CASING_COLOR}
            strokeWidth={casingWidth(2, cam.scale)}
          />
          <Line points={clear.flatMap(centre)} stroke={color} strokeWidth={width} />
        </>
      )}
      {past.length > 0 && (
        // From the last clear step across the wall on.
        <Line
          points={path.slice(blocked - 1).flatMap(centre)}
          stroke={colors.destructive}
          strokeWidth={width}
          dash={[6 / cam.scale, 4 / cam.scale]}
        />
      )}
      {path.map((c, i) => {
        const [x, y] = centre(c);
        const past = blocked >= 0 && i >= blocked;
        return (
          <Group key={`d${c.col},${c.row}`}>
            {!past && (
              <Circle
                name={CASING_NAME}
                id={id}
                x={x}
                y={y}
                radius={dot + CASING_EXTRA_PX / cam.scale / 2}
                fill={CASING_COLOR}
              />
            )}
            <Circle x={x} y={y} radius={dot} fill={past ? colors.destructive : color} />
          </Group>
        );
      })}
    </>
  );
}

/** FR-MAP-55: the wall hint's pieces for this client's own drag (players only; DM: none). */
function useWallPieces(): Segment[] {
  const { client, probe } = useCanvas();
  const [pieces, setPieces] = useState<Segment[]>([]);
  useEffect(() => {
    if (client !== "player") return;
    const off = subscribeWallHint(probe, setPieces);
    return () => {
      off();
      setPieces([]);
    };
  }, [client, probe]);
  return pieces;
}

export function DragPaths({ tokens }: { tokens: readonly TokenView[] }) {
  const { client, grid, pointers, previews, store } = useCanvas();
  /** FR-MAP-70: the owner's colour, resolved per draw (a `player` upsert recolours, FR-MAP-73). */
  const paint = (t: TokenView | undefined) => pathPaint(store, t);
  const drag = useStore(pointers, (s) => s.drag);
  // Remote previews as "id@col,row": re-renders only when a previewed cell changes (FR-MAP-52).
  const remoteKey = useStore(previews, (s) =>
    Object.entries(s.previews)
      .map(([id, p]) => {
        const c = dropCell(grid, p.x, p.y);
        return `${id}@${c.col},${c.row}`;
      })
      .sort()
      .join("|"),
  );
  const pieces = useWallPieces();
  const byId = useMemo(() => new Map(tokens.map((t) => [t.id, t])), [tokens]);
  // FR-MAP-67: every held token's stored trail (players hold it on player tokens only, FR-MAP-66).
  const trails = useMemo(
    () =>
      tokens.flatMap((t) =>
        t.trail && pathShown(t, client)
          ? [{ t, trail: t.trail, segments: trailSegments(t.trail) }]
          : [],
      ),
    [tokens, client],
  );

  const remote = useMemo(() => {
    const out: { t: TokenView; path: Cell[] }[] = [];
    for (const entry of remoteKey === "" ? [] : remoteKey.split("|")) {
      const [id = "", cell = ""] = entry.split("@");
      const [col, row] = cell.split(",").map(Number);
      const t = byId.get(id);
      if (!t || !pathShown(t, client) || drag?.tokenId === id) continue;
      out.push({ t, path: dragPath(t, { col: col ?? t.col, row: row ?? t.row }) });
    }
    return out;
  }, [remoteKey, byId, client, drag?.tokenId]);

  const local = drag && pathShown(byId.get(drag.tokenId), client) ? drag : null;
  const localPath = useMemo(() => (local ? dragPath(local.from, local.to) : null), [local]);
  const blocked = local ? ownDragBlocked(client, local, pieces) : -1;
  const localPaint = local ? paint(byId.get(local.tokenId)) : null;

  return (
    <Group name="map-drag-paths" listening={false}>
      {trails.map(({ t, trail, segments }) => {
        const { color, by } = paint(t);
        return (
          <Group
            key={`trail-${t.id}`}
            name="map-drag-trail"
            id={t.id}
            segments={segments.length}
            cells={trailCellsAttr(trail)}
            color={color}
            by={by}
            opacity={TRAIL_OPACITY}
          >
            {segments.map((path, i) => (
              <PathMarks
                // biome-ignore lint/suspicious/noArrayIndexKey: a segment = its cell pair, in order.
                key={i}
                id={t.id}
                path={path}
                n={footprint(t.size)}
                blocked={-1}
                color={color}
              />
            ))}
          </Group>
        );
      })}
      {remote.map(({ t, path }) => {
        const { color, by } = paint(t);
        return (
          <Group
            key={`path-${t.id}`}
            name="map-drag-path"
            id={t.id}
            cells={cellsAttr(path)}
            blocked={-1}
            preview="remote"
            color={color}
            by={by}
          >
            <PathMarks id={t.id} path={path} n={footprint(t.size)} blocked={-1} color={color} />
          </Group>
        );
      })}
      {local && localPath && localPaint && (
        <Group
          name="map-drag-path"
          id={local.tokenId}
          cells={cellsAttr(localPath)}
          blocked={blocked}
          preview="local"
          color={localPaint.color}
          by={localPaint.by}
        >
          <PathMarks
            id={local.tokenId}
            path={localPath}
            n={local.size}
            blocked={blocked}
            color={localPaint.color}
          />
        </Group>
      )}
    </Group>
  );
}
