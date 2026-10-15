// AoE templates over real sockets on the `scene-tools` bundle (SCN §13 integration): the
// `scn.template` routing (FR-SCN-24), Keep / edit / delete / clear frames per role (FR-SCN-25–27),
// leak strings ("Glyph", no DM-only or non-active-scene signal), convergence and restart (§11).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import { AOE_TEMPLATE_TYPE, SCN_INTENTS as S, SCN_SIGNALS } from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { aoeTemplate, player, scene } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

let h: TestServer;
let db: Db;
let dir: string;
let links: Record<string, string>;
const sceneId: Record<string, string> = {};
const templateId: Record<string, string> = {};

beforeAll(async () => {
  const loaded = await loadBundle("scene-tools", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  links = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((p) => [p.name, p.token]),
  );
  for (const s of db.select().from(scene).all()) sceneId[s.name] = s.id;
  for (const t of db.select().from(aoeTemplate).all()) templateId[t.label] = t.id;
  h = await startTestServer({ db, fake: false, testMode: true });
}, 30_000); // loads the scenes bundle incl. sharp rasterising

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const dmCred = () => ({ role: "dm" as const, secret: TEST_SECRET });
const p1Cred = () => ({ role: "player" as const, token: links["Player 1"] as string });
const p2Cred = () => ({ role: "player" as const, token: links["Player 2"] as string });
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
/** Sends an intent and waits for its ack or reject. */
async function intent(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
  }
}
const ambush = () => sceneId["Goblin Ambush"] as string;
const cellar = () => sceneId.Cellar as string;
const labels = (c: TestClient) =>
  Object.values(c.store.records[AOE_TEMPLATE_TYPE] ?? {})
    .map((r) => (r as { label: string }).label)
    .sort();
const sphere = (sid: string, extra: Record<string, unknown> = {}) => ({
  sceneId: sid,
  shape: "sphere",
  x: 6,
  y: 6,
  size: 20,
  angle: 0,
  ...extra,
});

describe("SCN §13 templates over sockets (scene-tools bundle)", () => {
  test("SCN §13 fixture scn-templates: DM sees both once Goblin Ambush is active; players only Spirit Guardians", async () => {
    const dm = await h.live(dmCred());
    // Inactive: the DM window holds no template; players none.
    expect(labels(dm)).toEqual([]);
    expect(await intent(dm, I.activateScene, { sceneId: ambush() })).toMatchObject({
      type: "ack",
    });
    dm.close();
    const dm2 = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    expect(labels(dm2)).toEqual(["Glyph", "Spirit Guardians"]);
    expect(labels(p1)).toEqual(["Spirit Guardians"]);
    expect(p1.store.records[AOE_TEMPLATE_TYPE]?.[templateId["Spirit Guardians"] as string]).toEqual(
      expect.objectContaining({ placedByPlayerId: p1.store.you?.playerId, hidden: false }),
    );
    expect(p1.raw()).not.toContain("Glyph");
    expect(leakScan(h.s, p1)).toEqual([]);
    for (const c of [dm2, p1]) c.close();
  });

  test("FR-SCN-24 scn.template routing: player → all; DM dmOnly / Cellar → DM tabs only; end → all; rejects to the sender; no DB, log or seq", async () => {
    const dm = await h.live(dmCred());
    const dm2 = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    const all = [dm, dm2, p1, p2];
    const mark = new Map(all.map((c) => [c, c.frames.length]));
    const since = (c: TestClient) => c.frames.slice(mark.get(c));
    // Senders interleave freely at the hub; each sender's own frames keep their order.
    const got = (c: TestClient) =>
      since(c)
        .flatMap((f) =>
          f.type === "signal" && f.name === SCN_SIGNALS.template
            ? [`${f.from.role}:${(f.data as { key: string }).key}`]
            : [],
        )
        .sort((a, b) => Number(a.startsWith("player")) - Number(b.startsWith("player")));
    const rejects = (c: TestClient) =>
      since(c).flatMap((f) => (f.type === "reject" ? [f.code as string] : []));
    const rows = db.select().from(aoeTemplate).all();
    const logs = readEventLog(db).length;
    const seqs = all.map((c) => c.store.seq);
    const send = (c: TestClient, data: Record<string, unknown>) =>
      c.send({ type: "signal", name: SCN_SIGNALS.template, data });

    send(p1, { ...sphere(ambush()), key: "p1" });
    send(p1, { ...sphere(cellar()), key: "p1-cellar" });
    send(p1, { ...sphere(ambush()), key: "p1-dm", dmOnly: true });
    send(dm, { ...sphere(ambush()), key: "dm-open", label: "Fireball" });
    send(dm, { ...sphere(ambush()), key: "dm-only", label: "Secret Glyph", dmOnly: true });
    send(dm, { ...sphere(cellar()), key: "dm-cellar", label: "Cellar Trap" });
    send(dm, { sceneId: cellar(), key: "dm-cellar", end: true });
    send(dm, { sceneId: ambush(), key: "dm-only", end: true });
    send(p1, { sceneId: ambush(), key: "p1", end: true });
    send(dm, { ...sphere(ambush()), key: "bad", size: 7 });
    for (const c of [p1, dm, dm2, p2]) await barrier(c);

    expect(got(dm2)).toEqual([
      "dm:dm-open",
      "dm:dm-only",
      "dm:dm-cellar",
      "dm:dm-cellar",
      "dm:dm-only",
      "player:p1",
      "player:p1",
    ]);
    expect(got(dm)).toEqual(["player:p1", "player:p1"]);
    expect(got(p1)).toEqual(["dm:dm-open", "dm:dm-only"]);
    expect(got(p2)).toEqual(["dm:dm-open", "dm:dm-only", "player:p1", "player:p1"]);
    expect(rejects(p1)).toEqual(["invalid", "invalid"]);
    expect(rejects(dm)).toEqual(["invalid"]);
    // Leak list: no dmOnly geometry and nothing from a non-active scene in player frames.
    for (const c of [p1, p2]) {
      const raw = JSON.stringify(since(c).filter((f) => f.type === "signal"));
      for (const leak of ["Secret Glyph", "Cellar Trap", "dmOnly", cellar()]) {
        expect(raw).not.toContain(leak);
      }
    }
    expect(db.select().from(aoeTemplate).all()).toEqual(rows);
    expect(readEventLog(db).length).toBe(logs);
    expect(all.map((c) => c.store.seq)).toEqual(seqs);
    for (const c of all) c.close();
  });

  test("FR-SCN-25 / -26 / -27 Keep, edit, hide, clear: frames per role; others can't delete; leak-free and convergent", async () => {
    const dm = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    const p2 = await h.live(p2Cred());
    const kept = await intent(p1, S.placeTemplate, sphere(ambush(), { label: "Fireball" }));
    expect(kept.type).toBe("ack");
    const fireball = (kept as Extract<ServerFrame, { type: "ack" }>).result as {
      templateId: string;
    };
    for (const c of [dm, p2]) await barrier(c);
    for (const c of [dm, p2]) {
      expect(c.store.records[AOE_TEMPLATE_TYPE]?.[fireball.templateId]).toMatchObject({
        label: "Fireball",
        placedByPlayerId: p1.store.you?.playerId,
      });
    }
    // p2 can't touch it; p1 sending `hidden` is invalid; the DM may move it.
    expect(await intent(p2, S.deleteTemplate, { templateId: fireball.templateId })).toMatchObject({
      type: "reject",
      code: "forbidden",
    });
    expect(
      await intent(p1, S.updateTemplate, { templateId: fireball.templateId, hidden: true }),
    ).toMatchObject({ type: "reject", code: "invalid" });
    expect(
      await intent(p1, S.placeTemplate, sphere(ambush(), { placedByPlayerId: "x" })),
    ).toMatchObject({ type: "reject", code: "invalid" });
    // Glyph: the hidden DM template is unknown to players.
    const glyph = templateId.Glyph as string;
    expect(await intent(p1, S.deleteTemplate, { templateId: glyph })).toMatchObject({
      type: "reject",
      code: "not_found",
    });
    await intent(p1, S.updateTemplate, { templateId: fireball.templateId, x: 7, angle: 90 });
    await barrier(p2);
    expect(p2.store.records[AOE_TEMPLATE_TYPE]?.[fireball.templateId]).toMatchObject({ x: 7 });
    expect(p2.raw()).not.toContain("Glyph");
    // Reveal Glyph → upsert to players; hide again → delete.
    await intent(dm, S.updateTemplate, { templateId: glyph, hidden: false });
    await barrier(p2);
    expect(labels(p2)).toEqual(["Fireball", "Glyph", "Spirit Guardians"]);
    await intent(dm, S.updateTemplate, { templateId: glyph, hidden: true });
    await barrier(p2);
    expect(labels(p2)).toEqual(["Fireball", "Spirit Guardians"]);
    expect(leakScan(h.s, p1)).toEqual([]);
    expect(leakScan(h.s, p2)).toEqual([]);
    const fresh = await h.live(p2Cred());
    const c = convergence(h.s, p2, fresh);
    expect(c.live).toEqual(c.fresh);
    // Clear templates: every kept one gone for players; the DM sees none on Goblin Ambush.
    await intent(dm, S.clearTemplates, { sceneId: ambush() });
    for (const x of [p1, p2]) await barrier(x);
    expect(labels(p1)).toEqual([]);
    expect(labels(p2)).toEqual([]);
    expect(labels(dm)).toEqual([]);
    for (const x of [dm, p1, p2, fresh]) x.close();
  });

  test("SCN §11 restart: kept templates survive on the same DB; ephemerals never existed there", async () => {
    const dm = await h.live(dmCred());
    await intent(dm, S.placeTemplate, sphere(ambush(), { label: "Kept" }));
    dm.send({
      type: "signal",
      name: SCN_SIGNALS.template,
      data: { ...sphere(ambush()), key: "eph", label: "Ephemeral" },
    });
    await barrier(dm);
    dm.close();
    await h.restart();
    const dm2 = await h.live(dmCred());
    const p1 = await h.live(p1Cred());
    expect(labels(dm2)).toEqual(["Kept"]);
    expect(labels(p1)).toEqual(["Kept"]);
    expect(dm2.raw()).not.toContain("Ephemeral");
    for (const c of [dm2, p1]) c.close();
  });
});
