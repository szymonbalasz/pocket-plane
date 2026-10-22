// Stats preferences (FR-STATS-30, -34): per browser, both on by default, kept in browser storage
// (zod-parsed), memory only when storage fails; never sent.
import { describe, expect, test } from "bun:test";
import { createStatsPrefs, DEFAULT_STATS_PREFS, STATS_PREFS_KEY } from "./prefs";

const backend = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
};

describe("FR-STATS-30 FR-STATS-34 preferences", () => {
  test("FR-STATS-30 Kill feed and FR-STATS-34 Open the fight summary at End: on by default, written per browser, read back; listeners told", () => {
    const b = backend();
    const p = createStatsPrefs(() => b);
    expect(p.read()).toEqual(DEFAULT_STATS_PREFS);
    expect(DEFAULT_STATS_PREFS).toEqual({ feed: true, openSummary: true });
    let told = 0;
    p.subscribe(() => {
      told += 1;
    });
    p.write({ feed: false });
    expect(told).toBe(1);
    expect(JSON.parse(b.m.get(STATS_PREFS_KEY) ?? "null")).toEqual({
      feed: false,
      openSummary: true,
    });
    expect(createStatsPrefs(() => b).read()).toEqual({ feed: false, openSummary: true });
  });

  test("FR-STATS-30 an invalid entry reads as the defaults; storage that throws keeps the choice in memory", () => {
    expect(createStatsPrefs(() => backend({ [STATS_PREFS_KEY]: "{oops" })).read()).toEqual(
      DEFAULT_STATS_PREFS,
    );
    expect(createStatsPrefs(() => backend({ [STATS_PREFS_KEY]: '{"feed":"no"}' })).read()).toEqual(
      DEFAULT_STATS_PREFS,
    );
    const broken = createStatsPrefs(() => {
      throw new Error("blocked");
    });
    broken.write({ openSummary: false });
    expect(broken.read()).toEqual({ feed: true, openSummary: false });
  });
});
