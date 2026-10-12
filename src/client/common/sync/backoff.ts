import { BACKOFF_JITTER, BACKOFF_MAX_MS, BACKOFF_START_MS } from "@shared/protocol/frames";

/** FR-SYNC-05: 0.5 s doubling to 5 s, ±20 % jitter. `attempt` starts at 0. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_MAX_MS);
  const jitter = 1 + (random() * 2 - 1) * BACKOFF_JITTER;
  return Math.round(base * jitter);
}
