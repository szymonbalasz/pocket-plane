// BL-162: a stat block's roll label opens with its creature ("Goblin — Hooked Blade attack": the
// tray and the physical-dice form show it so), and that creature is also the entry's actor. A line
// that names the actor itself reads the label without the repeat; labels and payloads stay as sent.

const SEPARATOR = " — ";

/**
 * The label without a leading "<actor> — " (case-insensitive, after trim); any other label as it
 * is, so "Goblin Boss — Bite" stays whole for the actor "Goblin". What's left is never empty: a
 * trimmed label that holds the separator's trailing space has text after it.
 */
export function labelAfterActor(label: string, actorName: string): string {
  const name = actorName.trim();
  const text = label.trim();
  const named =
    text.slice(0, name.length).toLowerCase() === name.toLowerCase() &&
    text.startsWith(SEPARATOR, name.length);
  return named ? text.slice(name.length + SEPARATOR.length).trim() : label;
}
