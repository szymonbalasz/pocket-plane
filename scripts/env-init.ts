// `bun run env:init`: claim a port slot and write `.env` (AGENTS §9.2).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { basePort, WORKTREE_ROOT } from "../src/server/config";

const ENV_PATH = path.join(WORKTREE_ROOT, ".env");
const HOST = "127.0.0.1";
const SLOTS = 50;
const PORTS_PER_SLOT = 4; // dev hono, dev vite, verify hono, spare

function git(args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: WORKTREE_ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

export function slotFromEnvFile(file: string): number | null {
  if (!existsSync(file)) return null;
  const m = /^\s*PP_SLOT\s*=\s*(\d+)\s*$/m.exec(readFileSync(file, "utf8"));
  return m?.[1] === undefined ? null : Number(m[1]);
}

function claimedSlots(): Set<number> {
  const claimed = new Set<number>();
  const list = git(["worktree", "list", "--porcelain"]);
  for (const line of list.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const wt = path.resolve(line.slice("worktree ".length));
    if (wt.toLowerCase() === WORKTREE_ROOT.toLowerCase()) continue;
    const s = slotFromEnvFile(path.join(wt, ".env"));
    if (s !== null) claimed.add(s);
  }
  return claimed;
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ host: HOST, port, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

async function slotFree(slot: number): Promise<boolean> {
  for (let i = 0; i < PORTS_PER_SLOT; i++) {
    if (!(await canBind(basePort(slot) + i))) return false;
  }
  return true;
}

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      break;
    } catch {
      // Stale after 60 s (crashed env:init).
      try {
        if (Date.now() - statSync(file).mtimeMs > 60_000) rmSync(file, { force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`Slot lock busy: ${file}`);
      await Bun.sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(file, { force: true });
  }
}

async function main(): Promise<void> {
  const existing = slotFromEnvFile(ENV_PATH);
  if (existsSync(ENV_PATH)) {
    console.log(`Keeping existing .env${existing === null ? "" : ` (slot ${existing})`}.`);
    return;
  }
  const common = path.resolve(WORKTREE_ROOT, git(["rev-parse", "--git-common-dir"]));
  const slot = await withLock(path.join(common, "pocket-plane-slot.lock"), async () => {
    const claimed = claimedSlots();
    for (let s = 0; s < SLOTS; s++) {
      if (claimed.has(s)) continue;
      if (await slotFree(s)) {
        const secret = randomBytes(18).toString("base64url");
        writeFileSync(
          ENV_PATH,
          [
            "# Written by `bun run env:init`. Never commit.",
            `PP_SLOT=${s}`,
            "PP_DATA_DISPOSABLE=1",
            `PP_DM_SECRET=${secret}`,
            "",
          ].join("\n"),
        );
        return s;
      }
    }
    throw new Error("No free port slot (0-49).");
  });
  const b = basePort(slot);
  console.log(
    `Claimed slot ${slot}: dev ${b} (Hono) + ${b + 1} (Vite), verify ${b + 2}. Wrote .env.`,
  );
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
