// CAMP §12 (OQ-CAMP-31 A): the hand-rolled colour picker's own code, measured as the spike was
// (`bun build --minify`, everything outside the picker external: React, the rules module, the
// Slider / Popover / Input / Button, `colorOf`; `gzip -9`): `ColorPicker.tsx` (picker + Players
// panel Popover), `color-picker.ts` (model: HSV, clamp, mask) and `ColorSection.tsx`.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1024;
/** The spike measured 3.6 KB; this build (incl. the Players panel Popover and the section) ≈ 4.8 KB. */
const PICKER_MAX = 5 * KB;
const OWN = ["ColorPicker.tsx", "color-picker.ts", "ColorSection.tsx"].map((f) =>
  path.join(import.meta.dir, f),
);

test("FR-CAMP-35 picker: the colour picker's own code ≤ 5 KB gz minified (spec ≈ 3.6 KB, OQ-CAMP-31 spike)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-picker-"));
  const entry = path.join(dir, "entry.ts");
  const spec = (p: string) => JSON.stringify(p.replaceAll("\\", "/"));
  writeFileSync(entry, OWN.map((p) => `export * from ${spec(p)};`).join("\n"));
  try {
    const out = await Bun.build({
      entrypoints: [entry],
      minify: true,
      target: "browser",
      format: "esm",
      // `bun test` would give the dev JSX runtime: measure what ships.
      jsx: { development: false },
      plugins: [
        {
          name: "picker-only",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => {
              if (!a.importer || a.importer === entry) return;
              const p = a.path.startsWith(".")
                ? path.resolve(path.dirname(a.importer), a.path)
                : "";
              const own = ["", ".ts", ".tsx"].map((x) => p + x).find((x) => OWN.includes(x));
              return own ? { path: own } : { path: a.path, external: true };
            });
          },
        },
      ],
    });
    expect(out.success).toBe(true);
    const code = (await Promise.all(out.outputs.map((o) => o.text()))).join("\n");
    expect(code).not.toContain("jsxDEV");
    const size = gzipSync(code, { level: 9 }).length;
    console.log(`[bundle] colour picker ${(size / KB).toFixed(2)} KB gz (${code.length} B min)`);
    expect(size).toBeLessThanOrEqual(PICKER_MAX);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
