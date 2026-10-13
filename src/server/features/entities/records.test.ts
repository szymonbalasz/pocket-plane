import { describe, expect, test } from "bun:test";
import type { EntityRecord } from "@shared/entities/schemas";
import { readEventLog } from "../../events/log";
import type { Viewer } from "../../ws/records";
import { entityVisibility, redactCharacter } from "./records";
import { captureLogger, entityServices, goblinBlock, miraBlock, seedEntities } from "./testing";

const v = (role: "dm" | "player", playerId: string | null): Viewer => ({
  connId: "c",
  campaignId: "camp",
  role,
  playerId,
});
const common = {
  campaignId: "camp",
  portraitAssetId: "portrait-1",
  tokenShape: null,
  derivedFromId: null,
  createdAt: "t",
  updatedAt: "t",
};
const mira: EntityRecord = {
  ...common,
  id: "mira",
  kind: "character",
  name: "Mira",
  statBlock: miraBlock as unknown as Extract<EntityRecord, { kind: "character" }>["statBlock"],
  ownerPlayerId: "p1",
  hpCurrent: 12,
};
const elite: EntityRecord = {
  ...common,
  id: "elite",
  kind: "monster",
  name: "Elite Goblin Warrior",
  statBlock: goblinBlock as unknown as Extract<EntityRecord, { kind: "monster" }>["statBlock"],
  ownerPlayerId: null,
  hpCurrent: null,
};

describe("entities record types", () => {
  test("FR-ENT-15 visibility matrix: owner full, other player redacted, monsters hidden", () => {
    expect(entityVisibility(mira, v("player", "p1"))).toBe("full");
    expect(entityVisibility(mira, v("player", "p2"))).toBe("redacted");
    expect(entityVisibility(elite, v("player", "p1"))).toBe("hidden");
    expect(redactCharacter(mira)).toEqual({
      id: "mira",
      kind: "character",
      name: "Mira",
      portraitAssetId: "portrait-1",
      ownerPlayerId: "p1",
      down: false,
    });
  });

  test("FR-ENT-15 redacted character: derived down true at 0 HP, false above; no HP field (#154)", () => {
    const at = (hpCurrent: number) => redactCharacter({ ...mira, hpCurrent } as EntityRecord);
    expect(at(0).down).toBe(true);
    expect(at(1).down).toBe(false);
    expect(at(12).down).toBe(false);
    for (const r of [at(0), at(5)]) {
      expect(Object.keys(r).sort()).toEqual(
        ["down", "id", "kind", "name", "ownerPlayerId", "portraitAssetId"].sort(),
      );
    }
    const s = entityServices();
    const down = { ...mira, tokenShape: "square", hpCurrent: 0 } as EntityRecord;
    expect(s.records.view("entity", down, v("player", "p2"))).toEqual({
      vis: "redacted",
      data: { ...redactCharacter(down), down: true },
    });
    expect(s.records.view("entity", down, v("player", "p1"))).toEqual({ vis: "full", data: down });
    expect(s.records.view("entity", down, v("dm", null))).toEqual({ vis: "full", data: down });
  });

  test("FR-ENT-15 the registry gives the DM full, filters players (incl. other campaign)", () => {
    const s = entityServices();
    const dm = { ...v("dm", null) };
    expect(s.records.view("entity", elite, dm)).toEqual({ vis: "full", data: elite });
    expect(s.records.view("entity", mira, v("player", "p2")).vis).toBe("redacted");
    expect(s.records.view("entity", elite, v("player", "p1")).vis).toBe("hidden");
    expect(s.records.view("entity", mira, { ...dm, campaignId: "other" }).vis).toBe("hidden");
  });

  test("FR-ENT-06 import writes global rows with provenance and one EntityImported each", () => {
    const s = entityServices();
    const h = seedEntities(s);
    const rows = s.db.$client
      .query<Record<string, unknown>, []>("SELECT * FROM entity ORDER BY rowid")
      .all();
    expect(rows.map((r) => [r.name, r.campaign_id, r.source, r.source_key])).toEqual([
      ["Goblin", null, "fixture", "goblin"],
      ["Wolf", null, "fixture", "wolf"],
    ]);
    const log = readEventLog(s.db).filter((e) => e.type === "EntityImported");
    expect(log.map((e) => [e.campaignId, e.payload])).toEqual([
      [null, { entityId: h.goblinId, source: "fixture", sourceKey: "goblin" }],
      [null, { entityId: h.wolfId, source: "fixture", sourceKey: "wolf" }],
    ]);
  });

  test("FR-ENT-16 imported-entity: DM full in every campaign; players never get the type", () => {
    const s = entityServices();
    const h = seedEntities(s);
    const dmSnap = h.snapshot(h.viewer("dm"));
    const imported = dmSnap["imported-entity"] as { name: string; source: string }[];
    expect(imported.map((r) => [r.name, r.source])).toEqual([
      ["Goblin", "fixture"],
      ["Wolf", "fixture"],
    ]);
    const second = h.snapshot(h.viewer("dm", null, h.secondCampaignId));
    expect(second["imported-entity"]).toHaveLength(2);
    const player = h.snapshot(h.viewer("player", h.p1.id));
    expect(player["imported-entity"]).toBeUndefined();
    expect(player.entity).toEqual([]);
  });

  test("FR-ENT-01 invalid stored row: snapshot omits it and logs its id", () => {
    const cap = captureLogger();
    const s = entityServices(cap.log);
    const h = seedEntities(s);
    s.db.$client.run(
      `UPDATE entity SET stat_block = '{"size":"small","ac":99}' WHERE id = '${h.wolfId}'`,
    );
    const snap = h.snapshot(h.viewer("dm"));
    expect((snap["imported-entity"] as { id: string }[]).map((r) => r.id)).toEqual([h.goblinId]);
    expect(cap.errors.some((e) => e.includes(h.wolfId))).toBe(true);
  });
});
