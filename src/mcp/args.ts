// Target flags shared by `bun run mcp` and `bun run mcp:call` (#382): `--profile <p>` (dev /
// verify data under the checkout) or `--play` (the real-campaign dir of `bun run play`).
import { parseConfig, resolvePlayDirs } from "@server/config";

export type McpTarget = { kind: "profile"; profile?: string } | { kind: "play" };

export class UsageError extends Error {
  override name = "UsageError";
}

/** Splits the target flags off `args`; the rest keeps its order. */
export function parseTargetArgs(args: readonly string[]): { target: McpTarget; rest: string[] } {
  let profile: string | undefined;
  let play = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--play") play = true;
    else if (a === "--profile") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError("--profile needs a value");
      profile = v;
      i++;
    } else rest.push(a);
  }
  if (play && profile !== undefined) {
    throw new UsageError("--play and --profile are exclusive: pick one");
  }
  return { target: play ? { kind: "play" } : { kind: "profile", profile }, rest };
}

/** The flags that select `target` on the child's command line. */
export function targetArgs(target: McpTarget): string[] {
  if (target.kind === "play") return ["--play"];
  return target.profile ? ["--profile", target.profile] : [];
}

/** Config for the MCP server; `--play` points it at the play dir's server.lock. */
export function mcpConfig(
  env: Record<string, string | undefined>,
  target: McpTarget,
): { config: ReturnType<typeof parseConfig>; label: string } {
  if (target.kind === "play") {
    const { dataDir } = resolvePlayDirs(env);
    const config = parseConfig(
      { ...env, PP_DATA_DIR: dataDir, PP_DB_PATH: "", PP_ASSET_DIR: "" },
      { requireSecret: true },
    );
    return { config, label: "play" };
  }
  const config = parseConfig(env, { profile: target.profile, requireSecret: true });
  return { config, label: config.profile };
}
