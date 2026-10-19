// DICEX §13 E2E `FR-DICEX-52 compressed build output` (ADR-0052): runs on the output of
// `bun run e2e`'s own build (the unit bundle test builds with `write: false`, so the hook never
// runs there). Every JS / CSS ≥ 1 KB has `.br` + `.gz` siblings that decompress to the same
// bytes; `dice3d` brotli ≤ 140 KB; the e2e server answers the `dice3d` request with them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const ASSETS = path.join(import.meta.dirname, "..", "dist", "client", "assets");
const KB = 1024;

test("FR-DICEX-52 compressed build output", async ({ request }) => {
  const files = readdirSync(ASSETS);
  const built = files.filter((f) => /\.(js|css)$/.test(f));
  const big = built.filter((f) => statSync(path.join(ASSETS, f)).size >= KB);
  expect(big.length).toBeGreaterThan(10);
  expect(big.some((f) => f.endsWith(".css"))).toBe(true);
  for (const f of big) {
    const plain = readFileSync(path.join(ASSETS, f));
    expect(files, f).toContain(`${f}.br`);
    expect(files, f).toContain(`${f}.gz`);
    const br = brotliDecompressSync(readFileSync(path.join(ASSETS, `${f}.br`)));
    const gz = gunzipSync(readFileSync(path.join(ASSETS, `${f}.gz`)));
    expect(br.equals(plain), `${f}.br`).toBe(true);
    expect(gz.equals(plain), `${f}.gz`).toBe(true);
  }
  // Under 1 KB: no siblings.
  for (const f of built.filter((x) => !big.includes(x))) {
    expect(files, f).not.toContain(`${f}.br`);
    expect(files, f).not.toContain(`${f}.gz`);
  }

  const dice3d = big.find((f) => /^dice3d-.+\.js$/.test(f));
  if (!dice3d) throw new Error("No dice3d chunk in dist/client/assets");
  expect(statSync(path.join(ASSETS, `${dice3d}.br`)).size).toBeLessThanOrEqual(140 * KB);

  const r = await request.get(`/assets/${dice3d}`, {
    headers: { "Accept-Encoding": "gzip, deflate, br, zstd" },
  });
  expect(r.status()).toBe(200);
  const h = r.headers();
  expect(h["content-encoding"]).toBe("br");
  expect(h.vary).toBe("Accept-Encoding");
  expect(h["cache-control"]).toBe("public, max-age=31536000, immutable");
  // Playwright decodes the body: same bytes as the plain file.
  expect((await r.body()).equals(readFileSync(path.join(ASSETS, dice3d)))).toBe(true);

  const html = await request.get("/");
  expect(html.headers()["cache-control"]).toBe("no-cache");
});
