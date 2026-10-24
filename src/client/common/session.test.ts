// BL-94 (sprint 10 H4): the one client credential / session helper, and no copies of the DM
// secret key, the `/p/<token>` rule or the skip cue's "(dead)" text left elsewhere.
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { skipText } from "./features/combat-extras/skip";
import { DM_SECRET_KEY, linkTokenFromPath, readDmSecret, writeDmSecret } from "./session";

const g = globalThis as { localStorage?: unknown };
const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (had) Object.defineProperty(globalThis, "localStorage", had);
  else delete g.localStorage;
});

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

const ROOT = path.resolve(import.meta.dir, "..");
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(dir, f));
}

describe("BL-94 client session helper", () => {
  test("FR-CAMP-04 BL-94 the DM secret: written, read back and forgotten under one key; blocked storage reads null and never throws", () => {
    const s = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true });
    expect(readDmSecret()).toBeNull();
    writeDmSecret("dm-secret-123");
    expect(s.m.get(DM_SECRET_KEY)).toBe("dm-secret-123");
    expect(readDmSecret()).toBe("dm-secret-123");
    writeDmSecret(null);
    expect(readDmSecret()).toBeNull();
    const blocked = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: blocked, configurable: true });
    expect(readDmSecret()).toBeNull();
    expect(() => writeDmSecret("x")).not.toThrow();
  });

  test("FR-CMP-13 BL-94 a player page's link token from its path (decoded); none elsewhere", () => {
    expect(linkTokenFromPath("/p/abc%2Fdef")).toBe("abc/def");
    expect(linkTokenFromPath("/p/tok123/")).toBe("tok123");
    expect(linkTokenFromPath("/p/")).toBeNull();
    expect(linkTokenFromPath("/")).toBeNull();
  });

  test("FR-CBTX-25 BL-94 one skip cue for the Initiative window and the palette", () => {
    expect(skipText({ names: ["Goblin", "Thorn"], round: 2 }, new Set(["Thorn"]))).toBe(
      "Skipped Goblin (down), Thorn (dead) · Round 2",
    );
  });

  test("BL-94 no copies: the DM secret key, the /p/<token> rule and the '(dead)' skip text live in one file each", () => {
    const files = sources(ROOT);
    const holders = (re: RegExp) =>
      files
        .filter((f) => re.test(readFileSync(f, "utf8")))
        .map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
    expect(holders(/pocket-plane\.dmSecret/)).toEqual(["common/session.ts"]);
    expect(holders(/\/\^\\\/p\\\/\(/)).toEqual(["common/session.ts"]);
    expect(holders(/\(dead\)`/)).toEqual(["common/features/combat-extras/skip.ts"]);
  });
});
