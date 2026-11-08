// Makes `fixtures/assets/tokens/animated-wisp.webm` (animated-tokens fixture, FR-ANIM tests):
// a 1 s, 128 px, see-through loop drawn on a canvas in Playwright's Chromium and recorded with
// MediaRecorder (VP9 or VP8 with alpha). Original work, CC0. Run by hand with Node (Playwright hangs under Bun on Windows): `node scripts/make-animated-fixture.ts`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "assets",
  "tokens",
  "animated-wisp.webm",
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const b64 = await page.evaluate(async () => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d", { alpha: true }) as CanvasRenderingContext2D;
    const stream = canvas.captureStream(24);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 300_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((r) => {
      rec.onstop = () => r();
    });
    const t0 = performance.now();
    const draw = () => {
      const t = ((performance.now() - t0) / 1000) % 1;
      g.clearRect(0, 0, size, size);
      const a = t * Math.PI * 2;
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 44 + 8 * Math.sin(a));
      grad.addColorStop(0, "rgba(220, 240, 255, 1)");
      grad.addColorStop(0.5, "rgba(120, 180, 255, 0.8)");
      grad.addColorStop(1, "rgba(60, 120, 255, 0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(64, 64, 56, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.95)";
      g.beginPath();
      g.arc(64 + 30 * Math.cos(a), 64 + 30 * Math.sin(a), 8, 0, Math.PI * 2);
      g.fill();
    };
    draw();
    rec.start();
    await new Promise<void>((r) => {
      const tick = () => {
        draw();
        if (performance.now() - t0 < 1100) setTimeout(tick, 20);
        else r();
      };
      setTimeout(tick, 20);
    });
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let s = "";
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  const bytes = Buffer.from(b64, "base64");
  writeFileSync(OUT, bytes);
  console.log(`Wrote ${OUT} (${bytes.byteLength} bytes)`);
} finally {
  await browser.close();
}
