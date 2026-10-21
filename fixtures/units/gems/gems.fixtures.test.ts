// GEM §13 fixtures: `gems-on`, `gems-awarded`, `gems-hidden`; bundles `gems`, `gems-hidden`,
// `gems-e2e`, `gems-ui-e2e` (GM3). Every other bundle keeps gems off (FR-GEM-01): only these
// units switch it.
import { afterAll, describe, expect, test } from "bun:test";
import { campaign, characterGems, entity, gameLogEntry } from "@server/db/schema";
import { SET_FEATURE_INTENT } from "@server/features/campaign-management/features";
import { servicesFromBundle, snapshotFrames } from "@server/ws/testing/snapshot-size";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { CHARACTER_GEMS_TYPE, type CharacterGemsRecord, GEM_KINDS } from "@shared/gems/schemas";
import { eq } from "drizzle-orm";
import { library, loadBundle } from "../../index";
import { GEMS_AWARDED } from "./gems-awarded";

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

/** Every fixture key a bundle loads (its includes first). */
function closure(name: string): string[] {
  const b = library.bundles.find((x) => x.name === name);
  if (!b) throw new Error(`no bundle ${name}`);
  const keys = new Set<string>();
  const add = (key: string) => {
    if (keys.has(key)) return;
    const f = library.fixtures.find((x) => x.key === key);
    for (const r of f?.requires ?? []) add(r);
    keys.add(key);
  };
  for (const inc of b.includes) for (const k of closure(inc)) add(k);
  for (const k of b.fixtures) add(k);
  return [...keys];
}

const GEM_BUNDLES = ["gems", "gems-hidden", "gems-e2e", "gems-ui-e2e"];

async function frames(bundle: string) {
  const loaded = await loadBundle(bundle, { testMode: true });
  expect(loaded.manifest.status).toBe("complete");
  const b = await servicesFromBundle(loaded);
  cleanups.push(b.cleanup);
  return { s: b.s, frames: snapshotFrames(b.s) };
}

describe("gems fixtures (GEM §13)", () => {
  test("FR-GEM-01 bundles off: only gems-on / gems-hidden switch a feature; no other bundle loads gems-on", () => {
    const switching = library.fixtures
      .filter((f) => f.kind === "setup" && f.steps.some((s) => s.command === SET_FEATURE_INTENT))
      .map((f) => f.key)
      .sort();
    expect(switching).toEqual(["gems-hidden", "gems-on"]);
    const withGems = library.bundles
      .map((b) => b.name)
      .filter((n) => closure(n).includes("gems-on"))
      .sort();
    expect(withGems).toEqual([...GEM_BUNDLES].sort());
    // Of those, only `gems` ends with gems on.
    for (const n of ["gems-hidden", "gems-e2e", "gems-ui-e2e"]) {
      expect(closure(n).at(-1)).toBe("gems-hidden");
    }
    expect(closure("session-sim-11")).not.toContain("gems-on");
  });

  test("FR-GEM-01 FR-GEM-06 FR-GEM-09 FR-GEM-10 gems: on; counts per GEM §13 for DM and both players; one public award line per adjust", async () => {
    const { s, frames: fs } = await frames("gems");
    const names = Object.fromEntries(
      s.db
        .select({ id: entity.id, name: entity.name })
        .from(entity)
        .where(eq(entity.kind, "character"))
        .all()
        .map((e) => [e.id, e.name]),
    );
    const want: Record<string, Record<string, number>> = {};
    for (const [who, counts] of Object.entries(GEMS_AWARDED)) {
      want[who[0]?.toUpperCase() + who.slice(1)] = Object.fromEntries(
        GEM_KINDS.map((g) => [g, counts[g] ?? 0]),
      );
    }
    expect(fs.map((f) => f.label)).toEqual(["DM", "P1", "P2"]);
    for (const f of fs) {
      expect((f.records.campaign as CampaignRecord[])[0]?.features).toEqual(["gems"]);
      const rows = (f.records[CHARACTER_GEMS_TYPE] ?? []) as CharacterGemsRecord[];
      const got = Object.fromEntries(
        rows.map((r) => [
          names[r.characterId],
          Object.fromEntries(GEM_KINDS.map((g) => [g, r[g]])),
        ]),
      );
      expect([f.label, got]).toEqual([f.label, want]);
      const lines = ((f.records["game-log-entry"] ?? []) as GameLogEntryRecord[])
        .filter((e) => e.kind === "gem.award")
        .map((e) => lineText(formatEntry(e).segments));
      expect(lines).toHaveLength(9);
      expect(lines).toContain("DM awards Mira 2 Inspiration gems (2 held)");
      expect(lines).toContain("DM awards Brakka 5 Fortune gems (5 held)");
      expect(lines).toContain("DM awards Brakka a Fortune gem (6 held)");
      expect(lines).toContain("DM awards Thorn an Inspiration gem (1 held)");
    }
  }, 180_000);

  test("FR-GEM-02 FR-GEM-04 gems-hidden and gems-e2e: rows and lines kept in the DB; no gem record, line or `features` key in any viewer's snapshot", async () => {
    for (const bundle of ["gems-hidden", "gems-e2e"]) {
      const { s, frames: fs } = await frames(bundle);
      expect(s.db.select().from(characterGems).all()).toHaveLength(3);
      expect(
        s.db.select().from(gameLogEntry).where(eq(gameLogEntry.kind, "gem.award")).all(),
      ).toHaveLength(9);
      for (const c of s.db.select({ f: campaign.features }).from(campaign).all()) {
        expect(c.f).toEqual([]);
      }
      for (const f of fs) {
        const raw = JSON.stringify(f.records);
        expect([bundle, f.label, raw.includes(CHARACTER_GEMS_TYPE)]).toEqual([
          bundle,
          f.label,
          false,
        ]);
        expect(raw).not.toContain('"gem.');
        for (const c of f.records.campaign as CampaignRecord[]) expect("features" in c).toBe(false);
        expect(Object.keys(f.records)).not.toContain(CHARACTER_GEMS_TYPE);
      }
    }
  }, 300_000);
});
