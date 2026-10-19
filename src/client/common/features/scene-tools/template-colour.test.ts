// FR-SCN-47 template colour (sprint 5, K3): kept → the placer's colour (null = the DM's),
// ephemeral → the sender's (`from`), own → own; hidden → `visibility.hidden` (OQ-SCN-41 A);
// unknown → role accent; "· by ‹name›" on hover / selection; `by` = player id | `dm`.
import { describe, expect, test } from "bun:test";
import { PLAYER_COLORS } from "@shared/campaign-management/colors";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { ROLE_ACCENT_FALLBACK } from "../campaign-management/colors";
import { byAttr, personName, placerOf, selfOf } from "../scenes-map/mark-colors";
import {
  createEphemeralStore,
  ephemeralsOn,
  placeFrame,
  receiveTemplate,
  templateCaptionBy,
  templateColor,
} from "./templates";

const none = () => "";
const HIDDEN = "rgba(163,163,163,0.55)";

const S = applySnapshot({
  type: "snapshot",
  seq: 0,
  you: { campaignId: "c1", role: "player", playerId: "p1" },
  records: {
    campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: "amber" }],
    player: [
      { id: "p1", campaignId: "c1", name: "Player 1", color: "jade" },
      { id: "p2", campaignId: "c1", name: "Player 2", color: "blue" },
    ],
  },
} as never) as RecordStore;

describe("FR-SCN-47 template colour", () => {
  test("FR-SCN-47 template colour: kept per placer, ephemeral per sender, own per self; hidden styling wins; unknown → role accent; `by` attrs", () => {
    // Kept: Spirit Guardians (player-1), Web (DM: placedByPlayerId null).
    const sg = placerOf({ placedByPlayerId: "p1" });
    const web = placerOf({ placedByPlayerId: null });
    expect(templateColor(S, sg, false, HIDDEN, none)).toBe(PLAYER_COLORS.jade);
    expect(templateColor(S, web, false, HIDDEN, none)).toBe(PLAYER_COLORS.amber);
    expect([byAttr(sg), byAttr(web)]).toEqual(["p1", "dm"]);
    // Hidden (Glyph, DM only): `visibility.hidden`, not the colour.
    expect(templateColor(S, web, true, HIDDEN, none)).toBe(HIDDEN);
    // Ephemeral: the sender stamped on the frame.
    const eph = createEphemeralStore();
    const frame = placeFrame(
      "s1",
      "k",
      { shape: "sphere", x: 5, y: 5, size: 20, width: null, angle: 0, label: "" },
      false,
    );
    receiveTemplate(eph, { role: "player", playerId: "p2" }, frame, 0);
    const [e] = ephemeralsOn(eph.getState(), "s1");
    expect(e?.from).toEqual({ role: "player", playerId: "p2" });
    expect(templateColor(S, e?.from ?? web, false, HIDDEN, none)).toBe(PLAYER_COLORS.blue);
    // Own (player-1's client): own colour, `by` = own id, never `self`.
    const own = selfOf("player", "p1");
    expect(templateColor(S, own, false, HIDDEN, none)).toBe(PLAYER_COLORS.jade);
    expect(byAttr(own)).toBe("p1");
    // A placer with no `player` record here → the player role accent.
    const gone = placerOf({ placedByPlayerId: "p9" });
    expect(templateColor(S, gone, false, HIDDEN, none)).toBe(ROLE_ACCENT_FALLBACK.player);
  });

  test("FR-SCN-47 template colour: label reads '· by ‹name›' only while hovered or selected", () => {
    const sg = placerOf({ placedByPlayerId: "p1" });
    expect(templateCaptionBy("Spirit Guardians", 12, null)).toBe("Spirit Guardians · 12 squares");
    expect(templateCaptionBy("Spirit Guardians", 12, personName(S, sg))).toBe(
      "Spirit Guardians · 12 squares · by Player 1",
    );
    expect(templateCaptionBy("", 1, personName(S, placerOf({ placedByPlayerId: null })))).toBe(
      "1 square · by DM",
    );
  });
});
