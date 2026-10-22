// FR-CAMP-48 (sprint 8, TT3): `camp.setAlertSound` over WS with a real server.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { SET_ALERT_SOUND_INTENT } from "@shared/campaign-management/table-state";
import { AlertSoundSet } from "@shared/events/campaign-management";
import { eq } from "drizzle-orm";
import { campaign } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { TestClient } from "../../testing/harness";
import { silentWav } from "../assets-pipeline/audio-bytes";
import { ingestAsset } from "../assets-pipeline/ingest";
import {
  type AssetServer,
  startAssetServer,
  TEST_SECRET,
  testPng,
} from "../assets-pipeline/testing";

let h: AssetServer;
beforeEach(async () => {
  h = await startAssetServer();
});
afterEach(async () => {
  await h.stop();
});

const reply = async (c: TestClient, intentId: string) => {
  for (let i = 0; i < 30; i++) {
    const f = await c.next();
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
  throw new Error("no reply");
};
const outcome = async (c: TestClient, payload: unknown) => {
  const f = await reply(c, c.intent(SET_ALERT_SOUND_INTENT, payload));
  return f.type === "reject" ? f.code : f.type;
};
const row = () => h.db.select().from(campaign).where(eq(campaign.id, h.campaignId)).get();
const camp = (c: TestClient) =>
  c.store.records.campaign?.[h.campaignId] as CampaignRecord | undefined;
const logged = () => readEventLog(h.db).filter((e) => e.type === AlertSoundSet.type);

describe("alert sound picks (FR-CAMP-48)", () => {
  test("FR-CAMP-48 alert sound picks: sound / none / default; same value no-op; kinds checked; DM only", async () => {
    const sound = (
      await ingestAsset(h.s, { bytes: silentWav(300), filename: "chime.wav" }, { actor: h.dmActor })
    ).asset.id;
    const image = (
      await ingestAsset(h.s, { bytes: await testPng(1), filename: "m.png" }, { actor: h.dmActor })
    ).asset.id;
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: h.p1.linkToken });
    expect(camp(p1)).not.toHaveProperty("alertSounds"); // `{}` → no wire key

    expect(await outcome(dm, { alert: "request", sound })).toBe("ack");
    expect(await outcome(dm, { alert: "pause", sound: "none" })).toBe("ack");
    expect(row()?.alertSounds).toEqual({ request: sound, pause: "none" });
    // Same value → no event, no log entry.
    expect(await outcome(dm, { alert: "request", sound })).toBe("ack");
    expect(await outcome(dm, { alert: "turn", sound: "default" })).toBe("ack");
    expect(logged().map((e) => e.payload)).toEqual([{ alert: "request" }, { alert: "pause" }]);
    // Refusals: an image → invalid; unknown → not_found; bad key / value → invalid; player → forbidden.
    expect(await outcome(dm, { alert: "turn", sound: image })).toBe("invalid");
    expect(await outcome(dm, { alert: "turn", sound: "A".repeat(22) })).toBe("not_found");
    expect(await outcome(dm, { alert: "music", sound: "none" })).toBe("invalid");
    expect(await outcome(dm, { alert: "turn", sound: "loud" })).toBe("invalid");
    expect(await outcome(p1, { alert: "turn", sound: "none" })).toBe("forbidden");
    expect(row()?.alertSounds).toEqual({ request: sound, pause: "none" });

    // Every connection gets the campaign upsert; `default` removes the key; empty → no wire key.
    await new Promise((r) => setTimeout(r, 50));
    expect(camp(p1)?.alertSounds).toEqual({ request: sound, pause: "none" });
    expect(await outcome(dm, { alert: "request", sound: "default" })).toBe("ack");
    expect(await outcome(dm, { alert: "pause", sound: "default" })).toBe("ack");
    expect(row()?.alertSounds).toEqual({});
    await new Promise((r) => setTimeout(r, 50));
    expect(camp(p1)).not.toHaveProperty("alertSounds");
    expect(camp(dm)).not.toHaveProperty("alertSounds");
    const last = logged().at(-1);
    expect([last?.payload, logged().length]).toEqual([{ alert: "pause" }, 4]);
  });

  test("FR-CAMP-48 picks survive a restart and reach a reconnecting player in the snapshot", async () => {
    const sound = (
      await ingestAsset(h.s, { bytes: silentWav(300), filename: "chime.wav" }, { actor: h.dmActor })
    ).asset.id;
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(await outcome(dm, { alert: "turn", sound })).toBe("ack");
    await h.restart();
    const p2 = await h.live({ role: "player", token: h.p2.linkToken });
    expect(camp(p2)?.alertSounds).toEqual({ turn: sound });
    // Two DM tabs: last wins.
    const a = await h.live({ role: "dm", secret: TEST_SECRET });
    const b = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(await outcome(a, { alert: "turn", sound: "none" })).toBe("ack");
    expect(await outcome(b, { alert: "turn", sound })).toBe("ack");
    expect(row()?.alertSounds).toEqual({ turn: sound });
  });
});
