// Per-campaign table state on the campaign row (CAMP sprint 8, FR-CAMP-46–48): the pause card and
// the DM's alert-sound picks. JSON leaves, on the wire only when set (null / `{}` → no key).
// Commands: `camp.setAlertSound` TT3, `camp.pause` / `camp.resume` TT4.
import { z } from "zod";
import { AssetId } from "../assets-pipeline/schemas";

/** FR-CAMP-46: the pause message length. */
export const PAUSE_MESSAGE_MAX = 200;
/** FR-CAMP-47: "back in" choices, minutes. */
export const BACK_IN_MINUTES = [5, 10, 15, 30] as const;

/** FR-CAMP-46: `campaign.pause` (null = running); `backAt` / `startedAt` from `ctx.clock`. */
export const CampaignPause = z.strictObject({
  message: z.string().min(1).max(PAUSE_MESSAGE_MAX).nullable(),
  imageAssetId: AssetId.nullable(),
  backAt: z.string().nullable(),
  startedAt: z.string(),
});
export type CampaignPause = z.infer<typeof CampaignPause>;

/** FR-CAMP-48 (OQ-SHELL-72 A): the alerts that play a sound. */
export const ALERT_KEYS = ["turn", "request", "pause", "resume"] as const;
export const AlertKey = z.enum(ALERT_KEYS);
export type AlertKey = z.infer<typeof AlertKey>;

/** FR-CAMP-48: a picked sound, an audio asset ID or `none` (silent). */
export const AlertSoundPick = z.union([AssetId, z.literal("none")]);
export type AlertSoundPick = z.infer<typeof AlertSoundPick>;

/** FR-CAMP-48: `campaign.alertSounds`; an absent key = the default (FR-SHELL-130, OQ-CAMP-36). */
export const AlertSounds = z.strictObject({
  turn: AlertSoundPick.optional(),
  request: AlertSoundPick.optional(),
  pause: AlertSoundPick.optional(),
  resume: AlertSoundPick.optional(),
});
export type AlertSounds = z.infer<typeof AlertSounds>;

/** True when no alert has a pick (the stored `{}`; no wire key). */
export const noAlertSounds = (s: AlertSounds): boolean =>
  ALERT_KEYS.every((k) => s[k] === undefined);

/** FR-CAMP-48: `camp.setAlertSound`; `default` removes the key, `none` silences the alert. */
export const SetAlertSoundInput = z.strictObject({
  alert: AlertKey,
  sound: z.union([z.literal("default"), AlertSoundPick]),
});
export type SetAlertSoundInput = z.infer<typeof SetAlertSoundInput>;

export const SET_ALERT_SOUND_INTENT = "camp.setAlertSound";

/** FR-SHELL-130 / OQ-CAMP-36 A: what an absent key plays (turn, request ping; pause, resume none). */
export const ALERT_DEFAULTS: Record<AlertKey, "ping" | "none"> = {
  turn: "ping",
  request: "ping",
  pause: "none",
  resume: "none",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the rule (FR-CAMP-47).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** FR-CAMP-47: the card's message: no control chars, trimmed, ≤ 200; empty → none. */
export const PauseMessage = z
  .string()
  .refine((s) => !CONTROL.test(s), { message: "Message must not contain control characters" })
  .transform((s) => s.trim())
  .refine((s) => [...s].length <= PAUSE_MESSAGE_MAX, {
    message: `Message must be at most ${PAUSE_MESSAGE_MAX} characters`,
  })
  .transform((s) => (s === "" ? null : s));

export const BackInMin = z.union(BACK_IN_MINUTES.map((m) => z.literal(m)));
export type BackInMin = z.infer<typeof BackInMin>;

/**
 * FR-CAMP-47: `camp.pause` (DM). A field left out keeps its value while paused (none on a new
 * pause); null clears it. `backInMin` → `backAt` = now + N min (`ctx.clock`).
 */
export const PauseInput = z.strictObject({
  message: PauseMessage.nullable().optional(),
  imageAssetId: AssetId.nullable().optional(),
  backInMin: BackInMin.nullable().optional(),
});
export type PauseInput = z.input<typeof PauseInput>;

export const ResumeInput = z.strictObject({});

export const PAUSE_INTENT = "camp.pause";
export const RESUME_INTENT = "camp.resume";

/** FR-CAMP-47: `backAt` for "back in `min`" from `nowMs` (the server's `ctx.clock.now()`). */
export const backAtFrom = (nowMs: number, min: BackInMin): string =>
  new Date(nowMs + min * 60_000).toISOString();
