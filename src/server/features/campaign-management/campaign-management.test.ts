import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { manualClock } from "../../commands/context";
import { campaign, eventLog } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { createTestServices, TEST_SECRET } from "../../testing/services";

function setup(clock = manualClock()) {
  const s = createTestServices({ clock });
  const app = createApp(s);
  const req = (method: string, path: string, body?: unknown, secret: string | null = TEST_SECRET) =>
    app.request(path, {
      method,
      headers: {
        ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { s, app, req, clock };
}

async function json<T = Record<string, unknown>>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

type CampaignBody = { campaign: { id: string; name: string; active: boolean } };
type PlayerBody = { player: { id: string; name: string; linkToken: string } };

async function seed(req: ReturnType<typeof setup>["req"]) {
  const c = await json<CampaignBody>(
    await req("POST", "/api/campaigns", { name: "Fixture Campaign" }),
  );
  const p = await json<PlayerBody>(await req("POST", "/api/players", { name: "Player 1" }));
  return { campaignId: c.campaign.id, player: p.player };
}

describe("DM auth", () => {
  test("FR-CAMP-02/03 login: right secret 204, wrong secret 401, none 401", async () => {
    const { req } = setup();
    expect((await req("POST", "/api/dm/login")).status).toBe(204);
    const bad = await req("POST", "/api/dm/login", undefined, "wrong-secret-xyz");
    expect(bad.status).toBe(401);
    expect(await json(bad)).toMatchObject({ code: "unauthorized" });
    expect((await req("POST", "/api/dm/login", undefined, null)).status).toBe(401);
  });

  test("FR-CAMP-04 DM routes 401 without the secret or with a player token", async () => {
    const { req } = setup();
    const { player } = await seed(req);
    for (const [m, p] of [
      ["GET", "/api/campaigns"],
      ["GET", "/api/players"],
      ["POST", "/api/campaigns"],
    ] as const) {
      expect((await req(m, p, undefined, null)).status).toBe(401);
      expect((await req(m, p, undefined, player.linkToken)).status).toBe(401);
    }
  });

  test("FR-CAMP-05 5 failures in 60 s → 429 even for the right secret; 60 s later ok; restart clears", async () => {
    const clock = manualClock();
    const { req, s } = setup(clock);
    for (let i = 0; i < 5; i++) {
      expect((await req("POST", "/api/dm/login", undefined, `wrong-${i}-secret!`)).status).toBe(
        401,
      );
      clock.advance(1000);
    }
    const locked = await req("POST", "/api/dm/login");
    expect(locked.status).toBe(429);
    expect(await json(locked)).toMatchObject({ code: "throttled" });
    expect(s.auth.verifyDmCredential(TEST_SECRET)).toBe("throttled");
    clock.advance(60_000);
    expect((await req("POST", "/api/dm/login")).status).toBe(204);
    // A fresh server (restart) has a fresh counter.
    const s2 = createTestServices({ db: s.db, clock });
    expect(s2.auth.checkDmSecret(TEST_SECRET)).toBe("ok");
  });

  test("FR-CAMP-05 failures spread over more than 60 s don't lock", async () => {
    const clock = manualClock();
    const { req } = setup(clock);
    for (let i = 0; i < 6; i++) {
      await req("POST", "/api/dm/login", undefined, "wrong-secret-xyz");
      clock.advance(15_000);
    }
    expect((await req("POST", "/api/dm/login")).status).toBe(204);
  });
});

describe("campaigns", () => {
  test("FR-CAMP-06 first campaign becomes active (CampaignActivated, CON-10); next is inactive", async () => {
    const { req, s } = setup();
    const a = await json<CampaignBody>(await req("POST", "/api/campaigns", { name: "  Alpha  " }));
    expect(a.campaign).toMatchObject({ name: "Alpha", active: true });
    const b = await json<CampaignBody>(await req("POST", "/api/campaigns", { name: "Beta" }));
    expect(b.campaign.active).toBe(false);
    expect(readEventLog(s.db).map((e) => e.type)).toEqual([
      "CampaignCreated",
      "CampaignActivated",
      "CampaignCreated",
    ]);
    expect(readEventLog(s.db)[1]?.payload).toEqual({
      campaignId: a.campaign.id,
      previousCampaignId: null,
    });
  });

  test("FR-CAMP-06 name rules: trimmed, 1–60, control chars and duplicates (case-insensitive) rejected", async () => {
    const { req, s } = setup();
    await req("POST", "/api/campaigns", { name: "Ärger" });
    for (const name of ["", "   ", "x".repeat(61), "bad\u0007name", "ärger", "ÄRGER "]) {
      const r = await req("POST", "/api/campaigns", { name });
      expect([400, 409]).toContain(r.status);
    }
    const dup = await req("POST", "/api/campaigns", { name: "ärger" });
    expect(dup.status).toBe(409);
    expect(await json(dup)).toMatchObject({ code: "conflict" });
    const bad = await req("POST", "/api/campaigns", { name: "" });
    expect(await json(bad)).toMatchObject({ code: "invalid" });
    expect(s.db.select().from(campaign).all()).toHaveLength(1);
    expect((await req("POST", "/api/campaigns", { name: "x".repeat(60) })).status).toBe(201);
  });

  test("FR-CAMP-07 list all with active flag; FR-CAMP-10 rename", async () => {
    const { req } = setup();
    const { campaignId } = await seed(req);
    await req("POST", "/api/campaigns", { name: "Second Campaign" });
    const r = await req("PATCH", `/api/campaigns/${campaignId}`, { name: "Renamed" });
    expect(r.status).toBe(200);
    const list = await json<{ campaigns: { name: string; active: boolean }[] }>(
      await req("GET", "/api/campaigns"),
    );
    expect(list.campaigns).toEqual([
      expect.objectContaining({ name: "Renamed", active: true }),
      expect.objectContaining({ name: "Second Campaign", active: false }),
    ]);
    expect((await req("PATCH", "/api/campaigns/nope", { name: "X" })).status).toBe(404);
    expect(
      (await req("PATCH", `/api/campaigns/${campaignId}`, { name: "second campaign" })).status,
    ).toBe(409);
  });

  test("FR-CAMP-08 at most one active campaign, DB-enforced", () => {
    const { s } = setup();
    const row = (id: string) => ({ id, name: id, active: true, createdAt: "t", updatedAt: "t" });
    s.db.insert(campaign).values(row("a")).run();
    expect(() => s.db.insert(campaign).values(row("b")).run()).toThrow();
  });

  test("FR-CAMP-09 switch flips both flags in one transaction, logs CampaignActivated", async () => {
    const { req, s } = setup();
    const { campaignId } = await seed(req);
    const b = await json<CampaignBody>(await req("POST", "/api/campaigns", { name: "B" }));
    const r = await req("POST", `/api/campaigns/${b.campaign.id}/activate`);
    expect(r.status).toBe(200);
    const rows = s.db.select().from(campaign).all();
    expect(rows.filter((c) => c.active).map((c) => c.id)).toEqual([b.campaign.id]);
    const last = readEventLog(s.db).at(-1);
    expect(last).toMatchObject({ type: "CampaignActivated", campaignId: b.campaign.id });
    expect(last?.payload).toEqual({ campaignId: b.campaign.id, previousCampaignId: campaignId });
    expect((await req("POST", "/api/campaigns/nope/activate")).status).toBe(404);
  });
});

describe("players", () => {
  test("FR-CAMP-12 add to the active campaign; no active → 409; duplicate → 409", async () => {
    const { req } = setup();
    expect((await req("POST", "/api/players", { name: "P" })).status).toBe(409);
    expect((await req("GET", "/api/players")).status).toBe(409);
    await seed(req);
    expect((await req("POST", "/api/players", { name: "player 1" })).status).toBe(409);
    expect((await req("POST", "/api/players", { name: "y".repeat(41) })).status).toBe(400);
    const list = await json<{ players: { name: string }[]; publicBaseUrl: string | null }>(
      await req("GET", "/api/players"),
    );
    expect(list.players.map((p) => p.name)).toEqual(["Player 1"]);
    expect(list.publicBaseUrl).toBeNull();
  });

  test("FR-CAMP-13 link token: 128-bit base64url, unique", async () => {
    const { req } = setup();
    const { player: p1 } = await seed(req);
    const p2 = await json<PlayerBody>(await req("POST", "/api/players", { name: "Player 2" }));
    expect(p1.linkToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(p1.linkToken, "base64url")).toHaveLength(16);
    expect(p2.player.linkToken).not.toBe(p1.linkToken);
  });

  test("FR-CAMP-15 rename keeps the token", async () => {
    const { req } = setup();
    const { player: p } = await seed(req);
    const r = await json<PlayerBody>(
      await req("PATCH", `/api/players/${p.id}`, { name: "Thorin" }),
    );
    expect(r.player).toEqual({ id: p.id, name: "Thorin", linkToken: p.linkToken });
  });

  test("FR-CAMP-16/17/18 join: valid 200, unknown 404, inactive campaign → campaignActive false", async () => {
    const { req } = setup();
    const { player: p } = await seed(req);
    const ok = await req("GET", `/api/join/${p.linkToken}`, undefined, null);
    expect(await json(ok)).toEqual({
      playerName: "Player 1",
      campaignName: "Fixture Campaign",
      campaignActive: true,
    });
    expect((await req("GET", "/api/join/AAAAAAAAAAAAAAAAAAAAAA", undefined, null)).status).toBe(
      404,
    );
    expect((await req("GET", "/api/join/garbage", undefined, null)).status).toBe(404);
    const b = await json<CampaignBody>(await req("POST", "/api/campaigns", { name: "B" }));
    await req("POST", `/api/campaigns/${b.campaign.id}/activate`);
    const inactive = await json(await req("GET", `/api/join/${p.linkToken}`, undefined, null));
    expect(inactive).toMatchObject({ campaignActive: false });
  });
});

describe("persistence", () => {
  test("FR-CAMP-20 each command commits its row and one log entry", async () => {
    const { req, s } = setup();
    const { campaignId, player: p } = await seed(req);
    await req("PATCH", `/api/campaigns/${campaignId}`, { name: "X" });
    await req("PATCH", `/api/players/${p.id}`, { name: "Y" });
    expect(readEventLog(s.db).map((e) => e.type)).toEqual([
      "CampaignCreated",
      "CampaignActivated",
      "PlayerAdded",
      "CampaignRenamed",
      "PlayerRenamed",
    ]);
  });

  test("FR-CAMP-20 injected failure → neither row nor log entry", async () => {
    const { req, s } = setup();
    // Break the log write: the command's row insert must roll back with it.
    s.db.$client.run("DROP TABLE event_log");
    const r = await req("POST", "/api/campaigns", { name: "A" });
    expect(r.status).toBe(500);
    expect(s.db.select().from(campaign).all()).toHaveLength(0);
  });

  test("FR-CAMP-03/19 no link token or DM secret in any event log row", async () => {
    const { req, s } = setup();
    const { player: p } = await seed(req);
    await req("PATCH", `/api/players/${p.id}`, { name: "Z" });
    const dump = JSON.stringify(s.db.select().from(eventLog).all());
    expect(dump).not.toContain(p.linkToken);
    expect(dump).not.toContain(TEST_SECRET);
  });
});
