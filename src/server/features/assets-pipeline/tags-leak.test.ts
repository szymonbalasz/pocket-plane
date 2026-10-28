// ASSET §13.1 `FR-ASSET-50 tags never reach a player` (leak property): seeded random sequences of
// setTags / renameTag / deleteTag / upload with tags (listed and attachments) over `image-search`,
// through the DM's socket and REST. After every step, no DM tag and no image name is in any frame
// of player-1 / player-2 (snapshot, events, acks, lazy loads; before and after a reconnect) nor in
// any player compendium REST body; players never get an `asset` record or change.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { IMAGE_TAGS_FIXTURE } from "@fixtures/units/assets-pipeline/image-tags";
import { ASSET_INTENTS as A, IMAGE_TAGS } from "@shared/assets-pipeline/tags";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, campaign, compendiumEntry, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { form, testPng } from "./testing";

const STEPS = 40;
const DM: Credential = { role: "dm", secret: TEST_SECRET };
/** image-tags names that appear nowhere else in the bundle (scanned for, with every DM tag). */
const NAMES = [
  "Misc Sketch",
  "Ruined Keep",
  "Harbour Town",
  "Goblin Cave",
  "Forest Road",
  "Wanted Poster Goblin King",
  "Royal Seal Letter",
  "Treasure Map",
  "Barrel Stack",
  "Goblin Totem",
  "Elven Cloak",
  "Potion Bottle",
  "Hobgoblin Captain",
  "Wolf Pack Leader",
  "Skeleton Guard",
  "Mira Portrait",
  "Thorn Portrait",
  "Elder Sage",
  "Wooden Chest",
  ...IMAGE_TAGS_FIXTURE.attachments,
];

/** Park–Miller LCG: deterministic steps per seed (no `Math.random`). */
function rng(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 48_271) % 2_147_483_647;
    return s % n;
  };
}

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = (await c.next(undefined, 2000)) as ServerFrame;
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

describe("FR-ASSET-50 tags DM-only (image-search; player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let cid: string;
  let tokens: Record<string, string>;
  let dm: TestClient;
  let players: Record<string, TestClient>;
  /** Every DM tag and image name the walk used: none may ever reach a player. */
  const forbidden = new Set<string>([IMAGE_TAGS_FIXTURE.secretTag, ...NAMES]);

  beforeAll(async () => {
    const loaded = await loadBundle("image-search", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    tokens = Object.fromEntries(
      db
        .select()
        .from(player)
        .where(eq(player.campaignId, cid))
        .all()
        .map((p) => [p.name, p.linkToken]),
    );
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    players = {
      "Player 1": await h.live({ role: "player", token: tokens["Player 1"] as string }),
      "Player 2": await h.live({ role: "player", token: tokens["Player 2"] as string }),
    };
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

  /** Every compendium REST body a player can provoke (search, sameAs, GET). */
  async function restBodies(token: string): Promise<string> {
    const auth = { Authorization: `Player ${token}` };
    const get = async (p: string) =>
      (await fetch(`${h.http}/api/compendium${p}`, { headers: auth })).text();
    const out = [await get("/search?q="), await get("/search?q=lantern&kind=item")];
    for (const q of ["goblin", "map", "sketch", "keep"]) out.push(await get(`/search?q=${q}`));
    const mine = db.select().from(compendiumEntry).where(eq(compendiumEntry.campaignId, cid)).all();
    for (const e of mine) {
      out.push(await get(`/entries/${e.id}`));
      out.push(await get(`/search?sameAs=${e.id}`));
    }
    return out.join("\n");
  }

  async function expectClean(label: string) {
    // Each step's intent / upload has its answer, so anything it broadcast precedes a pong.
    await Promise.all(
      Object.values(players).map(async (c) => {
        c.send({ type: "ping" });
        await c.next("pong");
      }),
    );
    const words = [...forbidden].map((w) => w.toLowerCase());
    for (const [name, c] of Object.entries(players)) {
      const raw = c.raw().toLowerCase();
      expect([label, name, words.filter((w) => raw.includes(w))]).toEqual([label, name, []]);
      const assetFrames = c.frames.filter(
        (f) =>
          (f.type === "snapshot" && "asset" in f.records) ||
          (f.type === "event" && f.changes.some((x) => x.type === "asset")),
      );
      expect([label, name, assetFrames.length]).toEqual([label, name, 0]);
    }
  }

  const heldDmTags = () => {
    const builtIn = new Set(IMAGE_TAGS.map((t) => t.toLowerCase()));
    const all = db
      .select({ tags: asset.tags })
      .from(asset)
      .where(eq(asset.campaignId, cid))
      .all()
      .flatMap((r) => r.tags ?? []);
    return [...new Set(all)].filter((t) => !builtIn.has(t.toLowerCase()));
  };

  test("FR-ASSET-50 tags never reach a player: setTags / rename (incl. merge) / delete / upload with tags; no tag or image name in any player frame or compendium REST body; no asset change for players", async () => {
    // Baseline: the loaded bundle's names and tags reach no player.
    await expectClean("initial");
    for (const [name, token] of Object.entries(tokens)) {
      const body = (await restBodies(token)).toLowerCase();
      expect([name, [...forbidden].filter((w) => body.includes(w.toLowerCase()))]).toEqual([
        name,
        [],
      ]);
    }

    const pick = rng(4_242);
    const ids = () =>
      db
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.campaignId, cid))
        .all()
        .map((r) => r.id);
    let fresh = 0;
    const newTag = () => {
      const t = `imleak-tag-${fresh++}`;
      forbidden.add(t);
      return t;
    };
    for (let i = 0; i < STEPS; i++) {
      const op = pick(4);
      let label = "";
      if (op === 0) {
        const all = ids();
        const id = all[pick(all.length)] as string;
        const pool = [...IMAGE_TAGS, ...heldDmTags()];
        const tags = [pool[pick(pool.length)] as string, newTag()];
        const r = await answer(dm, dm.intent(A.setTags, { assetId: id, tags }));
        // A full campaign refuses a new DM tag (conflict); anything else must ack.
        expect([i, r.type === "ack" || (r.type === "reject" && r.code === "conflict")]).toEqual([
          i,
          true,
        ]);
        label = `setTags ${tags.join(",")}`;
      } else if (op === 1) {
        const held = heldDmTags();
        if (held.length === 0) continue;
        const from = held[pick(held.length)] as string;
        // Half the time into another held tag (merge), else a new one.
        const others = held.filter((t) => t !== from);
        const to =
          others.length > 0 && pick(2) === 0 ? (others[pick(others.length)] as string) : newTag();
        const r = await answer(dm, dm.intent(A.renameTag, { from, to }));
        expect([i, r.type]).toEqual([i, "ack"]);
        label = `rename ${from} → ${to}`;
      } else if (op === 2) {
        const held = heldDmTags();
        if (held.length === 0) continue;
        const tag = held[pick(held.length)] as string;
        const r = await answer(dm, dm.intent(A.deleteTag, { tag }));
        expect([i, r.type]).toEqual([i, "ack"]);
        label = `delete ${tag}`;
      } else {
        const name = `IMLEAK-IMG-${i}`;
        forbidden.add(name);
        const f = form(await testPng(9_000 + i), `${name}.png`, name);
        f.append("tags", JSON.stringify([newTag(), IMAGE_TAGS[pick(IMAGE_TAGS.length)]]));
        f.append("listed", pick(2) === 0 ? "true" : "false");
        const res = await fetch(`${h.http}/api/assets`, {
          method: "POST",
          headers: { Authorization: `Bearer ${TEST_SECRET}` },
          body: f,
        });
        expect([i, res.status]).toEqual([i, 201]);
        label = `upload ${name}`;
      }
      await expectClean(`step ${i}: ${label}`);
    }
    expect(fresh).toBeGreaterThan(10);

    // Lazy loads and REST after the walk.
    for (const [name, c] of Object.entries(players)) {
      for (const d of h.s.records.lazyTypes()) await answer(c, c.load(d.type));
      const body = (await restBodies(tokens[name] as string)).toLowerCase();
      expect([name, [...forbidden].filter((w) => body.includes(w.toLowerCase()))]).toEqual([
        name,
        [],
      ]);
    }
    await expectClean("after lazy loads");

    // Reconnect: the fresh snapshots carry no tag, name or asset record either.
    for (const name of Object.keys(players)) {
      const c = players[name] as TestClient;
      c.close();
      await c.closed;
      players[name] = await h.live({ role: "player", token: tokens[name] as string });
    }
    await expectClean("after reconnect");
    // Positive control: the DM's frames do carry the tags.
    expect(dm.raw()).toContain(IMAGE_TAGS_FIXTURE.secretTag);
  }, 120_000);
});
