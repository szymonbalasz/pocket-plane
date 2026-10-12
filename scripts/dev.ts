// `bun run dev [--profile p]`: Hono (restarted on server/shared changes) + Vite (HMR).
// Stops both when Vite exits or on Ctrl+C. The server runs supervised (detached, stops when
// its stdin closes, scripts/lib/server-process.ts) so it always removes server.lock
// (AGENTS §9.2), even when Ctrl+C kills this process first. `bun --watch` can't do that on
// Windows (it hard-kills and re-spawns the script), so restarts are done here.
import { appendFileSync, mkdirSync, watch } from "node:fs";
import path from "node:path";
import type { Subprocess } from "bun";
import { ConfigError, loadConfig, localUrl, profileArg } from "../src/server/config";
import { type ServerProcess, spawnServer } from "./lib/server-process";

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig({ profile: profileArg(process.argv), requireSlot: true, requireSecret: true });
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

mkdirSync(cfg.dataDir, { recursive: true });
const logFile = path.join(cfg.dataDir, "server.log");
const env = { ...process.env, PP_PROFILE: cfg.profile };
const profileArgs = ["--profile", cfg.profile];
const STOP_GRACE_MS = 3_000;

async function pipe(name: string, stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) console.log(`[${name}] ${line}`);
  }
}

let stopping = false;
let server: ServerProcess | null = null;
let restarting = false;

function startServer() {
  const sp = spawnServer(profileArgs, {
    env,
    onLine(line) {
      console.log(`[server] ${line}`);
      appendFileSync(logFile, `${line}\n`);
    },
  });
  server = sp;
  void sp.proc.exited.then((code) => {
    if (stopping || restarting || server !== sp) return;
    console.log(`[server] exited (${code}); waiting for changes in src/server or src/shared.`);
  });
}

async function restartServer() {
  if (stopping || restarting) return;
  restarting = true;
  console.log("[dev] server code changed; restarting");
  await server?.stop(STOP_GRACE_MS);
  restarting = false;
  if (!stopping) startServer();
}

const vite: Subprocess<"ignore", "pipe", "pipe"> = Bun.spawn(["bun", "x", "vite", ...profileArgs], {
  cwd: cfg.root,
  env,
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
});
void pipe("vite", vite.stdout);
void pipe("vite", vite.stderr);
startServer();
console.log(`DM URL (dev): ${localUrl(cfg.host, cfg.vitePort)}/  (Hono on ${cfg.port})`);

let debounce: ReturnType<typeof setTimeout> | null = null;
const watcher = watch(path.join(cfg.root, "src"), { recursive: true }, (_event, file) => {
  const f = String(file ?? "").replaceAll("\\", "/");
  if (!/^(server|shared)\//.test(f) || f.endsWith(".test.ts")) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void restartServer(), 150);
});

async function stopVite(): Promise<void> {
  if (vite.exitCode !== null || vite.signalCode !== null) return;
  vite.kill("SIGINT");
  const t = setTimeout(() => vite.kill(), STOP_GRACE_MS);
  await vite.exited;
  clearTimeout(t);
}

async function stopAll(code: number) {
  if (stopping) return;
  stopping = true;
  watcher.close();
  await Promise.all([server?.stop(STOP_GRACE_MS), stopVite()]);
  process.exit(code);
}

process.on("SIGINT", () => void stopAll(0));
process.on("SIGTERM", () => void stopAll(0));
process.on("SIGBREAK", () => void stopAll(0));
void vite.exited.then((code) => {
  if (!stopping) console.log(`[vite] exited (${code}); stopping.`);
  void stopAll(code ?? 1);
});
