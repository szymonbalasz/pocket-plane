// `bun run upgrade:check` (BL-173): its pure parts and the temp dir clean-up. The whole check, on
// real trees, is in upgrade-check.slow.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultPlayDataDir, WORKTREE_ROOT } from "../src/server/config";
import {
  annotation,
  bundleChain,
  CannotRun,
  checkDataDir,
  DEFAULT_BUNDLE,
  defaultBaseRef,
  invalidRows,
  linkTokens,
  lostRows,
  parseArgs,
  refusalIn,
  removeTemp,
} from "./upgrade-check";

describe("BL-173 arguments", () => {
  test("BL-173 defaults, and each flag", () => {
    expect(parseArgs([])).toEqual({
      bundle: DEFAULT_BUNDLE,
      proveRefusal: false,
    });
    const a = parseArgs(["--base=abc", "--bundle=combat", "--data-dir=data/x", "--prove-refusal"]);
    expect(a).toEqual({
      base: "abc",
      bundle: "combat",
      dataDir: "data/x",
      proveRefusal: true,
    });
  });

  test("BL-173 an unknown argument is a usage error", () => {
    expect(() => parseArgs(["--nope"])).toThrow(CannotRun);
    expect(() => parseArgs(["--base="])).toThrow(CannotRun);
  });
});

describe("BL-173 the bundle", () => {
  test("BL-173 N7 the default is session-sim-18; an older base falls back to sim-17, then base", () => {
    expect(DEFAULT_BUNDLE).toBe("session-sim-18");
    expect(bundleChain(DEFAULT_BUNDLE)).toEqual(["session-sim-18", "session-sim-17", "base"]);
    expect(bundleChain("session-sim-17")).toEqual(["session-sim-17", "base"]);
    expect(bundleChain("base")).toEqual(["base", "session-sim-17"]);
    expect(bundleChain("combat")).toEqual(["combat", "session-sim-17", "base"]);
  });
});

describe("BL-173 the default base", () => {
  test("BL-173 a branch uses its merge base with origin/main", () => {
    expect(defaultBaseRef("fix/x", "head", "mb")).toBe("mb");
  });

  test("BL-173 main uses the previous commit, whatever the merge base", () => {
    expect(defaultBaseRef("main", "head", "head")).toBe("head^1");
    expect(defaultBaseRef("main", "head", null)).toBe("head^1");
  });

  test("BL-173 a branch with nothing of its own uses the previous commit", () => {
    expect(defaultBaseRef("fix/x", "head", "head")).toBe("head^1");
  });

  test("BL-173 no merge base asks for --base", () => {
    expect(() => defaultBaseRef("fix/x", "head", null)).toThrow(/--base/);
  });
});

describe("BL-173 the real campaign is off limits", () => {
  const env = {
    LOCALAPPDATA: path.join(os.homedir(), "AppData", "Local"),
    XDG_DATA_HOME: path.join(os.homedir(), ".local", "share"),
  };

  test("BL-173 the OS temp dir and the worktree's data/ are allowed", () => {
    expect(() => checkDataDir(path.join(os.tmpdir(), "pp-x"), env)).not.toThrow();
    expect(() => checkDataDir(path.join(WORKTREE_ROOT, "data", "x"), env)).not.toThrow();
  });

  test("BL-173 anywhere else is refused", () => {
    expect(() => checkDataDir(path.join(os.homedir(), "somewhere"), env)).toThrow(
      /only runs under/,
    );
    expect(() => checkDataDir(path.join(WORKTREE_ROOT, "src"), env)).toThrow(/only runs under/);
  });

  test("BL-173 the default play dir is refused", () => {
    const play = defaultPlayDataDir(env, process.platform, os.homedir());
    expect(() => checkDataDir(play, env)).toThrow(/real campaign/);
    expect(() => checkDataDir(path.join(play, "backups"), env)).toThrow(/real campaign/);
  });

  test("BL-173 a play or backup dir set under temp or data/ is still refused", () => {
    const inTemp = path.join(os.tmpdir(), "pp-a-play-dir");
    const inData = path.join(WORKTREE_ROOT, "data", "a-backup-dir");
    const set = { ...env, PP_PLAY_DATA_DIR: inTemp, PP_PLAY_BACKUP_DIR: inData };
    expect(() => checkDataDir(inTemp, set)).toThrow(/real campaign/);
    expect(() => checkDataDir(path.join(inData, "x"), set)).toThrow(/real campaign/);
  });
});

describe("BL-173 lost rows", () => {
  test("BL-173 a populated table with fewer rows, or gone, is lost; more or the same is not", () => {
    expect(
      lostRows({ a: 3, b: 3, c: 3, d: 3, e: 0 }, { a: 3, b: 4, c: 2, f: 9 }, {}).sort(),
    ).toEqual(["c: 3 rows before, 2 after", "d: 3 rows before, the table is gone"]);
  });

  test("BL-173 an empty table may go", () => {
    expect(lostRows({ a: 0 }, {}, {})).toEqual([]);
  });

  test("BL-173 a table moved at boot may empty (ADR-0076's old explored memory)", () => {
    expect(lostRows({ fog_explored: 5 }, { fog_explored: 0 })).toEqual([]);
    expect(lostRows({ other: 5 }, { other: 0 })).toEqual(["other: 5 rows before, 0 after"]);
  });
});

describe("BL-173 reading what the server said", () => {
  test("BL-173 a player token comes from a link, with or without a base URL", () => {
    expect(
      linkTokens({
        playerLinks: [{ url: "/p/abc" }, { url: "https://x.test/p/def?y=1" }, { url: "/nope" }],
      }),
    ).toEqual(["abc", "def"]);
    expect(linkTokens({})).toEqual([]);
  });

  test("BL-173 the refusal is every line from `Cannot start:` on", () => {
    expect(
      refusalIn([
        "WARN something",
        "12:00 Cannot start: Schema change refused",
        "  table t",
        "Fix",
      ]),
    ).toBe("Cannot start: Schema change refused\n  table t\nFix");
    expect(refusalIn(["no refusal"])).toBeNull();
  });

  test("BL-173 an annotation keeps its lines", () => {
    expect(annotation("t", "50% a\nb\r\nc")).toBe("::error title=t::50%25 a%0Ab%0D%0Ac");
  });
});

describe("BL-173 snapshot rows", () => {
  const schema = {
    safeParse: (v: unknown) =>
      typeof v === "object" && v && "id" in v
        ? { success: true }
        : { success: false, error: "no id" },
  };
  const defs = {
    get: (type: string) =>
      (
        ({
          good: { schema },
          reshaped: { schema, redact: () => null },
          stripped: { schema, dmRedact: () => null },
        }) as Record<string, { schema: typeof schema }>
      )[type],
  };

  test("BL-173 rows that match their schema pass", () => {
    expect(invalidRows({ records: { good: [{ id: 1 }], reshaped: [{}] } }, defs, "DM")).toEqual([]);
  });

  test("BL-173 a reshaped type has no schema to meet", () => {
    expect(invalidRows({ records: { reshaped: [{}], stripped: [{}] } }, defs, "DM")).toEqual([]);
  });

  test("BL-173 a row that doesn't match, and an unknown type, are named", () => {
    const out = invalidRows({ records: { good: [{ id: 1 }, {}], mystery: [] } }, defs, "player");
    expect(out).toEqual([
      "player: 1 of 2 good row(s) don't match the schema: no id",
      "player: unknown record type mystery",
    ]);
  });
});

describe("BL-173 temp dir clean-up", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pp-upgrade-test-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("BL-173 the link to node_modules goes without touching what it points at", () => {
    const target = path.join(root, "target");
    mkdirSync(target);
    writeFileSync(path.join(target, "keep.txt"), "x");
    const temp = path.join(root, "temp");
    mkdirSync(path.join(temp, "tree"), { recursive: true });
    writeFileSync(path.join(temp, "tree", "file.txt"), "x");
    symlinkSync(target, path.join(temp, "tree", "node_modules"), "junction");

    expect(removeTemp(temp)).toBeNull();
    expect(existsSync(temp)).toBe(false);
    expect(existsSync(path.join(target, "keep.txt"))).toBe(true);
  });

  test("BL-173 a dir already gone, or with installed dependencies, is fine", () => {
    expect(removeTemp(path.join(root, "never-there"))).toBeNull();
    const temp = path.join(root, "installed");
    mkdirSync(path.join(temp, "tree", "node_modules", "x"), { recursive: true });
    expect(removeTemp(temp)).toBeNull();
    expect(existsSync(temp)).toBe(false);
  });
});
