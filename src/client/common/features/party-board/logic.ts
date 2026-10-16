// Pure client rules of the Party windows' handout parts (FR-PARTY-09–16): list order per role,
// New / Updated marks from the seen revs, editor and Share drafts → intent payloads (FR-PARTY-02
// and FR-PARTY-05 mirrored with the shared zod schemas), launcher activity. No React.
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

export const PARTY_TABS = ["handouts", "inventory"] as const;
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
