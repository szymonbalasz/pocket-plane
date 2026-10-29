// `bun run play` (#382): test-flag refusal, the server env, an in-process start on a play dir,
// a backup of the server's real DB, and the fixture guards refusing the play dir.
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError, PLAY_DEFAULT_PORT, parseConfig } from "../src/server/config";
import { checkGuards } from "../src/server/features/fixtures-adapters/loader";
import { silentLogger } from "../src/server/log";
import { readLock } from "../src/server/runtime/lock";
import { startServer } from "../src/server/server";
import { checkPlayEnv, playServerEnv } from "./lib/play";
import { backupPlayData } from "./lib/play-backup";

const SECRET = "play-test-secret-123";
// What a worktree's `.env` holds (env:init): the play env must override all of it.
const WORKTREE_ENV = {
  PP_SLOT: "3",
  PP_PROFILE: "verify",
  PP_DATA_DIR: "data/dev",
  PP_DB_PATH: "data/dev/other.db",
  PP_ASSET_DIR: "data/dev/assets",
  PP_DATA_DISPOSABLE: "1",
  PP_DM_SECRET: SECRET,
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("bun run play (#382)", () => {
  test("#382 refuses PP_TEST_MODE / PP_TEST_CRASH", () => {
    expect(() => checkPlayEnv({ PP_TEST_MODE: "1" })).toThrow(/PP_TEST_MODE/);
    expect(() => checkPlayEnv({ PP_TEST_CRASH: "cbt.applyCard:after-commit" })).toThrow(
      ConfigError,
    );
    expect(() => checkPlayEnv({ PP_TEST_MODE: "0", PP_TEST_CRASH: " " })).not.toThrow();
  });

  test("#382 server env: play dir, not disposable, no test mode, play port, slot ignored", () => {
    const dataDir = path.join(os.homedir(), "pp-play-env-test");
    const env = playServerEnv(WORKTREE_ENV, {
      dataDir,
      backupDir: path.join(dataDir, "backups"),
      port: PLAY_DEFAULT_PORT,
    });
    const c = parseConfig(env, { requireSlot: true, requireSecret: true });
    expect(c.dataDir).toBe(dataDir);
    expect(c.dbPath).toBe(path.join(dataDir, "pocket-plane.db"));
    expect(c.assetDir).toBe(path.join(dataDir, "assets"));
    expect(c.port).toBe(4090);
    expect(c.disposable).toBe(false);
    expect(c.testMode).toBe(false);
    expect(c.testCrash).toBeNull();
    expect(c.host).toBe("127.0.0.1");
    // FR-FIX-02: `fixtures:reset --profile dev` with PP_DATA_DIR = the play dir refuses,
    // even where the worktree's `.env` says disposable.
    expect(() =>
      checkGuards(parseConfig({ ...WORKTREE_ENV, PP_DATA_DIR: dataDir }, { profile: "dev" })),
    ).toThrow(/not under/);
    expect(() => checkGuards(c)).toThrow(/not flagged disposable/);
  });

  test("#382 start-up: real server on the play dir (port 0), restart keeps data, backup of its DB", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "pp-play-start-"));
    dirs.push(dataDir);
    const env = playServerEnv(WORKTREE_ENV, {
      dataDir,
      backupDir: path.join(dataDir, "backups"),
      port: 0,
    });
    const config = parseConfig(env, { requireSlot: true, requireSecret: true });
    const auth = { authorization: `Bearer ${SECRET}`, "content-type": "application/json" };

    const first = await startServer({ config, log: silentLogger });
    try {
      expect(readLock(dataDir)).toMatchObject({ owner: "server", port: first.port });
      const r = await fetch(`${first.url}/api/campaigns`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Real Campaign" }),
      });
      expect(r.status).toBeLessThan(300);
    } finally {
      first.stopSync();
    }
    expect(existsSync(path.join(dataDir, "server.lock"))).toBe(false);

    const b = backupPlayData({
      dbPath: config.dbPath,
      assetDir: config.assetDir,
      backupDir: path.join(dataDir, "backups"),
    });
    const count = (file: string) => {
      const db = new Database(file, { readonly: true });
      const n = (db.query("SELECT count(*) AS n FROM campaign").get() as { n: number }).n;
      db.close();
      return n;
    };
    expect(count(b.db as string)).toBe(count(config.dbPath));
    expect(count(b.db as string)).toBe(1);

    const second = await startServer({ config, log: silentLogger });
    try {
      const r = await fetch(`${second.url}/api/campaigns`, { headers: auth });
      expect(JSON.stringify(await r.json())).toContain("Real Campaign");
    } finally {
      second.stopSync();
    }
    expect(readdirSync(path.join(dataDir, "backups")).some((f) => f.endsWith(".db"))).toBe(true);
  }, 30_000);
});
