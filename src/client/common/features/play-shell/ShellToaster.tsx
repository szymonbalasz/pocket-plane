// The client's one sonner Toaster (FR-SHELL-01): alert Toasts and every other `toast()` share it.
// It follows the notifications stack's height so the two stack in one region.
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import type { ShellClient } from "./registry";
import { NOTE_STACK_SELECTOR, toastRegion } from "./toast-region";

/** Height of the element matching `selector` (0 while absent); follows mounts and resizes. */
function useElementHeight(selector: string): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    let el: Element | null = null;
    const measure = () => setH(el ? Math.round(el.getBoundingClientRect().height) : 0);
    const ro = new ResizeObserver(measure);
    const sync = () => {
      const next = document.querySelector(selector);
      if (next === el) return;
      if (el) ro.unobserve(el);
      el = next;
      if (el) ro.observe(el);
      measure();
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [selector]);
  return h;
}

export function ShellToaster({ client }: { client: ShellClient }) {
  const region = toastRegion(client, useElementHeight(NOTE_STACK_SELECTOR));
  return (
    <Toaster
      theme="dark"
      position={region.position}
      offset={region.offset}
      mobileOffset={region.offset}
    />
  );
}
