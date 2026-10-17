import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  DisplaySetting,
  effectiveDisplay,
  migrateV1,
  parseSettings,
  type SettingsBackend,
  settingsKey,
} from "./settings";

const memoryBackend = (data: Map<string, string>): SettingsBackend => ({
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => void data.set(k, v),
});

test("FR-DICEX-36 settings v2: key per campaign and owner", () => {
  expect(settingsKey("c1", "dm", null)).toBe("pp.dicex.v2.c1.dm");
  expect(settingsKey("c1", "player", "p1")).toBe("pp.dicex.v2.c1.p1");
});

test("FR-DICEX-36 settings v2: defaults (screen, others on, popups on); invalid → defaults", () => {
  expect(DEFAULT_SETTINGS).toEqual({ display: "screen", others: true, popup: true });
  expect(parseSettings('{"display":"zone","others":false,"popup":false}')).toEqual({
    display: "zone",
    others: false,
    popup: false,
  });
  for (const bad of [
    null,
    "",
    "not json",
    '{"display":"3d","others":true,"popup":true}',
    '{"display":"flat","others":true}',
    '{"render":"flat","others":true}',
    "[]",
  ]) {
    expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  }
});

test("FR-DICEX-36 settings v2: a v1 entry migrates once (3d → screen, flat / off kept, others kept)", () => {
  expect(migrateV1('{"render":"3d","others":false}')).toEqual({
    display: "screen",
    others: false,
    popup: true,
  });
  expect(migrateV1('{"render":"flat","others":true}')?.display).toBe("flat");
  expect(migrateV1('{"render":"off","others":true}')?.display).toBe("off");
  expect(migrateV1('{"render":"4d","others":true}')).toBeNull();
  expect(migrateV1(null)).toBeNull();

  const data = new Map([["pp.dicex.v1.c1.p1", '{"render":"off","others":false}']]);
  const s = createSettingsStore(() => memoryBackend(data));
  const key = settingsKey("c1", "player", "p1");
  expect(s.read(key)).toEqual({ display: "off", others: false, popup: true });
  // Written once as v2: later reads come from v2, a v1 change no longer matters.
  expect(JSON.parse(data.get(key) ?? "")).toEqual({ display: "off", others: false, popup: true });
  data.set("pp.dicex.v1.c1.p1", '{"render":"3d","others":true}');
  expect(s.read(key).display).toBe("off");
  // Another owner's v1 entry stays theirs; no v1 → defaults.
  expect(s.read(settingsKey("c1", "dm", null))).toEqual(DEFAULT_SETTINGS);
});

test("FR-DICEX-32 no WebGL / failed chunk → effective flat; flat / off unchanged", () => {
  for (const d of ["screen", "zone"] as const) {
    expect(effectiveDisplay(d, { threeD: true })).toBe(d);
    expect(effectiveDisplay(d, { threeD: false })).toBe("flat");
  }
  expect(effectiveDisplay("off", { threeD: true })).toBe("off");
  expect(effectiveDisplay("flat", { threeD: true })).toBe("flat");
});

test("FR-DICEX-45 (#247) the OS reduced-motion preference is ignored: display modes as without it, no dice code reads it", () => {
  const g = globalThis as { matchMedia?: unknown };
  const before = g.matchMedia;
  g.matchMedia = () => ({ matches: true });
  try {
    for (const d of DisplaySetting.options) {
      expect(effectiveDisplay(d, { threeD: true })).toBe(d);
    }
  } finally {
    g.matchMedia = before;
  }
  // No dice-extras module consults the preference or styles for it.
  const dir = import.meta.dir;
  const sources = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
  const hits = sources.filter((f) =>
    /prefers-reduced-motion|motion-reduce:|reducedMotion/.test(
      readFileSync(path.join(dir, f), "utf8"),
    ),
  );
  expect(hits).toEqual([]);
});

test("FR-DICEX-36 storage round-trip; throwing / missing storage → memory", () => {
  const data = new Map<string, string>();
  const ok = createSettingsStore(() => memoryBackend(data));
  let calls = 0;
  ok.subscribe(() => {
    calls += 1;
  });
  const v = { display: "off", others: false, popup: true } as const;
  ok.write("k", v);
  expect(JSON.parse(data.get("k") ?? "")).toEqual(v);
  expect(ok.read("k")).toEqual(v);
  expect(ok.read("k")).toBe(ok.read("k")); // stable snapshot
  expect(calls).toBe(1);

  const broken = createSettingsStore(() => ({
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  }));
  expect(broken.read("k")).toEqual(DEFAULT_SETTINGS);
  broken.write("k", { ...DEFAULT_SETTINGS, display: "flat" });
  expect(broken.read("k").display).toBe("flat");
  const none = createSettingsStore(() => undefined);
  none.write("k", { ...DEFAULT_SETTINGS, display: "off" });
  expect(none.read("k").display).toBe("off");
  // A v1 entry with storage that refuses writes migrates into memory.
  const ro = createSettingsStore(() => ({
    getItem: (k) => (k === "pp.dicex.v1.c1.dm" ? '{"render":"flat","others":true}' : null),
    setItem: () => {
      throw new Error("quota");
    },
  }));
  expect(ro.read(settingsKey("c1", "dm", null)).display).toBe("flat");
});
