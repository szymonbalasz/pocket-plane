// FR-FOG-40 (OQ-FOG-27 A, ADR-0042) migration proof on the sprint-2 bundles: rows whose
// per-player copies are null (as the schema push leaves them) read as hidden for every player;
// the boot backfill re-derives them, after which every DM and player snapshot is byte-equal to
// the one before (and to sprint 2's static filter, re-stated here from `fogged` / `f`). A rerun
// is a no-op. A campaign with no players: `derive.test.ts`.
import { describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import {
  AOE_TEMPLATE_TYPE,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
} from "@shared/scene-tools/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { fixedClock, realContext } from "../../commands/context";
import { aoeTemplate, prop, scene, sceneStructure, token } from "../../db/schema";
import type { Services } from "../../services";
import { servicesFromBundle, snapshotFrames } from "../../ws/testing/snapshot-size";
import { backfillSeenBy, scenesNeedingBackfill } from "./backfill";

const ctx = () => realContext(fixedClock("2026-10-16T00:00:00.000Z"));
const frames = (s: Services) =>
  snapshotFrames(s).map((f) => ({ label: f.label, json: JSON.stringify(f.records) }));

/** What the schema push leaves on a sprint-2 DB: every copy null. */
function nullCopies(s: Services) {
  s.db.update(token).set({ seenBy: null }).run();
  s.db.update(prop).set({ seenBy: null }).run();
  s.db.update(aoeTemplate).set({ seenBy: null }).run();
  s.db.update(sceneStructure).set({ doorSeen: null }).run();
}

type Row = Record<string, unknown> & { id: string };
const ids = (rows: unknown[] | undefined) => ((rows ?? []) as Row[]).map((r) => r.id).sort();

/** Sprint 2's static filter for the active scene, from the stored `fogged` / `f` copies. */
function sprint2View(s: Services, playerId: string) {
  const active = s.db.select().from(scene).where(eq(scene.active, true)).get();
  if (!active) return { tokens: [], props: [], templates: [], doors: [] };
  const onActive = <T extends { sceneId: string }>(rows: T[]) =>
    rows.filter((r) => r.sceneId === active.id);
  const tokens = onActive(s.db.select().from(token).all())
    .filter((t) => !t.hidden && !(t.fogged && t.ownerPlayerId === null))
    .map((t) => t.id);
  const props = onActive(s.db.select().from(prop).all())
    .filter((p) => !p.hidden && !p.fogged)
    .map((p) => p.id);
  const templates = onActive(s.db.select().from(aoeTemplate).all())
    .filter((t) => !t.hidden && !(t.fogged && t.placedByPlayerId === null))
    .map((t) => t.id);
  const st = s.db.select().from(sceneStructure).where(eq(sceneStructure.sceneId, active.id)).get();
  const doors = (st?.doors ?? []).filter((d) => d[6] === 0).map((d) => d[0]);
  void playerId;
  return { tokens: tokens.sort(), props: props.sort(), templates: templates.sort(), doors };
}

describe("FR-FOG-40 migration backfill", () => {
  test("FR-FOG-40 the backfill is a start hook (runs after the schema push, before listen)", async () => {
    const b = await servicesFromBundle(await loadBundle("fog", { testMode: true }));
    try {
      expect(b.s.startHooks.map((h) => h.name)).toContain("fog-of-war.seen-by-backfill");
    } finally {
      b.cleanup();
    }
  }, 30_000);

  for (const bundle of ["fog", "fog-scn", "scene-tools"]) {
    test(`FR-FOG-40 ${bundle}: null copies hide every subject; backfill → DM and player snapshots byte-equal; rerun no-op`, async () => {
      const b = await servicesFromBundle(await loadBundle(bundle, { testMode: true }));
      try {
        const s = b.s;
        const before = frames(s);
        // Sprint 2's filter, re-stated: each player's records match the static rule.
        for (const f of snapshotFrames(s)) {
          if (f.viewer.role !== "player") continue;
          const want = sprint2View(s, f.viewer.playerId as string);
          expect(ids(f.records[TOKEN_TYPE])).toEqual(want.tokens);
          expect(ids(f.records[SCENE_PROP_TYPE])).toEqual(want.props);
          expect(ids(f.records[AOE_TEMPLATE_TYPE])).toEqual(want.templates);
          const st = (f.records[SCENE_STRUCTURE_TYPE] ?? []) as { doors: number[][] }[];
          expect(st.flatMap((x) => x.doors.map((d) => d[0]))).toEqual(want.doors);
        }
        nullCopies(s);
        expect(scenesNeedingBackfill(s.db).length).toBeGreaterThan(0);
        // Fail closed: no subject reaches a player but their own tokens; doors none.
        for (const f of snapshotFrames(s)) {
          if (f.viewer.role !== "player") continue;
          const own = (f.records[TOKEN_TYPE] ?? []) as { ownerPlayerId: string | null }[];
          expect(own.every((t) => t.ownerPlayerId === f.viewer.playerId)).toBe(true);
          expect(f.records[SCENE_PROP_TYPE] ?? []).toEqual([]);
          const st = (f.records[SCENE_STRUCTURE_TYPE] ?? []) as { doors: unknown[] }[];
          expect(st.flatMap((x) => x.doors)).toEqual([]);
        }
        // The DM's wire never carries the copies, so it is unchanged even now.
        expect(frames(s)[0]).toEqual(before[0] as { label: string; json: string });
        expect(backfillSeenBy(s.db, ctx())).toBeGreaterThan(0);
        expect(frames(s)).toEqual(before);
        expect(backfillSeenBy(s.db, ctx())).toBe(0);
        expect(scenesNeedingBackfill(s.db)).toEqual([]);
      } finally {
        b.cleanup();
      }
    }, 30_000);
  }
});
