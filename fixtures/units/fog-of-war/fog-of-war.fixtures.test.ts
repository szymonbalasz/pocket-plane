import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { entity, scene, sceneFog, sceneFogEdit, sceneStructure, token } from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

describe("fog-of-war fixtures (FOG §13)", () => {
  test("FOG §13 bundle `fog` loads from empty: Goblin Ambush partly revealed, fogged copies, undo depth 4 (FR-FOG-25 ripple)", async () => {
    const r = await loadBundle("fog");
    dirs.push(r.dir);
    const db = r.openDb();
    const scenes = db.select().from(scene).all();
    const fogs = db.select().from(sceneFog).all();
    const allEdits = db.select().from(sceneFogEdit).orderBy(asc(sceneFogEdit.seq)).all();
    const tokens = db.select().from(token).orderBy(asc(token.seq)).all();
    closeDb(db);
    expect(r.manifest.fixtures.slice(-4)).toEqual([
      "goblin-2",
      "encounter-1",
      "fog-ambush",
      "fog-ambush-partial",
    ]);
    const ambush = scenes.find((s) => s.name === "Goblin Ambush");
    // FR-FOG-25: every scene a unit creates is revealed last (one "reveal-all" entry each); only
    // Goblin Ambush is fogged again by fog-ambush.
    expect(fogs.map((f) => f.sceneId).sort()).toEqual(scenes.map((s) => s.id).sort());
    for (const f of fogs.filter((x) => x.sceneId !== ambush?.id)) {
      expect(f).toMatchObject({ fill: "clear", runs: "" });
    }
    const fog = fogs.find((f) => f.sceneId === ambush?.id);
    expect(fog).toMatchObject({ fill: "fog", col0: 0, row0: 0, cols: 20, rows: 14 });
    const edits = allEdits.filter((e) => e.sceneId === ambush?.id);
    expect(edits.map((e) => e.kind)).toEqual([
      "reveal-all",
      "fog-all",
      "reveal-rect",
      "reveal-polygon",
    ]);
    expect(allEdits.filter((e) => e.sceneId !== ambush?.id).map((e) => e.kind)).toEqual([
      "reveal-all",
      "reveal-all",
    ]);
    const on = tokens.filter((t) => t.sceneId === ambush?.id);
    const by = (name: string) => on.find((t) => t.name === name);
    expect(by("Goblin Lurker")).toMatchObject({ col: 17, row: 11, hidden: false, fogged: true });
    for (const n of ["Goblin", "Goblin 2"])
      expect(by(n)).toMatchObject({ hidden: false, fogged: true });
    for (const n of ["Wolf", "Elite Goblin Warrior"]) {
      expect(by(n)).toMatchObject({ hidden: true, fogged: true });
    }
    // Revealed: Mira, Thorn by the rect; the Cave Ogre by the polygon (centre on the diagonal).
    for (const n of ["Mira", "Thorn", "Cave Ogre"]) expect(by(n)?.fogged).toBe(false);
    // Other scenes untouched.
    expect(tokens.filter((t) => t.sceneId !== ambush?.id).every((t) => !t.fogged)).toBe(true);
  });

  test("FOG §13 bundle `vision` loads from empty: vision-senses + vision-crypt on Goblin Ambush (nook revealed, Explored corridor, darkness [12.5, 9, 1.5], freeform wall, Explored on)", async () => {
    const r = await loadBundle("vision");
    dirs.push(r.dir);
    const db = r.openDb();
    const ambush = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Goblin Ambush");
    const fog = db
      .select()
      .from(sceneFog)
      .all()
      .find((f) => f.sceneId === ambush?.id);
    const structure = db
      .select()
      .from(sceneStructure)
      .all()
      .find((x) => x.sceneId === ambush?.id);
    const tokens = db
      .select()
      .from(token)
      .all()
      .filter((t) => t.sceneId === ambush?.id);
    const senses = Object.fromEntries(
      db
        .select()
        .from(entity)
        .all()
        .filter((e) => e.kind === "character")
        .map((e) => [e.name, (e.statBlock as { senses?: unknown }).senses]),
    );
    closeDb(db);
    expect(r.manifest.fixtures.slice(-6)).toEqual([
      "goblin-2",
      "encounter-1",
      "fog-ambush",
      "scn-walls",
      "vision-senses",
      "vision-crypt",
    ]);
    expect(fog).toMatchObject({ fill: "fog", runs: "", explored: true, visionStale: false });
    expect(fog?.shapes).toEqual([
      { op: "reveal", rect: [0, 6, 3, 11] },
      { op: "explored", polygon: [8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5] },
    ]);
    expect(fog?.darkness.map(({ seenBy: _s, id: _i, ...d }) => d)).toEqual([
      { circle: [12.5, 9, 1.5] },
    ]);
    expect(structure?.walls.map((w) => w.slice(1))).toContainEqual([4.5, 3.25, 6.75, 5.5]);
    expect(senses.Mira).toEqual({ visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false });
    expect(senses.Thorn).toEqual({ visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true });
    const at = (name: string) => tokens.find((t) => t.name === name);
    expect(at("Mira")).toMatchObject({ col: 2, row: 7, fogged: false });
    expect(at("Thorn")).toMatchObject({ col: 2, row: 9, fogged: false });
    // §13 geometry: from the nook nobody sees a monster (walls at x = 8, doors closed).
    for (const n of ["Goblin", "Goblin 2", "Goblin Lurker", "Wolf", "Elite Goblin Warrior"]) {
      expect(at(n)).toMatchObject({ fogged: true, seenBy: [] });
    }
  });
});
