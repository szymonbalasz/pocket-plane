// Pure handout visibility (FR-PARTY-05/06/07, ADR-0021 B): reads record + viewer only, so the
// record-type registry, the leak tests and the clients share one rule.
import type {
  HandoutBodyRecord,
  HandoutPresentRecord,
  HandoutRecord,
  PlayerHandoutBodyRecord,
  PlayerHandoutRecord,
  SharedWith,
} from "./schemas";

export type HandoutVisibility = "full" | "redacted" | "hidden";

/** Structural slice of the connection's viewer (`@server/ws/records` `Viewer`). */
export interface HandoutViewer {
  role: "dm" | "player";
  playerId: string | null;
}

/** FR-PARTY-07: a player sees a handout iff `mode = all` or their id is listed. */
export function sharedWithPlayer(s: SharedWith, playerId: string): boolean {
  if (s.mode === "all") return true;
  return s.mode === "players" && s.playerIds.includes(playerId);
}

/**
 * FR-PARTY-07 for both `handout` and `handout-body`: DM `full`; a player it is shared with gets
 * `redacted` (header: `sharedWith` without ids; body: no `sharedWith`); everyone else `hidden`.
 */
export function handoutVisibility(
  r: { sharedWith: SharedWith },
  v: HandoutViewer,
): HandoutVisibility {
  if (v.role === "dm") return "full";
  if (v.playerId === null) return "hidden";
  return sharedWithPlayer(r.sharedWith, v.playerId) ? "redacted" : "hidden";
}

/** FR-PARTY-07 header redaction: `sharedWith` → `{mode}`, no other recipients' ids (OQ-PARTY-10). */
export function redactHandout(r: HandoutRecord): PlayerHandoutRecord {
  const mode = r.sharedWith.mode;
  if (mode === "none") throw new Error("redactHandout: an unshared handout is hidden");
  return { ...r, sharedWith: { mode } };
}

/** FR-PARTY-07 body redaction: drops `sharedWith`. */
export function redactHandoutBody(r: HandoutBodyRecord): PlayerHandoutBodyRecord {
  const { sharedWith: _, ...rest } = r;
  return rest;
}

/** The players of `campaignPlayerIds` who see a handout shared as `s`. */
export function audienceOf(s: SharedWith, campaignPlayerIds: readonly string[]): string[] {
  return campaignPlayerIds.filter((p) => sharedWithPlayer(s, p));
}

/**
 * FR-PARTY-06 gainers G: players of the campaign at commit who see it after and not before.
 * Listed ids that are no longer players of the campaign never count. Order = `campaignPlayerIds`.
 */
export function shareGainers(
  before: SharedWith,
  after: SharedWith,
  campaignPlayerIds: readonly string[],
): string[] {
  return campaignPlayerIds.filter(
    (p) => sharedWithPlayer(after, p) && !sharedWithPlayer(before, p),
  );
}

/** Players who lose access (they get record deletes, FR-PARTY-07); same rules as `shareGainers`. */
export function shareLosers(
  before: SharedWith,
  after: SharedWith,
  campaignPlayerIds: readonly string[],
): string[] {
  return shareGainers(after, before, campaignPlayerIds);
}

export type ShareNotification = { audience: "all" } | { audience: "player"; playerId: string };

/**
 * FR-PARTY-06: `none` → `all` = one notification, audience `all`; otherwise one per gainer,
 * audience `player`; no gainer → none. Unshare (`after.mode = none`) never notifies.
 */
export function shareNotifications(
  before: SharedWith,
  after: SharedWith,
  campaignPlayerIds: readonly string[],
): ShareNotification[] {
  const gainers = shareGainers(before, after, campaignPlayerIds);
  if (gainers.length === 0) return [];
  if (before.mode === "none" && after.mode === "all") return [{ audience: "all" }];
  return gainers.map((playerId) => ({ audience: "player", playerId }));
}

/** FR-PARTY-05: two `sharedWith` values are the same share (player order ignored → no-op `ack`). */
export function sameShare(a: SharedWith, b: SharedWith): boolean {
  if (a.mode !== b.mode) return false;
  if (a.playerIds.length !== b.playerIds.length) return false;
  const set = new Set(a.playerIds);
  return b.playerIds.every((p) => set.has(p));
}

/** FR-PARTY-31: `handout-present`: DM full; a player only their own row, else hidden. */
export function presentVisibility(
  r: Pick<HandoutPresentRecord, "playerId">,
  v: HandoutViewer,
): HandoutVisibility {
  if (v.role === "dm") return "full";
  return v.playerId !== null && r.playerId === v.playerId ? "full" : "hidden";
}
