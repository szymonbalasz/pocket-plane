// Player seen revs bound to the current viewer (FR-PARTY-13): reactive map for the list's marks
// and the viewer's "opening marks it seen".
import { useEffect } from "react";
import { useStore } from "zustand";
import { useSync } from "../../sync/store";
import { partyMemory, type SeenRevs, seenKey } from "./seen";

const NONE: SeenRevs = {};

export function useSeenRevs(): SeenRevs {
  const you = useSync((s) => s.store.you);
  const { seen } = partyMemory();
  const key = you?.role === "player" && you.playerId ? seenKey(you.campaignId, you.playerId) : null;
  useEffect(() => seen.bind(key), [seen, key]);
  return useStore(seen.state, (s) => (s.key === key ? s.seen : NONE));
}

export const markSeen = (id: string, rev: number) => partyMemory().seen.markSeen(id, rev);
