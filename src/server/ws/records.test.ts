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

  test("FR-SYNC-09 scope gate: another campaign's record never reaches a connection, DM included", () => {
    expect(reg.filterChange(change(null, rec({ campaignId: "c2" })), dm)).toBeNull();
    expect(reg.filterChange(change(null, rec({ campaignId: "c2" })), player)).toBeNull();
  });
});
