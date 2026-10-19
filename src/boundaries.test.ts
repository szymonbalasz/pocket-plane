// Import boundaries (AGENTS §9.1), enforced over every source file.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const AREAS = {
  server: "src/server",
  shared: "src/shared",
  ui: "src/client/common",
  dm: "src/client/dm",
  player: "src/client/player",
  fixtures: "fixtures",
} as const;
type Area = keyof typeof AREAS;
const ALIAS: Record<string, Area> = {
  "@server/": "server",
  "@shared/": "shared",
  "@ui/": "ui",
  "@dm/": "dm",
  "@player/": "player",
  "@fixtures/": "fixtures",
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

function areaOfPath(abs: string): Area | null {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  const hit = (Object.entries(AREAS) as [Area, string][])
    .filter(([, p]) => rel === p || rel.startsWith(`${p}/`))
    .sort((a, b) => b[1].length - a[1].length)[0];
  return hit?.[0] ?? null;
}

interface Imp {
  spec: string;
  typeOnly: boolean;
  names: string;
}

function imports(src: string): Imp[] {
  const out: Imp[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    out.push({ spec: m[4] as string, typeOnly: Boolean(m[2]), names: m[3] ?? "" });
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    out.push({ spec: m[1] as string, typeOnly: false, names: "" });
  }
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ spec: m[1] as string, typeOnly: false, names: "" });
  }
  return out;
}

function target(fromFile: string, spec: string): Area | "package" | null {
  for (const [prefix, area] of Object.entries(ALIAS)) if (spec.startsWith(prefix)) return area;
  if (spec.startsWith(".")) return areaOfPath(path.resolve(ROOT, path.dirname(fromFile), spec));
  return "package";
}

const ALLOWED: Record<Area, Area[]> = {
  server: ["server", "shared"],
  shared: ["shared"],
  ui: ["ui", "shared"],
  dm: ["dm", "ui", "shared"],
  player: ["player", "ui", "shared"],
  fixtures: ["fixtures", "server", "shared"],
};
const CLIENTS: Area[] = ["ui", "dm", "player"];

describe("import boundaries (AGENTS §9.1)", () => {
  const all = (Object.keys(AREAS) as Area[]).flatMap((a) =>
    files(AREAS[a]).map((f) => ({ file: f, area: a })),
  );

  test("each area imports only what it may", () => {
    const violations: string[] = [];
    for (const { file, area } of all) {
      if (/\.(test|bench)\.tsx?$/.test(file) && area === "server") continue; // server tests may use anything server-side
      const src = readFileSync(path.join(ROOT, file), "utf8");
      for (const imp of imports(src)) {
        const t = target(file, imp.spec);
        if (t === null) {
          violations.push(`${file}: "${imp.spec}" resolves outside the source areas`);
          continue;
        }
        if (t === "package") {
          const isTest = /\.(test|bench)\.tsx?$/.test(file);
          if (area === "shared" && imp.spec !== "zod" && !(isTest && imp.spec === "bun:test")) {
            violations.push(`${file}: @shared may import zod only, not "${imp.spec}"`);
          }
          continue;
        }
        if (CLIENTS.includes(area) && t === "server") {
          const ok =
            imp.spec === "@server/app" && imp.typeOnly && /^\{\s*AppType\s*\}$/.test(imp.names);
          if (!ok)
            violations.push(
              `${file}: clients may only \`import type { AppType } from "@server/app"\``,
            );
          continue;
        }
        if (!ALLOWED[area].includes(t))
          violations.push(`${file}: ${area} must not import ${t} ("${imp.spec}")`);
      }
    }
    expect(violations).toEqual([]);
    // ~470 synchronous file reads (~0.1 s): a GC pause or a Windows AV scan landing here once took 5.6 s.
  }, 30_000);

  test("the checker catches violations", () => {
    expect(target("src/client/dm/x.ts", "@player/App")).toBe("player");
    expect(target("src/client/common/x.ts", "../dm/App")).toBe("dm");
    expect(imports('import type { AppType } from "@server/app";')[0]).toMatchObject({
      typeOnly: true,
    });
    expect(imports('import { createApp } from "@server/app";')[0]).toMatchObject({
      typeOnly: false,
    });
  });
});
