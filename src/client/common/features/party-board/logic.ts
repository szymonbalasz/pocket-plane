// Pure client rules of the Party windows' handout parts (FR-PARTY-09–16): list order per role,
// New / Updated marks from the seen revs, editor and Share drafts → intent payloads (FR-PARTY-02
// and FR-PARTY-05 mirrored with the shared zod schemas), launcher activity; the Companions tab's
// groups and rows (FR-PARTY-41–44, sprint 6). No React.

import { healthBand } from "@shared/combat-tracker/rules";
import {
  EntityRecord,
  type HealthBand,
  type MonsterRecord,
  RedactedPet,
  type TurnMode,
} from "@shared/entities/schemas";
import {
  CreateHandoutIntent,
  HANDOUT_BODY_MAX,
  HANDOUT_IMAGES_MAX,
  HANDOUT_TYPE,
  type HandoutInput,
  type HandoutView,
  SharedWith,
  type ShareMode,
} from "@shared/party-board/schemas";
import { sameShare } from "@shared/party-board/visibility";
import type { RecordStore } from "@shared/protocol/store";
import { IntentRejected } from "../../sync/connection";

export const PARTY_BOARD_KIND = "party.board";
export const PARTY_HANDOUT_KIND = "party.handout";

// FR-PARTY-29: Loot right of Inventory; FR-PARTY-41 (sprint 6): Companions after Loot.
export const PARTY_TABS = ["handouts", "inventory", "loot", "companions"] as const;
export type PartyTab = (typeof PARTY_TABS)[number];

export const EMPTY_HANDOUTS = "No handouts yet";
export const GONE_TEXT = "No longer shared";
export const LOAD_FAILED = "Couldn't load — Retry";
export const SHARE_HINT =
  "Unsharing hides the handout, but players keep images they've already seen";
export const SHARE_PLAYERS_NOTE = "Players added later won't get it";
export const CHANGED_ELSEWHERE = "Changed in another tab";
export const LOST_SAVE = "Connection lost — check the handout before saving again";
export const LOST_SHARE = "Connection lost — check the handout before sharing again";
export const LOST_DELETE = "Connection lost — check the handouts before deleting again";

// ---- Lists (FR-PARTY-12, FR-PARTY-13) ----

/** FR-PARTY-12: DM, newest `seq` first. */
export function dmOrder<T extends Pick<HandoutView, "seq">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.seq - a.seq);
}

/** FR-PARTY-13: player, newest `sharedAt` first (then newest `seq`). */
export function playerOrder<T extends Pick<HandoutView, "seq" | "sharedAt">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => (b.sharedAt ?? "").localeCompare(a.sharedAt ?? "") || b.seq - a.seq,
  );
}

export type Mark = "new" | "updated" | null;

/** FR-PARTY-13 / FR-PARTY-04: never opened → New; opened at an older `rev` → Updated. */
export function markOf(rev: number, seenRev: number | undefined): Mark {
  if (seenRev === undefined) return "new";
  return rev > seenRev ? "updated" : null;
}

export const MARK_TEXT: Record<Exclude<Mark, null>, string> = { new: "New", updated: "Updated" };

/** The share mode a row carries as `data-shared` (DM: full; player: redacted, never `none`). */
export const sharedModeOf = (h: Pick<HandoutView, "sharedWith">): ShareMode => h.sharedWith.mode;

// ---- Activity (FR-PARTY-11) ----

/**
 * Launcher dot while minimised: changes when a handout arrives (newest `sharedAt` / `seq`) or is
 * updated (newest `updatedAt`). Pure read of the store's `handout` rows.
 */
export function handoutActivity(store: RecordStore): string | null {
  const rows = Object.values(store.records[HANDOUT_TYPE] ?? {}) as HandoutView[];
  if (rows.length === 0) return null;
  let shared = "";
  let updated = "";
  let seq = 0;
  for (const r of rows) {
    if ((r.sharedAt ?? "") > shared) shared = r.sharedAt ?? "";
    if (r.updatedAt > updated) updated = r.updatedAt;
    if (r.seq > seq) seq = r.seq;
  }
  return `${seq}|${shared}|${updated}`;
}

// ---- Editor (FR-PARTY-15) ----

export interface HandoutDraft {
  title: string;
  body: string;
  imageAssetIds: string[];
}

export const EMPTY_HANDOUT: HandoutDraft = { title: "", body: "", imageAssetIds: [] };

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Invalid";

/** FR-PARTY-02 mirrored: the draft's cleaned input, or why not. */
export function handoutPayload(d: HandoutDraft): Parsed<HandoutInput> {
  const r = CreateHandoutIntent.safeParse(d);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: firstIssue(r.error) };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** FR-PARTY-15: Save is disabled while the cleaned draft equals what is stored. */
export function draftUnchanged(
  d: HandoutDraft,
  stored: { title: string; body: string; imageAssetIds: readonly string[] } | null,
): boolean {
  if (stored === null) return false;
  const p = handoutPayload(d);
  if (!p.ok) return false;
  return (
    p.value.title === stored.title &&
    p.value.body === stored.body &&
    sameList(p.value.imageAssetIds, stored.imageAssetIds)
  );
}

/** Body counter "‹n› / 10 000" (raw length; the server cleans and trims). */
export const bodyCounter = (body: string) =>
  `${body.length.toLocaleString("en-US")} / ${HANDOUT_BODY_MAX.toLocaleString("en-US")}`;

/** Images strip: add (≤ 10, once each), remove, move left / right. */
export function addImage(ids: readonly string[], id: string): string[] {
  if (ids.includes(id) || ids.length >= HANDOUT_IMAGES_MAX) return [...ids];
  return [...ids, id];
}
export const removeImage = (ids: readonly string[], i: number) => ids.filter((_, j) => j !== i);
export function moveImage(ids: readonly string[], i: number, by: -1 | 1): string[] {
  const j = i + by;
  if (i < 0 || i >= ids.length || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j] as string, out[i] as string];
  return out;
}

// ---- Share dialog (FR-PARTY-16) ----

export interface ShareDraft {
  mode: ShareMode;
  playerIds: string[];
}

export const shareDraftOf = (s: SharedWith): ShareDraft => ({
  mode: s.mode,
  playerIds: [...s.playerIds],
});

/** The draft as a `sharedWith` value: player ticks count only under Chosen. */
export function sharePayload(d: ShareDraft, playerOrder: readonly string[]): Parsed<SharedWith> {
  const ids = d.mode === "players" ? playerOrder.filter((p) => d.playerIds.includes(p)) : [];
  const r = SharedWith.safeParse({ mode: d.mode, playerIds: ids });
  return r.success ? { ok: true, value: r.data } : { ok: false, message: firstIssue(r.error) };
}

/** FR-PARTY-16: "Share" disabled while Chosen has none ticked, unchanged, not live or in flight. */
export function shareEnabled(
  d: ShareDraft,
  stored: SharedWith,
  playerOrder: readonly string[],
  s: { live: boolean; busy: boolean },
): boolean {
  const p = sharePayload(d, playerOrder);
  return p.ok && !sameShare(p.value, stored) && s.live && !s.busy;
}

export const togglePlayer = (ids: readonly string[], id: string, on: boolean): string[] =>
  on ? (ids.includes(id) ? [...ids] : [...ids, id]) : ids.filter((x) => x !== id);

/** FR-PARTY-16 edge (PARTY §11): Chosen with every current player ticked stays `players`. */
export const choseEveryone = (d: ShareDraft, playerOrder: readonly string[]) =>
  d.mode === "players" &&
  playerOrder.length > 0 &&
  playerOrder.every((p) => d.playerIds.includes(p));

// ---- Intent outcomes ----

/** A reject → inline message; an intent lost to a disconnect → the form's toast. */
export function intentFailure(
  err: unknown,
  lost: string,
): { kind: "inline"; message: string } | { kind: "toast"; message: string } {
  if (err instanceof IntentRejected) {
    if (err.code === "disconnected" || err.code === "offline")
      return { kind: "toast", message: lost };
    return { kind: "inline", message: err.message };
  }
  return { kind: "inline", message: "Something went wrong" };
}

/** The handout id a `handout-shared` notification points at, if any. */
export function handoutIdOf(payload: unknown): string | null {
  const id = (payload as { handoutId?: unknown } | null)?.handoutId;
  return typeof id === "string" ? id : null;
}

// ---- Companions tab (FR-PARTY-41–44, sprint 6) ----

export const EMPTY_COMPANIONS = "No companions yet";
export const EMPTY_COMPANIONS_PLAYER = "No companions yet — your DM can give you one";
export const SUMMONS_FOOTER = "Summons show in Initiative";
/** FR-PARTY-43: Owner… and Release… while the pet is an active combatant (FR-ENT-33). */
export const PET_IN_FIGHT_HINT = "Dismiss it from the fight first";
export const LOST_PET = "Connection lost — check the pet before trying again";

export interface CompanionViewer {
  role: "dm" | "player";
  playerId: string | null;
}

export interface CompanionRow {
  id: string;
  name: string;
  portraitAssetId: string | null;
  ownerCharacterId: string;
  ownerPlayerId: string;
  /** Unknown to other players out of a fight (redacted row). */
  turnMode: TurnMode | null;
  /** DM only: the pet's base (`derivedFromId`). */
  baseId: string | null;
  /** FR-PARTY-42: an active combatant now ("In combat"). */
  inCombat: boolean;
  /** HP numbers for the DM and the owner: the combatant's in a fight, else the pet row's. */
  hp: { current: number; max: number } | null;
  band: HealthBand;
  /** FR-PARTY-42: Card for the DM and the owner. */
  card: boolean;
  /** DM: the full row the menu's whole `PUT` replaces (FR-ENT-33). */
  record: MonsterRecord | null;
}

export interface CompanionGroup {
  characterId: string;
  characterName: string;
  /** The owner player, for the colour dot (FR-CAMP-29). */
  playerId: string;
  rows: CompanionRow[];
}

/** A combatant as either client holds it: only the fields the tab reads. */
interface CombatantLike {
  kind?: string;
  entityId?: string;
  name?: string;
  active?: boolean;
  pet?: boolean;
  ownerCharacterId?: string | null;
  turnMode?: TurnMode | null;
  hpCurrent?: number | null;
  hpMax?: number | null;
  band?: HealthBand;
}

type PetView = { full: true; pet: MonsterRecord } | { full: false; pet: RedactedPet };

/**
 * A pet row as the viewer holds it (FR-ENT-37): the DM's full row; the owner's full row minus
 * `derivedFromId` / `petPresent` (parsed with them null / false); another player's redacted row.
 */
function petView(r: unknown): PetView | null {
  const red = RedactedPet.safeParse(r);
  if (red.success) return { full: false, pet: red.data };
  const full = EntityRecord.safeParse({ derivedFromId: null, ...(r as object) });
  if (!full.success || full.data.kind !== "monster" || full.data.companionOf === null) return null;
  return { full: true, pet: full.data };
}

/**
 * The pet's active combatant: the DM's rows carry `entityId`; players' monster views don't, so
 * theirs match by owner PC and name (a pet joins under its own name, FR-CBT-109), never a row the
 * owner sees as a summon (`pet: false`).
 */
function combatantOf(
  pet: { id: string; name: string; companionOf: string },
  combatants: readonly CombatantLike[],
): CombatantLike | null {
  for (const c of combatants) {
    if (c.kind !== "monster" || c.active === false) continue;
    if (c.entityId !== undefined) {
      if (c.entityId === pet.id) return c;
      continue;
    }
    if (c.pet !== false && c.ownerCharacterId === pet.companionOf && c.name === pet.name) return c;
  }
  return null;
}

/**
 * FR-PARTY-41 / -42: every pet the viewer receives, grouped by owner PC (groups by PC name, rows
 * by name). `characterName` = the PC's name in the store (players hold others' redacted).
 */
export function companionGroups(
  entities: readonly unknown[],
  combatants: readonly unknown[],
  viewer: CompanionViewer,
): CompanionGroup[] {
  const names = new Map<string, string>();
  for (const e of entities) {
    const r = e as { id?: unknown; kind?: unknown; name?: unknown };
    if (r.kind === "character" && typeof r.id === "string" && typeof r.name === "string") {
      names.set(r.id, r.name);
    }
  }
  const cs = combatants as readonly CombatantLike[];
  const groups = new Map<string, CompanionGroup>();
  for (const e of entities) {
    const v = petView(e);
    if (!v) continue;
    const companionOf = v.pet.companionOf as string;
    const ownerPlayerId = v.pet.ownerPlayerId as string;
    const c = combatantOf({ id: v.pet.id, name: v.pet.name, companionOf }, cs);
    const numbers = v.full && (viewer.role === "dm" || viewer.playerId === ownerPlayerId);
    let hp: CompanionRow["hp"] = null;
    if (numbers && v.full) {
      hp =
        c && typeof c.hpCurrent === "number" && typeof c.hpMax === "number"
          ? { current: c.hpCurrent, max: c.hpMax }
          : { current: v.pet.hpCurrent ?? v.pet.statBlock.hpMax, max: v.pet.statBlock.hpMax };
    }
    const band: HealthBand = hp
      ? healthBand(hp.current, hp.max)
      : (c?.band ?? (v.full ? "healthy" : v.pet.band));
    const row: CompanionRow = {
      id: v.pet.id,
      name: v.pet.name,
      portraitAssetId: v.pet.portraitAssetId,
      ownerCharacterId: companionOf,
      ownerPlayerId,
      turnMode: c?.turnMode ?? (v.full ? v.pet.turnMode : null),
      baseId: viewer.role === "dm" && v.full ? v.pet.derivedFromId : null,
      inCombat: c !== null,
      hp,
      band,
      card: numbers,
      record: viewer.role === "dm" && v.full ? v.pet : null,
    };
    const g = groups.get(companionOf) ?? {
      characterId: companionOf,
      characterName: names.get(companionOf) ?? "(unknown)",
      playerId: ownerPlayerId,
      rows: [],
    };
    g.rows.push(row);
    groups.set(companionOf, g);
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  return [...groups.values()]
    .map((g) => ({
      ...g,
      rows: g.rows.sort((a, b) => byName(a.name, b.name) || byName(a.id, b.id)),
    }))
    .sort(
      (a, b) => byName(a.characterName, b.characterName) || byName(a.characterId, b.characterId),
    );
}

/** FR-PARTY-44: the muted "Summons show in Initiative" footer while a fight runs. */
export const fightRunning = (combatants: readonly unknown[]) =>
  (combatants as readonly CombatantLike[]).some((c) => c.active !== false);

/** FR-PARTY-42 `party-companion-hp` `data-value`: "45/59". */
export const hpValue = (hp: { current: number; max: number }) => `${hp.current}/${hp.max}`;
