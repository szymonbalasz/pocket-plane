// The roll popup stack's rendering (FR-DICEX-09, -38–42; DICEX §7 test IDs): static render of
// the lazy `RollPopupStack` inside a shell (1280×720) over the page's popup store.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { landing } from "./landing";
import { rollPopups } from "./popups";
import { RollPopupStack } from "./RollPopup";
import type { DisplaySetting } from "./settings";
import { diceExtras } from "./store";

const g = globalThis as { window?: unknown; document?: unknown };
beforeAll(() => {
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = { title: "", hidden: false };
});
afterAll(() => {
  delete g.window;
  delete g.document;
});
afterEach(() => {
  diceExtras.failed();
  rollPopups.api.setState({ popups: [] });
  landing.api.setState({ holding: new Map() });
});

function render(role: "dm" | "player" = "player", display: DisplaySetting = "flat") {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ShellProvider registry={createWindowRegistry(role, [])}>
          <RollPopupStack client={role} display={display} />
        </ShellProvider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const entry = (o: Partial<GameLogEntryView> = {}, items: unknown[] = []) =>
  ({
    id: "e1",
    n: 1,
    kind: "roll",
    category: "skill",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Mira",
    payload: items.length
      ? items
      : [
          {
            rollId: "r1",
            expression: "1d20+5",
            mode: "advantage",
            manual: false,
            dice: [
              { faces: 20, value: 20, kept: true },
              { faces: 20, value: 3, kept: false },
            ],
            constant: 5,
            total: 25,
            natural: 20,
            label: "Athletics",
          },
        ],
    ...o,
  }) as unknown as GameLogEntryView;

const attr = (html: string, testId: string, name: string) =>
  new RegExp(`data-testid="${testId}"[^>]*?${name}="([^"]*)"`).exec(html)?.[1];

describe("FR-DICEX-49 popup held until landed", () => {
  test("FR-DICEX-49 total hidden until landed: popup rows 'Rolling…', chips blank, data-landed; shown at the landing", () => {
    const second = entry({ id: "e2", n: 2, actorName: "Thorn" });
    rollPopups.add({ entries: [entry(), second], looks: {}, big: null, threeD: false });
    landing.hold(["e1", "e2"]);
    let html = render();
    expect(attr(html, "dicex-popup", "data-landed")).toBe("false");
    const rows = [...html.matchAll(/data-testid="dicex-popup-row"[^>]*data-landed="(\w+)"/g)];
    expect(rows.map((m) => m[1])).toEqual(["false", "false"]);
    expect(html.match(/Rolling…/g)).toHaveLength(2);
    expect(html).not.toContain('data-testid="dicex-popup-total"');
    expect(html).not.toMatch(/data-testid="dicex-die"[^>]*data-value=/);
    expect(html).not.toContain("natural 20!");
    // The chips' fade-in (flat, 0.3 s) is the landing: totals and markers appear.
    rollPopups.rested("e1", "play");
    html = render();
    expect(attr(html, "dicex-popup", "data-landed")).toBe("true");
    expect(html).not.toContain("Rolling…");
    expect(html).toMatch(/data-testid="dicex-popup-total"[^>]*>25</);
    expect(html).toMatch(/data-testid="dicex-die"[^>]*data-value="20"/);
  });

  test("FR-DICEX-49 an entry never held (Off, snapshot) shows its total at once, whatever the popup's state", () => {
    rollPopups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    const html = render("player", "off");
    expect(attr(html, "dicex-popup", "data-state")).toBe("rolling");
    expect(attr(html, "dicex-popup", "data-landed")).toBe("true");
    expect(html).toMatch(/data-testid="dicex-popup-total"[^>]*>25</);
  });
});

describe("FR-DICEX-39 roll popup rendering", () => {
  test("FR-DICEX-39 FR-DICEX-40 a popup: test IDs, one row, total with its markers, 'Rolling…' until rest", () => {
    rollPopups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    landing.hold(["e1"]); // as the runtime does after the popup (FR-DICEX-49)
    let html = render();
    expect(attr(html, "dicex-popup", "data-record-id")).toBe("e1");
    expect(attr(html, "dicex-popup", "data-count")).toBe("1");
    expect(attr(html, "dicex-popup", "data-dice")).toBe("2");
    expect(attr(html, "dicex-popup", "data-state")).toBe("rolling");
    expect(html).toContain("Rolling…");
    expect(html).toContain('data-testid="dicex-popup-close"');
    expect(html).toContain('data-testid="dicex-popup-settings"');
    expect(attr(html, "dicex-popup-pip", "data-mode")).toBe("chips");
    rollPopups.rested("e1", "play");
    html = render();
    expect(attr(html, "dicex-popup", "data-state")).toBe("rest");
    expect(html).not.toContain("Rolling…");
    expect(html).toContain("Mira");
    expect(html).toContain("Athletics (adv)");
    expect(html).toMatch(/data-testid="dicex-popup-total"[^>]*>25</);
    expect(html).toContain("natural 20!");
    // Popup width / height: the toast region's 320 × 190 (FR-DICEX-46/47, seams S2) × 1.4 (T5).
    expect(html).toContain("width:448px;max-height:268px");
  });

  test("FR-DICEX-42 FR-DICEX-41 chips: die shapes in the roller's look, the dropped d20 struck; same count as the throw", () => {
    rollPopups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    const html = render();
    const shapes = [...html.matchAll(/data-testid="dicex-die"[^>]*data-shape="(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(shapes).toEqual(["d20", "d20"]);
    expect(html).toMatch(/data-testid="dicex-die"[^>]*data-kept="false"/);
  });

  test("FR-DICEX-40 a coalesced frame: one named row per entry with its total; the DM's DM-only rows eye-off + muted", () => {
    const monster = (id: string, n: number, name: string, total: number) =>
      entry({ id, n, public: false, rollerRole: "dm", rollerPlayerId: null, actorName: name }, [
        {
          rollId: `r${id}`,
          expression: "1d20+2",
          mode: "normal",
          manual: false,
          dice: [{ faces: 20, value: total - 2, kept: true }],
          constant: 2,
          total,
          natural: null,
          label: "Initiative",
        },
      ]);
    rollPopups.add({
      entries: [
        monster("o1", 1, "Ogre", 14),
        monster("o2", 2, "Ogre 2", 9),
        monster("g1", 3, "Goblin", 17),
      ],
      looks: {},
      big: null,
      threeD: false,
    });
    for (const id of ["o1"]) rollPopups.rested(id, "play");
    const html = render("dm");
    expect(attr(html, "dicex-popup", "data-count")).toBe("3");
    expect(attr(html, "dicex-popup", "data-hidden")).toBe("true");
    const rows = [...html.matchAll(/data-testid="dicex-popup-row" data-record-id="(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(rows).toEqual(["o1", "o2", "g1"]);
    expect(html).not.toContain("3 rolls");
    expect(html).toContain("Hidden from players");
    expect(html).toContain("bg-muted");
    const totals = [...html.matchAll(/data-testid="dicex-popup-total"[^>]*>(\d+)</g)].map(
      (m) => m[1],
    );
    expect(totals).toEqual(["14", "9", "17"]);
  });

  test("FR-DICEX-09 pending + popups on: the own popup's 'Rolling…' row", () => {
    diceExtras.sent(false);
    const html = render();
    expect(html).toContain('data-testid="dicex-popup" data-state="rolling" data-pending="true"');
    expect(html).toContain("Rolling…");
  });

  test("FR-DICEX-41 flat display: chips fading in, no 3D slot", () => {
    rollPopups.add({ entries: [entry()], looks: {}, big: null, threeD: false });
    const html = render("player", "flat");
    expect(html).toContain("transition-opacity duration-300");
    expect(html).not.toContain("<canvas");
  });

  test("FR-DICEX-41 handoff / play PiP: a 3D slot with its own 2D canvas (the still), chips only for non-mesh dice", () => {
    rollPopups.add({
      entries: [entry()],
      looks: {},
      big: { id: "e1", entryIds: ["e1"] },
      threeD: true,
    });
    const html = render("player", "screen");
    expect(attr(html, "dicex-popup-pip", "data-mode")).toBe("handoff");
    expect(html).toContain("<canvas");
    expect(html).not.toContain('data-testid="dicex-die"');
  });

  test("FR-DICEX-39 newest nearest the anchor: players' bottom (last), the DM's top (first)", () => {
    for (const id of ["a", "b"]) {
      rollPopups.add({
        entries: [entry({ id, n: id === "a" ? 1 : 2 })],
        looks: {},
        big: null,
        threeD: false,
      });
    }
    const order = (html: string) =>
      [...html.matchAll(/data-testid="dicex-popup" data-record-id="(\w+)"/g)].map((m) => m[1]);
    expect(order(render("player"))).toEqual(["a", "b"]);
    expect(order(render("dm"))).toEqual(["b", "a"]);
  });
});
