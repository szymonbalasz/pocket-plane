// Presence as the client may show it (FR-SYNC-29, FR-SHELL-33, CAMP §7). Pure; hooks in store.ts.
import type { PresenceRecord } from "@shared/live-sync/schemas";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import type { ConnState } from "./connection";

/**
 * Known only while `live`. Leaving `live` (drop, server outage, `waiting`) makes it unknown at
 * once; the next snapshot makes it known again from that snapshot's records. Never the stale
 * records of the last live session.
 */
export type PresenceView = { known: false } | { known: true; online: ReadonlySet<string> };

export function presenceOf(state: ConnState, store: RecordStore): PresenceView {
  if (state !== "live") return { known: false };
  const online = recordsOf<PresenceRecord>(store, "presence").filter((p) => p.online);
  return { known: true, online: new Set(online.map((p) => p.playerId)) };
}

/** DM top-bar badge (FR-SHELL-06/33): "N/M online", or "– / M online" while unknown. */
export function presenceBadge(
  view: PresenceView,
  players: readonly { id: string; name: string }[],
) {
  if (!view.known) {
    return {
      state: "unknown" as const,
      text: `– / ${players.length} online`,
      tooltip: "Unknown while reconnecting",
      online: null,
    };
  }
  const names = players.filter((p) => view.online.has(p.id)).map((p) => p.name);
  return {
    state: "known" as const,
    text: `${names.length}/${players.length} online`,
    tooltip: names.length ? names.join(", ") : "Nobody online",
    online: names.length,
  };
}

/** Players-panel dot (CAMP §7): muted "–" while presence is unknown. */
export function onlineDot(view: PresenceView, playerId: string): "online" | "offline" | "unknown" {
  if (!view.known) return "unknown";
  return view.online.has(playerId) ? "online" : "offline";
}
