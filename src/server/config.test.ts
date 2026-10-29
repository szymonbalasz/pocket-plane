import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import {
  ConfigError,
  formatCrashSpec,
  PLAY_DEFAULT_PORT,
  parseConfig,
  profileArg,
  resolvePlayDirs,
} from "./config";

const SECRET = "a-dm-secret-123";
const root = path.join(os.tmpdir(), "pp-config-test");

describe("parseConfig", () => {
  test("slot + profile give ports (AGENTS §9.2)", () => {
    const dev = parseConfig({ PP_SLOT: "3", PP_DM_SECRET: SECRET }, { root });
    expect(dev.port).toBe(4130);
    expect(dev.vitePort).toBe(4131);
    const verify = parseConfig({ PP_SLOT: "3", PP_DM_SECRET: SECRET }, { root, profile: "verify" });
    expect(verify.port).toBe(4132);
    expect(verify.dataDir).toBe(path.join(root, "data", "verify"));
  });

  test("explicit ports override the slot; 0 = OS-assigned", () => {
    const c = parseConfig({ PP_SLOT: "1", PP_PORT: "0" }, { root });
    expect(c.port).toBe(0);
  });

  test("no slot → refuses when a slot is required", () => {
    expect(() => parseConfig({}, { requireSlot: true })).toThrow(/env:init/);
    expect(parseConfig({ PP_PORT: "0" }, { requireSlot: true }).port).toBe(0);
  });

  test("FR-CAMP-01 refuses to start without a DM secret of ≥ 12 chars", () => {
    expect(() => parseConfig({ PP_SLOT: "0" }, { requireSecret: true })).toThrow(ConfigError);
    expect(() =>
      parseConfig({ PP_SLOT: "0", PP_DM_SECRET: "short" }, { requireSecret: true }),
    ).toThrow(/12/);
    expect(
      parseConfig({ PP_SLOT: "0", PP_DM_SECRET: SECRET }, { requireSecret: true }).dmSecret,
    ).toBe(SECRET);
  });

  test("test mode requires a disposable data dir", () => {
    expect(() => parseConfig({ PP_TEST_MODE: "1" })).toThrow(/PP_DATA_DISPOSABLE/);
    const c = parseConfig({ PP_TEST_MODE: "1", PP_DATA_DISPOSABLE: "1" });
    expect(c.testMode).toBe(true);
    expect(c.disposable).toBe(true);
  });

  test("PP_TEST_CRASH (#163): parsed only with test mode + disposable; malformed refused", () => {
    const on = { PP_TEST_MODE: "1", PP_DATA_DISPOSABLE: "1" };
    expect(parseConfig(on).testCrash).toBeNull();
    expect(() => parseConfig({ PP_TEST_CRASH: "cbt.applyCard:before-commit" })).toThrow(
      /PP_TEST_CRASH requires PP_TEST_MODE=1 and PP_DATA_DISPOSABLE=1/,
    );
    expect(() =>
      parseConfig({ PP_DATA_DISPOSABLE: "1", PP_TEST_CRASH: "cbt.applyCard:after-commit" }),
    ).toThrow(/PP_TEST_CRASH requires/);
    const crash = (v: string) => parseConfig({ ...on, PP_TEST_CRASH: v }).testCrash;
    expect(crash("cbt.applyCard:before-commit")).toEqual({
      point: "before-commit",
      target: "cbt.applyCard",
    });
    expect(crash("sync-probe.set:after-commit")).toEqual({
      point: "after-commit",
      target: "sync-probe.set",
    });
    expect(crash("assets.ingest:after-files")).toEqual({
      point: "after-files",
      target: "assets.ingest",
    });
    expect(crash("fixture:enemy-1")).toEqual({ point: "fixture", target: "enemy-1" });
    expect(crash(" ")).toBeNull();
    for (const bad of [
      "cbt.applyCard",
      "cbt.applyCard:during",
      "map.moveToken:after-files",
      "fixture:",
      "fixture:Bad Key",
      "nodot:before-commit",
    ]) {
      expect(() => crash(bad)).toThrow(ConfigError);
    }
    expect(formatCrashSpec({ point: "fixture", target: "enemy-1" })).toBe("fixture:enemy-1");
    expect(formatCrashSpec({ point: "after-commit", target: "loot.move" })).toBe(
      "loot.move:after-commit",
    );
  });

  test("relative paths resolve from the worktree root, not the cwd", () => {
    const c = parseConfig({ PP_DATA_DIR: "data/x", PP_DB_PATH: "data/x/a.db" }, { root });
    expect(c.dataDir).toBe(path.join(root, "data", "x"));
    expect(c.dbPath).toBe(path.join(root, "data", "x", "a.db"));
    expect(c.assetDir).toBe(path.join(root, "data", "x", "assets"));
  });

  test("unknown profile and bad values are rejected", () => {
    expect(() => parseConfig({}, { profile: "prod" })).toThrow(/profile/);
    expect(() => parseConfig({ PP_SLOT: "50" })).toThrow(ConfigError);
    expect(() => parseConfig({ PP_PUBLIC_BASE_URL: "not a url" })).toThrow(ConfigError);
  });

  test("profileArg reads --profile", () => {
    expect(profileArg(["bun", "x", "--profile", "verify"])).toBe("verify");
    expect(profileArg(["bun", "x"])).toBeUndefined();
  });
});

describe("resolvePlayDirs (#382)", () => {
  const W = (p: string) => path.win32.join(p);
  const win = {
    platform: "win32" as const,
    home: W("C:/Users/dm"),
    tmp: W("C:/Users/dm/AppData/Local/Temp"),
    root: W("C:/src/pocket-plane"),
  };
  const linux = {
    platform: "linux" as const,
    home: "/home/dm",
    tmp: "/tmp",
    root: "/src/pocket-plane",
  };
  const mac = {
    platform: "darwin" as const,
    home: "/Users/dm",
    tmp: "/var/folders/xy/T",
    root: "/src/pocket-plane",
  };

  test("#382 OS per-user defaults, backups under the play dir, port 4090", () => {
    const w = resolvePlayDirs({ LOCALAPPDATA: W("C:/Users/dm/AppData/Local") }, win);
    expect(w.dataDir).toBe(W("C:/Users/dm/AppData/Local/PocketPlane"));
    expect(w.backupDir).toBe(W("C:/Users/dm/AppData/Local/PocketPlane/backups"));
    expect(w.port).toBe(PLAY_DEFAULT_PORT);
    expect(PLAY_DEFAULT_PORT).toBe(4090);
    // No LOCALAPPDATA: the same folder from the home dir.
    expect(resolvePlayDirs({}, win).dataDir).toBe(W("C:/Users/dm/AppData/Local/PocketPlane"));
    expect(resolvePlayDirs({}, mac).dataDir).toBe(
      "/Users/dm/Library/Application Support/PocketPlane",
    );
    expect(resolvePlayDirs({}, linux).dataDir).toBe("/home/dm/.local/share/pocket-plane");
    expect(resolvePlayDirs({ XDG_DATA_HOME: "/data/xdg" }, linux).dataDir).toBe(
      "/data/xdg/pocket-plane",
    );
    // A relative XDG_DATA_HOME is invalid per the XDG spec: ignored.
    expect(resolvePlayDirs({ XDG_DATA_HOME: "rel" }, linux).dataDir).toBe(
      "/home/dm/.local/share/pocket-plane",
    );
  });

  test("#382 PP_PLAY_DATA_DIR / PP_PLAY_BACKUP_DIR / PP_PLAY_PORT override", () => {
    const d = resolvePlayDirs(
      {
        PP_PLAY_DATA_DIR: "/srv/campaigns",
        PP_PLAY_BACKUP_DIR: "/cloud/pp-backups",
        PP_PLAY_PORT: "4095",
      },
      linux,
    );
    expect(d).toEqual({ dataDir: "/srv/campaigns", backupDir: "/cloud/pp-backups", port: 4095 });
    // Relative overrides resolve from the checkout root, like every PP_* path.
    expect(resolvePlayDirs({ PP_PLAY_DATA_DIR: "../play" }, linux).dataDir).toBe("/src/play");
    expect(resolvePlayDirs({ PP_PLAY_DATA_DIR: "  " }, linux).dataDir).toBe(
      "/home/dm/.local/share/pocket-plane",
    );
    expect(() => resolvePlayDirs({ PP_PLAY_PORT: "nope" }, linux)).toThrow(/PP_PLAY_PORT/);
    expect(() => resolvePlayDirs({ PP_PLAY_PORT: "70000" }, linux)).toThrow(ConfigError);
  });

  test("#382 refuses a play dir under the checkout's data/ or the OS temp dir", () => {
    for (const dir of ["data", "data/dev", "/src/pocket-plane/data/play"]) {
      expect(() => resolvePlayDirs({ PP_PLAY_DATA_DIR: dir }, linux)).toThrow(/data\/ folder/);
    }
    for (const dir of ["/tmp", "/tmp/pp"]) {
      expect(() => resolvePlayDirs({ PP_PLAY_DATA_DIR: dir }, linux)).toThrow(/temp dir/);
    }
    // Windows compares case-insensitively.
    expect(() =>
      resolvePlayDirs({ PP_PLAY_DATA_DIR: W("c:/users/DM/appdata/local/temp/x") }, win),
    ).toThrow(/temp dir/);
    expect(() => resolvePlayDirs({ PP_PLAY_DATA_DIR: W("C:/SRC/pocket-plane/Data") }, win)).toThrow(
      /data\/ folder/,
    );
    // Siblings with a shared prefix are fine.
    expect(resolvePlayDirs({ PP_PLAY_DATA_DIR: "/tmpx/pp" }, linux).dataDir).toBe("/tmpx/pp");
    expect(resolvePlayDirs({ PP_PLAY_DATA_DIR: "/src/pocket-plane/database" }, linux).dataDir).toBe(
      "/src/pocket-plane/database",
    );
  });
});
