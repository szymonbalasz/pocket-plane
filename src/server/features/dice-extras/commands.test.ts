// FR-DICEX-26 `dicex.setLook` (DM, player; owner = sender): own row only, same look → no event,
// bad input → invalid, row + log + `DiceLookSet` in one transaction (crash → none).
// FR-DICEX-25 visibility: every viewer of the campaign gets every row (event and snapshot).
import { afterEach, describe, expect, test } from "bun:test";
import {
  DICEX_INTENTS as D,
  DICE_LOOK_TYPE,
  type DiceLookRecord,
  STYLE_LOOK,
} from "@shared/dice-extras/looks";
import { DiceLookSet } from "@shared/events/dice-extras";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { readEventLog } from "../../events/log";
import { SET_LOOK_FOR } from "./commands";
import { listLooks } from "./rows";
import { dicexSetup } from "./testing";

afterEach(() => armCrashHook(null));

const CRIMSON_METAL = { style: "crimson", body: "#8b1a1a", pips: "#ffffff", material: "metal" };

function setup() {
  const t = dicexSetup();
  const looks = (cid = t.h.campaignId) => listLooks(t.s.db, cid);
  const logTypes = () => readEventLog(t.s.db).map((l) => l.type);
  return { ...t, looks, logTypes };
}

describe("FR-DICEX-26 dicex.setLook", () => {
  test("FR-DICEX-26 DM and player each write their own row; one log row + one DiceLookSet each", () => {
    const t = setup();
    const log0 = t.logTypes().length;
    const dm = t.run<{ lookId: string }>(D.setLook, STYLE_LOOK.obsidian);
    const p1 = t.run<{ lookId: string }>(D.setLook, CRIMSON_METAL, t.player(t.h.p1.id));
    expect(dm.lookId).not.toBe(p1.lookId);
    const rows = t.looks();
    expect(rows.map((r) => [r.ownerKey, r.ownerPlayerId, r.style, r.material])).toEqual(
      [
        ["dm", null, "obsidian", "stone"],
        [t.h.p1.id, t.h.p1.id, "crimson", "metal"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(rows.find((r) => r.ownerKey === t.h.p2.id)).toBeUndefined();
    expect(t.logTypes().slice(log0)).toEqual([DiceLookSet.type, DiceLookSet.type]);
    const ev = t.events.at(-1)?.event;
    expect(ev).toMatchObject({
      type: DiceLookSet.type,
      campaignId: t.h.campaignId,
      payload: { lookId: p1.lookId },
      changes: [
        {
          type: DICE_LOOK_TYPE,
          id: p1.lookId,
          before: null,
          after: { id: p1.lookId, ownerKey: t.h.p1.id, body: "#8b1a1a", pips: "#ffffff" },
        },
      ],
    });
    expect(t.events.at(-1)?.meta.actor.playerId).toBe(t.h.p1.id);
  });

  test("FR-DICEX-26 a change updates the same row (id kept, before → after); the same look writes nothing", () => {
    const t = setup();
    const p1 = t.player(t.h.p1.id);
    const first = t.run<{ lookId: string }>(D.setLook, CRIMSON_METAL, p1);
    const digest = stateDigest(t.s.db.$client).sha256;
    const n0 = t.events.length;
    // Same look, colours in another case: no write, no event, same id.
    const again = t.run<{ lookId: string }>(
      D.setLook,
      { ...CRIMSON_METAL, body: "#8B1A1A", pips: "#FFFFFF" },
      p1,
    );
    expect(again.lookId).toBe(first.lookId);
    expect(t.events.length).toBe(n0);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    const next = t.run<{ lookId: string }>(D.setLook, STYLE_LOOK.emerald, p1);
    expect(next.lookId).toBe(first.lookId);
    expect(t.looks()).toHaveLength(1);
    expect(t.events.at(-1)?.event.changes[0]).toMatchObject({
      before: { style: "crimson", material: "metal" },
      after: { style: "emerald", material: "glass", body: STYLE_LOOK.emerald.body },
    });
  });

  test("FR-DICEX-26 bad colour / style / material / an owner field → invalid, nothing written", () => {
    const t = setup();
    const p1 = t.player(t.h.p1.id);
    const bad = [
      { ...CRIMSON_METAL, body: "red" },
      { ...CRIMSON_METAL, pips: "#fff" },
      { ...CRIMSON_METAL, body: "#12345g" },
      { ...CRIMSON_METAL, style: "ruby" },
      { ...CRIMSON_METAL, material: "wood" },
      { ...CRIMSON_METAL, ownerPlayerId: t.h.p2.id },
      { ...CRIMSON_METAL, ownerKey: t.h.p2.id },
      { style: "crimson" },
    ];
    for (const input of bad) expect(t.err(() => t.run(D.setLook, input, p1)).code).toBe("invalid");
    expect(t.looks()).toEqual([]);
    expect(t.events).toEqual([]);
  });

  test("FR-DICEX-26 the internal setLookFor is no intent; it writes the player's row as theirs", () => {
    const t = setup();
    expect(t.s.intents.has(D.setLook)).toBe(true);
    expect(t.s.intents.has(SET_LOOK_FOR)).toBe(false);
    t.run(SET_LOOK_FOR, { playerId: t.h.p1.id, look: CRIMSON_METAL });
    expect(t.looks().map((r) => r.ownerKey)).toEqual([t.h.p1.id]);
    // Another campaign's player, or a player calling it → refused.
    expect(
      t.err(() => t.run(SET_LOOK_FOR, { playerId: t.h.p3.id, look: CRIMSON_METAL })).code,
    ).toBe("not_found");
    expect(
      t.err(() =>
        t.run(SET_LOOK_FOR, { playerId: t.h.p2.id, look: CRIMSON_METAL }, t.player(t.h.p1.id)),
      ).code,
    ).toBe("forbidden");
  });

  test("FR-DICEX-24 one look per owner per campaign: the DM's looks in two campaigns stay apart", () => {
    const t = setup();
    t.run(D.setLook, STYLE_LOOK.gold);
    t.run(D.setLook, STYLE_LOOK.bone, t.dmSecond);
    t.run(D.setLook, STYLE_LOOK.ivory, t.player(t.h.p3.id, t.h.secondCampaignId));
    expect(t.looks().map((r) => r.style)).toEqual(["gold"]);
    expect(
      t
        .looks(t.h.secondCampaignId)
        .map((r) => r.style)
        .sort(),
    ).toEqual(["bone", "ivory"]);
  });
});

describe("FR-DICEX-25 visibility: everyone in the campaign", () => {
  test("FR-DICEX-25 the DM and both players get the full row (event + snapshot); another campaign nothing", () => {
    const t = setup();
    t.run(D.setLook, STYLE_LOOK.obsidian);
    t.run(D.setLook, CRIMSON_METAL, t.player(t.h.p1.id));
    const ch = t.events.at(-1)?.event.changes[0];
    if (!ch) throw new Error("no change");
    const rows = t.looks();
    const viewers = [t.viewer("dm"), t.viewer("player", t.h.p1.id), t.viewer("player", t.h.p2.id)];
    for (const v of viewers) {
      expect(t.s.records.filterChange(ch, v)).toEqual({
        type: DICE_LOOK_TYPE,
        id: (ch.after as DiceLookRecord).id,
        op: "upsert",
        data: ch.after,
      });
      expect(t.snapshot(v)[DICE_LOOK_TYPE]).toEqual(rows);
    }
    const other = t.viewer("player", t.h.p3.id, t.h.secondCampaignId);
    expect(t.s.records.filterChange(ch, other)).toBeNull();
    expect(t.snapshot(other)[DICE_LOOK_TYPE] ?? []).toEqual([]);
    expect(t.snapshot(t.viewer("dm", null, t.h.secondCampaignId))[DICE_LOOK_TYPE] ?? []).toEqual(
      [],
    );
  });

  test("FR-DICEX-25 not a lazy type: in every snapshot", () => {
    const t = setup();
    expect(t.s.records.get(DICE_LOOK_TYPE)?.lazy).toBeUndefined();
  });
});

describe("DICEX §11 crash", () => {
  test("DICEX §11 dicex.setLook: crash before commit → digest unchanged; after commit → row + log", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const p1 = t.player(t.h.p1.id);
    const digest = stateDigest(t.s.db.$client).sha256;
    const log0 = t.logTypes().length;
    armCrashHook({ point: "before-commit", target: D.setLook }, kill);
    expect(() => t.run(D.setLook, CRIMSON_METAL, p1)).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.looks()).toEqual([]);
    expect(t.events).toEqual([]);
    armCrashHook({ point: "after-commit", target: D.setLook }, kill);
    expect(() => t.run(D.setLook, CRIMSON_METAL, p1)).toThrow(Killed);
    armCrashHook(null);
    expect(t.looks().map((r) => r.style)).toEqual(["crimson"]);
    expect(t.logTypes().slice(log0)).toEqual([DiceLookSet.type]);
  });
});
