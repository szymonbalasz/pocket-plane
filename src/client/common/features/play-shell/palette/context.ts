// The page's `CommandCtx` (FR-SHELL-184): the synced store, the connection, this client's window
// registry and layout, the shell's `by: "user"` window actions and FR-SHELL-153's reset. Rebuilt
// on every render of the palette overlay; the key listener reads the latest through a ref.
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { useContext, useMemo } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import { SyncContext, type SyncState } from "../../../sync/store";
import { isFeatureOn } from "../../campaign-management/use-feature";
import { toastIntentError } from "../../combat-tracker/store";
import { COMMANDS, PROVIDERS } from "../commands";
import {
  useAvailableKinds,
  useRegistry,
  useResetLayout,
  useShellState,
  useWindowDispatch,
} from "../ShellContext";
import { forClient } from "./rank";
import { openPalette, openShortcuts } from "./state";
import type { CommandCtx, PaletteCommand, SearchProvider } from "./types";

type SyncLike = Pick<SyncState, "store" | "state"> & Partial<Pick<SyncState, "connection">>;

const NO_SYNC = createStore<SyncLike>()(() => ({ store: emptyStore(), state: "connecting" }));

/** ⌘ is the palette's modifier on Apple platforms (FR-SHELL-180). */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export interface PaletteEnv {
  ctx: CommandCtx;
  /** This client's commands and providers, feature switches applied (ruling 14). */
  commands: readonly PaletteCommand[];
  providers: readonly SearchProvider[];
}

export function usePaletteEnv(): PaletteEnv {
  const sync = (useContext(SyncContext) as StoreApi<SyncLike> | null) ?? NO_SYNC;
  const store = useStore(sync, (s) => s.store) as RecordStore;
  const live = useStore(sync, (s) => s.state === "live");
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const dispatch = useWindowDispatch();
  const resetLayout = useResetLayout();
  return useMemo(() => {
    const ctx: CommandCtx = {
      client: registry.client,
      store,
      live,
      registry,
      windows,
      available,
      shell: {
        openWindow: (kind) => dispatch({ type: "open", kind, by: "user" }),
        focusWindow: (kind) => dispatch({ type: "focus", kind }),
        toggleWindow: (kind) => dispatch({ type: "toggle", kind }),
        resetLayout,
      },
      async send<R>(name: string, payload: unknown): Promise<R | undefined> {
        const connection = sync.getState().connection;
        if (!connection) return undefined;
        try {
          return ((await connection.sendIntent(name, payload)) ?? null) as R;
        } catch (err) {
          toastIntentError(err);
          return undefined;
        }
      },
      openPalette,
      openShortcuts,
    };
    const featureOn = (key: string) => isFeatureOn(store, key);
    return {
      ctx,
      commands: forClient(COMMANDS, ctx, featureOn),
      providers: forClient(PROVIDERS, ctx, featureOn),
    };
  }, [store, live, registry, windows, available, dispatch, resetLayout, sync]);
}
