// Run the server as a supervised child that always gets a clean stop (removes server.lock,
// AGENTS §9.2).
//
// Why: on Windows a console Ctrl+C reaches every process in the console, and `bun run` then
// exits and kills its whole job (its children) within ~20 ms, before the server's SIGINT
// handler reliably runs. So the server is spawned *detached* (own process group, outside that
// kill, no console Ctrl+C) with a stdin pipe, and it shuts down cleanly when stdin closes:
// either because we close it (`stop()`), or because the supervising process died.
import type { Subprocess } from "bun";
import { WORKTREE_ROOT } from "../../src/server/config";

export const STOP_ON_STDIN_CLOSE = "--stop-on-stdin-close";

export interface ServerProcess {
  proc: Subprocess<"pipe", "pipe", "pipe">;
  /** Ask for a clean stop; hard-kill only after `graceMs`. Resolves with the exit code. */
  stop(graceMs?: number): Promise<number>;
}

export function spawnServer(
  args: string[],
  opts: {
    env?: Record<string, string | undefined>;
    /** Receives each output line; default: print to this process's stdout/stderr. */
    onLine?: (line: string, stream: "stdout" | "stderr") => void;
  } = {},
): ServerProcess {
  const proc = Bun.spawn(["bun", "src/server/index.ts", STOP_ON_STDIN_CLOSE, ...args], {
    cwd: WORKTREE_ROOT,
    env: opts.env ?? process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const onLine =
    opts.onLine ??
    ((line, stream) => (stream === "stderr" ? console.error(line) : console.log(line)));
  void forward(proc.stdout, (l) => onLine(l, "stdout"));
  void forward(proc.stderr, (l) => onLine(l, "stderr"));
  return {
    proc,
    async stop(graceMs = 3_000) {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.stdin.end();
        } catch {
          // already closed
        }
        const t = setTimeout(() => proc.kill(), graceMs);
        await proc.exited;
        clearTimeout(t);
      }
      return proc.exitCode ?? 1;
    },
  };
}

async function forward(stream: ReadableStream<Uint8Array>, fn: (line: string) => void) {
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) fn(line);
    }
  } catch {
    // stream torn down
  }
  if (buf) fn(buf);
}
