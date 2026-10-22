import { describe, expect, test } from "bun:test";
import {
  type EntityRecord,
  REDACTED_CHARACTER_KEYS,
  RedactedCharacter,
} from "@shared/entities/schemas";
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
  tempHp: 0,
  deathSuccesses: 0,
  deathFailures: 0,
};
const elite: EntityRecord = {
  ...common,
  id: "elite",
  kind: "monster",
  name: "Elite Goblin Warrior",
  statBlock: goblinBlock as unknown as Extract<EntityRecord, { kind: "monster" }>["statBlock"],
  ownerPlayerId: null,
  hpCurrent: null,
  companionOf: null,
  turnMode: null,
  petPresent: false,
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
      level: 1,
      className: "Fighter",
      species: null,
      deathState: null,
      // ADR-0063 (FR-PARTY-52): HP, temp HP and the stored AC.
      hpCurrent: 12,
      hpMax: 12,
      tempHp: 0,
      ac: 16,
    });
  });

  test("FR-ENT-15 redacted character: derived down true at 0 HP, false above; HP per ADR-0063, no stat block", () => {
    const at = (hpCurrent: number) => redactCharacter({ ...mira, hpCurrent } as EntityRecord);
    expect(at(0).down).toBe(true);
    expect(at(1).down).toBe(false);
    expect(at(12).down).toBe(false);
    for (const r of [at(0), at(5)]) {
      expect(Object.keys(r)).not.toContain("statBlock");
      expect(Object.keys(r)).not.toContain("deathSuccesses");
    }
    expect(at(5).hpCurrent).toBe(5);
    const s = entityServices();
    const down = { ...mira, tokenShape: "square", hpCurrent: 0 } as EntityRecord;
    expect(s.records.view("entity", down, v("player", "p2"))).toEqual({
      vis: "redacted",
      data: { ...redactCharacter(down), down: true },
    });
    expect(s.records.view("entity", down, v("player", "p1"))).toEqual({ vis: "full", data: down });
    expect(s.records.view("entity", down, v("dm", null))).toEqual({ vis: "full", data: down });
  });

  test("FR-CHARX-35 redacted Mira has exactly the ADR-0036 whitelist keys (deathState: CBTX)", () => {
    const full = {
      ...mira,
      statBlock: {
        ...mira.statBlock,
        species: "Human",
        skills: { athletics: "proficient" },
        overrides: { "passive.perception": { value: 14, note: "MIRA-NOTE-7" } },
        classes: [{ name: "Fighter", level: 1, hitDie: "d10" }],
      },
    } as EntityRecord;
    for (const r of [mira, full]) {
      const red = redactCharacter(r);
      expect(Object.keys(red).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
      expect(RedactedCharacter.safeParse(red).success).toBe(true);
    }
    expect(REDACTED_CHARACTER_KEYS).toContain("deathState");
    const red = redactCharacter(full);
    expect(red).toMatchObject({ level: 1, className: "Fighter", species: "Human" });
    const json = JSON.stringify(red);
    for (const leak of [
      "MIRA-NOTE-7",
      "athletics",
      "initBonus",
      "abilities",
      "Shortsword",
      "d10",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  test("FR-CBTX-32 other players get deathState and temp HP (ADR-0063), never counters; owner and DM full", () => {
    const s = entityServices();
    const at = (hpCurrent: number, deathSuccesses: number, deathFailures: number) =>
      ({ ...mira, hpCurrent, tempHp: 7, deathSuccesses, deathFailures }) as EntityRecord;
    const states = [at(12, 0, 0), at(0, 1, 2), at(0, 3, 0), at(0, 0, 3)].map((r) => {
      const view = s.records.view("entity", r, v("player", "p2"));
      expect(view.vis).toBe("redacted");
      const json = JSON.stringify(view.data);
      for (const leak of ["deathSuccesses", "deathFailures"]) {
        expect(json).not.toContain(leak);
      }
      expect(view.data).toMatchObject({ tempHp: 7, hpCurrent: r.hpCurrent });
      expect(Object.keys(view.data as object).sort()).toEqual([...REDACTED_CHARACTER_KEYS].sort());
      // DM and owner: the full record, counters and temp HP included.
      for (const viewer of [v("dm", null), v("player", "p1")]) {
        expect(s.records.view("entity", r, viewer)).toEqual({ vis: "full", data: r });
      }
      return (view.data as RedactedCharacter).deathState;
    });
    expect(states).toEqual([null, "dying", "stable", "dead"]);
  });

  test("FR-CBTX-32 FR-PARTY-52 the whitelist is exactly ADR-0036's eight keys + id / kind + ADR-0063's four", () => {
    expect([...REDACTED_CHARACTER_KEYS].sort() as string[]).toEqual(
      [
        "id",
        "kind",
        "name",
        "portraitAssetId",
        "ownerPlayerId",
        "down",
        "level",
        "className",
        "species",
        "deathState",
        // ADR-0063 (#335): party status.
        "hpCurrent",
        "hpMax",
        "tempHp",
        "ac",
      ].sort(),
    );
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

  test("FR-ENT-16 FR-CMP-15 imported-entity: in no snapshot; sync.load by ids returns both to the DM in every campaign; players never", () => {
    const s = entityServices();
    const h = seedEntities(s);
    const src = { db: s.db, presence: { list: () => [] } };
    const ids = [h.goblinId, h.wolfId];
    expect(s.records.get("imported-entity")?.lazy).toBe("ids");
    for (const cid of [undefined, h.secondCampaignId]) {
      const dm = h.viewer("dm", null, cid);
      expect(h.snapshot(dm)["imported-entity"]).toBeUndefined();
      const loaded = s.records.load(src, dm, "imported-entity", ids)["imported-entity"] as {
        name: string;
        source: string;
      }[];
      expect(loaded.map((r) => [r.name, r.source])).toEqual([
        ["Goblin", "fixture"],
        ["Wolf", "fixture"],
      ]);
    }
    const p1 = h.viewer("player", h.p1.id);
    const player = h.snapshot(p1);
    expect(player["imported-entity"]).toBeUndefined();
    expect(player.entity).toEqual([]);
    // The hub refuses a player's load (audience dm); the registry's filter hides every row too.
    expect(s.records.load(src, p1, "imported-entity", ids)["imported-entity"]).toEqual([]);
  });

  test("FR-ENT-01 invalid stored row: an id load omits it and logs its id", () => {
    const cap = captureLogger();
    const s = entityServices(cap.log);
    const h = seedEntities(s);
    s.db.$client.run(
      `UPDATE entity SET stat_block = '{"size":"small","ac":99}' WHERE id = '${h.wolfId}'`,
    );
    const got = s.records.load(
      { db: s.db, presence: { list: () => [] } },
      h.viewer("dm"),
      "imported-entity",
      [h.goblinId, h.wolfId],
    );
    expect((got["imported-entity"] as { id: string }[]).map((r) => r.id)).toEqual([h.goblinId]);
    expect(cap.errors.some((e) => e.includes(h.wolfId))).toBe(true);
  });
});
