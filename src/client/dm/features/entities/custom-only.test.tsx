// Creatures "Custom only" switch: on by default, kept per browser ("0" / "1"), storage failures
// fall back to the default / memory; the window renders it checked with the custom empty state.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import type { StorageBackend } from "@ui/features/play-shell/storage";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { CreaturesList } from "./creatures-window";
import { CUSTOM_ONLY_KEY, readCustomOnly, writeCustomOnly } from "./custom-only";

const memory = (): StorageBackend & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};
const blocked: StorageBackend = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("Creatures custom only", () => {
  test("on by default; a stored choice wins; junk or blocked storage → default", () => {
    const s = memory();
    expect(readCustomOnly(() => s)).toBe(true);
    writeCustomOnly(() => s, false);
    expect(s.data.get(CUSTOM_ONLY_KEY)).toBe("0");
    expect(readCustomOnly(() => s)).toBe(false);
    writeCustomOnly(() => s, true);
    expect(readCustomOnly(() => s)).toBe(true);
    s.data.set(CUSTOM_ONLY_KEY, "yes");
    expect(readCustomOnly(() => s)).toBe(true);
    expect(readCustomOnly(() => blocked)).toBe(true);
    expect(() => writeCustomOnly(() => blocked, false)).not.toThrow();
    expect(readCustomOnly(() => undefined)).toBe(true);
  });

  test("window: switch checked by default, empty list says no custom creatures", () => {
    const store = createStore<SyncState>()(
      () =>
        ({
          state: "live",
          everLive: true,
          store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
          lazy: {},
          connection: { load: () => null, retryLoad: () => null },
        }) as unknown as SyncState,
    );
    const html = renderToStaticMarkup(
      <SyncContext.Provider value={store}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <CreaturesList actions={[]} />
        </TooltipProvider>
      </SyncContext.Provider>,
    );
    expect(html).toMatch(
      /data-state="checked"[^>]*data-testid="ent-list-custom-only"|data-testid="ent-list-custom-only"[^>]*data-state="checked"/,
    );
    expect(html).toContain("No custom creatures yet");
  });
});
