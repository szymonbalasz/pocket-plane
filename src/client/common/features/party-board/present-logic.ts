// Pure client rules of handout present (FR-PARTY-36–38): the player popup's state (own row,
// local hide until the next snapshot, load states), the DM's "On screen" rows, the Share dialog's
// gainers for "Also open it on the screens…", and the "Open on screens…" draft → intent payload
// (FR-PARTY-32 mirrored with the shared zod schema). No React.
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  HANDOUT_SHARED_KIND,
  type HandoutPresentRecord,
  PresentTo,
  type SharedWith,
} from "@shared/party-board/schemas";
import { audienceOf, shareGainers } from "@shared/party-board/visibility";
import { createStore } from "zustand";
import { handoutIdOf, type Parsed } from "./logic";

export const LOST_PRESENT = "Connection lost — check the handout before trying again";
export const NOBODY_NEW = "Nobody new";
export const PRESENT_TICK = "Also open it on the screens of players who newly get it";

// ---- Player popup (FR-PARTY-36, -37) ----

/** The viewer's own row; the store holds at most one (one per player), newest wins anyway. */
export function ownPresent(
  rows: readonly HandoutPresentRecord[],
  playerId: string | null | undefined,
): HandoutPresentRecord | null {
  let best: HandoutPresentRecord | null = null;
  for (const r of rows) {
    if (!playerId || r.playerId !== playerId) continue;
    if (
      !best ||
      r.presentedAt > best.presentedAt ||
      (r.presentedAt === best.presentedAt && r.id > best.id)
    )
      best = r;
  }
  return best;
}

/**
 * FR-PARTY-37 local hides: present id → the snapshot generation it was closed in. A close that
 * never reached the server shows again after the next snapshot if the row is still there.
 */
export type LocalHides = Readonly<Record<string, number>>;

export const hiddenLocally = (h: LocalHides, presentId: string, generation: number) =>
  h[presentId] === generation;

/** Adds a hide; hides of older generations are dropped (they no longer hide anything). */
export function withHide(h: LocalHides, presentId: string, generation: number): LocalHides {
  const next: Record<string, number> = {};
  for (const [id, g] of Object.entries(h)) if (g === generation) next[id] = g;
  next[presentId] = generation;
  return next;
}

/** One per page: the presents this page closed (client memory only). */
export const presentHides = createStore<{ hides: LocalHides }>(() => ({ hides: {} }));

export function hidePresent(presentId: string, generation: number) {
  presentHides.setState((s) => ({ hides: withHide(s.hides, presentId, generation) }));
}

/** FR-PARTY-36: the row the popup shows, or null (no own row, or closed on this page). */
export function shownPresent(
  rows: readonly HandoutPresentRecord[],
  playerId: string | null | undefined,
  hides: LocalHides,
  generation: number,
): HandoutPresentRecord | null {
  const present = ownPresent(rows, playerId);
  return present && !hiddenLocally(hides, present.id, generation) ? present : null;
}

/** `gone` = the load came back without the handout: close silently (and send the close). */
export type ContentState = "loading" | "error" | "show" | "gone";

/** FR-PARTY-36: the popup's content from the header + body load (FR-PARTY-10). */
export function contentState(load: {
  state: "loading" | "ready" | "error";
  loaded: boolean;
}): ContentState {
  if (load.loaded) return "show";
  if (load.state === "ready") return "gone";
  return load.state;
}

/**
 * FR-PARTY-36 / FR-SHELL-01: the popup's layer, over windows, chrome, dialogs and every toast
 * (sonner's toaster sits at 999 999 999), under the dice layer (`DICE_LAYER_Z`, topmost).
 */
export const PRESENT_POPUP_Z = 1_000_000_000;

/** FR-PARTY-36: `handout-shared` notifications of this handout (their toasts hide while shown). */
export function sharedNoteIds(notes: readonly NotificationRecord[], handoutId: string): string[] {
  return notes
    .filter((n) => n.kind === HANDOUT_SHARED_KIND && handoutIdOf(n.payload) === handoutId)
    .map((n) => n.id);
}

/** Image pager text "‹n› / ‹N›" (> 1 image). */
export const pageText = (i: number, n: number) => `${i + 1} / ${n}`;

/** Pager step, clamped to the images. */
export const stepPage = (i: number, by: -1 | 1, n: number) => Math.min(Math.max(i + by, 0), n - 1);

// ---- DM: On screen (FR-PARTY-38 c, d) ----

/** The handout's open rows, in `presentedAt` order (the Tooltip's name order). */
export function presentsOf(
  rows: readonly HandoutPresentRecord[],
  handoutId: string,
): HandoutPresentRecord[] {
  return rows
    .filter((r) => r.handoutId === handoutId)
    .sort((a, b) => a.presentedAt.localeCompare(b.presentedAt) || (a.id < b.id ? -1 : 1));
}

export const onScreenText = (n: number) => `On screen: ${n}`;

/** Tooltip: the players' names in present order; unknown ids skipped. */
export function onScreenNames(
  rows: readonly HandoutPresentRecord[],
  nameOf: (playerId: string) => string | undefined,
): string {
  return rows
    .map((r) => nameOf(r.playerId))
    .filter((n): n is string => n !== undefined)
    .join(", ");
}

// ---- DM: Share dialog tick (FR-PARTY-38 a, FR-PARTY-33) ----

export interface NamedPlayer {
  id: string;
  name: string;
}

/** FR-PARTY-06 gainers of the draft (players' order); none while the draft is invalid. */
export function draftGainers(
  stored: SharedWith,
  draft: Parsed<SharedWith>,
  players: readonly NamedPlayer[],
): NamedPlayer[] {
  if (!draft.ok) return [];
  const ids = new Set(
    shareGainers(
      stored,
      draft.value,
      players.map((p) => p.id),
    ),
  );
  return players.filter((p) => ids.has(p.id));
}

/** "Opens on: Thorn, Mira" or "Nobody new". */
export const opensOnText = (gainers: readonly NamedPlayer[]) =>
  gainers.length === 0 ? NOBODY_NEW : `Opens on: ${gainers.map((p) => p.name).join(", ")}`;

/** The tick counts only when shown (not Not shared) and enabled (someone new). */
export const presentFlag = (ticked: boolean, mode: SharedWith["mode"], gainers: number) =>
  ticked && mode !== "none" && gainers > 0;

// ---- DM: Open on screens… (FR-PARTY-38 b, FR-PARTY-32) ----

export type PresentMode = PresentTo["mode"];

export interface PresentDraft {
  mode: PresentMode;
  playerIds: string[];
}

export const EMPTY_PRESENT_DRAFT: PresentDraft = { mode: "all", playerIds: [] };

/** A checkbox per player who can see it (FR-PARTY-07 at the DM's store). */
export function presentCandidates<P extends NamedPlayer>(
  sharedWith: SharedWith,
  players: readonly P[],
): P[] {
  const ids = new Set(
    audienceOf(
      sharedWith,
      players.map((p) => p.id),
    ),
  );
  return players.filter((p) => ids.has(p.id));
}

/** The draft as `to`: ticks count only under Chosen, and only for candidates, in their order. */
export function presentPayload(
  d: PresentDraft,
  candidates: readonly NamedPlayer[],
): Parsed<PresentTo> {
  const to =
    d.mode === "all"
      ? { mode: "all" as const }
      : {
          mode: "players" as const,
          playerIds: candidates.filter((p) => d.playerIds.includes(p.id)).map((p) => p.id),
        };
  const r = PresentTo.safeParse(to);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, message: r.error.issues[0]?.message ?? "Invalid" };
}

/** Open disabled while Chosen has none ticked, nobody can see it, not live or in flight. */
export function presentEnabled(
  d: PresentDraft,
  candidates: readonly NamedPlayer[],
  s: { live: boolean; busy: boolean },
): boolean {
  return candidates.length > 0 && presentPayload(d, candidates).ok && s.live && !s.busy;
}
