import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { BackupError, backupName, backupPlayData, mirrorAssets } from "./play-backup";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "pp-play-backup-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A WAL-mode DB left open (like a running server's), so rows sit in the -wal file. */
function liveDb(file: string, rows: number): Database {
  const db = new Database(file, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.query("INSERT INTO t (v) VALUES (?)");
  for (let i = 0; i < rows; i++) ins.run(`row-${i}`);
  return db;
}

const at = (s: number) => new Date(2026, 9, 29, 20, 15, s);

describe("play backups (#382)", () => {
  test("#382 VACUUM INTO copy opens and matches the row counts, WAL included", () => {
    const d = scratch();
    const dbPath = path.join(d, "pocket-plane.db");
    const live = liveDb(dbPath, 25);
    try {
      const r = backupPlayData({
        dbPath,
        assetDir: path.join(d, "assets"),
        backupDir: path.join(d, "backups"),
        now: at(7),
      });
      expect(path.basename(r.db ?? "")).toBe("pocket-plane-20261029-201507.db");
      const copy = new Database(r.db as string, { readonly: true });
      expect((copy.query("SELECT count(*) AS n FROM t").get() as { n: number }).n).toBe(25);
      copy.close();
      expect(readdirSync(path.join(d, "backups")).filter((f) => f.endsWith(".partial"))).toEqual(
        [],
      );
    } finally {
      live.close();
    }
  });

  test("#382 no DB yet: no copy, nothing created next to the missing DB", () => {
    const d = scratch();
    const r = backupPlayData({
      dbPath: path.join(d, "pocket-plane.db"),
      assetDir: path.join(d, "assets"),
      backupDir: path.join(d, "backups"),
    });
    expect(r.db).toBeNull();
    expect(readdirSync(d)).toEqual(["backups"]);
  });

  test("#382 keeps the newest 10 copies; same-second starts get a suffix", () => {
    const d = scratch();
    const dbPath = path.join(d, "pocket-plane.db");
    liveDb(dbPath, 1).close();
    const backupDir = path.join(d, "backups");
    mkdirSync(backupDir);
    writeFileSync(path.join(backupDir, "notes.txt"), "not a backup");
    for (let s = 0; s < 12; s++) {
      backupPlayData({ dbPath, assetDir: path.join(d, "assets"), backupDir, now: at(s) });
    }
    const again = backupPlayData({ dbPath, assetDir: "", backupDir, now: at(11) });
    expect(path.basename(again.db ?? "")).toBe("pocket-plane-20261029-201511-2.db");
    const left = readdirSync(backupDir)
      .filter((f) => f.endsWith(".db"))
      .sort();
    expect(left).toHaveLength(10);
    expect(left[0]).toBe("pocket-plane-20261029-201503.db");
    expect(left.at(-1)).toBe("pocket-plane-20261029-201511.db");
    expect(left).toContain("pocket-plane-20261029-201511-2.db");
    expect(readdirSync(backupDir)).toContain("notes.txt");
    expect(backupName(at(5))).toBe("pocket-plane-20261029-201505.db");
  });

  test("#382 assets mirror copies new / changed files only and never deletes", () => {
    const d = scratch();
    const from = path.join(d, "assets");
    const to = path.join(d, "backups", "assets");
    mkdirSync(path.join(from, "ab"), { recursive: true });
    writeFileSync(path.join(from, "ab", "one.webp"), "one");
    writeFileSync(path.join(from, "two.webp"), "two");
    expect(mirrorAssets(from, to)).toEqual({ copied: 2, unchanged: 0 });
    expect(mirrorAssets(from, to)).toEqual({ copied: 0, unchanged: 2 });

    writeFileSync(path.join(from, "three.webp"), "three");
    writeFileSync(path.join(from, "two.webp"), "two, edited");
    rmSync(path.join(from, "ab", "one.webp"));
    expect(mirrorAssets(from, to)).toEqual({ copied: 2, unchanged: 0 });
    expect(readFileSync(path.join(to, "two.webp"), "utf8")).toBe("two, edited");
    expect(readFileSync(path.join(to, "ab", "one.webp"), "utf8")).toBe("one");

    // Same size, newer mtime → copied again.
    writeFileSync(path.join(from, "three.webp"), "THREE");
    utimesSync(path.join(from, "three.webp"), new Date(), new Date(Date.now() + 60_000));
    expect(mirrorAssets(from, to)).toEqual({ copied: 1, unchanged: 1 });
    expect(mirrorAssets(path.join(d, "missing"), to)).toEqual({ copied: 0, unchanged: 0 });
  });

  test("#382 a failed backup throws BackupError with the reason", () => {
    const d = scratch();
    const dbPath = path.join(d, "pocket-plane.db");
    liveDb(dbPath, 1).close();
    const blocker = path.join(d, "backups");
    writeFileSync(blocker, "a file where the backup dir should be");
    expect(() => backupPlayData({ dbPath, assetDir: "", backupDir: blocker })).toThrow(BackupError);
    // Not a database: VACUUM INTO fails, nothing counts as a backup.
    const bad = path.join(d, "bad.db");
    writeFileSync(bad, "not sqlite at all, just text that is long enough to be read as a header");
    const out = path.join(d, "out");
    expect(() => backupPlayData({ dbPath: bad, assetDir: "", backupDir: out })).toThrow(
      BackupError,
    );
    expect(readdirSync(out)).toEqual([]);
  });
});
