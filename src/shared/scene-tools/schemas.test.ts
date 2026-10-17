// Scene-tools wire shapes (SCN §9): ranges and steps, the player template schema, signal frames.
import { describe, expect, test } from "bun:test";
import {
  AddDoorInput,
  AddWallsInput,
  AoeTemplateRecord,
  ClearTemplatesInput,
  Door,
  PlaceTemplateInput,
  PlayerPlaceTemplateInput,
  PlayerSceneStructureRecord,
  SceneStructureRecord,
  TemplateSignalData,
  UpdatePropInput,
  UpdateTemplateInput,
} from "./schemas";

const sphere = { sceneId: "s", shape: "sphere" as const, x: 3, y: 8, size: 15, angle: 0 };

describe("SCN §9 shapes", () => {
  test("FR-SCN-20 size 5–300 / width 5–60 step 5; angle 0 ≤ a < 360", () => {
    const ok = (v: object) => PlaceTemplateInput.safeParse({ ...sphere, ...v }).success;
    expect(ok({})).toBe(true);
    expect(ok({ size: 300, width: 60, angle: 345 })).toBe(true);
    expect(ok({ size: 0 })).toBe(false);
    expect(ok({ size: 12 })).toBe(false);
    expect(ok({ size: 305 })).toBe(false);
    expect(ok({ size: 12.5 })).toBe(false);
    expect(ok({ width: 65 })).toBe(false);
    expect(ok({ angle: 360 })).toBe(false);
    expect(ok({ angle: -0.1 })).toBe(false);
    expect(ok({ label: "x".repeat(41) })).toBe(false);
  });

  test("FR-SCN-20 zod: 2-decimal origin, 1-decimal angle; 3 decimals / 360 / 12.25 → invalid; integer rows unchanged", () => {
    const place = (v: object) => PlaceTemplateInput.safeParse({ ...sphere, ...v }).success;
    const update = (v: object) => UpdateTemplateInput.safeParse({ templateId: "t", ...v }).success;
    const signal = (v: object) =>
      TemplateSignalData.safeParse({ ...sphere, key: "k", ...v }).success;
    for (const check of [place, update, signal]) {
      expect(check({ x: 3.37, y: 7.64, angle: 37.5 })).toBe(true);
      expect(check({ x: -0.5, y: 10000, angle: 359.9 })).toBe(true);
      expect(check({ x: 3.375 })).toBe(false);
      expect(check({ y: 0.001 })).toBe(false);
      expect(check({ x: 10_000.01 })).toBe(false);
      expect(check({ angle: 360 })).toBe(false);
      expect(check({ angle: 12.25 })).toBe(false);
      expect(check({ angle: 10 })).toBe(true);
    }
    expect(PlayerPlaceTemplateInput.safeParse({ ...sphere, x: 3.37, angle: 0.1 }).success).toBe(
      true,
    );
    // Sprint-2 rows: integer origin, 15° steps.
    const old = {
      ...sphere,
      id: "t",
      campaignId: "c",
      width: null,
      label: "",
      placedByPlayerId: null,
      hidden: false,
    };
    for (let angle = 0; angle < 360; angle += 15) {
      expect(AoeTemplateRecord.parse({ ...old, angle })).toEqual({ ...old, angle });
    }
    expect(AoeTemplateRecord.safeParse({ ...old, x: 1.5, y: 10.5, angle: 300 }).success).toBe(true);
    expect(AoeTemplateRecord.safeParse({ ...old, x: 1.555 }).success).toBe(false);
  });

  test("FR-SCN-44 clearTemplates {sceneId, players?}", () => {
    expect(ClearTemplatesInput.safeParse({ sceneId: "s" }).success).toBe(true);
    expect(ClearTemplatesInput.safeParse({ sceneId: "s", players: true }).success).toBe(true);
    expect(ClearTemplatesInput.safeParse({ sceneId: "s", players: "yes" }).success).toBe(false);
    expect(ClearTemplatesInput.safeParse({ sceneId: "s", all: true }).success).toBe(false);
  });

  test("FR-SCN-25 a player's schema has neither hidden nor placedByPlayerId", () => {
    expect(
      PlaceTemplateInput.safeParse({ ...sphere, hidden: true, placedByPlayerId: "p" }).success,
    ).toBe(true);
    expect(PlayerPlaceTemplateInput.safeParse(sphere).success).toBe(true);
    expect(PlayerPlaceTemplateInput.safeParse({ ...sphere, hidden: true }).success).toBe(false);
    expect(PlayerPlaceTemplateInput.safeParse({ ...sphere, placedByPlayerId: "p" }).success).toBe(
      false,
    );
  });

  test("FR-SCN-07/08 segment batches and door tuples", () => {
    expect(AddWallsInput.safeParse({ sceneId: "s", segments: [] }).success).toBe(false);
    const seg = [0, 0, 1, 0];
    expect(AddWallsInput.safeParse({ sceneId: "s", segments: Array(200).fill(seg) }).success).toBe(
      true,
    );
    expect(AddWallsInput.safeParse({ sceneId: "s", segments: Array(201).fill(seg) }).success).toBe(
      false,
    );
    expect(Door.safeParse([1, 0, 0, 1, 0, 2, 1]).success).toBe(true);
    expect(Door.safeParse([1, 0, 0, 1, 0, 3, 0]).success).toBe(false);
    expect(Door.safeParse([0, 0, 0, 1, 0, 1, 0]).success).toBe(false);
  });

  test("FR-SCN-07 decimals (sprint 3): ≤ 2 decimals ok, 3 → invalid, integers unchanged", () => {
    const one = (segment: number[]) =>
      AddWallsInput.safeParse({ sceneId: "s", segments: [segment] });
    expect(one([4.5, 3.25, 6.75, 5.5]).success).toBe(true);
    expect(one([0, 0, 1, 0]).success).toBe(true);
    expect(one([4.5, 3.255, 6.75, 5.5]).success).toBe(false);
    expect(one([0.07, 0.29, 1.13, 2.01]).success).toBe(true);
    expect(Door.safeParse([1, 12.4, 3.65, 13.1, 4.8, 1, 0]).success).toBe(true);
    expect(Door.safeParse([1, 12.401, 3.65, 13.1, 4.8, 1, 0]).success).toBe(false);
    expect(AddDoorInput.safeParse({ sceneId: "s", segment: [12.4, 3.65, 13.1, 4.8] }).success).toBe(
      true,
    );
    expect(
      PlayerSceneStructureRecord.safeParse({ id: "s", doors: [[1, 1.5, 1, 2, 1, 0]] }).success,
    ).toBe(true);
  });

  test("FR-SCN-17 prop sides 1–20, rotation in 90° steps; strict", () => {
    expect(UpdatePropInput.safeParse({ propId: "p", w: 20, rotation: 270 }).success).toBe(true);
    expect(UpdatePropInput.safeParse({ propId: "p", w: 21 }).success).toBe(false);
    expect(UpdatePropInput.safeParse({ propId: "p", rotation: 45 }).success).toBe(false);
    expect(UpdatePropInput.safeParse({ propId: "p", fogged: true }).success).toBe(false);
  });

  test("SCN §9 records: player structure has no walls key; fogged only as true", () => {
    const dm: SceneStructureRecord = {
      id: "s",
      campaignId: "c",
      rev: 1,
      nextN: 2,
      walls: [[1, 0, 0, 1, 0]],
      doors: [],
    };
    expect(SceneStructureRecord.parse(dm)).toEqual(dm);
    expect(PlayerSceneStructureRecord.parse({ id: "s", doors: [[1, 0, 0, 1, 0, 1]] })).toEqual({
      id: "s",
      doors: [[1, 0, 0, 1, 0, 1]],
    });
    const t = {
      ...sphere,
      id: "t",
      campaignId: "c",
      width: null,
      label: "",
      placedByPlayerId: null,
      hidden: false,
    };
    expect(AoeTemplateRecord.safeParse(t).success).toBe(true);
    expect(AoeTemplateRecord.safeParse({ ...t, fogged: false }).success).toBe(false);
  });

  test("FR-SCN-23 signal: a place frame or an end frame", () => {
    expect(TemplateSignalData.safeParse({ ...sphere, key: "k" }).success).toBe(true);
    expect(TemplateSignalData.safeParse({ sceneId: "s", key: "k", end: true }).success).toBe(true);
    expect(TemplateSignalData.safeParse({ sceneId: "s", key: "k", end: false }).success).toBe(
      false,
    );
    expect(TemplateSignalData.safeParse({ ...sphere, key: "k", extra: 1 }).success).toBe(false);
  });
});
