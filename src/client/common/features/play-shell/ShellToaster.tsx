// The client's one sonner Toaster (FR-SHELL-01): alert Toasts and every other `toast()` share it.
// It follows the notifications stack's height so the two stack in one region. The region's third
// stack, the roll popups (FR-DICEX-39, seams S7), mounts here beyond both: the dice-extras runtime
// portals its stack into `useRollPopupMount()`'s element.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { useViewport } from "./hooks";
import type { ShellClient } from "./registry";
import {
  NOTE_STACK_SELECTOR,
  popupRegion,
  ROLL_POPUP_W,
  shownStack,
  shownStacks,
  subscribeShownStack,
  toastKeepOut,
  toastRegion,
} from "./toast-region";

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

/** Sonner's collapsed stack: the front toast, then 14 px per toast peeking behind (≤ 3 shown). */
const SONNER_PEEK = 14;
const SONNER_SHOWN = 3;

/** The alert stack's (sonner's) collapsed height: 0 without toasts. */
export function sonnerStackH(frontH: number, toasts: number): number {
  if (toasts === 0 || frontH <= 0) return 0;
  return Math.round(frontH + SONNER_PEEK * (Math.min(toasts, SONNER_SHOWN) - 1));
}

function useSonnerHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    let ol: HTMLElement | null = null;
    const measure = () => {
      const front = Number.parseFloat(ol?.style.getPropertyValue("--front-toast-height") ?? "");
      const n = ol?.querySelectorAll("[data-sonner-toast]:not([data-removed='true'])").length ?? 0;
      setH(sonnerStackH(Number.isFinite(front) ? front : 0, n));
    };
    const own = new MutationObserver(measure);
    const sync = () => {
      const next = document.querySelector<HTMLElement>("[data-sonner-toaster]");
      if (next !== ol) {
        own.disconnect();
        ol = next;
        if (ol) {
          own.observe(ol, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["style", "data-removed"],
          });
        }
      }
      measure();
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      mo.disconnect();
      own.disconnect();
    };
  }, []);
  return h;
}

// The mount element, for the roll-popup stack's portal.
let mount: HTMLElement | null = null;
const listeners = new Set<() => void>();
const setMount = (el: HTMLElement | null) => {
  if (el === mount) return;
  mount = el;
  for (const fn of [...listeners]) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The roll-popup stack's mount (FR-DICEX-39): null until the shell's Toaster renders. */
export function useRollPopupMount(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => mount,
    () => null,
  );
}

export function ShellToaster({ client }: { client: ShellClient }) {
  const noteH = useElementHeight(NOTE_STACK_SELECTOR);
  const region = toastRegion(client, noteH);
  const popups = popupRegion(client, noteH, useSonnerHeight());
  const box = toastKeepOut(client, useViewport());
  const reports = useSyncExternalStore(subscribeShownStack, shownStacks, shownStacks);
  const stack = shownStack(client, reports);
  return (
    <>
      {/* FR-SHELL-49: the region's box (players' toast corner, the DM's top-centre box), for
          walkthroughs; draws nothing, takes no input. */}
      <div
        data-testid="ui-toast-corner"
        data-rect={`${box.x},${box.y},${box.w},${box.h}`}
        // FR-SHELL-59: the DM's rendered toasts + popups (absent while nothing shows).
        data-shown={
          stack
            ? `${Math.round(stack.x)},${Math.round(stack.y)},${Math.round(stack.w)},${Math.round(stack.h)}`
            : undefined
        }
        aria-hidden
        className="pointer-events-none fixed"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      />
      <Toaster
        theme="dark"
        position={region.position}
        offset={region.offset}
        mobileOffset={region.offset}
      />
      {/* DM: a full-width row at the stack's top (the stack centres and keeps clear of
          Initiative itself); player: the bottom-right column. */}
      <div
        ref={setMount}
        data-testid="ui-roll-popups"
        data-placement={client === "dm" ? "top-center" : "bottom-right"}
        className="pointer-events-none fixed z-40 flex flex-col gap-2"
        style={
          "top" in popups
            ? { top: popups.top, left: 0, width: "100%", height: 0 }
            : { right: popups.right, bottom: popups.bottom, width: ROLL_POPUP_W }
        }
      />
    </>
  );
}
