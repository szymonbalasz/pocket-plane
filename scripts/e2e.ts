// `bun run e2e [files…] [playwright args…]`: build once, then per bundle: load it into a fresh
// temp dir, start the server on port 0, run Playwright on the spec files that use that bundle,
// tear down (AGENTS §9.2 "(e2e)").
//
// A spec picks its bundle with a header comment line `// e2e-bundle: <name>` (default
// `sync-probe`). Test mode is always on. Arguments ending in `.ts` filter spec files (substring
// of the path); every other argument goes to Playwright (use `--grep=x`, not `--grep x`).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { library } from "../fixtures";
import { parseConfig, WORKTREE_ROOT } from "../src/server/config";
import { resetAndLoad } from "../src/server/features/fixtures-adapters/loader";
import { readLock } from "../src/server/runtime/lock";
import { manifestPath } from "../src/server/runtime/manifest";
import { type ServerProcess, spawnServer } from "./lib/server-process";

const DEFAULT_BUNDLE = "sync-probe";
const BUNDLE_LINE = /^\/\/\s*e2e-bundle:\s*([a-z0-9][a-z0-9-]*)\s*$/m;

async function run(cmd: string[], env: Record<string, string | undefined> = process.env) {
  const p = Bun.spawn(cmd, { cwd: WORKTREE_ROOT, env, stdout: "inherit", stderr: "inherit" });
  return p.exited;
}

/** Spec files (posix-style, relative to `root`) grouped by bundle, in name order. */
export function groupSpecs(filters: string[], root = WORKTREE_ROOT): Map<string, string[]> {
  const files = readdirSync(path.join(root, "e2e"), { recursive: true, encoding: "utf8" })
    .map((f) => `e2e/${f.split(path.sep).join("/")}`)
    .filter((f) => f.endsWith(".e2e.ts") && !f.startsWith("e2e/support/"))
    .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x.replaceAll("\\", "/"))))
    .sort();
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const m = BUNDLE_LINE.exec(readFileSync(path.join(root, f), "utf8"));
    const bundle = m?.[1] ?? DEFAULT_BUNDLE;
    groups.set(bundle, [...(groups.get(bundle) ?? []), f]);
  }
  return groups;
}

async function runBundle(bundle: string, files: string[], pwArgs: string[]): Promise<number> {
  console.log(`\n=== e2e bundle "${bundle}": ${files.join(", ")}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-e2e-"));
  const secret = `e2e-${crypto.randomUUID()}`;
  const env: Record<string, string | undefined> = {
    ...process.env,
    PP_PROFILE: "verify",
    PP_PORT: "0",
    PP_DATA_DIR: dir,
    PP_DB_PATH: "",
    PP_ASSET_DIR: "",
    PP_DATA_DISPOSABLE: "1",
    PP_TEST_MODE: "1",
    PP_DM_SECRET: secret,
    PP_PUBLIC_BASE_URL: "",
  };
  let server: ServerProcess | null = null;
  try {
    await resetAndLoad(parseConfig(env), library, bundle);
    server = spawnServer(["--client"], { env });
    let port: number | null = null;
    for (let i = 0; i < 100 && port === null; i++) {
      await Bun.sleep(100);
      const lock = readLock(dir);
      if (lock?.owner === "server" && lock.port) port = lock.port;
    }
    if (port === null) throw new Error("Server did not start (no port in server.lock)");
    return await run(["bun", "x", "playwright", "test", ...files, ...pwArgs], {
      ...process.env,
      E2E_BASE_URL: `http://127.0.0.1:${port}`,
      E2E_DM_SECRET: secret,
      E2E_MANIFEST: manifestPath(dir),
      E2E_BUNDLE: bundle,
    });
  } catch (err) {
    console.error(err);
    return 1;
  } finally {
    // Clean stop (removes server.lock); hard kill only if it hangs.
    await server?.stop();
    // The in-process load's prepared statements keep the DB file open on Windows until they
    // are collected (see closeDb); collect, then retry briefly, then warn only.
    Bun.gc(true);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (err) {
      console.warn(`Could not remove ${dir}: ${(err as Error).message}`);
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const filters = args.filter((a) => a.endsWith(".ts"));
  const pwArgs = args.filter((a) => !a.endsWith(".ts"));
  const groups = groupSpecs(filters);
  if (groups.size === 0) {
    console.error(`No e2e spec matches ${filters.join(", ")}`);
    process.exit(1);
  }
  if ((await run(["bun", "x", "vite", "build"])) !== 0) process.exit(1);
  const failed: string[] = [];
  for (const [bundle, files] of groups) {
    if ((await runBundle(bundle, files, pwArgs)) !== 0) failed.push(bundle);
  }
  if (failed.length > 0) console.error(`\ne2e failed for bundle(s): ${failed.join(", ")}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
