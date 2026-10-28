// Bundle snapshot cache (fix/test-fixture-cache). A load is deterministic (ADR-0022: seeded
// IDs / tokens / clock / dice per fixture key), so the same bundle + options + code give the
// same DB and asset files. The first load of a key runs the real commands and stores the
// result; later loads copy it into the fresh data dir instead of replaying them.
//
// Layout: `<dir>/<code key>/<entry key>/{db.sqlite, assets/, meta.json}`.
// - code key: a content hash of everything a load runs (`CODE_DIRS`, `CODE_FILES`; test and
//   bench files left out), Bun version and platform. Computed once per process (~0.1 s for
//   ~1300 files), or taken from `PP_FIXTURE_CACHE_KEY` (a parent runner computes it once).
// - entry key: bundle, resolved fixture order + each fixture's definition (functions by
//   source), test mode and the FR-FIX-29 clock anchor. Not stored, so not in it: the DM secret,
//   host, port, public base URL (the manifest's URLs are rebuilt per load), `durable`.
// - An entry dir appears by one rename of a complete temp dir: parallel writers race safely,
//   the loser drops its copy. `meta.json` present = entry complete.
// - The cache is best effort: a failed write or read never fails a load.
//
// Env, read by `cacheSettings()` (AGENTS §9.1 exception, test tooling: `loadInProcess` builds
// its Config from a literal env, so these can't ride on Config; move to config.ts if preferred):
// `PP_FIXTURE_CACHE=0` off, `=verify` every cached load real + checked (audit);
// `PP_FIXTURE_CACHE_DIR` (default `<os tmp>/pp-fixture-cache`);
// `PP_FIXTURE_CACHE_KEY` code key override.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { systemClock } from "../../commands/context";
import { stateDigest } from "../../db/digest";
import type { Fixture } from "./fixture-types";

/** Bump when the entry layout or what a load writes changes shape. */
export const CACHE_FORMAT = 1;
export const CODE_DIRS = ["fixtures", "src/server", "src/shared"] as const;
export const CODE_FILES = ["bun.lock"] as const;
const SKIP_FILE = /\.(test|bench)\.tsx?$/;
/**
 * Code-key dirs (other branches / older commits; ~2 MB per bundle, ~250 MB for the whole
 * library) unused this long are pruned, and beyond this many (worktrees share the dir).
 */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_CODE_DIRS = 6;

/**
 * `true`: use the cache (hit → copy; miss → real load, then store). `"verify"`: always a real
 * load; if an entry exists it must match (else the load fails), if not the result is stored.
 * `false`: real load, cache untouched.
 */
export type CacheMode = boolean | "verify";

export interface CacheSettings {
  enabled: boolean;
  /** `PP_FIXTURE_CACHE=verify`: every cached load runs for real and is checked (an audit run). */
  verifyAll: boolean;
  dir: string;
  /** Code key override; null = hash the code. */
  codeKey: string | null;
}

const CacheEnv = z.object({
  PP_FIXTURE_CACHE: z.string().optional(),
  PP_FIXTURE_CACHE_DIR: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  PP_FIXTURE_CACHE_KEY: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .pipe(
      z
        .string()
        .regex(
          /^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$/,
          "PP_FIXTURE_CACHE_KEY: 8-128 of [A-Za-z0-9_.-], starting with a letter or digit",
        )
        .optional(),
    ),
});

export function parseCacheEnv(env: Record<string, string | undefined>): CacheSettings {
  const e = CacheEnv.parse(env);
  return {
    enabled: e.PP_FIXTURE_CACHE !== "0",
    verifyAll: e.PP_FIXTURE_CACHE === "verify",
    dir: path.resolve(e.PP_FIXTURE_CACHE_DIR ?? path.join(os.tmpdir(), "pp-fixture-cache")),
    codeKey: e.PP_FIXTURE_CACHE_KEY ?? null,
  };
}

/** The process's cache settings (read per call: tests may change the env). */
export function cacheSettings(): CacheSettings {
  return parseCacheEnv(process.env);
}

// ---------- keys ----------

const codeKeys = new Map<string, string>();

/** Relative paths (`/`-separated) of the files under `dir` that `keep` accepts. */
function walk(dir: string, rel: string, out: string[], keep: (name: string) => boolean): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a missing dir hashes as empty
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out, keep);
    else if (e.isFile() && keep(e.name)) out.push(r);
  }
}

/** Content hash of the code a load runs; memoised per root. */
export function codeHash(root: string): string {
  const hit = codeKeys.get(root);
  if (hit) return hit;
  const files: string[] = [];
  for (const d of CODE_DIRS) walk(path.join(root, d), d, files, (n) => !SKIP_FILE.test(n));
  for (const f of CODE_FILES) if (existsSync(path.join(root, f))) files.push(f);
  files.sort();
  const h = new Bun.CryptoHasher("sha256");
  h.update(
    `pp-fixture-cache ${CACHE_FORMAT} bun ${Bun.version} ${process.platform} ${process.arch}\n`,
  );
  for (const f of files) {
    h.update(`${f}\0${Bun.hash(readFileSync(path.join(root, f))).toString(16)}\n`);
  }
  const key = h.digest("hex").slice(0, 32);
  codeKeys.set(root, key);
  return key;
}

/**
 * The code key in effect: the override (a parent's `codeHash`, so both name the same dir),
 * else this process's hash.
 */
export function codeKey(root: string, settings: CacheSettings): string {
  return settings.codeKey ?? codeHash(root);
}

const fingerprints = new WeakMap<Fixture, string>();
const withSource = (_k: string, v: unknown) =>
  typeof v === "function" ? `fn:${v.toString()}` : typeof v === "bigint" ? `big:${v}` : v;

/** A fixture's definition: data by value, function inputs by source. Memoised per object. */
function fingerprint(f: Fixture): string {
  let fp = fingerprints.get(f);
  if (fp === undefined) {
    fp = Bun.hash(JSON.stringify(f, withSource)).toString(16);
    fingerprints.set(f, fp);
  }
  return fp;
}

export interface EntryInput {
  bundle: string;
  order: readonly Fixture[];
  testMode: boolean;
  /** FR-FIX-29 clock anchor (ms), or null for `FIXTURE_INSTANT`. */
  anchor: number | null;
}

export function entryKey(input: EntryInput): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(
    JSON.stringify({
      bundle: input.bundle,
      testMode: input.testMode,
      anchor: input.anchor,
      fixtures: input.order.map((f) => [f.key, fingerprint(f)]),
    }),
  );
  return h.digest("hex").slice(0, 32);
}

// ---------- entries ----------

export const PlayerRow = z.object({ name: z.string(), token: z.string(), campaign: z.string() });
export type PlayerRow = z.infer<typeof PlayerRow>;

const Meta = z.object({
  format: z.literal(CACHE_FORMAT),
  bundle: z.string(),
  fixtures: z.array(z.string()),
  records: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  players: z.array(PlayerRow),
  createdAt: z.string(),
});
export type EntryMeta = z.infer<typeof Meta>;

export interface Entry {
  dir: string;
  meta: EntryMeta;
}

export interface Snapshot extends Omit<EntryMeta, "format" | "createdAt"> {
  /** `sqlite.serialize()` of the loaded DB (WAL content included). */
  db: Uint8Array;
  assetDir: string;
}

const DB_FILE = "db.sqlite";
const ASSETS = "assets";
const META = "meta.json";

const entryPath = (dir: string, code: string, entry: string) => path.join(dir, code, entry);

const touched = new Set<string>();
/** Mark a code dir as in use (prune age), once per process. */
function touch(codeDir: string): void {
  if (touched.has(codeDir)) return;
  touched.add(codeDir);
  try {
    const now = systemClock.now() / 1000;
    utimesSync(codeDir, now, now);
  } catch {
    // best effort
  }
}

export function readEntry(dir: string, code: string, entry: string): Entry | null {
  const p = entryPath(dir, code, entry);
  let raw: string;
  try {
    raw = readFileSync(path.join(p, META), "utf8");
  } catch {
    return null;
  }
  let parsed: ReturnType<typeof Meta.safeParse>;
  try {
    parsed = Meta.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  touch(path.dirname(p));
  return { dir: p, meta: parsed.data };
}

/** Copy an entry's DB and asset files to a (cleared) data dir. */
export function restoreEntry(e: Entry, dbPath: string, assetDir: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  copyFileSync(path.join(e.dir, DB_FILE), dbPath);
  cpSync(path.join(e.dir, ASSETS), assetDir, { recursive: true });
}

/**
 * What `"verify"` compares: the DB's rows (`stateDigest`, which skips `db_meta` and event-log
 * times) and the asset files by path and content.
 */
export function snapshotDigest(dbImage: Uint8Array, assetDir: string): string {
  // A WAL-mode image doesn't deserialize; bytes 18-19 = 1 read it as rollback-journal.
  const img = new Uint8Array(dbImage);
  img[18] = 1;
  img[19] = 1;
  const sqlite = Database.deserialize(img, { strict: true });
  let db: string;
  try {
    db = stateDigest(sqlite).sha256;
  } finally {
    sqlite.close();
  }
  const files: string[] = [];
  walk(assetDir, "", files, () => true);
  files.sort();
  const h = new Bun.CryptoHasher("sha256");
  h.update(`db ${db}\n`);
  for (const f of files) {
    h.update(`${f}\0${Bun.hash(readFileSync(path.join(assetDir, f))).toString(16)}\n`);
  }
  return h.digest("hex");
}

/** `snapshotDigest` of a stored entry. */
export function entryDigest(e: Entry): string {
  return snapshotDigest(readFileSync(path.join(e.dir, DB_FILE)), path.join(e.dir, ASSETS));
}

const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

function rmQuiet(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // a leftover temp dir under the cache dir is harmless
  }
}

/**
 * Store a snapshot: build it in a temp dir, then one rename. Returns false when another
 * process published the entry first (or the write failed); never throws.
 */
export function writeEntry(
  dir: string,
  code: string,
  entry: string,
  snap: Snapshot,
  createdAt: string,
): boolean {
  const codeDir = path.join(dir, code);
  const final = path.join(codeDir, entry);
  const tmp = path.join(codeDir, `.tmp-${process.pid}-${randomUUID()}`);
  try {
    if (existsSync(path.join(final, META))) return false;
    const fresh = !existsSync(codeDir);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, DB_FILE), snap.db);
    if (existsSync(snap.assetDir))
      cpSync(snap.assetDir, path.join(tmp, ASSETS), { recursive: true });
    else mkdirSync(path.join(tmp, ASSETS));
    const meta: EntryMeta = {
      format: CACHE_FORMAT,
      bundle: snap.bundle,
      fixtures: snap.fixtures,
      records: snap.records,
      players: snap.players,
      createdAt,
    };
    writeFileSync(path.join(tmp, META), `${JSON.stringify(meta)}\n`);
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, final);
        break;
      } catch (err) {
        // Lost the race: the winner's entry is complete (it appeared by rename).
        if (existsSync(path.join(final, META))) {
          rmQuiet(tmp);
          return false;
        }
        const code = (err as NodeJS.ErrnoException).code ?? "";
        if (!TRANSIENT.has(code) || attempt >= 20) throw err;
        Bun.sleepSync(Math.min(10 * (attempt + 1), 100));
      }
    }
    touch(codeDir);
    if (fresh) prune(dir, code);
    return true;
  } catch {
    rmQuiet(tmp);
    return false;
  }
}

/**
 * Drop code dirs not used for `PRUNE_AFTER_MS`, and all but the `MAX_CODE_DIRS` most recently
 * used (best effort; run when a new one appears). `keep` (this process's) always stays.
 */
export function prune(dir: string, keep: string, now = systemClock.now()): string[] {
  let dirs: { name: string; mtime: number }[];
  try {
    dirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== keep)
      .map((e) => ({ name: e.name, mtime: statSync(path.join(dir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
  const removed: string[] = [];
  dirs.forEach(({ name, mtime }, i) => {
    if (now - mtime < PRUNE_AFTER_MS && i < MAX_CODE_DIRS - 1) return;
    try {
      rmSync(path.join(dir, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      // in use or gone: leave it
    }
  });
  return removed;
}
