// DICEX §13 integration `FR-DICEX-52 compressed chunk served` (ADR-0052): `createApp` on a temp
// built client. Precompressed siblings by `Accept-Encoding`, `Vary` on every `/assets/*` answer,
// `immutable` on hashed files, `no-cache` on the HTML pages.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { createApp } from "./app";
import { createTestServices } from "./testing/services";

const IMMUTABLE = "public, max-age=31536000, immutable";
const dir = mkdtempSync(path.join(os.tmpdir(), "pp-static-"));
const plain = Buffer.from(`export const a = "${"x".repeat(2000)}";\n`);
const br = brotliCompressSync(plain);
const gz = gzipSync(plain, { level: 9 });
for (const [f, body] of [
  ["dm/index.html", "<!doctype html><title>DM</title>"],
  ["player/index.html", "<!doctype html><title>Player</title>"],
  ["assets/b.js", "export const b = 1;\n"],
] as const) {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), body);
}
writeFileSync(path.join(dir, "assets/a.js"), plain);
writeFileSync(path.join(dir, "assets/a.js.br"), br);
writeFileSync(path.join(dir, "assets/a.js.gz"), gz);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const app = createApp(createTestServices(), { clientDir: dir });
const get = (url: string, enc?: string) =>
  app.request(url, enc === undefined ? {} : { headers: { "Accept-Encoding": enc } });
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());

describe("FR-DICEX-52 compressed chunk served", () => {
  test("br preferred when the browser accepts it", async () => {
    const r = await get("/assets/a.js", "gzip, deflate, br, zstd");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-encoding")).toBe("br");
    expect(r.headers.get("content-type")).toContain("javascript");
    expect((await bytes(r)).equals(br)).toBe(true);
    expect(r.headers.get("vary")).toBe("Accept-Encoding");
    expect(r.headers.get("cache-control")).toBe(IMMUTABLE);
  });

  test("gzip when br is not accepted", async () => {
    const r = await get("/assets/a.js", "gzip");
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect((await bytes(r)).equals(gz)).toBe(true);
    expect(r.headers.get("vary")).toBe("Accept-Encoding");
    expect(r.headers.get("cache-control")).toBe(IMMUTABLE);
  });

  test("plain file with no Accept-Encoding, still Vary + immutable", async () => {
    for (const enc of [undefined, "identity"]) {
      const r = await get("/assets/a.js", enc);
      expect(r.headers.get("content-encoding")).toBeNull();
      expect((await bytes(r)).equals(plain)).toBe(true);
      expect(r.headers.get("vary")).toBe("Accept-Encoding");
      expect(r.headers.get("cache-control")).toBe(IMMUTABLE);
    }
  });

  test("a file without siblings is served plain with Vary + immutable", async () => {
    const r = await get("/assets/b.js", "gzip, deflate, br, zstd");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-encoding")).toBeNull();
    expect(await r.text()).toBe("export const b = 1;\n");
    expect(r.headers.get("vary")).toBe("Accept-Encoding");
    expect(r.headers.get("cache-control")).toBe(IMMUTABLE);
  });

  test("a missing asset is a 404 without the cache header", async () => {
    const r = await get("/assets/missing.js", "br");
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBeNull();
  });

  test("HTML pages are no-cache and never immutable", async () => {
    for (const [url, title] of [
      ["/", "DM"],
      ["/p/some-token", "Player"],
    ] as const) {
      const r = await get(url, "gzip, deflate, br, zstd");
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-cache");
      expect(await r.text()).toContain(`<title>${title}</title>`);
    }
  });
});
