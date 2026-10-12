// Seen marker (FR-NOTE-18): last seen notification `seq` per (campaign, owner) in
// localStorage; never sent. Storage failure → memory only (one warning).
export type SeenBackend = Pick<Storage, "getItem" | "setItem">;

export interface SeenStore {
  /** Stored value, or null when there is no entry. Never throws. */
  get(key: string): number | null;
  /** Never throws; a value lower than the stored one is still written (last write wins). */
  set(key: string, seq: number): void;
}

export function createSeenStore(
  getBackend: () => SeenBackend,
  warn: (msg: string, err?: unknown) => void = (m, e) => console.warn(m, e),
): SeenStore {
  const memory = new Map<string, number>();
  let failed = false;
  const fail = (err: unknown) => {
    if (!failed) warn("notifications: seen marker storage failed; keeping it in memory", err);
    failed = true;
  };
  return {
    get(key) {
      if (!failed) {
        try {
          const raw = getBackend().getItem(key);
          if (raw === null) return memory.get(key) ?? null;
          const n = Number(raw);
          return Number.isInteger(n) && n >= 0 ? n : null;
        } catch (err) {
          fail(err);
        }
      }
      return memory.get(key) ?? null;
    },
    set(key, seq) {
      memory.set(key, seq);
      if (failed) return;
      try {
        getBackend().setItem(key, String(seq));
      } catch (err) {
        fail(err);
      }
    },
  };
}

export const browserSeenStore = (): SeenStore => createSeenStore(() => window.localStorage);
