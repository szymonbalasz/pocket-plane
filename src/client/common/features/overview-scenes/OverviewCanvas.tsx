// The overview canvas (OVW §6.2, ADR-0075 Decision 4), both clients: a react-konva Stage with the
// items in their bands (FR-OVW-19), per-client camera (FR-OVW-11, -12), ping / pull / laser with the
// overview's ID as `sceneId` (FR-OVW-13), and the seam for the editing slices: every stage pointer
// event goes to the active tool of `overview-tools.ts`. `MapCanvas` is not involved: no grid,
// tokens, fog, walls or templates. No feature logic: the server decides.
import { ItemDragData, OVW_SIGNALS } from "@shared/overview-scenes/schemas";
import { LaserData, MAP_SIGNALS, PingData } from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Stage } from "react-konva";
import { SyncContext, useEventFrame, useSendSignal, useSignal, useSync } from "../../sync/store";
import { useFreeArea } from "../play-shell/free-area";
import { isKeyboardFocus, spaceAction, trackFocusModality } from "../play-shell/keys";
import {
  type Camera,
  type CameraEvent,
  type CameraMode,
  cameraOn,
  centreOn,
  createSettledRefit,
  placerSettled,
  zoomAt,
} from "../scenes-map/camera";
import { CanvasContext, type CanvasContextValue } from "../scenes-map/canvas-context";
import { clearPreviews, prunePreviews } from "../scenes-map/drag-preview";
import { useLive, useMapIntent } from "../scenes-map/intents";
import { LaserSender } from "../scenes-map/laser";
import type { CanvasClient } from "../scenes-map/layers";
import { PointersLayer } from "../scenes-map/layers/PointersLayer";
import { selfOf } from "../scenes-map/mark-colors";
import { createMiddlePan, type MiddlePan } from "../scenes-map/middle-pan";
import { isSnapshotStore, signalForShownScene } from "../scenes-map/overlay";
import {
  addPing,
  addTrailPoints,
  createPointerStore,
  SELF_KEY,
  senderKey,
} from "../scenes-map/pointers";
import { deferredMove } from "../scenes-map/right-press";
import { isClick } from "../scenes-map/selection-logic";
import { useCanvasColors } from "../scenes-map/theme";
import { useMapFit, useMapTool } from "../scenes-map/tool-store";
import { fontsIn, itemBands, type OverviewItemView } from "./item-layout";
import { ItemNode } from "./items/ItemNode";
import { measureText, useLabelFonts } from "./label-fonts";
import { OverviewEditorHost } from "./OverviewEditorHost";
import { fitOverview, itemsBox, rememberCamera, rememberedCamera } from "./overview-camera";
import {
  OverviewCanvasContext,
  type OverviewCanvasContextValue,
  useOverviewTool,
} from "./overview-canvas-context";
import { itemIdsOf, itemPreviews, receiveItemDrag } from "./overview-drag";
import { drawnGesture, previewOf, publishItems, useOverviewEditor } from "./overview-editor";
import { activeOverviewTool, type OverviewPointer } from "./overview-tools";
import { SelectionLayer } from "./SelectionLayer";

export interface OverviewCanvasProps {
  client: CanvasClient;
  overviewId: string;
  /** The items of this overview the client holds. */
  items: readonly OverviewItemView[];
  myPlayerId: string | null;
  /** Ping, pull and laser on (DM: only while players see this overview, FR-OVW-10). */
  signalsOn: boolean;
  /** DM: the overview's items are still loading (ADR-0041); the first Fit waits for them. */
  loading?: boolean;
}

/** FR-OVW-11: as the map's guard, a middle release never ends a left drag (see MapCanvas). */
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

const NO_GRID = {
  gridCellSize: 1,
  gridOffsetX: 0,
  gridOffsetY: 0,
  gridVisible: false,
  gridColor: "",
  gridOpacity: 0,
};
const NO_TOKENS: CanvasContextValue["tokens"] = [];

export function OverviewCanvas(props: OverviewCanvasProps) {
  const { client, overviewId, items, myPlayerId, signalsOn } = props;
  const loading = props.loading === true;
  const self = useMemo(() => selfOf(client, myPlayerId), [client, myPlayerId]);
  const syncStore = useContext(SyncContext);
  const store = useSync((s) => s.store);
  const box = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useSize(box);
  const colors = useCanvasColors();
  const live = useLive();
  const liveRef = useRef(live);
  liveRef.current = live;
  const sendIntent = useMapIntent();
  const sendSignal = useSendSignal();
  const [pointers] = useState(createPointerStore);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // The tool panel reads the mounted canvas's client from the map's store.
  useEffect(() => useMapTool.setState({ client }), [client]);
  // Before paint: what the Select tool hits, and a just-gone item's selection, never lag a frame.
  useLayoutEffect(() => publishItems(overviewId, items), [overviewId, items]);

  // ---- tools (FR-OVW-13) ----
  const toolId = useOverviewTool((s) => s.tool);
  const tool = activeOverviewTool(toolId, client);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const toolPress = useRef(false);
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(space);
  spaceRef.current = space;
  const overCanvas = useRef(false);
  const spaceTaken = useRef(false);
  const stagePans = tool.pans === true || space;
  const stagePansRef = useRef(stagePans);
  stagePansRef.current = stagePans;

  // ---- camera (FR-OVW-11, -12) ----
  const [cam, setCam] = useState<Camera>(
    () => rememberedCamera(overviewId) ?? { x: 0, y: 0, scale: 1 },
  );
  const [cameraMode, setCameraMode] = useState<CameraMode>("fitted");
  const [fitRect, setFitRect] = useState("");
  const free = useFreeArea();
  const freeRef = useRef(free);
  freeRef.current = free;
  /** The first Fit on this page has been asked for, or isn't needed (FR-OVW-12). */
  const opened = useRef(rememberedCamera(overviewId) !== null);
  /** The camera has a place worth keeping: `cam` isn't the start value of a first open. */
  const framed = useRef(opened.current);
  const onCamera = (e: CameraEvent) => setCameraMode((m) => cameraOn(m, e).mode);
  const fitNow = useRef(() => {});
  fitNow.current = () => {
    if (size.w === 0) return;
    const fit = fitOverview(itemsBox(itemsRef.current, measureText), size, free.room);
    framed.current = true;
    setCam({ x: fit.x, y: fit.y, scale: fit.scale });
    setFitRect(fit.rect ? `${fit.rect.x},${fit.rect.y},${fit.rect.w},${fit.rect.h}` : "");
    onCamera("fit");
  };
  // As the map's load fit (FR-MAP-96): after the placer has settled its windows.
  const [settledFit] = useState(() =>
    createSettledRefit(
      () => fitNow.current(),
      () => placerSettled(freeRef.current, "open", { w: window.innerWidth, h: window.innerHeight }),
    ),
  );
  useEffect(() => () => settledFit.dispose(), [settledFit]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new items, windows or a size re-arm a pending first Fit.
  useEffect(() => settledFit.applied(), [settledFit, items, free.obstacles, size]);
  useEffect(() => {
    if (opened.current || size.w === 0 || !free.ready || loading) return;
    opened.current = true;
    settledFit.request();
  }, [size.w, free.ready, loading, settledFit]);
  useEffect(() => {
    if (framed.current) rememberCamera(overviewId, cam);
  }, [overviewId, cam]);
  useLayoutEffect(() => {
    useOverviewEditor.setState({ view: { ...cam, w: size.w, h: size.h } });
  }, [cam, size]);
  // FR-OVW-22: an empty overview's first image: the camera fits once it has landed.
  useEffect(() => {
    if (items.length === 0 || useOverviewEditor.getState().fitOnArrival !== overviewId) return;
    useOverviewEditor.setState({ fitOnArrival: null });
    fitNow.current();
  }, [items, overviewId]);
  useEffect(
    () =>
      useMapFit.subscribe((s, prev) => {
        if (s.requests !== prev.requests) fitNow.current();
      }),
    [],
  );
  // FR-SHELL-80: Reset layout runs one Fit, with the windows it wrote.
  const seenFits = useRef(free.fitRequests);
  useEffect(() => {
    if (free.fitRequests === seenFits.current) return;
    seenFits.current = free.fitRequests;
    fitNow.current();
  }, [free.fitRequests]);

  // ---- FR-OVW-11: the middle mouse pans with any tool, before Konva and the tools ----
  const [panning, setPanning] = useState(false);
  const [pan] = useState(() =>
    createMiddlePan({
      position: () => {
        const s = stageRef.current;
        return s ? { x: s.x(), y: s.y() } : { x: 0, y: 0 };
      },
      move: (x, y) => stageRef.current?.position({ x, y }),
      end: (at) => {
        if (!at) return;
        setCam((c) => ({ ...c, ...at }));
        setCameraMode((m) => cameraOn(m, "pan").mode);
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
      pan.press(e, { tool: null, space: spaceRef.current, live: liveRef.current });
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

  // ---- signals (FR-OVW-13): only for the overview this client shows ----
  const signalsLive = signalsOn && live;
  const signalsLiveRef = useRef(signalsLive);
  signalsLiveRef.current = signalsLive;
  useSignal(MAP_SIGNALS.ping, (s) => {
    const d = PingData.safeParse(s.data);
    if (d.success && signalForShownScene(d.data, overviewId)) {
      addPing(pointers, d.data.x, d.data.y, s.from, performance.now());
    }
  });
  useSignal(MAP_SIGNALS.pull, (s) => {
    const d = PingData.safeParse(s.data);
    if (!d.success || !signalForShownScene(d.data, overviewId)) return;
    addPing(pointers, d.data.x, d.data.y, s.from, performance.now());
    // Forced recentre, zoom unchanged; players may pan away (OQ-MAP-08).
    if (client !== "player") return;
    setCam((c) => centreOn(c, d.data, size));
    onCamera("pull");
  });
  useSignal(MAP_SIGNALS.laser, (s) => {
    const d = LaserData.safeParse(s.data);
    if (!d.success || !signalForShownScene(d.data, overviewId)) return;
    addTrailPoints(
      pointers,
      senderKey(s.from),
      s.from,
      d.data.points,
      d.data.end ?? false,
      performance.now(),
    );
  });

  // ---- FR-OVW-37: others' drags; dropped on a change of the item, a snapshot or 3 s of silence ----
  useSignal(OVW_SIGNALS.drag, (s) => {
    const d = ItemDragData.safeParse(s.data);
    if (!d.success) return;
    const held = new Set(itemsRef.current.map((i) => i.id));
    const g = useOverviewEditor.getState().gesture;
    const dragging = g?.kind === "move" ? g.ids : [];
    const view = { overviewId, holds: (id: string) => held.has(id), dragging };
    receiveItemDrag(d.data, view, performance.now());
  });
  useEventFrame((f) => clearPreviews(itemPreviews, itemIdsOf(f.changes)));
  const prevStore = useRef(store);
  useEffect(() => {
    if (isSnapshotStore(prevStore.current, store)) clearPreviews(itemPreviews);
    prevStore.current = store;
  }, [store]);
  useEffect(() => {
    const id = setInterval(() => prunePreviews(itemPreviews, performance.now()), 250);
    return () => {
      clearInterval(id);
      clearPreviews(itemPreviews);
    };
  }, []);

  // ---- pointer gestures ----
  const laser = useRef<LaserSender | null>(null);
  const startLaser = (points: readonly { x: number; y: number }[]) => {
    const sender = new LaserSender(overviewId, (d) => sendSignal(MAP_SIGNALS.laser, d));
    laser.current = sender;
    for (const q of points) sender.push(q.x, q.y);
    const trail = points.map((q): [number, number] => [q.x, q.y]);
    addTrailPoints(pointers, SELF_KEY, self, trail, false, performance.now());
  };
  /** FR-MAP-71 (4): a right press a tool's menu may take on its release; ≥ 4 px is the laser. */
  const rightRef = useRef<{
    screen: { x: number; y: number };
    p: { x: number; y: number };
    open: () => void;
  } | null>(null);
  /** A stage pointer event as the active tool receives it. */
  const pointerOf = useRef((_evt: MouseEvent): OverviewPointer | null => null);
  pointerOf.current = (evt) => {
    const stage = stageRef.current;
    if (!stage) return null;
    stage.setPointersPositions(evt);
    const p = stage.getRelativePointerPosition();
    const at = stage.getPointerPosition();
    if (!p || !at) return null;
    const id = stage.getIntersection(at)?.findAncestor(".ovw-item", true)?.id();
    return {
      x: p.x,
      y: p.y,
      screen: { x: evt.clientX, y: evt.clientY },
      button: evt.button,
      ctrl: evt.ctrlKey || evt.metaKey,
      shift: evt.shiftKey,
      alt: evt.altKey,
      clicks: evt.detail,
      client,
      overviewId,
      myPlayerId,
      item: (id && itemsRef.current.find((i) => i.id === id)) || null,
      live: liveRef.current,
      signalsLive: signalsLiveRef.current,
      scale: stage.scaleX(),
      intent: sendIntent,
      signal: sendSignal,
      markPing: (x, y) => addPing(pointers, x, y, self, performance.now(), true),
      holdPan: () => {
        stage.draggable(false);
        // Konva fires a snapshot of its listeners: a drag listener behind this handler (re-added on
        // the last release) still runs and arms a drag. Off once more after the dispatch disarms it.
        queueMicrotask(() => {
          if (stage.draggable()) return;
          stage.draggable(true);
          stage.draggable(false);
        });
      },
    };
  };
  useEffect(() => {
    const up = (e: PointerEvent) => {
      if (toolPress.current) {
        toolPress.current = false;
        const tp = pointerOf.current(e);
        if (tp) toolRef.current.pointer?.up?.(tp);
        stageRef.current?.draggable(stagePansRef.current);
      }
      if (laser.current) {
        laser.current.end();
        laser.current = null;
        addTrailPoints(pointers, SELF_KEY, self, [], true, performance.now());
      }
      const right = rightRef.current;
      rightRef.current = null;
      if (
        right &&
        liveRef.current &&
        isClick(e.clientX - right.screen.x, e.clientY - right.screen.y)
      ) {
        right.open();
      }
    };
    // A press follows the pointer over windows too; over the canvas Konva's own event brings it.
    const move = (e: PointerEvent) => {
      if (!toolPress.current || box.current?.contains(e.target as Node)) return;
      const tp = pointerOf.current(e);
      if (tp) toolRef.current.pointer?.move?.(tp);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointermove", move);
    };
  }, [pointers, self]);
  /** A press given up: its `holdPan` ends here, as no release will reach the tool. */
  const dropPress = useRef(() => {
    toolPress.current = false;
    stageRef.current?.draggable(stagePansRef.current);
  });
  // Esc goes to the tool first; it stops there only if a gesture was dropped.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dropPress.current();
      if (toolRef.current.pointer?.cancel?.("escape") === true) e.stopPropagation();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);
  // A gesture in progress is dropped on a tool switch, on leaving `live` and on unmount.
  useEffect(
    () => () => {
      dropPress.current();
      tool.pointer?.cancel?.("tool");
    },
    [tool],
  );
  useEffect(() => {
    if (live) return;
    dropPress.current();
    toolRef.current.pointer?.cancel?.("live");
    laser.current = null;
    rightRef.current = null;
  }, [live]);
  // Space + drag pans with any tool, as on the map (FR-SHELL-83).
  useEffect(() => {
    trackFocusModality(document);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const opts = { keyboard: isKeyboardFocus(e.target), overMap: overCanvas.current };
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

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const tp = pointerOf.current(e.evt);
    if (!tp) return;
    if (e.evt.button === 2) {
      rightRef.current = null;
      if (!liveRef.current) return;
      const taken = tool.pointer?.menu?.(tp);
      if (taken === true) return;
      if (typeof taken === "function") {
        rightRef.current = { screen: tp.screen, p: { x: tp.x, y: tp.y }, open: taken };
      } else if (signalsLive) {
        startLaser([{ x: tp.x, y: tp.y }]);
      }
      return;
    }
    if (e.evt.button !== 0 || spaceRef.current) return;
    toolPress.current = true;
    tool.pointer?.down?.(tp);
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (pan.active) return;
    const right = rightRef.current;
    if (right) {
      const dx = e.evt.clientX - right.screen.x;
      const dy = e.evt.clientY - right.screen.y;
      const step = deferredMove(signalsLive, dx, dy);
      if (step !== "menu") rightRef.current = null;
      if (step === "laser") startLaser([right.p]);
    }
    if (tool.pointer?.move && !spaceRef.current) {
      const tp = pointerOf.current(e.evt);
      if (tp) tool.pointer.move(tp);
    }
    if (!laser.current) return;
    const p = stageRef.current?.getRelativePointerPosition();
    if (!p) return;
    laser.current.push(p.x, p.y);
    addTrailPoints(pointers, SELF_KEY, self, [[p.x, p.y]], false, performance.now());
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    setCam((c) => zoomAt(c, p, e.evt.deltaY));
    onCamera("zoom");
  };

  // ---- drawing ----
  const fontRev = useLabelFonts(useMemo(() => fontsIn(items), [items]));
  useEffect(() => useOverviewEditor.setState({ fontRev }), [fontRev]);
  const bands = useMemo(() => itemBands(items), [items]);
  const gesture = useOverviewEditor(drawnGesture);
  const editorCursor = useOverviewEditor((s) => s.cursor);
  const context = useMemo<OverviewCanvasContextValue>(
    () => ({ client, overviewId, colors, live, myPlayerId }),
    [client, overviewId, colors, live, myPlayerId],
  );
  // `PointersLayer` draws pings and laser trails from these fields only (no ruler, drag or box is
  // ever set here), so the marks stay one implementation; the rest of the value is the battle map's.
  const marks = {
    grid: NO_GRID,
    tokens: NO_TOKENS,
    cam,
    colors,
    pointers,
    store,
  } as unknown as CanvasContextValue;
  const band = (list: readonly OverviewItemView[], name: string) => (
    <Group name={name}>
      {list.map((item) => (
        <ItemNode
          key={item.id}
          item={item}
          preview={previewOf(gesture, item)}
          scale={item.hidden ? cam.scale : 1}
          fontRev={fontRev}
        />
      ))}
    </Group>
  );
  const ToolLayer = tool.layer as React.ComponentType | undefined;
  const ToolOverlay = tool.overlay as React.ComponentType | undefined;

  return (
    <>
      <div
        ref={box}
        data-testid="ovw-canvas"
        role="application"
        aria-label="Overview canvas"
        // FR-SHELL-83: a press on the canvas takes focus off the last control clicked.
        tabIndex={-1}
        onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
        onPointerEnter={() => {
          overCanvas.current = true;
        }}
        onPointerLeave={() => {
          overCanvas.current = false;
        }}
        onContextMenu={(e) => e.preventDefault()}
        data-overview-id={overviewId}
        data-tool={tool.id}
        data-space-pan={space}
        data-panning={panning ? "middle" : undefined}
        data-camera={cameraMode}
        data-zoom={Math.round(cam.scale * 100)}
        data-fit-rect={fitRect}
        data-loading={loading}
        className="absolute inset-0 outline-none"
        style={{
          cursor: panning
            ? "grabbing"
            : space
              ? "grab"
              : (editorCursor ?? tool.cursor ?? (tool.pans ? undefined : "crosshair")),
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
            draggable={stagePans}
            onDragEnd={(e) => {
              const stage = stageRef.current;
              if (!stage || e.target !== stage) return;
              setCam((c) => ({ ...c, x: stage.x(), y: stage.y() }));
              onCamera("pan");
            }}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
          >
            <SyncContext.Provider value={syncStore}>
              <OverviewCanvasContext.Provider value={context}>
                {/* OVW §12: the marks' 20 frames/s never redraw the items' layer. */}
                <Layer name="ovw-layer-items">
                  {band(bands.image, "ovw-band-image")}
                  {band(bands.label, "ovw-band-label")}
                  {band(bands.miniature, "ovw-band-miniature")}
                </Layer>
                <Layer name="ovw-layer-top">
                  {client === "dm" && <SelectionLayer />}
                  {ToolLayer && <ToolLayer />}
                  <CanvasContext.Provider value={marks}>
                    <PointersLayer />
                  </CanvasContext.Provider>
                </Layer>
              </OverviewCanvasContext.Provider>
            </SyncContext.Provider>
          </Stage>
        )}
        {ToolOverlay && (
          <OverviewCanvasContext.Provider value={context}>
            <ToolOverlay />
          </OverviewCanvasContext.Provider>
        )}
        {/* OVW §7: "Add an image to begin" for the DM; a plain canvas for players. */}
        {client === "dm" && !loading && items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p data-testid="ovw-canvas-empty" className="text-sm text-muted-foreground">
              Add an image to begin
            </p>
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              data-testid="ovw-scene-loading"
              role="status"
              className="rounded-md bg-background/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm"
            >
              Loading scene…
            </span>
          </div>
        )}
      </div>
      {/* Outside the box: React bubbles a menu's press through its portal, and the box's focus on
          press would dismiss the menu before the entry's click. */}
      {client === "dm" && <OverviewEditorHost />}
    </>
  );
}
