// Diagonal rule (SCN §9; FR-SCN-29, -30, -33): `scn.setDiagonalRule` writes the campaign's
// `map-settings` row + one log entry → one `DiagonalRuleSet`; the rule in effect writes nothing;
// DM only; every client of the campaign receives the row (full), no other campaign's viewer does;
// a crash is all or nothing.
import { afterEach, describe, expect, test } from "bun:test";
import { DiagonalRuleSet } from "@shared/events/scene-tools";
import { MAP_SETTINGS_TYPE, SCN_INTENTS as S } from "@shared/scene-tools/schemas";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { readEventLog } from "../../events/log";
import { diagonalRuleOf, readSettings } from "./rows";
import { scnSetup } from "./testing";

afterEach(() => armCrashHook(null));

function setup() {
  const t = scnSetup();
  const cid = t.h.campaignId;
  const set = (rule: string, actor = t.h.dm) => t.run(S.setDiagonalRule, { rule }, actor);
  const settings = () => readSettings(t.s.db, cid);
  return { ...t, cid, set, settings };
}

describe("FR-SCN-29 scn.setDiagonalRule", () => {
  test("FR-SCN-29 no row = 5-10-5; the first set creates the row + one log entry + one DiagonalRuleSet", () => {
    const t = setup();
    expect(t.settings()).toBeNull();
    expect(diagonalRuleOf(t.s.db, t.cid)).toBe("5-10-5");
    const log = readEventLog(t.s.db).length;
    const n0 = t.events.length;
    t.set("5");
    expect(t.settings()).toEqual({ id: t.cid, diagonalRule: "5" });
    expect(diagonalRuleOf(t.s.db, t.cid)).toBe("5");
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual([DiagonalRuleSet.type]);
    const fresh = t.events.slice(n0);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.event).toMatchObject({
      type: DiagonalRuleSet.type,
      campaignId: t.cid,
      payload: { rule: "5" },
      changes: [
        {
          type: MAP_SETTINGS_TYPE,
          id: t.cid,
          before: null,
          after: { id: t.cid, diagonalRule: "5" },
        },
      ],
    });
  });

  test("FR-SCN-29 back to 5-10-5 updates the row; the rule in effect writes nothing (no row, no event)", () => {
    const t = setup();
    const digest = stateDigest(t.s.db.$client).sha256;
    const n0 = t.events.length;
    t.set("5-10-5");
    expect(t.settings()).toBeNull();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.events.length).toBe(n0);
    t.set("5");
    t.set("5");
    expect(t.events.length).toBe(n0 + 1);
    t.set("5-10-5");
    expect(t.settings()).toEqual({ id: t.cid, diagonalRule: "5-10-5" });
    expect(t.events.at(-1)?.event.changes[0]).toMatchObject({
      before: { diagonalRule: "5" },
      after: { diagonalRule: "5-10-5" },
    });
  });

  test("FR-SCN-29 / -33 players are refused; an unknown rule → invalid; campaigns stay apart", () => {
    const t = setup();
    expect(t.err(() => t.set("5", t.player(t.h.p1))).code).toBe("forbidden");
    expect(t.err(() => t.set("10")).code).toBe("invalid");
    expect(t.err(() => t.run(S.setDiagonalRule, { rule: "5", x: 1 })).code).toBe("invalid");
    expect(t.settings()).toBeNull();
    t.set("5", t.h.dmSecond);
    expect(diagonalRuleOf(t.s.db, t.h.secondCampaignId)).toBe("5");
    expect(diagonalRuleOf(t.s.db, t.cid)).toBe("5-10-5");
  });
});

describe("FR-SCN-29 visibility: everyone in the campaign", () => {
  test("FR-SCN-29 the DM and both players get the full row in the event and the snapshot; another campaign's player nothing", () => {
    const t = setup();
    t.set("5");
    const ch = t.events.at(-1)?.event.changes[0];
    if (!ch) throw new Error("no change");
    const row = { id: t.cid, diagonalRule: "5" };
    const viewers = [
      t.h.viewer("dm"),
      t.h.viewer("player", t.h.p1.id),
      t.h.viewer("player", t.h.p2.id),
    ];
    for (const v of viewers) {
      expect(t.s.records.filterChange(ch, v)).toEqual({
        type: MAP_SETTINGS_TYPE,
        id: t.cid,
        op: "upsert",
        data: row,
      });
      expect(t.h.snapshot(v)[MAP_SETTINGS_TYPE]).toEqual([row]);
    }
    const other = t.h.viewer("player", t.h.p3.id, t.h.secondCampaignId);
    expect(t.s.records.filterChange(ch, other)).toBeNull();
    expect(t.h.snapshot(other)[MAP_SETTINGS_TYPE] ?? []).toEqual([]);
  });
});

describe("SCN §11 crash", () => {
  test("SCN §11 scn.setDiagonalRule: crash before commit → digest unchanged; after commit → row + log", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const digest = stateDigest(t.s.db.$client).sha256;
    const log = readEventLog(t.s.db).length;
    armCrashHook({ point: "before-commit", target: S.setDiagonalRule }, kill);
    expect(() => t.set("5")).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.settings()).toBeNull();
    armCrashHook({ point: "after-commit", target: S.setDiagonalRule }, kill);
    expect(() => t.set("5")).toThrow(Killed);
    armCrashHook(null);
    expect(t.settings()?.diagonalRule).toBe("5");
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual([DiagonalRuleSet.type]);
  });
});
