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

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: shutting down`);
    await running.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
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
