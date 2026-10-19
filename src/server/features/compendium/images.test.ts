// CMP §13.1 integration (S5, C5 core) on the `cmp-images` bundle over real HTTP + WS:
// FR-CMP-45 / -46 write checks (slot limit, `assets.require`, nothing written), FR-CMP-48 share /
// unshare and the per-player leak scan (REST bodies + WS frames, before and after reconnect),
// FR-CMP-49 clone, the `cmp.putEntry:before-commit` crash, FR-CMP-47 stale IDs + ETag.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { CMP_IMAGES } from "@fixtures/units/compendium/cmp-images";
import { PutEntryResponse } from "@shared/compendium/homebrew";
import { EntryResponse, SearchResponse } from "@shared/compendium/rest";
import { COMPENDIUM_KINDS } from "@shared/compendium/schemas";
import { and, asc, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, campaign, compendiumEntry, player } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { dmActor } from "../../http";
import { silentLogger } from "../../log";
import { type RunningServer, startServer } from "../../server";
import { connectClient, type TestClient } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { INGEST, type IngestResult } from "../assets-pipeline/commands";
import { processImage } from "../assets-pipeline/image";
import { testPng } from "../assets-pipeline/testing";
import { CMP_CACHE_CONTROL } from "./auth";
import { IMAGE_NOT_FOUND } from "./homebrew";

let running: RunningServer;
let db: Db;
let loaded: Awaited<ReturnType<typeof loadBundle>>;
let fixtureCid: string;
let secondCid: string;
let tokens: Record<string, string>;
/** `cmp-images` attachments: lantern, lantern-lit, relic. */
let ids: { lantern: string; lanternLit: string; relic: string };
/** A listed library asset of the Fixture Campaign (`images`). */
let listedId: string;

beforeAll(async () => {
  loaded = await loadBundle("cmp-images", { dmSecret: TEST_SECRET, testMode: true });
  db = openFileDb(loaded.config.dbPath);
  running = await startServer({ config: loaded.config, log: silentLogger, db, lock: false });
  const camps = db.select().from(campaign).all();
  fixtureCid = camps.find((c) => c.name === "Fixture Campaign")?.id as string;
  secondCid = camps.find((c) => c.name === "Second Campaign")?.id as string;
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((p) => [p.name, p.linkToken]),
  );
  const [lantern, lanternLit, relic] = loaded.manifest.records[CMP_IMAGES.key]?.asset ?? [];
  ids = { lantern, lanternLit, relic } as typeof ids;
  listedId = db
    .select()
    .from(asset)
    .where(and(eq(asset.campaignId, fixtureCid), eq(asset.listed, true)))
    .orderBy(asc(asset.seq))
    .get()?.id as string;
}, 60_000);

afterAll(async () => {
  armCrashHook(null);
  await running.stop();
  closeDb(db);
  try {
    rmSync(loaded.dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM = { Authorization: `Bearer ${TEST_SECRET}` };
const asPlayer = (name: string) => ({ Authorization: `Player ${tokens[name]}` });
const http = () => `http://127.0.0.1:${running.port}`;

interface Res {
  status: number;
  text: string;
  json: unknown;
  etag: string | null;
}

async function req(
  method: "GET" | "POST" | "PUT",
  p: string,
  body?: unknown,
  headers: Record<string, string> = DM,
): Promise<Res> {
  const res = await fetch(`${http()}/api/compendium${p}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.headers.get("cache-control")).toBe(CMP_CACHE_CONTROL);
  const text = await res.text();
  return {
    status: res.status,
    text,
    json: text ? JSON.parse(text) : null,
    etag: res.headers.get("etag"),
  };
}

const row = (name: string) =>
  db.select().from(compendiumEntry).where(eq(compendiumEntry.name, name)).get();
function rowOf(name: string) {
  const r = row(name);
  if (!r) throw new Error(`no entry ${name}`);
  return r;
}
const draftOf = (r: NonNullable<ReturnType<typeof row>>) => ({
  kind: r.kind,
  name: r.name,
  facets: r.facets,
  body: r.body,
});
const put = (name: string, imageAssetIds: string[], shared?: boolean, headers = DM) => {
  const r = rowOf(name);
  return req(
    "PUT",
    `/entries/${r.id}`,
    { entry: draftOf(r), shared: shared ?? r.shared, imageAssetIds },
    headers,
  );
};
const logCount = () => readEventLog(db, fixtureCid).length;

async function attachment(seed: number, campaignId = fixtureCid): Promise<string> {
  const image = await processImage(await testPng(seed));
  const r = running.services.commands.run(
    INGEST,
    { image, filename: `paste-${seed}.png`, listed: false },
    { actor: dmActor(campaignId) },
  ) as IngestResult;
  return r.asset.id;
}

/** Every player-visible compendium REST body for `name` (CMP §13.1 "every tab"). */
async function playerBodies(name: string, entryIds: string[]): Promise<Res[]> {
  const out: Res[] = [];
  for (const q of ["", "CMP", "relic", "CMP-IMG", "lantern"]) {
    out.push(await req("GET", `/search?q=${encodeURIComponent(q)}`, undefined, asPlayer(name)));
    for (const kind of COMPENDIUM_KINDS) {
      out.push(
        await req(
          "GET",
          `/search?q=${encodeURIComponent(q)}&kind=${kind}`,
          undefined,
          asPlayer(name),
        ),
      );
    }
  }
  for (const id of entryIds)
    out.push(await req("GET", `/entries/${id}`, undefined, asPlayer(name)));
  return out;
}

const live = async (name: string) => {
  const c = await connectClient(`ws://127.0.0.1:${running.port}/ws`, {
    role: "player",
    token: tokens[name] as string,
  });
  await c.next("snapshot");
  return c;
};

describe("compendium entry images (CMP §13.1, C5 core)", () => {
  test("FR-CMP-45 slot limit over REST: 5 IDs or a duplicate → 400 invalid, nothing written", async () => {
    const before = rowOf(CMP_IMAGES.lantern);
    const n = logCount();
    const five = [ids.lantern, ids.lanternLit, ids.relic, listedId, "z".repeat(22)];
    const over = await put(CMP_IMAGES.lantern, five);
    expect(over.status).toBe(400);
    expect(over.json).toMatchObject({ code: "invalid" });
    expect(over.text).toContain("At most 4 images");
    const dup = await put(CMP_IMAGES.lantern, [ids.lantern, ids.lantern]);
    expect(dup.status).toBe(400);
    expect(dup.text).toContain("Same image twice");
    expect(rowOf(CMP_IMAGES.lantern)).toEqual(before);
    expect(logCount()).toBe(n);
  });

  test('FR-CMP-46 assets.require refusal: unknown or Second Campaign\'s asset → not_found "Image not found", entry unchanged, no event; an attachment and a listed asset → saved', async () => {
    const secondAsset = await attachment(41, secondCid);
    const before = rowOf(CMP_IMAGES.lantern);
    const n = logCount();
    for (const bad of ["z".repeat(22), secondAsset]) {
      const r = await put(CMP_IMAGES.lantern, [ids.lantern, bad]);
      expect([r.status, r.json]).toEqual([404, { code: "not_found", message: IMAGE_NOT_FOUND }]);
      expect(r.text).not.toContain(bad);
    }
    expect(rowOf(CMP_IMAGES.lantern)).toEqual(before);
    expect(logCount()).toBe(n);

    // FR-ASSET-35: listed assets and attachments alike; slot order kept.
    const ok = await put(CMP_IMAGES.lantern, [listedId, ids.lantern]);
    expect(ok.status).toBe(200);
    expect(rowOf(CMP_IMAGES.lantern).imageAssetIds).toEqual([listedId, ids.lantern]);
    const saved = readEventLog(db, fixtureCid).at(-1);
    // `CompendiumEntrySaved` payload unchanged: no IDs.
    expect(saved?.payload).toEqual({ entryId: before.id, kind: "item", shared: true });
    // A new entry takes images too (POST).
    const created = await req("POST", "/entries", {
      entry: { ...draftOf(before), name: "Lantern Twin" },
      imageAssetIds: [ids.lanternLit],
    });
    expect(created.status).toBe(201);
    expect(rowOf("Lantern Twin").imageAssetIds).toEqual([ids.lanternLit]);
    expect((await put(CMP_IMAGES.lantern, [ids.lantern, ids.lanternLit])).status).toBe(200);
  });

  test("FR-CMP-48 image shown after share: 404 before; shared → player GET 200 with [relic] and its thumb serves; unshared → 404 again", async () => {
    const secret = rowOf(CMP_IMAGES.secret);
    const before = await req("GET", `/entries/${secret.id}`, undefined, asPlayer("Player 1"));
    expect(before.status).toBe(404);
    expect(before.text).not.toContain(ids.relic);

    expect((await put(CMP_IMAGES.secret, [ids.relic], true)).status).toBe(200);
    const shown = await req("GET", `/entries/${secret.id}`, undefined, asPlayer("Player 1"));
    expect(shown.status).toBe(200);
    expect(EntryResponse.parse(shown.json).entry.imageAssetIds).toEqual([ids.relic]);
    expect(shown.etag).not.toContain(ids.relic);
    expect((await fetch(`${http()}/api/assets/${ids.relic}/thumb`)).status).toBe(200);

    expect((await put(CMP_IMAGES.secret, [ids.relic], false)).status).toBe(200);
    const gone = await req("GET", `/entries/${secret.id}`, undefined, asPlayer("Player 1"));
    expect([gone.status, gone.text.includes(ids.relic)]).toEqual([404, false]);
  });

  test("FR-CMP-48 hidden entry's image IDs never reach a player: search, GET (If-None-Match → 404, never 304), WS frames; again after the DM adds an image and the players reconnect", async () => {
    const secret = rowOf(CMP_IMAGES.secret);
    const lantern = rowOf(CMP_IMAGES.lantern);
    const dmGet = await req("GET", `/entries/${secret.id}`);
    expect(EntryResponse.parse(dmGet.json).entry.imageAssetIds).toEqual([ids.relic]);
    const secretIds = [ids.relic];

    const scanPlayers = async (clients: TestClient[]) => {
      for (const [i, name] of ["Player 1", "Player 2"].entries()) {
        const bodies = await playerBodies(name, [secret.id, lantern.id]);
        // The shared lantern does reach them, with its images (FR-CMP-48).
        const lanternGet = bodies.at(-1) as Res;
        expect(EntryResponse.parse(lanternGet.json).entry.imageAssetIds).toEqual([
          ids.lantern,
          ids.lanternLit,
        ]);
        const cond = await req("GET", `/entries/${secret.id}`, undefined, {
          ...asPlayer(name),
          "If-None-Match": dmGet.etag as string,
        });
        expect([cond.status, cond.json]).toEqual([
          404,
          { code: "not_found", message: "Entry not found" },
        ]);
        for (const b of [...bodies, cond]) {
          for (const id of secretIds) {
            expect({ name, leaked: b.text.includes(id) || !!b.etag?.includes(id) }).toEqual({
              name,
              leaked: false,
            });
          }
          expect(b.text).not.toContain(CMP_IMAGES.secret);
        }
        const c = clients[i] as TestClient;
        for (const id of [...secretIds, ids.lantern, ids.lanternLit]) {
          expect(c.raw()).not.toContain(id);
        }
        expect(leakScan(running.services, c)).toEqual([]);
      }
    };

    const first = [await live("Player 1"), await live("Player 2")];
    await scanPlayers(first);
    for (const c of first) c.close();

    // While both are away the DM adds a second image to the secret entry.
    const extra = await attachment(42);
    secretIds.push(extra);
    expect((await put(CMP_IMAGES.secret, secretIds)).status).toBe(200);
    expect(
      EntryResponse.parse((await req("GET", `/entries/${secret.id}`)).json).entry.imageAssetIds,
    ).toEqual(secretIds);

    const again = [await live("Player 1"), await live("Player 2")];
    await scanPlayers(again);
    for (const c of again) c.close();
  });

  test("FR-CMP-49 clone carries images: the clone body saved under a new name keeps both IDs; removing one from the clone leaves the base", async () => {
    const base = rowOf(CMP_IMAGES.lantern);
    const got = EntryResponse.parse((await req("GET", `/entries/${base.id}`)).json).entry;
    const created = await req("POST", "/entries", {
      entry: { ...draftOf(base), name: `${CMP_IMAGES.lantern} (copy)` },
      shared: false,
      derivedFromId: base.id,
      imageAssetIds: got.imageAssetIds,
    });
    expect(created.status).toBe(201);
    const { entryId } = PutEntryResponse.parse(created.json);
    const clone = EntryResponse.parse((await req("GET", `/entries/${entryId}`)).json).entry;
    expect(clone.imageAssetIds).toEqual([ids.lantern, ids.lanternLit]);
    expect((await put(`${CMP_IMAGES.lantern} (copy)`, [ids.lanternLit])).status).toBe(200);
    expect(rowOf(`${CMP_IMAGES.lantern} (copy)`).imageAssetIds).toEqual([ids.lanternLit]);
    expect(rowOf(CMP_IMAGES.lantern).imageAssetIds).toEqual([ids.lantern, ids.lanternLit]);
  });

  test("CMP §11 crash cmp.putEntry:before-commit with new images → entry and images as before, no event", async () => {
    const before = rowOf(CMP_IMAGES.lantern);
    const n = logCount();
    armCrashHook({ point: "before-commit", target: "cmp.putEntry" }, (where) => {
      throw new Error(`killed at ${where}`);
    });
    try {
      const r = await put(CMP_IMAGES.lantern, [ids.lantern, ids.lanternLit, listedId]);
      expect(r.status).toBe(500);
    } finally {
      armCrashHook(null);
    }
    expect(rowOf(CMP_IMAGES.lantern)).toEqual(before);
    expect(logCount()).toBe(n);
  });

  test("FR-CMP-47 asset deleted: a missing asset row drops the ID and changes the ETag (old If-None-Match → 200); missing files keep the ID, its thumb 404s", async () => {
    const lantern = rowOf(CMP_IMAGES.lantern);
    const p1 = asPlayer("Player 1");
    const first = await req("GET", `/entries/${lantern.id}`, undefined, p1);
    expect(EntryResponse.parse(first.json).entry.imageAssetIds).toEqual([
      ids.lantern,
      ids.lanternLit,
    ]);
    const cached = await req("GET", `/entries/${lantern.id}`, undefined, {
      ...p1,
      "If-None-Match": first.etag as string,
    });
    expect([cached.status, cached.text]).toEqual([304, ""]);

    // Test-only SQL: no asset delete exists (OQ-ASSET-05).
    db.delete(asset).where(eq(asset.id, ids.lanternLit)).run();
    const dropped = await req("GET", `/entries/${lantern.id}`, undefined, {
      ...p1,
      "If-None-Match": first.etag as string,
    });
    expect(dropped.status).toBe(200);
    expect(EntryResponse.parse(dropped.json).entry.imageAssetIds).toEqual([ids.lantern]);
    expect(dropped.etag).not.toBe(first.etag);
    // The row keeps its list (reads filter it; a later save may rewrite it).
    expect(rowOf(CMP_IMAGES.lantern).imageAssetIds).toEqual([ids.lantern, ids.lanternLit]);

    // FR-ASSET-07: files gone but the row present → still listed; serving 404s.
    const hash = db.select().from(asset).where(eq(asset.id, ids.lantern)).get()?.hash as string;
    rmSync(path.join(loaded.config.assetDir, hash, "thumb.webp"));
    const still = await req("GET", `/entries/${lantern.id}`, undefined, p1);
    expect(EntryResponse.parse(still.json).entry.imageAssetIds).toEqual([ids.lantern]);
    expect((await fetch(`${http()}/api/assets/${ids.lantern}/thumb`)).status).toBe(404);
  });

  test("FR-CMP-47 search summaries carry no image fields", async () => {
    const r = await req("GET", "/search?q=lantern");
    const res = SearchResponse.parse(r.json);
    expect(res.results.map((x) => x.name)).toContain(CMP_IMAGES.lantern);
    expect(r.text).not.toContain("imageAssetIds");
    expect(r.text).not.toContain(ids.lantern);
  });
});
