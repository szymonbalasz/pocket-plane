// The "Free" chip (`scn-free-chip`, FR-SCN-08, -43): follows the cursor over the canvas while Ctrl
// is held in a tool that places free points (Structure Wall / Door, AoE). Ctrl presses and
// releases also go to `onCtrl`, so the tool re-picks its hover / gesture without a pointer move.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const overCanvas = (t: EventTarget | null) =>
  (t as Element | null)?.closest?.('[data-testid="map-canvas"]') != null;

/** FR-SCN-08 / -43: shown while the tool allows it, Ctrl is held and the cursor is over the map. */
export const chipShown = (enabled: boolean, ctrl: boolean, overMap: boolean): boolean =>
  enabled && ctrl && overMap;

export function FreeChip({
  enabled,
  onCtrl,
}: {
  enabled: boolean;
  onCtrl?: (ctrl: boolean) => void;
}) {
  const [ctrl, setCtrl] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const cb = useRef(onCtrl);
  cb.current = onCtrl;
  useEffect(() => {
    const move = (e: PointerEvent) => {
      setCtrl(e.ctrlKey || e.metaKey);
      setAt(overCanvas(e.target) ? { x: e.clientX, y: e.clientY } : null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Control" && e.key !== "Meta") return;
      const c = e.type === "keydown";
      setCtrl(c);
      cb.current?.(c);
    };
    const blur = () => {
      setCtrl(false);
      cb.current?.(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  if (!at || !chipShown(enabled, ctrl, true)) return null;
  return createPortal(
    <div
      data-testid="scn-free-chip"
      className="pointer-events-none fixed z-50 rounded-full border bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm"
      style={{ left: at.x + 14, top: at.y + 14 }}
    >
      Free
    </div>,
    document.body,
  );
}
