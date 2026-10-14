// Rename with retries: on Windows a just-written file or dir can be briefly held by a virus
// scanner or the indexer, and rename fails with EPERM / EACCES / EBUSY. Same approach as
// graceful-fs; bounded at 20 retries (~1.5 s of backoff), then the error is thrown.
import { renameSync } from "node:fs";

const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
export const RENAME_RETRIES = 20;

export interface RenameIo {
  rename(from: string, to: string): void;
  sleep(ms: number): void;
}

const realIo: RenameIo = { rename: renameSync, sleep: Bun.sleepSync };

export function renameRetrying(from: string, to: string, io: RenameIo = realIo): void {
  for (let attempt = 0; ; attempt++) {
    try {
      io.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT.has(code) || attempt >= RENAME_RETRIES) throw err;
      io.sleep(Math.min(10 * (attempt + 1), 100));
    }
  }
}
