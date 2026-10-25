// FR-CAMP-46, -47 (sprint 8, TT4): `camp.pause` / `camp.resume` over WS with a real server; the
// pause on the wire per viewer, before and after a reconnect and a restart; the crash points.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { PAUSE_INTENT, RESUME_INTENT } from "@shared/campaign-management/table-state";
import { CampaignPaused, CampaignResumed } from "@shared/events/campaign-management";
import type { ServerFrame } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { campaign } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { TestClient } from "../../testing/harness";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { silentWav } from "../assets-pipeline/audio-bytes";
import { ingestAsset } from "../assets-pipeline/ingest";
import {
  type AssetServer,
  startAssetServer,
  TEST_SECRET,
  testPng,
} from "../assets-pipeline/testing";
import { createCampaign } from "./commands";
import { pauseCampaign, resumeCampaign } from "./pause";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  armCrashHook(null);
  await h.stop();
});

const reply = async (c: TestClient, intentId: string) => {
  for (let i = 0; i < 30; i++) {
    const f = await c.next();
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
  throw new Error("no reply");
};
const send = async (c: TestClient, name: string, payload: unknown) => {
  const f = await reply(c, c.intent(name, payload));
  return f.type === "reject" ? f.code : f.type;
};
const pause = (c: TestClient, payload: unknown) => send(c, PAUSE_INTENT, payload);
const resume = (c: TestClient) => send(c, RESUME_INTENT, {});
const row = () => h.db.select().from(campaign).where(eq(campaign.id, h.campaignId)).get();
const camp = (c: TestClient) =>
  c.store.records.campaign?.[h.campaignId] as CampaignRecord | undefined;
const logged = () =>
  readEventLog(h.db)
    .filter((e) => e.type === CampaignPaused.type || e.type === CampaignResumed.type)
    .map((e) => e.type);
/**
 * BL-116: other connections' frames land after the sender's ack, later on a loaded machine: wait
 * (≤ 2 s) until every client holds the campaign row `ok` expects, instead of a fixed 60 ms.
 */
const settled = async (cs: TestClient[], ok: (c: CampaignRecord | undefined) => boolean) => {
  for (const deadline = Date.now() + 2000; Date.now() < deadline; await Bun.sleep(10)) {
    if (cs.every((c) => ok(camp(c)))) return;
  }
};
const image = async (seed = 1) =>
  (
    await ingestAsset(
      h.s,
      { bytes: await testPng(seed), filename: `p${seed}.png` },
      { actor: h.dmActor },
    )
  ).asset.id;
const minutes = (from: string, to: string | null) =>
  to === null ? null : (Date.parse(to) - Date.parse(from)) / 60_000;
/**
 * BL-116: `backAt` (from `clock.now()`) and `startedAt` (`clock.iso()`) are two clock reads, so on
 * a loaded machine they may straddle a millisecond (sim gate: 9.99998 min). `backInMin` is whole
 * minutes: compare to the minute.
 */
const wholeMinutes = (from: string, to: string | null) => {
  const m = minutes(from, to);
  return m === null ? null : Math.round(m);
};

describe("pause commands (FR-CAMP-46, -47)", () => {
  test("FR-CAMP-46 pause field: on the wire only while paused, for every connection of the campaign", async () => {
    const town = await image();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: h.p1.linkToken });
    const p2 = await h.live({ role: "player", token: h.p2.linkToken });
    for (const c of [dm, p1, p2]) expect(camp(c)).not.toHaveProperty("pause");

    expect(await pause(dm, { message: "Pizza break", imageAssetId: town, backInMin: 10 })).toBe(
      "ack",
    );
    await settled([dm, p1, p2], (x) => x?.pause?.message === "Pizza break");
    for (const c of [dm, p1, p2]) {
      expect(camp(c)?.pause).toMatchObject({ message: "Pizza break", imageAssetId: town });
    }
    // A player's frame for it carries the campaign upsert only.
    const ev = p1.frames.find(
      (f): f is Extract<ServerFrame, { type: "event" }> =>
        f.type === "event" && f.cause.name === CampaignPaused.type,
    );
    expect(ev?.changes.map((c) => c.type)).toEqual(["campaign"]);

    expect(await resume(dm)).toBe("ack");
    await settled([dm, p1, p2], (x) => x !== undefined && !("pause" in x));
    for (const c of [dm, p1, p2]) expect(camp(c)).not.toHaveProperty("pause");
    // Leak: after resume a reconnecting player's snapshot has no pause and no image ID.
    const again = await h.live({ role: "player", token: h.p1.linkToken });
    expect(again.raw()).not.toContain(town);
    expect(camp(again)).not.toHaveProperty("pause");
  });

  test("FR-CAMP-47 pause commands: new, update keeps startedAt, same values no-op, resume; refusals", async () => {
    const town = await image(1);
    const other = await image(2);
    const sound = (
      await ingestAsset(h.s, { bytes: silentWav(300), filename: "c.wav" }, { actor: h.dmActor })
    ).asset.id;
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: h.p1.linkToken });

    expect(await resume(dm)).toBe("ack"); // running → no-op
    expect(await pause(dm, { message: "  Pizza break  ", imageAssetId: town, backInMin: 10 })).toBe(
      "ack",
    );
    const first = row()?.pause;
    expect(first).toMatchObject({ message: "Pizza break", imageAssetId: town });
    expect(wholeMinutes(first?.startedAt as string, first?.backAt ?? null)).toBe(10);
    // Update: a field left out keeps its value; startedAt kept.
    expect(await pause(dm, { imageAssetId: other })).toBe("ack");
    expect(row()?.pause).toEqual({ ...(first as object), imageAssetId: other } as never);
    // Same values → no event.
    expect(await pause(dm, { message: "Pizza break", imageAssetId: other })).toBe("ack");
    expect(await pause(dm, {})).toBe("ack");
    // null clears; "" → no message.
    expect(await pause(dm, { message: "", imageAssetId: null, backInMin: null })).toBe("ack");
    expect(row()?.pause).toEqual({
      message: null,
      imageAssetId: null,
      backAt: null,
      startedAt: first?.startedAt as string,
    });
    // Refusals: nothing written.
    const before = row()?.pause;
    expect(await pause(dm, { message: "x".repeat(201) })).toBe("invalid");
    expect(await pause(dm, { message: "two\nlines" })).toBe("invalid");
    expect(await pause(dm, { backInMin: 7 })).toBe("invalid");
    expect(await pause(dm, { imageAssetId: sound })).toBe("invalid");
    expect(await pause(dm, { imageAssetId: "A".repeat(22) })).toBe("not_found");
    expect(await pause(dm, { extra: 1 })).toBe("invalid");
    expect(await pause(p1, { message: "mine" })).toBe("forbidden");
    expect(await resume(p1)).toBe("forbidden");
    expect(row()?.pause).toEqual(before as never);

    expect(await resume(dm)).toBe("ack");
    expect(row()?.pause).toBeNull();
    expect(await resume(dm)).toBe("ack");
    // A new pause after a resume starts fresh (none of the old card).
    expect(await pause(dm, { backInMin: 5 })).toBe("ack");
    expect(row()?.pause).toMatchObject({ message: null, imageAssetId: null });
    expect(logged()).toEqual([
      CampaignPaused.type,
      CampaignPaused.type,
      CampaignPaused.type,
      CampaignResumed.type,
      CampaignPaused.type,
    ]);
    // The server keeps accepting player intents while paused (OQ-SHELL-70 A).
    const own = (p1.store.records.player?.[h.p1.id] as { color: string } | undefined)?.color;
    expect(await send(p1, "camp.setColor", { playerId: h.p1.id, color: own })).toBe("ack");
  });

  test("FR-CAMP-47 pause survives a restart; a reconnecting player gets it in the snapshot; two DM tabs: last wins", async () => {
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(await pause(dm, { message: "Back soon", backInMin: 15 })).toBe("ack");
    await h.restart();
    const p2 = await h.live({ role: "player", token: h.p2.linkToken });
    expect(camp(p2)?.pause).toMatchObject({ message: "Back soon" });
    const a = await h.live({ role: "dm", secret: TEST_SECRET });
    const b = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(await pause(a, { message: "A" })).toBe("ack");
    expect(await pause(b, { message: "B" })).toBe("ack");
    expect(row()?.pause?.message).toBe("B");
    expect(await resume(a)).toBe("ack");
    await settled([p2], (x) => x !== undefined && !("pause" in x));
    expect(camp(p2)).not.toHaveProperty("pause");
  });

  test("FR-CAMP-47 crash: camp.pause before-commit → running (digest equal); after-commit → paused, one log row", () => {
    const s = h.s;
    const actor = { ...DM_ACTOR, campaignId: h.campaignId };
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const before = stateDigest(s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: PAUSE_INTENT }, kill);
    expect(() => s.commands.run(pauseCampaign, { message: "x" }, { actor })).toThrow();
    armCrashHook(null);
    expect(stateDigest(s.db.$client).sha256).toBe(before);
    armCrashHook({ point: "after-commit", target: PAUSE_INTENT }, kill);
    expect(() => s.commands.run(pauseCampaign, { message: "x" }, { actor })).toThrow(Killed);
    armCrashHook(null);
    expect(row()?.pause?.message).toBe("x");
    expect(logged()).toEqual([CampaignPaused.type]);
    s.commands.run(resumeCampaign, {}, { actor });
    expect(row()?.pause).toBeNull();
  });
});

test("FR-CAMP-47 BL-116 a pause's minutes survive a clock that moves between its two reads", () => {
  // The load-only flake, reproduced: every clock read 1 ms later than the one before.
  let ms = Date.parse("2026-10-24T20:00:00.000Z");
  const s = createTestServices({
    clock: { now: () => ms++, iso: () => new Date(ms++).toISOString() },
  });
  const c = s.commands.run(createCampaign, { name: "Ticking" }, { actor: DM_ACTOR });
  const actor = { ...DM_ACTOR, campaignId: c.id };
  s.commands.run(pauseCampaign, { backInMin: 10 }, { actor });
  const p = s.db.select().from(campaign).where(eq(campaign.id, c.id)).get()?.pause;
  const from = p?.startedAt as string;
  expect(minutes(from, p?.backAt ?? null)).not.toBe(10);
  expect(wholeMinutes(from, p?.backAt ?? null)).toBe(10);
});
