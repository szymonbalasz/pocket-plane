// Kit parity K10 (K6 §5): the Players window's calmer party line (stats spaced apart, no "·", the
// labels hooked for a theme) and the loopback warning as the kit's alert. Static render over an
// in-code DM store; every test ID of the line and the warning kept (FR-KIT-02).
import { describe, expect, test } from "bun:test";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { createWindowRegistry } from "@ui/features/play-shell/registry";
import { ShellProvider } from "@ui/features/play-shell/ShellContext";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";

// The DM REST client reads the page origin and localStorage at import; the render needs a page.
// Faked only meanwhile, so no other test file in this process sees them.
const g = globalThis as { window?: unknown; document?: unknown; localStorage?: unknown };
async function withPage<T>(fn: () => T | Promise<T>): Promise<T> {
  g.window = { location: { origin: "http://127.0.0.1:4100" }, innerWidth: 1440, innerHeight: 900 };
  g.document = { title: "", hidden: false, documentElement: {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  try {
    return await fn();
  } finally {
    delete g.window;
    delete g.document;
    delete g.localStorage;
  }
}
const { PlayersPanel } = await withPage(() => import("./PlayersPanel"));

function dmStore(): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role: "dm", playerId: null },
    records: {
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: "#e69f00" }],
      player: [{ id: "p1", campaignId: "c1", name: "Player 1", color: null }],
      entity: [
        {
          id: "mira",
          kind: "character",
          campaignId: "c1",
          name: "Mira",
          ownerPlayerId: "p1",
          hpCurrent: 6,
          tempHp: 0,
          statBlock: {
            level: 1,
            ac: 16,
            hpMax: 12,
            abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 14, cha: 10 },
            skills: {},
          },
        },
      ],
    },
  } as never);
}

function render(): Promise<string> {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: dmStore(),
        presence: {},
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return withPage(() =>
    renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <ShellProvider registry={createWindowRegistry("dm", [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <PlayersPanel />
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    ),
  );
}

describe("kit parity K10: Players window", () => {
  test("FR-KIT-02 FR-KIT-07 K10 Players party line: stats spaced apart, no '·' between them, labels hooked (party-line-label), every test ID kept", async () => {
    const html = await render();
    const line = /<button[^>]*data-testid="camp-player-char"[\s\S]*?<\/button>/.exec(html)?.[0];
    expect(line).toBeDefined();
    const text = (line ?? "").replace(/<[^>]+>/g, "");
    expect(text).not.toContain("·");
    expect(text).toBe("MiraLvl 1AC 16HP 6 / 12PP 12Inv 10Ins 12");
    // One label per stat: Lvl, AC, HP and the three passives.
    expect([...(line ?? "").matchAll(/data-slot="party-line-label"/g)]).toHaveLength(6);
    for (const id of ["camp-player-char-level", "camp-player-char-ac", "camp-player-char-hp"])
      expect(line).toContain(`data-testid="${id}"`);
  });

  test("FR-KIT-02 K10 Players loopback warning: the kit's alert (default variant, ruled box), the warning colour on its icon only, base URL kept", async () => {
    const html = await render();
    const box = /<div[^>]*data-testid="camp-players-loopback-warning"[^>]*>/.exec(html)?.[0] ?? "";
    expect(box).toContain('data-slot="alert"');
    expect(box).toContain('role="alert"');
    expect(box).not.toContain("text-warning");
    expect(html).toMatch(/<svg[^>]*text-warning/);
    expect(html).toContain('data-testid="camp-players-base-url">http://127.0.0.1:4100</span>');
  });
});
