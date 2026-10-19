// Hono app + RPC type. Route mounts are append-only (AGENTS §9.9).
// Clients may only `import type { AppType } from "@server/app"`.
import { existsSync } from "node:fs";
import path from "node:path";
import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import { assetRoutes } from "./features/assets-pipeline/routes";
import { campaignRoutes } from "./features/campaign-management/routes";
import { encounterRoutes } from "./features/combat-tracker/routes";
import { compendiumHomebrewRoutes } from "./features/compendium/homebrew-routes";
import { compendiumImportRoutes } from "./features/compendium/import-route";
import { compendiumRoutes } from "./features/compendium/routes";
import { entityRoutes } from "./features/entities/routes";
import { sceneRoutes } from "./features/scenes-map/routes";
import { errorBody, errorResponse } from "./http";
import type { Services } from "./services";

export function createApi(s: Services) {
  return (
    new Hono()
      // ---- route mounts (append-only) ----
      .route("/api", campaignRoutes(s))
      .route("/api", assetRoutes(s))
      .route("/api", entityRoutes(s))
      .route("/api", sceneRoutes(s))
      .route("/api", encounterRoutes(s))
      .route("/api", compendiumRoutes(s))
      .route("/api", compendiumImportRoutes(s))
      .route("/api", compendiumHomebrewRoutes(s))
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
    // FR-DICEX-52 (ADR-0052): hashed build files are `.br` / `.gz` precompressed and cached for a
    // year; `Vary` on every answer, plain files too. HTML is revalidated on every load.
    app.get(
      "/assets/*",
      serveStatic({
        root: rel,
        precompressed: true,
        onFound: (_path, c) => {
          c.header("Vary", "Accept-Encoding");
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    const noCache = {
      onFound: (_path: string, c: Context) => c.header("Cache-Control", "no-cache"),
    };
    app.get("/", serveStatic({ path: dmHtml, ...noCache }));
    app.get("/p/*", serveStatic({ path: playerHtml, ...noCache }));
  }
  app.onError((err, c) => errorResponse(c, err, s));
  return app;
}
