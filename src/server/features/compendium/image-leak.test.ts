// ASSET §13 / CMP §13.1 `FR-ASSET-36 leak property over REST` (FR-ASSET-36, -38; ADR-0054): seeded
// random sequences of put / share / unshare / image add / remove (and forged foreign images) on
// `cmp-images`. After every step, every asset ID in player-1's and player-2's compendium REST
// bodies (search, `sameAs`, GET 200 / 304 / 404) belongs to an entry `entryVisibleTo` lets that
// player read right now; error and 304 bodies hold none; no `ETag` header holds any asset ID.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { CMP_IMAGES } from "@fixtures/units/compendium/cmp-images";
import { IMAGE_SLOTS_MAX } from "@shared/compendium/schemas";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import { asset, campaign, compendiumEntry, player } from "../../db/schema";
import { dmActor } from "../../http";
import { TEST_SECRET } from "../../testing/services";
import { servicesFromBundle } from "../../ws/testing/snapshot-size";
import { INGEST, type IngestResult } from "../assets-pipeline/commands";
import { processImage } from "../assets-pipeline/image";
import { testPng } from "../assets-pipeline/testing";
import { type EntryViewer, entryVisibleTo } from "./visibility";

const STEPS = 60;
/** Fixture Campaign homebrew the sequence edits (cmp-homebrew + cmp-images). */
const EDITED = [CMP_IMAGES.lantern, CMP_IMAGES.secret, "Moonblade Shard", "CMP-SECRET-ITEM"];

let b: Awaited<ReturnType<typeof servicesFromBundle>>;
let app: ReturnType<typeof createApp>;
let fixtureCid: string;
let viewers: { name: string; token: string; viewer: EntryViewer }[];
/** Fixture Campaign assets the steps may attach (listed + attachments). */
let pool: string[];
/** Another campaign's attachment: a forged `PUT` naming it must fail. */
let foreign: string;

/** Park–Miller LCG: deterministic steps per seed (no `Math.random`). */
function rng(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 48_271) % 2_147_483_647;
    return s % n;
  };
}

async function ingest(seed: number, campaignId: string): Promise<string> {
  const image = await processImage(await testPng(seed));
  const r = b.s.commands.run(
    INGEST,
    { image, filename: `leak-${seed}.png`, listed: false },
    { actor: dmActor(campaignId) },
  ) as IngestResult;
  return r.asset.id;
}

beforeAll(async () => {
  b = await servicesFromBundle(
    await loadBundle("cmp-images", { dmSecret: TEST_SECRET, testMode: true }),
  );
  app = createApp(b.s);
  const camps = b.s.db.select().from(campaign).all();
  fixtureCid = camps.find((c) => c.name === "Fixture Campaign")?.id as string;
  const secondCid = camps.find((c) => c.name === "Second Campaign")?.id as string;
  viewers = b.s.db
    .select()
    .from(player)
    .where(eq(player.campaignId, fixtureCid))
    .all()
    .map((p) => ({
      name: p.name,
      token: p.linkToken,
      viewer: { role: "player" as const, campaignId: fixtureCid, playerId: p.id },
    }));
  pool = [await ingest(61, fixtureCid), await ingest(62, fixtureCid)];
  pool.push(
    ...b.s.db
      .select()
      .from(asset)
      .where(eq(asset.campaignId, fixtureCid))
      .all()
      .map((a) => a.id)
      .filter((id) => !pool.includes(id)),
  );
  foreign = await ingest(63, secondCid);
}, 60_000);
afterAll(() => b?.cleanup());

const DM = { Authorization: `Bearer ${TEST_SECRET}` };

async function call(p: string, init: RequestInit = {}) {
  const res = await app.request(`/api/compendium${p}`, init);
  return { status: res.status, text: await res.text(), etag: res.headers.get("etag") };
}

const entries = () => b.s.db.select().from(compendiumEntry).all();
const byName = (name: string) => {
  const r = entries().find((e) => e.name === name && e.campaignId === fixtureCid);
  if (!r) throw new Error(`no entry ${name}`);
  return r;
};

function put(name: string, patch: { shared?: boolean; imageAssetIds?: string[] }) {
  const r = byName(name);
  return call(`/entries/${r.id}`, {
    method: "PUT",
    headers: { ...DM, "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: { kind: r.kind, name: r.name, facets: r.facets, body: r.body },
      shared: patch.shared ?? r.shared,
      imageAssetIds: patch.imageAssetIds ?? r.imageAssetIds,
      derivedFromId: r.derivedFromId,
    }),
  });
}

/** One random DM step; returns its label. */
async function step(pick: (n: number) => number): Promise<string> {
  const name = EDITED[pick(EDITED.length)] as string;
  const held = byName(name).imageAssetIds;
  const op = pick(6);
  if (op === 0) {
    expect((await put(name, { shared: true })).status).toBe(200);
    return `share ${name}`;
  }
  if (op === 1) {
    expect((await put(name, { shared: false })).status).toBe(200);
    return `unshare ${name}`;
  }
  if (op === 2) {
    const free = pool.filter((id) => !held.includes(id));
    if (held.length >= IMAGE_SLOTS_MAX || free.length === 0) return `full ${name}`;
    const add = free[pick(free.length)] as string;
    expect((await put(name, { imageAssetIds: [...held, add] })).status).toBe(200);
    return `add image ${name}`;
  }
  if (op === 3) {
    if (held.length === 0) return `empty ${name}`;
    const at = pick(held.length);
    expect((await put(name, { imageAssetIds: held.filter((_, i) => i !== at) })).status).toBe(200);
    return `remove image ${name}`;
  }
  if (op === 4) {
    // Reorder: the last image becomes the main one.
    const next = held.length > 1 ? [held.at(-1) as string, ...held.slice(0, -1)] : held;
    expect((await put(name, { imageAssetIds: next })).status).toBe(200);
    return `reorder ${name}`;
  }
  const forged = await put(name, { imageAssetIds: [...held.slice(0, 3), foreign] });
  expect(forged.status).toBe(404);
  return `forged ${name}`;
}

/** Every response a player can provoke, with what it was (for failure messages). */
async function playerResponses(token: string) {
  const auth = { Authorization: `Player ${token}` };
  const out: { what: string; status: number; text: string; etag: string | null }[] = [];
  for (const q of ["", "lantern", "CMP", "relic"]) {
    out.push({ what: `search ${q}`, ...(await call(`/search?q=${q}`, { headers: auth })) });
    out.push({
      what: `search ${q} items`,
      ...(await call(`/search?q=${q}&kind=item`, { headers: auth })),
    });
  }
  for (const e of entries().filter((x) => x.campaignId !== null)) {
    out.push({
      what: `sameAs ${e.name}`,
      ...(await call(`/search?sameAs=${e.id}`, { headers: auth })),
    });
    const got = await call(`/entries/${e.id}`, { headers: auth });
    out.push({ what: `GET ${e.name}`, ...got });
    const dm = await call(`/entries/${e.id}`, { headers: DM });
    for (const tag of [dm.etag, got.etag]) {
      if (!tag) continue;
      out.push({
        what: `GET ${e.name} If-None-Match`,
        ...(await call(`/entries/${e.id}`, { headers: { ...auth, "If-None-Match": tag } })),
      });
    }
  }
  return out;
}

describe("FR-ASSET-36 leak property over REST (FR-ASSET-38, ADR-0054)", () => {
  test("FR-ASSET-36 leak property over REST: random put / share / unshare / image add / remove / reorder / forged steps; every asset ID a player reads belongs to an entry they may read; errors, 304s and ETags hold none", async () => {
    const pick = rng(20_261_019);
    const labels: string[] = [];
    let delivered = 0;
    for (let i = 0; i <= STEPS; i++) {
      if (i > 0) labels.push(await step(pick));
      const all = entries();
      const universe = [...pool, foreign];
      for (const v of viewers) {
        const allowed = new Set(
          all.filter((e) => entryVisibleTo(e, v.viewer)).flatMap((e) => e.imageAssetIds),
        );
        for (const r of await playerResponses(v.token)) {
          const found = universe.filter((id) => r.text.includes(id));
          const where = { step: i, last: labels.at(-1) ?? "start", player: v.name, what: r.what };
          if (r.status !== 200) expect({ ...where, found }).toEqual({ ...where, found: [] });
          else
            expect({ ...where, bad: found.filter((id) => !allowed.has(id)) }).toEqual({
              ...where,
              bad: [],
            });
          const inTag = universe.filter((id) => r.etag?.includes(id));
          expect({ ...where, inTag }).toEqual({ ...where, inTag: [] });
          delivered += r.status === 200 ? found.length : 0;
        }
      }
    }
    // The run exercised both sides: IDs were delivered, and every op kind ran.
    expect(delivered).toBeGreaterThan(0);
    for (const op of ["share", "unshare", "add image", "remove image", "forged"]) {
      expect(labels.some((l) => l.startsWith(op))).toBe(true);
    }
    console.log(`FR-ASSET-36 leak property: ${STEPS} steps, ${delivered} delivered IDs checked`);
  }, 60_000);
});
