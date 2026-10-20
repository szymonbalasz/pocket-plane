// FR-DICEX-57 / -58 (DICEX §13 client row): the Preferences "Dice" section (its registration is
// tested per client in `features/campaign-management/pref-sections.test.ts`), its settings panel (no WebGL → 3D modes disabled with the reason; Dice look… pane in place, Save
// needs live) and one store shared with the tray gear's panel.
import { afterEach, describe, expect, test } from "bun:test";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { PreferencesWindow } from "../play-shell/PreferencesWindow";
import { DiceSection, diceSection } from "./DiceSection";
import { SettingsPanel } from "./SettingsPanel";
import { useDiceSettings } from "./settings";

const STORE: RecordStore = applySnapshot({
  type: "snapshot",
  seq: 0,
  you: { campaignId: "c1", role: "player", playerId: "p1" },
  records: { campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: "#e69f00" }] },
} as never);

function render(node: React.ReactNode, state = "live") {
  const sync = createStore<SyncState>()(
    () => ({ state, store: STORE, connection: { sendIntent: async () => ({}) } }) as never,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** The section's panel is lazy: the first render starts the load, the next one shows it. */
async function renderLoaded(node: React.ReactNode, state = "live") {
  render(node, state);
  await import("./SettingsPanel");
  await new Promise((r) => setTimeout(r, 0));
  return render(node, state);
}

const tags = (html: string, testId: string) =>
  [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`, "g"))].map((m) => m[0]);

const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (real) Object.defineProperty(globalThis, "localStorage", real);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("FR-DICEX-57 dice section", () => {
  test("FR-DICEX-57 dice section: renders the settings panel (display ×4, others, popups, Dice look…); no WebGL → 3D modes disabled with the reason", async () => {
    const html = await renderLoaded(<PreferencesWindow sections={[diceSection]} />);
    expect(html).toContain('data-record-id="dicex.dice"');
    expect(html).toContain(">Dice</h3>");
    const display = tags(html, "dicex-settings-display");
    expect(display.map((t) => /data-value="([^"]+)"/.exec(t)?.[1])).toEqual([
      "screen",
      "zone",
      "flat",
      "off",
    ]);
    // bun test has no WebGL: Full screen and Tray throw disabled, the reason shown.
    expect(display.map((t) => / disabled=""/.test(t))).toEqual([true, true, false, false]);
    expect(html).toContain("3D unavailable on this device");
    expect(tags(html, "dicex-settings-others")).toHaveLength(1);
    expect(tags(html, "dicex-settings-popup")).toHaveLength(1);
    expect(tags(html, "dicex-look-open")[0]).not.toContain(' disabled=""');
    expect(
      tags(await renderLoaded(<DiceSection />, "reconnecting"), "dicex-look-open")[0],
    ).toContain(' disabled=""');
  });

  test("FR-DICEX-57 dice section: Dice look… opens the look pane in place; Save disabled while not live", async () => {
    const live = await renderLoaded(<DiceSection initialPane="look" />);
    expect(tags(live, "dicex-prefs")[0]).toContain('data-pane="look"');
    expect(live).toContain('data-testid="dicex-look-save"');
    expect(live).not.toContain('data-testid="dicex-settings-display"');
    const down = await renderLoaded(<DiceSection initialPane="look" />, "reconnecting");
    expect(tags(down, "dicex-look-save")[0]).toContain(' disabled=""');
  });
});

describe("FR-DICEX-58 one store", () => {
  test("FR-DICEX-58 one store: the section and the tray gear render the same panel on the same hook; a change from either writes the one pp.dicex.v2 entry the other reads; no new key", async () => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
    });
    const setters: ReturnType<typeof useDiceSettings>["set"][] = [];
    function Grab() {
      setters.push(useDiceSettings().set);
      return null;
    }
    // Both places: the section's panel and the gear's panel, each beside a reader of the hook.
    const html = await renderLoaded(
      <>
        <Grab />
        <PreferencesWindow sections={[diceSection]} />
        <Grab />
        <div data-testid="gear">
          <SettingsPanel pane="settings" onPane={() => {}} />
        </div>
      </>,
    );
    expect(tags(html, "dicex-settings-display")).toHaveLength(8);
    const [section, gear] = setters.slice(-2);
    if (!section || !gear) throw new Error("no setter");
    // Flat in the section, then "Roll popups" off in the gear: one entry holds both.
    section({ display: "flat" });
    gear({ popup: false });
    expect([...data.keys()]).toEqual(["pp.dicex.v2.c1.p1"]);
    expect(JSON.parse(data.get("pp.dicex.v2.c1.p1") ?? "")).toEqual({
      display: "flat",
      others: true,
      popup: false,
    });
    section({ others: false });
    expect(JSON.parse(data.get("pp.dicex.v2.c1.p1") ?? "")).toEqual({
      display: "flat",
      others: false,
      popup: false,
    });
  });
});
