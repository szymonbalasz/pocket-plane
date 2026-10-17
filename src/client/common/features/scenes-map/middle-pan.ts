// Middle-mouse pan (FR-MAP-12, sprint 4; OQ-MAP-45): MapCanvas feeds it every press in the
// capture phase, before Konva and the active tool; it takes button 1 (and any press while it
// pans), stops the browser's autoscroll / middle-click paste, and moves the camera with the
// pointer until button 1 is released. DOM-free so it runs under `bun test`.
import { type CanvasToolDef, type PointerIntent, pointerIntent } from "./tools";

/** The bits of a DOM mouse / pointer event the pan reads. */
export interface PanPointerEvent {
  type: string;
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface MiddlePanHost {
  /** Camera x / y (screen px) when a pan starts. */
  position(): { x: number; y: number };
  /** Live camera x / y while the pan runs. */
  move(x: number, y: number): void;
  /** Button 1 released: the final x / y, or null if the pointer never moved (camera untouched). */
  end(at: { x: number; y: number } | null): void;
  /** `data-panning="middle"` + the grabbing cursor. */
  panning(on: boolean): void;
}

export interface PressState {
  tool: CanvasToolDef | null;
  space: boolean;
  live: boolean;
}

export function createMiddlePan(host: MiddlePanHost) {
  let start: { px: number; py: number; x: number; y: number } | null = null;
  let at: { x: number; y: number } | null = null;
  const stop = () => {
    const done = start !== null;
    start = null;
    const last = at;
    at = null;
    if (!done) return;
    host.panning(false);
    host.end(last);
  };
  return {
    get active() {
      return start !== null;
    },
    /**
     * A `pointerdown` / `mousedown` on the canvas, capture phase. `pan` / `ignore` are swallowed
     * here (no tool, token or stage sees them); `tool` / `canvas` go on to MapCanvas as before.
     */
    press(e: PanPointerEvent, s: PressState): PointerIntent {
      const intent = pointerIntent(s.tool, {
        button: e.button,
        buttons: e.buttons,
        space: s.space,
        live: s.live,
        panning: start !== null,
      });
      if (intent !== "pan" && intent !== "ignore") return intent;
      e.stopPropagation();
      // A cancelled `pointerdown` would drop the `mousedown` whose default starts autoscroll.
      if (e.type !== "pointerdown") e.preventDefault();
      if (intent === "pan" && start === null) {
        const p = host.position();
        start = { px: e.clientX, py: e.clientY, x: p.x, y: p.y };
        host.panning(true);
      }
      return intent;
    },
    /** Window `mousemove`: the camera follows the pointer. */
    move(e: { clientX: number; clientY: number }) {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (at === null && dx === 0 && dy === 0) return;
      at = { x: start.x + dx, y: start.y + dy };
      host.move(at.x, at.y);
    },
    /**
     * Window `mouseup`, capture phase: releasing button 1 ends the pan. Returns true when no one
     * else may see the event (a middle release during a pan, or during a left drag: Konva ends
     * any drag on a mouse release).
     */
    release(e: PanPointerEvent): boolean {
      if (e.button !== 1) return false;
      const take = start !== null || (e.buttons & 1) !== 0;
      if (start !== null) stop();
      if (take) e.preventDefault();
      return take;
    },
    /** Canvas `auxclick`: no middle-click paste or open (FR-MAP-12). */
    auxclick(e: PanPointerEvent) {
      if (e.button === 1) e.preventDefault();
    },
    /** Window blur / unmount: the pan ends where it is. */
    cancel: stop,
  };
}

export type MiddlePan = ReturnType<typeof createMiddlePan>;
