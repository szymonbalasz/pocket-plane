// Fixture loader: reset / load / reset-and-load with guards, lock and manifest
// (FR-FIX-01–11, 27, 28; AGENTS §9.3). Loads via server commands, in-process, DM authority.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { playerLinkUrl } from "@shared/campaign-management/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { seededContext, systemClock } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { type Config, disposableRoots, localUrl, parseConfig } from "../../config";
import { closeDb, openFileDb, openMemoryDb } from "../../db/client";
import { createSchema } from "../../db/push";
import { campaign, player } from "../../db/schema";
import { silentLogger } from "../../log";
import { acquireLock } from "../../runtime/lock";
import { type Manifest, readManifest, writeManifest } from "../../runtime/manifest";
import { createServices, type Services } from "../../services";
import { activeCampaign } from "../campaign-management/commands";
import type { Fixture, FixtureLibrary, Refs } from "./fixture-types";
import { validateBatch } from "./import-pipeline";

export const ASSETS_ROOT = "fixtures/assets";

export class FixtureError extends Error {
  override name = "FixtureError";
}

// ---------- resolution (FR-FIX-04, FR-FIX-15) ----------

export function resolveBundle(lib: FixtureLibrary, name: string): Fixture[] {
  const bundles = new Map(lib.bundles.map((b) => [b.name, b]));
  const fixtures = new Map(lib.fixtures.map((f) => [f.key, f]));
  if (!bundles.has(name)) {
    throw new FixtureError(`Unknown bundle "${name}". Known: ${[...bundles.keys()].join(", ")}`);
  }

  const keys: string[] = [];
  const visitBundle = (n: string, stack: string[]): boolean => {
    const b = bundles.get(n);
    if (!b) throw new FixtureError(`Bundle "${stack.at(-1)}" includes unknown bundle "${n}"`);
    if (stack.includes(n)) throw new FixtureError(`Bundle cycle: ${[...stack, n].join(" → ")}`);
    let hasBase = n === "base";
    for (const inc of b.includes) hasBase = visitBundle(inc, [...stack, n]) || hasBase;
    if (!hasBase) throw new FixtureError(`Bundle "${n}" must include "base"`);
    keys.push(...b.fixtures);
    return hasBase;
  };
  visitBundle(name, []);

  const order: Fixture[] = [];
  const done = new Set<string>();
  const visit = (key: string, stack: string[]) => {
    if (done.has(key)) return;
    if (stack.includes(key))
      throw new FixtureError(`Fixture cycle: ${[...stack, key].join(" → ")}`);
    const f = fixtures.get(key);
    if (!f) {
      throw new FixtureError(
        stack.length
          ? `Fixture "${stack.at(-1)}" requires unknown fixture "${key}"`
          : `Bundle "${name}" lists unknown fixture "${key}"`,
      );
    }
    for (const dep of f.requires) visit(dep, [...stack, key]);
    done.add(key);
    order.push(f);
  };
  for (const k of keys) visit(k, []);
  return order;
}

/** Everything that can fail before a write (FR-FIX-04). */
export function preflight(lib: FixtureLibrary, bundle: string, config: Config): Fixture[] {
  const order = resolveBundle(lib, bundle);
  const probe = createServices({ config, db: openMemoryDb(), log: silentLogger });
  for (const f of order) {
    for (const a of f.assets ?? []) {
      if (!Bun.file(path.join(config.root, ASSETS_ROOT, a)).size) {
        throw new FixtureError(`Fixture "${f.key}": missing asset file ${ASSETS_ROOT}/${a}`);
      }
    }
    if (f.kind === "setup") {
      f.steps.forEach((s, i) => {
        if (!probe.commands.has(s.command)) {
          const hint = s.command.startsWith("probe.") ? " (needs PP_TEST_MODE=1)" : "";
          throw new FixtureError(
            `Fixture "${f.key}" step ${i}: unknown command "${s.command}"${hint}`,
          );
        }
      });
    } else {
      try {
        validateBatch(probe.imports, f.batch);
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
        const detail = (err.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`);
        throw new FixtureError(
          `Fixture "${f.key}": invalid reference batch\n  ${detail.join("\n  ")}`,
        );
      }
    }
  }
  return order;
}

// ---------- guards (FR-FIX-02) ----------

function isUnder(child: string, parent: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  const rel = path.relative(norm(parent), norm(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function checkGuards(config: Config): void {
  if (!config.disposable) {
    throw new FixtureError(
      "Refusing: data dir is not flagged disposable (PP_DATA_DISPOSABLE=1). Nothing changed.",
    );
  }
  const roots = disposableRoots(config.root);
  for (const [label, p] of [
    ["data dir", config.dataDir],
    ["DB path", config.dbPath],
    ["asset dir", config.assetDir],
  ] as const) {
    if (!roots.some((r) => isUnder(p, r))) {
      throw new FixtureError(
        `Refusing: ${label} ${p} is not under ${roots.join(" or ")}. Nothing changed.`,
      );
    }
  }
}

// ---------- reset (FR-FIX-01) ----------

function emptyManifest(status: Manifest["status"], startedAt: string): Manifest {
  return {
    status,
    bundle: null,
    fixtures: [],
    records: {},
    dmUrl: null,
    playerLinks: [],
    startedAt,
    durationMs: null,
  };
}

// `closeDb` releases our own handles at once, so a busy file has another holder.
function removeFile(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM") {
      throw new FixtureError(
        `Cannot delete ${file} (${code}): it is in use. Stop the server or close the DB viewer, then retry.`,
      );
    }
    throw err;
  }
}

async function doReset(config: Config): Promise<void> {
  mkdirSync(config.dataDir, { recursive: true });
  writeManifest(config.dataDir, emptyManifest("resetting", systemClock.iso()));
  for (const suffix of ["", "-wal", "-shm", "-journal"]) removeFile(`${config.dbPath}${suffix}`);
  try {
    rmSync(config.assetDir, { recursive: true, force: true });
  } catch (err) {
    throw new FixtureError(
      `Cannot delete ${config.assetDir}: ${(err as Error).message}. Stop the server, then retry.`,
    );
  }
  const db = openFileDb(config.dbPath);
  try {
    await createSchema(db.$client);
  } finally {
    closeDb(db);
  }
  mkdirSync(config.assetDir, { recursive: true });
  writeManifest(config.dataDir, emptyManifest("empty", systemClock.iso()));
}

// ---------- load (FR-FIX-03, 05, 06, 08, 09) ----------

function urls(config: Config) {
  const port = config.profile === "dev" ? config.vitePort : config.port;
  const dmUrl = port === 0 ? null : `${localUrl(config.host, port)}/`;
  const base = config.publicBaseUrl ?? (port === 0 ? null : localUrl(config.host, port));
  return { dmUrl, base };
}

async function runFixtures(services: Services, config: Config, bundle: string, order: Fixture[]) {
  const records: Record<string, Record<string, string[]>> = {};
  let current: string | null = null;
  services.bus.subscribe("fixture-records", ({ event }) => {
    if (!current) return;
    const bucket = records[current] ?? {};
    records[current] = bucket;
    for (const ch of event.changes) {
      if (ch.before !== null || ch.after === null) continue;
      const list = bucket[ch.type] ?? [];
      bucket[ch.type] = list;
      list.push(ch.id);
    }
  });
  const refs: Refs = {
    ids: (key, type) => {
      if (!(key in records)) throw new Error(`Fixture "${key}" has not been loaded yet`);
      return records[key]?.[type] ?? [];
    },
    id(key, type, index = 0) {
      const id = refs.ids(key, type)[index];
      if (id === undefined) throw new Error(`Fixture "${key}" created no ${type} #${index}`);
      return id;
    },
  };

  for (const f of order) {
    current = f.key;
    records[f.key] = {};
    const ctx = seededContext({ disposable: config.disposable, key: f.key });
    const steps =
      f.kind === "setup" ? f.steps : [{ command: "import.batch", input: f.batch as unknown }];
    for (const [i, s] of steps.entries()) {
      try {
        // A step input may be async (e.g. image processing before `assets.ingest`); the
        // command itself always runs synchronously in its transaction.
        const input =
          typeof s.input === "function"
            ? await (s.input as (r: Refs) => unknown | Promise<unknown>)(refs)
            : s.input;
        const active = activeCampaign(services.db);
        const campaignId = active?.id ?? null;
        // A step `as` a player fixture runs as that player (default: the DM).
        const as = "as" in s ? s.as : undefined;
        const actor =
          as === undefined
            ? { role: "dm" as const, playerId: null, campaignId }
            : { role: "player" as const, playerId: refs.id(as, "player"), campaignId };
        services.commands.run(s.command, input, { actor, ctx });
      } catch (err) {
        const msg =
          err instanceof CommandError
            ? `${err.code}: ${err.message}${
                err.issues?.length
                  ? ` (${err.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")})`
                  : ""
              }`
            : (err as Error).message;
        throw new FixtureError(
          `Load failed: bundle "${bundle}", fixture "${f.key}", step ${i}, command "${s.command}": ${msg}`,
        );
      }
    }
  }
  current = null;
  return records;
}

async function doLoad(
  config: Config,
  lib: FixtureLibrary,
  bundle: string,
  durable = true,
): Promise<Manifest> {
  const m = readManifest(config.dataDir);
  if (m?.status !== "empty") {
    throw new FixtureError(
      `Refusing: DB is not empty (manifest ${m?.status ?? "missing"}). Reset first: bun run fixtures:reset-load ${bundle}`,
    );
  }
  const order = preflight(lib, bundle, config);
  const started = performance.now();
  const startedAt = systemClock.iso();
  writeManifest(config.dataDir, {
    ...emptyManifest("loading", startedAt),
    bundle,
    fixtures: order.map((f) => f.key),
  });

  const db = openFileDb(config.dbPath);
  // One fsync per step commit is most of a load's DB time; a throwaway dir doesn't need it.
  if (!durable) db.$client.run("PRAGMA synchronous = OFF");
  let records: Record<string, Record<string, string[]>>;
  let playerRows: { name: string; token: string; campaign: string }[];
  try {
    const services = createServices({ config, db, log: silentLogger });
    records = await runFixtures(services, config, bundle, order);
    playerRows = db
      .select({ name: player.name, token: player.linkToken, campaign: campaign.name })
      .from(player)
      .innerJoin(campaign, eq(player.campaignId, campaign.id))
      .orderBy(asc(player.createdAt), asc(sql`player.rowid`))
      .all();
  } catch (err) {
    closeDb(db);
    await doReset(config); // FR-FIX-05: back to empty
    throw err;
  }
  closeDb(db);

  const { dmUrl, base } = urls(config);
  const manifest: Manifest = {
    status: "complete",
    bundle,
    fixtures: order.map((f) => f.key),
    records,
    dmUrl,
    playerLinks: playerRows.map((p) => ({
      player: p.name,
      campaign: p.campaign,
      url: base ? playerLinkUrl(base, p.token) : `/p/${p.token}`,
    })),
    startedAt,
    durationMs: Math.round(performance.now() - started),
  };
  writeManifest(config.dataDir, manifest);
  return manifest;
}

// ---------- entry points ----------

export interface LoaderOptions {
  notice?: (msg: string) => void;
  /** `false`: step commits skip fsync (`synchronous = OFF`); for throwaway dirs only. */
  durable?: boolean;
}

export async function reset(config: Config, opts: LoaderOptions = {}): Promise<void> {
  checkGuards(config);
  const lock = acquireLock(config.dataDir, "loader", systemClock.iso(), opts.notice);
  try {
    await doReset(config);
  } finally {
    lock.release();
  }
}

export async function load(
  config: Config,
  lib: FixtureLibrary,
  bundle: string,
  opts: LoaderOptions = {},
): Promise<Manifest> {
  checkGuards(config);
  const lock = acquireLock(config.dataDir, "loader", systemClock.iso(), opts.notice);
  try {
    return await doLoad(config, lib, bundle);
  } finally {
    lock.release();
  }
}

export async function resetAndLoad(
  config: Config,
  lib: FixtureLibrary,
  bundle: string,
  opts: LoaderOptions = {},
): Promise<Manifest> {
  checkGuards(config);
  preflight(lib, bundle, config); // fail before wiping anything
  const lock = acquireLock(config.dataDir, "loader", systemClock.iso(), opts.notice);
  try {
    await doReset(config);
    return await doLoad(config, lib, bundle, opts.durable);
  } finally {
    lock.release();
  }
}

/** FR-FIX-11: own temp data dir flagged disposable, no ports. */
export async function loadInProcess(
  lib: FixtureLibrary,
  bundle: string,
  opts: { testMode?: boolean; dmSecret?: string } = {},
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-fixtures-"));
  const config = parseConfig({
    PP_PORT: "0",
    PP_DATA_DIR: dir,
    PP_DATA_DISPOSABLE: "1",
    PP_TEST_MODE: opts.testMode ? "1" : "",
    PP_DM_SECRET: opts.dmSecret ?? "in-process-dm-secret",
  });
  // The temp dir dies with the test: power-loss durability buys nothing here (fix/test-speed).
  const manifest = await resetAndLoad(config, lib, bundle, { durable: false });
  return {
    config,
    manifest,
    dir,
    openDb: () => openFileDb(config.dbPath),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
