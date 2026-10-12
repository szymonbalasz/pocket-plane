// Browser hooks for the shell: viewport size and base-layer key routing (FR-SHELL-12/13).
import { useEffect, useRef, useState } from "react";
import type { Viewport } from "./geometry";
import { isBaseKeyTarget } from "./keys";

/** Current viewport; re-renders on resize so windows re-clamp (render-only, FR-SHELL-12). */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/**
 * Base-layer (canvas) key handler (FR-SHELL-13). Receives only key events whose target is
 * outside windows, the top bar, the launcher, dialogs / menus and editable elements.
 * Base-layer features (scenes-map) use this instead of their own `keydown` listener.
 */
export function useBaseKeyDown(handler: (e: KeyboardEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isBaseKeyTarget(e.target)) ref.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}
