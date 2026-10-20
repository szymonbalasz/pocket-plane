// CAMP §13 sprint 6 fixtures: `pc-colours` picks Blue's hex, `pc-colour-free` a free lavender;
// bundles `prefs-s6` / `prefs-s6-e2e` load from empty; `pc-colour-free` also loads on top of
// `session-sim-9`'s running encounter (seams S12). Every colour in every viewer's frame is a hex.
import { afterAll, describe, expect, test } from "bun:test";
import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { servicesFromBundle, snapshotFrames } from "@server/ws/testing/snapshot-size";
import { colorClash, PLAYER_COLORS } from "@shared/campaign-management/colors";
import type { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import { library } from "../../index";
import { LAVENDER } from "./pc-colour-free";

const HEX = /^#[0-9a-f]{6}$/;
const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

/** Loads `bundle` and returns each viewer's `player` / `campaign` colours. */
async function colours(lib: typeof library, bundle: string) {
  const loaded = await loadInProcess(lib, bundle, { testMode: true });
  expect(loaded.manifest.status).toBe("complete");
  const b = await servicesFromBundle(loaded);
  cleanups.push(b.cleanup);
  const frames = snapshotFrames(b.s).map((f) => ({
    label: f.label,
    players: Object.fromEntries(
      ((f.records.player ?? []) as PlayerRecord[]).map((p) => [p.name, p.color]),
    ),
    dm: ((f.records.campaign ?? []) as CampaignRecord[]).map((c) => c.dmColor),
  }));
  return { manifest: loaded.manifest, frames };
}

describe("pc-colour-free and prefs-s6 (CAMP §13 sprint 6)", () => {
  test("FR-CAMP-33 prefs-s6 loads from empty: DM Amber, Player 1 Jade, Player 2 lavender, as hex in every viewer's frame; prefs-s6-e2e the same", async () => {
    for (const bundle of ["prefs-s6", "prefs-s6-e2e"]) {
      const { manifest, frames } = await colours(library, bundle);
      expect(manifest.fixtures).toEqual(
        expect.arrayContaining(["pc-colours", "pc-colour-free", "loot-1"]),
      );
      expect(manifest.fixtures.indexOf("pc-colours")).toBeLessThan(
        manifest.fixtures.indexOf("pc-colour-free"),
      );
      expect(frames.map((f) => f.label)).toEqual(["DM", "P1", "P2"]);
      for (const f of frames) {
        expect(f.players).toEqual({ "Player 1": PLAYER_COLORS.jade, "Player 2": LAVENDER });
        expect(f.dm).toEqual([PLAYER_COLORS.amber]);
        for (const c of [...Object.values(f.players), ...f.dm]) expect(c).toMatch(HEX);
      }
    }
  }, 120_000);

  test("FR-CAMP-32 pc-colour-free loads on top of session-sim-9 (seams S12): one DM camp.setColor; lavender ≥ 9 from every other colour there", async () => {
    const lib = {
      ...library,
      bundles: [
        ...library.bundles,
        defineBundle({
          name: "sim9-colour-free",
          includes: ["session-sim-9"],
          fixtures: ["pc-colour-free"],
        }),
      ],
    };
    const { manifest, frames } = await colours(lib, "sim9-colour-free");
    expect(manifest.fixtures.at(-1)).toBe("pc-colour-free");
    for (const f of frames) {
      expect(f.players["Player 2"]).toBe(LAVENDER);
      const others = [
        ...f.dm.map((color) => ({ by: "dm", name: "DM", color })),
        ...Object.entries(f.players)
          .filter(([name]) => name !== "Player 2")
          .map(([name, color]) => ({ by: name, name, color })),
      ];
      expect(colorClash(LAVENDER, others)).toBeNull();
      for (const c of [...Object.values(f.players), ...f.dm]) expect(c).toMatch(HEX);
    }
  }, 120_000);
});
