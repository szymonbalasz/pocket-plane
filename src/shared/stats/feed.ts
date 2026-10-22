// Kill-feed wording (FR-STATS-27): one line per `fell` / callout outcome, from the line's names.
// Shared so the feed toast (SB1, FR-STATS-28) and Highlights' Kills / Downs read the same.

export interface FeedEvent {
  /** Absent: a callout on a target already down (FR-STATS-22's text). */
  fell?: "kill" | "down";
  /** The attacker's name; null = the DM's direct damage. */
  from: string | null;
  to: string;
  callout: boolean;
  /** DM only: the callout's overkill amount. */
  overkill?: number;
  /** DM only: players never saw the line. */
  hidden?: boolean;
  /** The line's damage (a callout without `fell`). */
  damage?: number;
}

/**
 * "Thorn finished Goblin 1" / "Goblin 1 falls"; "Goblin 2 dropped Brakka" / "Brakka is down"; a
 * callout starts "Overkill! ". The DM's adds ", overkill 23" and " (hidden)"; players never get an
 * amount (the caller passes none).
 */
export function feedText(e: FeedEvent): string {
  let text: string;
  if (e.fell === "kill") text = e.from ? `${e.from} finished ${e.to}` : `${e.to} falls`;
  else if (e.fell === "down") text = e.from ? `${e.from} dropped ${e.to}` : `${e.to} is down`;
  else text = `${e.from ?? "DM"} → ${e.to}${e.damage !== undefined ? `: ${e.damage} damage` : ""}`;
  if (e.callout) text = `Overkill! ${text}`;
  if (e.overkill !== undefined && e.callout) text += `, overkill ${e.overkill}`;
  if (e.hidden) text += " (hidden)";
  return text;
}
