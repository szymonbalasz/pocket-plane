// Hono app + RPC type. Route mounts are append-only (AGENTS §9.9).
// Clients may only `import type { AppType } from "@server/app"`.
import { existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { campaignRoutes } from "./features/campaign-management/routes";
import { errorBody, errorResponse } from "./http";
import type { Services } from "./services";

export function createApi(s: Services) {
  return (
    new Hono()
      // ---- route mounts (append-only) ----
      .route("/api", campaignRoutes(s))
  );
}

export type AppType = ReturnType<typeof createApi>;

export interface AppOptions {
  /** Built client (`dist/client`); served by `start`. Absent in dev (Vite serves it). */
  clientDir?: string;
}

export function createApp(s: Services, opts: AppOptions = {}) {
  const app = new Hono();
  app.route("/", createApi(s));
  app.all("/api/*", (c) => c.json(errorBody("not_found", "No such route"), 404));

  const dir = opts.clientDir;
  if (dir && existsSync(dir)) {
    const rel = path.relative(process.cwd(), dir) || ".";
    const dmHtml = path.join(rel, "dm", "index.html");
    const playerHtml = path.join(rel, "player", "index.html");
    app.get("/assets/*", serveStatic({ root: rel }));
    app.get("/", serveStatic({ path: dmHtml }));
    app.get("/p/*", serveStatic({ path: playerHtml }));
  }
  app.onError((err, c) => errorResponse(c, err, s));
  return app;
}
