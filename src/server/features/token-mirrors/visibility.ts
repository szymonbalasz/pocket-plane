// Player visibility of a mirror (FR-MIR-06, -07, -09). Reads record + viewer only (ADR-0021). The
// scene gate (CON-22) runs first, so players only reach this for the active scene.
import {
  type PlayerTokenMirrorRecord,
  TOKEN_MIRROR_TYPE,
  type TokenMirrorRecord,
} from "@shared/token-mirrors/schemas";
import type { Viewer, Visibility } from "../../ws/records";
import { hiddenByHooks } from "../scenes-map/visibility-hooks";

export function mirrorVisibility(r: TokenMirrorRecord, v: Viewer): Visibility {
  if (r.mode === "hidden" || r.suppressed) return "hidden";
  if (r.mode === "visible" && hiddenByHooks(TOKEN_MIRROR_TYPE, r, v)) return "hidden";
  return "redacted";
}

/** FR-MIR-07: never the source token; a shadow never carries its name or art. */
export function redactMirror(r: TokenMirrorRecord): PlayerTokenMirrorRecord {
  const base = {
    id: r.id,
    sceneId: r.sceneId,
    col: r.col,
    row: r.row,
    mode: r.mode,
    size: r.size,
    shape: r.shape,
  };
  if (r.mode === "shadow") return base;
  return { ...base, name: r.name, imageAssetId: r.imageAssetId, creatureType: r.creatureType };
}

export function dmMirrorRecord(r: TokenMirrorRecord): TokenMirrorRecord {
  const { seenBy: _seenBy, ...rest } = r;
  return rest;
}
