// Compendium expansion X3 (§13): token art on the `cmpx-art` bundle and a prepared `5etools-mini`
// folder. First placement ingests once, later ones reuse in the same command (FR-CMPX-24); a DM
// image is never replaced (-25); failures leave the glyph and one warning (-26); a hidden token's
// art ID never reaches a player (-27); Derive's portrait (-28); crash seams; placement → art time.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepare5etoolsMini } from "@fixtures/5etools-mini/prepare";
import { loadBundle } from "@fixtures/index";
import { CMPX_ART } from "@fixtures/units/compendium/cmpx-art";
import { TB1_SOURCE } from "@fixtures/units/compendium/cmpx-books";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import type { Config } from "../../config";
import { closeDb, type Db, openFileDb, openMemoryDb } from "../../db/client";
import {
  asset,
  campaign,
  combatant,
  compendiumEntry,
  entity,
  importedArt,
  player,
  scene,
  token,
} from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import { type Logger, silentLogger } from "../../log";
import { startServer } from "../../server";
import { createServices, type Services } from "../../services";
import { connectClient, type TestClient } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { INGEST, type IngestResult } from "../assets-pipeline/commands";
import { processImage } from "../assets-pipeline/image";
import { testPng } from "../assets-pipeline/testing";
import { createEncounter } from "../combat-tracker/encounters";
import { startCommand } from "../combat-tracker/lifecycle";
import { DERIVE_MONSTER } from "./derive";
import { APPLY_IMPORTED_ART, artFileOf, IMPORTED_ART_TAG, importedArtOf } from "./imported-art";
import { readEntry } from "./read";

const safeRm = (dir: string) => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold a file a moment longer; the OS cleans its temp dir.
  }
};

let root: string;
let folder: string;
let bytes: Uint8Array;
let bundle: Awaited<ReturnType<typeof loadBundle>>;

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "pp-cmpx-art-"));
  folder = await prepare5etoolsMini(path.join(root, "5etools"));
  bundle = await loadBundle("cmpx-art", { dmSecret: TEST_SECRET, testMode: true });
  const db = openFileDb(bundle.config.dbPath);
  db.$client.run("PRAGMA journal_mode = DELETE");
  bytes = db.$client.serialize();
  closeDb(db);
}, 60_000);

afterAll(() => {
  safeRm(root);
  try {
    bundle.cleanup();
  } catch {
    // As `safeRm`.
  }
});

function capture() {
  const warnings: string[] = [];
  const log: Logger = { ...silentLogger, warn: (m) => warnings.push(m) };
  return { log, warnings };
}

const configFor = (dir: string | null): Config => ({
  ...bundle.config,
  port: 0,
  assetDir: mkdtempSync(path.join(root, "assets-")),
  fiveEtoolsDir: dir,
});

/** Handles over a server's services and DB. */
function handles(s: Services, warnings: string[]) {
  const db = s.db;
  const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const dm: Actor = { role: "dm", playerId: null, campaignId: cid };
  const sceneId = db.select().from(scene).where(eq(scene.campaignId, cid)).get()?.id as string;
  const defOf = (key: string) =>
    db
      .select()
      .from(entity)
      .where(and(eq(entity.source, TB1_SOURCE), eq(entity.sourceKey, key)))
      .get()?.id as string;
  const goblin = defOf(CMPX_ART.goblin.sourceKey);
  const run = <R = unknown>(name: string, input: unknown, actor: Actor = dm) =>
    s.commands.run(name, input, { actor }) as R;
  let col = 0;
  const place = (definitionId = goblin, extra: object = {}) =>
    run<{ tokenId: string }>(MAP_INTENTS.placeToken, {
      sceneId,
      definitionId,
      col: col++,
      row: 0,
      ...extra,
    }).tokenId;
  const imageOf = (id: string) =>
    db.select().from(token).where(eq(token.id, id)).get()?.imageAssetId ?? null;
  const rows = () => db.select().from(importedArt).all();
  /** The campaign's assets named like the batch's monsters (the bundle has its own images). */
  const artAssets = (name = CMPX_ART.goblin.name, campaignId = cid) =>
    db
      .select()
      .from(asset)
      .where(and(eq(asset.name, name), eq(asset.campaignId, campaignId)))
      .all();
  const ingestOwn = async (seed: number) => {
    const image = await processImage(await testPng(seed));
    return (run(INGEST, { image, filename: `dm-${seed}.png` }) as IngestResult).asset.id;
  };
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => events.push(e));
  return {
    s,
    db,
    cid,
    dm,
    sceneId,
    defOf,
    goblin,
    run,
    place,
    imageOf,
    rows,
    artAssets,
    ingestOwn,
    events,
    warnings,
    art: importedArtOf(s),
  };
}

/** Commands + listeners on an in-memory copy of the bundle, the worker armed. */
function fresh(dir: string | null = folder) {
  const { log, warnings } = capture();
  const db: Db = openMemoryDb(bytes);
  const s = createServices({ config: configFor(dir), db, log });
  importedArtOf(s).arm();
  return handles(s, warnings);
}

describe("FR-CMPX-24 first placement, then reuse", () => {
  test("FR-CMPX-24 first placement ingests the file: glyph, then one asset, row and token image", async () => {
    const t = fresh();
    const tok = t.place();
    expect(t.imageOf(tok)).toBeNull();
    await t.art.settled();
    const [a] = t.artAssets();
    expect(t.artAssets()).toHaveLength(1);
    expect(a?.tags).toEqual([IMPORTED_ART_TAG]);
    expect(a?.listed).toBe(true);
    expect(t.imageOf(tok)).toBe(a?.id as string);
    expect(t.rows()).toEqual([
      {
        campaignId: t.cid,
        source: TB1_SOURCE,
        sourceKey: CMPX_ART.goblin.sourceKey,
        assetId: a?.id as string,
        createdAt: expect.any(String),
      },
    ]);
    expect(t.warnings).toEqual([]);
  });

  test("FR-CMPX-24 the follow-up is logged with normal token events", async () => {
    const t = fresh();
    const tok = t.place();
    await t.art.settled();
    const updated = t.events.filter((e) => e.event.type === "TokenUpdated");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.meta.actor.role).toBe("system");
    expect(updated[0]?.event.payload).toEqual({ tokenId: tok, sceneId: t.sceneId });
    const log = readEventLog(t.db, t.cid).map((r) => r.type);
    expect(log).toContain("AssetIngested");
    expect(log.at(-1)).toBe("TokenUpdated");
  });

  test("FR-CMPX-24 a second placement reuses it in the same command: no new asset, one event", async () => {
    const t = fresh();
    t.place();
    await t.art.settled();
    const [a] = t.artAssets();
    t.events.length = 0;
    const second = t.place();
    expect(t.imageOf(second)).toBe(a?.id as string);
    await t.art.settled();
    expect(t.artAssets()).toHaveLength(1);
    expect(t.events.map((e) => e.event.type)).toEqual(["TokenPlaced"]);
    const after = t.events[0]?.event.changes.at(-1)?.after as { imageAssetId: string };
    expect(after.imageAssetId).toBe(a?.id as string);
  });

  test("FR-CMPX-24 concurrent placements: one ingest, every token gets the same asset", async () => {
    const t = fresh();
    const toks = [t.place(), t.place(), t.place()];
    await Bun.sleep(0);
    toks.push(t.place());
    await t.art.settled();
    expect(t.artAssets()).toHaveLength(1);
    const id = t.artAssets()[0]?.id as string;
    for (const tok of toks) expect(t.imageOf(tok)).toBe(id);
    expect(t.events.filter((e) => e.event.type === "AssetIngested")).toHaveLength(1);
    expect(t.rows()).toHaveLength(1);
  });

  test("FR-CMPX-24 the asset deleted → the row goes with it; the next placement ingests again", async () => {
    const t = fresh();
    const tok = t.place();
    await t.art.settled();
    t.run(MAP_INTENTS.deleteToken, { tokenId: tok });
    t.run("assets.delete", { assetId: t.artAssets()[0]?.id as string });
    expect(t.rows()).toEqual([]);
    const next = t.place();
    expect(t.imageOf(next)).toBeNull();
    await t.art.settled();
    expect(t.rows()).toHaveLength(1);
    expect(t.imageOf(next)).toBe(t.artAssets()[0]?.id as string);
  });

  test("FR-CMPX-24 assets are per campaign: another campaign's row and tokens are untouched", async () => {
    const t = fresh();
    t.place();
    await t.art.settled();
    const other = "other-campaign";
    t.db
      .insert(campaign)
      .values({
        ...(t.db.select().from(campaign).get() as typeof campaign.$inferSelect),
        id: other,
        active: false,
        name: "Other",
      })
      .run();
    const actor: Actor = { ...t.dm, campaignId: other };
    const image = await processImage(await testPng(90));
    const map = (t.run(INGEST, { image, filename: "map.png" }, actor) as IngestResult).asset.id;
    const otherScene = t.run<{ id: string }>(
      "map.createScene",
      { name: "Far", mapAssetId: map },
      actor,
    ).id;
    const far = t.run<{ tokenId: string }>(
      MAP_INTENTS.placeToken,
      { sceneId: otherScene, definitionId: t.goblin, col: 0, row: 0 },
      actor,
    ).tokenId;
    expect(t.imageOf(far)).toBeNull();
    await t.art.settled();
    const theirs = t.artAssets(CMPX_ART.goblin.name, other);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.id).not.toBe(t.artAssets()[0]?.id as string);
    expect(t.imageOf(far)).toBe(theirs[0]?.id as string);
    expect(t.rows()).toHaveLength(2);
  });

  test("FR-CMPX-24 a monster without a file in `artPath` or a homebrew token runs nothing", async () => {
    const t = fresh();
    const mira = t.db.select().from(entity).where(eq(entity.name, "Mira")).get()?.id as string;
    t.place(mira);
    await t.art.settled();
    expect(t.warnings).toEqual([]);
    expect(t.rows()).toEqual([]);
  });

  test("FR-CMPX-24 combat's placement: the bound combatant takes the art, row or no row", async () => {
    const t = fresh();
    const image = await processImage(await testPng(91));
    const map = (t.run(INGEST, { image, filename: "map.png" }) as IngestResult).asset.id;
    const start = () => {
      const sceneId = t.run<{ id: string }>("map.createScene", {
        name: "Fight",
        mapAssetId: map,
      }).id;
      const enc = t.run<{ id: string }>(createEncounter.name, {
        name: "Ambush",
        partyCharacterIds: [],
        entries: [{ definitionId: t.goblin, quantity: 1 }],
      });
      t.run(startCommand.name, { encounterId: enc.id, sceneId });
      return enc.id;
    };
    const imageOfCombatant = (encounterId: string) =>
      t.db.select().from(combatant).where(eq(combatant.encounterId, encounterId)).get()
        ?.imageAssetId ?? null;
    const first = start();
    await t.art.settled();
    const id = t.artAssets()[0]?.id as string;
    expect(id).toBeString();
    expect(imageOfCombatant(first)).toBe(id);
    t.run("cbt.end", { encounterId: first });
    const second = start();
    await Bun.sleep(0);
    expect(imageOfCombatant(second)).toBe(id);
    expect(t.artAssets()).toHaveLength(1);
  });
});

describe("FR-CMPX-25 never overrides the DM", () => {
  test("FR-CMPX-25 placed with an image: kept, nothing ingested", async () => {
    const t = fresh();
    const own = await t.ingestOwn(70);
    const tok = t.place(t.goblin, { imageAssetId: own });
    await t.art.settled();
    expect(t.imageOf(tok)).toBe(own);
    expect(t.rows()).toEqual([]);
    expect(t.artAssets()).toEqual([]);
  });

  test("FR-CMPX-25 given an image while the ingest runs: kept; the other token gets the art", async () => {
    const t = fresh();
    const own = await t.ingestOwn(71);
    const mine = t.place();
    const other = t.place();
    t.run(MAP_INTENTS.updateToken, { tokenId: mine, imageAssetId: own });
    await t.art.settled();
    expect(t.imageOf(mine)).toBe(own);
    expect(t.imageOf(other)).toBe(t.artAssets()[0]?.id as string);
  });

  test("FR-CMPX-25 an image given later stays through further placements", async () => {
    const t = fresh();
    const own = await t.ingestOwn(72);
    const tok = t.place();
    await t.art.settled();
    t.run(MAP_INTENTS.updateToken, { tokenId: tok, imageAssetId: own });
    t.place();
    await t.art.settled();
    expect(t.imageOf(tok)).toBe(own);
  });

  test("FR-CMPX-25 duplicating copies its image and never starts an ingest", async () => {
    const t = fresh(path.join(root, "gone"));
    const own = await t.ingestOwn(73);
    const withArt = t.place(t.goblin, { imageAssetId: own });
    const dup = t.run<{ tokenId: string }>(MAP_INTENTS.duplicateToken, {
      tokenId: withArt,
    }).tokenId;
    expect(t.imageOf(dup)).toBe(own);
    const bare = t.place();
    await t.art.settled();
    expect(t.warnings).toHaveLength(1);
    t.run(MAP_INTENTS.duplicateToken, { tokenId: bare });
    await t.art.settled();
    expect(t.warnings).toHaveLength(1);
  });
});

describe("FR-CMPX-26 failures", () => {
  const glyphOneWarning = async (t: ReturnType<typeof fresh>, definitionId = t.goblin) => {
    const tok = t.place(definitionId);
    await t.art.settled();
    expect(t.imageOf(tok)).toBeNull();
    expect(t.rows()).toEqual([]);
    expect(t.warnings).toHaveLength(1);
    return tok;
  };

  test("FR-CMPX-26 folder unset: placement fine, glyph, one warning, no error", async () => {
    const t = fresh(null);
    await glyphOneWarning(t);
    expect(t.warnings[0]).toContain("PP_5ETOOLS_DIR");
  });

  test("FR-CMPX-26 folder missing: glyph, one warning", async () => {
    await glyphOneWarning(fresh(path.join(root, "not-there")));
  });

  test("FR-CMPX-26 file gone: glyph, one warning; the next placement tries again", async () => {
    const t = fresh();
    await glyphOneWarning(t, t.defOf(CMPX_ART.missing.sourceKey));
    t.place(t.defOf(CMPX_ART.missing.sourceKey));
    await t.art.settled();
    expect(t.warnings).toHaveLength(2);
  });

  test("FR-CMPX-26 unreadable image: glyph, one warning, no asset; a good file then heals every token", async () => {
    const dir = await prepare5etoolsMini(path.join(root, "5etools-bad"));
    const file = path.join(dir, "img/bestiary/tokens/TB1/Goblin.webp");
    const good = await Bun.file(file).bytes();
    writeFileSync(file, "not an image");
    const t = fresh(dir);
    const first = await glyphOneWarning(t);
    expect(t.artAssets()).toEqual([]);
    writeFileSync(file, good);
    const second = t.place();
    await t.art.settled();
    const id = t.artAssets()[0]?.id as string;
    expect(t.imageOf(first)).toBe(id);
    expect(t.imageOf(second)).toBe(id);
  });

  test("FR-CMPX-23 a bad stored path is refused at read: `..`, absolute, backslash", async () => {
    writeFileSync(path.join(root, "outside.webp"), "secret");
    for (const bad of [
      "../outside.webp",
      "img/../../outside.webp",
      path.join(root, "outside.webp"),
      "/outside.webp",
      "img\\..\\..\\outside.webp",
    ]) {
      const t = fresh();
      t.db
        .update(compendiumEntry)
        .set({ artPath: bad })
        .where(eq(compendiumEntry.sourceKey, CMPX_ART.goblin.sourceKey))
        .run();
      await glyphOneWarning(t);
      expect(t.warnings[0]).toContain("path not allowed");
      expect(t.artAssets()).toEqual([]);
    }
  });

  test("FR-CMPX-23 a link inside the folder can't lead out of it", async () => {
    const outside = path.join(root, "outside-dir");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "x.webp"), "secret");
    const dir = path.join(root, "5etools-link");
    mkdirSync(path.join(dir, "img"), { recursive: true });
    writeFileSync(path.join(dir, "img", "ok.webp"), "fine");
    symlinkSync(outside, path.join(dir, "img", "out"), "junction");
    expect(await artFileOf(dir, "img/ok.webp")).toBeString();
    expect(await artFileOf(dir, "img/out/x.webp")).toBeNull();
    expect(await artFileOf(dir, "../outside-dir/x.webp")).toBeNull();
  });
});

describe("FR-CMPX-24 crash seams", () => {
  class Killed extends Error {}
  const kill = () => {
    throw new Killed();
  };

  async function crashAt(spec: Parameters<typeof armCrashHook>[0]) {
    const loaded = await loadBundle("cmpx-art", { dmSecret: TEST_SECRET, testMode: true });
    const config = { ...loaded.config, fiveEtoolsDir: folder };
    const boot = () => {
      const db = loaded.openDb();
      const { log, warnings } = capture();
      const s = createServices({ config, db, log });
      importedArtOf(s).arm();
      return { ...handles(s, warnings), close: () => closeDb(db) };
    };
    try {
      let t = boot();
      armCrashHook(spec, kill);
      const lost = t.place();
      await t.art.settled();
      armCrashHook(null);
      expect(t.rows()).toEqual([]);
      t.close();

      // The restart: no row; the next placement retries and heals both tokens.
      t = boot();
      expect(t.rows()).toEqual([]);
      expect(t.imageOf(lost)).toBeNull();
      const next = t.place();
      await t.art.settled();
      expect(t.rows()).toHaveLength(1);
      const id = t.artAssets()[0]?.id as string;
      expect(t.artAssets()).toHaveLength(1);
      expect(t.imageOf(lost)).toBe(id);
      expect(t.imageOf(next)).toBe(id);
      t.close();
    } finally {
      armCrashHook(null);
      try {
        loaded.cleanup();
      } catch {
        // As `safeRm`.
      }
    }
  }

  test("FR-CMPX-24 crash assets.ingest:after-files: no row, the next placement retries", async () => {
    await crashAt({ point: "after-files", target: "assets.ingest" });
  }, 60_000);

  test("FR-CMPX-24 crash before the imported-art row commits: no row, the next placement retries", async () => {
    await crashAt({ point: "before-commit", target: APPLY_IMPORTED_ART });
  }, 60_000);
});

describe("FR-CMPX-27 visibility, over real sockets", () => {
  async function serve() {
    const { log, warnings } = capture();
    const db: Db = openMemoryDb(bytes);
    const running = await startServer({
      config: configFor(folder),
      log,
      db,
      lock: false,
    });
    const t = handles(running.services, warnings);
    t.run("fog.setAll", { sceneId: t.sceneId, fogged: false });
    const url = `ws://127.0.0.1:${running.port}/ws`;
    const clients: TestClient[] = [];
    const live = async (credential: Parameters<typeof connectClient>[1]) => {
      const c = await connectClient(url, credential);
      clients.push(c);
      await c.next("snapshot");
      return c;
    };
    const token_ = db.select().from(player).where(eq(player.campaignId, t.cid)).get()
      ?.linkToken as string;
    return {
      t,
      live,
      asPlayer: () => live({ role: "player", token: token_ }),
      asDm: () => live({ role: "dm", secret: TEST_SECRET }),
      stop: async () => {
        for (const c of clients) c.close();
        await running.stop();
      },
    };
  }

  test("FR-CMPX-27 a hidden token's art ID never reaches a player, until it is revealed", async () => {
    const h = await serve();
    try {
      const p = await h.asPlayer();
      const dm = await h.asDm();

      // First placement: the ingest and the follow-up, hidden.
      const hidden = h.t.place(h.t.goblin, { hidden: true });
      await h.t.art.settled();
      const id = h.t.artAssets()[0]?.id as string;
      expect(id).toBeString();
      expect(h.t.imageOf(hidden)).toBe(id);
      // Reuse in the placing command, hidden; a barrier so the player's frames have arrived.
      const hidden2 = h.t.place(h.t.goblin, { hidden: true });
      expect(h.t.imageOf(hidden2)).toBe(id);
      await dm.next("event");
      await p.expectNoFrame(150);
      expect(p.raw()).not.toContain(id);
      expect(p.raw()).not.toContain(hidden);
      expect(dm.raw()).toContain(id);

      // A late joiner's snapshot.
      const late = await h.asPlayer();
      expect(late.raw()).not.toContain(id);

      // Revealed: an ordinary token field.
      h.t.run(MAP_INTENTS.setTokenHidden, { tokenId: hidden, hidden: false });
      const shown = await p.next("event", 2000);
      expect(shown.changes[0]).toMatchObject({
        type: "token",
        op: "upsert",
        data: { id: hidden, imageAssetId: id },
      });
    } finally {
      await h.stop();
    }
  }, 30_000);

  test("FR-CMPX-27 a visible token: the player gets the image on the follow-up", async () => {
    const h = await serve();
    try {
      const p = await h.asPlayer();
      const tok = h.t.place();
      const placed = await p.next("event", 2000);
      expect(placed.changes[0]).toMatchObject({
        op: "upsert",
        data: { id: tok, imageAssetId: null },
      });
      const art = await p.next("event", 2000);
      const id = h.t.artAssets()[0]?.id as string;
      expect(art.changes[0]).toMatchObject({ op: "upsert", data: { id: tok, imageAssetId: id } });
      // Reuse: one frame, the last change carries the image.
      const second = h.t.place();
      const frame = await p.next("event", 2000);
      expect(frame.changes.at(-1)).toMatchObject({
        op: "upsert",
        data: { id: second, imageAssetId: id },
      });
    } finally {
      await h.stop();
    }
  }, 30_000);

  test("FR-CMPX-24 placement → art for the DM ≤ 1 s (logged)", async () => {
    const h = await serve();
    try {
      const dm = await h.asDm();
      const startedAt = performance.now();
      const tok = h.t.place();
      for (;;) {
        const ev = await dm.next("event", 5000);
        const c = ev.changes.find((x) => x.type === "token" && x.id === tok);
        if ((c?.data as { imageAssetId?: string | null } | undefined)?.imageAssetId) break;
      }
      const ms = performance.now() - startedAt;
      console.log(`FR-CMPX-24 placement → art for the DM: ${ms.toFixed(0)} ms (target ≤ 1000)`);
      // The target is 1 s on the DM's machine; the fail line leaves room for a loaded CI runner.
      expect(ms).toBeLessThan(5000);
    } finally {
      await h.stop();
    }
  }, 30_000);
});

describe("FR-CMPX-28 Derive", () => {
  const entryIdOf = (t: ReturnType<typeof fresh>) =>
    t.db
      .select()
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.source, TB1_SOURCE),
          eq(compendiumEntry.sourceKey, CMPX_ART.goblin.sourceKey),
        ),
      )
      .get()?.id as string;
  const viewer = (t: ReturnType<typeof fresh>) =>
    ({ role: "dm", campaignId: t.cid, playerId: null }) as const;

  test("FR-CMPX-28 the entry names the campaign's imported art once it exists; the ETag follows", async () => {
    const t = fresh();
    const before = readEntry(t.db, entryIdOf(t), viewer(t));
    expect(before?.body.importedArtAssetId).toBeUndefined();
    t.place();
    await t.art.settled();
    const after = readEntry(t.db, entryIdOf(t), viewer(t));
    expect(after?.body.importedArtAssetId).toBe(t.artAssets()[0]?.id as string);
    expect(after?.etag).not.toBe(before?.etag as string);
  });

  test("FR-CMPX-28 another campaign's art is not offered", async () => {
    const t = fresh();
    t.place();
    await t.art.settled();
    const read = readEntry(t.db, entryIdOf(t), { ...viewer(t), campaignId: "other" });
    expect(read?.body.importedArtAssetId).toBeUndefined();
  });

  test("FR-CMPX-28 a player's read never carries it", async () => {
    const t = fresh();
    t.place();
    await t.art.settled();
    const pid = t.db.select().from(player).get()?.id as string;
    const spell = t.db.select().from(compendiumEntry).get()?.id as string;
    const read = readEntry(t.db, spell, { role: "player", campaignId: t.cid, playerId: pid });
    expect(read?.body.importedArtAssetId).toBeUndefined();
  });

  test("FR-CMPX-28 Derive saves the prefilled portrait; removed = none", async () => {
    const t = fresh();
    t.place();
    await t.art.settled();
    const id = t.artAssets()[0]?.id as string;
    const statBlock = { size: "small", ac: 12, hpMax: 9, initBonus: 1, attacks: [], cr: "1" };
    const derive = (name: string, portraitAssetId: string | null) =>
      t.run<{ entity: { portraitAssetId: string | null } }>(DERIVE_MONSTER, {
        entryId: entryIdOf(t),
        entity: { kind: "monster", name, portraitAssetId, statBlock },
        copyText: false,
      }).entity.portraitAssetId;
    expect(derive("Goblin Elder", id)).toBe(id);
    expect(derive("Goblin Plain", null)).toBeNull();
  });
});
