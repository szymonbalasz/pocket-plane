// Pure parts of `bun run play` (#382): the test-flag refusal and the server's env.
import path from "node:path";
import { ConfigError, type PlayDirs } from "../../src/server/config";

/** Refuses test-only switches: a real campaign never runs with them (#382). */
export function checkPlayEnv(env: Record<string, string | undefined>): void {
  for (const k of ["PP_TEST_MODE", "PP_TEST_CRASH"] as const) {
    const v = env[k]?.trim();
    if (v && v !== "0") {
      throw new ConfigError(
        `Refusing: ${k} is set. Test-only switches never run on a real campaign; remove it from the env / .env. Nothing changed.`,
      );
    }
  }
}

/**
 * The server's env for a play run. Values are explicit (never just unset) because the child
 * auto-loads the checkout's `.env`, which only fills vars that are missing.
 */
export function playServerEnv(
  env: Record<string, string | undefined>,
  dirs: PlayDirs,
): Record<string, string | undefined> {
  return {
    ...env,
    PP_DATA_DIR: dirs.dataDir,
    PP_DB_PATH: path.join(dirs.dataDir, "pocket-plane.db"),
    PP_ASSET_DIR: path.join(dirs.dataDir, "assets"),
    PP_PORT: String(dirs.port),
    PP_DATA_DISPOSABLE: "0",
    PP_TEST_MODE: "0",
    PP_TEST_CRASH: "",
  };
}
