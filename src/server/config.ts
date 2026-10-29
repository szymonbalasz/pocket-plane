// The only module that reads process.env (AGENTS §9.1). Node-compatible: vite.config.ts imports it.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PROFILES = ["dev", "verify"] as const;
export type Profile = (typeof PROFILES)[number];
export type LogLevel = "debug" | "info" | "warn" | "error";

const flag = z
  .string()
  .optional()
  .transform((v) => v === "1");
const port = z.coerce.number().int().min(0).max(65535).optional();
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const EnvSchema = z.object({
  PP_SLOT: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().min(0).max(49).optional(),
  ),
  PP_PROFILE: z.preprocess((v) => (v === "" ? undefined : v), z.enum(PROFILES).default("dev")),
  PP_HOST: optionalString.transform((v) => v ?? "127.0.0.1"),
  PP_PORT: z.preprocess((v) => (v === "" ? undefined : v), port),
  PP_VITE_PORT: z.preprocess((v) => (v === "" ? undefined : v), port),
  PP_DATA_DIR: optionalString,
  PP_DB_PATH: optionalString,
  PP_ASSET_DIR: optionalString,
  PP_DATA_DISPOSABLE: flag,
  PP_TEST_MODE: flag,
  PP_TEST_CRASH: optionalString,
  PP_DM_SECRET: z.string().optional(),
  PP_PUBLIC_BASE_URL: optionalString.pipe(z.url().optional()),
  PP_LOG_LEVEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
});

export interface Config {
  root: string;
  slot: number | null;
  profile: Profile;
  host: string;
  /** Hono port for this profile; 0 = OS-assigned. */
  port: number;
  /** Vite dev port (dev profile only). */
  vitePort: number;
  dataDir: string;
  dbPath: string;
  assetDir: string;
  disposable: boolean;
  testMode: boolean;
  /** Test-mode crash hook (`PP_TEST_CRASH`, #163); null = off. Armed by the entry points. */
  testCrash: CrashSpec | null;
  /** Never log, store or send. Empty string only when `requireSecret: false`. */
  dmSecret: string;
  publicBaseUrl: string | null;
  logLevel: LogLevel;
}

/**
 * `PP_TEST_CRASH` (#163): `<command>:before-commit` (inside the transaction, after the command
 * and its event-log rows) | `<command>:after-commit` (committed; before caches, listeners, ack) |
 * `assets.ingest:after-files` (files renamed into place, row not written) | `fixture:<key>`
 * (fixture load: before the commit of that fixture's first command).
 */
export interface CrashSpec {
  point: "before-commit" | "after-commit" | "after-files" | "fixture";
  /** Command name, or the fixture key for `fixture`. */
  target: string;
}

const COMMAND_NAME = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/;
const FIXTURE_KEY = /^[a-z0-9][a-z0-9-]*$/;

/** Parses a `PP_TEST_CRASH` value; throws ConfigError on a malformed one. */
export function parseCrashSpec(v: string): CrashSpec {
  const i = v.lastIndexOf(":");
  const [head, tail] = i === -1 ? [v, ""] : [v.slice(0, i), v.slice(i + 1)];
  if (head === "fixture" && FIXTURE_KEY.test(tail)) return { point: "fixture", target: tail };
  if (COMMAND_NAME.test(head)) {
    if (tail === "before-commit" || tail === "after-commit") return { point: tail, target: head };
    if (tail === "after-files" && head === "assets.ingest") {
      return { point: "after-files", target: head };
    }
  }
  throw new ConfigError(
    `PP_TEST_CRASH "${v}": use <command>:before-commit | <command>:after-commit | assets.ingest:after-files | fixture:<key>`,
  );
}

export const formatCrashSpec = (c: CrashSpec): string =>
  c.point === "fixture" ? `fixture:${c.target}` : `${c.target}:${c.point}`;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface ParseOptions {
  /** `--profile` flag; overrides PP_PROFILE. */
  profile?: string;
  /** dev, start, fixtures:* need a slot unless ports are explicit (AGENTS §9.2). */
  requireSlot?: boolean;
  /** Server start refuses without a valid DM secret (FR-CAMP-01). */
  requireSecret?: boolean;
  /** Resolve relative paths from here instead of the worktree root (tests). */
  root?: string;
}

export const MIN_SECRET_LENGTH = 12;

export function basePort(slot: number): number {
  return 4100 + 10 * slot;
}

export function profilePorts(slot: number, profile: Profile): { port: number; vitePort: number } {
  const base = basePort(slot);
  return profile === "dev"
    ? { port: base, vitePort: base + 1 }
    : { port: base + 2, vitePort: base + 3 };
}

export function parseConfig(
  env: Record<string, string | undefined>,
  opts: ParseOptions = {},
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid environment: ${msg}`);
  }
  const e = parsed.data;
  const root = opts.root ?? WORKTREE_ROOT;

  let profile: Profile = e.PP_PROFILE;
  if (opts.profile !== undefined) {
    if (!(PROFILES as readonly string[]).includes(opts.profile)) {
      throw new ConfigError(`Unknown profile "${opts.profile}" (use ${PROFILES.join(" | ")})`);
    }
    profile = opts.profile as Profile;
  }

  const slot = e.PP_SLOT ?? null;
  const fromSlot = slot === null ? null : profilePorts(slot, profile);
  const portValue = e.PP_PORT ?? fromSlot?.port;
  const vitePortValue = e.PP_VITE_PORT ?? fromSlot?.vitePort;
  if (opts.requireSlot && slot === null && e.PP_PORT === undefined) {
    throw new ConfigError("No port slot (PP_SLOT). Run `bun run env:init`.");
  }

  const dmSecret = e.PP_DM_SECRET ?? "";
  if (opts.requireSecret && dmSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      dmSecret.length === 0
        ? "PP_DM_SECRET is not set. Run `bun run env:init` or set it in .env."
        : `PP_DM_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }

  if (e.PP_TEST_MODE && !e.PP_DATA_DISPOSABLE) {
    throw new ConfigError("PP_TEST_MODE=1 requires PP_DATA_DISPOSABLE=1.");
  }
  if (e.PP_TEST_CRASH !== undefined && !(e.PP_TEST_MODE && e.PP_DATA_DISPOSABLE)) {
    throw new ConfigError("PP_TEST_CRASH requires PP_TEST_MODE=1 and PP_DATA_DISPOSABLE=1.");
  }
  const testCrash = e.PP_TEST_CRASH === undefined ? null : parseCrashSpec(e.PP_TEST_CRASH);

  const resolve = (p: string) => (path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p));
  const dataDir = resolve(e.PP_DATA_DIR ?? path.join("data", profile));

  return {
    root,
    slot,
    profile,
    host: e.PP_HOST,
    port: portValue ?? 0,
    vitePort: vitePortValue ?? 0,
    dataDir,
    dbPath: e.PP_DB_PATH ? resolve(e.PP_DB_PATH) : path.join(dataDir, "pocket-plane.db"),
    assetDir: e.PP_ASSET_DIR ? resolve(e.PP_ASSET_DIR) : path.join(dataDir, "assets"),
    disposable: e.PP_DATA_DISPOSABLE,
    testMode: e.PP_TEST_MODE,
    testCrash,
    dmSecret,
    publicBaseUrl: e.PP_PUBLIC_BASE_URL ?? null,
    logLevel: e.PP_LOG_LEVEL,
  };
}

/** Reads process.env (Bun auto-loads `<worktree>/.env`). */
export function loadConfig(opts: ParseOptions = {}): Config {
  return parseConfig(process.env, opts);
}

/** `--profile <name>` from argv, if given. */
export function profileArg(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--profile");
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new ConfigError("--profile needs a value");
  return v;
}

/** Fixture guard roots: `<worktree>/data/` and the OS temp dir (AGENTS §9.3). */
export function disposableRoots(root: string = WORKTREE_ROOT): string[] {
  return [path.join(root, "data"), os.tmpdir()];
}

/** Printed URLs always use 127.0.0.1, never localhost (AGENTS §9.2). */
export function localUrl(host: string, p: number): string {
  const h = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${h.includes(":") ? `[${h}]` : h}:${p}`;
}

// ---------- real campaigns: `bun run play` (#382) ----------

/** Default `bun run play` port: outside the worktree slot range 4100-4599 (AGENTS §9.2). */
export const PLAY_DEFAULT_PORT = 4090;

export interface PlayDirs {
  /** Live data root (DB, assets, server.lock): outside the checkout and the OS temp dir. */
  dataDir: string;
  /** `PP_PLAY_BACKUP_DIR`, default `<dataDir>/backups`. */
  backupDir: string;
  port: number;
}

export interface PlayResolveOptions {
  platform?: NodeJS.Platform;
  home?: string;
  tmp?: string;
  /** Checkout root: relative overrides resolve from here; anything inside it is refused. */
  root?: string;
}

/** The OS per-user data location for real campaigns (#382). */
export function defaultPlayDataDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  home: string,
): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  const set = (v: string | undefined) => (v && p.isAbsolute(v) ? v : undefined);
  if (platform === "win32") {
    return p.join(set(env.LOCALAPPDATA) ?? p.join(home, "AppData", "Local"), "PocketPlane");
  }
  if (platform === "darwin") return p.join(home, "Library", "Application Support", "PocketPlane");
  return p.join(set(env.XDG_DATA_HOME) ?? p.join(home, ".local", "share"), "pocket-plane");
}

/** `child` is `parent` or inside it (case-insensitive on Windows). */
export function isWithin(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const p = platform === "win32" ? path.win32 : path.posix;
  const norm = (v: string) => (platform === "win32" ? p.resolve(v).toLowerCase() : p.resolve(v));
  const rel = p.relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
}

/**
 * Pure play-dir resolver shared by `bun run play`, `mcp --play` and `mcp:call --play` (#382):
 * `PP_PLAY_DATA_DIR`, else the OS default. Throws ConfigError for a dir inside the checkout
 * (a public repo; its data/ is disposable) or the OS temp dir.
 */
export function resolvePlayDirs(
  env: Record<string, string | undefined>,
  opts: PlayResolveOptions = {},
): PlayDirs {
  const platform = opts.platform ?? process.platform;
  const p = platform === "win32" ? path.win32 : path.posix;
  const root = opts.root ?? WORKTREE_ROOT;
  const tmp = opts.tmp ?? os.tmpdir();
  const value = (k: string) => {
    const v = env[k]?.trim();
    return v ? v : undefined;
  };
  const resolve = (v: string) => (p.isAbsolute(v) ? p.normalize(v) : p.resolve(root, v));

  const override = value("PP_PLAY_DATA_DIR");
  const dataDir = override
    ? resolve(override)
    : defaultPlayDataDir(env, platform, opts.home ?? os.homedir());
  for (const [label, refused, why] of [
    ["inside the checkout", root, "live campaign data must stay out of the repo"],
    ["under the OS temp dir", tmp, "it may be wiped"],
  ] as const) {
    if (isWithin(dataDir, refused, platform)) {
      throw new ConfigError(
        `Refusing: play data dir ${dataDir} is ${label} (${refused}): ${why}. Set PP_PLAY_DATA_DIR to a folder outside it. Nothing changed.`,
      );
    }
  }

  const backup = value("PP_PLAY_BACKUP_DIR");
  const rawPort = value("PP_PLAY_PORT");
  const port = rawPort === undefined ? PLAY_DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`PP_PLAY_PORT "${rawPort}" is not a port (0-65535).`);
  }
  return { dataDir, backupDir: backup ? resolve(backup) : p.join(dataDir, "backups"), port };
}
