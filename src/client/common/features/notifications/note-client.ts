// Per-page notifications client state outside the synced store: the seen marker and whether
// `note.history` is open (FR-NOTE-18). One instance per client app (window def factory).
import type { RecordStore } from "@shared/protocol/store";
import { refreshBadges } from "../play-shell/badges";
import { maxSeq, seenKey, unreadCount } from "./logic";
import { browserSeenStore, type SeenStore } from "./seen";

export interface NoteClient {
  /** FR-NOTE-18 badge: unread for this client. */
  unread(store: RecordStore): number;
  /** No entry yet → baseline = highest `seq` in this (first) snapshot. */
  baseline(store: RecordStore): void;
  /** While `note.history` is open and the tab visible: last seen = highest `seq` in the store. */
  markSeen(store: RecordStore): void;
  setHistoryOpen(open: boolean, store: RecordStore): void;
}

export function createNoteClient(
  opts: { seen?: () => SeenStore; isVisible?: () => boolean; refresh?: () => void } = {},
): NoteClient {
  let seen: SeenStore | null = null;
  const store = () => {
    seen ??= (opts.seen ?? browserSeenStore)();
    return seen;
  };
  const isVisible =
    opts.isVisible ??
    (() => typeof document === "undefined" || document.visibilityState === "visible");
  const refresh = opts.refresh ?? refreshBadges;
  let open = false;

  const lastSeen = (s: RecordStore): number => {
    const key = seenKey(s);
    return (key ? store().get(key) : null) ?? maxSeq(s);
  };

  const client: NoteClient = {
    unread: (s) => unreadCount(s, lastSeen(s)),
    baseline(s) {
      const key = seenKey(s);
      if (key && store().get(key) === null) {
        store().set(key, maxSeq(s));
        refresh();
      }
    },
    markSeen(s) {
      const key = seenKey(s);
      if (!key || !open || !isVisible()) return;
      const top = maxSeq(s);
      if (store().get(key) !== top) {
        store().set(key, top);
        refresh();
      }
    },
    setHistoryOpen(o, s) {
      open = o;
      if (o) client.markSeen(s);
    },
  };
  return client;
}
