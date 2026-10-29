// Backups on each `bun run play` start (#382), before the server opens the DB: a consistent
// copy of the DB via `VACUUM INTO` (newest `keep` kept) and an add-only mirror of the assets.
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import path from "node:path";

export const BACKUP_KEEP = 10;
const BACKUP_NAME = /^pocket-plane-\d{8}-\d{6}(-\d+)?\.db$/;

export class BackupError extends Error {
  override name = "BackupError";
}

export interface BackupResult {
  /** The new DB copy; null when there is no DB yet (first start). */
  db: string | null;
  /** Older copies removed to keep the newest `keep`. */
  pruned: string[];
  /** Asset files copied (new or changed) / already mirrored. */
  assets: { copied: number; unchanged: number };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `pocket-plane-<yyyymmdd-hhmmss>.db`, local time. */
export function backupName(now: Date): string {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pocket-plane-${d}-${t}.db`;
}

export function backupPlayData(opts: {
  dbPath: string;
  assetDir: string;
  backupDir: string;
  now?: Date;
  keep?: number;
}): BackupResult {
  const { dbPath, assetDir, backupDir } = opts;
  const keep = opts.keep ?? BACKUP_KEEP;
  try {
    mkdirSync(backupDir, { recursive: true });
    const db = existsSync(dbPath) ? copyDb(dbPath, backupDir, opts.now ?? new Date()) : null;
    const pruned = db ? prune(backupDir, keep) : [];
    const assets = mirrorAssets(assetDir, path.join(backupDir, "assets"));
    return { db, pruned, assets };
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError((err as Error).message);
  }
}

function copyDb(dbPath: string, backupDir: string, now: Date): string {
  const base = backupName(now).slice(0, -".db".length);
  let target = path.join(backupDir, `${base}.db`);
  for (let i = 2; existsSync(target); i++) target = path.join(backupDir, `${base}-${i}.db`);
  // Written under a temp name and renamed, so a failed copy never counts as a backup.
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const src = new Database(dbPath, { readwrite: true, create: false });
  try {
    src.query("VACUUM INTO ?").run(partial);
  } finally {
    src.close();
  }
  const copy = new Database(partial, { readonly: true });
  let ok: string;
  try {
    ok = String((copy.query("PRAGMA quick_check").get() as Record<string, unknown>).quick_check);
  } finally {
    copy.close();
  }
  if (ok !== "ok") {
    rmSync(partial, { force: true });
    throw new BackupError(`the DB copy failed its integrity check (${ok})`);
  }
  renameSync(partial, target);
  return target;
}

// Newest first by the stamp in the name, then the same-second suffix (-2, -3, …).
const sortKey = (f: string) => {
  const m = BACKUP_NAME.exec(f);
  return `${f.slice(13, 28)}-${(m?.[1]?.slice(1) ?? "1").padStart(4, "0")}`;
};

function prune(backupDir: string, keep: number): string[] {
  const all = readdirSync(backupDir)
    .filter((f) => BACKUP_NAME.test(f))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const old = all.slice(keep).map((f) => path.join(backupDir, f));
  for (const f of old) rmSync(f, { force: true });
  return old;
}

/** Copies files missing in the mirror or differing in size / mtime; never deletes there. */
export function mirrorAssets(from: string, to: string): { copied: number; unchanged: number } {
  const out = { copied: 0, unchanged: 0 };
  if (!existsSync(from)) return out;
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(from, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        walk(r);
        continue;
      }
      if (!e.isFile()) continue;
      const src = path.join(from, r);
      const dst = path.join(to, r);
      const s = statSync(src);
      const d = existsSync(dst) ? statSync(dst) : null;
      if (d && d.size === s.size && Math.trunc(d.mtimeMs) === Math.trunc(s.mtimeMs)) {
        out.unchanged++;
        continue;
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, `${dst}.partial`);
      renameSync(`${dst}.partial`, dst);
      utimesSync(dst, s.atime, s.mtime);
      out.copied++;
    }
  };
  walk("");
  return out;
}
