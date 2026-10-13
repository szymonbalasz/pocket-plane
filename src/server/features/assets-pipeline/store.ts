// Asset file store (FR-ASSET-04, -07): one file set per hash under PP_ASSET_DIR,
// `<hash>/{original, display.webp, thumb.webp}`; temp dir + rename; start-up sweep.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AssetFile } from "@shared/assets-pipeline/schemas";
import { crashPoint } from "../../commands/crash";
import type { Db } from "../../db/client";
import { dbId } from "../../db/meta";
import { asset } from "../../db/schema";
import type { Logger } from "../../log";
import type { ProcessedImage } from "./image";

const HASH = /^[0-9a-f]{64}$/;
const TMP = ".tmp";
/** Marker file: the id of the DB this asset dir belongs to (#163). */
export const DB_MARKER = ".pocket-plane-db";
const FILES = ["original", "display.webp", "thumb.webp"] as const;
const SERVED: Record<AssetFile, string> = { display: "display.webp", thumb: "thumb.webp" };

/**
 * Directory rename with retries: on Windows a just-written dir can be briefly locked (virus
 * scanner, indexer) and rename fails with EPERM / EACCES / EBUSY. Same approach as graceful-fs.
 */
function renameDirSync(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!transient || attempt >= 20) throw err;
      Bun.sleepSync(Math.min(10 * (attempt + 1), 100));
    }
  }
}

/** Write + fsync (#163): the files are on disk before the row that points at them commits. */
function writeDurable(file: string, data: Uint8Array): void {
  const fd = openSync(file, "w");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * fsync a directory so a create / rename in it is durable. Windows opens directories only
 * read-write; platforms that can't fsync a directory (EPERM / EISDIR / EINVAL) are skipped.
 */
export function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, process.platform === "win32" ? "r+" : "r");
  } catch (err) {
    if (skippable(err)) return;
    throw err;
  }
  try {
    fsyncSync(fd);
  } catch (err) {
    if (!skippable(err)) throw err;
  } finally {
    closeSync(fd);
  }
}

const skippable = (err: unknown) => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EISDIR" || code === "EINVAL" || code === "EACCES";
};

const stores = new WeakMap<object, AssetStore>();

/** The store of a server instance (set at feature registration). */
export function assetStoreOf(s: object): AssetStore {
  const st = stores.get(s);
  if (!st) throw new Error("assets-pipeline is not registered on these services");
  return st;
}

export function bindAssetStore(s: object, st: AssetStore): void {
  stores.set(s, st);
}

export class AssetStore {
  /** Test seam: runs after the files are in place, before the row is written (FR-ASSET-06). */
  afterFilesWritten: (() => void) | null = null;

  constructor(
    readonly dir: string,
    private readonly log: Logger,
  ) {}

  hashDir(hash: string): string {
    if (!HASH.test(hash)) throw new Error("Invalid asset hash");
    return path.join(this.dir, hash);
  }

  /** Path of a servable file; `hash` is from the DB, `file` zod-validated: never request text. */
  filePath(hash: string, file: AssetFile): string {
    return path.join(this.hashDir(hash), SERVED[file]);
  }

  /** FR-ASSET-07: an asset missing any file serves none of them. */
  isComplete(hash: string): boolean {
    const dir = this.hashDir(hash);
    return FILES.every((f) => existsSync(path.join(dir, f)));
  }

  /**
   * FR-ASSET-04: write the set to a temp dir, then rename into place. An existing hash dir is
   * reused untouched. Synchronous: runs inside the ingest transaction, before the row insert.
   */
  ensureFiles(img: ProcessedImage): void {
    const target = this.hashDir(img.hash);
    if (!existsSync(target)) {
      const tmp = path.join(this.dir, TMP, img.hash);
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      writeDurable(path.join(tmp, "original"), img.original);
      writeDurable(path.join(tmp, "display.webp"), img.display.data);
      writeDurable(path.join(tmp, "thumb.webp"), img.thumb.data);
      fsyncDir(tmp);
      renameDirSync(tmp, target);
      // The rename itself: the hash dir and its entry in the asset dir (#163).
      fsyncDir(target);
      fsyncDir(this.dir);
    }
    this.afterFilesWritten?.();
    crashPoint("after-files", "assets.ingest"); // test-mode crash hook (#163)
  }

  /**
   * Re-upload of an asset whose files went missing (#163): drop the partial set, write it again.
   * The row is unchanged; its files serve again.
   */
  repairFiles(img: ProcessedImage): void {
    if (this.isComplete(img.hash)) return;
    rmSync(this.hashDir(img.hash), { recursive: true, force: true });
    this.ensureFiles(img);
    this.log.warn(`asset store: rewrote the missing files for hash ${img.hash}`);
  }

  /**
   * The asset dir's DB marker (#163). Missing → written (fresh dir, or one from before the
   * marker); another DB's id → false: this dir is not ours.
   */
  claim(id: string): boolean {
    const file = path.join(this.dir, DB_MARKER);
    if (existsSync(file)) return readFileSync(file, "utf8").trim() === id;
    writeDurable(file, new TextEncoder().encode(`${id}\n`));
    return true;
  }

  /**
   * FR-ASSET-07 (server start): delete the temp dir and every hash dir no asset row references;
   * log an error for each asset missing a file (its files then answer 404). Skipped with an
   * error when the asset dir belongs to another DB (#163): its files are not ours to delete.
   */
  sweep(db: Db): { removed: string[]; missing: string[]; skipped: boolean } {
    mkdirSync(this.dir, { recursive: true });
    if (!this.claim(dbId(db))) {
      this.log.error(
        `asset store: ${this.dir} belongs to another DB (${DB_MARKER} differs); start-up sweep skipped. ` +
          "Give each DB its own PP_ASSET_DIR.",
      );
      return { removed: [], missing: [], skipped: true };
    }
    rmSync(path.join(this.dir, TMP), { recursive: true, force: true });
    const rows = db.select({ id: asset.id, hash: asset.hash }).from(asset).all();
    const referenced = new Set(rows.map((r) => r.hash));
    const removed: string[] = [];
    for (const e of readdirSync(this.dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !HASH.test(e.name) || referenced.has(e.name)) continue;
      rmSync(path.join(this.dir, e.name), { recursive: true, force: true });
      removed.push(e.name);
    }
    const missing: string[] = [];
    for (const r of rows) {
      const lost = FILES.filter((f) => !existsSync(path.join(this.dir, r.hash, f)));
      if (lost.length > 0) {
        missing.push(r.id);
        // The asset ID is a capability: log the hash, never the ID (FR-ASSET-12).
        this.log.error(`asset files missing for hash ${r.hash}: ${lost.join(", ")}`);
      }
    }
    if (removed.length > 0)
      this.log.info(`asset store: removed ${removed.length} orphan file set(s)`);
    return { removed, missing, skipped: false };
  }
}
