// `scn-structure` canvas layer (order 26, FR-SCN-02, -09, -12, -13, -14): a Konva Group in the
// shared `scn-objects` layer, above props. DM: walls as one shape (`scn-walls`, attr `count`;
// hidden while the "DM-only items" switch is off), doors with a glyph per state (`scn-door`, id
// `door-<n>`, attr `state`), double-click (Select tool) toggles open ↔ closed, right-click opens
// the door menu; while dragging a token, the crossed segments in red (`scn-wall-crossed`, attr
// `ns`) and a "through wall" tag (`scn-through-wall`). Players: doors only (open / closed), a 1 s
// flash on the target cell of a refused move (`scn-blocked-cell`) and, while dragging their token,
// the red wall hint pieces from `map.checkMove` (`scn-wall-hint`, one per piece, attr `segment`,
// FR-SCN-38). Publishes the shown structure for the Structure tool.

import {
  DOOR_LOCKED,
  DOOR_OPEN,
  type PlayerSceneStructureRecord,
  SCENE_STRUCTURE_TYPE,
  type SceneStructureRecord,
  type Segment,
} from "@shared/scene-tools/schemas";
import { cellToPx } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Label, Line, Rect, Shape, Tag, Text } from "react-konva";
import { useStore } from "zustand";
import { SyncContext, useSync } from "../../../sync/store";
import { useCanvas } from "../../scenes-map/canvas-context";
import { toastReject, useMapIntent } from "../../scenes-map/intents";
import { useLayerToggles } from "../../scenes-map/tool-store";
import { useDoorMenuIsland } from "../DoorMenu";
import { setDoorEdit } from "../structure-edits";
import { doorMenu, shownStructure } from "../structure-store";
import {
  type DoorView,
  type DropWatch,
  doorStateName,
  dragHint,
  FLASH_MS,
  segmentPx,
  structureView,
  toggledDoor,
  watchDrop,
} from "../structure-view";
import { subscribeWallHint } from "../wall-hint";

/** Segments as one shape (FR-SCN-12 perf: walls are one Konva shape). */
function Segments({
  segs,
  name,
  stroke,
  width,
  attrs,
}: {
  segs: [number, number, number, number][];
  name: string;
  stroke: string;
  width: number;
  attrs?: Record<string, unknown>;
}) {
  return (
    <Shape
      name={name}
      {...attrs}
      stroke={stroke}
      strokeWidth={width}
      lineCap="round"
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const [ax, ay, bx, by] of segs) {
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

/** One door: a slab when closed, swung open with a dashed gap when open, a lock when locked. */
function DoorGlyph({
  d,
  sceneId,
  interactive,
}: {
  d: DoorView;
  sceneId: string;
  interactive: boolean;
}) {
  const { grid, colors, tool, live } = useCanvas();
  const send = useMapIntent();
  const [ax, ay, bx, by] = segmentPx(grid, d.seg);
  const len = Math.hypot(bx - ax, by - ay);
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  const t = grid.gridCellSize * 0.16;
  const sw = Math.max(1, grid.gridCellSize * 0.03);
  const open = d.state === DOOR_OPEN;
  const handlers = interactive
    ? {
        onDblClick: () => {
          if (tool !== "select" || !live) return;
          const next = toggledDoor(d.state);
          if (next !== null) setDoorEdit(send, sceneId, d.n, d.state, next).catch(toastReject);
        },
        onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
          // Right-press opens the menu, not the laser.
          if (e.evt.button === 2) e.cancelBubble = true;
        },
        onContextMenu: (e: Konva.KonvaEventObject<PointerEvent>) => {
          e.evt.preventDefault();
          e.cancelBubble = true;
          if (!live) return;
          doorMenu.setState({
            open: { sceneId, n: d.n, state: d.state, at: { x: e.evt.clientX, y: e.evt.clientY } },
          });
        },
      }
    : {};
  return (
    <Group
      name="scn-door"
      id={`door-${d.n}`}
      state={doorStateName(d.state)}
      x={ax}
      y={ay}
      rotation={angle}
      listening={interactive}
      {...handlers}
    >
      {/* Hit area along the whole segment. */}
      <Line points={[0, 0, len, 0]} stroke="transparent" strokeWidth={t * 2.5} />
      {open ? (
        <>
          <Line points={[0, 0, len, 0]} stroke={colors.primary} strokeWidth={sw} dash={[t, t]} />
          <Rect
            x={0}
            y={-t / 2}
            width={len}
            height={t}
            rotation={-70}
            fill={colors.background}
            stroke={colors.primary}
            strokeWidth={sw}
            opacity={0.85}
          />
        </>
      ) : (
        <Rect
          x={0}
          y={-t / 2}
          width={len}
          height={t}
          fill={colors.background}
          stroke={colors.primary}
          strokeWidth={sw}
        />
      )}
      {d.state === DOOR_LOCKED && (
        <Group x={len / 2} y={0} rotation={-angle} name="scn-door-lock">
          <Circle y={-t * 0.55} radius={t * 0.5} stroke={colors.primary} strokeWidth={sw * 1.5} />
          <Rect
            x={-t * 0.75}
            y={-t * 0.4}
            width={t * 1.5}
            height={t * 1.2}
            cornerRadius={t * 0.2}
            fill={colors.primary}
          />
        </Group>
      )}
    </Group>
  );
}

/** FR-SCN-13: "through wall" tag at the dragged token's target cell. */
function ThroughWallTag({ col, row, size }: { col: number; row: number; size: number }) {
  const { grid, cam, colors } = useCanvas();
  const p = cellToPx(grid, col, row);
  return (
    <Label
      name="scn-through-wall"
      x={p.x + (size * grid.gridCellSize) / 2}
      y={p.y - 4 / cam.scale}
      listening={false}
    >
      <Tag
        fill={colors.destructive}
        cornerRadius={4 / cam.scale}
        pointerDirection="down"
        pointerWidth={8 / cam.scale}
        pointerHeight={5 / cam.scale}
      />
      <Text
        text="through wall"
        fontSize={12 / cam.scale}
        padding={3 / cam.scale}
        fill={colors.background}
        fontStyle="bold"
      />
    </Label>
  );
}

/** FR-SCN-12: watches this player's drops; a snap back flashes the target cell for 1 s. */
function useBlockedFlash(on: boolean) {
  const { pointers, tokens, store } = useCanvas();
  const watch = useRef<DropWatch | null>(null);
  const [flash, setFlash] = useState<{ col: number; row: number; size: number; at: number } | null>(
    null,
  );
  useEffect(() => {
    if (!on) return;
    return pointers.subscribe((s, prev) => {
      const d = prev.drag;
      if (!d || s.drag) return;
      if (d.to.col === d.from.col && d.to.row === d.from.row) return;
      watch.current = {
        tokenId: d.tokenId,
        to: d.to,
        size: d.size,
        at: performance.now(),
        seen: false,
      };
    });
  }, [on, pointers]);
  useEffect(() => {
    const w = watch.current;
    if (!w) return;
    const shown = tokens.find((t) => t.id === w.tokenId) ?? null;
    const committed = (store.records[TOKEN_TYPE]?.[w.tokenId] as TokenRecord | undefined) ?? null;
    const r = watchDrop(w, shown, committed, performance.now());
    watch.current = r.watch;
    if (r.flash) setFlash({ ...w.to, size: w.size, at: performance.now() });
  });
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);
  return flash;
}

/**
 * FR-SCN-38: the player's wall hint pieces while dragging their token, from the canvas drag
 * probe's `map.checkMove` acks (scenes-map, seams S1); cleared on cell change, drag end, a
 * snapshot, leaving live and a scene switch (the probe resets its subscribers).
 */
function useWallHint(on: boolean): Segment[] {
  const { probe } = useCanvas();
  const [pieces, setPieces] = useState<Segment[]>([]);
  useEffect(() => {
    if (!on) return;
    const off = subscribeWallHint(probe, setPieces);
    return () => {
      off();
      setPieces([]);
    };
  }, [on, probe]);
  return on ? pieces : [];
}

/**
 * The shown scene's structure; on the DM client also published for the Structure tool and Undo.
 * Called by this layer and by the tool's `scn-edit` preview, so it stays current while the
 * "Walls & doors" switch has this layer unmounted.
 */
export function useShownStructure() {
  const { client, scene, store, cam } = useCanvas();
  const dm = client === "dm";
  const record = store.records[SCENE_STRUCTURE_TYPE]?.[scene.id] as
    | SceneStructureRecord
    | PlayerSceneStructureRecord
    | undefined;
  const view = useMemo(() => structureView(record), [record]);
  const loaded = useSync((s) => s.store.you?.role !== "dm" || s.scenes.loaded.includes(scene.id));
  useEffect(() => {
    if (dm) shownStructure.setState({ sceneId: scene.id, view, scale: cam.scale, loaded });
  }, [dm, scene.id, view, cam.scale, loaded]);
  return view;
}

export function ScnStructureLayer() {
  const { client, scene, grid, colors, pointers, live } = useCanvas();
  const dm = client === "dm";
  const view = useShownStructure();
  useDoorMenuIsland(useContext(SyncContext), dm);
  const wallsOff = useLayerToggles((s) => s.off["dm-only"] === true);
  const drag = useStore(pointers, (s) => s.drag);
  const hint = dm && live ? dragHint(view, drag) : null;
  const flash = useBlockedFlash(!dm);
  const hintPieces = useWallHint(!dm);

  const width = Math.max(2, grid.gridCellSize * 0.07);
  const walls = useMemo(
    () => view.walls.map((w) => segmentPx(grid, [w[1], w[2], w[3], w[4]] as Segment)),
    [view.walls, grid],
  );
  const crossed = useMemo(() => {
    if (!hint) return [];
    const ns = new Set(hint.ns);
    return [
      ...view.walls.filter((w) => ns.has(w[0])).map((w): Segment => [w[1], w[2], w[3], w[4]]),
      ...view.doors.filter((d) => ns.has(d.n)).map((d) => d.seg),
    ].map((s) => segmentPx(grid, s));
  }, [hint, view, grid]);

  return (
    <Group name="scn-structure">
      {dm && !wallsOff && (
        <Segments
          segs={walls}
          name="scn-walls"
          stroke={colors.primary}
          width={width}
          attrs={{ count: walls.length }}
        />
      )}
      {view.doors.map((d) => (
        <DoorGlyph key={d.n} d={d} sceneId={scene.id} interactive={dm} />
      ))}
      {hint && (
        <>
          <Segments
            segs={crossed}
            name="scn-wall-crossed"
            stroke={colors.destructive}
            width={width * 1.6}
            attrs={{ ns: hint.ns.join(",") }}
          />
          <ThroughWallTag col={hint.to.col} row={hint.to.row} size={hint.size} />
        </>
      )}
      {hintPieces.map((p) => (
        <Line
          key={p.join(",")}
          name="scn-wall-hint"
          segment={p.join(",")}
          points={segmentPx(grid, p)}
          stroke={colors.destructive}
          strokeWidth={width * 1.6}
          lineCap="round"
          listening={false}
        />
      ))}
      {flash && (
        <Rect
          name="scn-blocked-cell"
          {...cellToPx(grid, flash.col, flash.row)}
          width={flash.size * grid.gridCellSize}
          height={flash.size * grid.gridCellSize}
          fill={colors.destructive}
          opacity={0.4}
          listening={false}
        />
      )}
    </Group>
  );
}
