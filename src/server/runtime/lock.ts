// Data-dir lock `$PP_DATA_DIR/server.lock` (AGENTS §9.2, FR-FIX-27). Held by the server
// or the fixture loader for its lifetime; a lock whose PID is dead is cleared with a notice.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const LOCK_FILE = "server.lock";

export const LockInfo = z.object({
  owner: z.enum(["server", "loader"]),
  pid: z.number().int(),
  port: z.number().int().nullable(),
  startedAt: z.string(),
});
export type LockInfo = z.infer<typeof LockInfo>;

export class LockHeldError extends Error {
  override name = "LockHeldError";
  constructor(readonly holder: LockInfo) {
    super(
      `Data dir is locked by a running ${holder.owner} (pid ${holder.pid}${
        holder.port ? `, port ${holder.port}` : ""
      }). ${holder.owner === "server" ? "Stop the server first." : "Wait for the load to finish."}`,
    );
  }
}

export function isPidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function lockPath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILE);
}

export function readLock(dataDir: string): LockInfo | null {
  try {
    return LockInfo.parse(JSON.parse(readFileSync(lockPath(dataDir), "utf8")));
  } catch {
    return null;
  }
}

/** Live holder or null. Clears a stale lock (dead PID) with a one-line notice. */
export function liveLock(dataDir: string, notice: (msg: string) => void = console.warn) {
  const file = lockPath(dataDir);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let info: LockInfo | null = null;
  try {
    info = LockInfo.parse(JSON.parse(raw));
  } catch {
    info = null;
  }
  if (info && isPidAlive(info.pid)) return info;
  rmSync(file, { force: true });
  notice(
    `Removed stale lock ${file}${info ? ` (${info.owner}, pid ${info.pid} not running)` : " (unreadable)"}.`,
  );
  return null;
}

export interface HeldLock {
  info: LockInfo;
  setPort(port: number): void;
  release(): void;
}

export function acquireLock(
  dataDir: string,
  owner: LockInfo["owner"],
  startedAt: string,
  notice?: (msg: string) => void,
): HeldLock {
  mkdirSync(dataDir, { recursive: true });
  const file = lockPath(dataDir);
  for (let attempt = 0; attempt < 2; attempt++) {
    const holder = liveLock(dataDir, notice);
    if (holder) throw new LockHeldError(holder);
    const info: LockInfo = { owner, pid: process.pid, port: null, startedAt };
    try {
      writeFileSync(file, JSON.stringify(info), { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    let released = false;
    return {
      info,
      setPort(port) {
        info.port = port;
        writeFileSync(file, JSON.stringify(info));
      },
      release() {
        if (released) return;
        released = true;
        const cur = readLock(dataDir);
        if (cur && cur.pid === process.pid && cur.owner === owner) rmSync(file, { force: true });
      },
    };
  }
  const holder = readLock(dataDir);
  throw holder ? new LockHeldError(holder) : new Error(`Could not acquire ${file}`);
}
