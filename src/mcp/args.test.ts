// `--play` / `--profile` for `bun run mcp` and `bun run mcp:call` (#382).
import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { WORKTREE_ROOT } from "@server/config";
import { mcpConfig, parseTargetArgs, targetArgs, UsageError } from "./args";
import type { AgentError } from "./errors";
import { findServer } from "./lock";

const SECRET = "mcp-args-secret-123";
const playDir = path.join(os.homedir(), "pp-mcp-play-test");

describe("mcp target flags (#382)", () => {
  test("#382 parses --play / --profile and keeps the positionals in order", () => {
    expect(parseTargetArgs(["players_list", "{}", "--play"])).toEqual({
      target: { kind: "play" },
      rest: ["players_list", "{}"],
    });
    expect(parseTargetArgs(["--profile", "verify", "scene_get", "{}"])).toEqual({
      target: { kind: "profile", profile: "verify" },
      rest: ["scene_get", "{}"],
    });
    expect(parseTargetArgs([]).target).toEqual({ kind: "profile", profile: undefined });
    expect(targetArgs({ kind: "play" })).toEqual(["--play"]);
    expect(targetArgs({ kind: "profile", profile: "verify" })).toEqual(["--profile", "verify"]);
    expect(targetArgs({ kind: "profile" })).toEqual([]);
  });

  test("#382 --play with --profile is a usage error; --profile needs a value", () => {
    expect(() => parseTargetArgs(["--play", "--profile", "verify"])).toThrow(UsageError);
    expect(() => parseTargetArgs(["--profile"])).toThrow(/needs a value/);
    expect(() => parseTargetArgs(["--profile", "--play"])).toThrow(UsageError);
  });

  test("#382 --play resolves the play dir (its server.lock); --profile verify is unchanged", () => {
    const env = { PP_DM_SECRET: SECRET, PP_DATA_DIR: "data/dev", PP_PLAY_DATA_DIR: playDir };
    const play = mcpConfig(env, { kind: "play" });
    expect(play.label).toBe("play");
    expect(play.config.dataDir).toBe(playDir);
    const verify = mcpConfig(env, { kind: "profile", profile: "verify" });
    expect(verify.label).toBe("verify");
    expect(verify.config.dataDir).toBe(path.join(WORKTREE_ROOT, "data", "dev"));
    expect(
      mcpConfig({ PP_DM_SECRET: SECRET }, { kind: "profile", profile: "verify" }).config.dataDir,
    ).toBe(path.join(WORKTREE_ROOT, "data", "verify"));
    // The resolver's refusals apply to the MCP server too.
    expect(() =>
      mcpConfig({ PP_DM_SECRET: SECRET, PP_PLAY_DATA_DIR: "data/play" }, { kind: "play" }),
    ).toThrow(/inside the checkout/);
  });

  test("#382 FR-AGENT-05 not running: the play folder points at bun run play", () => {
    const none = { read: () => null, alive: () => true };
    const msg = (label: string) => {
      try {
        findServer("/data", label, none);
      } catch (err) {
        expect((err as AgentError).code).toBe("server_not_running");
        return (err as Error).message;
      }
      throw new Error("expected server_not_running");
    };
    expect(msg("play")).toBe(
      "Pocket Plane isn't running (play folder). Start the server (`bun run play`).",
    );
    expect(msg("verify")).toContain("(profile verify). Start the server (`bun run start` or");
  });

  test("#382 mcp:call --play --profile exits 2 before starting anything", async () => {
    const p = Bun.spawn(
      [
        process.execPath,
        "scripts/mcp-call.ts",
        "players_list",
        "{}",
        "--play",
        "--profile",
        "verify",
      ],
      {
        cwd: WORKTREE_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PP_DM_SECRET: SECRET },
      },
    );
    expect(await p.exited).toBe(2);
    expect(await new Response(p.stderr).text()).toContain("exclusive");
  });

  test("#382 mcp --play refusing a play dir inside the checkout exits 1 with the reason", async () => {
    const p = Bun.spawn([process.execPath, "src/mcp/index.ts", "--play"], {
      cwd: WORKTREE_ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PP_DM_SECRET: SECRET, PP_PLAY_DATA_DIR: "data/play" },
    });
    expect(await p.exited).toBe(1);
    expect(await new Response(p.stdout).text()).toBe("");
    expect(await new Response(p.stderr).text()).toContain("Refusing: play data dir");
  });
});
