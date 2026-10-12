// The base-layer canvas (MAP §7), shared by both clients: react-konva Stage with the layer
// registry (FR-MAP-29), per-client camera (FR-MAP-12), drop-only moves with an optimistic overlay
// (FR-MAP-15), ruler (FR-MAP-22), ping / pull (FR-MAP-23), laser (FR-MAP-24), definition drops
// (FR-MAP-13, DM) and the not-live rules (FR-MAP-28). No feature logic: the server decides.
import { DEFINITION_DRAG_MIME, DefinitionDragData } from "@shared/entities/schemas";
import {
  cellToPx,
  dropCell,
  footprint,
  pxToCell,
  tokenDrawOrder,
} from "@shared/scenes-map/geometry";
import {
  LaserData,
  MAP_INTENTS,
  MAP_SIGNALS,
  PingData,
  type SceneView,
  type TokenView,
} from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "react-konva";
import { SyncContext, useSendSignal, useSignal, useSync } from "../../sync/store";
import { type Camera, centreOn, fitCamera, zoomAt } from "./camera";
import { CanvasContext, type CanvasContextValue, type EffectiveGrid } from "./canvas-context";
import { canvasLayers } from "./canvas-layers";
import { toastReject, useLive, useMapIntent } from "./intents";
import { LaserSender } from "./laser";
import {
  clearOverlay,
  emptyOverlay,
  isSnapshotStore,
  type MoveOverlay,
  settleMove,
  shownCell,
  signalForShownScene,
  startMove,
} from "./overlay";
import { addPing, addTrailPoints, createPointerStore, senderKey } from "./pointers";
import { useCanvasColors } from "./theme";
import { useMapTool } from "./tool-store";

export interface MapCanvasProps {
  client: "dm" | "player";
  scene: SceneView;
  /** Tokens of `scene` the client holds. */
  tokens: readonly TokenView[];
  myPlayerId: string | null;
  /** Ping, pull and laser on (DM: only while the viewed scene is the active one, FR-MAP-08). */
  signalsOn: boolean;
  /** Grid preview while the DM edits it (FR-MAP-10). */
  gridOverride?: EffectiveGrid | null;
  selectedTokenId?: string | null;
  onSelectToken?(id: string | null): void;
  /** DM: right-click on a token (FR-MAP-18). */
  onTokenMenu?(t: TokenView, at: { x: number; y: number }): void;
  onTokenDoubleClick?(t: TokenView): void;
  /** DM: a Creatures row dropped on the canvas (FR-MAP-13); the pointer cell = top-left. */
  onDropDefinition?(definitionId: string, cell: { col: number; row: number }): void;
}

const gridOf = (s: SceneView): EffectiveGrid => ({
  gridCellSize: s.gridCellSize,
  gridOffsetX: s.gridOffsetX,
  gridOffsetY: s.gridOffsetY,
  gridVisible: s.gridVisible,
  gridColor: s.gridColor,
  gridOpacity: s.gridOpacity,
});

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const tokenNodeOf = (n: Konva.Node | null) => n?.findAncestor(".map-token", true) ?? null;

export function MapCanvas(props: MapCanvasProps) {
  const { client, scene, tokens, myPlayerId, signalsOn } = props;
  const syncStore = useContext(SyncContext);
  const box = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useSize(box);
  const colors = useCanvasColors();
  const tool = useMapTool((s) => s.tool);
  const live = useLive();
  const liveRef = useRef(live);
  liveRef.current = live;
  const sendIntent = useMapIntent();
  const sendSignal = useSendSignal();
  const [pointers] = useState(createPointerStore);
  const grid = props.gridOverride ?? gridOf(scene);
  const gridRef = useRef(grid);
  gridRef.current = grid;

  // ---- camera (FR-MAP-12): fit when a scene opens ----
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (size.w === 0 || fittedFor.current === scene.id) return;
    fittedFor.current = scene.id;
    setCam(fitCamera({ w: scene.mapWidth, h: scene.mapHeight }, size));
  }, [scene.id, scene.mapWidth, scene.mapHeight, size]);

  // ---- optimistic move overlay (FR-MAP-15): any snapshot drops it ----
  const [overlay, setOverlay] = useState<MoveOverlay>(emptyOverlay);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const store = useSync((s) => s.store);
  const prevStore = useRef(store);
  useEffect(() => {
    if (isSnapshotStore(prevStore.current, store)) setOverlay(clearOverlay());
    prevStore.current = store;
  }, [store]);

  const shown = useMemo(
    () => tokens.map((t) => shownCell(overlay, t)).sort(tokenDrawOrder),
    [tokens, overlay],
  );

  // ---- FR-MAP-28: a drag in progress when the connection drops snaps back, unsent ----
  const laser = useRef<LaserSender | null>(null);
  useEffect(() => {
    if (live) return;
    for (const n of stageRef.current?.find(".map-token") ?? []) {
      if (n.isDragging()) n.stopDrag();
    }
    pointers.setState({ drag: null });
    laser.current = null;
  }, [live, pointers]);

  const canMove = useCallback(
    (t: TokenView) => client === "dm" || (myPlayerId !== null && t.ownerPlayerId === myPlayerId),
    [client, myPlayerId],
  );

  const move = useCallback(
    (t: TokenView, col: number, row: number) => {
      const { overlay: next, key } = startMove(overlayRef.current, t.id, col, row);
      overlayRef.current = next;
      setOverlay(next);
      const settle = () => setOverlay((o) => settleMove(o, t.id, key));
      sendIntent(MAP_INTENTS.moveToken, { tokenId: t.id, col, row }).then(settle, (err) => {
        settle();
        toastReject(err);
      });
    },
    [sendIntent],
  );

  const { onSelectToken, onTokenDoubleClick } = props;
  const tokenHandlers = useMemo<CanvasContextValue["token"]>(
    () => ({
      dragStart(t, node) {
        const n = footprint(t.size);
        pointers.setState({
          drag: {
            tokenId: t.id,
            size: n,
            from: { col: t.col, row: t.row },
            to: { col: t.col, row: t.row },
          },
        });
        onSelectToken?.(t.id);
        const c = node.getStage()?.container();
        if (c) c.style.cursor = "grabbing";
      },
      dragMove(_t, node) {
        const to = dropCell(gridRef.current, node.x(), node.y());
        const d = pointers.getState().drag;
        if (d && (d.to.col !== to.col || d.to.row !== to.row))
          pointers.setState({ drag: { ...d, to } });
      },
      dragEnd(t, node) {
        pointers.setState({ drag: null });
        const c = node.getStage()?.container();
        if (c) c.style.cursor = "";
        const to = dropCell(gridRef.current, node.x(), node.y());
        if (!liveRef.current || (to.col === t.col && to.row === t.row)) {
          node.position(cellToPx(gridRef.current, t.col, t.row));
          return;
        }
        node.position(cellToPx(gridRef.current, to.col, to.row));
        move(t, to.col, to.row);
      },
      click(t) {
        onSelectToken?.(t.id);
      },
      dblClick(t) {
        onTokenDoubleClick?.(t);
      },
    }),
    [pointers, onSelectToken, onTokenDoubleClick, move],
  );

  // ---- incoming signals (FR-MAP-25): only for the scene this client shows ----
  const signalsFor = (data: unknown, schema: typeof PingData) => {
    const d = schema.safeParse(data);
    return d.success && signalForShownScene(d.data, scene.id) ? d.data : null;
  };
  useSignal(MAP_SIGNALS.ping, (s) => {
    const d = signalsFor(s.data, PingData);
    if (d) addPing(pointers, d.x, d.y, s.from.role, performance.now());
  });
  useSignal(MAP_SIGNALS.pull, (s) => {
    const d = signalsFor(s.data, PingData);
    if (!d) return;
    addPing(pointers, d.x, d.y, s.from.role, performance.now());
    // Forced recentre, zoom unchanged; players may pan away (OQ-MAP-08).
    if (client === "player") setCam((c) => centreOn(c, d, size));
  });
  useSignal(MAP_SIGNALS.laser, (s) => {
    const d = LaserData.safeParse(s.data);
    if (!d.success || !signalForShownScene(d.data, scene.id)) return;
    addTrailPoints(
      pointers,
      senderKey(s.from),
      s.from.role,
      d.data.points,
      d.data.end ?? false,
      performance.now(),
    );
  });

  // ---- pointer gestures ----
  const signalsLive = signalsOn && live;
  const ruling = useRef(false);
  const endGestures = useCallback(() => {
    if (ruling.current) {
      ruling.current = false;
      pointers.setState({ ruler: null });
    }
    if (laser.current) {
      laser.current.end();
      laser.current = null;
      addTrailPoints(pointers, "self", client, [], true, performance.now());
    }
  }, [pointers, client]);
  useEffect(() => {
    window.addEventListener("pointerup", endGestures);
    return () => window.removeEventListener("pointerup", endGestures);
  }, [endGestures]);

  const mapPoint = () => stageRef.current?.getRelativePointerPosition() ?? null;

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = mapPoint();
    if (!p) return;
    const onToken = tokenNodeOf(e.target) !== null;
    if (e.evt.button === 2) {
      if (onToken || !signalsLive) return;
      laser.current = new LaserSender(scene.id, (d) => sendSignal(MAP_SIGNALS.laser, d));
      laser.current.push(p.x, p.y);
      addTrailPoints(pointers, "self", client, [[p.x, p.y]], false, performance.now());
      return;
    }
    if (e.evt.button !== 0) return;
    if (tool === "ruler") {
      const cell = pxToCell(gridRef.current, p.x, p.y);
      ruling.current = true;
      pointers.setState({ ruler: { from: cell, to: cell } });
    } else if (tool === "ping") {
      if (!signalsLive) return;
      const data = { sceneId: scene.id, x: p.x, y: p.y };
      const pull = client === "dm" && e.evt.shiftKey;
      sendSignal(pull ? MAP_SIGNALS.pull : MAP_SIGNALS.ping, data);
      addPing(pointers, p.x, p.y, client, performance.now());
    } else if (!onToken) {
      onSelectToken?.(null);
    }
  };

  const onMouseMove = () => {
    if (!ruling.current && !laser.current) return;
    const p = mapPoint();
    if (!p) return;
    if (ruling.current) {
      const to = pxToCell(gridRef.current, p.x, p.y);
      const r = pointers.getState().ruler;
      if (r && (r.to.col !== to.col || r.to.row !== to.row))
        pointers.setState({ ruler: { ...r, to } });
    }
    if (laser.current) {
      laser.current.push(p.x, p.y);
      addTrailPoints(pointers, "self", client, [[p.x, p.y]], false, performance.now());
    }
  };

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const node = tokenNodeOf(e.target);
    if (!node || client !== "dm" || !props.onTokenMenu || !liveRef.current) return;
    const t = tokens.find((x) => x.id === node.id());
    if (t) props.onTokenMenu(t, { x: e.evt.clientX, y: e.evt.clientY });
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (p) setCam((c) => zoomAt(c, p, e.evt.deltaY));
  };

  const ctx: CanvasContextValue = {
    client,
    scene,
    grid,
    tokens: shown,
    cam,
    colors,
    pointers,
    tool,
    live,
    myPlayerId,
    selectedTokenId: props.selectedTokenId ?? null,
    canMove,
    token: tokenHandlers,
  };

  const acceptsDrop = (e: React.DragEvent) =>
    props.onDropDefinition !== undefined &&
    live &&
    e.dataTransfer.types.includes(DEFINITION_DRAG_MIME);

  return (
    <div
      ref={box}
      data-testid="map-canvas"
      role="application"
      aria-label="Map canvas"
      data-scene-id={scene.id}
      data-tool={tool}
      className="absolute inset-0"
      style={{ cursor: tool === "select" ? undefined : "crosshair" }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!acceptsDrop(e)) return;
        e.preventDefault();
        const parsed = (() => {
          try {
            return DefinitionDragData.safeParse(
              JSON.parse(e.dataTransfer.getData(DEFINITION_DRAG_MIME)),
            );
          } catch {
            return null;
          }
        })();
        const stage = stageRef.current;
        if (!parsed?.success || !stage) return;
        stage.setPointersPositions(e.nativeEvent);
        const p = stage.getRelativePointerPosition();
        if (!p) return;
        props.onDropDefinition?.(parsed.data.definitionId, pxToCell(gridRef.current, p.x, p.y));
      }}
    >
      {size.w > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          x={cam.x}
          y={cam.y}
          scaleX={cam.scale}
          scaleY={cam.scale}
          draggable={tool === "select"}
          onDragEnd={(e) => {
            const stage = stageRef.current;
            if (stage && e.target === stage) setCam((c) => ({ ...c, x: stage.x(), y: stage.y() }));
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onContextMenu={onContextMenu}
        >
          <SyncContext.Provider value={syncStore}>
            <CanvasContext.Provider value={ctx}>
              {canvasLayers.map((l) => {
                const Layer = l.component as React.ComponentType;
                return <Layer key={l.id} />;
              })}
            </CanvasContext.Provider>
          </SyncContext.Provider>
        </Stage>
      )}
    </div>
  );
}
