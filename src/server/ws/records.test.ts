import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineRecordType, RecordRegistry, type Viewer } from "./records";

type Rec = { id: string; campaignId: string; hidden: boolean; secret: string };
const reg = new RecordRegistry();
reg.register(
  defineRecordType<Rec>({
    type: "thing",
    scope: "campaign",
    schema: z.any(),
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: (r) => (r.hidden ? "hidden" : r.secret ? "redacted" : "full"),
    redact: (r) => ({ id: r.id, campaignId: r.campaignId, hidden: r.hidden }),
    snapshot: () => [],
  }),
);
const player: Viewer = { connId: "x", campaignId: "c1", role: "player", playerId: "p" };
const dm: Viewer = { ...player, role: "dm", playerId: null };
const rec = (o: Partial<Rec> = {}): Rec => ({
  id: "t",
  campaignId: "c1",
  hidden: false,
  secret: "",
  ...o,
});
const change = (before: Rec | null, after: Rec | null) => ({
  type: "thing",
  id: "t",
  before,
  after,
});

describe("visibility filter", () => {
  test("FR-SYNC-19 transition matrix", () => {
    expect(reg.filterChange(change(rec({ hidden: true }), rec()), player)?.op).toBe("upsert");
    expect(reg.filterChange(change(rec(), rec({ hidden: true })), player)).toEqual({
      type: "thing",
      id: "t",
      op: "delete",
    });
    expect(reg.filterChange(change(rec(), rec()), player)?.op).toBe("upsert");
    expect(
      reg.filterChange(change(rec({ hidden: true }), rec({ hidden: true })), player),
    ).toBeNull();
    expect(reg.filterChange(change(null, rec()), player)?.op).toBe("upsert");
    expect(reg.filterChange(change(rec(), null), player)?.op).toBe("delete");
  });

  test("FR-SYNC-18 DM gets full; redacted uses redact; unregistered → hidden (default deny)", () => {
    expect(reg.filterChange(change(null, rec({ hidden: true })), dm)?.data).toEqual(
      rec({ hidden: true }),
    );
    expect(reg.filterChange(change(null, rec({ secret: "s" })), player)?.data).toEqual({
      id: "t",
      campaignId: "c1",
      hidden: false,
    });
    expect(
      reg.filterChange({ type: "nope", id: "x", before: null, after: { id: "x" } }, dm),
    ).toBeNull();
    expect(
      reg.filterChange({ type: "nope", id: "x", before: null, after: { id: "x" } }, player),
    ).toBeNull();
  });

  test("CON-22 scene gate: players see scene records of the active scene only (both sides of a change); DM sees all", () => {
    type S = { id: string; campaignId: string; sceneId: string };
    const r = new RecordRegistry();
    r.register(
      defineRecordType<S>({
        type: "tok",
        scope: "scene",
        schema: z.any(),
        idOf: (x) => x.id,
        campaignOf: (x) => x.campaignId,
        sceneOf: (x) => x.sceneId,
        visibility: () => "full",
        snapshot: () => [
          { id: "a", campaignId: "c1", sceneId: "A" },
          { id: "b", campaignId: "c1", sceneId: "B" },
        ],
      }),
    );
    const on = (sceneId: string): S => ({ id: "t", campaignId: "c1", sceneId });
    const ch = (b: S | null, a: S | null) => ({ type: "tok", id: "t", before: b, after: a });
    const src = { db: undefined as never, presence: { list: () => [] } };
    // No resolver → no active scene → nothing for players.
    expect(r.filterChange(ch(null, on("A")), player)).toBeNull();
    expect(r.snapshot(src, player).tok).toEqual([]);
    let active: string | null = "A";
    r.provideActiveScene(() => active);
    expect(() => r.provideActiveScene(() => null)).toThrow(/twice/);
    expect(r.filterChange(ch(on("B"), on("B")), player)).toBeNull();
    expect(r.filterChange(ch(on("A"), on("A")), player)?.op).toBe("upsert");
    expect(r.filterChange(ch(on("A"), on("B")), player)?.op).toBe("delete");
    expect(r.filterChange(ch(on("B"), on("A")), player)?.op).toBe("upsert");
    expect(r.filterChange(ch(on("B"), on("B")), dm)?.op).toBe("upsert");
    expect(r.snapshot(src, player).tok).toEqual([{ id: "a", campaignId: "c1", sceneId: "A" }]);
    expect(r.snapshot(src, dm).tok).toHaveLength(2);
    active = null;
    expect(r.snapshot(src, player).tok).toEqual([]);
  });

  test("FR-SYNC-09 scope gate: another campaign's record never reaches a connection, DM included", () => {
    expect(reg.filterChange(change(null, rec({ campaignId: "c2" })), dm)).toBeNull();
    expect(reg.filterChange(change(null, rec({ campaignId: "c2" })), player)).toBeNull();
  });
});
