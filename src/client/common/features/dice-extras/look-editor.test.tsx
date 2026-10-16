// "Dice look" editor (FR-DICEX-27): pure draft logic, and a static render of the editor over a
// fake sync store (stored own look loaded, Save needs live + a change, contrast hint).
// FR-DICEX-20: throws take each roller's stored look first (`looksOf`).
import { describe, expect, test } from "bun:test";
import {
  DICE_LOOK_TYPE,
  type DiceLook,
  type DiceLookRecord,
  defaultLook,
  STYLE_LOOK,
} from "@shared/dice-extras/looks";
import type { DiceThrow } from "@shared/dice-extras/throw";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { LookEditor } from "./LookEditor";
import {
  contrastRatio,
  draftLook,
  draftReducer,
  editorView,
  LOOK_PALETTE,
  MIN_PIP_CONTRAST,
  parseHex,
} from "./look-editor";
import { looksOf } from "./ThrowLayer";

const CRIMSON_METAL: DiceLook = {
  style: "crimson",
  body: "#8b1a1a",
  pips: "#ffffff",
  material: "metal",
};

const row = (ownerPlayerId: string | null, look: DiceLook): DiceLookRecord => ({
  id: `look-${ownerPlayerId ?? "dm"}`,
  campaignId: "c1",
  ownerKey: ownerPlayerId ?? "dm",
  ownerPlayerId,
  ...look,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("FR-DICEX-27 look editor logic", () => {
  test("FR-DICEX-27 a style swatch loads that style's starting look; Reset = the draft style's defaults", () => {
    let d = draftReducer(CRIMSON_METAL, { type: "style", style: "emerald" });
    expect(d).toEqual(STYLE_LOOK.emerald);
    d = draftReducer(d, { type: "body", value: "#123456" });
    d = draftReducer(d, { type: "material", material: "stone" });
    expect(d).toEqual({ ...STYLE_LOOK.emerald, body: "#123456", material: "stone" });
    expect(draftReducer(d, { type: "reset" })).toEqual(STYLE_LOOK.emerald);
    expect(draftReducer(d, { type: "load", look: CRIMSON_METAL })).toEqual(CRIMSON_METAL);
  });

  test("FR-DICEX-27 hex input: #rrggbb (or without #), lower-cased; anything else invalid", () => {
    expect(parseHex("#8B1A1A")).toBe("#8b1a1a");
    expect(parseHex("8b1a1a")).toBe("#8b1a1a");
    expect(parseHex(" #ffffff ")).toBe("#ffffff");
    for (const bad of ["#fff", "red", "#12345g", "", "#1234567"]) expect(parseHex(bad)).toBeNull();
    expect(draftLook({ ...CRIMSON_METAL, body: "#8B1A1A" })).toEqual(CRIMSON_METAL);
    expect(draftLook({ ...CRIMSON_METAL, pips: "#ff" })).toBeNull();
    expect(LOOK_PALETTE).toHaveLength(12);
    for (const c of LOOK_PALETTE) expect(parseHex(c)).toBe(c);
  });

  test("FR-DICEX-27 Save needs live, a valid draft and a change; low contrast → hint, still allowed", () => {
    expect(editorView(CRIMSON_METAL, CRIMSON_METAL, true)).toMatchObject({
      dirty: false,
      canSave: false,
      lowContrast: false,
    });
    const gold = STYLE_LOOK.gold;
    expect(editorView(gold, CRIMSON_METAL, true).canSave).toBe(true);
    expect(editorView(gold, CRIMSON_METAL, false).canSave).toBe(false);
    const invalid = editorView({ ...gold, body: "#zz" }, CRIMSON_METAL, true);
    expect(invalid).toMatchObject({ bodyInvalid: true, pipsInvalid: false, canSave: false });
    // Same case-insensitive colours = no change.
    expect(editorView({ ...CRIMSON_METAL, body: "#8B1A1A" }, CRIMSON_METAL, true).dirty).toBe(
      false,
    );
    const low = editorView({ ...gold, body: "#777777", pips: "#888888" }, CRIMSON_METAL, true);
    expect(low).toMatchObject({ lowContrast: true, canSave: true });
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(MIN_PIP_CONTRAST);
    for (const s of Object.values(STYLE_LOOK)) {
      expect([s.style, editorView(s, CRIMSON_METAL, true).lowContrast]).toEqual([s.style, false]);
    }
  });
});

function render(o: { live?: boolean; role?: "dm" | "player"; rows?: DiceLookRecord[] } = {}) {
  const role = o.role ?? "player";
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const players = {
    p1: { id: "p1", campaignId: "c1", name: "Player 1" },
    p2: { id: "p2", campaignId: "c1", name: "Player 2" },
  };
  const looks = Object.fromEntries((o.rows ?? []).map((r) => [r.id, r]));
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "disconnected" : "live",
        store: { ...emptyStore(), you, records: { player: players, [DICE_LOOK_TYPE]: looks } },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <LookEditor onBack={() => {}} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** An attribute of the first tag with this test id (and `data-value`); "" = present, no value. */
function attrOf(html: string, testId: string, attr: string, value?: string): string | null {
  const tags = html.match(/<[^>]+>/g) ?? [];
  const tag = tags.find(
    (t) =>
      t.includes(`data-testid="${testId}"`) &&
      (value === undefined || t.includes(`data-value="${value}"`)),
  );
  if (!tag) return null;
  const m = tag.match(new RegExp(`\\s${attr}(?:="([^"]*)")?`));
  return m ? (m[1] ?? "") : null;
}

describe("FR-DICEX-27 Dice look editor (static render)", () => {
  test("FR-DICEX-27 opens on the own stored look: style, colours, material; Save disabled until a change", () => {
    const html = render({ rows: [row("p1", CRIMSON_METAL), row(null, STYLE_LOOK.gold)] });
    for (const id of [
      "dicex-look-style",
      "dicex-look-body",
      "dicex-look-pips",
      "dicex-look-material",
      "dicex-look-save",
      "dicex-look-reset",
      "dicex-look-preview",
    ])
      expect([id, html.includes(`data-testid="${id}"`)]).toEqual([id, true]);
    expect(html.match(/data-testid="dicex-look-style"/g)).toHaveLength(8);
    expect(html.match(/data-testid="dicex-look-body-swatch"/g)).toHaveLength(12);
    expect(attrOf(html, "dicex-look-style", "aria-pressed", "crimson")).toBe("true");
    expect(attrOf(html, "dicex-look-style", "aria-pressed", "gold")).toBe("false");
    expect(attrOf(html, "dicex-look-body", "value")).toBe("#8b1a1a");
    expect(attrOf(html, "dicex-look-pips", "value")).toBe("#ffffff");
    expect(attrOf(html, "dicex-look-material", "data-state", "metal")).toBe("on");
    expect(attrOf(html, "dicex-look-save", "disabled")).toBe("");
    expect(html).not.toContain('data-testid="dicex-look-contrast"');
    // No WebGL in a static render: the preview is flat, in the look's colours.
    expect(attrOf(html, "dicex-look-preview", "data-render")).toBe("flat");
    expect(html).toContain("background-color:#8b1a1a");
  });

  test("FR-DICEX-24 FR-DICEX-27 no stored row: the derived default (DM Obsidian, player by sorted id)", () => {
    const dm = render({ role: "dm" });
    expect(attrOf(dm, "dicex-look-style", "aria-pressed", "obsidian")).toBe("true");
    const p1 = render();
    const style = defaultLook("p1", ["p1", "p2"]).style;
    expect(attrOf(p1, "dicex-look-style", "aria-pressed", style)).toBe("true");
    expect(attrOf(p1, "dicex-look-body", "value")).toBe(STYLE_LOOK.crimson.body);
  });

  test("FR-DICEX-27 a stored low-contrast look shows the contrast hint", () => {
    const html = render({
      rows: [row("p1", { ...CRIMSON_METAL, body: "#777777", pips: "#888888" })],
    });
    expect(html).toContain('data-testid="dicex-look-contrast"');
  });
});

describe("FR-DICEX-20 each die in its roller's look", () => {
  test("FR-DICEX-20 stored row first, else the derived default; DM rolls use the DM look", () => {
    const t = { entryIds: ["e1", "e2", "e3"] } as unknown as DiceThrow;
    const entries = [
      { id: "e1", rollerRole: "dm", rollerPlayerId: null },
      { id: "e2", rollerRole: "player", rollerPlayerId: "p1" },
      { id: "e3", rollerRole: "player", rollerPlayerId: "p2" },
      { id: "other", rollerRole: "player", rollerPlayerId: "p1" },
    ];
    const ids = ["p2", "p1"];
    const stored = [row(null, STYLE_LOOK.gold), row("p1", CRIMSON_METAL)];
    expect(looksOf(t, entries, ids, stored)).toEqual({
      e1: STYLE_LOOK.gold,
      e2: CRIMSON_METAL,
      e3: defaultLook("p2", ids),
    });
    expect(looksOf(t, entries, ids, [])).toEqual({
      e1: STYLE_LOOK.obsidian,
      e2: STYLE_LOOK.crimson,
      e3: STYLE_LOOK.sapphire,
    });
  });
});
