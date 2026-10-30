// FOG §13 sprint-4 client rows (V10): the party union render (FR-FOG-21 / -50 / -51: every held
// `vision` record, each through its owner's sight previews, FR-FOG-54), party-blind and the
// secret-Blinded non-source (FR-FOG-48), the blind chip reason, View as Party (FR-FOG-43: every
// record and every memory row), the grey darkvision ring (FR-FOG-21) and the Party vision Switch
// (FR-FOG-49).
import { describe, expect, test } from "bun:test";
import {
  FOG_EXPLORED_TYPE,
  FOG_INTENTS,
  FOG_SETTINGS_TYPE,
  type FogExploredRecord,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import { VIEW_AS_PARTY } from "@shared/protocol/scene-window";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { FogBlindChip } from "./BlindChip";
import { blindReasonOf, isBlind } from "./blind";
import { saturation } from "./grey-map";
import { PARTY_VISION_TIP, PartyVisionSwitch } from "./PartyVisionSwitch";
import { cellSquares, Raster } from "./paint-raster";
import { BLIND_TEXTS, partyView, partyVisionOn } from "./party-view";
import { FOG_ALPHA } from "./render";
import { visionOf } from "./view-as";
import { paintPlayerView, VISION_ALPHA, type ViewPaints } from "./vision-render";

const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
const vis = (playerId: string, v: Partial<VisionRecord> = {}): VisionRecord => ({
  id: `s:${playerId}`,
  sceneId: "s",
  playerId,
  blind: false,
  see: [],
  dark: [],
  src: [],
  ...v,
});
const memRow = (playerId: string, cells: [number, number][]): FogExploredRecord => ({
  id: `s:${playerId}`,
  sceneId: "s",
  playerId,
  shape: cellSquares(cells),
});
function records(
  visions: VisionRecord[],
  party = false,
  explored: FogExploredRecord[] = [],
): RecordStore["records"] {
  return {
    [VISION_TYPE]: Object.fromEntries(visions.map((v) => [v.id, v])),
    [FOG_EXPLORED_TYPE]: Object.fromEntries(explored.map((r) => [r.id, r])),
    [FOG_SETTINGS_TYPE]: { c1: { id: "c1", partyVision: party } },
  };
}
const p1 = vis("p1", { see: [rect(1, 1, 3, 3)], src: ["mira"] });
const p2 = vis("p2", { dark: [rect(5, 1, 8, 4)], src: ["thorn"], inv: [0] });

describe("FR-FOG-21 / -50 / -51 party union render (V10)", () => {
  test("FR-FOG-51 party off: own record only (another held record is not drawn); on: every record, `shared` = the others", () => {
    const off = partyView(records([p1, p2]), "s", "p1");
    expect(off.vision).toEqual({ blind: false, see: p1.see, dark: [], inv: [], src: ["mira"] });
    expect(off.shared).toEqual([]);
    const on = partyView(records([p1, p2], true), "s", "p1");
    expect(on.vision?.see).toEqual(p1.see);
    expect(on.vision?.dark).toEqual(p2.dark);
    expect(on.vision?.src).toEqual(["mira", "thorn"]);
    expect(on.shared).toEqual(["p2"]);
    expect(partyVisionOn(records([], true))).toBe(true);
    expect(partyVisionOn(records([]))).toBe(false);
  });

  test("FR-FOG-50 union: `inv` re-indexed into `see ++ dark` of the union (own records only carry it)", () => {
    const v = partyView(records([p1, p2], true), "s", "p2").vision;
    // see: [p1 see], dark: [p2 dark] → p2's dark polygon is index 1.
    expect(v?.inv).toEqual([1]);
    expect(visionOf(v ?? null).polys.map((p) => p.seesInvisible)).toEqual([false, true]);
  });

  test("FR-FOG-54 each record takes its owner's sight previews: a party member's drag shows for others", () => {
    const preview = { tokenId: "thorn", ownerPlayerId: "p2", see: [rect(2, 2, 4, 4)], dark: [] };
    const v = partyView(records([p1, p2], true), "s", "p1", [preview]);
    expect(v.preview).toEqual(["thorn"]);
    expect(v.vision?.see).toEqual([...p1.see, rect(2, 2, 4, 4)]);
    expect(v.vision?.dark).toEqual([]);
    // Off: the other's record isn't drawn, so its preview isn't either.
    expect(partyView(records([p1, p2]), "s", "p1", [preview]).preview).toEqual([]);
  });

  test("FR-FOG-36 / -50 party-blind: own blind + another sighted → not blind; everyone blind → blind; off → own", () => {
    const blindP1 = vis("p1", { blind: true, reason: "blinded" });
    expect(isBlind({ ...emptyStore(), records: records([blindP1, p2], true) }, "s", "p1")).toBe(
      false,
    );
    expect(isBlind({ ...emptyStore(), records: records([blindP1, p2]) }, "s", "p1")).toBe(true);
    const blindP2 = vis("p2", { blind: true });
    expect(
      isBlind({ ...emptyStore(), records: records([blindP1, blindP2], true) }, "s", "p1"),
    ).toBe(true);
    // A player without a source of their own while party vision is on: the party's.
    expect(isBlind({ ...emptyStore(), records: records([p2], true) }, "s", "p3")).toBe(false);
  });

  test("FR-FOG-48 secret Blinded: own record (reason `unknown`) is a non-source for the party, never party-blind; off: blind, reason `unknown`", () => {
    const secret = vis("p1", { blind: true, reason: "unknown" });
    const nonSource = vis("p2", { blind: false });
    const on = partyView(records([secret, vis("p2", { blind: true })], true), "s", "p1");
    expect(on.vision?.blind).toBe(false);
    expect(partyView(records([secret, nonSource], true), "s", "p2").vision?.blind).toBe(false);
    const off = partyView(records([secret]), "s", "p1");
    expect(off.vision?.blind).toBe(true);
    expect(off.reason).toBe("unknown");
  });

  test("FR-FOG-21 chip reason: the own record's (`blinded`), darkness when it has none, `unknown` for a party-blind player without a blind own record", () => {
    expect(
      partyView(records([vis("p1", { blind: true, reason: "blinded" })]), "s", "p1").reason,
    ).toBe("blinded");
    expect(partyView(records([vis("p1", { blind: true })]), "s", "p1").reason).toBe("darkness");
    expect(partyView(records([vis("p2", { blind: true })], true), "s", "p3").reason).toBe(
      "unknown",
    );
    expect(partyView(records([p1]), "s", "p1").reason).toBeNull();
    const store = {
      ...emptyStore(),
      you: { campaignId: "c1", role: "player" as const, playerId: "p1" },
      records: records([vis("p1", { blind: true, reason: "blinded" })]),
    };
    expect(blindReasonOf(store)).toBe("blinded");
    expect(BLIND_TEXTS).toEqual({
      darkness: "Magical darkness — you can't see",
      blinded: "Blinded — you can't see",
      unknown: "You can't see",
    });
  });

  test("FR-FOG-21 / -48 the chip shows the reason's text and `data-reason`", () => {
    for (const r of ["darkness", "blinded", "unknown"] as const) {
      const html = renderToStaticMarkup(<FogBlindChip blind reason={r} />);
      expect(html).toContain(`data-reason="${r}"`);
      expect(html).toContain(BLIND_TEXTS[r].replace("'", "&#x27;"));
    }
  });
});

describe("FR-FOG-43 View as Party (V10)", () => {
  test("FR-FOG-43 View as Party draws every record and every memory row, also while party vision is off (OQ-FOG-55)", () => {
    const rows = [memRow("p1", [[1, 1]]), memRow("p2", [[2, 1]])];
    const v = partyView(records([p1, p2], false, rows), "s", VIEW_AS_PARTY);
    expect(v.vision?.src).toEqual(["mira", "thorn"]);
    expect(v.shared).toEqual(["p1", "p2"]);
    expect(v.explored.map((r) => r.playerId)).toEqual(["p1", "p2"]);
    expect(v.explored.map((r) => r.shape)).toEqual([cellSquares([[1, 1]]), cellSquares([[2, 1]])]);
    // View as P1 with party vision on: every record, own memory only.
    const asP1 = partyView(records([p1, p2], true, rows), "s", "p1");
    expect(asP1.shared).toEqual(["p2"]);
    expect(asP1.explored.map((r) => r.playerId)).toEqual(["p1"]);
  });
});

describe("FR-FOG-21 grey darkvision ring (V10)", () => {
  const map = { mapWidth: 100, mapHeight: 60, gridCellSize: 10, gridOffsetX: 0, gridOffsetY: 0 };
  const paints: ViewPaints = {
    fog: { color: "F", alpha: FOG_ALPHA.player.fog },
    explored: { color: "E", alpha: FOG_ALPHA.player.explored },
    darkness: { color: "D", alpha: FOG_ALPHA.player.darkness },
    darkvision: { color: "V", alpha: VISION_ALPHA.darkvision },
    darknessSeen: { color: "S", alpha: VISION_ALPHA.darknessSeen },
  };
  const px = (r: Raster, c: number, row: number) => r.at(c * 10 + 5, row * 10 + 5);
  const fog = {
    fill: "fog" as const,
    box: [0, 0, 10, 6] as [number, number, number, number],
    runs: "",
    shapes: [{ op: "reveal" as const, rect: [6, 0, 8, 2] as [number, number, number, number] }],
  };
  const paint = (grey: unknown) => {
    const r = new Raster(100, 60);
    const v = { blind: false, see: [rect(1, 1, 4, 4)], dark: [rect(0, 0, 8, 6)] };
    paintPlayerView(r, { fog, memory: [], vision: v, grey: grey as never }, map, paints);
    return r;
  };

  test("FR-FOG-21 grey ring: the map's greyscale copy under the darkvision paint in the ring, never over static clear or `see`", () => {
    const r = paint("grey");
    expect(px(r, 5, 4)).toEqual({ label: "V", alpha: VISION_ALPHA.darkvision, img: "grey" });
    expect(px(r, 7, 1).label).toBeNull(); // ring over a revealed area: clear (colours kept)
    expect(px(r, 2, 2).label).toBeNull(); // in `see`
    expect(px(r, 9, 4)).toEqual({ label: "F", alpha: 1 }); // outside every polygon
    // No copy yet (image loading): the plain tint, as sprint 3.
    expect(px(paint(null), 5, 4)).toEqual({ label: "V", alpha: VISION_ALPHA.darkvision });
  });

  test("FR-FOG-21 no hue left: a greyscale pixel has saturation 0; the red map art 1", () => {
    expect(saturation(200, 30, 30)).toBeGreaterThan(0.5);
    const l = 0.34 * 200 + 0.5 * 30 + 0.16 * 30;
    expect(saturation(l, l, l)).toBe(0);
  });
});

describe("FR-FOG-49 Party vision Switch (V10)", () => {
  const render = (on: boolean) => {
    const sync = createStore<SyncState>()(
      () =>
        ({
          state: "live",
          store: {
            ...emptyStore(),
            records: { [FOG_SETTINGS_TYPE]: { c1: { id: "c1", partyVision: on } } },
          },
          connection: { sendIntent: () => Promise.resolve({}) },
        }) as unknown as SyncState,
    );
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <PartyVisionSwitch disabled={false} />
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  };

  test("FR-FOG-49 the Switch follows the campaign's `fog-settings` (`fog-party-vision` `data-state`)", () => {
    expect(render(true)).toContain('data-state="checked"');
    expect(render(false)).toContain('data-state="unchecked"');
    expect(render(false)).toContain("Party vision");
    expect(PARTY_VISION_TIP).toBe("Every player sees what any player sees — all scenes");
    expect(FOG_INTENTS.setPartyVision).toBe("fog.setPartyVision");
  });
});
