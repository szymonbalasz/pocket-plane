// The base-layer canvas (MAP §7), shared by both clients: react-konva Stage with the layer
// registry (FR-MAP-29), per-client camera (FR-MAP-12), drop-only moves with an optimistic overlay
// (FR-MAP-15), ruler (FR-MAP-22), ping / pull (FR-MAP-23), laser (FR-MAP-24), definition drops
// (FR-MAP-13, DM), DM selection + box select + targeting (FR-MAP-31–33), the not-live rules
// (FR-MAP-28), the live drag preview (FR-MAP-39/40), the canvas tool core (FR-SCN-06: stage
// dispatch to the active registry tool, Space + drag pans, Esc to the tool first, tokens ignore
// left-press while drawing), the middle-mouse pan before all of it (FR-MAP-12, sprint 4) and the
// right-press routing
// (FR-MAP-71: node menus → token → tool menu → layer `contextMenu` → laser). No feature logic:
// the server decides.
import { DEFINITION_DRAG_MIME, DefinitionDragData } from "@shared/entities/schemas";
import { pxToVertex } from "@shared/scene-tools/geometry";
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
import { Group, Layer, Stage } from "react-konva";
import { SyncContext, useEventFrame, useSendSignal, useSignal, useSync } from "../../sync/store";
import { FogBlindChip } from "../fog-of-war/BlindChip";
import { blindStore, isBlind } from "../fog-of-war/blind";
import { pauseGate } from "../pause/gate";
import { setFitPort, useFreeArea } from "../play-shell/free-area";
import type { Rect } from "../play-shell/geometry";
import { isKeyboardFocus, spaceAction, trackFocusModality } from "../play-shell/keys";
import { withoutDmOnly } from "../scene-tools/layer-switches";
import {
  appearanceKeeps,
  type Camera,
  type CameraEvent,
  type CameraMode,
  cameraOn,
  centreOn,
  createResizeRefit,
  createRevealRefit,
  createSettledRefit,
  createSizeCameras,
  dryFitScene,
  type FitInputs,
  type FitReason,
  type FitVisible,
  fitFor,
  fitTokensOf,
  footprintBox,
  isFullFit,
  layoutKey,
  placerSettled,
  refitsOnReveal,
  revealRefit,
  type SizeCamera,
  visibleArea,
  zoomAt,
} from "./camera";
import { CanvasContext, type CanvasContextValue, type EffectiveGrid } from "./canvas-context";
import { canvasLayers } from "./canvas-layers";
import { canvasTools } from "./canvas-tools";
import { subscribeOverlays } from "./decorations";
import {
  clearPreviews,
  createPreviewStore,
  prunePreviews,
  receiveDrag,
  TokenDrag,
  tokenIdsOf,
} from "./drag-preview";
import { DragProbe, probesDrag } from "./drag-probe";
import { toastReject, useLive, useMapIntent } from "./intents";
import { labelHitAt, labelRowItems, tokenIdAt } from "./label-hit";
import { LaserSender } from "./laser";
import {
  type LayerContextMenu,
  type LayerMenuContext,
  layerMenuAt,
  layerSlots,
  type MenuPoint,
  stageLayers,
} from "./layers";
import { selfOf } from "./mark-colors";
import { createMiddlePan, type MiddlePan } from "./middle-pan";
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
import { addPing, addTrailPoints, createPointerStore, SELF_KEY, senderKey } from "./pointers";
import { deferredMove, rightPress } from "./right-press";
import { isClick, tokensInBox } from "./selection-logic";
import { useCanvasColors } from "./theme";
import { tokenOverlays } from "./token-overlays";
import { useLayerToggles, useMapFit, useMapTool } from "./tool-store";
import {
  activeTool,
  escapeOrder,
  isDrawing,
  type PointerIntent,
  pressGoesToTool,
  stagePans,
  type ToolPointer,
  tokenTakesLeftPress,
} from "./tools";

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
  /**
   * DM: the scene's tokens are still loading (ADR-0041): "Loading scene…" shows and the
   * scene-open fit (FR-MAP-44) waits for them.
   */
  loading?: boolean;
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

/** FR-MAP-89 (2): the first scene open on this page is the load fit (`data-fit-reason="load"`). */
let loadFitDone = false;

/**
 * FR-MAP-12 / OQ-MAP-45: the mounted canvases' middle pans. Konva ends any drag on a window
 * `mouseup` (capture); this guard is registered when the module loads, before any Stage exists,
 * so it runs first and keeps a middle release from ending a left drag (or reaching anyone while
 * a middle pan runs).
 */
const middlePans = new Set<MiddlePan>();
if (typeof window !== "undefined") {
  window.addEventListener(
    "mouseup",
    (e) => {
      let take = false;
      for (const p of middlePans) take = p.release(e) || take;
      if (take) e.stopImmediatePropagation();
    },
    true,
  );
}

export function MapCanvas(props: MapCanvasProps) {
  const { client, scene, tokens, myPlayerId, signalsOn } = props;
  /** This client's person: own pings and laser draw in the own colour (FR-MAP-68, -69). */
  const self = useMemo(() => selfOf(client, myPlayerId), [client, myPlayerId]);
  const syncStore = useContext(SyncContext);
  const box = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useSize(box);
  const colors = useCanvasColors();
  const tool = useMapTool((s) => s.tool);
  const live = useLive();
  const liveRef = useRef(live);
  liveRef.current = live;
  // ---- canvas tools (FR-SCN-06): the active registry tool, if any, and Space-to-pan ----
  const toolDef = useMemo(() => activeTool(canvasTools, tool, client), [tool, client]);
  const toolDefRef = useRef(toolDef);
  toolDefRef.current = toolDef;
  const drawing = isDrawing(toolDef);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  /** A left press the active tool received; its release goes to the tool too. */
  const toolPress = useRef(false);
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(space);
  spaceRef.current = space;
  /** The pointer is over the canvas (Space pans then even while a button has focus). */
  const overMap = useRef(false);
  /** Space taken for a pan (from a focused control too): its keyup must not click it either. */
  const spaceTaken = useRef(false);
  useEffect(() => useMapTool.setState({ client }), [client]);
  const sendIntent = useMapIntent();
  const sendIntentRef = useRef(sendIntent);
  sendIntentRef.current = sendIntent;
  const sendSignal = useSendSignal();
  /** A stage pointer event as the active tool receives it (FR-SCN-06). */
  const toolPointerRef = useRef<(evt: MouseEvent) => ToolPointer | null>(() => null);
  const [pointers] = useState(createPointerStore);
  const [previews] = useState(createPreviewStore);
  const grid = props.gridOverride ?? gridOf(scene);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const sceneIdRef = useRef(scene.id);
  sceneIdRef.current = scene.id;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  /** This client's token drag in progress (FR-MAP-39), if any. */
  const dragRef = useRef<TokenDrag | null>(null);
  /** FR-MAP-39 (sprint 4, seams S1): `map.checkMove` per previewed cell; hints to subscribers. */
  const [probe] = useState(
    () =>
      new DragProbe({
        check: (tokenId, to) =>
          sendIntentRef.current(MAP_INTENTS.checkMove, { tokenId, col: to.col, row: to.row }),
        now: () => performance.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      }),
  );

  // ---- camera (FR-MAP-12, -44, -45): fit the tokens into the free area ----
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [cameraMode, setCameraMode] = useState<CameraMode>("fitted");
  const cameraModeRef = useRef(cameraMode);
  /** FR-MAP-46: the last fit hit the 48 px cell floor (`data-fit-floor`). */
  const [fitFloor, setFitFloor] = useState(false);
  /** FR-MAP-58: the free rectangle the last fit used, "x,y,w,h" (`data-fit-rect`). */
  const [fitRect, setFitRect] = useState("");
  /** FR-MAP-59: every token footprint clear of windows and the toast box (`data-fit-visible`). */
  const [fitVisible, setFitVisible] = useState<FitVisible>("all");
  /** FR-MAP-82: the last fit's cause (`data-fit-reason`). */
  const [fitReason, setFitReason] = useState<FitReason>("open");
  const free = useFreeArea();
  const freeRef = useRef(free);
  freeRef.current = free;
  // FR-MAP-59 / -80 / -93 obstacles: the rendered windows of the placer's plan + the players' toast
  // box, or the DM's summary strip + shown stack (`fitObstacles`).
  const obstacles = free.obstacles;
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const camRef = useRef(cam);
  camRef.current = cam;
  /** FR-MAP-82 / -89 (3): the token ids the last fit framed on its scene (the reveal baseline). */
  const drawn = useRef<{ scene: string; ids: ReadonlySet<string> } | null>(null);
  /** FR-MAP-94: the last full fit's cell (Fit, open, load, resize), screen px; the refits' bound. */
  const lastFullCell = useRef<number | null>(null);
  /** FR-MAP-93, -95: this client's fit inputs now; `windows` = the placer's candidate rects. */
  const fitInputs = useRef((_windows?: readonly Rect[]): FitInputs | null => null);
  fitInputs.current = (windows) => {
    if (size.w === 0) return null;
    const rooms = windows ? free.roomsWith(windows) : free;
    return {
      client,
      tokens: fitTokensOf(tokens),
      grid,
      map: { w: scene.mapWidth, h: scene.mapHeight },
      view: size,
      room: rooms.room,
      stripRoom: rooms.stripRoom,
      // BL-100: the rooms without remembered windows (not for a dry fit's candidate rects).
      ...(!windows && free.untouched && { untouched: free.untouched }),
    };
  };
  /** H2 FAIL 5: the fitted camera (and fit state) last shown at each viewport size. */
  const [sizeCams] = useState(() => createSizeCameras<SizeCamera>());
  /** The last fit's state, for `sizeCams` (recorded once per resize, at its first event). */
  const fitState = useRef<SizeCamera | null>(null);
  /** What this camera frames now (`layoutKey`). */
  const layoutNow = useRef((): string => "");
  layoutNow.current = () =>
    layoutKey(scene.id, fitTokensOf(tokensRef.current), obstaclesRef.current);
  const fitNow = useRef((_reason: FitReason) => {});
  fitNow.current = (reason) => {
    const inputs = fitInputs.current();
    if (!inputs) return;
    // H2 FAIL 5 (FR-MAP-113 note): back at a size whose layout is the one it showed before, the
    // camera it had there (a resize round trip restores the map too).
    const kept = reason === "resize" ? sizeCams.take(size, layoutNow.current()) : null;
    // FR-MAP-95: every reason runs Fit's function with this client's obstacles, bounded by the
    // last full fit (FR-MAP-94).
    const fit = kept ?? {
      ...fitFor(reason, inputs, lastFullCell.current),
      lastFull: lastFullCell.current,
    };
    setCam({ x: fit.x, y: fit.y, scale: fit.scale });
    setFitFloor(fit.floor);
    setFitVisible(fit.visible);
    setFitRect(`${fit.rect.x},${fit.rect.y},${fit.rect.w},${fit.rect.h}`);
    setFitReason(fit.reason);
    if (kept) lastFullCell.current = kept.lastFull;
    else if (isFullFit(fit.reason)) lastFullCell.current = fit.scale * grid.gridCellSize;
    fitState.current = { ...fit, lastFull: lastFullCell.current };
    drawn.current = { scene: scene.id, ids: new Set(tokens.map((t) => t.id)) };
  };
  /**
   * FR-MAP-96, -98: the placer has settled: the layout applied, no placed window waiting for its
   * `settle`, grown windows measured; a resize refit also waits for the last `viewport` settle.
   */
  const settledReason = useRef<FitReason>("open");
  /**
   * FR-MAP-113 (BL-86): the `viewport` settle count the pending resize refit waits for (set at
   * each resize event: the settle after it). Never framed on an older settle's windows.
   */
  const resizeSince = useRef<number | undefined>(undefined);
  const settledFor = (reason: FitReason) =>
    placerSettled(
      freeRef.current,
      reason,
      { w: window.innerWidth, h: window.innerHeight },
      reason === "resize" ? resizeSince.current : undefined,
    );
  /** A resize refit whose viewport settle hasn't landed keeps waiting (FR-MAP-113). */
  const resizeHeld = () =>
    settledReason.current === "resize" &&
    resizeSince.current !== undefined &&
    freeRef.current.settles < resizeSince.current;
  /**
   * FR-MAP-61, -96: the appearance refit, after the `appear` settle. FR-MAP-90: every token already
   * inside the area and clear of every obstacle (PCs + 4 px) → the camera stays.
   */
  const [appearanceRefit] = useState(() =>
    createSettledRefit(
      () => {
        if (cameraModeRef.current !== "fitted") return;
        const boxes = fitTokensOf(tokensRef.current).flatMap((t) => {
          const b = footprintBox([t], gridRef.current);
          return b ? [{ ...b, pc: t.pc }] : [];
        });
        if (appearanceKeeps(camRef.current, boxes, obstaclesRef.current, sizeRef.current)) return;
        fitNow.current("appearance");
      },
      () => settledFor("appearance"),
    ),
  );
  /**
   * FR-MAP-96, -97, -98: the scene-open (load) fit, the yield refit and the resize refit run once
   * the placer's settle has applied (restored layout and zones, grown heights, the windows back
   * after a resize) before they frame.
   */
  const [settledFit] = useState(() =>
    createSettledRefit(
      () => {
        const reason = settledReason.current;
        if ((reason === "resize" || reason === "window") && cameraModeRef.current !== "fitted") {
          return;
        }
        fitNow.current(reason);
      },
      () => settledFor(settledReason.current),
      undefined,
      () => resizeHeld(),
    ),
  );
  useEffect(
    () => () => {
      appearanceRefit.dispose();
      settledFit.dispose();
    },
    [appearanceRefit, settledFit],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new token list, window rect set or canvas size re-arms a pending refit
  useEffect(() => {
    appearanceRefit.applied();
    settledFit.applied();
  }, [appearanceRefit, settledFit, tokens, obstacles, size]);
  /** Applies a camera event; fits now (or later, once the placer has settled). */
  const onCamera = useCallback(
    (e: CameraEvent, deferred = false, reason: FitReason = e as FitReason) => {
      const next = cameraOn(cameraModeRef.current, e);
      cameraModeRef.current = next.mode;
      setCameraMode(next.mode);
      if (!next.fit) return;
      // Only fit events (open, fit, appearance, resize, reveal, window) fit.
      if (!deferred) fitNow.current(reason);
      else if (e === "appearance") appearanceRefit.request();
      else {
        settledReason.current = reason;
        settledFit.request();
      }
    },
    [appearanceRefit, settledFit],
  );
  // FR-SHELL-96, -108; FR-MAP-97: the base port the placer's L2b reads (the players' map yields).
  useEffect(() => {
    setFitPort({
      dryFit: (windows, reason) => {
        const inputs = fitInputs.current(windows);
        if (!inputs) return null;
        return dryFitScene(inputs, lastFullCell.current, reason);
      },
      lastFullCell: () => lastFullCell.current,
      // The placer wrote the windows; the refit frames them once they render.
      yieldRefit: () => onCamera("window", true),
    });
    return () => setFitPort(null);
  }, [onCamera]);
  // ---- FR-MAP-12 (sprint 4): the middle mouse pans with any tool, before Konva and the tools ----
  const [panning, setPanning] = useState(false);
  const [pan] = useState(() =>
    createMiddlePan({
      position: () => {
        const s = stageRef.current;
        return s ? { x: s.x(), y: s.y() } : camRef.current;
      },
      // Konva moves the stage directly (as its own drag pan does); the camera commits on release.
      move: (x, y) => stageRef.current?.position({ x, y }),
      end: (at) => {
        if (!at) return;
        setCam((c) => ({ ...c, ...at }));
        onCamera("pan");
      },
      panning: (on) => {
        setPanning(on);
        const c = stageRef.current?.container();
        if (c) c.style.cursor = on ? "grabbing" : "";
      },
    }),
  );
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Capture phase on the canvas box: before Konva's stage listeners (and so every tool).
    const down = (e: MouseEvent) => {
      const intent = pan.press(e, {
        tool: toolDefRef.current,
        space: spaceRef.current,
        live: liveRef.current,
      });
      if (e.type === "pointerdown") revealPress.current(e, intent);
    };
    const move = (e: MouseEvent) => pan.move(e);
    const aux = (e: MouseEvent) => pan.auxclick(e);
    const blur = () => pan.cancel();
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("mousedown", down, true);
    el.addEventListener("auxclick", aux);
    window.addEventListener("mousemove", move, true);
    window.addEventListener("blur", blur);
    middlePans.add(pan);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("mousedown", down, true);
      el.removeEventListener("auxclick", aux);
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("blur", blur);
      middlePans.delete(pan);
      pan.cancel();
    };
  }, [pan]);
  // (a) a scene opens on this page, after the layout is applied (FR-SHELL-16).
  const fittedFor = useRef<string | null>(null);
  const loading = props.loading === true;
  useEffect(() => {
    if (size.w === 0 || !free.ready || loading || fittedFor.current === scene.id) return;
    fittedFor.current = scene.id;
    onCamera("open", true, loadFitDone ? "open" : "load");
    loadFitDone = true;
  }, [scene.id, size, free.ready, loading, onCamera]);
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
      () => onCamera("resize", true),
      () => dragRef.current !== null,
    );
    resizeRefit.current = r;
    // FR-MAP-113: the refit for this resize waits for the viewport settle after it.
    const on = () => {
      resizeSince.current = freeRef.current.settles + 1;
      // H2 FAIL 5: the camera of the size this resize leaves (its first event), while fitted.
      const at = fitState.current;
      if (at && cameraModeRef.current === "fitted" && sizeRef.current.w > 0) {
        sizeCams.record(sizeRef.current, layoutNow.current(), { ...at, ...camRef.current });
        fitState.current = null;
      }
      r.resize();
    };
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
      r.dispose();
    };
  }, [onCamera, sizeCams]);
  // FR-SHELL-80: Reset layout on this page runs one Fit, with the windows it wrote.
  const seenFits = useRef(free.fitRequests);
  useEffect(() => {
    if (free.fitRequests === seenFits.current) return;
    seenFits.current = free.fitRequests;
    onCamera("fit");
  }, [free.fitRequests, onCamera]);
  // FR-MAP-45: the rail's Fit button.
  useEffect(
    () =>
      useMapFit.subscribe((s, prev) => {
        if (s.requests !== prev.requests) onCamera("fit");
      }),
    [onCamera],
  );
  // FR-MAP-82 (players only): a frame that newly draws tokens off-screen or under a window (or
  // the toast box) refits once while `fitted`, after the frame is applied; a burst coalesces.
  const [reveal] = useState(() => createRevealRefit(() => onCamera("reveal")));
  useEffect(() => () => reveal.dispose(), [reveal]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a scene switch drops a pending refit
  useEffect(() => reveal.dispose(), [reveal, scene.id]);
  useEffect(() => {
    const prev = drawn.current;
    // A scene switch, or tokens before this scene's first fit has framed: that fit takes the
    // baseline (FR-MAP-89 (3)), so a token arriving after it counts as a reveal.
    if (!prev || prev.scene !== scene.id) return;
    drawn.current = { scene: scene.id, ids: new Set(tokens.map((t) => t.id)) };
    if (!refitsOnReveal(client)) return;
    const next = tokens.flatMap((t) => {
      const box = footprintBox([t], gridRef.current);
      return box ? [{ id: t.id, box }] : [];
    });
    const area = visibleArea(sizeRef.current);
    const mode = cameraModeRef.current;
    if (revealRefit(prev.ids, next, camRef.current, obstaclesRef.current, area, mode)) {
      // FR-SHELL-127: under the pause card the refit waits for resume.
      pauseGate.deferUntilResume("map.reveal", () => reveal.reveal());
    }
  }, [tokens, scene.id, client, reveal]);
  /**
   * FR-MAP-82: a press on the canvas (capture phase, before Konva and the tools). The user wins:
   * a pan gesture (middle button; left on empty canvas where the stage pans) marks the camera
   * `moved` at its start and cancels a pending reveal refit; a press on a token or for a tool
   * cancels it and re-arms it at the release (the drop), the camera still `fitted`.
   */
  const revealPress = useRef((_e: MouseEvent, _intent: PointerIntent) => {});
  revealPress.current = (e, intent) => {
    if (!refitsOnReveal(client) || intent === "ignore") return;
    if (intent === "pan") {
      reveal.gesture();
      onCamera("pan");
      return;
    }
    if (e.button !== 0) return;
    const stage = stageRef.current;
    let onToken = false;
    if (stage) {
      stage.setPointersPositions(e);
      const p = stage.getPointerPosition();
      // FR-MAP-89 (1): the token or its label row (name, marker, badges).
      onToken = p !== null && tokenIdAt(stage, p) !== null;
    }
    if (intent === "canvas" && !onToken && stagePans(tool, spaceRef.current)) {
      reveal.gesture();
      onCamera("pan");
    } else {
      reveal.press();
    }
  };
  useEffect(() => {
    const up = () => reveal.release();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [reveal]);

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
      probe.snapshot();
    }
    prevStore.current = store;
  }, [store, previews, probe]);
  // FR-FOG-36: a blind player draws no other placer's templates, pings or laser (fog-of-war).
  const blind = client === "player" && isBlind(store, scene.id, myPlayerId);
  const blindRef = useRef(blind);
  blindRef.current = blind;
  const layerStore = useMemo(
    () => (blind ? blindStore(store, myPlayerId) : store),
    [blind, store, myPlayerId],
  );

  // ---- drag previews (FR-MAP-40): dropped on a `token` change, a scene switch or 3 s silence ----
  useEventFrame((f) => {
    clearPreviews(previews, tokenIdsOf(f.changes));
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a scene switch drops every preview.
  useEffect(() => {
    clearPreviews(previews);
    probe.clear();
  }, [scene.id, previews, probe]);
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
  /** FR-MAP-71 step (4): a right press on a layer menu, waiting for its release or a 4 px drag. */
  const rightRef = useRef<{
    screen: MenuPoint;
    p: MenuPoint;
    laser: boolean;
    menu: LayerContextMenu;
    ctx: LayerMenuContext;
  } | null>(null);
  useEffect(() => {
    if (live) return;
    for (const n of stageRef.current?.find(".map-token") ?? []) {
      if (n.isDragging()) n.stopDrag();
    }
    // Safety net: a drag whose `dragend` never reached `dragEnd` would repeat its preview frame
    // forever once live again; end it here and put the token back on its cell.
    const left = dragRef.current;
    if (left) {
      dragRef.current = null;
      left.abort();
      const node = stageRef.current?.find(".map-token").find((n) => n.id() === left.tokenId);
      node?.position(cellToPx(gridRef.current, left.from.col, left.from.row));
      previews.setState({ local: null });
    }
    pointers.setState({ drag: null });
    probe.clear();
    laser.current = null;
    rightRef.current = null;
  }, [live, pointers, previews, probe]);
  // Unmount mid-drag: no more frames or checks from this canvas.
  useEffect(
    () => () => {
      dragRef.current?.abort();
      probe.clear();
    },
    [probe],
  );

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
      const sent = sendIntent(MAP_INTENTS.moveToken, { tokenId: t.id, col, row });
      sent.then(settle, (err) => {
        settle();
        toastReject(err);
      });
      return sent;
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
        probe.start(t.id, { col: t.col, row: t.row }, probesDrag(client, t));
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
        probe.move(to);
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
        let settled: Promise<unknown> | undefined;
        const at = drag
          ? drag.finish(drop, liveRef.current, (to) => {
              settled = move(t, to.col, to.row);
            })
          : { col: t.col, row: t.row };
        // FR-FOG-54: the dragger's sight preview lasts until the drop's ack / reject.
        probe.finish(settled);
        node.position(cellToPx(gridRef.current, at.col, at.row));
        resizeRefit.current?.drop();
      },
      click(t, toggle) {
        if (!tokenTakesLeftPress(toolDefRef.current)) return;
        onTokenClick?.(t, toggle);
      },
      dblClick(t) {
        if (!tokenTakesLeftPress(toolDefRef.current)) return;
        onTokenDoubleClick?.(t);
      },
    }),
    [pointers, previews, probe, client, onTokenClick, onTokenDoubleClick, move, sendSignal],
  );

  // ---- incoming signals (FR-MAP-25): only for the scene this client shows ----
  const signalsFor = (data: unknown, schema: typeof PingData) => {
    const d = schema.safeParse(data);
    return d.success && signalForShownScene(d.data, scene.id) ? d.data : null;
  };
  useSignal(MAP_SIGNALS.ping, (s) => {
    const d = signalsFor(s.data, PingData);
    if (d && !blindRef.current) addPing(pointers, d.x, d.y, s.from, performance.now());
  });
  useSignal(MAP_SIGNALS.pull, (s) => {
    const d = signalsFor(s.data, PingData);
    if (!d) return;
    if (!blindRef.current) addPing(pointers, d.x, d.y, s.from, performance.now());
    // Forced recentre, zoom unchanged; players may pan away (OQ-MAP-08).
    if (client !== "player") return;
    setCam((c) => centreOn(c, d, size));
    onCamera("pull");
  });
  useSignal(MAP_SIGNALS.laser, (s) => {
    const d = LaserData.safeParse(s.data);
    if (!d.success || !signalForShownScene(d.data, scene.id) || blindRef.current) return;
    addTrailPoints(
      pointers,
      senderKey(s.from),
      s.from,
      d.data.points,
      d.data.end ?? false,
      performance.now(),
    );
  });
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
    stageRef.current?.draggable(stagePans(useMapTool.getState().tool, spaceRef.current));
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
      if (toolPress.current) {
        toolPress.current = false;
        const tp = e ? toolPointerRef.current(e) : null;
        if (tp) toolDefRef.current?.pointer?.up?.(tp);
      }
      const p = press.current;
      press.current = null;
      if (p && e) {
        const click = isClick(e.clientX - p.x, e.clientY - p.y);
        trackBox(e);
        const box = pointers.getState().box;
        if (boxing.current && box && !click) {
          // FR-SCN-05: tokens the DM-only items switch hides are not drawn, so not picked.
          const pickable = withoutDmOnly(shownRef.current, client, useLayerToggles.getState().off);
          onBoxSelect?.(tokensInBox(pickable, gridRef.current, box));
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
        addTrailPoints(pointers, SELF_KEY, self, [], true, performance.now());
      }
      // FR-MAP-71 (4): a release < 4 px from a deferred right press opens the layer's menu.
      const right = rightRef.current;
      rightRef.current = null;
      if (
        right &&
        e &&
        liveRef.current &&
        isClick(e.clientX - right.screen.x, e.clientY - right.screen.y)
      ) {
        right.menu.open(right.p, { x: e.clientX, y: e.clientY }, right.ctx);
      }
    },
    [pointers, client, self, onBoxSelect, onEmptyClick, endBox, trackBox],
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
      const target = escapeOrder(dragRef.current !== null, boxing.current, toolDefRef.current);
      if (!target) return;
      if (target === "tool") {
        // FR-SCN-06: Esc goes to the tool; it stops here only if a gesture was dropped.
        toolPress.current = false;
        if (toolDefRef.current?.pointer?.cancel?.("escape") === true) e.stopPropagation();
        return;
      }
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

  // ---- canvas tools: stage events → the active tool (FR-SCN-06, FR-FOG-17) ----
  toolPointerRef.current = (evt) => {
    const stage = stageRef.current;
    if (!stage) return null;
    stage.setPointersPositions(evt);
    const p = stage.getRelativePointerPosition();
    if (!p) return null;
    const g = gridRef.current;
    return {
      x: p.x,
      y: p.y,
      cell: pxToCell(g, p.x, p.y),
      vertex: pxToVertex(g, p.x, p.y),
      screen: { x: evt.clientX, y: evt.clientY },
      button: evt.button,
      ctrl: evt.ctrlKey || evt.metaKey,
      shift: evt.shiftKey,
      alt: evt.altKey,
      clicks: evt.detail,
      client,
      scene: sceneRef.current,
      grid: g,
      intent: sendIntent,
      signal: sendSignal,
    };
  };
  // Space + drag pans with any tool; typing in a field keeps Space. A focused control presses on
  // Space when Tab put focus there or the pointer is off the map; focused by the pointer (e.g. a
  // fog bar toggle just clicked) with the pointer over the map, Space pans and never presses it
  // (FR-SHELL-83, #199, FR-FOG-17).
  useEffect(() => {
    trackFocusModality(document);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const opts = { keyboard: isKeyboardFocus(e.target), overMap: overMap.current };
      if (spaceAction(e.target, opts) === "browser") return;
      e.preventDefault();
      spaceTaken.current = true;
      if (!spaceRef.current) setSpace(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (spaceTaken.current) e.preventDefault();
      spaceTaken.current = false;
      setSpace(false);
    };
    const blur = () => {
      spaceTaken.current = false;
      setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  // A gesture in progress is dropped on a tool switch, a scene switch, leaving `live` and unmount
  // (FR-SCN-34, FR-FOG-22).
  useEffect(
    () => () => {
      toolPress.current = false;
      toolDef?.pointer?.cancel?.("tool");
    },
    [toolDef],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a scene switch drops the gesture.
  useEffect(
    () => () => {
      toolPress.current = false;
      toolDefRef.current?.pointer?.cancel?.("scene");
    },
    [scene.id],
  );
  useEffect(() => {
    if (live) return;
    toolPress.current = false;
    toolDefRef.current?.pointer?.cancel?.("live");
  }, [live]);

  /** FR-MAP-89 (1): the token whose label row (not its node) is under the pointer, if any. */
  const labelTokenAt = (): TokenView | null => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    const id = stage && p ? labelHitAt(labelRowItems(stage), p) : null;
    return (id && tokensRef.current.find((t) => t.id === id)) || null;
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = mapPoint();
    if (!p) return;
    const onToken = tokenNodeOf(e.target) !== null;
    if (e.evt.button === 2) {
      // FR-MAP-71: doors' and props' menus never get here (`cancelBubble`).
      rightRef.current = null;
      const isLive = liveRef.current;
      // A drawing tool may take the right press for its own menu (FR-FOG-42).
      const menuTool = !onToken && drawingRef.current && isLive ? toolDefRef.current : null;
      const tp = menuTool?.pointer?.menu ? toolPointerRef.current(e.evt) : null;
      const toolMenu = tp !== null && menuTool?.pointer?.menu?.(tp) === true;
      const menuCtx: LayerMenuContext = { ...ctx, off: useLayerToggles.getState().off };
      const asks = isLive && !toolMenu && !(onToken && client === "dm");
      const hit = asks ? layerMenuAt(canvasLayers, p, menuCtx) : null;
      const action = rightPress({
        client,
        live: isLive,
        signalsLive,
        nodeMenu: false,
        onToken,
        toolMenu,
        layerHit: hit !== null,
      });
      if (action.kind === "deferred" && hit?.contextMenu) {
        const screen = { x: e.evt.clientX, y: e.evt.clientY };
        rightRef.current = { screen, p, laser: action.laser, menu: hit.contextMenu, ctx: menuCtx };
      } else if (action.kind === "laser") {
        startLaser([p]);
      }
      return;
    }
    if (e.evt.button !== 0) return;
    const def = toolDefRef.current;
    // FR-MAP-89 (1): a left press on a token's label row is one on the token (no empty click).
    const onTokenRow = onToken || labelTokenAt() !== null;
    if (drawingRef.current) {
      // FR-SCN-06: a drawing tool takes the left press (Space held: the stage pans instead).
      if (!pressGoesToTool(def, { button: 0, space: spaceRef.current, live: liveRef.current })) {
        return;
      }
      toolPress.current = true;
      const tp = toolPointerRef.current(e.evt);
      if (tp) def?.pointer?.down?.(tp);
      return;
    }
    if (spaceRef.current && tool !== "select") return;
    if (tool === "ruler") {
      const cell = pxToCell(gridRef.current, p.x, p.y);
      ruling.current = true;
      pointers.setState({ ruler: { from: cell, to: cell } });
    } else if (tool === "ping") {
      if (!signalsLive) return;
      const data = { sceneId: scene.id, x: p.x, y: p.y };
      const pull = client === "dm" && e.evt.shiftKey;
      sendSignal(pull ? MAP_SIGNALS.pull : MAP_SIGNALS.ping, data);
      addPing(pointers, p.x, p.y, self, performance.now(), true);
    } else {
      press.current = { x: e.evt.clientX, y: e.evt.clientY, onToken: onTokenRow };
      if (!onTokenRow && onBoxSelect && (e.evt.ctrlKey || e.evt.shiftKey)) {
        // Box select instead of pan (FR-MAP-12 / -32).
        boxing.current = true;
        stageRef.current?.draggable(false);
        pointers.setState({ box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } });
      }
    }
  };

  /** FR-MAP-24: this client's laser from `points` (a deferred one from its press point). */
  const startLaser = (points: readonly MenuPoint[]) => {
    const sender = new LaserSender(scene.id, (d) => sendSignal(MAP_SIGNALS.laser, d));
    laser.current = sender;
    for (const q of points) sender.push(q.x, q.y);
    const trail = points.map((q): [number, number] => [q.x, q.y]);
    addTrailPoints(pointers, SELF_KEY, self, trail, false, performance.now());
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // A middle pan keeps the map point under the pointer: nothing for the tools (FR-MAP-12).
    if (pan.active) return;
    // FR-MAP-71 (4): a deferred right press dragged ≥ 4 px is the laser (or nothing on a token).
    const right = rightRef.current;
    if (right) {
      const dx = e.evt.clientX - right.screen.x;
      const dy = e.evt.clientY - right.screen.y;
      const step = deferredMove(right.laser && signalsLive, dx, dy);
      if (step !== "menu") rightRef.current = null;
      // Its first point is the press point; this move's point follows below.
      if (step === "laser") startLaser([right.p]);
    }
    if (drawingRef.current && liveRef.current && !spaceRef.current) {
      const tp = toolPointerRef.current(e.evt);
      if (tp) toolDefRef.current?.pointer?.move?.(tp);
    }
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
      addTrailPoints(pointers, SELF_KEY, self, [[p.x, p.y]], false, performance.now());
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
    // FR-MAP-82: a zoom gesture cancels a pending reveal refit.
    reveal.gesture();
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
    probe,
    tool,
    activeTool: toolDef,
    drawing,
    live,
    myPlayerId,
    selected,
    targeting,
    store: layerStore,
    canMove,
    token: tokenHandlers,
  };

  // FR-SCN-02/03/05: this client's layers; DM toggles that are off drop theirs. FR-MAP-29: in at
  // most four Konva layers (BL-07).
  const layersOff = useLayerToggles((s) => s.off);
  const layers = useMemo(
    () => stageLayers(layerSlots(canvasLayers, client, layersOff)),
    [client, layersOff],
  );

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
      // FR-SHELL-83: a press on the map takes focus off the last control clicked.
      tabIndex={-1}
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      data-scene-id={scene.id}
      data-tool={tool}
      data-drawing={drawing}
      data-space-pan={space}
      data-panning={panning ? "middle" : undefined}
      data-targeting={targeting}
      onPointerEnter={() => {
        overMap.current = true;
      }}
      onPointerLeave={() => {
        overMap.current = false;
      }}
      data-camera={cameraMode}
      data-cell-px={Math.round(cam.scale * grid.gridCellSize)}
      data-fit-floor={fitFloor}
      data-fit-visible={fitVisible}
      data-fit-rect={fitRect}
      data-fit-reason={fitReason}
      data-loading={loading}
      className="absolute inset-0 outline-none"
      style={{
        cursor: panning
          ? "grabbing"
          : space
            ? "grab"
            : toolDef
              ? (toolDef.cursor ?? "crosshair")
              : tool === "select" && !targeting
                ? undefined
                : "crosshair",
      }}
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
          draggable={stagePans(tool, space)}
          onDragEnd={(e) => {
            const stage = stageRef.current;
            if (!stage || e.target !== stage) return;
            setCam((c) => ({ ...c, x: stage.x(), y: stage.y() }));
            onCamera("pan");
          }}
          onWheel={onWheel}
          onDblClick={(e) => {
            // FR-MAP-89 (1): a double-click on a label row is one on its token (FR-MAP-77).
            if (tokenNodeOf(e.target) !== null) return;
            const t = labelTokenAt();
            if (t) tokenHandlers.dblClick(t);
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onContextMenu={onContextMenu}
        >
          <SyncContext.Provider value={syncStore}>
            <CanvasContext.Provider value={ctx}>
              {layers.map((layer) => (
                // The fog layer never takes pointer events: no hit canvas for it.
                <Layer key={layer.key} name={layer.name} listening={layer.key !== "fog"}>
                  {layer.slots.map((slot) => {
                    // FR-MAP-29: each registry entry is a Group named by its id.
                    const entries = slot.layers.map((l) => {
                      const C = l.component as React.ComponentType;
                      return (
                        <Group key={l.id} name={l.id}>
                          <C />
                        </Group>
                      );
                    });
                    // FR-SCN-03: same-group neighbours share one more Group (`scn-objects`).
                    return slot.group === null ? (
                      entries
                    ) : (
                      <Group key={slot.key} name={slot.group}>
                        {entries}
                      </Group>
                    );
                  })}
                </Layer>
              ))}
            </CanvasContext.Provider>
          </SyncContext.Provider>
        </Stage>
      )}
      <FogBlindChip blind={blind} />
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            data-testid="map-scene-loading"
            role="status"
            className="rounded-md bg-background/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm"
          >
            Loading scene…
          </span>
        </div>
      )}
    </div>
  );
}
