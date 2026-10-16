import { expect, test } from "bun:test";
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  effectiveRender,
  parseSettings,
  settingsKey,
} from "./settings";

test("FR-DICEX-21 key per campaign and owner", () => {
  expect(settingsKey("c1", "dm", null)).toBe("pp.dicex.v1.c1.dm");
  expect(settingsKey("c1", "player", "p1")).toBe("pp.dicex.v1.c1.p1");
});

test("FR-DICEX-21 parse: valid JSON kept, anything invalid → defaults (3d, others on)", () => {
  expect(parseSettings('{"render":"off","others":false}')).toEqual({
    render: "off",
    others: false,
  });
  expect(DEFAULT_SETTINGS).toEqual({ render: "3d", others: true });
  for (const bad of [
    null,
    "",
    "not json",
    '{"render":"4d","others":true}',
    '{"render":"flat"}',
    "[]",
  ]) {
    expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  }
});

test("FR-DICEX-21 reduced motion or no WebGL → flat; flat / off unchanged", () => {
  expect(effectiveRender("3d", { reducedMotion: false, threeD: true })).toBe("3d");
  expect(effectiveRender("3d", { reducedMotion: true, threeD: true })).toBe("flat");
  expect(effectiveRender("3d", { reducedMotion: false, threeD: false })).toBe("flat");
  expect(effectiveRender("off", { reducedMotion: true, threeD: true })).toBe("off");
  expect(effectiveRender("flat", { reducedMotion: false, threeD: true })).toBe("flat");
});

test("FR-DICEX-21 storage round-trip; throwing / missing storage → memory", () => {
  const data = new Map<string, string>();
  const ok = createSettingsStore(() => ({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }));
  let calls = 0;
  ok.subscribe(() => {
    calls += 1;
  });
  ok.write("k", { render: "off", others: false });
  expect(JSON.parse(data.get("k") ?? "")).toEqual({ render: "off", others: false });
  expect(ok.read("k")).toEqual({ render: "off", others: false });
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
  broken.write("k", { render: "flat", others: true });
  expect(broken.read("k")).toEqual({ render: "flat", others: true });
  const none = createSettingsStore(() => undefined);
  none.write("k", { render: "off", others: true });
  expect(none.read("k").render).toBe("off");
});
