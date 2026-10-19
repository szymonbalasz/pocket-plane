import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlib } from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { loadConfig, profileArg, WORKTREE_ROOT } from "./src/server/config.ts";

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

/**
 * `.br` (q11) and `.gz` (-9) beside every built JS / CSS file of ≥ 1 KB in `assets/`, served by
 * `serveStatic({ precompressed: true })` (FR-DICEX-52, ADR-0052). Runs only when the build writes
 * files: an in-memory build (`write: false`) never calls `writeBundle`.
 */
function precompress(): Plugin {
  const br = promisify(brotliCompress);
  const gz = promisify(gzip);
  return {
    name: "pocket-plane-precompress",
    apply: "build",
    async writeBundle(options, bundle) {
      const dir = options.dir ?? r("dist/client");
      const jobs = Object.values(bundle).flatMap((f) => {
        if (!/^assets\/.+\.(js|css)$/.test(f.fileName)) return [];
        const bytes = Buffer.from(f.type === "chunk" ? f.code : f.source);
        if (bytes.length < 1024) return [];
        const file = path.join(dir, f.fileName);
        return [
          br(bytes, {
            params: {
              [zlib.BROTLI_PARAM_QUALITY]: 11,
              [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length,
            },
          }).then((b) => writeFile(`${file}.br`, b)),
          gz(bytes, { level: 9 }).then((b) => writeFile(`${file}.gz`, b)),
        ];
      });
      await Promise.all(jobs);
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
    plugins: [react(), tailwindcss(), clientRoutes(), precompress()],
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
      rolldownOptions: {
        input: {
          dm: r("src/client/dm/index.html"),
          player: r("src/client/player/index.html"),
        },
        output: {
          // React DOM in its own long-cached chunk keeps the shared app chunk under the 500 KB
          // warning. Konva is not grouped: it stays in the lazy MapCanvas chunk (LazyMapCanvas).
          codeSplitting: {
            groups: [{ name: "react-dom", test: /node_modules[\\/](react-dom|scheduler)[\\/]/ }],
          },
        },
      },
    },
  };
});
