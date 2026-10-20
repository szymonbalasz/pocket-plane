// ASSET §13 sprint 5 (P0): attachments (`asset.listed = false`, FR-ASSET-24), the upload's
// `listed` field and its refusals, dedupe with listing (FR-ASSET-26), DM-only upload (FR-ASSET-27).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UploadResponse } from "@shared/assets-pipeline/schemas";
import { AssetIngested, AssetListed } from "@shared/events/assets-pipeline";
import { eq } from "drizzle-orm";
import { asset } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { DM_ACTOR } from "../../testing/services";
import { requireAsset } from "./commands";
import { type AssetServer, form, startAssetServer, TEST_SECRET, testPng } from "./testing";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  await h.stop();
});

const DM = { role: "dm" as const, secret: TEST_SECRET };

function listedForm(bytes: Uint8Array, filename: string, listed: string) {
  const f = form(bytes, filename);
  f.append("listed", listed);
  return f;
}
async function upload(bytes: Uint8Array, listed: string, auth: string | null = TEST_SECRET) {
  const res = await h.upload(listedForm(bytes, "paste.png", listed), auth);
  const body = res.status < 300 ? ((await res.json()) as UploadResponse) : null;
  return { status: res.status, asset: body?.asset };
}
const row = (id: string) => h.db.select().from(asset).where(eq(asset.id, id)).get();
const logOf = (type: string) => readEventLog(h.db).filter((e) => e.type === type);
const snapshotAssets = (c: Awaited<ReturnType<AssetServer["live"]>>) => {
  const snap = c.frames.find((f) => f.type === "snapshot");
  if (snap?.type !== "snapshot") throw new Error("no snapshot");
  return (snap.records.asset ?? []) as { id: string }[];
};

describe("attachments (FR-ASSET-24, -25)", () => {
  test("FR-ASSET-24 attachment not in any snapshot: 201, row unlisted, no record change, logged; served; assets.require accepts it", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live({ role: "player", token: h.p1.linkToken });
    const up = await upload(await testPng(31), "false");
    expect(up.status).toBe(201);
    const id = up.asset?.id as string;
    expect(row(id)?.listed).toBe(false);
    await Bun.sleep(150);
    // DM: at most an empty-change frame; the id is on no wire (only in the uploader's response).
    for (const f of dm.frames) {
      if (f.type === "event" && f.cause.name === AssetIngested.type) expect(f.changes).toEqual([]);
    }
    expect(
      dm.frames.some((f) => f.type === "event" && f.changes.some((c) => c.type === "asset")),
    ).toBe(false);
    expect(dm.raw()).not.toContain(id);
    expect(p1.raw()).not.toContain(id);
    expect(logOf(AssetIngested.type).map((e) => e.payload)).toEqual([
      { assetId: id, hash: row(id)?.hash, bytes: row(id)?.bytes, listed: false, tags: [] },
    ]);
    // A later snapshot (DM and player) has no record for it.
    const fresh = await h.live(DM);
    expect(snapshotAssets(fresh).map((a) => a.id)).not.toContain(id);
    const freshP = await h.live({ role: "player", token: h.p1.linkToken });
    expect(freshP.raw()).not.toContain(id);
    // Serving and `assets.require` are unchanged (FR-ASSET-11–15).
    for (const file of ["display", "thumb"]) expect((await h.get(id, file)).status).toBe(200);
    const required = h.db.transaction((tx) =>
      requireAsset({ tx, actor: { ...DM_ACTOR, campaignId: h.campaignId } }, id),
    );
    expect(required.id).toBe(id);
    // The picker's own upload (listed) still reaches the DM's snapshot.
    const lib = await upload(await testPng(32), "true");
    expect(lib.status).toBe(201);
    const again = await h.live(DM);
    expect(snapshotAssets(again).map((a) => a.id)).toEqual([lib.asset?.id as string]);
  });

  test("FR-ASSET-24 refusals: listed=maybe / TRUE → 400; .txt as an attachment → 415; nothing written", async () => {
    const png = await testPng(33);
    for (const bad of ["maybe", "TRUE", ""]) expect((await upload(png, bad)).status).toBe(400);
    const txt = await h.upload(listedForm(Buffer.from("hello"), "notes.txt", "false"));
    expect(txt.status).toBe(415);
    expect(h.db.select().from(asset).all()).toEqual([]);
    expect(h.hashDirs()).toEqual([]);
  });
});

describe("dedupe with listing (FR-ASSET-26)", () => {
  test("FR-ASSET-26 listing on re-upload: attachment + listed=true → existing, same id, AssetListed upsert to the DM; listed=false never unlists", async () => {
    const dm = await h.live(DM);
    const png = await testPng(34);
    const first = await upload(png, "false");
    const id = first.asset?.id as string;
    await Bun.sleep(100);
    const mark = dm.frames.length;

    const listed = await upload(png, "true");
    expect(listed.status).toBe(200);
    expect(listed.asset).toEqual(first.asset);
    const ev = await dm.next("event");
    expect(ev.cause.name).toBe(AssetListed.type);
    expect(ev.changes).toEqual([{ type: "asset", id, op: "upsert", data: first.asset }]);
    expect(row(id)?.listed).toBe(true);
    expect(logOf(AssetListed.type).map((e) => e.payload)).toEqual([{ assetId: id }]);
    expect(snapshotAssets(await h.live(DM)).map((a) => a.id)).toEqual([id]);

    // Already listed: neither request changes it or emits.
    for (const l of ["false", "true"]) {
      const again = await upload(png, l);
      expect([again.status, again.asset?.id]).toEqual([200, id]);
    }
    await dm.expectNoFrame();
    expect(dm.frames.slice(mark).filter((f) => f.type === "event")).toHaveLength(1);
    expect(row(id)?.listed).toBe(true);
    expect(logOf(AssetListed.type)).toHaveLength(1);
    expect(logOf(AssetIngested.type)).toHaveLength(1);
  });
});

describe("who uploads (FR-ASSET-27)", () => {
  test("FR-ASSET-27 no player upload: a player link token on POST (attachment or not) → 401, nothing written", async () => {
    const png = await testPng(35);
    for (const l of ["false", "true"])
      expect((await upload(png, l, h.p1.linkToken)).status).toBe(401);
    expect(h.db.select().from(asset).all()).toEqual([]);
  });
});
