// FR-CMP-77 over real HTTP on the `sheet-links` bundle: exact names → the one entry, or "several";
// the same visibility as search (FR-CMP-14), for the DM and a player.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NAME_LOOKUP_MAX, NameLookupResponse, type NameMatch } from "@shared/compendium/rest";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { compendiumEntry, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { CMP_CACHE_CONTROL } from "./auth";

let h: TestServer;
let db: Db;
let dir: string;
let token: string;

const DM = { Authorization: `Bearer ${TEST_SECRET}` };
const player1 = () => ({ Authorization: `Player ${token}` });

beforeAll(async () => {
  const loaded = await loadBundle("sheet-links", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  token = db.select().from(player).where(eq(player.name, "Player 1")).get()?.linkToken as string;
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

const post = (body: unknown, headers: Record<string, string>) =>
  fetch(`${h.http}/api/compendium/names`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function look(
  names: { kind: string; name: string }[],
  headers: Record<string, string>,
): Promise<NameMatch[]> {
  const res = await post({ names }, headers);
  expect(res.status).toBe(200);
  return NameLookupResponse.parse(await res.json()).matches;
}

const idOf = (name: string) =>
  db.select().from(compendiumEntry).where(eq(compendiumEntry.name, name)).get()?.id as string;

describe("FR-CMP-77 sheet names → compendium entries", () => {
  test("FR-CMP-77 one entry → its id, several → null, none → no answer", async () => {
    const m = await look(
      [
        { kind: "spell", name: "Fireball" },
        { kind: "spell", name: "Bless" },
        { kind: "item", name: "Longsword" },
        { kind: "spell", name: "Hedge Whisper" },
      ],
      DM,
    );
    expect(m.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { kind: "spell", name: "Bless", entryId: null },
      { kind: "spell", name: "Fireball", entryId: idOf("Fireball") },
      { kind: "item", name: "Longsword", entryId: idOf("Longsword") },
    ]);
  });

  test("FR-CMP-77 exact name only, whatever the case or apostrophes; within the kind asked", async () => {
    const id = idOf("Hunter's Mark");
    expect(await look([{ kind: "spell", name: "hunters MARK" }], DM)).toEqual([
      { kind: "spell", name: "hunters MARK", entryId: id },
    ]);
    expect(await look([{ kind: "spell", name: "Hunter" }], DM)).toEqual([]);
    expect(await look([{ kind: "item", name: "Fireball" }], DM)).toEqual([]);
    expect(await look([{ kind: "spell", name: "…" }], DM)).toEqual([]);
  });

  test("FR-CMP-77 FR-CMP-14 a player gets no answer for what they can't read, and a DM-only copy doesn't make a name ambiguous", async () => {
    const asked = [
      { kind: "spell", name: "Fireball (house)" },
      { kind: "item", name: "CMP-SECRET-ITEM" },
    ];
    expect(await look(asked, DM)).toHaveLength(2);
    expect(await look(asked, player1())).toEqual([]);

    const made = await fetch(`${h.http}/api/compendium/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...DM },
      body: JSON.stringify({
        entry: {
          kind: "item",
          name: "Bag of Holding",
          facets: { category: "gear", attunement: false },
          body: { typeLine: "Gear", text: "The DM's own." },
        },
      }),
    });
    expect(made.status).toBe(201);
    const bag = [{ kind: "item", name: "Bag of Holding" }];
    expect((await look(bag, DM))[0]?.entryId).toBeNull();
    const seen = await look(bag, player1());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.entryId).not.toBeNull();
  });

  test("FR-CMP-77 a shared homebrew counts for a player too", async () => {
    expect(await look([{ kind: "spell", name: "Bless" }], player1())).toEqual([
      { kind: "spell", name: "Bless", entryId: null },
    ]);
  });

  test("FR-CMPX-36 a feat and a class option are looked up as their own kinds", async () => {
    const made = await fetch(`${h.http}/api/compendium/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...DM },
      body: JSON.stringify({
        entry: {
          kind: "feat",
          name: "Crossbow Expert",
          facets: {},
          body: { text: "Fast reloads." },
        },
      }),
    });
    expect(made.status).toBe(201);
    const m = await look(
      [
        { kind: "feature", name: "Crossbow Expert" },
        { kind: "feat", name: "crossbow expert" },
        { kind: "option", name: "Crossbow Expert" },
      ],
      DM,
    );
    expect(m).toEqual([
      { kind: "feat", name: "crossbow expert", entryId: idOf("Crossbow Expert") },
    ]);
  });

  test("FR-CMPX-36 a race and a background are looked up as their own kinds", async () => {
    for (const entry of [
      { kind: "race", name: "Warforged", facets: {}, body: { text: "Living constructs." } },
      { kind: "background", name: "Sailor", facets: {}, body: { text: "Ship's Passage." } },
    ]) {
      const made = await fetch(`${h.http}/api/compendium/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...DM },
        body: JSON.stringify({ entry }),
      });
      expect(made.status).toBe(201);
    }
    const m = await look(
      [
        { kind: "race", name: "Warforged" },
        { kind: "background", name: "Warforged" },
        { kind: "race", name: "Sailor" },
        { kind: "background", name: "sailor" },
      ],
      DM,
    );
    expect(m.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: "background", name: "sailor", entryId: idOf("Sailor") },
      { kind: "race", name: "Warforged", entryId: idOf("Warforged") },
    ]);
  });

  test("FR-CMP-77 FR-CMP-13 credentials, validation and Cache-Control as every compendium route", async () => {
    const names = [{ kind: "spell", name: "Fireball" }];
    const anon = await post({ names }, {});
    expect(anon.status).toBe(401);
    expect(anon.headers.get("cache-control")).toBe(CMP_CACHE_CONTROL);
    expect((await post({ names: [{ kind: "monster", name: "Goblin" }] }, DM)).status).toBe(400);
    const tooMany = Array.from({ length: NAME_LOOKUP_MAX + 1 }, () => names[0]);
    expect((await post({ names: tooMany }, DM)).status).toBe(400);
    const full = Array.from({ length: NAME_LOOKUP_MAX }, () => names[0]);
    expect((await post({ names: full }, player1())).status).toBe(200);
  });
});
