// Test support for overview scenes. `insertMiniature` sets up a state in one call (any owner, hidden,
// locked, no image); no fixture uses it.
import { MINIATURE_STYLE_DEFAULT, type MiniatureStyle } from "@shared/overview-scenes/schemas";
import type { Db } from "../../db/client";
import { overviewItem, overviewItemSeqNext } from "../../db/schema";

export const MINIATURE_STYLE: MiniatureStyle = MINIATURE_STYLE_DEFAULT;

export function insertMiniature(
  db: Db,
  f: {
    id: string;
    campaignId: string;
    overviewId: string;
    ownerPlayerId?: string | null;
    characterId?: string | null;
    hidden?: boolean;
    locked?: boolean;
    assetId?: string | null;
    text?: string;
  },
): void {
  const now = "2026-01-01T00:00:00.000Z";
  db.insert(overviewItem)
    .values({
      id: f.id,
      campaignId: f.campaignId,
      overviewId: f.overviewId,
      seq: overviewItemSeqNext,
      z: 0,
      kind: "miniature",
      x: 100,
      y: 100,
      w: 64,
      h: 64,
      hidden: f.hidden ?? false,
      locked: f.locked ?? false,
      assetId: f.assetId ?? null,
      text: f.text ?? "Miniature",
      style: MINIATURE_STYLE,
      characterId: f.characterId ?? null,
      ownerPlayerId: f.ownerPlayerId ?? null,
      shape: "round",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
