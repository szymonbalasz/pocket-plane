// Test-mode crash hook (#163, Phase 4 audit #3): kills the process at a chosen point so a
// walkthrough can check crash recovery mid-command. `PP_TEST_CRASH` (config.ts) is refused
// unless PP_TEST_MODE=1 and PP_DATA_DISPOSABLE=1; entry points arm it, nothing else does:
// - `bun run start` / `dev` (server.ts): `<command>:before-commit | after-commit`,
//   `assets.ingest:after-files`;
// - `fixtures:*` (scripts/fixtures.ts): `fixture:<key>`.
// Hard exit = SIGKILL to self: no exit handler runs, the open transaction never commits and
// server.lock stays behind (restart takes the stale-lock path).
import { type CrashSpec, formatCrashSpec } from "../config";

export type { CrashSpec } from "../config";

let armed: { spec: CrashSpec; kill: (where: string) => void } | null = null;

function hardKill(where: string): void {
  // One line so the pane shows why the server vanished; then no exit handlers.
  process.stderr.write(`PP_TEST_CRASH: killing the process at ${where}\n`);
  process.kill(process.pid, "SIGKILL");
}

/** Arm (or with `null` disarm) the hook for this process. `kill` is replaceable for tests. */
export function armCrashHook(spec: CrashSpec | null, kill: (where: string) => void = hardKill) {
  armed = spec ? { spec, kill } : null;
}

export function armedCrashHook(): CrashSpec | null {
  return armed?.spec ?? null;
}

/** Called at each seam; kills the process if it is the armed point. */
export function crashPoint(point: CrashSpec["point"], target: string | undefined): void {
  if (!armed || target === undefined) return;
  if (armed.spec.point === point && armed.spec.target === target) {
    armed.kill(formatCrashSpec(armed.spec));
  }
}
