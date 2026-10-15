// The base-layer canvas (MAP §7), shared by both clients: react-konva Stage with the layer
// registry (FR-MAP-29), per-client camera (FR-MAP-12), drop-only moves with an optimistic overlay
// (FR-MAP-15), ruler (FR-MAP-22), ping / pull (FR-MAP-23), laser (FR-MAP-24), definition drops
// (FR-MAP-13, DM), DM selection + box select + targeting (FR-MAP-31–33), the not-live rules
// (FR-MAP-28) and the live drag preview (FR-MAP-39/40). No feature logic: the server decides.
import { DEFINITION_DRAG_MIME, DefinitionDragData } from "@shared/entities/schemas";
import {
  cellToPx,
  dropCell,
  footprint,
  pxToCell,
  tokenDrawOrder,
} from "@shared/scenes-map/geometry";
import {
  DragData,
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
import { SyncContext, useEventFrame, useSendSignal, useSignal, useSync } from "../../sync/store";
import { useFreeArea } from "../play-shell/free-area";
import { workArea } from "../play-shell/geometry";
import {
  type Camera,
  type CameraEvent,
  type CameraMode,
  cameraOn,
  centreOn,
  contentBox,
  createResizeRefit,
  fitContent,
  footprintBox,
  zoomAt,
} from "./camera";
import { CanvasContext, type CanvasContextValue, type EffectiveGrid } from "./canvas-context";
import { canvasLayers } from "./canvas-layers";
import { subscribeOverlays } from "./decorations";
import {
  clearPreviews,
  createPreviewStore,
  escapeTarget,
  prunePreviews,
  receiveDrag,
  TokenDrag,
  tokenIdsOf,
} from "./drag-preview";
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
import { isClick, tokensInBox } from "./selection-logic";
import { useCanvasColors } from "./theme";
import { tokenOverlays } from "./token-overlays";
import { useMapFit, useMapTool } from "./tool-store";

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
  /** DM selection (FR-MAP-31); absent on the player client (no selection). */
  selectedTokenIds?: readonly string[];
  /** FR-MAP-33: crosshair cursor, token drag off. */
  targeting?: boolean;
  /** DM: left click on a token; `toggle` = Ctrl or Shift held. Also a drag start of an unselected token. */
  onTokenClick?(t: TokenView, toggle: boolean): void;
  /** DM: a click (< 4 px travel) on empty canvas with the Select tool. */
  onEmptyClick?(): void;
  /** DM: Ctrl/Shift + left-drag on empty canvas; the ids whose footprint centre is inside. */
  onBoxSelect?(tokenIds: string[]): void;
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
  const [previews] = useState(createPreviewStore);
  const grid = props.gridOverride ?? gridOf(scene);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const sceneIdRef = useRef(scene.id);
  sceneIdRef.current = scene.id;
  /** This client's token drag in progress (FR-MAP-39), if any. */
  const dragRef = useRef<TokenDrag | null>(null);

  // ---- camera (FR-MAP-12, -44, -45): fit the tokens into the free area ----
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [cameraMode, setCameraMode] = useState<CameraMode>("fitted");
  const cameraModeRef = useRef(cameraMode);
  /** FR-MAP-46: the last fit hit the 48 px cell floor (`data-fit-floor`). */
  const [fitFloor, setFitFloor] = useState(false);
  const free = useFreeArea();
  const fitNow = useRef(() => {});
  fitNow.current = () => {
    if (size.w === 0) return;
    const map = { w: scene.mapWidth, h: scene.mapHeight };
    const box = contentBox(tokens, grid, map);
    // PC tokens = tokens with an owner, in this client's store (FR-MAP-46).
    const pcs = footprintBox(
      tokens.filter((t) => t.ownerPlayerId !== null),
      grid,
    );
    const { floor, ...fit } = fitContent(
      box,
      free.area,
      map,
      workArea(size),
      grid.gridCellSize,
      pcs,
    );
    setCam(fit);
    setFitFloor(floor);
  };
  /** Applies a camera event; fits now (or next frame, once the window change is laid out). */
  const onCamera = useCallback((e: CameraEvent, deferred = false) => {
    const next = cameraOn(cameraModeRef.current, e);
    cameraModeRef.current = next.mode;
    setCameraMode(next.mode);
    if (!next.fit) return;
    if (!deferred) fitNow.current();
    else
      requestAnimationFrame(() => {
        if (cameraModeRef.current === "fitted") fitNow.current();
      });
  }, []);
  // (a) a scene opens on this page, after the layout is applied (FR-SHELL-16).
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (size.w === 0 || !free.ready || fittedFor.current === scene.id) return;
    fittedFor.current = scene.id;
    onCamera("open");
  }, [scene.id, size, free.ready, onCamera]);
  // (b) an appearance refits while `fitted`; the window lands (FR-SHELL-18 `appear`) first.
  const seenAppearances = useRef(free.appearances);
  useEffect(() => {
    if (free.appearances === seenAppearances.current) return;
    seenAppearances.current = free.appearances;
    onCamera("appearance", true);
  }, [free.appearances, onCamera]);
  // FR-MAP-47: a settled viewport resize refits while `fitted` (after a token drag drops).
  const resizeRefit = useRef<ReturnType<typeof createResizeRefit> | null>(null);
  useEffect(() => {
    const r = createResizeRefit(
      () => onCamera("resize"),
      () => dragRef.current !== null,
    );
    resizeRefit.current = r;
    window.addEventListener("resize", r.resize);
    return () => {
      window.removeEventListener("resize", r.resize);
      r.dispose();
    };
  }, [onCamera]);
  // FR-MAP-45: the rail's Fit button.
  useEffect(
    () =>
      useMapFit.subscribe((s, prev) => {
        if (s.requests !== prev.requests) onCamera("fit");
      }),
    [onCamera],
  );

  // ---- optimistic move overlay (FR-MAP-15): any snapshot drops it ----
  const [overlay, setOverlay] = useState<MoveOverlay>(emptyOverlay);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const store = useSync((s) => s.store);
  const prevStore = useRef(store);
  useEffect(() => {
    if (isSnapshotStore(prevStore.current, store)) {
      setOverlay(clearOverlay());
      clearPreviews(previews);
    }
    prevStore.current = store;
  }, [store, previews]);

  // ---- drag previews (FR-MAP-40): dropped on a `token` change, a scene switch or 3 s silence ----
  useEventFrame((f) => clearPreviews(previews, tokenIdsOf(f.changes)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a scene switch drops every preview.
  useEffect(() => clearPreviews(previews), [scene.id, previews]);
  useEffect(() => {
    const id = setInterval(() => prunePreviews(previews, performance.now()), 250);
    return () => clearInterval(id);
  }, [previews]);

  // ---- FR-MAP-49: an overlay's client-only state (e.g. a cue timer) re-runs decorations ----
  const [, setOverlayRev] = useState(0);
  useEffect(() => subscribeOverlays(tokenOverlays, () => setOverlayRev((n) => n + 1)), []);

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

  const targeting = props.targeting ?? false;
  const canMove = useCallback(
    (t: TokenView) =>
      !targeting && (client === "dm" || (myPlayerId !== null && t.ownerPlayerId === myPlayerId)),
    [client, myPlayerId, targeting],
  );
  const selectedIds = props.selectedTokenIds;
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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

  const { onTokenClick, onTokenDoubleClick } = props;
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
        // FR-MAP-39: preview frames for others; others' previews of T are ignored meanwhile.
        dragRef.current = new TokenDrag(sceneIdRef.current, t.id, { col: t.col, row: t.row }, (d) =>
          sendSignal(MAP_SIGNALS.drag, d),
        );
        previews.setState({ local: { tokenId: t.id, x: node.x(), y: node.y() } });
        if (!selectedRef.current.has(t.id)) onTokenClick?.(t, false);
        const c = node.getStage()?.container();
        if (c) c.style.cursor = "grabbing";
      },
      dragMove(t, node) {
        dragRef.current?.move(node.x(), node.y());
        previews.setState({ local: { tokenId: t.id, x: node.x(), y: node.y() } });
        const to = dropCell(gridRef.current, node.x(), node.y());
        const d = pointers.getState().drag;
        if (d && (d.to.col !== to.col || d.to.row !== to.row))
          pointers.setState({ drag: { ...d, to } });
      },
      dragEnd(t, node) {
        pointers.setState({ drag: null });
        previews.setState({ local: null });
        clearPreviews(previews, [t.id]);
        const c = node.getStage()?.container();
        if (c) c.style.cursor = "";
        const drag = dragRef.current;
        dragRef.current = null;
        const drop = dropCell(gridRef.current, node.x(), node.y());
        // Drop → `map.moveToken`, then `end`; Esc, not live or unmoved → snap back (FR-MAP-15/28/39).
        const at = drag
          ? drag.finish(drop, liveRef.current, (to) => move(t, to.col, to.row))
          : { col: t.col, row: t.row };
        node.position(cellToPx(gridRef.current, at.col, at.row));
        resizeRefit.current?.drop();
      },
      click(t, toggle) {
        onTokenClick?.(t, toggle);
      },
      dblClick(t) {
        onTokenDoubleClick?.(t);
      },
    }),
    [pointers, previews, onTokenClick, onTokenDoubleClick, move, sendSignal],
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
    if (client !== "player") return;
    setCam((c) => centreOn(c, d, size));
    onCamera("pull");
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
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  useSignal(MAP_SIGNALS.drag, (s) => {
    const d = DragData.safeParse(s.data);
    if (!d.success) return;
    receiveDrag(
      previews,
      d.data,
      {
        sceneId: scene.id,
        hasToken: (id) => tokensRef.current.some((t) => t.id === id),
        draggingId: dragRef.current?.tokenId ?? null,
      },
      performance.now(),
    );
  });

  // ---- pointer gestures ----
  const signalsLive = signalsOn && live;
  const ruling = useRef(false);
  /** Left press with the Select tool: empty-canvas click detection (FR-MAP-31). */
  const press = useRef<{ x: number; y: number; onToken: boolean } | null>(null);
  /** DM box select in progress (FR-MAP-32). */
  const boxing = useRef(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const { onEmptyClick, onBoxSelect } = props;
  const endBox = useCallback(() => {
    boxing.current = false;
    pointers.setState({ box: null });
    stageRef.current?.draggable(useMapTool.getState().tool === "select");
  }, [pointers]);
  /** Box corner follows the pointer anywhere on the page (windows may cover the canvas). */
  const trackBox = useCallback(
    (e: PointerEvent) => {
      const stage = stageRef.current;
      const box = pointers.getState().box;
      if (!boxing.current || !stage || !box) return;
      stage.setPointersPositions(e);
      const p = stage.getRelativePointerPosition();
      if (p) pointers.setState({ box: { ...box, x1: p.x, y1: p.y } });
    },
    [pointers],
  );
  useEffect(() => {
    window.addEventListener("pointermove", trackBox);
    return () => window.removeEventListener("pointermove", trackBox);
  }, [trackBox]);
  const endGestures = useCallback(
    (e?: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (p && e) {
        const click = isClick(e.clientX - p.x, e.clientY - p.y);
        trackBox(e);
        const box = pointers.getState().box;
        if (boxing.current && box && !click) {
          onBoxSelect?.(tokensInBox(shownRef.current, gridRef.current, box));
        } else if (click && !p.onToken) {
          onEmptyClick?.();
        }
      }
      if (boxing.current) endBox();
      if (ruling.current) {
        ruling.current = false;
        pointers.setState({ ruler: null });
      }
      if (laser.current) {
        laser.current.end();
        laser.current = null;
        addTrailPoints(pointers, "self", client, [], true, performance.now());
      }
    },
    [pointers, client, onBoxSelect, onEmptyClick, endBox, trackBox],
  );
  useEffect(() => {
    window.addEventListener("pointerup", endGestures);
    return () => window.removeEventListener("pointerup", endGestures);
  }, [endGestures]);
  // Esc mid-drag cancels the token drag (FR-MAP-15) or the box (FR-MAP-32) and stops there, so
  // the selection is kept (capture: before the DM's Esc-clears handler).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = escapeTarget(dragRef.current !== null, boxing.current);
      if (!target) return;
      e.stopPropagation();
      if (target === "drag") {
        dragRef.current?.cancel();
        // Konva fires `dragend`: the token snaps back and `end` goes out (dragEnd above).
        for (const n of stageRef.current?.find(".map-token") ?? []) {
          if (n.isDragging()) n.stopDrag();
        }
        return;
      }
      press.current = null;
      endBox();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [endBox]);

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
    } else {
      press.current = { x: e.evt.clientX, y: e.evt.clientY, onToken };
      if (!onToken && onBoxSelect && (e.evt.ctrlKey || e.evt.shiftKey)) {
        // Box select instead of pan (FR-MAP-12 / -32).
        boxing.current = true;
        stageRef.current?.draggable(false);
        pointers.setState({ box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } });
      }
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
    if (!p) return;
    setCam((c) => zoomAt(c, p, e.evt.deltaY));
    onCamera("zoom");
  };

  const ctx: CanvasContextValue = {
    client,
    scene,
    grid,
    tokens: shown,
    cam,
    colors,
    pointers,
    previews,
    tool,
    live,
    myPlayerId,
    selected,
    targeting,
    store,
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
      data-targeting={targeting}
      data-camera={cameraMode}
      data-cell-px={Math.round(cam.scale * grid.gridCellSize)}
      data-fit-floor={fitFloor}
      className="absolute inset-0"
      style={{ cursor: tool === "select" && !targeting ? undefined : "crosshair" }}
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
            if (!stage || e.target !== stage) return;
            setCam((c) => ({ ...c, x: stage.x(), y: stage.y() }));
            onCamera("pan");
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
