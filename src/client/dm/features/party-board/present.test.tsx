// DM present controls (FR-PARTY-38 c, d) as a static render over a fake sync store: "On screen:
// ‹n›" and "Close on all screens" only while the handout has open rows. The Share tick and the
// Open on screens… dialog (portalled): present-logic.test.ts and e2e/party-present.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { HandoutPresentRecord } from "@shared/party-board/schemas";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { CloseAllButton, OnScreenBadge } from "./present";

const present = (id: string, handoutId: string, playerId: string): HandoutPresentRecord => ({
  id,
  campaignId: "c1",
  handoutId,
  playerId,
  presentedAt: "2026-10-19T10:00:00.000Z",
});

function store(rows: HandoutPresentRecord[]) {
  const records = {
    "handout-present": Object.fromEntries(rows.map((r) => [r.id, r])),
    player: {
      p1: { id: "p1", name: "Player 1" },
      p2: { id: "p2", name: "Player 2" },
    },
  };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), records, you: { campaignId: "c1", role: "dm", playerId: null } },
        lazy: {},
        connection: {},
      }) as unknown as SyncState,
  );
}

const render = (rows: HandoutPresentRecord[], node: ReactNode) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store(rows)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");

describe("FR-PARTY-38 DM On screen", () => {
  const rows = [present("a", "h2", "p1"), present("b", "h2", "p2"), present("c", "h1", "p1")];

  test("FR-PARTY-38 (c) On screen: 2 for h2, nothing for a handout on no screen", () => {
    const html = render(rows, <OnScreenBadge handoutId="h2" />);
    expect(html).toContain('data-testid="party-present-count"');
    expect(html).toContain('data-value="2"');
    expect(html).toContain("On screen: 2");
    expect(render(rows, <OnScreenBadge handoutId="h5" />)).toBe("");
  });

  test("FR-PARTY-38 (d) Close on all screens while n > 0", () => {
    expect(render(rows, <CloseAllButton handoutId="h1" />)).toContain(
      'data-testid="party-present-close-all"',
    );
    expect(render(rows, <CloseAllButton handoutId="h5" />)).toBe("");
  });
});
