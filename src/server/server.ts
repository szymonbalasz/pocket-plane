// Server bootstrap: guards, lock, DB, services, Hono + WS on one port.
import path from "node:path";
import { WS_PATH, WS_PROBE_PARAM } from "@shared/protocol/frames";
import type { Server, ServerWebSocket } from "bun";
import { createApp } from "./app";
import type { Clock } from "./commands/context";
import { type Config, localUrl } from "./config";
import { closeDb, type Db, openFileDb } from "./db/client";
import { pushSchema } from "./db/push";
import type { Logger } from "./log";
import { acquireLock, type HeldLock } from "./runtime/lock";
import { readManifest } from "./runtime/manifest";
import { createServices, type Services } from "./services";
import { type Connection, Hub, type HubOptions } from "./ws/hub";

interface WsData {
  conn: Connection | null;
}

export interface StartOptions {
  config: Config;
  log: Logger;
  /** Serve the built client from dist/client (`start`); dev uses Vite instead. */
  serveClient?: boolean;
  /** Tests: in-memory DB, no lock file. */
  db?: Db;
  lock?: boolean;
  clock?: Clock;
  hub?: HubOptions;
}

export interface RunningServer {
  port: number;
  url: string;
  services: Services;
  hub: Hub;
  server: Server<WsData>;
  /** Removes server.lock now (one rmSync). Idempotent; stopSync calls it too. */
  releaseLock(): void;
  /** Closes connections, DB and releases the lock without awaiting anything. */
  stopSync(): void;
  stop(): Promise<void>;
}

export class StartupError extends Error {
  override name = "StartupError";
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const { config, log } = opts;

  if (config.disposable) {
    const m = readManifest(config.dataDir);
    if (m && (m.status === "resetting" || m.status === "loading")) {
      throw new StartupError(
        `Data dir has an unfinished fixture ${m.status === "resetting" ? "reset" : "load"}. Run \`bun run fixtures:reset-load <bundle>\`.`,
      );
    }
  }

  let lock: HeldLock | null = null;
  if (opts.lock !== false) {
    lock = acquireLock(config.dataDir, "server", new Date().toISOString(), (m) => log.warn(m));
  }

  try {
    let db = opts.db;
    if (!db) {
      db = openFileDb(config.dbPath);
      const { applied } = await pushSchema(db.$client);
      if (applied > 0) log.info(`schema: applied ${applied} statement(s)`);
    }
    const services = createServices({ config, db, log, clock: opts.clock });
    // Start hooks (r.onStart): after the schema push, before listening. Real servers only.
    for (const h of services.startHooks) {
      try {
        await h.fn(services);
      } catch (err) {
        throw new StartupError(`start hook "${h.name}" failed: ${(err as Error).message}`);
      }
    }
    const hub = new Hub(services, opts.hub);
    services.hub = hub;
    const app = createApp(services, {
      clientDir: opts.serveClient ? path.join(config.root, "dist", "client") : undefined,
    });

    let server: Server<WsData>;
    try {
      server = Bun.serve<WsData>({
        hostname: config.host,
        port: config.port,
        fetch(req, srv) {
          const url = new URL(req.url);
          if (url.pathname === WS_PATH) {
            if (srv.upgrade(req, { data: { conn: null } })) return undefined;
            // Client reconnect probe (protocol §3.1): 2xx so browsers don't log it as an error.
            // No auth, no body.
            if (url.searchParams.has(WS_PROBE_PARAM)) {
              return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
            }
            return new Response("Expected a WebSocket upgrade", { status: 426 });
          }
          return app.fetch(req);
        },
        websocket: {
          // Hub enforces the 64 KB client-frame limit with close 1009 (FR-SYNC-12).
          maxPayloadLength: 1024 * 1024,
          backpressureLimit: 1024 * 1024,
          idleTimeout: 120,
          open(ws: ServerWebSocket<WsData>) {
            ws.data.conn = hub.open({
              send: (d) => ws.send(d),
              close: (code, reason) => ws.close(code, reason),
              getBufferedAmount: () => ws.getBufferedAmount(),
            });
          },
          message(ws, msg) {
            if (ws.data.conn) hub.message(ws.data.conn, msg);
          },
          close(ws) {
            if (ws.data.conn) hub.closed(ws.data.conn);
          },
        },
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        throw new StartupError(
          `Port ${config.port} on ${config.host} is in use. Stop the other process (no fallback ports).`,
        );
      }
      throw err;
    }

    const port = server.port ?? config.port;
    lock?.setPort(port);
    const url = localUrl(config.host, port);
    let stopped = false;
    // Synchronous on purpose: on Windows a Ctrl+C can tear the process down before any
    // await resumes, so nothing after the first await is guaranteed to run (AGENTS §9.2).
    const stopSync = () => {
      if (stopped) return;
      stopped = true;
      try {
        hub.shutdown();
        // Not awaited: in Bun 1.3 the promise never settles after a server-initiated WS close.
        void server.stop(true);
        if (!opts.db) closeDb(db);
      } finally {
        lock?.release();
      }
    };
    return {
      port,
      url,
      services,
      hub,
      server,
      releaseLock: () => lock?.release(),
      stopSync,
      async stop() {
        stopSync();
        await Bun.sleep(0);
      },
    };
  } catch (err) {
    lock?.release();
    throw err;
  }
}
