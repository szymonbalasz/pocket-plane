// campaign-management boundary schemas (CAMP §6, §9). Used by server and both clients.
import { z } from "zod";

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point (CAMP §11).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function name(max: number, label: string) {
  return z
    .string()
    .refine((s) => !CONTROL.test(s), { message: `${label} must not contain control characters` })
    .transform((s) => s.trim())
    .refine((s) => s.length >= 1, { message: `${label} is required` })
    .refine((s) => [...s].length <= max, { message: `${label} must be at most ${max} characters` });
}

/** FR-CAMP-06: trimmed, 1–60 chars, control chars rejected. */
export const CampaignName = name(60, "Campaign name");
/** FR-CAMP-12: trimmed, 1–40 chars. */
export const PlayerName = name(40, "Player name");

/** Case-insensitive name key for uniqueness checks (FR-CAMP-06, FR-CAMP-12). */
export const nameKey = (s: string) => s.normalize("NFC").toLowerCase();

/** 128-bit base64url link token (FR-CAMP-13). */
export const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

// ---- Sync record types (wire shapes; no token field exists) ----
export const CampaignRecord = z.object({ id: z.string(), name: z.string() });
export type CampaignRecord = z.infer<typeof CampaignRecord>;

export const PlayerRecord = z.object({ id: z.string(), campaignId: z.string(), name: z.string() });
export type PlayerRecord = z.infer<typeof PlayerRecord>;

// ---- REST bodies and responses ----
export const CreateCampaignBody = z.object({ name: CampaignName });
export const RenameCampaignBody = z.object({ name: CampaignName });
export const AddPlayerBody = z.object({ name: PlayerName });
export const RenamePlayerBody = z.object({ name: PlayerName });

export const CampaignSummary = z.object({ id: z.string(), name: z.string(), active: z.boolean() });
export type CampaignSummary = z.infer<typeof CampaignSummary>;

/** Only `/api/players` returns tokens (CAMP §9). */
export const PlayerWithLink = z.object({ id: z.string(), name: z.string(), linkToken: LinkToken });
export type PlayerWithLink = z.infer<typeof PlayerWithLink>;

export const JoinInfo = z.object({
  playerName: z.string(),
  campaignName: z.string(),
  campaignActive: z.boolean(),
});
export type JoinInfo = z.infer<typeof JoinInfo>;

/** Player link path (OQ-CAMP-15, proposed). */
export const playerLinkPath = (token: string) => `/p/${token}`;
export const playerLinkUrl = (baseUrl: string, token: string) =>
  `${baseUrl.replace(/\/+$/, "")}${playerLinkPath(token)}`;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** CAMP §7: warn when links would only work on this machine. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return LOOPBACK.has(h) || h.startsWith("127.");
  } catch {
    return false;
  }
}
