// Sprint 8 (TT3): sounds through the asset pipeline, FR-ASSET-52, -54–60, with a real server.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { AUDIO_ASSET_TYPE, AUDIO_LIBRARY_CAP } from "@shared/assets-pipeline/audio";
import type { UploadResponse } from "@shared/assets-pipeline/schemas";
import { AssetIngested } from "@shared/events/assets-pipeline";
import { eq } from "drizzle-orm";
import type { CommandError } from "../../commands/errors";
import { asset } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { TestClient } from "../../testing/harness";
import { leakScan } from "../../ws/testing/convergence";
import { setAlertSound } from "../campaign-management/alert-sounds";
import { mp3File, oggFile, silentWav } from "./audio-bytes";
import { requireAsset } from "./commands";
import { ingestAsset } from "./ingest";
import { CACHE_CONTROL } from "./routes";
import { setTags } from "./tags";
import { type AssetServer, form, startAssetServer, TEST_SECRET, testPng } from "./testing";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  await h.stop();
});

const DM = { role: "dm", secret: TEST_SECRET } as const;
const rows = () => h.db.select().from(asset).all();
const audioRows = () => rows().filter((r) => r.kind === "audio");

async function upload(
  bytes: Uint8Array,
  filename = "chime.wav",
  extra: Record<string, string> = {},
) {
  const f = form(bytes, filename);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  const res = await h.upload(f);
  return { status: res.status, body: (await res.json()) as UploadResponse & { message?: string } };
}

/** The next event caused by `cause` (presence frames interleave). */
const eventOf = async (c: TestClient, cause: string) => {
  for (let i = 0; i < 20; i++) {
    const f = await c.next("event");
    if (f.cause.name === cause) return f;
  }
  throw new Error(`no ${cause}`);
};

/** Frames are ordered on the socket: once the pong is in, earlier frames are too. */
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};

const reply = async (c: TestClient, intentId: string) => {
  for (let i = 0; i < 20; i++) {
    const f = await c.next();
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
  throw new Error("no reply");
};

describe("sounds (FR-ASSET-52–60)", () => {
  test("FR-ASSET-52 audio upload: MP3 / OGG / WAV accepted; 413, 422 too long, 415 otherwise", async () => {
    for (const [bytes, name, mime] of [
      [silentWav(400), "chime.wav", "audio/wav"],
      [mp3File({ frames: 40 }), "blip.mp3", "audio/mpeg"],
      [oggFile({ codec: "opus", granules: [48_312, 96_312] }), "bell.ogg", "audio/ogg"],
    ] as const) {
      const r = await upload(bytes, name);
      expect([name, r.status, r.body.asset.mime]).toEqual([name, 201, mime]);
    }
    // ≤ 5,000 ms passes; 5,001 ms doesn't (nothing written).
    expect((await upload(silentWav(5000), "five.wav")).status).toBe(201);
    const before = rows().length;
    const long = await upload(silentWav(5001), "long.wav");
    expect([long.status, long.body.message]).toEqual([422, "Too long (max 5 s)"]);
    // > 512 KB (44.1 kHz stereo, 3.5 s) → 413 before the length.
    const big = await upload(silentWav(3500, { rate: 44_100, channels: 2 }), "big.wav");
    expect([big.status, big.body.message]).toEqual([413, "Too large (max 512 KB)"]);
    // A text file named .mp3 → 415 (sniffed, never the name or Content-Type).
    const fake = await upload(new TextEncoder().encode("not audio at all\n".repeat(30)), "x.mp3");
    expect(fake.status).toBe(415);
    // An unreadable sound header → 415.
    expect((await upload(silentWav(400).subarray(0, 30), "cut.wav")).status).toBe(415);
    // The Alert sounds section sends `kind=audio`: an image there → 415, nothing written.
    const png = await upload(await testPng(1), "map.png", { kind: "audio" });
    expect([png.status, png.body.message]).toEqual([415, "Not a sound (MP3, OGG or WAV)"]);
    expect((await upload(silentWav(300), "s.wav", { kind: "nope" })).status).toBe(400);
    expect(rows()).toHaveLength(before);
    expect(h.hashDirs()).toHaveLength(before);
  });

  test("FR-ASSET-54 audio row: kind, durationMs, mime, sizes 0, listed, tags []; original only", async () => {
    const r = await upload(silentWav(400), "Door Chime.wav", { tags: '["Maps"]', listed: "false" });
    expect(r.status).toBe(201);
    const row = audioRows()[0];
    expect(row).toMatchObject({
      name: "Door Chime",
      mime: "audio/wav",
      kind: "audio",
      durationMs: 400,
      bytes: 44 + 17_640,
      width: 0,
      height: 0,
      displayWidth: 0,
      displayHeight: 0,
      listed: true,
      tags: [],
    });
    expect(readdirSync(path.join(h.assetDir, row?.hash as string))).toEqual(["original"]);
    // The start-up sweep keeps it and reports nothing missing.
    await h.restart();
    expect(existsSync(path.join(h.assetDir, row?.hash as string, "original"))).toBe(true);
    const log = readEventLog(h.db).filter((e) => e.type === AssetIngested.type);
    expect(log.map((e) => e.payload)).toEqual([
      { assetId: row?.id, hash: row?.hash, bytes: row?.bytes, listed: true, tags: [] },
    ]);
  });

  test("FR-ASSET-55 audio dedupe: same bytes → existing, one row, one file set; healed when lost", async () => {
    const wav = silentWav(300);
    const a = await upload(wav, "a.wav");
    const b = await upload(wav, "other.wav");
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.asset.id).toBe(a.body.asset.id);
    expect(audioRows()).toHaveLength(1);
    const hash = audioRows()[0]?.hash as string;
    rmSync(path.join(h.assetDir, hash), { recursive: true, force: true });
    expect((await h.get(a.body.asset.id, "audio")).status).toBe(404);
    expect((await upload(wav, "again.wav")).status).toBe(200);
    expect((await h.get(a.body.asset.id, "audio")).status).toBe(200);
  });

  test("FR-ASSET-56 audio serve: original + mime, immutable, ETag / 304; any mismatch → the common 404", async () => {
    const wav = silentWav(250);
    const id = (await upload(wav)).body.asset.id;
    const res = await h.get(id, "audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(wav))).toBe(true);
    const etag = res.headers.get("etag") as string;
    expect((await h.get(id, "audio", { "If-None-Match": etag })).status).toBe(304);
    const notFound = async (r: Response) => [r.status, await r.json()];
    const common = await notFound(await h.get("A".repeat(22), "audio"));
    expect(common[0]).toBe(404);
    // A sound has no image files; an image has no audio route.
    expect(await notFound(await h.get(id, "display"))).toEqual(common);
    const img = (await upload(await testPng(3), "m.png")).body.asset.id;
    expect(await notFound(await h.get(img, "audio"))).toEqual(common);
    expect(await notFound(await h.get("bad id", "audio"))).toEqual(common);
    // Another campaign active → 404.
    h.activate(h.secondCampaignId);
    expect(await notFound(await h.get(id, "audio"))).toEqual(common);
  });

  test("FR-ASSET-57 audio visibility: never in `asset`; DM-only lazy `audio-asset`; players learn a picked ID only", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: h.p1.linkToken });
    const p2 = await h.live({ role: "player", token: h.p2.linkToken });
    for (const c of [dm, p1, p2]) await barrier(c);
    const counts = [p1, p2].map((p) => p.frames.length);
    const picked = (await upload(silentWav(300), "Chime.wav")).body.asset.id;
    const other = (await upload(silentWav(320), "Gong.wav")).body.asset.id;
    const ev = await eventOf(dm, AssetIngested.type);
    expect(ev.changes.map((c) => c.type)).toEqual([AUDIO_ASSET_TYPE]);
    expect(ev.changes[0]?.data).toEqual({
      id: picked,
      campaignId: h.campaignId,
      seq: expect.any(Number),
      name: "Chime",
      mime: "audio/wav",
      bytes: 44 + 13_230,
      durationMs: 300,
      createdAt: expect.any(String),
    });
    for (const p of [p1, p2]) await barrier(p);
    const sinceUpload = [p1, p2].flatMap((p, i) =>
      p.frames.slice(counts[i]).filter((f) => f.type === "event"),
    );
    expect(sinceUpload).toEqual([]);
    // The DM's library load: both sounds; `asset` never holds one.
    expect((await reply(dm, dm.load(AUDIO_ASSET_TYPE))).type).toBe("ack");
    expect(Object.keys(dm.store.records[AUDIO_ASSET_TYPE] ?? {}).sort()).toEqual(
      [picked, other].sort(),
    );
    expect(Object.keys(dm.store.records.asset ?? {})).toEqual([]);
    for (const p of [p1, p2]) {
      const no = await reply(p, p.load(AUDIO_ASSET_TYPE));
      expect(no.type === "reject" ? no.code : no.type).toBe("forbidden");
    }
    h.s.commands.run(setAlertSound, { alert: "request", sound: picked }, { actor: h.dmActor });
    for (const p of [p1, p2]) {
      const e = await eventOf(p, "AlertSoundSet");
      expect(e.changes.map((c) => c.type)).toEqual(["campaign"]);
    }
    // Reconnect: the pick is in the snapshot's campaign, nothing else.
    const p1b = await h.live({ role: "player", token: h.p1.linkToken });
    for (const p of [p1, p2, p1b]) {
      expect(leakScan(h.s, p)).toEqual([]);
      expect(p.raw()).toContain(picked);
      expect(p.raw()).not.toContain(other);
      expect(p.raw()).not.toContain(AUDIO_ASSET_TYPE);
      expect(p.raw()).not.toContain("Chime");
    }
    expect(leakScan(h.s, dm)).toEqual([]);
  });

  test("FR-ASSET-58 library cap: 50 sounds per campaign → 409 'Sound library full (50)'; a duplicate still answers", async () => {
    const first = silentWav(100);
    for (let i = 0; i < AUDIO_LIBRARY_CAP; i++) {
      await ingestAsset(
        h.s,
        { bytes: i === 0 ? first : silentWav(100 + i), filename: `s${i}.wav` },
        { actor: h.dmActor },
      );
    }
    const full = await upload(silentWav(500), "one-more.wav");
    expect([full.status, full.body.message]).toEqual([409, "Sound library full (50)"]);
    expect((await upload(first, "dup.wav")).status).toBe(200);
    expect(audioRows()).toHaveLength(AUDIO_LIBRARY_CAP);
    // Images are not capped by it; another campaign has its own 50.
    expect((await upload(await testPng(4), "img.png")).status).toBe(201);
    h.activate(h.secondCampaignId);
    expect((await upload(silentWav(500), "other.wav")).status).toBe(201);
  });

  test("FR-ASSET-59 require kind: default image; a sound as an image (and back) → invalid", async () => {
    const sound = (await upload(silentWav(200))).body.asset.id;
    const image = (await upload(await testPng(5), "i.png")).body.asset.id;
    const code = (id: string, kind?: "image" | "audio") => {
      try {
        h.db.transaction((tx) => requireAsset({ tx, actor: h.dmActor }, id, kind ? { kind } : {}));
        return "ok";
      } catch (e) {
        return (e as CommandError).code;
      }
    };
    expect(code(image)).toBe("ok");
    expect(code(sound)).toBe("invalid");
    expect(code(sound, "audio")).toBe("ok");
    expect(code(image, "audio")).toBe("invalid");
    expect(code("A".repeat(22), "audio")).toBe("not_found");
  });

  test("FR-ASSET-60 audio fields: name as images; listed / tags ignored; tags can't be set on a sound", async () => {
    const r = await upload(silentWav(200), "x.wav", { name: "  Bell\u0007 " });
    expect(r.body.asset.name).toBe("Bell");
    const bad = form(silentWav(210), "y.wav", "");
    expect((await h.upload(bad)).status).toBe(400);
    const id = r.body.asset.id;
    expect(() =>
      h.s.commands.run(setTags, { assetId: id, tags: ["Maps"] }, { actor: h.dmActor }),
    ).toThrow("Asset not found");
    const row = h.db.select().from(asset).where(eq(asset.id, id)).get();
    expect([row?.listed, row?.tags]).toEqual([true, []]);
  });
});
