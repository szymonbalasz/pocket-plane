import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { loadConfig, profileArg, WORKTREE_ROOT } from "./src/server/config";

const r = (p: string) => path.resolve(WORKTREE_ROOT, p);

/** Dev routes per campaign-management OQ-CAMP-15: DM `/`, player `/p/<token>`. */
function clientRoutes(): Plugin {
  return {
    name: "pocket-plane-client-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const [pathname, query = ""] = url.split("?");
        const q = query ? `?${query}` : "";
        if (pathname === "/" || pathname === "/index.html") req.url = `/dm/index.html${q}`;
        else if (pathname?.startsWith("/p/")) req.url = `/player/index.html${q}`;
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const server =
    command === "serve"
      ? (() => {
          const cfg = loadConfig({ profile: profileArg(process.argv), requireSlot: true });
          const target = `http://127.0.0.1:${cfg.port}`;
          return {
            host: cfg.host,
            port: cfg.vitePort,
            strictPort: true,
            proxy: {
              "/api": { target, changeOrigin: false },
              "/ws": { target, ws: true },
            },
          };
        })()
      : undefined;

  return {
    root: r("src/client"),
    appType: "mpa",
    plugins: [react(), tailwindcss(), clientRoutes()],
    resolve: {
      alias: {
        "@shared": r("src/shared"),
        "@ui": r("src/client/common"),
        "@dm": r("src/client/dm"),
        "@player": r("src/client/player"),
      },
    },
    server,
    build: {
      outDir: r("dist/client"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          dm: r("src/client/dm/index.html"),
          player: r("src/client/player/index.html"),
        },
      },
    },
  };
});
