// FR-SHELL-175 (BL-91): a stale chunk offers a reload. Static renders over in-code DM / player
// stores (no DOM here): the boundary's branch for a stale chunk vs any other error, the panel's
// client copy, a sibling still drawn, and the 3D dice loader's flat fallback + one stale notice.
// The browser path (a real 404 on the tray chunk) is e2e/fx-stale-chunk.e2e.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { applySnapshot } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { ChunkBoundary, type ChunkFallback, resetStaleNotice } from "../../lib/chunk-reload";
import { StaleChunkError } from "../../lib/chunk-stale";
import { SyncContext, type SyncState } from "../../sync/store";
import { createChunkLoader, throwDraw } from "../dice-extras/lazy3d";

const chunkErr = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: http://127.0.0.1:4122/assets/TrayWindow-B1x2c3D4.js",
  );

function render(role: "dm" | "player", node: ReactNode): string {
  const store = applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {},
  } as never);
  const sync = createStore<SyncState>()(() => ({ state: "live", store }) as unknown as SyncState);
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** What a boundary that caught `error` draws (the class's own render, as React calls it). */
function caught(error: unknown, fallback: ChunkFallback = "window"): ReactNode {
  const b = new ChunkBoundary({ fallback, children: <p>body</p> });
  b.state = ChunkBoundary.getDerivedStateFromError(error);
  return b.render();
}

const noticeCount = () =>
  toast.getToasts().filter((t) => "testId" in t && t.testId === "ui-chunk-reload-toast").length;

afterEach(() => {
  toast.dismiss();
  resetStaleNotice();
});

describe("FR-SHELL-175 stale chunk offers a reload", () => {
  test("FR-SHELL-175 a window whose import rejected twice → ui-window-reload with the DM / player copy; a sibling still renders", () => {
    const stale = new StaleChunkError(chunkErr());
    const tree = (
      <div>
        <section data-testid="win-a">{caught(stale)}</section>
        <section data-testid="win-b">Sibling window</section>
      </div>
    );
    const dm = render("dm", tree);
    expect(dm).toContain('data-testid="ui-window-reload"');
    expect(dm).toContain("Rebuild finished — reload");
    expect(dm).toContain('data-chunk="TrayWindow"');
    expect(dm).toContain("Sibling window");
    expect(dm).not.toContain("This window failed to render.");
    const player = render("player", tree);
    expect(player).toContain('data-testid="ui-window-reload"');
    expect(player).toContain("New version available — reload");
    expect(player).not.toContain("check with your DM");
  });

  test("FR-SHELL-175 a non-chunk error goes on up (the window's 'This window failed to render.')", () => {
    const bug = new RangeError("render bug");
    expect(() => caught(bug)).toThrow(bug);
    // A chunk error that wasn't classified stale (no retry yet) goes up too.
    expect(() => caught(chunkErr())).toThrow();
  });

  test("FR-SHELL-175 parts outside a window: inline / compact / map panels, nothing for a notice part", () => {
    const stale = new StaleChunkError(chunkErr());
    const inline = render("dm", caught(stale, "inline"));
    expect(inline).toContain('data-testid="ui-chunk-reload"');
    expect(inline).toContain('data-variant="inline"');
    const compact = render("dm", caught(stale, "compact"));
    expect(compact).toContain('data-fallback="compact"');
    // Its Button keeps the variant a theme reads (FR-KIT-06).
    expect(compact).toContain('data-variant="outline"');
    expect(render("player", caught(stale, "map"))).toContain('data-variant="map"');
    expect(caught(stale, "notice")).toBeNull();
  });

  test("FR-SHELL-175 a failing 3D-dice loader → flat dice + one ui-chunk-reload-toast; a second failure → still one", async () => {
    const warned: string[] = [];
    const settle = (l: ReturnType<typeof createChunkLoader>) =>
      new Promise<void>((resolve) => {
        const off = l.subscribe(() => {
          if (l.state() === "failed" || l.state() === "ready") {
            off();
            resolve();
          }
        });
        l.load();
      });
    const a = createChunkLoader(
      () => Promise.reject(chunkErr()),
      (m) => warned.push(m),
    );
    await settle(a);
    expect(a.state()).toBe("failed");
    expect(throwDraw("screen", a.state())).toBe("flat");
    expect(noticeCount()).toBe(1);
    const b = createChunkLoader(
      () => Promise.reject(chunkErr()),
      (m) => warned.push(m),
    );
    await settle(b);
    expect(noticeCount()).toBe(1);
    expect(warned).toHaveLength(2);
  });
});
