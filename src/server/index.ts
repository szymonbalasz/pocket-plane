// Bun + Hono entry. `bun src/server/index.ts [--profile p] [--client]`.
import { ConfigError, loadConfig, profileArg } from "./config";
import { createLogger } from "./log";
import { LockHeldError } from "./runtime/lock";
import { StartupError, startServer } from "./server";

async function main(): Promise<void> {
  const config = loadConfig({
    profile: profileArg(process.argv),
    requireSlot: true,
    requireSecret: true,
  });
  const log = createLogger(config.logLevel);
  const serveClient = process.argv.includes("--client");
  const running = await startServer({ config, log, serveClient });

  log.info(
    `profile ${config.profile}, data ${config.dataDir}${config.testMode ? ", TEST MODE" : ""}`,
  );
  log.info(`listening on ${running.url} (API, WS${serveClient ? ", client" : ""})`);
  if (serveClient) log.info(`DM URL: ${running.url}/`);
  if (!config.publicBaseUrl) {
    log.warn("PP_PUBLIC_BASE_URL is not set: player links use the DM client's origin.");
  }

  // Clean exit removes server.lock (AGENTS §9.2). Fully synchronous so a Windows console
  // Ctrl+C can't kill the process between "shutting down" and the lock removal.
  const stop = (reason: string) => {
    log.info(`${reason}: shutting down`);
    running.stopSync();
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGBREAK", () => stop("SIGBREAK"));
  // `scripts/dev.ts` / `scripts/e2e.ts` ask for a clean stop over IPC (Windows has no
  // catchable kill signal for child processes).
  process.on("message", (m: unknown) => {
    if ((m as { type?: unknown } | null)?.type === "shutdown") stop("shutdown request");
  });
  // Any other process.exit still releases the lock (idempotent).
  process.on("exit", () => running.stopSync());
  // Hard kills leave a lock whose PID is dead; the next start clears it (FR-FIX-27).
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof StartupError || err instanceof LockHeldError) {
    console.error(`Cannot start: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
