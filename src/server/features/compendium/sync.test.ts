// CMP §13 over real sockets on the `compendium` bundle (C1): FR-CMP-08 broadcast (definition
// upserts to the DM, instance changes only to the active campaign; an inactive campaign picks
// them up at its next snapshot), CON-44 (no compendium data in any snapshot or frame) and the
// per-player leak scan over snapshots, event frames and load replies, before and after reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { srdMini } from "@fixtures/srd/open5e";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, assetSeqNext, campaign, compendiumEntry, player, token } from "../../db/schema";
import type { Actor } from "../../events/types";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { snapshotSizes } from "../../ws/testing/snapshot-size";
import { IMPORT_RECORDED } from "./import";
import { SRD_51_SOURCE } from "./sources/srd-5.1/source";

const AT = "2026-01-01T00:00:00.000Z";
const DM = { role: "dm" as const, secret: TEST_SECRET };
/** CMP §13 leak strings: never in a player's REST body or WS frame. */
const PLAYER_LEAKS = [
  "CMP-SECRET-ITEM",
  "CMP-SECOND-HOMEBREW",
  "Nimble Escape",
  "Fireball (house)",
];
/**
 * Compendium-only text (entry bodies, homebrew, source rows): in no frame for anyone in C1 —
 * entries and sources are not record types (CMP §8, CON-44).
 */
const ENTRY_ONLY = [
  ...PLAYER_LEAKS,
  "Moonblade Shard",
  "Divine Fury",
  "Bag of Holding",
  "Sneak Attack",
  "Hunter's Mark",
  "searchText",
  "dataHash",
];

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const records = <T>(c: TestClient, type: string) =>
  Object.values(c.store.records[type] ?? {}) as T[];

function scan(c: TestClient, strings: readonly string[]) {
  const raw = c.raw();
  return strings.filter((s) => raw.includes(s));
}

function editedMini() {
  const edited = structuredClone(srdMini) as { monsters: Record<string, unknown>[] };
  const g = edited.monsters.find((m) => m.slug === "goblin");
  if (!g) throw new Error("mini goblin missing");
  g.size = "Large";
  return edited;
}

describe("compendium over WS (C1)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let players: Record<string, { id: string; token: string }>;
  let camps: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: players[name]?.token as string });
  const dmActor = (campaignId: string): Actor => ({ role: "dm", playerId: null, campaignId });

  beforeAll(async () => {
    const loaded = await loadBundle("compendium", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    players = Object.fromEntries(
      db
        .select({ name: player.name, id: player.id, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, { id: r.id, token: r.token }]),
    );
    camps = Object.fromEntries(
      db
        .select()
        .from(campaign)
        .all()
        .map((c) => [c.name, c.id]),
    );
    h = await startTestServer({ db, fake: false });
  }, 60_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("CON-44 FR-CMP-30 (C1): no compendium data in any snapshot; players get no imported definition; DM holds the mini set's 5 until C2 makes them lazy", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    for (const c of [dm, p1, p2]) {
      await barrier(c);
      expect(scan(c, ENTRY_ONLY)).toEqual([]);
    }
    for (const c of [p1, p2]) expect(records(c, IMPORTED_ENTITY_TYPE)).toEqual([]);
    const srd = records<{ source: string; name: string }>(dm, IMPORTED_ENTITY_TYPE).filter(
      (r) => r.source === "srd-5.1",
    );
    expect(srd.map((r) => r.name).sort()).toEqual([
      "Adult Red Dragon",
      "Goblin",
      "Hobgoblin",
      "Ogre",
      "Wolf",
    ]);
    // Figures for the report (imported-entity is lazy from C2 on: these leave the snapshot).
    const sizes = snapshotSizes(h.s);
    const [dmSize, ...playerSizes] = sizes;
    const imp = dmSize?.types[IMPORTED_ENTITY_TYPE];
    console.log(
      `CON-44 compendium bundle: DM ${dmSize?.bytes} B (imported-entity ${imp?.rows} rows, ${imp?.bytes} B); players max ${Math.max(...playerSizes.map((v) => v.bytes))} B`,
    );
    expect(imp?.rows).toBe(7);
    for (const v of playerSizes) expect(v.types[IMPORTED_ENTITY_TYPE]).toBeUndefined();
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CMP-08 goblin tokens in both campaigns: definition upsert to the DM, instance frames only for the active campaign; the inactive one sees the new size in its next snapshot", async () => {
    const fixtureCid = camps["Fixture Campaign"] as string;
    const secondCid = camps["Second Campaign"] as string;
    const goblinId = db
      .select()
      .from(compendiumEntry)
      .where(eq(compendiumEntry.sourceKey, "monster/goblin"))
      .get()?.definitionId as string;
    // Fixture Campaign: on its active scene (players see it). Second Campaign: a fresh scene.
    const activeScene = h.s.records.activeSceneOf(fixtureCid) as string;
    expect(activeScene).toBeTruthy();
    const tokA = h.s.commands.run(
      "map.placeToken",
      { sceneId: activeScene, definitionId: goblinId, col: 3, row: 3 },
      { actor: dmActor(fixtureCid) },
    ) as { tokenId: string };
    db.insert(asset)
      .values({
        id: "cmpSecondMap_aaaaaaaaa",
        campaignId: secondCid,
        seq: assetSeqNext,
        name: "map",
        hash: "hash-cmp-second-map",
        mime: "image/png",
        bytes: 100,
        width: 700,
        height: 700,
        displayWidth: 700,
        displayHeight: 700,
        createdAt: AT,
      })
      .run();
    const sc = h.s.commands.run(
      "map.createScene",
      { name: "Second Lair", mapAssetId: "cmpSecondMap_aaaaaaaaa" },
      { actor: dmActor(secondCid) },
    ) as { id: string };
    h.s.commands.run("map.activateScene", { sceneId: sc.id }, { actor: dmActor(secondCid) });
    const tokB = h.s.commands.run(
      "map.placeToken",
      { sceneId: sc.id, definitionId: goblinId, col: 1, row: 1 },
      { actor: dmActor(secondCid) },
    ) as { tokenId: string };

    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mark = [dm, p1, p2].map((c) => c.frames.length);
    h.s.commands.run(
      IMPORT_RECORDED,
      { source: { ...SRD_51_SOURCE }, version: "mini", responses: editedMini() },
      { actor: dmActor(fixtureCid) },
    );
    for (const c of [dm, p1, p2]) await barrier(c);
    const events = (c: TestClient, i: number) =>
      c.frames.slice(mark[i]).flatMap((f) => (f.type === "event" ? [f] : []));

    const dmEvents = events(dm, 0);
    expect(dmEvents.map((f) => f.cause.name)).toEqual([
      "ImportedEntityUpdated",
      "ImportedEntityUpdated",
    ]);
    expect(dmEvents[0]?.changes.map((c) => [c.type, c.id])).toEqual([
      [IMPORTED_ENTITY_TYPE, goblinId],
    ]);
    expect(dmEvents[1]?.changes.some((c) => c.type === TOKEN_TYPE && c.id === tokA.tokenId)).toBe(
      true,
    );
    const tokOf = (c: TestClient, id: string) =>
      (c.store.records[TOKEN_TYPE]?.[id] as { size?: string } | undefined)?.size;
    expect(tokOf(dm, tokA.tokenId)).toBe("large");
    for (const [i, c] of [p1, p2].entries()) {
      const ev = events(c, i + 1);
      expect(ev.map((f) => f.cause.name)).toEqual(["ImportedEntityUpdated"]);
      expect(ev[0]?.changes.every((x) => x.type !== IMPORTED_ENTITY_TYPE)).toBe(true);
      expect(tokOf(c, tokA.tokenId)).toBe("large");
    }
    for (const c of [dm, p1, p2]) {
      expect(c.raw().includes(tokB.tokenId)).toBe(false);
      expect(scan(c, ENTRY_ONLY)).toEqual([]);
    }
    expect(
      db
        .select()
        .from(token)
        .where(and(eq(token.id, tokB.tokenId), eq(token.size, "large")))
        .get(),
    ).toBeDefined();

    // Second Campaign's DM snapshot on activation shows the new size.
    h.s.commands.run("campaign.activate", { id: secondCid }, { actor: dmActor(fixtureCid) });
    const dm2 = await h.live(DM);
    expect(tokOf(dm2, tokB.tokenId)).toBe("large");
    expect(scan(dm2, ENTRY_ONLY)).toEqual([]);
    const second = await h.live(p("Second Player"));
    await barrier(second);
    expect(scan(second, PLAYER_LEAKS)).toEqual([]);
    expect(records(second, IMPORTED_ENTITY_TYPE)).toEqual([]);
    h.s.commands.run("campaign.activate", { id: fixtureCid }, { actor: dmActor(secondCid) });
    for (const c of [dm, p1, p2, dm2, second]) c.close();
  });

  test("CMP §13 leak scan per player: snapshot, import event frames, load replies; before and after reconnect", async () => {
    const run = async () => {
      const out: TestClient[] = [];
      for (const name of ["Player 1", "Player 2"]) {
        const c = await h.live(p(name));
        // `imported-entity` is not lazy in C1 (C2): a player's load is refused, nothing leaks.
        const id = c.load(IMPORTED_ENTITY_TYPE, ["x"]);
        const reply = await c.next("reject");
        expect(reply.intentId).toBe(id);
        out.push(c);
      }
      return out;
    };
    const before = await run();
    h.s.commands.run(
      IMPORT_RECORDED,
      { source: { ...SRD_51_SOURCE }, version: "mini", responses: srdMini },
      { actor: dmActor(camps["Fixture Campaign"] as string) },
    );
    for (const c of before) {
      await barrier(c);
      expect(scan(c, PLAYER_LEAKS)).toEqual([]);
      expect(scan(c, ENTRY_ONLY)).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
      expect(records(c, IMPORTED_ENTITY_TYPE)).toEqual([]);
      c.close();
    }
    await h.restart();
    const after = await run();
    for (const c of after) {
      await barrier(c);
      expect(scan(c, PLAYER_LEAKS)).toEqual([]);
      expect(scan(c, ENTRY_ONLY)).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
      c.close();
    }
  });
});
