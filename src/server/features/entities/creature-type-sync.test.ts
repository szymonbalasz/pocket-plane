// FR-ENT-27 / FR-ENT-30 over real sockets. `compendium-full` (`ent-art-tokens`): placement and
// combat Start copy the type; players get `creatureType` only on tokens they receive (the hidden
// Ogre sends nothing), before and after reconnect. `token-art-update` (review B37): the SRD Update
// on a sprint-3 database fills the null tokens of both campaigns in the import's own events
// (frames only to the active one); the Wolf set to Initials is kept and gets no frame.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { srdMini } from "@fixtures/srd/open5e";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { closeDb, openFileDb } from "../../db/client";
import {
  asset,
  assetSeqNext,
  campaign,
  compendiumEntry,
  encounter,
  player,
  scene,
  token,
} from "../../db/schema";
import type { Actor } from "../../events/types";
import { startTestServer, type TestClient } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { IMPORT_RECORDED } from "../compendium/import";
import { SRD_51_SOURCE } from "../compendium/sources/srd-5.1/source";

const AT = "2026-01-01T00:00:00.000Z";
const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const tokensOf = (c: TestClient) =>
  Object.values(c.store.records[TOKEN_TYPE] ?? {}) as Partial<TokenRecord>[];
const eventFrames = (c: TestClient, from: number) =>
  c.frames.slice(from).flatMap((f) => (f.type === "event" ? [f] : []));

async function open(bundle: string) {
  const loaded = await loadBundle(bundle, { dmSecret: TEST_SECRET, testMode: true });
  const db = openFileDb(loaded.config.dbPath);
  const players = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((r) => [r.name, r.token]),
  );
  const camps = Object.fromEntries(
    db
      .select()
      .from(campaign)
      .all()
      .map((c) => [c.name, c.id]),
  );
  const h = await startTestServer({ db, fake: false });
  const p = (name: string) => ({ role: "player" as const, token: players[name] as string });
  const dmActor = (campaignId: string): Actor => ({ role: "dm", playerId: null, campaignId });
  const sceneId = (name: string) =>
    db.select().from(scene).where(eq(scene.name, name)).get()?.id as string;
  const row = (id: string) => db.select().from(token).where(eq(token.id, id)).get();
  const close = async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(loaded.dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  };
  return { loaded, db, h, p, camps, dmActor, sceneId, row, close };
}

describe("FR-ENT-27 / -30 compendium-full over WS", () => {
  let t: Awaited<ReturnType<typeof open>>;
  let art: Record<string, string>;
  const fixture = () => t.camps["Fixture Campaign"] as string;

  beforeAll(async () => {
    t = await open("compendium-full");
    const ids = t.loaded.manifest.records["ent-art-tokens"]?.token ?? [];
    const keys = ["srdGoblin", "goblin", "elite", "dragon", "wolf", "brute", "ogre"];
    art = Object.fromEntries(keys.map((k, i) => [k, ids[i] as string]));
    // Show `battlemap` to players (FR-MAP-06).
    t.h.s.commands.run(
      MAP_INTENTS.activateScene,
      { sceneId: t.sceneId("Goblin Ambush") },
      { actor: t.dmActor(fixture()) },
    );
  }, 60_000);
  afterAll(() => t.close());

  test("FR-ENT-27 art per creature type: SRD Goblin humanoid, Adult Red Dragon dragon, Wolf beast (image wins on the client), Elite humanoid, Plain Brute null, Ogre giant; Mira null", async () => {
    const dm = await t.h.live(DM);
    await barrier(dm);
    const dmTok = (k: string) => dm.store.records[TOKEN_TYPE]?.[art[k] as string] as TokenRecord;
    expect(
      ["srdGoblin", "goblin", "elite", "dragon", "wolf", "brute", "ogre"].map(
        (k) => dmTok(k)?.creatureType,
      ),
    ).toEqual(["humanoid", "humanoid", "humanoid", "dragon", "beast", null, "giant"]);
    expect(dmTok("wolf")?.imageAssetId).not.toBeNull();
    const mira = tokensOf(dm).find((x) => x.name === "Mira");
    expect(mira?.creatureType).toBeNull();
    dm.close();
  });

  test("FR-ENT-27 combat Start places its tokens with the type", () => {
    const enc = t.db.select().from(encounter).where(eq(encounter.name, "Ambush at the Ford")).get();
    const town = t.sceneId("Town");
    const before = new Set(
      t.db
        .select({ id: token.id })
        .from(token)
        .all()
        .map((r) => r.id),
    );
    t.h.s.commands.run(
      CBT_INTENTS.start,
      { encounterId: enc?.id as string, sceneId: town },
      { actor: t.dmActor(fixture()) },
    );
    const created = t.db
      .select()
      .from(token)
      .where(eq(token.sceneId, town))
      .orderBy(asc(token.seq))
      .all()
      .filter((r) => !before.has(r.id));
    expect(created.map((r) => [r.name, r.creatureType])).toEqual([
      ["Goblin", "humanoid"],
      ["Goblin 2", "humanoid"],
      ["Wolf", "beast"],
      ["Elite Goblin Warrior", "humanoid"],
    ]);
    t.h.s.commands.run(
      CBT_INTENTS.end,
      { encounterId: enc?.id as string },
      { actor: t.dmActor(fixture()) },
    );
  });

  test("FR-ENT-30 players never see hidden tokens' art: snapshot, menu events, reconnect; visible tokens carry theirs", async () => {
    const check = (c: TestClient) => {
      const mine = tokensOf(c);
      expect(mine.some((x) => x.id === art.ogre)).toBe(false);
      expect(c.raw().includes(art.ogre as string)).toBe(false);
      expect(c.raw()).not.toContain('"creatureType":"giant"');
      const byId = Object.fromEntries(mine.map((x) => [x.id, x]));
      expect(byId[art.srdGoblin as string]?.creatureType).toBe("humanoid");
      expect(byId[art.dragon as string]?.creatureType).toBe("dragon");
      expect(byId[art.brute as string]?.creatureType).toBeNull();
      expect(leakScan(t.h.s, c)).toEqual([]);
    };
    const connect = async () => {
      const out: TestClient[] = [];
      for (const name of ["Player 1", "Player 2"]) {
        const c = await t.h.live(t.p(name));
        await barrier(c);
        out.push(c);
      }
      return out;
    };
    const players = await connect();
    for (const c of players) check(c);
    const marks = players.map((c) => c.frames.length);
    const dm = { actor: t.dmActor(fixture()) };
    // The hidden Ogre's menu change: players get nothing. The Goblin's: an upsert with Initials.
    t.h.s.commands.run(
      MAP_INTENTS.updateToken,
      { tokenId: art.ogre, creatureType: "initials" },
      dm,
    );
    t.h.s.commands.run(MAP_INTENTS.updateToken, { tokenId: art.ogre, creatureType: "giant" }, dm);
    t.h.s.commands.run(
      MAP_INTENTS.updateToken,
      { tokenId: art.srdGoblin, creatureType: "initials" },
      dm,
    );
    for (const [i, c] of players.entries()) {
      await barrier(c);
      const ev = eventFrames(c, marks[i] as number);
      expect(ev.flatMap((f) => f.changes.map((x) => x.id))).toEqual([art.srdGoblin as string]);
      expect(
        (c.store.records[TOKEN_TYPE]?.[art.srdGoblin as string] as TokenRecord | undefined)
          ?.creatureType,
      ).toBe("initials");
      expect(c.raw().includes(art.ogre as string)).toBe(false);
    }
    t.h.s.commands.run(
      MAP_INTENTS.updateToken,
      { tokenId: art.srdGoblin, creatureType: "humanoid" },
      dm,
    );
    for (const c of players) c.close();
    await t.h.restart();
    const again = await connect();
    for (const c of again) {
      check(c);
      c.close();
    }
  });
});

describe("FR-ENT-27 fill on the SRD Update (token-art-update)", () => {
  let t: Awaited<ReturnType<typeof open>>;
  beforeAll(async () => {
    t = await open("token-art-update");
    t.h.s.commands.run(
      MAP_INTENTS.activateScene,
      { sceneId: t.sceneId("Goblin Ambush") },
      { actor: t.dmActor(t.camps["Fixture Campaign"] as string) },
    );
  }, 60_000);
  afterAll(() => t.close());

  test("FR-ENT-27 fill: ImportedEntityUpdated lists the goblin tokens of both campaigns; frames only to the active one; Initials kept", async () => {
    const fixtureCid = t.camps["Fixture Campaign"] as string;
    // A second (inactive) campaign with its own goblin token: the bundle has one campaign.
    const secondCid = (
      t.h.s.commands.run(
        "campaign.create",
        { name: "Second Campaign" },
        {
          actor: t.dmActor(fixtureCid),
        },
      ) as { id: string }
    ).id;
    const [goblin, ogre, wolf] = t.loaded.manifest.records["art-update-tokens"]?.token ?? [];
    const defOf = (key: string) =>
      t.db.select().from(compendiumEntry).where(eq(compendiumEntry.sourceKey, key)).get()
        ?.definitionId as string;
    // Second Campaign: a goblin token on its own scene (not active for this server's players).
    t.db
      .insert(asset)
      .values({
        id: "artSecondMap_aaaaaaaaaa",
        campaignId: secondCid,
        seq: assetSeqNext,
        name: "map",
        hash: "hash-art-second-map",
        mime: "image/png",
        bytes: 100,
        width: 700,
        height: 700,
        displayWidth: 700,
        displayHeight: 700,
        createdAt: AT,
      })
      .run();
    const sc = t.h.s.commands.run(
      "map.createScene",
      { name: "Second Lair", mapAssetId: "artSecondMap_aaaaaaaaaa" },
      { actor: t.dmActor(secondCid) },
    ) as { id: string };
    const other = t.h.s.commands.run(
      MAP_INTENTS.placeToken,
      { sceneId: sc.id, definitionId: defOf("monster/goblin"), col: 1, row: 1 },
      { actor: t.dmActor(secondCid) },
    ) as { tokenId: string };
    expect(t.row(other.tokenId)?.creatureType).toBeNull();

    const dm = await t.h.live(DM);
    const p1 = await t.h.live(t.p("Player 1"));
    const p2 = await t.h.live(t.p("Player 2"));
    for (const c of [dm, p1, p2]) await barrier(c);
    for (const id of [goblin, ogre, wolf] as string[]) {
      expect(p1.store.records[TOKEN_TYPE]?.[id]).toBeDefined();
    }
    const marks = [dm, p1, p2].map((c) => c.frames.length);
    // The Update: the mini set with its types, as the bundled source would bring them.
    t.h.s.commands.run(
      IMPORT_RECORDED,
      { source: { ...SRD_51_SOURCE }, version: "mini", responses: srdMini },
      { actor: t.dmActor(fixtureCid) },
    );
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(
      [goblin, ogre, wolf, other.tokenId].map((id) => t.row(id as string)?.creatureType),
    ).toEqual(["humanoid", "giant", "initials", "humanoid"]);
    for (const [i, c] of [p1, p2].entries()) {
      const ev = eventFrames(c, marks[i + 1] as number);
      const ids = ev.flatMap((f) =>
        f.changes.filter((x) => x.type === TOKEN_TYPE).map((x) => x.id),
      );
      expect(ids.sort()).toEqual([goblin, ogre].sort() as string[]);
      expect(c.raw().includes(other.tokenId)).toBe(false);
      const tok = (id: string) => c.store.records[TOKEN_TYPE]?.[id] as TokenRecord;
      expect(tok(goblin as string).creatureType).toBe("humanoid");
      expect(tok(ogre as string).creatureType).toBe("giant");
      expect(tok(wolf as string).creatureType).toBe("initials");
      expect(leakScan(t.h.s, c)).toEqual([]);
    }
    expect(dm.raw().includes(other.tokenId)).toBe(false);
    for (const c of [dm, p1, p2]) c.close();
    // Reconnect: the same art from the snapshot.
    await t.h.restart();
    const back = await t.h.live(t.p("Player 1"));
    await barrier(back);
    const tok = (id: string) => back.store.records[TOKEN_TYPE]?.[id] as TokenRecord;
    expect([goblin, ogre, wolf].map((id) => tok(id as string).creatureType)).toEqual([
      "humanoid",
      "giant",
      "initials",
    ]);
    back.close();
  });
});
