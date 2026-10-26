// Theme choice store and boot script (theme-system FR-THEME-01, -03, -04): `pp.theme.v1` parse,
// invalid and blocked storage, the `data-theme` attribute, and the inline script in both
// index.html files, run here over the same inputs as the store so the two can't disagree.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StorageBackend } from "../features/play-shell/storage";
import {
  applyTheme,
  createThemeStore,
  DEFAULT_THEME,
  parseTheme,
  THEME_IDS,
  THEME_KEY,
  type ThemeId,
} from "./theme";

function memory(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const backend: StorageBackend = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { data, backend };
}

const blocked: StorageBackend = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  };
}

/** Stored strings and the theme they must give; null = no entry. */
const CASES: [string | null, ThemeId][] = [
  [null, "default"],
  ['{"theme":"gilt"}', "gilt"],
  ['{"theme":"default"}', "default"],
  ['{"theme":"gilt","extra":1}', "gilt"],
  ['{"theme":"neon"}', "default"],
  ['{"theme":null}', "default"],
  ["{}", "default"],
  ["null", "default"],
  ['"gilt"', "default"],
  ["not json", "default"],
  ["", "default"],
];

describe("FR-THEME-03 storage", () => {
  test("FR-THEME-03 storage: parse, invalid → Default", () => {
    expect(THEME_KEY).toBe("pp.theme.v1");
    expect(THEME_IDS).toEqual(["default", "gilt"]);
    for (const [raw, want] of CASES) {
      expect({ raw, got: parseTheme(raw) ?? DEFAULT_THEME }).toEqual({ raw, got: want });
      const s = createThemeStore(
        () => memory(raw === null ? {} : { [THEME_KEY]: raw }).backend,
        fakeRoot,
      );
      expect({ raw, read: s.read() }).toEqual({ raw, read: want });
    }
  });

  test("FR-THEME-03 storage: write stores {theme}, applies it at once and notifies this tab", () => {
    const { data, backend } = memory();
    const root = fakeRoot();
    const s = createThemeStore(
      () => backend,
      () => root,
    );
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.write("gilt");
    expect(data.get(THEME_KEY)).toBe('{"theme":"gilt"}');
    expect(root.getAttribute("data-theme")).toBe("gilt");
    expect(s.read()).toBe("gilt");
    s.write("default");
    expect(data.get(THEME_KEY)).toBe('{"theme":"default"}');
    expect(root.getAttribute("data-theme")).toBeNull();
    expect(calls).toBe(2);
    off();
    s.write("gilt");
    expect(calls).toBe(2);
    // One entry, nothing else written (FR-SHELL-76: the one new key OQ-THEME-08 allows).
    expect([...data.keys()]).toEqual([THEME_KEY]);
  });

  test("FR-THEME-03 storage: blocked or missing storage → Default, the choice holds for the page, one warning", () => {
    for (const getBackend of [() => blocked, () => undefined]) {
      const warnings: string[] = [];
      const root = fakeRoot();
      const s = createThemeStore(
        getBackend,
        () => root,
        (m) => warnings.push(m),
      );
      expect(s.read()).toBe("default");
      s.write("gilt");
      expect(s.read()).toBe("gilt");
      expect(root.getAttribute("data-theme")).toBe("gilt");
      s.write("default");
      expect(s.read()).toBe("default");
      expect(warnings).toEqual(["theme: storage unavailable; keeping the choice for this page"]);
    }
    // getBackend itself throwing (access to `localStorage` denied).
    const s = createThemeStore(() => {
      throw new Error("denied");
    }, fakeRoot);
    expect(s.read()).toBe("default");
  });

  test("FR-THEME-03 storage: never sent — the module imports no sync, API or server code", () => {
    const src = readFileSync(join(import.meta.dir, "theme.ts"), "utf8");
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["react", "zod", "../features/play-shell/storage"]);
  });

  test("FR-THEME-01 data-theme on <html>: gilt sets it, Default removes it", () => {
    const root = fakeRoot();
    applyTheme(root, "gilt");
    expect(root.getAttribute("data-theme")).toBe("gilt");
    applyTheme(root, "default");
    expect([...root.attrs.keys()]).toEqual([]);
  });
});

// ---- FR-THEME-04 boot script ----

const CLIENT = join(import.meta.dir, "../..");
const PAGES = ["dm", "player"].map((c) => ({
  client: c,
  html: readFileSync(join(CLIENT, c, "index.html"), "utf8"),
}));

/** The inline (classic) scripts of a page, in document order, with their offsets. */
function inlineScripts(html: string) {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => ({
    attrs: m[1] ?? "",
    body: m[2] ?? "",
    at: m.index,
  }));
}

/** Runs a page's boot script over a stored string (or blocked storage); returns what it did. */
function boot(body: string, stored: string | null | "blocked") {
  const root = fakeRoot();
  const warnings: unknown[][] = [];
  const localStorage =
    stored === "blocked" ? blocked : memory(stored === null ? {} : { [THEME_KEY]: stored }).backend;
  // The script reads the browser globals `localStorage`, `document` and `console`.
  new Function("localStorage", "document", "console", body)(
    localStorage,
    { documentElement: root },
    { warn: (...a: unknown[]) => warnings.push(a) },
  );
  return { theme: root.getAttribute("data-theme"), attrs: root.attrs.size, warnings };
}

describe("FR-THEME-04 boot script", () => {
  for (const { client, html } of PAGES) {
    test(`FR-THEME-04 boot script (${client}): an inline classic script in <head>, before the app's module script, so the attribute is set before React mounts`, () => {
      const scripts = inlineScripts(html);
      const bootScript = scripts.find((s) => s.body.includes(THEME_KEY));
      const app = scripts.find((s) => /type="module"/.test(s.attrs));
      expect(bootScript).toBeDefined();
      expect(app).toBeDefined();
      // Classic and parser-blocking: no src, module, defer or async.
      expect(bootScript?.attrs.trim()).toBe("");
      expect(bootScript!.at).toBeLessThan(html.indexOf("</head>"));
      expect(bootScript!.at).toBeLessThan(app!.at);
      expect(html.indexOf('<div id="root">')).toBeGreaterThan(bootScript!.at);
    });

    test(`FR-THEME-04 boot script (${client}): same result as the store for every stored value; unreadable → Default + one warning`, () => {
      const body = inlineScripts(html).find((s) => s.body.includes(THEME_KEY))!.body;
      for (const [raw, want] of CASES) {
        const r = boot(body, raw);
        expect({ raw, theme: r.theme ?? DEFAULT_THEME }).toEqual({ raw, theme: want });
        if (want === "default") expect(r.attrs).toBe(0);
        const valid = raw === null || parseTheme(raw) !== null;
        expect({ raw, warnings: r.warnings.length }).toEqual({ raw, warnings: valid ? 0 : 1 });
      }
      for (const id of THEME_IDS) {
        expect(boot(body, JSON.stringify({ theme: id })).theme ?? DEFAULT_THEME).toBe(id);
      }
      const b = boot(body, "blocked");
      expect([b.theme, b.warnings.length]).toEqual([null, 1]);
    });
  }

  test("FR-THEME-04 boot script: both index.html files carry the same script; no other page exists", () => {
    const dirs = readdirSync(CLIENT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => readdirSync(join(CLIENT, e.name)).includes("index.html"))
      .map((e) => e.name);
    expect(dirs.sort()).toEqual(["dm", "player"]);
    const [dm, player] = PAGES.map(
      ({ html }) => inlineScripts(html).find((s) => s.body.includes(THEME_KEY))?.body,
    );
    expect(dm).toBe(player!);
  });
});
