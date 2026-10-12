import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  AssetName,
  type AssetRecord,
  nameFromFilename,
  pickerOrder,
} from "@shared/assets-pipeline/schemas";
import sharp from "sharp";
import {
  fitWithin,
  IngestRejected,
  neutralizeSvg,
  processImage,
  sniffFormat,
  svgIntrinsicSize,
} from "./image";

const png = (w: number, h: number, alpha = false) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 0, g: 0, b: 255, alpha: 0.5 } : "#336699",
    },
  })
    .png()
    .toBuffer();

/** PNG whose IHDR claims w×h; no pixel data (header-only checks). */
function pngHeader(w: number, h: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(new Uint8Array(16))),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

async function rejects(p: Promise<unknown>): Promise<IngestRejected> {
  try {
    await p;
  } catch (err) {
    if (err instanceof IngestRejected) return err;
    throw err;
  }
  throw new Error("expected IngestRejected");
}

const svg = (attrs: string, body = '<rect width="10" height="10" fill="red"/>') =>
  new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);

describe("format sniffing (FR-ASSET-01)", () => {
  test("FR-ASSET-01 detects PNG, JPEG, WebP and SVG from content", async () => {
    const p = await png(4, 4);
    expect(sniffFormat(p)).toBe("png");
    expect(sniffFormat(await sharp(p).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffFormat(await sharp(p).webp().toBuffer())).toBe("webp");
    expect(sniffFormat(svg('width="4" height="4"'))).toBe("svg");
    const withProlog = new TextEncoder().encode(
      '\uFEFF<?xml version="1.0"?>\n<!-- hi -->\n<!DOCTYPE svg>\n<svg width="1" height="1"/>',
    );
    expect(sniffFormat(withProlog)).toBe("svg");
  });

  test("FR-ASSET-02 a text file renamed .png is 415", async () => {
    const txt = new TextEncoder().encode("just some notes\n");
    expect(sniffFormat(txt)).toBeNull();
    expect((await rejects(processImage(txt))).status).toBe(415);
  });

  test("FR-ASSET-02 GIF and HTML-with-svg are 415", async () => {
    const gif = await sharp(await png(2, 2))
      .gif()
      .toBuffer();
    expect((await rejects(processImage(gif))).status).toBe(415);
    const html = new TextEncoder().encode("<html><body><svg width='1' height='1'/></body></html>");
    expect((await rejects(processImage(html))).status).toBe(415);
  });
});

describe("SVG size rules (FR-ASSET-02)", () => {
  test("FR-ASSET-02 px width/height win; else the viewBox; neither → null", () => {
    expect(svgIntrinsicSize('<svg width="1400" height="980px">')).toEqual({
      width: 1400,
      height: 980,
      useViewBox: false,
    });
    expect(svgIntrinsicSize('<svg viewBox="0 0 300 200">')).toEqual({
      width: 300,
      height: 200,
      useViewBox: true,
    });
    expect(svgIntrinsicSize('<svg width="50%" height="10cm" viewBox="0,0,30,20">')).toEqual({
      width: 30,
      height: 20,
      useViewBox: true,
    });
    expect(svgIntrinsicSize("<svg>")).toBeNull();
    expect(svgIntrinsicSize('<svg width="10">')).toBeNull();
  });

  test("FR-ASSET-02 SVG without size and viewBox is 422", async () => {
    expect((await rejects(processImage(svg("")))).status).toBe(422);
  });

  test("FR-ASSET-02 SVG megapixels come from the attributes, before rasterising", async () => {
    const r = await rejects(processImage(svg('width="10000" height="6000"')));
    expect(r.status).toBe(422);
    expect(r.message).toBe("Image over 50 megapixels");
  });

  test("FR-ASSET-02 SVG is rasterised at intrinsic size and stored as PNG", async () => {
    const out = await processImage(svg('viewBox="0 0 300 200"'));
    expect(out.mime).toBe("image/png");
    expect(sniffFormat(out.original)).toBe("png");
    expect([out.width, out.height]).toEqual([300, 200]);
    const meta = await sharp(out.original).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  test("FR-ASSET-02 external references are blanked; entities refused", async () => {
    const s = neutralizeSvg(
      `<svg><image href="http://x/a.png"/><image xlink:href='file:///etc/passwd'/><use href="#a"/><rect style="fill:url(http://x/p)"/><style>@import url(http://x/s.css);</style></svg>`,
    );
    expect(s).not.toContain("http://");
    expect(s).not.toContain("file:");
    expect(s).toContain('href="#a"');
    const xxe = new TextEncoder().encode(
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg width="1" height="1">&x;</svg>',
    );
    expect((await rejects(processImage(xxe))).status).toBe(422);
  });
});

describe("size maths and derivatives (FR-ASSET-05)", () => {
  test("FR-ASSET-05 fitWithin never upscales and keeps aspect", () => {
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(6000, 4000, 4096)).toEqual({ width: 4096, height: 2731 });
    expect(fitWithin(6000, 4000, 512)).toEqual({ width: 512, height: 341 });
    expect(fitWithin(980, 1400, 512)).toEqual({ width: 358, height: 512 });
    expect(fitWithin(10000, 1, 512)).toEqual({ width: 512, height: 1 });
  });

  test("FR-ASSET-05 thumb ≤ 512 and display ≤ 4096 WebP; small images not upscaled", async () => {
    const big = await processImage(await png(1400, 980));
    expect(sniffFormat(big.thumb.data)).toBe("webp");
    expect(sniffFormat(big.display.data)).toBe("webp");
    expect([big.thumb.width, big.thumb.height]).toEqual([512, 358]);
    expect([big.display.width, big.display.height]).toEqual([1400, 980]);
    const small = await processImage(await png(64, 32));
    expect([small.thumb.width, small.thumb.height]).toEqual([64, 32]);
  });

  test("FR-ASSET-05 alpha kept, metadata stripped, EXIF orientation applied", async () => {
    const alpha = await processImage(await png(40, 20, true));
    expect((await sharp(alpha.thumb.data).metadata()).hasAlpha).toBe(true);

    const rotated = await sharp(await png(40, 20))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processImage(rotated);
    expect([out.width, out.height]).toEqual([20, 40]);
    expect([out.display.width, out.display.height]).toEqual([20, 40]);
    const meta = await sharp(out.display.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  test("FR-ASSET-02 animated WebP → first frame", async () => {
    const frames = await Promise.all([png(30, 20), png(30, 20, true)]);
    const anim = await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer();
    expect((await sharp(anim).metadata()).pages).toBe(2);
    const out = await processImage(anim);
    expect([out.width, out.height]).toEqual([30, 20]);
    expect((await sharp(out.display.data).metadata()).pages ?? 1).toBe(1);
  });

  test("FR-ASSET-03 hash is SHA-256 of the stored original; deterministic", async () => {
    const p = await png(10, 10);
    const a = await processImage(p);
    const b = await processImage(p);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(new Bun.CryptoHasher("sha256").update(p).digest("hex"));
    expect(Buffer.from(a.display.data).equals(Buffer.from(b.display.data))).toBe(true);
  });
});

describe("limits (FR-ASSET-02)", () => {
  test("FR-ASSET-02 > 50 MP from the header is 422 before pixel decode", async () => {
    const r = await rejects(processImage(pngHeader(10_000, 6_000)));
    expect(r.status).toBe(422);
    expect(r.message).toBe("Image over 50 megapixels");
  });

  test("FR-ASSET-02 corrupt image is 422", async () => {
    const p = await png(200, 200);
    const truncated = p.subarray(0, Math.floor(p.length / 2));
    expect((await rejects(processImage(truncated))).status).toBe(422);
    expect((await rejects(processImage(pngHeader(10, 10)))).status).toBe(422);
  });
});

describe("names and picker order (FR-ASSET-08, -10)", () => {
  test("FR-ASSET-08 name = filename without extension; control chars removed, trimmed, 1–80", () => {
    expect(nameFromFilename("maps/Town Square.final.png")).toBe("Town Square.final");
    expect(nameFromFilename("C:\\x\\goblin.svg")).toBe("goblin");
    expect(nameFromFilename("noext")).toBe("noext");
    expect(nameFromFilename(".hidden")).toBe(".hidden");
    expect(AssetName.parse("  Mira\u0007 token \n")).toBe("Mira token");
    expect(AssetName.safeParse(" \u0001 ").success).toBe(false);
    expect(AssetName.safeParse("x".repeat(80)).success).toBe(true);
    expect(AssetName.safeParse("x".repeat(81)).success).toBe(false);
  });

  test("FR-ASSET-10 picker order: createdAt desc, then seq desc", () => {
    const a = (seq: number, createdAt: string) => ({ seq, createdAt }) as AssetRecord;
    const sorted = [
      a(1, "2026-01-01T00:00:00.000Z"),
      a(3, "2026-01-01T00:00:00.000Z"),
      a(2, "2026-01-01T00:00:00.000Z"),
      a(4, "2025-12-31T00:00:00.000Z"),
      a(0, "2026-02-01T00:00:00.000Z"),
    ].sort(pickerOrder);
    expect(sorted.map((x) => x.seq)).toEqual([0, 3, 2, 1, 4]);
  });
});
