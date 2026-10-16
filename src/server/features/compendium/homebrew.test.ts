// CMP §13 integration (C4) on the `compendium` bundle over real HTTP: FR-CMP-24 homebrew put /
// replace (name conflict, imported → forbidden), FR-CMP-25 clone (independent) + delete,
// FR-CMP-27 derive-monster (entity + NPC sheet Features in one transaction; rollback on a bad
// body). DM only: player credentials → 401; Cache-Control on every answer.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { DeriveMonsterResponse, PutEntryResponse } from "@shared/compendium/homebrew";
import { EntryResponse } from "@shared/compendium/rest";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { compendiumEntry, creatureSheet, entity, player } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { CMP_CACHE_CONTROL } from "./auth";
import { featureRowsOf } from "./derive";
import { NAME_TAKEN, READ_ONLY_ENTRY } from "./homebrew";

let h: TestServer;
let db: Db;
let dir: string;
let token1: string;
let cid: string;

beforeAll(async () => {
  const loaded = await loadBundle("compendium", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  const p1 = db.select().from(player).where(eq(player.name, "Player 1")).get();
  token1 = p1?.linkToken as string;
  cid = p1?.campaignId as string;
  h = await startTestServer({ db, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM = { Authorization: `Bearer ${TEST_SECRET}` };
const P1 = () => ({ Authorization: `Player ${token1}` });

async function req(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = DM,
) {
  const res = await fetch(`${h.http}/api/compendium${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.headers.get("cache-control")).toBe(CMP_CACHE_CONTROL);
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as unknown };
}

const byName = (name: string) =>
  db.select().from(compendiumEntry).where(eq(compendiumEntry.name, name)).get();
const item = (name: string, text = "A thing.") => ({
  kind: "item" as const,
  name,
  facets: { category: "gear" as const, attunement: false },
  body: { typeLine: "Adventuring gear", text },
});

describe("compendium homebrew REST (C4)", () => {
  test("FR-CMP-24 POST / PUT: create, whole replace; name conflict; imported → forbidden; kind ≠ monster; players 401", async () => {
    const created = await req("POST", "/entries", { entry: item("Lucky Coin") });
    expect(created.status).toBe(201);
    const { entryId } = PutEntryResponse.parse(created.json);
    expect(byName("Lucky Coin")).toMatchObject({ campaignId: cid, source: null, shared: false });

    const replaced = await req("PUT", `/entries/${entryId}`, {
      entry: item("Lucky Coin", "Heads you win."),
      shared: true,
    });
    expect(replaced.status).toBe(200);
    const got = EntryResponse.parse((await req("GET", `/entries/${entryId}`)).json);
    expect(got.entry).toMatchObject({ shared: true, body: { text: "Heads you win." } });

    const dup = await req("POST", "/entries", { entry: item("lucky coin") });
    expect([dup.status, dup.json]).toEqual([409, { code: "conflict", message: NAME_TAKEN }]);

    const fireball = byName("Fireball");
    const ro = await req("PUT", `/entries/${fireball?.id}`, { entry: item("Mine") });
    expect([ro.status, (ro.json as { message: string }).message]).toEqual([403, READ_ONLY_ENTRY]);

    const goblin = byName("Goblin");
    const monster = await req("POST", "/entries", {
      entry: { kind: "monster", name: "Gob", facets: goblin?.facets, body: goblin?.body },
    });
    expect(monster.status).toBe(400);
    const long = await req("POST", "/entries", { entry: item("Long", "y".repeat(8_001)) });
    expect(long.status).toBe(400);

    for (const r of [
      await req("POST", "/entries", { entry: item("P1 coin") }, P1()),
      await req("PUT", `/entries/${entryId}`, { entry: item("P1 coin") }, P1()),
      await req("DELETE", `/entries/${entryId}`, undefined, P1()),
      await req("POST", "/entries", { entry: item("Anon") }, {}),
    ]) {
      expect(r.status).toBe(401);
    }
    expect(byName("P1 coin")).toBeUndefined();
    const log = readEventLog(db, cid).filter((x) => x.type === "CompendiumEntrySaved");
    expect(log.at(-1)?.payload).toEqual({ entryId, kind: "item", shared: true });
  });

  test("FR-CMP-25 clone: the form prefilled from a visible entry saves an independent entry; DELETE homebrew only; sheet copies stay", async () => {
    const potion = EntryResponse.parse(
      (await req("GET", `/entries/${byName("Potion of Healing")?.id}`)).json,
    );
    const clone = await req("POST", "/entries", {
      entry: {
        kind: potion.entry.kind,
        name: "Potion of Greater Healing (house)",
        facets: potion.entry.facets,
        body: potion.entry.body,
      },
      shared: true,
      derivedFromId: potion.entry.id,
    });
    expect(clone.status).toBe(201);
    const { entryId } = PutEntryResponse.parse(clone.json);
    const row = byName("Potion of Greater Healing (house)");
    expect(row).toMatchObject({ source: null, sourceKey: null, campaignId: cid });
    expect(row?.facets).toEqual(potion.entry.facets);

    // A base that isn't visible (another campaign's homebrew) → 404.
    const second = byName("CMP-SECOND-HOMEBREW");
    const hidden = await req("POST", "/entries", {
      entry: item("From second"),
      derivedFromId: second?.id,
    });
    expect(hidden.status).toBe(404);

    const ro = await req("DELETE", `/entries/${potion.entry.id}`);
    expect([ro.status, (ro.json as { code: string }).code]).toEqual([403, "forbidden"]);
    expect((await req("DELETE", `/entries/${second?.id}`)).status).toBe(404);
    expect((await req("DELETE", "/entries/nope")).status).toBe(404);

    const del = await req("DELETE", `/entries/${entryId}`);
    expect(del.status).toBe(204);
    expect(byName("Potion of Greater Healing (house)")).toBeUndefined();
    expect(byName("Potion of Healing")).toBeDefined();
    expect((await req("GET", `/entries/${entryId}`)).status).toBe(404);
    const log = readEventLog(db, cid).filter((x) => x.type === "CompendiumEntryDeleted");
    expect(log.at(-1)?.payload).toEqual({ entryId });
  });

  test("FR-CMP-27 derive-monster: custom entity derived from the definition + NPC sheet Features (Nimble Escape) in one tx; copyText off → no sheet; rollback on a bad body", async () => {
    const goblin = EntryResponse.parse((await req("GET", `/entries/${byName("Goblin")?.id}`)).json);
    const def = goblin.definition;
    if (!def) throw new Error("goblin definition missing");
    const r = await req("POST", "/derive-monster", {
      entryId: goblin.entry.id,
      entity: { kind: "monster", name: "Goblin Sneak", statBlock: { ...def.statBlock, hpMax: 12 } },
      copyText: true,
    });
    expect(r.status).toBe(201);
    const { entity: e } = DeriveMonsterResponse.parse(r.json);
    expect(e).toMatchObject({ name: "Goblin Sneak", campaignId: cid, derivedFromId: def.id });
    expect(e.statBlock.hpMax).toBe(12);
    const sheet = db.select().from(creatureSheet).where(eq(creatureSheet.entityId, e.id)).get();
    const features = (sheet?.features ?? []) as { name: string; source: string; text: string }[];
    expect(features.map((f) => f.name)).toContain("Nimble Escape");
    // Scimitar / Shortbow are mapped attacks: not copied as text.
    expect(features.map((f) => f.name)).not.toContain("Scimitar");
    expect(features.every((f) => f.source === "SRD 5.1" && f.text.length <= 600)).toBe(true);
    const log = readEventLog(db, cid).slice(-2);
    expect(log.map((x) => x.type)).toEqual(["EntityCreated", "CharacterSheetEdited"]);
    expect(log[1]?.payload).toMatchObject({ creatureId: e.id, op: "putRow", list: "features" });

    const plain = await req("POST", "/derive-monster", {
      entryId: goblin.entry.id,
      entity: { kind: "monster", name: "Goblin Plain", statBlock: def.statBlock },
      copyText: false,
    });
    expect(plain.status).toBe(201);
    const plainId = DeriveMonsterResponse.parse(plain.json).entity.id;
    expect(
      db.select().from(creatureSheet).where(eq(creatureSheet.entityId, plainId)).get(),
    ).toBeUndefined();

    const count = () =>
      db
        .select()
        .from(entity)
        .where(and(eq(entity.campaignId, cid), eq(entity.kind, "monster")))
        .all().length;
    const before = count();
    for (const bad of [
      { entity: { kind: "monster", name: "Bad", statBlock: { ...def.statBlock, ac: 99 } } },
      { entity: { kind: "monster", name: "Goblin Sneak", statBlock: def.statBlock } },
      {
        entryId: byName("Fireball")?.id,
        entity: { kind: "monster", name: "Fire", statBlock: def.statBlock },
      },
      { entryId: "nope", entity: { kind: "monster", name: "Nope", statBlock: def.statBlock } },
    ]) {
      const res = await req("POST", "/derive-monster", { entryId: goblin.entry.id, ...bad });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(count()).toBe(before);
    const p = await req(
      "POST",
      "/derive-monster",
      {
        entryId: goblin.entry.id,
        entity: { kind: "monster", name: "X", statBlock: def.statBlock },
      },
      P1(),
    );
    expect(p.status).toBe(401);
  });

  test("FR-CMP-27 copied rows: traits, unmapped actions, reactions, legendary; ≤ 30; names ≤ 60; text clipped to 600 with …", () => {
    const s = (name: string, text = "t") => ({ name, text });
    const rows = featureRowsOf(
      {
        meta: {},
        traits: [s("Keen Smell"), s("N".repeat(70), "x".repeat(700))],
        actions: [s("Multiattack"), s("Bite")],
        bonusActions: [],
        reactions: [s("Parry")],
        legendary: { intro: "i", actions: Array.from({ length: 40 }, (_, i) => s(`L${i}`)) },
      },
      ["bite"],
      "SRD 5.1",
    );
    expect(rows).toHaveLength(30);
    expect(rows.slice(0, 5).map((r) => r.name.slice(0, 10))).toEqual([
      "Keen Smell",
      "NNNNNNNNNN",
      "Multiattac",
      "Parry",
      "L0",
    ]);
    expect(rows[1]?.name).toHaveLength(60);
    expect(rows[1]?.text).toHaveLength(600);
    expect(rows[1]?.text.endsWith("…")).toBe(true);
  });
});
