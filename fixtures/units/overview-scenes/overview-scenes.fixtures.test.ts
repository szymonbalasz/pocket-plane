import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { asset, entity, overview, overviewItem, player, scene } from "@server/db/schema";
import { newMiniatureStyle } from "@shared/overview-scenes/schemas";
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

describe("overview-scenes fixtures (FR-OVW-46)", () => {
  test("overview-scenes loads from empty: Sword Coast shown with the party, Phandalin; same IDs twice", async () => {
    const load = async () => {
      const r = await loadBundle("overview-scenes");
      dirs.push(r.dir);
      const db = r.openDb();
      const out = {
        manifest: r.manifest.fixtures,
        scenes: db.select().from(scene).all(),
        assets: db.select().from(asset).orderBy(asc(asset.seq)).all(),
        overviews: db.select().from(overview).orderBy(asc(overview.seq)).all(),
        items: db.select().from(overviewItem).orderBy(asc(overviewItem.seq)).all(),
        characters: db.select().from(entity).all(),
        players: db.select().from(player).all(),
      };
      closeDb(db);
      return out;
    };
    const a = await load();
    expect(a.manifest.slice(-2)).toEqual(["ovw-sword-coast", "ovw-phandalin"]);
    expect(a.manifest).toContain("player-1");
    expect(a.manifest).toContain("player-2");
    expect(a.overviews.map((o) => [o.name, o.active])).toEqual([
      ["Sword Coast", true],
      ["Phandalin", false],
    ]);
    // One thing shown: the battle scenes all went off.
    expect(a.scenes.filter((s) => s.active)).toEqual([]);

    const [coast, phandalin] = a.overviews.map((o) => a.items.filter((i) => i.overviewId === o.id));
    const assetName = (id: string | null) => a.assets.find((x) => x.id === id)?.name;

    // Sword Coast: locked map, three styled labels (one hidden), a hidden scroll.
    const map = coast?.find((i) => i.kind === "image" && !i.hidden);
    expect(map).toMatchObject({ locked: true, w: 4096, h: 2731 });
    expect(assetName(map?.assetId ?? null)).toBe("map-large");
    const scroll = coast?.find((i) => i.kind === "image" && i.hidden);
    expect(scroll).toMatchObject({ w: 256, h: 384, locked: false });
    expect(assetName(scroll?.assetId ?? null)).toBe("scroll");
    const labels = coast?.filter((i) => i.kind === "label") ?? [];
    expect(labels.map((l) => [l.text, l.hidden])).toEqual([
      ["Neverwinter", false],
      ["Phandalin", false],
      ["Cragmaw Castle", true],
    ]);
    expect(new Set(labels.map((l) => (l.style as { font: string }).font)).size).toBe(3);
    expect((labels[2]?.style as { dot: { on: boolean } } | undefined)?.dot.on).toBe(false);

    // Phandalin: `town` at its display size.
    expect(phandalin?.length).toBe(1);
    expect(assetName(phandalin?.[0]?.assetId ?? null)).toBe("town");

    // FR-OVW-31, -33: the party's miniatures, linked, each with its player, not on the Phandalin one.
    const playerOf = (id: string | null) => a.players.find((p) => p.id === id)?.name;
    const characterOf = (id: string | null) => a.characters.find((c) => c.id === id)?.name;
    const minis = coast?.filter((i) => i.kind === "miniature") ?? [];
    expect(
      minis.map((m) => [m.text, characterOf(m.characterId), playerOf(m.ownerPlayerId)]),
    ).toEqual([
      ["Mira", "Mira", "Player 1"],
      ["Thorn", "Thorn", "Player 2"],
    ]);
    for (const m of minis) {
      expect(m).toMatchObject({
        w: 160,
        h: 160,
        hidden: false,
        locked: false,
        style: newMiniatureStyle(160),
      });
    }

    // Deterministic: same IDs and positions on a second load.
    const b = await load();
    expect(b.overviews.map((o) => o.id)).toEqual(a.overviews.map((o) => o.id));
    expect(b.items.map((i) => [i.id, i.x, i.y, i.z])).toEqual(
      a.items.map((i) => [i.id, i.x, i.y, i.z]),
    );
  }, 120_000);

  test("overview-crowd loads from empty: `overview-scenes` + the crowd at the cap", async () => {
    const r = await loadBundle("overview-crowd");
    dirs.push(r.dir);
    expect(r.manifest.fixtures.slice(-3)).toEqual([
      "ovw-sword-coast",
      "ovw-phandalin",
      "ovw-crowd",
    ]);
    const db = r.openDb();
    const crowd = db
      .select()
      .from(overview)
      .all()
      .find((o) => o.name === "Crowded Coast");
    const items = db
      .select()
      .from(overviewItem)
      .all()
      .filter((i) => i.overviewId === crowd?.id);
    closeDb(db);
    expect(crowd?.active).toBe(false);
    expect(items.length).toBe(300);
    expect(items.filter((i) => i.kind === "label").length).toBe(200);
    expect(items.filter((i) => i.kind === "image").length).toBe(100);
  }, 120_000);
});
