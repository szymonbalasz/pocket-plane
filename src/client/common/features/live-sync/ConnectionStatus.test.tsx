// Sprint 15 frame (BL-164, BL-171; session-sim-17 b10): the reconnect banner never blocks the tool
// rail's top tool or a window's close button. b10's rects: the banner was y 48–94, full width;
// Select 8,56 48 × 48 under it, and the close buttons of Initiative, Recap and Character sheet.
// Hit tests in a real browser: `e2e/s15-frame.e2e.ts`.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { SyncContext, type SyncState } from "../../sync/store";
import type { Rect } from "../play-shell/geometry";
import { REFERENCE_VIEWPORTS } from "../play-shell/layout-checks";
import { ReconnectBannerSlot, reconnectBannerBox } from "./ConnectionStatus";

const SELECT: Rect = { x: 8, y: 56, w: 48, h: 48 };
/** "Reconnecting…", and the 60 s line with "Server unreachable — check with your DM." */
const WIDTHS = [130, 430, 4000];

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function banner(notLiveFor: number) {
  const store = createStore(
    () =>
      ({ state: "reconnecting", notLiveSince: Date.now() - notLiveFor }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={store as never}>
      <ReconnectBannerSlot />
    </SyncContext.Provider>,
  );
}

describe("reconnect banner", () => {
  test("FR-SYNC-41 banner box: centred, off the rail at every reference size and any text width", () => {
    for (const vp of [...REFERENCE_VIEWPORTS, { w: 400, h: 800 }]) {
      for (const w of WIDTHS) {
        const box = reconnectBannerBox(vp, w, 32);
        expect(hit(box, SELECT)).toBe(false);
        expect(box.x + box.w / 2).toBe(vp.w / 2);
      }
    }
  });

  test("FR-SYNC-41 click-through: the slot and the banner take no pointer events; no full-width bar", () => {
    const html = banner(5_000);
    expect(html).toContain('data-testid="sync-reconnect-banner"');
    expect(html).toContain("Reconnecting…");
    const [slot, alert] = html.split("<div").slice(1);
    expect(slot).toContain("pointer-events-none");
    expect(alert).toContain("pointer-events-none");
    expect(alert).toContain("w-auto");
    expect(alert).not.toContain("rounded-none");
  });

  test("FR-SYNC-24 still: nothing before 1 s, the 60 s line after a minute", () => {
    expect(banner(200)).not.toContain("sync-reconnect-banner");
    expect(banner(5_000)).not.toContain("sync-reconnect-unreachable");
    expect(banner(61_000)).toContain("Server unreachable");
  });

  test("FR-SYNC-42 own controls: a button or link inside the banner takes clicks", () => {
    const html = banner(5_000);
    expect(html).toContain("[&amp;_button]:pointer-events-auto");
    expect(html).toContain("[&amp;_a]:pointer-events-auto");
  });
});
