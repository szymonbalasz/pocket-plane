import { describe, expect, test } from "bun:test";
import {
  CreateSceneBody,
  LaserData,
  PatchSceneBody,
  PingData,
  PlaceTokenInput,
  SetGridInput,
  TokenName,
  UpdateTokenInput,
} from "./schemas";

const grid = {
  sceneId: "s",
  cellSize: 70,
  offsetX: 0,
  offsetY: 0,
  visible: true,
  color: "#000000",
  opacity: 0.5,
};

describe("scenes-map schemas", () => {
  test("FR-MAP-01 / -16 names: trimmed, length, no control chars", () => {
    expect(CreateSceneBody.parse({ name: "  Town  ", mapAssetId: "a" }).name).toBe("Town");
    expect(CreateSceneBody.safeParse({ name: "   ", mapAssetId: "a" }).success).toBe(false);
    expect(CreateSceneBody.safeParse({ name: "x".repeat(61), mapAssetId: "a" }).success).toBe(
      false,
    );
    expect(CreateSceneBody.safeParse({ name: "a\u0007b", mapAssetId: "a" }).success).toBe(false);
    expect(TokenName.safeParse("x".repeat(40)).success).toBe(true);
    expect(TokenName.safeParse("x".repeat(41)).success).toBe(false);
    // Strict: spoofed fields are rejected.
    expect(CreateSceneBody.safeParse({ name: "T", mapAssetId: "a", campaignId: "c" }).success).toBe(
      false,
    );
    expect(PatchSceneBody.safeParse({}).success).toBe(false);
    expect(PatchSceneBody.parse({ folderId: null })).toEqual({ folderId: null });
  });

  test("FR-MAP-10 grid bounds", () => {
    const ok = (patch: Partial<typeof grid>) =>
      SetGridInput.safeParse({ ...grid, ...patch }).success;
    expect(ok({})).toBe(true);
    expect(ok({ cellSize: 8 })).toBe(true);
    expect(ok({ cellSize: 7.99 })).toBe(false);
    expect(ok({ cellSize: 512 })).toBe(true);
    expect(ok({ cellSize: 512.01 })).toBe(false);
    expect(ok({ cellSize: 52.25 })).toBe(true);
    expect(ok({ cellSize: 52.251 })).toBe(false);
    expect(ok({ offsetX: 69.9 })).toBe(true);
    expect(ok({ offsetX: 70 })).toBe(false);
    expect(ok({ offsetY: -1 })).toBe(false);
    expect(ok({ color: "#FFFFFF" })).toBe(true);
    expect(ok({ color: "white" })).toBe(false);
    expect(ok({ opacity: 0.09 })).toBe(false);
    expect(ok({ opacity: 1 })).toBe(true);
    expect(SetGridInput.parse({ ...grid, color: "#ABCDEF" }).color).toBe("#abcdef");
  });

  test("FR-MAP-13 place: never size; integers", () => {
    const base = { sceneId: "s", definitionId: "d", col: 1, row: 2 };
    expect(PlaceTokenInput.safeParse(base).success).toBe(true);
    expect(PlaceTokenInput.safeParse({ ...base, size: "huge" }).success).toBe(false);
    expect(PlaceTokenInput.safeParse({ ...base, col: 1.5 }).success).toBe(false);
    expect(UpdateTokenInput.safeParse({ tokenId: "t", size: "huge" }).success).toBe(false);
  });

  test("FR-MAP-25 signal schemas: finite, |x| ≤ 16384, ≤ 32 laser points", () => {
    expect(PingData.safeParse({ sceneId: "s", x: 1, y: 2 }).success).toBe(true);
    expect(PingData.safeParse({ sceneId: "s", x: 16385, y: 0 }).success).toBe(false);
    expect(PingData.safeParse({ sceneId: "s", x: Number.NaN, y: 0 }).success).toBe(false);
    expect(PingData.safeParse({ sceneId: "s", x: Infinity, y: 0 }).success).toBe(false);
    expect(PingData.safeParse({ sceneId: "s", x: 0, y: 0, from: "dm" }).success).toBe(false);
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, i]);
    expect(LaserData.safeParse({ sceneId: "s", points: pts(32) }).success).toBe(true);
    expect(LaserData.safeParse({ sceneId: "s", points: pts(33) }).success).toBe(false);
    expect(LaserData.safeParse({ sceneId: "s", points: [], end: true }).success).toBe(true);
  });
});
