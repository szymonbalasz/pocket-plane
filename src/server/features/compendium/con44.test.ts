// CMP §12 / §13 CON-44 for C2 (#208 ceilings: DM 1 MiB, players 512 KiB, no headroom guard):
// the realistic-heavy harness on `session-sim`, then the full bundled `srd-5.1` import. The
// compendium's per-type bound: no snapshot grows (0 B; `imported-entity` is lazy, FR-CMP-15) and
// every viewer stays under its ceiling (FR-CMP-30). The worst `sync.load` of imported definitions
// (50 largest rows) is logged for §12.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { HOUSE_RULES_CHAPTER } from "@shared/compendium/schemas";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { campaign } from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import { lazyLoadSizes } from "../../ws/testing/lazy-probe";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
  type ViewerSize,
} from "../../ws/testing/snapshot-size";
import { PUT_ENTRY } from "./homebrew";
import { IMPORT_RECORDED, type ImportResult } from "./import";
import { bundledSource } from "./sources";
import { SRD_51_SOURCE } from "./sources/srd-5.1/source";

/** CMP §12 worst `sync.load` of imported definitions: 50 × ≤ 1.3 KB ≈ 66 KB. */
const LOAD_ACK_MAX = 70 * 1024;

describe("CON-44 with the full SRD import (CMP §12, FR-CMP-30)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let before: ViewerSize[];
  let after: ViewerSize[];
  let result: ImportResult;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    before = snapshotSizes(b.s);
    const cid = b.s.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id;
    const src = bundledSource("srd-5.1");
    // The internal twin: the heavy harness has a started encounter (cmp.import refuses then).
    result = b.s.commands.run(
      IMPORT_RECORDED,
      {
        source: { ...SRD_51_SOURCE },
        version: src.bundled.version,
        responses: src.bundled.responses,
      },
      { actor: { role: "dm", playerId: null, campaignId: cid ?? null } },
    ) as ImportResult;
    after = snapshotSizes(b.s);
  }, 120_000);
  afterAll(() => b.cleanup());

  test("CON-44 FR-CMP-30 full import: no viewer's snapshot grows (0 B), DM < 1 MiB, players < 512 KiB, no imported-entity in any snapshot", () => {
    expect(result.changed).toBe(true);
    expect(result.counts.monster.created).toBe(322);
    expect(after.map((v) => v.label)).toEqual(before.map((v) => v.label));
    for (const [i, v] of after.entries()) {
      const was = before[i] as ViewerSize;
      expect({ viewer: v.label, growth: v.bytes - was.bytes }).toEqual({
        viewer: v.label,
        growth: 0,
      });
      expect(v.types[IMPORTED_ENTITY_TYPE]).toBeUndefined();
      const ceiling = v.role === "dm" ? SNAPSHOT_CEILING.dm : SNAPSHOT_CEILING.player;
      expect({ viewer: v.label, over: v.bytes > ceiling }).toEqual({
        viewer: v.label,
        over: false,
      });
    }
    const dm = after[0] as ViewerSize;
    const players = after.slice(1);
    console.log(
      `CMP CON-44 (C2): heavy DM ${dm.bytes} B before and after the full SRD import (${1_048_576 - dm.bytes} B left of 1 MiB); players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B`,
    );
  });

  test("FR-CMP-71 CON-44 rules 0 B: the full import's 160 rule cards and two house rules add nothing to any viewer's snapshot (REST only, no record type)", () => {
    expect(result.counts.rule.created).toBe(160);
    const cid = b.s.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id ?? null;
    for (const [name, shared] of [
      ["CON-44 house rule shared", true],
      ["CON-44 house rule hidden", false],
    ] as const) {
      b.s.commands.run(
        PUT_ENTRY,
        {
          shared,
          entry: {
            kind: "rule",
            name,
            facets: { chapter: HOUSE_RULES_CHAPTER, section: "Combat", order: 0 },
            body: { text: "x".repeat(4_000) },
          },
        },
        { actor: { role: "dm", playerId: null, campaignId: cid } },
      );
    }
    const now = snapshotSizes(b.s);
    for (const [i, v] of now.entries()) {
      const was = before[i] as ViewerSize;
      expect({ viewer: v.label, growth: v.bytes - was.bytes }).toEqual({
        viewer: v.label,
        growth: 0,
      });
    }
  });

  test("CMP §12 worst imported-entity load: 50 largest definitions ≤ 70 KB for the DM; players refused (audience dm)", () => {
    const viewers = snapshotFrames(b.s).map((f) => ({ label: f.label, viewer: f.viewer }));
    const sizes = lazyLoadSizes(b.s, IMPORTED_ENTITY_TYPE, viewers);
    const dm = sizes.find((s) => s.label === "DM");
    expect(dm?.rows).toBe(50);
    expect(dm?.bytes).toBeLessThanOrEqual(LOAD_ACK_MAX);
    for (const p of sizes.filter((s) => s.label !== "DM")) expect(p.rows).toBe(0);
    console.log(`CMP CON-44 (C2): worst imported-entity load DM ${dm?.rows} rows ${dm?.bytes} B`);
  });
});
