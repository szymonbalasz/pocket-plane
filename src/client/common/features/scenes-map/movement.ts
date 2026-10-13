// Movement indicator (FR-MAP-37): local only, never blocks. `move` = the 5/10/5 drag distance,
// `used` = movement already used this turn from a token overlay (combat), null outside combat.
// DOM-free so it runs under `bun test`.

/** Konva attr `tone` of `map-move-label`. normal = foreground, dash = `hp.bloodied`, over = `hp.down`. */
export type MoveTone = "none" | "normal" | "dash" | "over";

export interface MoveIndicator {
  tone: MoveTone;
  text: string;
}

export function movementIndicator(
  move: number,
  used: number | null,
  speed: number | null | undefined,
): MoveIndicator {
  if (speed === null || speed === undefined) return { tone: "none", text: `${move} ft` };
  const total = (used ?? 0) + move;
  const tone: MoveTone = total <= speed ? "normal" : total <= 2 * speed ? "dash" : "over";
  const text = used === null ? `${total} / ${speed} ft` : `move ${move} · ${total} / ${speed} ft`;
  return { tone, text };
}
