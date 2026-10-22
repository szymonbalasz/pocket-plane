// Pause screen logic (sprint 8 TT4; play-shell FR-SHELL-125–129, -136; CAMP FR-CAMP-46): what the
// campaign row says, the countdown text, the resume catch-up and the DM's draft. Pure.
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import {
  BackInMin,
  type CampaignPause,
  PAUSE_MESSAGE_MAX,
} from "@shared/campaign-management/table-state";
import { ENCOUNTER_TYPE, type EncounterView } from "@shared/combat-tracker/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { z } from "zod";
import { type TurnAlert, turnAlertFor } from "../combat-tracker/turn-alert";
import { pendingPrompts } from "../dice-extras/request-sound";

/** FR-CAMP-46: the client's campaign's pause card, or null while running. */
export function pauseOf(store: RecordStore): CampaignPause | null {
  const byId = store.records.campaign as Record<string, CampaignRecord> | undefined;
  const id = store.you?.campaignId;
  const c = (id ? byId?.[id] : undefined) ?? (id ? undefined : Object.values(byId ?? {})[0]);
  return c?.pause ?? null;
}

/** FR-SHELL-125, -127: a player under the card (the DM is never paused). */
export const isPausedFor = (store: RecordStore): boolean =>
  store.you?.role === "player" && pauseOf(store) !== null;

const mss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * FR-SHELL-126: "Back in m:ss" from `backAt` on the client clock (skew accepted); ≤ 0 → "Back
 * soon"; no `backAt` → null (no countdown).
 */
export function countdownText(backAt: string | null, nowMs: number): string | null {
  if (backAt === null) return null;
  const left = Date.parse(backAt) - nowMs;
  return left > 0 ? `Back in ${mss(left)}` : "Back soon";
}

/** FR-SHELL-129: the DM button's label: "Pause"; paused "Paused · m:ss" (or "Paused"). */
export function controlLabel(pause: CampaignPause | null, nowMs: number): string {
  if (!pause) return "Pause";
  if (pause.backAt === null) return "Paused";
  const left = Date.parse(pause.backAt) - nowMs;
  return left > 0 ? `Paused · ${mss(left)}` : "Paused · 0:00";
}

/**
 * FR-SHELL-129: the control's top-bar slot: 128 px (its widest state) from 1280 wide, else 40
 * (icon-only); the button inside is `controlWidth`.
 */
export const pauseSlotWidth = (viewport: { w: number }): number => (viewport.w < 1280 ? 40 : 128);

/** FR-SHELL-129: the control's width, px: 96 running, 128 paused, 40 icon-only below 1280 wide. */
export function controlWidth(paused: boolean, viewportW: number): number {
  if (viewportW < 1280) return 40;
  return paused ? 128 : 96;
}

/** The resume sound (FR-SHELL-127): one, by priority turn > request > resume. */
export type ResumeSound = "turn" | "request" | "resume";

/**
 * FR-SHELL-127 at resume, for player `store.you`: the turn alert if it is their PC's turn now
 * (FR-CBT-41's own predicate on the started encounter), and the one sound: `turn` with it; else
 * `request` when a roll-request prompt for them arrived during the pause (`since` = the pause's
 * `startedAt`) and still waits; else `resume`.
 */
export function resumeCatchUp(
  store: RecordStore,
  since: string | null,
): { turn: TurnAlert | null; sound: ResumeSound } {
  const turn = myTurnAlert(store);
  if (turn) return { turn, sound: "turn" };
  return { turn: null, sound: promptArrivedSince(store, since) ? "request" : "resume" };
}

function myTurnAlert(store: RecordStore): TurnAlert | null {
  const enc = recordsOf<EncounterView>(store, ENCOUNTER_TYPE).find(
    (e) => e.status === "started" && e.playerTurnCombatantId,
  );
  if (!enc) return null;
  return turnAlertFor(
    {
      cause: { name: TurnChanged.type },
      changes: [{ type: ENCOUNTER_TYPE, op: "upsert", id: enc.id, data: enc }],
    },
    store,
  );
}

/** TT2's seam (FR-DICEX-90): this player's open prompts; those that came during the pause. */
const promptArrivedSince = (store: RecordStore, since: string | null): boolean =>
  pendingPrompts(store).some((n) => since === null || n.createdAt >= since);

/** FR-SHELL-129: the DM's draft, browser only (`pp.pause.v1.<campaignId>`). */
export const PauseDraft = z.object({
  message: z.string().max(PAUSE_MESSAGE_MAX).catch(""),
  imageAssetId: z.string().nullable().catch(null),
  backInMin: BackInMin.nullable().catch(null),
});
export type PauseDraft = z.infer<typeof PauseDraft>;

export const EMPTY_DRAFT: PauseDraft = { message: "", imageAssetId: null, backInMin: null };

export const draftKey = (campaignId: string) => `pp.pause.v1.${campaignId}`;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readDraft(storage: DraftStorage | null, campaignId: string): PauseDraft {
  try {
    const raw = storage?.getItem(draftKey(campaignId));
    if (!raw) return EMPTY_DRAFT;
    const r = PauseDraft.safeParse(JSON.parse(raw));
    return r.success ? r.data : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function writeDraft(
  storage: DraftStorage | null,
  campaignId: string,
  draft: PauseDraft,
): void {
  try {
    storage?.setItem(draftKey(campaignId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the draft is a convenience.
  }
}
