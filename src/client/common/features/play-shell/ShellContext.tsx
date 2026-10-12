// Shell provider: one window manager per play page, restored from browser storage after the
// first snapshot and after `you.campaignId` changes (FR-SHELL-16). Stays mounted across the
// waiting / reconnect screens so windows come back as they were (FR-SHELL-04).
import { layoutKey } from "@shared/play-shell/layout";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { SyncContext, useSync } from "../../sync/store";
import type { WindowAction } from "./manager";
import { availableKinds, type WindowRegistry } from "./registry";
import { createShellController, type ShellController, type ShellState } from "./shell-store";
import { browserLayoutStorage } from "./storage";

const ShellContext = createContext<ShellController | null>(null);

const browserViewport = () => ({ w: window.innerWidth, h: window.innerHeight });

export function ShellProvider({
  registry,
  children,
}: {
  registry: WindowRegistry;
  children: React.ReactNode;
}) {
  const [controller] = useState(() =>
    createShellController({
      registry,
      storage: browserLayoutStorage(),
      viewport: browserViewport,
    }),
  );
  const you = useSync((s) => s.store.you);
  const key = you
    ? layoutKey(
        you.campaignId,
        you.role === "player" && you.playerId ? { playerId: you.playerId } : { role: "dm" },
      )
    : null;
  // Layout effect: the restored windows paint with the first frame of the new snapshot.
  useLayoutEffect(() => {
    if (key) controller.restore(key);
  }, [controller, key]);
  return <ShellContext.Provider value={controller}>{children}</ShellContext.Provider>;
}

function useController(): ShellController {
  const c = useContext(ShellContext);
  if (!c) throw new Error("play-shell hook outside ShellProvider");
  return c;
}

export function useShellState<T>(selector: (s: ShellState) => T): T {
  return useStore(useController().store, selector);
}

export function useRegistry(): WindowRegistry {
  return useController().registry;
}

/** Kinds this client renders right now (registered + available), as a stable Set. */
export function useAvailableKinds(): ReadonlySet<string> {
  const registry = useRegistry();
  const joined = useSync((s) => [...availableKinds(registry, s.store)].join(","));
  return useMemo(() => new Set(joined ? joined.split(",") : []), [joined]);
}

/** Dispatch a window action against the current availability. */
export function useWindowDispatch(): (action: WindowAction) => void {
  const controller = useController();
  const sync = useContext(SyncContext);
  return useCallback(
    (action: WindowAction) => {
      const store = sync?.getState().store;
      const available = store
        ? availableKinds(controller.registry, store)
        : new Set(controller.registry.defs.map((d) => d.kind));
      controller.dispatch(action, available);
    },
    [controller, sync],
  );
}

/**
 * Feature API (SHELL §9): open a window by kind (and instance, `main` in MVP), or bring it to
 * front / restore it. Passes no data; the window reads the synced store itself.
 */
export function useOpenWindow(): (kind: string, instance?: string) => void {
  const dispatch = useWindowDispatch();
  return useCallback(
    (kind: string, instance?: string) => dispatch({ type: "open", kind, instance }),
    [dispatch],
  );
}
