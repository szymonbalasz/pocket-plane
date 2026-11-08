// Animated tokens (ANIM §13) with a real server: upload with a still frame, stored files, the
// `/motion` route, and `imageAnimated` on token and mirror rows. Fixture `animated-wisp.webm`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import type { UploadResponse } from "@shared/assets-pipeline/schemas";
import { VIDEO_MAX_BYTES } from "@shared/assets-pipeline/video";
import type { Credential } from "@shared/protocol/frames";
import { MAP_INTENTS, type TokenRecord } from "@shared/scenes-map/schemas";
import { MIR_INTENTS, TOKEN_MIRROR_TYPE } from "@shared/token-mirrors/schemas";
import { eq } from "drizzle-orm";
import { WORKTREE_ROOT } from "../../config";
import { closeDb, type Db } from "../../db/client";
import { asset, player } from "../../db/schema";
import {
  TEST_SECRET as HARNESS_SECRET,
  startTestServer,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { loadAnimated } from "./animated-load";
import { type AssetServer, form, mp4Bytes, startAssetServer, testPng } from "./testing";

const WISP = new Uint8Array(
  readFileSync(path.join(WORKTREE_ROOT, "fixtures/assets/tokens/animated-wisp.webm")),
);

describe("upload and serve (FR-ANIM-01–05)", () => {
  let h: AssetServer;
  beforeEach(async () => {
    h = await startAssetServer();
  });
  afterEach(async () => {
    await h.stop();
  });

  async function upload(file: Uint8Array, filename: string, poster?: Uint8Array) {
    const f = form(file, filename);
    if (poster) f.append("poster", new File([new Uint8Array(poster)], "poster.png"));
    const res = await h.upload(f);
    return {
      status: res.status,
      body: (await res.json()) as UploadResponse & { message?: string },
    };
  }

  test("FR-ANIM-01 a video needs its poster (422); a poster with an image → 400; a text poster → 400", async () => {
    const none = await upload(WISP, "wisp.webm");
    expect(none.status).toBe(422);
    expect(none.body.message).toContain("still frame");
    const png = await testPng(1);
    expect((await upload(png, "a.png", await testPng(2))).status).toBe(400);
    const f = form(WISP, "wisp.webm");
    f.append("poster", "not a file");
    expect((await h.upload(f)).status).toBe(400);
    expect(h.db.select().from(asset).all()).toEqual([]);
  });

  test("FR-ANIM-02 over 20 MB → 413 before the poster is read; QuickTime → 415", async () => {
    const big = new Uint8Array(VIDEO_MAX_BYTES + 1);
    big.set(mp4Bytes("isom"));
    const r = await upload(big, "big.mp4", new Uint8Array([1, 2, 3]));
    expect(r.status).toBe(413);
    expect(r.body.message).toBe("Video over 20 MB");
    expect((await upload(mp4Bytes("qt  "), "x.mov", await testPng(3))).status).toBe(415);
  });

  test("FR-ANIM-03 row: kind image, video mime / bytes / hash; sizes from the poster; files; dedupe", async () => {
    const poster = await testPng(4, 128, 96);
    const r = await upload(WISP, "Wisp.webm", poster);
    expect(r.status).toBe(201);
    expect(r.body.asset).toMatchObject({
      name: "Wisp",
      mime: "video/webm",
      bytes: WISP.byteLength,
      width: 128,
      height: 96,
    });
    const row = h.db.select().from(asset).where(eq(asset.id, r.body.asset.id)).get();
    expect(row?.kind).toBe("image");
    const hash = new Bun.CryptoHasher("sha256").update(WISP).digest("hex");
    expect(row?.hash).toBe(hash);
    for (const f of ["original", "display.webp", "thumb.webp"]) {
      expect(existsSync(path.join(h.assetDir, hash, f))).toBe(true);
    }
    expect(readFileSync(path.join(h.assetDir, hash, "original")).equals(Buffer.from(WISP))).toBe(
      true,
    );
    // Same video, another poster → existing (FR-ASSET-03).
    const again = await upload(WISP, "Other.webm", await testPng(5));
    expect(again.status).toBe(200);
    expect(again.body.asset.id).toBe(r.body.asset.id);
    // An MP4 too.
    const mp4 = await upload(mp4Bytes("mp42"), "m.mp4", await testPng(6));
    expect(mp4.body.asset.mime).toBe("video/mp4");
  });

  test("FR-ANIM-05 /motion: the video, 206 ranges, 416, ETag / 304; stills and other campaigns → 404", async () => {
    const id = (await upload(WISP, "w.webm", await testPng(7))).body.asset.id;
    const res = await h.get(id, "motion");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/webm");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(WISP))).toBe(true);
    const part = await h.get(id, "motion", { Range: "bytes=0-99" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${WISP.byteLength}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    const bad = await h.get(id, "motion", { Range: `bytes=${WISP.byteLength}-` });
    expect(bad.status).toBe(416);
    await bad.arrayBuffer();
    const etag = res.headers.get("etag") as string;
    expect((await h.get(id, "motion", { "If-None-Match": etag })).status).toBe(304);
    // Thumb / display still served (from the poster).
    const thumb = await h.get(id, "thumb");
    expect(thumb.status).toBe(200);
    await thumb.arrayBuffer();
    const notFound = async (r: Response) => [r.status, await r.json()];
    const common = await notFound(await h.get("A".repeat(22), "motion"));
    expect(common[0]).toBe(404);
    const still = (await upload(await testPng(8), "s.png")).body.asset.id;
    expect(await notFound(await h.get(still, "motion"))).toEqual(common);
    h.activate(h.secondCampaignId);
    expect(await notFound(await h.get(id, "motion"))).toEqual(common);
  });
});

describe("imageAnimated on the wire (FR-ANIM-06, -07)", () => {
  let h: TestServer;
  let db: Db;
  let cleanup: () => void;
  let links: Record<string, string>;

  beforeAll(async () => {
    const loaded = await loadBundle("animated-tokens", {
      testMode: true,
      dmSecret: HARNESS_SECRET,
    });
    cleanup = loaded.cleanup;
    db = loaded.openDb();
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((r) => [r.name, r.linkToken]),
    );
    h = await startTestServer({ db, testMode: true, fake: false });
  }, 60_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      cleanup();
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  const DM: Credential = { role: "dm", secret: HARNESS_SECRET };

  async function ok(c: TestClient, name: string, payload: unknown) {
    const intentId = c.intent(name, payload);
    for (;;) {
      const f = await c.next(undefined, 3000);
      if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) {
        if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
        return f.result as Record<string, string>;
      }
    }
  }
  const barrier = async (c: TestClient) => {
    c.send({ type: "ping" });
    await c.next("pong");
  };
  const tokens = (c: TestClient) => Object.values(c.store.records.token ?? {}) as TokenRecord[];
  const byName = (c: TestClient, name: string) => tokens(c).find((t) => t.name === name);

  test("FR-ANIM-06 start-up load finds the bundle's video", () => {
    expect(loadAnimated(db)).toBe(1);
  });

  test("FR-ANIM-06 DM and player snapshots: animated tokens flagged, stills not; hidden never reaches the player", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    expect(byName(dm, "Wisp")?.imageAnimated).toBe(true);
    expect(byName(dm, "Lurker")?.imageAnimated).toBe(true);
    expect(byName(dm, "Mira")?.imageAnimated).toBeUndefined();
    expect(byName(p1, "Wisp")?.imageAnimated).toBe(true);
    expect(byName(p1, "Mira")?.imageAnimated).toBeUndefined();
    expect(byName(p1, "Lurker")).toBeUndefined();
    dm.close();
    p1.close();
  });

  test("FR-ANIM-07 live: changing the image flips the flag for DM and player; snapshot agrees", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    const mira = byName(dm, "Mira") as TokenRecord;
    const wisp = byName(dm, "Wisp") as TokenRecord;
    await ok(dm, MAP_INTENTS.updateToken, { tokenId: mira.id, imageAssetId: wisp.imageAssetId });
    for (const c of [dm, p1]) await barrier(c);
    expect(byName(dm, "Mira")?.imageAnimated).toBe(true);
    expect(byName(p1, "Mira")?.imageAnimated).toBe(true);
    const p1b = await h.live({ role: "player", token: links["Player 1"] as string });
    expect(byName(p1b, "Mira")?.imageAnimated).toBe(true);
    await ok(dm, MAP_INTENTS.updateToken, { tokenId: mira.id, imageAssetId: null });
    for (const c of [dm, p1]) await barrier(c);
    expect(byName(dm, "Mira")?.imageAnimated).toBeUndefined();
    expect(byName(p1, "Mira")?.imageAnimated).toBeUndefined();
    for (const c of [dm, p1, p1b]) c.close();
  });

  test("FR-ANIM-06 mirrors: Visible carries the flag to the player; a Shadow carries no art and no flag", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    const wisp = byName(dm, "Wisp") as TokenRecord;
    const { mirrorId } = await ok(dm, MIR_INTENTS.create, { tokenId: wisp.id, col: 7, row: 8 });
    for (const c of [dm, p1]) await barrier(c);
    const mine = (c: TestClient) =>
      c.store.records[TOKEN_MIRROR_TYPE]?.[mirrorId as string] as
        | Record<string, unknown>
        | undefined;
    expect(mine(dm)?.imageAnimated).toBe(true);
    expect(mine(p1)?.imageAnimated).toBe(true);
    await ok(dm, MIR_INTENTS.setMode, { mirrorId, mode: "shadow" });
    for (const c of [dm, p1]) await barrier(c);
    expect(mine(dm)?.imageAnimated).toBe(true);
    expect(mine(p1)?.imageAssetId).toBeUndefined();
    expect(mine(p1)?.imageAnimated).toBeUndefined();
    dm.close();
    p1.close();
  });
});
