import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { ConfigError, parseConfig, profileArg } from "./config";

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
