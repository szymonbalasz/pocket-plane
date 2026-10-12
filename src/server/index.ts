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

  // Clean exit removes server.lock (AGENTS §9.2). On Windows a console Ctrl+C also reaches
  // `bun run`, which exits at once and takes this child process down with it within a few
  // ms. So the lock goes first, synchronously, before logging or any other cleanup.
  const stop = (reason: string) => {
    running.releaseLock();
    try {
      log.info(`${reason}: shutting down`);
    } catch {
      // stdout may be a pipe whose reader is already gone
    }
    running.stopSync();
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGBREAK", () => stop("SIGBREAK"));
  // Supervised mode (scripts/lib/server-process.ts): stdin is a pipe from the supervisor;
  // it closes when the supervisor asks for a stop or dies (e.g. `bun run` killed by Ctrl+C).
  if (process.argv.includes("--stop-on-stdin-close")) {
    process.stdin.on("end", () => stop("supervisor closed stdin"));
    process.stdin.on("close", () => stop("supervisor closed stdin"));
    process.stdin.resume();
  }
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
