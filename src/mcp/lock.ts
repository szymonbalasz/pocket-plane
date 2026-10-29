// Find the server (FR-AGENT-04/07, ADR-0072 D3): read `$PP_DATA_DIR/server.lock` on every call,
// never write, clear or create it. Always loopback, never the tunnel URL.
import { isPidAlive, type LockInfo, readLock } from "@server/runtime/lock";
import { busy, notRunning } from "./errors";

export interface LockReader {
  read(dataDir: string): LockInfo | null;
  alive(pid: number): boolean;
}

export const fileLock: LockReader = { read: readLock, alive: isPidAlive };

/**
 * Checks in order: parses → PID alive → `owner: "server"` → `port` set. A dead PID is "not
 * running"; the stale file is left for the next `start`.
 */
export function findServer(
  dataDir: string,
  profile: string,
  reader: LockReader = fileLock,
): { port: number; http: string; ws: string } {
  const lock = reader.read(dataDir);
  if (!lock) throw notRunning(profile);
  if (!reader.alive(lock.pid)) throw notRunning(profile);
  if (lock.owner !== "server") throw busy("fixture load running");
  if (lock.port === null) throw busy("server starting");
  return {
    port: lock.port,
    http: `http://127.0.0.1:${lock.port}`,
    ws: `ws://127.0.0.1:${lock.port}`,
  };
}
