// FR-FOG-20 / -21 / -36 / -43 / -48 / -50 / -51 (sprint 4, V10): whose `vision` and `fog-explored`
// rows a canvas draws, and the **union** it draws from them (never a client recompute):
// - a player: their own rows; while party vision is on (the campaign's `fog-settings`) also every
//   other player's shared `vision` of the scene (FR-FOG-51; memory stays own-only);
// - the DM, View as P: P's rows; while party vision is on every player's `vision` (P draws the
//   party's sight) and P's memory; View as **Party** (`VIEW_AS_PARTY`): every player's `vision`
//   and every player's memory, drawn as for one player holding them all (also while party vision
//   is off: a preview of "on", OQ-FOG-55).
// Each record first takes its owner's sight previews (FR-FOG-54, `previewVision`), so a party
// member's drag peels the fog for everyone who draws that record. The union is no geometry: the
// polygons are listed together (see-through rules are already in each polygon, FR-FOG-33). Blind
// = party-blind: every drawn record blind (a player blind with a **secret** Blinded, own record
// reason `unknown`, is a non-source for the party, as the server treats them, FR-FOG-48).
// The chip reason (FR-FOG-21): darkness / `blinded` / `unknown` (the own record's, else unknown).
// DOM-free.
import {
  type BlindReason,
  FOG_EXPLORED_TYPE,
  FOG_SETTINGS_TYPE,
  type FogExploredRecord,
  type FogSettingsRecord,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import { VIEW_AS_PARTY } from "@shared/protocol/scene-window";
import type { RecordStore } from "@shared/protocol/store";
import { type OwnedPreview, previewVision } from "./sight-preview";

type Records = RecordStore["records"];

/** FR-FOG-21: the blind chip's `data-reason`. */
export type ChipReason = "darkness" | BlindReason;

/** The drawn sight: the union of the drawn records (a `vision` shape, plus what it came from). */
export interface DrawnVision {
  blind: boolean;
  see: number[][];
  dark: number[][];
  /** Indices into `see ++ dark` of Sees-invisible polygons (only the viewer's own carry any). */
  inv: number[];
  /** `see ++ dark`: each polygon's source token id. */
  src: string[];
}

export interface PartyView {
  /** Null = no record drawn (no source anywhere: the static fog only). */
  vision: DrawnVision | null;
  /** The chip reason while `vision.blind`, else null. */
  reason: ChipReason | null;
  /** The other players whose records were drawn (`fog-vision` attr `shared`). */
  shared: string[];
  /** Token ids whose sight preview replaced their record polygons (`fog-vision` attr `preview`). */
  preview: string[];
  /** The memory rows drawn (own; every player's for View as Party). */
  explored: FogExploredRecord[];
}

/** FR-FOG-49: the campaign's party vision switch as the client holds it. */
export function partyVisionOn(records: Records): boolean {
  const byId = records[FOG_SETTINGS_TYPE] ?? {};
  return Object.values(byId).some((r) => (r as FogSettingsRecord).partyVision === true);
}

const rowsOf = <T extends { sceneId: string; playerId: string }>(
  records: Records,
  type: string,
  sceneId: string,
): T[] =>
  (Object.values(records[type] ?? {}) as T[])
    .filter((r) => r.sceneId === sceneId)
    .sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));

/** A record as the party union reads it (a secret-Blinded own record = a non-source). */
const forParty = (v: VisionRecord, viewer: string): VisionRecord =>
  v.playerId === viewer && v.blind && v.reason === "unknown"
    ? { ...v, blind: false, see: [], dark: [], src: [] }
    : v;

/** The union of records (each already previewed): polygons listed together, `inv` re-indexed. */
export function unionVision(list: readonly VisionRecord[]): DrawnVision | null {
  if (list.length === 0) return null;
  const nSee = list.reduce((n, v) => n + v.see.length, 0);
  const see: number[][] = [];
  const dark: number[][] = [];
  const srcSee: string[] = [];
  const srcDark: string[] = [];
  const inv: number[] = [];
  let atSee = 0;
  let atDark = nSee;
  for (const v of list) {
    const own = new Set(v.inv ?? []);
    const src = v.src ?? [];
    v.see.forEach((p, i) => {
      if (own.has(i)) inv.push(atSee + i);
      see.push(p);
      srcSee.push(src[i] ?? "");
    });
    v.dark.forEach((p, j) => {
      if (own.has(v.see.length + j)) inv.push(atDark + j);
      dark.push(p);
      srcDark.push(src[v.see.length + j] ?? "");
    });
    atSee += v.see.length;
    atDark += v.dark.length;
  }
  return {
    blind: list.every((v) => v.blind),
    see,
    dark,
    inv: inv.sort((a, b) => a - b),
    src: [...srcSee, ...srcDark],
  };
}

/**
 * What a canvas draws for `viewer` (a player id, or `VIEW_AS_PARTY` on the DM) on `sceneId`:
 * the records (own, or the party's while `party`), each with its owner's previews, as one union.
 */
export function partyView(
  records: Records,
  sceneId: string,
  viewer: string,
  previews: readonly OwnedPreview[] = [],
): PartyView {
  const all = rowsOf<VisionRecord>(records, VISION_TYPE, sceneId);
  const asParty = viewer === VIEW_AS_PARTY;
  const party = asParty || partyVisionOn(records);
  const drawn = party ? all : all.filter((v) => v.playerId === viewer);
  const applied = new Set<string>();
  const list = drawn.map((v) => {
    const p = previewVision(v, previews);
    for (const id of p.applied) applied.add(id);
    const out = p.vision ?? v;
    return party ? forParty(out, viewer) : out;
  });
  const vision = unionVision(list);
  const own = all.find((v) => v.playerId === viewer) ?? null;
  const reason: ChipReason | null = !vision?.blind
    ? null
    : own?.blind
      ? (own.reason ?? "darkness")
      : "unknown";
  const memory = rowsOf<FogExploredRecord>(records, FOG_EXPLORED_TYPE, sceneId);
  return {
    vision,
    reason,
    shared: drawn.filter((v) => v.playerId !== viewer).map((v) => v.playerId),
    preview: [...applied].sort(),
    explored: asParty ? memory : memory.filter((r) => r.playerId === viewer),
  };
}

/** The chip's text per reason (FOG §7). */
export const BLIND_TEXTS: Record<ChipReason, string> = {
  darkness: "Magical darkness — you can't see",
  blinded: "Blinded — you can't see",
  unknown: "You can't see",
};
