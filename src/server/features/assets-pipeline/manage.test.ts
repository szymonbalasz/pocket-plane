// ASSET §13.1 (#386): `assets.rename` (FR-ASSET-62) and `assets.delete` (FR-ASSET-63, -65) over
// a real socket. The in-use rule (FR-ASSET-64) over `image-search` is `manage-uses.test.ts`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ASSET_MANAGE_INTENTS as M } from "@shared/assets-pipeline/manage";
import { AssetDeleted, AssetRenamed } from "@shared/events/assets-pipeline";
import type { RejectFrame, ServerFrame } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { asset } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { TestClient } from "../../testing/harness";
import { silentWav } from "./audio-bytes";
import { INGEST, type IngestResult } from "./commands";
import { processImage } from "./image";
import { type AssetServer, form, startAssetServer, TEST_SECRET, testPng } from "./testing";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  await h.stop();
});

const DM = { role: "dm" as const, secret: TEST_SECRET };
const row = (id: string) => h.db.select().from(asset).where(eq(asset.id, id)).get();
const logOf = (type: string) => readEventLog(h.db).filter((e) => e.type === type);

async function ingest(seed: number, opts: { listed?: boolean; campaignId?: string } = {}) {
  const image = await processImage(await testPng(seed));
  const r = h.s.commands.run(
    INGEST,
    {
      image,
      filename: `img-${seed}.png`,
      ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
    },
    { actor: { ...h.dmActor, campaignId: opts.campaignId ?? h.campaignId } },
  ) as IngestResult;
  return r.asset.id;
}

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = (await c.next(undefined, 2000)) as ServerFrame;
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

function lastEvent(c: TestClient, name: string) {
  const f = c.frames.findLast((x) => x.type === "event" && x.cause.name === name);
  if (f?.type !== "event") throw new Error(`no ${name} frame`);
  return f;
}

async function players() {
  return [
    await h.live({ role: "player", token: h.p1.linkToken }),
    await h.live({ role: "player", token: h.p2.linkToken }),
  ];
}

describe("rename an image (FR-ASSET-62)", () => {
  test("FR-ASSET-62 rename: DM upsert with the new name, logged; same name → ack, no event; bad name → invalid; players get nothing", async () => {
    const dm = await h.live(DM);
    const ps = await players();
    const id = await ingest(1);
    await dm.next("event");

    expect(
      (await answer(dm, dm.intent(M.rename, { assetId: id, name: "  Crypt Map " }))).type,
    ).toBe("ack");
    const ev = lastEvent(dm, AssetRenamed.type);
    expect(ev.changes.map((c) => [c.type, c.id, c.op, (c.data as { name: string }).name])).toEqual([
      ["asset", id, "upsert", "Crypt Map"],
    ]);
    expect(row(id)?.name).toBe("Crypt Map");
    expect(logOf(AssetRenamed.type).map((e) => e.payload)).toEqual([
      { assetId: id, name: "Crypt Map" },
    ]);

    expect((await answer(dm, dm.intent(M.rename, { assetId: id, name: "Crypt Map" }))).type).toBe(
      "ack",
    );
    await dm.expectNoFrame();
    expect(logOf(AssetRenamed.type)).toHaveLength(1);

    for (const name of ["   ", "x".repeat(81)]) {
      const bad = (await answer(dm, dm.intent(M.rename, { assetId: id, name }))) as RejectFrame;
      expect([bad.type, bad.code]).toEqual(["reject", "invalid"]);
    }
    expect(row(id)?.name).toBe("Crypt Map");
    for (const p of ps) await p.expectNoFrame();
  });

  test("FR-ASSET-62 rename: another campaign's image, a sound or an unknown ID → not_found; a player → forbidden", async () => {
    const dm = await h.live(DM);
    const [p1] = await players();
    const foreign = await ingest(2, { campaignId: h.secondCampaignId });
    const res = await h.upload(form(silentWav(300), "chime.wav"));
    expect(res.status).toBe(201);
    const sound = ((await res.json()) as IngestResult).asset.id;
    for (const assetId of [foreign, sound, "nope"]) {
      const r = (await answer(dm, dm.intent(M.rename, { assetId, name: "X" }))) as RejectFrame;
      expect([assetId, r.code]).toEqual([assetId, "not_found"]);
    }
    expect(row(sound)?.name).toBe("chime");
    const own = await ingest(3);
    for (const [name, input] of [
      [M.rename, { assetId: own, name: "Mine" }],
      [M.delete, { assetId: own }],
    ] as const) {
      const r = (await answer(
        p1 as TestClient,
        (p1 as TestClient).intent(name, input),
      )) as RejectFrame;
      expect([name, r.code]).toEqual([name, "forbidden"]);
    }
    expect(row(own)?.name).toBe("img-3");
  });
});

describe("delete an image (FR-ASSET-63, -65)", () => {
  test("FR-ASSET-63 delete unused: DM gets an asset delete, logged; its URLs 404 at once; files swept at the next start; players get nothing", async () => {
    const dm = await h.live(DM);
    const ps = await players();
    const keep = await ingest(10);
    const id = await ingest(11);
    await dm.next("event");
    await dm.next("event");
    expect((await h.get(id, "thumb")).status).toBe(200);
    const hash = row(id)?.hash as string;

    expect((await answer(dm, dm.intent(M.delete, { assetId: id }))).type).toBe("ack");
    const ev = lastEvent(dm, AssetDeleted.type);
    expect(ev.changes.map((c) => [c.type, c.id, c.op])).toEqual([["asset", id, "delete"]]);
    expect(row(id)).toBeUndefined();
    expect(logOf(AssetDeleted.type).map((e) => e.payload)).toEqual([
      { assetId: id, name: "img-11" },
    ]);
    for (const file of ["thumb", "display"]) expect((await h.get(id, file)).status).toBe(404);
    for (const p of ps) await p.expectNoFrame();

    // Gone once: a second delete is not_found.
    const again = (await answer(dm, dm.intent(M.delete, { assetId: id }))) as RejectFrame;
    expect(again.code).toBe("not_found");

    expect(h.hashDirs()).toContain(hash);
    await h.restart();
    expect(h.hashDirs()).not.toContain(hash);
    expect(h.hashDirs()).toContain(row(keep)?.hash as string);
  });

  test("FR-ASSET-65 delete: an attachment goes with no record change; the same bytes in another campaign keep their files", async () => {
    const dm = await h.live(DM);
    const attachment = await ingest(20, { listed: false });
    const shared = await ingest(21);
    const other = await ingest(21, { campaignId: h.secondCampaignId });
    await dm.next("event");
    expect((await answer(dm, dm.intent(M.delete, { assetId: attachment }))).type).toBe("ack");
    // No record change, so no event frame: only the log row.
    await dm.expectNoFrame();
    expect(logOf(AssetDeleted.type)).toHaveLength(1);
    expect(row(attachment)).toBeUndefined();

    expect((await answer(dm, dm.intent(M.delete, { assetId: shared }))).type).toBe("ack");
    await h.restart();
    expect(h.hashDirs()).toContain(row(other)?.hash as string);
  });
});
