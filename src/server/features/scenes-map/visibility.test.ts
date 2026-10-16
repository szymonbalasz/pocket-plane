import { describe, expect, test } from "bun:test";
import type { SceneFolderRecord, SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { defineRecordType, RecordRegistry, type Viewer } from "../../ws/records";
import { dmTokenRecord } from "./rows";
import {
  folderVisibility,
  redactScene,
  redactToken,
  sceneVisibility,
  tokenVisibility,
} from "./visibility";

const scene = (id: string, active: boolean): SceneRecord => ({
  id,
  campaignId: "c",
  folderId: "f",
  seq: 1,
  name: "Goblin Ambush",
  mapAssetId: "map",
  mapWidth: 1400,
  mapHeight: 980,
  gridCellSize: 70,
  gridOffsetX: 0,
  gridOffsetY: 0,
  gridVisible: true,
  gridColor: "#000000",
  gridOpacity: 0.5,
  mapLocked: true,
  active,
  createdAt: "t",
  updatedAt: "t",
});
const token = (
  id: string,
  sceneId: string,
  hidden: boolean,
  owner: string | null,
  characterId: string | null = null,
): TokenRecord => ({
  id,
  campaignId: "c",
  sceneId,
  definitionId: characterId ?? "def",
  characterId,
  seq: 1,
  name: id,
  imageAssetId: "img",
  size: "medium",
  col: 0,
  row: 0,
  ownerPlayerId: owner,
  hidden,
  shape: "round",
  speed: 30,
  createdAt: "t",
  updatedAt: "t",
  // FR-FOG-10 (ADR-0042): a revealed scene, every player sees it.
  seenBy: ["p1", "p2"],
});
const folder: SceneFolderRecord = {
  id: "f",
  campaignId: "c",
  seq: 1,
  name: "Act 1",
  createdAt: "t",
  updatedAt: "t",
};

function registry(active: string | null) {
  const r = new RecordRegistry();
  r.register(
    defineRecordType<SceneRecord>({
      type: "scene",
      scope: "scene",
      schema: undefined as never,
      idOf: (x) => x.id,
      campaignOf: (x) => x.campaignId,
      sceneOf: (x) => x.id,
      visibility: sceneVisibility,
      redact: redactScene,
      snapshot: () => [],
    }),
  );
  r.register(
    defineRecordType<SceneFolderRecord>({
      type: "scene-folder",
      scope: "campaign",
      schema: undefined as never,
      idOf: (x) => x.id,
      campaignOf: (x) => x.campaignId,
      visibility: folderVisibility,
      snapshot: () => [],
    }),
  );
  r.register(
    defineRecordType<TokenRecord>({
      type: "token",
      scope: "scene",
      schema: undefined as never,
      idOf: (x) => x.id,
      campaignOf: (x) => x.campaignId,
      sceneOf: (x) => x.sceneId,
      visibility: tokenVisibility,
      redact: redactToken,
      dmRedact: dmTokenRecord,
      snapshot: () => [],
    }),
  );
  r.provideActiveScene(() => active);
  return r;
}

const v = (role: "dm" | "player", playerId: string | null = null): Viewer => ({
  connId: "x",
  campaignId: "c",
  role,
  playerId,
});
const dm = v("dm");
const owner = v("player", "p1");
const other = v("player", "p2");

describe("FR-MAP-26 visibility matrix", () => {
  test("scene: DM full; players redacted on the active scene, hidden elsewhere", () => {
    const r = registry("s1");
    expect(r.view("scene", scene("s1", true), dm)).toEqual({
      vis: "full",
      data: scene("s1", true),
    });
    const seen = r.view("scene", scene("s1", true), owner);
    expect(seen.vis).toBe("redacted");
    expect(Object.keys(seen.data as object).sort()).toEqual(
      [
        "active",
        "gridCellSize",
        "gridColor",
        "gridOffsetX",
        "gridOffsetY",
        "gridOpacity",
        "gridVisible",
        "id",
        "mapAssetId",
        "mapHeight",
        "mapWidth",
      ].sort(),
    );
    expect(r.view("scene", scene("s2", false), owner).vis).toBe("hidden");
    expect(registry(null).view("scene", scene("s1", true), owner).vis).toBe("hidden");
    // Another campaign: hidden for the DM too.
    expect(r.view("scene", { ...scene("s1", true), campaignId: "other" }, dm).vis).toBe("hidden");
  });

  test("scene-folder: DM only", () => {
    const r = registry("s1");
    expect(r.view("scene-folder", folder, dm).vis).toBe("full");
    expect(r.view("scene-folder", folder, owner).vis).toBe("hidden");
    expect(r.view("scene-folder", folder, other).vis).toBe("hidden");
  });

  test("token × DM / owner / other player × hidden", () => {
    const r = registry("s1");
    const visible = token("mira", "s1", false, "p1", "char-mira");
    const hidden = token("wolf", "s1", true, null);
    const hiddenOwned = token("thorn", "s1", true, "p1", "char-thorn");
    const offScene = token("elsewhere", "s2", false, "p1");
    expect(r.view("token", visible, dm).vis).toBe("full");
    expect(r.view("token", hidden, dm).vis).toBe("full");
    expect(r.view("token", offScene, dm).vis).toBe("full");
    expect(r.view("token", visible, dm).data).toMatchObject({
      definitionId: "char-mira",
      characterId: "char-mira",
    });
    for (const p of [owner, other]) {
      const seen = r.view("token", visible, p);
      expect(seen.vis).toBe("redacted");
      expect(seen.data).not.toHaveProperty("definitionId");
      // FR-MAP-26 / FR-MAP-50: the character copy is for every player who sees the token.
      expect(seen.data).toMatchObject({
        id: "mira",
        name: "mira",
        ownerPlayerId: "p1",
        characterId: "char-mira",
      });
      expect(r.view("token", hidden, p).vis).toBe("hidden");
      expect(r.view("token", hiddenOwned, p).vis).toBe("hidden");
      expect(r.view("token", offScene, p).vis).toBe("hidden");
    }
  });

  test("FR-MAP-26 / FR-MAP-50 leak row: no definitionId on any player token; characterId only on character tokens", () => {
    const r = registry("s1");
    const tokens = [
      token("mira", "s1", false, "p1", "char-mira"),
      token("thorn", "s1", false, "p2", "char-thorn"),
      token("goblin", "s1", false, null),
      token("npc", "s1", false, "p1"),
    ];
    for (const p of [owner, other]) {
      for (const t of tokens) {
        const data = r.view("token", t, p).data as Record<string, unknown>;
        expect(data).not.toHaveProperty("definitionId");
        expect(JSON.stringify(data)).not.toContain('"definitionId"');
        expect(data.characterId).toBe(t.characterId);
      }
    }
    // Monster / NPC tokens carry null: their definition id never reaches a player.
    const goblin = r.view("token", tokens[2] as TokenRecord, other).data;
    expect(JSON.stringify(goblin)).not.toContain('"def"');
  });

  test("FR-MAP-36 token speed: DM always; a player only on own tokens", () => {
    const r = registry("s1");
    const mira = token("mira", "s1", false, "p1");
    const goblin = token("goblin", "s1", false, null);
    expect(r.view("token", mira, dm).data).toMatchObject({ speed: 30, shape: "round" });
    expect(r.view("token", goblin, dm).data).toMatchObject({ speed: 30 });
    expect(r.view("token", mira, owner).data).toMatchObject({ speed: 30, shape: "round" });
    expect(r.view("token", mira, other).data).not.toHaveProperty("speed");
    expect(r.view("token", mira, other).data).toMatchObject({ shape: "round" });
    expect(r.view("token", goblin, owner).data).not.toHaveProperty("speed");
    // Owner reassigned → the new owner gains `speed` with the upsert, the old one loses it.
    const moved = { ...mira, ownerPlayerId: "p2" };
    const c = { type: "token", id: "mira", before: mira, after: moved };
    expect(r.filterChange(c, other)).toMatchObject({ op: "upsert", data: { speed: 30 } });
    expect((r.filterChange(c, owner) as { data: object }).data).not.toHaveProperty("speed");
  });

  test("FR-MAP-19 hide → delete, reveal → upsert for players (transition matrix)", () => {
    const r = registry("s1");
    const shown = token("wolf", "s1", false, null);
    const hid = token("wolf", "s1", true, null);
    expect(r.filterChange({ type: "token", id: "wolf", before: shown, after: hid }, other)).toEqual(
      {
        type: "token",
        id: "wolf",
        op: "delete",
      },
    );
    expect(
      r.filterChange({ type: "token", id: "wolf", before: hid, after: shown }, other)?.op,
    ).toBe("upsert");
    expect(
      r.filterChange({ type: "token", id: "wolf", before: hid, after: hid }, other),
    ).toBeNull();
  });

  test("FR-FOG-45 / FR-FOG-10 token wire: `invisible` DM only (when true); `seenBy` on no wire; per-player seenBy", () => {
    const r = registry("s1");
    const t = { ...token("stalker", "s1", false, null), invisible: true as const };
    const d = r.view("token", t, dm).data as Record<string, unknown>;
    expect(d.invisible).toBe(true);
    expect(d).not.toHaveProperty("seenBy");
    for (const p of [owner, other]) {
      const seen = r.view("token", t, p);
      expect(seen.vis).toBe("redacted");
      expect(seen.data).not.toHaveProperty("invisible");
      expect(seen.data).not.toHaveProperty("seenBy");
    }
    // Seen by p1 only: hidden for p2 (FR-FOG-11, ADR-0042); null = pre-v2 → hidden for both.
    const one = { ...t, seenBy: ["p1"] };
    expect([r.view("token", one, owner).vis, r.view("token", one, other).vis]).toEqual([
      "redacted",
      "hidden",
    ]);
    const pre = { ...t, seenBy: null };
    expect([r.view("token", pre, owner).vis, r.view("token", pre, other).vis]).toEqual([
      "hidden",
      "hidden",
    ]);
  });
});
