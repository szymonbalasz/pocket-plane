// `bun run dev [--profile p]`: Hono (watch) + Vite (HMR). Stops both when either exits or on Ctrl+C.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
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

const children = [
  {
    name: "server",
    proc: Bun.spawn(["bun", "--watch", "src/server/index.ts", ...profileArgs], {
      cwd: cfg.root,
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    }),
  },
  {
    name: "vite",
    proc: Bun.spawn(["bun", "x", "vite", ...profileArgs], {
      cwd: cfg.root,
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    }),
  },
];

async function pipe(name: string, stream: ReadableStream<Uint8Array>, toFile: boolean) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const out = `[${name}] ${line}`;
      console.log(out);
      if (toFile) appendFileSync(logFile, `${line}\n`);
    }
  }
}

for (const c of children) {
  void pipe(c.name, c.proc.stdout, c.name === "server");
  void pipe(c.name, c.proc.stderr, c.name === "server");
}

console.log(`DM URL (dev): ${localUrl(cfg.host, cfg.vitePort)}/  — Hono on ${cfg.port})`);

let stopping = false;
function stopAll(code: number) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.proc.kill();
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
for (const c of children) {
  void c.proc.exited.then((code) => {
    if (!stopping) console.log(`[${c.name}] exited (${code}); stopping.`);
    stopAll(code ?? 1);
  });
}
