// FR-CAMP-35 picker (CAMP §13 client row): the palette row over the prefs-s6 holders, a static
// render in the Preferences section and the Players panel trigger, the reason line / Apply model,
// the 2-D keyboard and the send / reject path with an injected sender.
import { describe, expect, test } from "bun:test";
import { PLAYER_COLORS } from "@shared/campaign-management/colors";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { IntentRejected } from "../../sync/connection";
import { SyncContext, type SyncState } from "../../sync/store";
import { PreferencesWindow } from "../play-shell/PreferencesWindow";
import {
  type ColorHolders,
  ColorPickerPopover,
  draftOf,
  keyTarget,
  othersOf,
  ownColor,
  paletteSwatches,
  pickColor,
  pickerView,
  SET_COLOR_INTENT,
} from "./ColorPicker";
import { colorSection, ownTarget } from "./ColorSection";
import { clamp, hsvToHex, pickerRules } from "./color-picker";

const LAVENDER = "#b388ff";
/** prefs-s6: DM amber, Player 1 jade, Player 2 lavender. */
const H: ColorHolders = {
  dmColor: PLAYER_COLORS.amber,
  players: [
    { id: "p1", name: "Player 1", color: PLAYER_COLORS.jade },
    { id: "p2", name: "Player 2", color: LAVENDER },
  ],
};

function snapshotStore(role: "dm" | "player", holders = H): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: holders.dmColor }],
      player: holders.players.map((p) => ({ campaignId: "c1", ...p })),
    },
  } as never);
}

function renderWith(store: RecordStore, state: string, node: React.ReactNode) {
  const sync = createStore<SyncState>()(
    () => ({ state, store, connection: { sendIntent: async () => ({}) } }) as never,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** `camp-color-swatch` buttons of a static render: hex → its attributes. */
function swatchAttrs(html: string) {
  const out: Record<string, Record<string, string | boolean>> = {};
  for (const m of html.matchAll(/<button[^>]*data-testid="camp-color-swatch"[^>]*>/g)) {
    const tag = m[0];
    const attr = (n: string) => new RegExp(`${n}="([^"]+)"`).exec(tag)?.[1] ?? "";
    out[attr("data-value")] = {
      name: attr("data-name"),
      state: attr("data-state"),
      blockedBy: attr("data-blocked-by"),
      ariaDisabled: / aria-disabled="true"/.test(tag),
    };
  }
  return out;
}

const tagOf = (html: string, testId: string) =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";

describe("FR-CAMP-35 picker", () => {
  test("FR-CAMP-35 picker: palette row for Player 1 (prefs-s6): 8 in palette order, Jade checked; Blue and Sky blocked by Player 2, Amber by the DM, with their reasons", () => {
    const others = othersOf(H, "p1");
    expect(others.map((o) => o.by)).toEqual(["dm", "p2"]);
    const own = ownColor(H, "p1");
    expect(own).toBe(PLAYER_COLORS.jade);
    const row = paletteSwatches(others, own, PLAYER_COLORS.jade);
    expect(row.map((s) => s.name)).toEqual([
      "Amber",
      "Jade",
      "Sky",
      "Rose",
      "Yellow",
      "Blue",
      "Vermillion",
      "Bronze",
    ]);
    const by = Object.fromEntries(row.map((s) => [s.key, s]));
    expect(by.jade).toMatchObject({ checked: true, blockedBy: null });
    expect(by.amber).toMatchObject({ blockedBy: "dm", reason: "taken", message: "Taken by DM" });
    expect(by.blue).toMatchObject({
      blockedBy: "p2",
      reason: "too-close",
      message: "Too close to Player 2's colour for colour-blind players",
    });
    expect(by.sky).toMatchObject({ blockedBy: "p2", reason: "too-close" });
    for (const k of ["rose", "yellow", "vermillion", "bronze"] as const) {
      expect(by[k]?.blockedBy).toBeNull();
    }
    // The DM target: no DM among the others; the own Amber never blocked.
    const dmRow = paletteSwatches(othersOf(H, null), ownColor(H, null), PLAYER_COLORS.amber);
    expect(dmRow.find((s) => s.key === "amber")).toMatchObject({ blockedBy: null, checked: true });
    expect(dmRow.find((s) => s.key === "jade")?.blockedBy).toBe("p1");
  });

  test("FR-CAMP-35 picker: static render in the Preferences 'Your colour' section (player): one row of 8, blocked ones aria-disabled (still hoverable), no Tooltip in the row; square, hue, hex, preview, others, Apply", () => {
    const html = renderWith(
      snapshotStore("player"),
      "live",
      <PreferencesWindow sections={[colorSection]} />,
    );
    expect(html).toContain('data-record-id="camp.color"');
    expect(html).toContain(">Your colour</h3>");
    expect(tagOf(html, "camp-color-picker")).toContain('data-target="p1"');
    const sw = swatchAttrs(html);
    expect(Object.keys(sw)).toEqual(Object.values(PLAYER_COLORS));
    expect(sw[PLAYER_COLORS.jade]).toMatchObject({ state: "checked", ariaDisabled: false });
    expect(sw[PLAYER_COLORS.blue]).toMatchObject({ blockedBy: "p2", ariaDisabled: true });
    expect(sw[PLAYER_COLORS.sky]).toMatchObject({ blockedBy: "p2", ariaDisabled: true });
    expect(sw[PLAYER_COLORS.amber]).toMatchObject({ blockedBy: "dm", name: "Amber" });
    // Blocked swatches are not `disabled` (that would swallow hover / focus for the reason line).
    expect(html).not.toMatch(/data-testid="camp-color-swatch"[^>]* disabled=""/);
    // BL-36: no Tooltip anywhere in the picker.
    expect(html).not.toContain('data-state="delayed-open"');
    expect(html).not.toContain("ui-tooltip");
    const sv = tagOf(html, "camp-color-sv");
    expect(sv).toContain('role="slider"');
    expect(sv).toContain('data-hue="162"');
    expect(sv).toContain('aria-valuetext="Saturation 86 %, brightness 73 %"');
    expect(html).toContain('data-testid="camp-color-sv-marker"');
    expect(html).toContain('data-testid="camp-color-hue"');
    expect(tagOf(html, "camp-color-hex")).toContain(`value="${PLAYER_COLORS.jade}"`);
    expect(tagOf(html, "camp-color-preview")).toContain(`data-color="${PLAYER_COLORS.jade}"`);
    expect(html).toContain(">Player 1</span>");
    const others = /data-testid="camp-color-others"[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(others.replace(/<[^>]+>/g, "")).toBe("● DM · ● Player 2");
    expect(tagOf(html, "camp-color-status")).not.toContain("data-reason");
    // Unchanged draft → Apply disabled.
    expect(tagOf(html, "camp-color-apply")).toContain("disabled");
  });

  test("FR-CAMP-35 picker: the DM's section targets the DM colour; the Players panel trigger carries the hex", () => {
    expect(ownTarget({ campaignId: "c1", role: "dm", playerId: null })).toBeNull();
    expect(ownTarget({ campaignId: "c1", role: "player", playerId: "p1" })).toBe("p1");
    expect(ownTarget(null)).toBeUndefined();
    const dm = snapshotStore("dm");
    const html = renderWith(dm, "live", <PreferencesWindow sections={[colorSection]} />);
    expect(tagOf(html, "camp-color-picker")).toContain('data-target="dm"');
    expect(swatchAttrs(html)[PLAYER_COLORS.amber]).toMatchObject({ state: "checked" });
    const trig = renderWith(
      dm,
      "live",
      <>
        <ColorPickerPopover target={null} testId="camp-color-dm" tip="Your colour (DM)" />
        <ColorPickerPopover
          target="p2"
          testId="camp-player-color"
          recordId="p2"
          tip="Player 2's colour"
        />
      </>,
    );
    expect(tagOf(trig, "camp-color-dm")).toContain(`data-value="${PLAYER_COLORS.amber}"`);
    const p2 = tagOf(trig, "camp-player-color");
    expect(p2).toContain(`data-value="${LAVENDER}"`);
    expect(p2).toContain('data-record-id="p2"');
    expect(p2).toContain(`background-color:${LAVENDER}`);
    expect(p2).toContain('aria-label="Player 2&#x27;s colour: #b388ff"');
  });

  test("FR-CAMP-35 picker: reason line and Apply: #3d6ec9 too dark; #7fd8ff fine → Apply; not live or in flight → disabled, draft kept; bad hex; no colour at a hue; a hovered blocked swatch names its reason", () => {
    const rules = pickerRules(othersOf(H, "p1"));
    const base = {
      hexText: null,
      hint: null,
      stored: PLAYER_COLORS.jade,
      rules,
      live: true,
      inFlight: false,
    };
    const view = (hex: string, extra: Partial<Parameters<typeof pickerView>[0]> = {}) =>
      pickerView({ ...base, draft: draftOf(hex), ...extra });
    expect(view(PLAYER_COLORS.jade)).toEqual({ badHex: false, status: null, canApply: false });
    expect(view("#3d6ec9")).toEqual({
      badHex: false,
      status: { reason: "too-dark", message: "Too dark to read on the map", block: true },
      canApply: false,
    });
    expect(view("#7fd8ff")).toEqual({ badHex: false, status: null, canApply: true });
    expect(view("#7fd8ff", { live: false }).canApply).toBe(false);
    expect(view("#7fd8ff", { inFlight: true }).canApply).toBe(false);
    for (const [hex, reason] of [
      ["#a0c814", "too-close"],
      ["#b388ff", "taken"],
      ["#9e9e9e", "too-grey"],
      ["#f05555", "too-red"],
    ] as const) {
      expect(view(hex)).toMatchObject({ status: { reason }, canApply: false });
    }
    expect(view("#7fd8ff", { hexText: "#7fd8f" })).toEqual({
      badHex: true,
      status: { reason: "bad-hex", message: "Enter a colour as #rrggbb or #rgb", block: true },
      canApply: false,
    });
    const none = clamp({ h: 213, s: 50, v: 50 }, pickerRules(othersOf(H, "p1")), new Set());
    const noneView = pickerView({ ...base, draft: { ...none, none: true } });
    expect(noneView).toMatchObject({
      status: { reason: "no-colour", message: "No allowed colour at this hue" },
      canApply: false,
    });
    const row = paletteSwatches(othersOf(H, "p1"), PLAYER_COLORS.jade, PLAYER_COLORS.jade);
    const blue = row.find((s) => s.key === "blue") ?? null;
    const rose = row.find((s) => s.key === "rose") ?? null;
    expect(view("#7fd8ff", { hint: blue })).toMatchObject({
      status: {
        reason: "too-close",
        message: "Too close to Player 2's colour for colour-blind players",
        block: true,
      },
      canApply: true,
    });
    expect(view(PLAYER_COLORS.jade, { hint: rose }).status).toEqual({
      reason: null,
      message: "Rose",
      block: false,
    });
  });

  test("FR-CAMP-35 picker: not live → the picker still renders the draft, Apply disabled", () => {
    const html = renderWith(
      snapshotStore("player"),
      "reconnecting",
      <PreferencesWindow sections={[colorSection]} />,
    );
    expect(tagOf(html, "camp-color-apply")).toContain("disabled");
    expect(Object.keys(swatchAttrs(html))).toHaveLength(8);
  });

  test("FR-CAMP-35 picker: square keyboard: arrows 1 %, Shift 10 %, Home / End = S edges, PageUp / PageDown = V edges, clamped to 0–100", () => {
    const at = { s: 50, v: 50 };
    expect(keyTarget("ArrowLeft", false, at)).toEqual({ s: 49, v: 50 });
    expect(keyTarget("ArrowRight", true, at)).toEqual({ s: 60, v: 50 });
    expect(keyTarget("ArrowUp", false, at)).toEqual({ s: 50, v: 51 });
    expect(keyTarget("ArrowDown", true, at)).toEqual({ s: 50, v: 40 });
    expect(keyTarget("Home", false, at)).toEqual({ s: 0, v: 50 });
    expect(keyTarget("End", false, at)).toEqual({ s: 100, v: 50 });
    expect(keyTarget("PageUp", false, at)).toEqual({ s: 50, v: 100 });
    expect(keyTarget("PageDown", false, at)).toEqual({ s: 50, v: 0 });
    expect(keyTarget("ArrowRight", true, { s: 95, v: 3 })).toEqual({ s: 100, v: 3 });
    expect(keyTarget("ArrowDown", true, { s: 95, v: 3 })).toEqual({ s: 95, v: 0 });
    expect(keyTarget("a", false, at)).toBeNull();
    // A keyboard target that breaks the rules is clamped like a pointer one.
    const rules = pickerRules(othersOf(H, "p1"));
    const down = clamp({ h: 162, s: 86, v: 0 }, rules, new Set());
    expect(rules.allowed(hsvToHex(down))).toBe(true);
    expect(down.s).toBe(86);
  });

  test("FR-CAMP-35 picker: Apply sends one camp.setColor with the hex; a reject goes to the Toast handler and reports false", async () => {
    const sent: [string, unknown][] = [];
    const ok = await pickColor(
      async (n, p) => {
        sent.push([n, p]);
        return {};
      },
      "p1",
      "#7fd8ff",
    );
    expect(ok).toBe(true);
    expect(sent).toEqual([[SET_COLOR_INTENT, { playerId: "p1", color: "#7fd8ff" }]]);
    const rejected: unknown[] = [];
    const err = new IntentRejected("conflict", "Too close to Player 2's colour");
    const res = await pickColor(
      async () => {
        throw err;
      },
      null,
      "#7fd8ff",
      (e) => rejected.push(e),
    );
    expect(res).toBe(false);
    expect(rejected).toEqual([err]);
  });
});
