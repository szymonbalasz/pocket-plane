// One floating window: title bar (drag), minimise / close, edge + corner resize, scrolling body
// (FR-SHELL-10/11). Drag and resize move the element by CSS only; the store is written once,
// on pointer up (SHELL §12).
import type { WindowState } from "@shared/play-shell/layout";
import { MinusIcon, XIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode, useRef } from "react";
import { cn } from "../../lib/utils";
import {
  moveRect,
  type Rect,
  type ResizeEdge,
  renderedRect,
  resizeRect,
  type Viewport,
} from "./geometry";
import { SHELL_ZONE_ATTR } from "./keys";
import { type WindowAction, windowId } from "./manager";
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

export function ShellWindow({
  win,
  def,
  viewport,
  focused,
  dispatch,
}: {
  win: WindowState;
  def: WindowDef;
  viewport: Viewport;
  focused: boolean;
  dispatch: (a: WindowAction) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // Render-only fit to the work area, then clamp (FR-SHELL-29, -12); a gesture starts here and
  // its end stores the result with the current work area.
  const rect = renderedRect(win, def.minSize, viewport);
  const id = { kind: win.kind, instance: win.instance };
  const Body = def.component;

  /** Pointer-capture gesture; `compute` maps the pointer delta to a rect. */
  function gesture(e: React.PointerEvent<HTMLElement>, compute: (dx: number, dy: number) => Rect) {
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
        dispatch({ type: "setRect", ...id, rect: last });
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
      data-record-id={windowId(win.kind, win.instance)}
      data-state={win.state}
      data-focused={focused}
      aria-label={def.title}
      // Focusable, so clicks anywhere inside move keyboard focus here (FR-SHELL-13).
      tabIndex={-1}
      className={cn(
        "pointer-events-auto absolute outline-none left-0 top-0 flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg",
        focused && "border-ring",
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
          gesture(e, (dx, dy) => moveRect(rect, dx, dy, viewport));
        }}
      >
        <span className="flex-1 truncate">{def.title}</span>
        <button
          type="button"
          data-testid="ui-window-minimise"
          aria-label={`Minimise ${def.title}`}
          className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => dispatch({ type: "minimise", ...id })}
        >
          <MinusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          data-testid="ui-window-close"
          aria-label={`Close ${def.title}`}
          className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => dispatch({ type: "close", ...id })}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <WindowErrorBoundary>
          <Body kind={win.kind} instance={win.instance} />
        </WindowErrorBoundary>
      </div>
      {EDGES.map(({ edge, className, testId }) => (
        <div
          key={edge}
          data-testid={testId}
          data-edge={edge}
          className={cn("absolute touch-none", className)}
          onPointerDown={(e) =>
            gesture(e, (dx, dy) => resizeRect(rect, edge, dx, dy, def.minSize, viewport))
          }
        />
      ))}
    </section>
  );
}
