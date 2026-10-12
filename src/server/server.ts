// Server bootstrap: guards, lock, DB, services, Hono + WS on one port.
import path from "node:path";
import { WS_PATH } from "@shared/protocol/frames";
import type { Server, ServerWebSocket } from "bun";
import { createApp } from "./app";
import type { Clock } from "./commands/context";
import { type Config, localUrl } from "./config";
import { type Db, openFileDb } from "./db/client";
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
          if (new URL(req.url).pathname === WS_PATH) {
            if (srv.upgrade(req, { data: { conn: null } })) return undefined;
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
    return {
      port,
      url,
      services,
      hub,
      server,
      async stop() {
        if (stopped) return;
        stopped = true;
        hub.shutdown();
        // Not awaited: in Bun 1.3 the promise never settles after a server-initiated WS close.
        void server.stop(true);
        await Bun.sleep(0);
        if (!opts.db) db.$client.close();
        lock?.release();
      },
    };
  } catch (err) {
    lock?.release();
    throw err;
  }
}
