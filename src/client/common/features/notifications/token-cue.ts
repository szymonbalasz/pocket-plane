// Action cue (FR-NOTE-30, N11; DM client only): a live `NotificationCreated` frame that brings a
// pending row owned by a player cues, for 4 s, the tokens its kind's DM view names
// (`cueTokens`, e.g. combat-extras' concentration card, FR-CBTX-49), else the default: the action
// player's tokens on the viewed scene bound to an active combatant of the started encounter, else
// all their tokens there. Drawn as scenes-map's `cue` decoration through the `note` line of the
// token overlay registry (FR-MAP-49), in the action owner's player colour (FR-NOTE-40). Never from
// a snapshot, resync or reconnect. Client memory only; the label is always the notification text.
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import { colorOf } from "../campaign-management/colors";
import type { TokenOverlay } from "../scenes-map/token-overlays";
import { createdIn, NOTIFICATION_TYPE, type SyncView, type Transition } from "./logic";
import type { NotificationView } from "./views";

export const CUE_MS = 4000;
export const NOTE_CUE_ID = "note-token-cue";

/** FR-NOTE-30: the rows of one sync change that cue (live event frames, DM, pending, player-owned). */
export function cueTriggers(
  prev: SyncView | null,
  next: SyncView,
  t: Transition,
): NotificationRecord[] {
  if (t !== "event" || prev === null || next.store.you?.role !== "dm") return [];
  return createdIn(prev.store, next.store).filter(
    (n) => n.state === "pending" && n.actionRole === "player",
  );
}

interface CombatantLike {
  encounterId: string;
  tokenId: string | null;
  active?: boolean;
  removed?: boolean;
}

/** Token ids bound to an active, non-removed combatant of the started encounter. */
export function boundTokenIds(store: RecordStore): Set<string> {
  const started = Object.values(store.records[ENCOUNTER_TYPE] ?? {}).find(
    (e) => (e as { status?: string }).status === "started",
  ) as { id: string } | undefined;
  const out = new Set<string>();
  if (!started) return out;
  for (const c of Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantLike[]) {
    if (c.encounterId === started.id && c.active !== false && !c.removed && c.tokenId) {
      out.add(c.tokenId);
    }
  }
  return out;
}

export const tokensOn = (store: RecordStore, sceneId: string | null): TokenView[] =>
  sceneId === null
    ? []
    : (Object.values(store.records[TOKEN_TYPE] ?? {}) as TokenView[]).filter(
        (t) => t.sceneId === sceneId,
      );

/** FR-NOTE-30 default: the owner's bound tokens on the viewed scene, else all their tokens there. */
export function defaultCueTokens(
  n: Pick<NotificationRecord, "actionPlayerId">,
  store: RecordStore,
  viewedSceneId: string | null,
): string[] {
  if (!n.actionPlayerId) return [];
  const owned = tokensOn(store, viewedSceneId).filter((t) => t.ownerPlayerId === n.actionPlayerId);
  const bound = boundTokenIds(store);
  const inCombat = owned.filter((t) => bound.has(t.id));
  return (inCombat.length > 0 ? inCombat : owned).map((t) => t.id);
}

/** The kind's `cueTokens` hook wins; else the default rule. */
export function cueTokensFor(
  view: NotificationView | undefined,
  n: NotificationRecord,
  store: RecordStore,
  viewedSceneId: string | null,
): string[] {
  return view?.cueTokens
    ? view.cueTokens(n, store, viewedSceneId)
    : defaultCueTokens(n, store, viewedSceneId);
}

// ---- cue memory (pure) ----

export interface Cue {
  notificationId: string;
  until: number;
  /** Tokens to cue, resolved when drawn (the viewed scene = the drawn token's scene). */
  tokensFor(store: RecordStore, viewedSceneId: string | null): string[];
}

/** Newest last; a notification cues once (a repeat restarts its 4 s). */
export function addCue(cues: readonly Cue[], cue: Cue): Cue[] {
  return [...cues.filter((c) => c.notificationId !== cue.notificationId), cue];
}

export const liveCues = (cues: readonly Cue[], now: number) => cues.filter((c) => c.until > now);

/**
 * The cue on one drawn token: the newest live cue naming it whose row is still pending (a second
 * cue on a token restarts its 4 s); label = the notification text; colour = the action owner's
 * (FR-NOTE-40; an unknown player → the role accent).
 */
export function cueOn(
  cues: readonly Cue[],
  token: Pick<TokenView, "id" | "sceneId">,
  store: RecordStore,
  now: number,
): { id: string; label: string; color?: string } | null {
  const rows = store.records[NOTIFICATION_TYPE] ?? {};
  for (const c of [...liveCues(cues, now)].reverse()) {
    const n = rows[c.notificationId] as NotificationRecord | undefined;
    if (n?.state !== "pending") continue;
    if (c.tokensFor(store, token.sceneId).includes(token.id)) {
      const color = colorOf(store, { role: "player", playerId: n.actionPlayerId });
      return { id: NOTE_CUE_ID, label: n.text, ...(color ? { color } : {}) };
    }
  }
  return null;
}

// ---- page state + the `note` token overlay ----

let cues: Cue[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let clock: () => number = () => Date.now();

const notify = () => {
  for (const fn of [...listeners]) fn();
};

function schedule(): void {
  clearTimeout(timer);
  const now = clock();
  cues = liveCues(cues, now);
  const next = cues.reduce<number | null>(
    (m, c) => (m === null || c.until < m ? c.until : m),
    null,
  );
  if (next !== null) timer = setTimeout(expire, Math.max(0, next - now) + 10);
}

function expire(): void {
  schedule();
  notify();
}

/** FR-NOTE-30: start (or restart) the 4 s cue of the rows a sync change created. */
export function startCues(
  rows: readonly NotificationRecord[],
  viewOf: (kind: string) => NotificationView | undefined,
): void {
  if (rows.length === 0) return;
  const until = clock() + CUE_MS;
  for (const n of rows) {
    cues = addCue(cues, {
      notificationId: n.id,
      until,
      tokensFor: (store, scene) => cueTokensFor(viewOf(n.kind), n, store, scene),
    });
  }
  schedule();
  notify();
}

/** Clears every cue (campaign switch, tests). */
export function clearCues(): void {
  cues = [];
  schedule();
  notify();
}

/** Tests: an injected clock; null → the system clock. */
export function setCueClock(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

/** Token overlay line `note` (FR-NOTE-30, FR-MAP-49): the DM's cue; players get nothing. */
export const noteCueOverlay: TokenOverlay = {
  id: "note",
  decorate(token, store, view) {
    if (view.client !== "dm" || cues.length === 0) return null;
    const cue = cueOn(cues, token, store, clock());
    return cue ? { cue } : null;
  },
  subscribe(onChange) {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
};
