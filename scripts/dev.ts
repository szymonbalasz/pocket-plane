// `bun run dev [--profile p]`: Hono (restarted on server/shared changes) + Vite (HMR).
// Stops both when Vite exits or on Ctrl+C. The server is always stopped cleanly over IPC so
// it removes server.lock (AGENTS §9.2); `bun --watch` can't do that on Windows (it hard-kills
// and re-spawns the script in a grandchild process that IPC and signals don't reach).
import { appendFileSync, mkdirSync, watch } from "node:fs";
import path from "node:path";
import type { Subprocess } from "bun";
import { ConfigError, loadConfig, localUrl, profileArg } from "../src/server/config";

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

async function pipe(name: string, stream: ReadableStream<Uint8Array>, toFile: boolean) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      console.log(`[${name}] ${line}`);
      if (toFile) appendFileSync(logFile, `${line}\n`);
    }
  }
}

function spawnPiped(name: string, cmd: string[], extra: { ipc?: boolean } = {}): Subprocess {
  const proc = Bun.spawn(cmd, {
    cwd: cfg.root,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    ...(extra.ipc ? { ipc() {}, serialization: "json" as const } : {}),
  });
  void pipe(name, proc.stdout as ReadableStream<Uint8Array>, name === "server");
  void pipe(name, proc.stderr as ReadableStream<Uint8Array>, name === "server");
  return proc;
}

/** Ask for a clean stop (lock removed), hard-kill only after the grace period. */
async function stopProc(proc: Subprocess, viaIpc: boolean): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    if (viaIpc) proc.send({ type: "shutdown" });
    else proc.kill("SIGINT");
  } catch {
    // already gone
  }
  const timer = setTimeout(() => proc.kill(), STOP_GRACE_MS);
  await proc.exited;
  clearTimeout(timer);
}

let stopping = false;
let server: Subprocess | null = null;
let restarting = false;

function startServer() {
  const proc = spawnPiped("server", ["bun", "src/server/index.ts", ...profileArgs], { ipc: true });
  server = proc;
  void proc.exited.then((code) => {
    if (stopping || restarting || server !== proc) return;
    console.log(`[server] exited (${code}); waiting for changes in src/server or src/shared.`);
  });
}

async function restartServer() {
  if (stopping || restarting) return;
  restarting = true;
  console.log("[dev] server code changed; restarting");
  if (server) await stopProc(server, true);
  restarting = false;
  if (!stopping) startServer();
}

const vite = spawnPiped("vite", ["bun", "x", "vite", ...profileArgs]);
startServer();
console.log(`DM URL (dev): ${localUrl(cfg.host, cfg.vitePort)}/  (Hono on ${cfg.port})`);

let debounce: ReturnType<typeof setTimeout> | null = null;
const watcher = watch(path.join(cfg.root, "src"), { recursive: true }, (_event, file) => {
  const f = String(file ?? "").replaceAll("\\", "/");
  if (!/^(server|shared)\//.test(f) || f.endsWith(".test.ts")) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void restartServer(), 150);
});

async function stopAll(code: number) {
  if (stopping) return;
  stopping = true;
  watcher.close();
  // On a console Ctrl+C both children also get the event and start stopping on their own.
  await Promise.all([server ? stopProc(server, true) : null, stopProc(vite, false)]);
  process.exit(code);
}

process.on("SIGINT", () => void stopAll(0));
process.on("SIGTERM", () => void stopAll(0));
void vite.exited.then((code) => {
  if (!stopping) console.log(`[vite] exited (${code}); stopping.`);
  void stopAll(code ?? 1);
});
