// The Initiative row menu's submenus (Check ▸, Save ▸, side ▸) and the token menu's side ▸.
import { useEffect, useRef, useState } from "react";

/** Close delay of a row-menu submenu, ms: long enough to cross from the trigger to an item. */
const SUB_CLOSE_DELAY = 300;

/**
 * Hover-safe submenu state. At the screen's right edge the submenu flips left, and Radix closes
 * it when the pointer leaves the trigger in any other direction than its last move (a direct
 * move from "Save" to "Dexterity"). A close waits `SUB_CLOSE_DELAY`; entering the submenu keeps
 * it open. Opening is immediate.
 */
export function useHoverSafeSub() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    open,
    onOpenChange(next: boolean) {
      clearTimeout(timer.current);
      if (next) setOpen(true);
      else timer.current = setTimeout(() => setOpen(false), SUB_CLOSE_DELAY);
    },
    keep: () => clearTimeout(timer.current),
  };
}
