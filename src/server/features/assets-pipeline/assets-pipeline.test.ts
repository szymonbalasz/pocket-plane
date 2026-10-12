import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_UPLOAD_BYTES, type UploadResponse } from "@shared/assets-pipeline/schemas";
import { AssetIngested } from "@shared/events/assets-pipeline";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import { manualClock, realDice } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { asset, campaign } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Logger } from "../../log";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { createCampaign } from "../campaign-management/commands";
import { requireAsset } from "./commands";
import { ingestAsset } from "./ingest";
import { CACHE_CONTROL } from "./routes";
import { AssetStore, assetStoreOf } from "./store";
import {
  type AssetServer,
  form,
  startAssetServer,
  svgBytes,
  TEST_SECRET,
  testPng,
} from "./testing";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  await h.stop();
});

async function uploadOk(bytes: Uint8Array, filename = "map.png", name?: string) {
  const res = await h.upload(form(bytes, filename, name));
  expect([200, 201]).toContain(res.status);
  return { status: res.status, body: (await res.json()) as UploadResponse };
}

const assetRows = () => h.db.select().from(asset).all();
const ingestLog = () => readEventLog(h.db).filter((e) => e.type === AssetIngested.type);

describe("ingest (FR-ASSET-01, -03, -04, -06, -08)", () => {
  test("FR-ASSET-01 FR-ASSET-03 created then existing; second name ignored; one row, event, log entry", async () => {
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const png = await testPng(1);
    const a = await uploadOk(png, "Town Square.png");
    expect(a.status).toBe(201);
    expect(a.body.asset.name).toBe("Town Square");
    expect(a.body.asset).not.toHaveProperty("hash");
    const ev = await dm.next("event");
    expect(ev.cause.name).toBe("AssetIngested");
    expect(ev.changes).toEqual([
      { type: "asset", id: a.body.asset.id, op: "upsert", data: a.body.asset },
    ]);

    const b = await uploadOk(png, "other.png", "Another name");
    expect(b.status).toBe(200);
    expect(b.body.asset).toEqual(a.body.asset);
    await dm.expectNoFrame();
    expect(assetRows()).toHaveLength(1);
    expect(ingestLog()).toHaveLength(1);
    expect(ingestLog()[0]?.payload).toEqual({
      assetId: a.body.asset.id,
      hash: assetRows()[0]?.hash,
      bytes: png.byteLength,
    });
    expect(h.hashDirs()).toHaveLength(1);
  });

  test("FR-ASSET-04 same image in two campaigns: two rows, two IDs, one file set", async () => {
    const png = await testPng(2);
    const a = await uploadOk(png);
    h.activate(h.secondCampaignId);
    const b = await uploadOk(png);
    expect(b.status).toBe(201);
    expect(b.body.asset.id).not.toBe(a.body.asset.id);
    expect(b.body.asset.campaignId).toBe(h.secondCampaignId);
    expect(assetRows()).toHaveLength(2);
    expect(h.hashDirs()).toHaveLength(1);
    const files = readdirSync(path.join(h.assetDir, h.hashDirs()[0] as string)).sort();
    expect(files).toEqual(["display.webp", "original", "thumb.webp"]);
  });

  test("FR-ASSET-02 413 / 415 / 422 / 400 write nothing", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1024);
    big.set(await testPng(3));
    const cases: [Uint8Array, string, number, string][] = [
      [big, "huge.png", 413, "File over 25 MB"],
      [new TextEncoder().encode("hello"), "notes.png", 415, "Unsupported file type"],
      [svgBytes(""), "nosize.svg", 422, "SVG needs width and height or a viewBox"],
      [svgBytes('width="10000" height="6000"'), "huge.svg", 422, "Image over 50 megapixels"],
      [(await testPng(4)).subarray(0, 40), "cut.png", 422, "Image is corrupt or unreadable"],
    ];
    for (const [bytes, filename, status, message] of cases) {
      const res = await h.upload(form(bytes, filename));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ code: "invalid", message });
    }
    const badName = await h.upload(form(await testPng(5), "x.png", " \u0001 "));
    expect(badName.status).toBe(400);
    const noFile = new FormData();
    noFile.append("name", "x");
    expect((await h.upload(noFile)).status).toBe(400);
    expect(assetRows()).toHaveLength(0);
    expect(ingestLog()).toHaveLength(0);
    expect(h.entries()).toEqual([]);
  });

  test("FR-ASSET-02 413 from Content-Length without reading the body", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        pulled += 1;
        if (pulled > 4) ctl.close();
        else ctl.enqueue(new Uint8Array(1024));
      },
    });
    const res = await createApp(h.s).request("/api/assets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_SECRET}`,
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": String(MAX_UPLOAD_BYTES * 2),
      },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1);
    expect(h.entries()).toEqual([]);
  });

  test("FR-ASSET-02 SVG external href is never fetched", async () => {
    let hits = 0;
    const spy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        hits += 1;
        return new Response("x");
      },
    });
    try {
      const svg = svgBytes(
        'width="40" height="30" xmlns:xlink="http://www.w3.org/1999/xlink"',
        `<image href="http://127.0.0.1:${spy.port}/a.png" width="10" height="10"/>` +
          `<image xlink:href="http://127.0.0.1:${spy.port}/b.png" width="10" height="10"/>` +
          `<rect width="5" height="5" style="fill:url(http://127.0.0.1:${spy.port}/c)"/>`,
      );
      const r = await uploadOk(svg, "ext.svg");
      expect(r.body.asset.mime).toBe("image/png");
      expect([r.body.asset.width, r.body.asset.height]).toEqual([40, 30]);
      await Bun.sleep(50);
      expect(hits).toBe(0);
    } finally {
      spy.stop(true);
    }
  });

  test("FR-ASSET-06 FR-ASSET-07 crash after files → no row, no log entry; swept at next start", async () => {
    assetStoreOf(h.s).afterFilesWritten = () => {
      throw new Error("injected crash");
    };
    const res = await h.upload(form(await testPng(6), "crash.png"));
    expect(res.status).toBe(500);
    expect(assetRows()).toHaveLength(0);
    expect(ingestLog()).toHaveLength(0);
    expect(h.hashDirs()).toHaveLength(1);
    mkdirSync(path.join(h.assetDir, ".tmp", "leftover"), { recursive: true });

    await h.restart();
    expect(h.entries()).toEqual([]);
    // The kept files of a committed asset survive the sweep.
    const ok = await uploadOk(await testPng(7));
    await h.restart();
    expect(h.hashDirs()).toHaveLength(1);
    expect((await h.get(ok.body.asset.id, "thumb")).status).toBe(200);
  });

  test("FR-ASSET-07 asset missing a file → error logged at start, its files 404", async () => {
    const errors: string[] = [];
    const ok = await uploadOk(await testPng(8));
    const hash = assetRows()[0]?.hash as string;
    rmSync(path.join(h.assetDir, hash, "display.webp"));
    const log: Logger = {
      debug() {},
      info() {},
      warn() {},
      error: (m) => errors.push(m),
    };
    const r = new AssetStore(h.assetDir, log).sweep(h.db);
    expect(r.missing).toEqual([ok.body.asset.id]);
    expect(errors.join("\n")).toContain("display.webp");
    expect(errors.join("\n")).not.toContain(ok.body.asset.id);
    // All of its files answer 404, including the one still on disk (incl. If-None-Match).
    expect((await h.get(ok.body.asset.id, "display")).status).toBe(404);
    expect((await h.get(ok.body.asset.id, "thumb")).status).toBe(404);
    const inm = { "If-None-Match": `"${ok.body.asset.id}-thumb"` };
    expect((await h.get(ok.body.asset.id, "thumb", inm)).status).toBe(404);
  });

  test("FR-ASSET-07 missing thumb or original → every file 404 after restart; others unaffected", async () => {
    const lostThumb = (await uploadOk(await testPng(30))).body.asset;
    const lostOriginal = (await uploadOk(await testPng(31))).body.asset;
    const intact = (await uploadOk(await testPng(32))).body.asset;
    const hashOf = (id: string) => assetRows().find((r) => r.id === id)?.hash as string;
    rmSync(path.join(h.assetDir, hashOf(lostThumb.id), "thumb.webp"));
    rmSync(path.join(h.assetDir, hashOf(lostOriginal.id), "original"));
    await h.restart();
    for (const a of [lostThumb, lostOriginal]) {
      expect((await h.get(a.id, "display")).status).toBe(404);
      expect((await h.get(a.id, "thumb")).status).toBe(404);
    }
    expect((await h.get(intact.id, "display")).status).toBe(200);
    expect((await h.get(intact.id, "thumb")).status).toBe(200);
  });

  test("FR-ASSET-08 id = 128-bit ctx.tokens base64url; createdAt from ctx.clock; seq by insert order", async () => {
    const clock = manualClock(Date.parse("2026-05-01T10:00:00Z"));
    const tokens = ["AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"];
    let ids = 0;
    const s = createTestServices({
      testMode: false,
      clock,
      ctx: () => ({
        ids: { next: () => `id-${ids++}` },
        tokens: { next: () => tokens.shift() as string },
        clock,
        dice: realDice(),
      }),
      env: { PP_ASSET_DIR: path.join(h.dir, "other-assets") },
    });
    const c = s.commands.run(createCampaign, { name: "C" }, { actor: DM_ACTOR });
    const actor = { ...DM_ACTOR, campaignId: c.id };
    const a = await ingestAsset(s, { bytes: await testPng(9), filename: "a.png" }, { actor });
    clock.advance(1000);
    const b = await ingestAsset(s, { bytes: await testPng(10), filename: "b" }, { actor });
    expect(a.asset.id).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(b.asset.id).toBe("BBBBBBBBBBBBBBBBBBBBBB");
    expect(a.asset.createdAt).toBe("2026-05-01T10:00:00.000Z");
    expect(b.asset.seq).toBe(a.asset.seq + 1);
    expect(b.asset.name).toBe("b");

    const real = await uploadOk(await testPng(11));
    expect(real.body.asset.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(real.body.asset.id, "base64url")).toHaveLength(16);
  });

  test("FR-ASSET-09 campaign fixed at authentication, not at commit", async () => {
    const fd = form(await testPng(12), "switch.png");
    const req = new Request("http://x/api/assets", { method: "POST", body: fd });
    const type = req.headers.get("content-type") as string; // read before the body
    const bytes = new Uint8Array(await req.arrayBuffer());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        if (sent === 0) {
          ctl.enqueue(bytes.subarray(0, 100));
          sent = 1;
          return;
        }
        await gate;
        ctl.enqueue(bytes.subarray(100));
        ctl.close();
      },
    });
    const pending = createApp(h.s).request("/api/assets", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_SECRET}`, "Content-Type": type },
      body,
      duplex: "half",
    } as RequestInit);
    await Bun.sleep(30);
    h.activate(h.secondCampaignId);
    release();
    const res = await pending;
    expect(res.status).toBe(201);
    const { asset: a } = (await res.json()) as UploadResponse;
    expect(a.campaignId).toBe(h.campaignId);
  });
});

describe("record type `asset` (FR-ASSET-10, -12)", () => {
  test("FR-ASSET-10 DM snapshot = own campaign's assets; never in player frames", async () => {
    const mine = await uploadOk(await testPng(13));
    h.activate(h.secondCampaignId);
    const other = await uploadOk(await testPng(14));
    h.activate(h.campaignId);

    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p = await h.live({ role: "player", token: h.p1.linkToken });
    const snap = dm.frames[0];
    if (snap?.type !== "snapshot") throw new Error("no snapshot");
    expect(snap.records.asset).toEqual([mine.body.asset]);
    const psnap = p.frames[0];
    if (psnap?.type !== "snapshot") throw new Error("no snapshot");
    expect(psnap.records.asset).toBeUndefined();

    const third = await uploadOk(await testPng(15));
    await dm.next("event");
    await p.expectNoFrame();
    const raw = p.raw();
    for (const id of [mine.body.asset.id, other.body.asset.id, third.body.asset.id]) {
      expect(raw).not.toContain(id);
      expect(dm.raw().includes(id)).toBe(id !== other.body.asset.id);
    }
  });
});

describe("serving (FR-ASSET-11, -13, -14)", () => {
  test("FR-ASSET-11 FR-ASSET-14 thumb and display: exact type and headers", async () => {
    const a = (await uploadOk(await testPng(16, 1400, 980))).body.asset;
    for (const file of ["thumb", "display"] as const) {
      const res = await h.get(a.id, file);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
      expect(res.headers.get("etag")).toBe(`"${a.id}-${file}"`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("WEBP");
    }
    expect([a.displayWidth, a.displayHeight]).toEqual([1400, 980]);
  });

  test("FR-ASSET-13 every GET denial has the same 404 body", async () => {
    const a = (await uploadOk(await testPng(17))).body.asset;
    h.activate(h.secondCampaignId);
    const b = (await uploadOk(await testPng(18))).body.asset;
    h.activate(h.campaignId);
    const denials = [
      h.get(a.id, "original"),
      h.get(a.id, "thumb.webp"),
      h.get("ZZZZZZZZZZZZZZZZZZZZZZ", "thumb"),
      h.get("..%2F..%2Fetc", "display"),
      h.get(b.id, "display"), // other (inactive) campaign
    ];
    const bodies = new Set<string>();
    for (const res of await Promise.all(denials)) {
      expect(res.status).toBe(404);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    // Inactive campaign: the same asset is served once its campaign is active.
    h.activate(h.secondCampaignId);
    expect((await h.get(b.id, "display")).status).toBe(200);
    expect((await h.get(a.id, "display")).status).toBe(404);
  });

  test("FR-ASSET-14 304 only when the asset would be served", async () => {
    const a = (await uploadOk(await testPng(19))).body.asset;
    const inm = { "If-None-Match": `"${a.id}-thumb"` };
    const r304 = await h.get(a.id, "thumb", inm);
    expect(r304.status).toBe(304);
    expect(r304.headers.get("etag")).toBe(`"${a.id}-thumb"`);
    expect((await h.get(a.id, "display", inm)).status).toBe(200);
    h.activate(h.secondCampaignId);
    expect((await h.get(a.id, "thumb", inm)).status).toBe(404);
  });

  test("FR-ASSET-13 POST: no or wrong secret 401, player token 401, throttled 429", async () => {
    const png = await testPng(20);
    expect((await h.upload(form(png, "a.png"), null)).status).toBe(401);
    expect((await h.upload(form(png, "a.png"), h.p1.linkToken)).status).toBe(401);
    for (let i = 0; i < 4; i++) {
      expect((await h.upload(form(png, "a.png"), "wrong-secret-xyz")).status).toBe(401);
    }
    const throttled = await h.upload(form(png, "a.png"), TEST_SECRET);
    expect(throttled.status).toBe(429);
    expect(assetRows()).toHaveLength(0);
  });

  test("FR-ASSET-09 no active campaign → 409, nothing written", async () => {
    h.db.update(campaign).set({ active: false }).run();
    const res = await h.upload(form(await testPng(21), "a.png"));
    expect(res.status).toBe(409);
    expect(h.entries()).toEqual([]);
  });
});

describe("assets.require (FR-ASSET-15)", () => {
  test("FR-ASSET-15 same campaign only, else not_found", async () => {
    const a = (await uploadOk(await testPng(22))).body.asset;
    const check = (campaignId: string | null, id: string) =>
      h.db.transaction((tx) => requireAsset({ tx, actor: { ...DM_ACTOR, campaignId } }, id));
    expect(check(h.campaignId, a.id)).toEqual(a);
    for (const [cid, id] of [
      [h.secondCampaignId, a.id],
      [h.campaignId, "ZZZZZZZZZZZZZZZZZZZZZZ"],
      [null, a.id],
    ] as const) {
      let err: unknown;
      try {
        check(cid, id);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CommandError);
      expect((err as CommandError).code).toBe("not_found");
    }
    expect(h.db.select().from(asset).where(eq(asset.id, a.id)).all()).toHaveLength(1);
  });
});

test("FR-ASSET-07 sweep keeps unrelated files in the asset dir", async () => {
  writeFileSync(path.join(h.assetDir, "README.txt"), "keep");
  await h.restart();
  expect(existsSync(path.join(h.assetDir, "README.txt"))).toBe(true);
});
