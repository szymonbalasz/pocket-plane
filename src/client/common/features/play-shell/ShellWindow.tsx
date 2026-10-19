// One floating window: title bar (drag), minimise / close, edge + corner resize, scrolling body
// (FR-SHELL-10/11). Drag and resize move the element by CSS only; the store is written once,
// on pointer up (SHELL §12). A minimised window stays mounted, parked: invisible and inert
// (FR-SHELL-36). `visibility`, not `display: none`, so its scroll positions survive. A
// `growToContent` type measures its content and reports the height it needs (FR-SHELL-39).
import type { WindowState } from "@shared/play-shell/layout";
import { MinusIcon, XIcon } from "lucide-react";
import {
  Component,
  createContext,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { reportContentHeight } from "./content-heights";
import { useGrowthCaps } from "./free-area";
import {
  growsToContent,
  moveRect,
  type Rect,
  type ResizeEdge,
  renderedRect,
  resizeRect,
  type Viewport,
  windowRect,
} from "./geometry";
import { SHELL_ZONE_ATTR } from "./keys";
import { type Placed, type WindowAction, windowId } from "./manager";
import type { WindowDef } from "./registry";

function applyRect(el: HTMLElement, r: Rect) {
  el.style.transform = `translate(${r.x}px, ${r.y}px)`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

const EDGES: { edge: ResizeEdge; className: string; testId?: string }[] = [
  { edge: "e", className: "right-0 top-8 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "w", className: "left-0 top-8 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "s", className: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { edge: "sw", className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
  {
    edge: "se",
    className:
      "bottom-0 right-0 size-3 cursor-nwse-resize border-r-2 border-b-2 border-muted-foreground/50 rounded-br-md",
    testId: "ui-window-resize",
  },
];

class WindowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("window body failed", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return <p className="text-sm text-destructive">This window failed to render.</p>;
    }
    return this.props.children;
  }
}

const WindowShown = createContext(true);

/**
 * False while the window around the caller is minimised (FR-SHELL-36: mounted, not shown).
 * For bodies whose effects mean "the user sees this" (e.g. marking things seen). Outside a
 * window: true.
 */
export function useWindowShown(): boolean {
  return useContext(WindowShown);
}

export function ShellWindow({
  win,
  def,
  placed,
  settling,
  autoMinimised,
  viewport,
  focused,
  dispatch,
}: {
  win: WindowState;
  def: WindowDef;
  /** How its current rect was chosen (FR-SHELL-40; walkthroughs read `data-placed`). */
  placed?: Placed | undefined;
  /** Just placed by a feature open / appearance / auto placement: settle after first layout. */
  settling?: boolean;
  /** Minimised to make room for another window (FR-SHELL-47; `data-auto-minimised`). */
  autoMinimised?: boolean;
  viewport: Viewport;
  focused: boolean;
  dispatch: (a: WindowAction) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const grows = growsToContent(win, def);
  const wid = windowId(win.kind, win.instance);
  const needed = useNeededHeight(wid, grows, ref, bodyRef, contentRef);
  const caps = useGrowthCaps(wid);
  // Measured heights are reported as they are taken; a window that stops growing reports none.
  useEffect(() => {
    if (!grows) reportContentHeight(wid, null);
  }, [wid, grows]);
  useEffect(() => () => reportContentHeight(wid, null), [wid]);
  // FR-SHELL-40, -41: once the real height is laid out (before paint), place it again if needed.
  const open = win.state === "open";
  useLayoutEffect(() => {
    if (settling && open && (!grows || needed !== undefined)) {
      dispatch({ type: "settle", kind: win.kind, instance: win.instance });
    }
  }, [settling, open, grows, needed, dispatch, win.kind, win.instance]);
  // Render-only fit to the work area, then clamp (FR-SHELL-29, -12), then grow to content
  // (FR-SHELL-39), capped by the next window or hard keep-out (FR-SHELL-52); a gesture starts here
  // and its end stores the result with the current work area.
  const rect = windowRect(win, def, viewport, needed, caps);
  const id = { kind: win.kind, instance: win.instance };
  const parked = win.state === "minimised";
  const Body = def.component;

  /**
   * What a move stores: growth is never written (FR-SHELL-39), so the stored height stays, and a
   * window grown upwards keeps the bottom the user dropped it at.
   */
  function movedRect(last: Rect): Rect {
    const base = renderedRect(win, def.minSize, viewport);
    if (last.h === base.h) return last;
    const up = rect.y !== base.y;
    return { ...last, y: up ? last.y + last.h - base.h : last.y, h: base.h };
  }

  /** Pointer-capture gesture; `compute` maps the pointer delta to a rect. */
  function gesture(
    e: React.PointerEvent<HTMLElement>,
    kind: "move" | "resize",
    compute: (dx: number, dy: number) => Rect,
  ) {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault(); // no text selection; so move focus into the window ourselves
    el.focus({ preventScroll: true });
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    let last: Rect | null = null;
    const move = (ev: PointerEvent) => {
      last = compute(ev.clientX - sx, ev.clientY - sy);
      applyRect(el, last);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (
        last &&
        (last.x !== rect.x || last.y !== rect.y || last.w !== rect.w || last.h !== rect.h)
      ) {
        if (kind === "resize") dispatch({ type: "setRect", ...id, rect: last, resized: true });
        else dispatch({ type: "setRect", ...id, rect: movedRect(last) });
      } else {
        applyRect(el, rect);
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return (
    <section
      ref={ref}
      {...{ [SHELL_ZONE_ATTR]: "window" }}
      data-testid="ui-window"
      data-record-id={wid}
      data-state={win.state}
      data-placed={placed}
      data-auto-minimised={(parked && autoMinimised) || undefined}
      data-focused={focused}
      aria-label={def.title}
      aria-hidden={parked || undefined}
      inert={parked}
      // Focusable, so clicks anywhere inside move keyboard focus here (FR-SHELL-13).
      tabIndex={-1}
      className={cn(
        "pointer-events-auto absolute outline-none left-0 top-0 flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg",
        focused && "border-ring",
        parked && "invisible",
      )}
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.w,
        height: rect.h,
        zIndex: win.z,
      }}
      onPointerDownCapture={() => dispatch({ type: "focus", ...id })}
    >
      <div
        data-testid="ui-window-title"
        className="flex h-8 shrink-0 cursor-move select-none items-center gap-2 border-b bg-muted/40 pl-3 pr-1 text-sm font-medium"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button")) return;
          gesture(e, "move", (dx, dy) => moveRect(rect, dx, dy, viewport));
        }}
      >
        <span className="flex-1 truncate">{def.title}</span>
        {/* FR-SHELL-37: say what each button does. */}
        <Tooltip content="Minimise — keep it on the launcher">
          <button
            type="button"
            data-testid="ui-window-minimise"
            aria-label={`Minimise ${def.title}`}
            className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => dispatch({ type: "minimise", ...id })}
          >
            <MinusIcon className="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Close">
          <button
            type="button"
            data-testid="ui-window-close"
            aria-label={`Close ${def.title}`}
            className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => dispatch({ type: "close", ...id })}
          >
            <XIcon className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto p-3">
        <WindowErrorBoundary>
          <WindowShown.Provider value={!parked}>
            {def.growToContent ? (
              // FR-SHELL-39: measured at its natural height while growing; after a user resize
              // (`fixedH`) it fills the body again. Same tree either way: the body never remounts.
              <div
                ref={contentRef}
                data-testid="ui-window-content"
                className={cn("flow-root", !grows && "h-full")}
              >
                <Body kind={win.kind} instance={win.instance} />
              </div>
            ) : (
              <Body kind={win.kind} instance={win.instance} />
            )}
          </WindowShown.Provider>
        </WindowErrorBoundary>
      </div>
      {EDGES.map(({ edge, className, testId }) => (
        <div
          key={edge}
          data-testid={testId}
          data-edge={edge}
          className={cn("absolute touch-none", className)}
          onPointerDown={(e) =>
            gesture(e, "resize", (dx, dy) => resizeRect(rect, edge, dx, dy, def.minSize, viewport))
          }
        />
      ))}
    </section>
  );
}

/**
 * FR-SHELL-39: the window height the content asks for (title bar, borders and body padding
 * included), re-measured on every content resize while `grows`; undefined otherwise. Reported
 * at once too, not only after React re-renders, so a feature open placing this window right after
 * a layout frame (FR-SHELL-40) sees it.
 */
function useNeededHeight(
  wid: string,
  grows: boolean,
  sectionRef: RefObject<HTMLElement | null>,
  bodyRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
): number | undefined {
  const [needed, setNeeded] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!grows || !section || !body || !content) {
      setNeeded(undefined);
      return;
    }
    const measure = () => {
      const cs = getComputedStyle(body);
      const pad = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom);
      const chrome = section.offsetHeight - body.clientHeight;
      const h = Math.ceil(chrome + pad + content.getBoundingClientRect().height);
      reportContentHeight(wid, h);
      setNeeded(h);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [wid, grows, sectionRef, bodyRef, contentRef]);
  return needed;
}
