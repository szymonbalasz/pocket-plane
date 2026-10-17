// FR-SCN-46 (SCN §13 integration): the boot re-derive of DM templates' fog copies after the
// sprint-4 cell rule (FR-SCN-41). Rows written under sprint 2's centre cells are re-derived over
// the new uncut cells in one transaction: no event, no log row, no `updatedAt`; per-viewer
// snapshots change only in those rows; rerun = no-op. A test fog (cells with col ≥ 15 fogged)
// stands in for fog's real line so the flips are exact.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seenByNobody } from "@shared/fog-of-war/visibility";
import { AOE_TEMPLATE_TYPE, type AoeTemplateRecord } from "@shared/scene-tools/schemas";
import { sprint2TemplateCells } from "@shared/scene-tools/testing";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { stateDigest } from "../../db/digest";
import { aoeTemplate } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { fogVisibilityHook } from "../fog-of-war/hooks";
import { deriveSceneObject, visibilityHooks } from "../scenes-map/visibility-hooks";
import { readTemplate } from "./rows";
import { rederiveDmTemplates } from "./template-rederive";
import { scnSetup } from "./testing";

const players: string[] = [];

beforeEach(() => {
  visibilityHooks.unregister(fogVisibilityHook.name);
  visibilityHooks.register({
    name: "test.fog",
    derive(_read, obj) {
      const cells = obj.cells as readonly (readonly [number, number])[];
      const fogged = cells.length > 0 && cells.every(([c]) => c >= 15);
      return { fogged, seenBy: fogged ? [] : [...players] };
    },
    hides: (type: string, r: object) => seenByNobody(type, r),
  });
});

afterEach(() => {
  visibilityHooks.unregister("test.fog");
  visibilityHooks.register(fogVisibilityHook);
});

function setup() {
  const t = scnSetup();
  players.splice(0, players.length, t.h.p1.id, t.h.p2.id);
  t.run(I.activateScene, { sceneId: t.ambush.id });
  return t;
}

const AT = "2026-01-01T00:00:00.000Z";
/** Sprint-2 cubes (15° steps) whose fog status flips under the new cells. */
const appears = { shape: "cube" as const, x: 15, y: 5, size: 10, angle: 45 };
const vanishes = { shape: "cube" as const, x: 15, y: 5, size: 10, angle: 255 };

describe("FR-SCN-46 boot re-derive", () => {
  test("FR-SCN-46 DM templates stored under sprint 2's cells are re-derived once at boot: one transaction, no event / log / updatedAt; per-player snapshots equal except those rows; rerun no-op", () => {
    const t = setup();
    const sid = t.ambush.id;
    // Copies as sprint 2's centre cells derived them.
    const stale = (g: typeof appears) =>
      deriveSceneObject(t.s.db, {
        type: AOE_TEMPLATE_TYPE,
        sceneId: sid,
        cells: sprint2TemplateCells(g),
        placedByPlayerId: null,
      });
    expect(stale(appears)).toEqual({ fogged: true, seenBy: [] });
    expect(stale(vanishes)).toEqual({ fogged: false, seenBy: players });
    t.writeTemplate(sid, "appears", { ...appears, label: "Web", ...stale(appears) });
    t.writeTemplate(sid, "vanishes", { ...vanishes, label: "Trap", ...stale(vanishes) });
    t.writeTemplate(sid, "steady", { x: 3, y: 8, label: "Steady" });
    t.writeTemplate(sid, "theirs", { ...vanishes, label: "Mine", placedByPlayerId: t.h.p1.id });
    t.writeTemplate(t.cellar.id, "cellar", { ...appears, label: "Cellar", ...stale(appears) });

    const viewers = [
      t.h.viewer("dm"),
      t.h.viewer("player", t.h.p1.id),
      t.h.viewer("player", t.h.p2.id),
    ];
    const ids = (v: (typeof viewers)[number]) =>
      ((t.h.snapshot(v)[AOE_TEMPLATE_TYPE] ?? []) as AoeTemplateRecord[]).map((r) => r.id).sort();
    const others = (v: (typeof viewers)[number]) => {
      const { [AOE_TEMPLATE_TYPE]: _templates, ...rest } = t.h.snapshot(v);
      return rest;
    };
    const before = viewers.map((v) => ({ ids: ids(v), others: others(v) }));
    expect(before[1]?.ids).toEqual(["steady", "theirs", "vanishes"]);
    const log = readEventLog(t.s.db).length;
    const events = t.events.length;

    expect(rederiveDmTemplates(t.s.db)).toBe(3);

    expect(readTemplate(t.s.db, "appears")).toMatchObject({ seenBy: players });
    expect(readTemplate(t.s.db, "appears")).not.toHaveProperty("fogged");
    expect(readTemplate(t.s.db, "vanishes")).toMatchObject({ fogged: true, seenBy: [] });
    expect(readTemplate(t.s.db, "cellar")).toMatchObject({ seenBy: players });
    // Untouched: the steady DM template and the player's (never a fog subject).
    expect(readTemplate(t.s.db, "theirs")).toMatchObject({ seenBy: players });
    const updated = t.s.db
      .select({ id: aoeTemplate.id, updatedAt: aoeTemplate.updatedAt })
      .from(aoeTemplate)
      .all();
    expect(updated.every((r) => r.updatedAt === AT)).toBe(true);
    expect(readEventLog(t.s.db).length).toBe(log);
    expect(t.events.length).toBe(events);

    // DM: same rows; players: Web appears, Trap goes; every other record type unchanged.
    for (const [i, v] of viewers.entries()) {
      const was = before[i] as (typeof before)[number];
      expect(others(v)).toEqual(was.others);
      expect(ids(v)).toEqual(i === 0 ? was.ids : ["appears", "steady", "theirs"]);
    }

    const digest = stateDigest(t.s.db.$client).sha256;
    expect(rederiveDmTemplates(t.s.db)).toBe(0);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
  });

  test("FR-SCN-46 is a scene-tools start hook, after fog's boot steps", () => {
    const t = setup();
    const names = t.s.startHooks.map((h) => h.name);
    expect(names).toContain("scene-tools.template-rederive");
    expect(names.indexOf("scene-tools.template-rederive")).toBeGreaterThan(
      names.indexOf("fog-of-war.vision-model-upgrade"),
    );
  });
});
