// FR-CBTX-25 skip cue: dead PCs join FR-CBT-50's "Skipped …" Toast as "(dead)". One copy for the
// Initiative window's step and the palette's N / Shift+N (BL-94).
import { skippedText } from "@shared/combat-tracker/rules";

/** "Skipped Goblin (down), Thorn (dead) · Round 2"; FR-CBT-50's text when nobody is dead. */
export function skipText(
  s: { names: readonly string[]; round: number | null },
  dead: ReadonlySet<string>,
): string {
  const deadNames = s.names.filter((n) => dead.has(n));
  if (deadNames.length === 0) return skippedText(s);
  const down = s.names.filter((n) => !dead.has(n));
  const parts = [
    ...(down.length > 0 ? [`${down.join(", ")} (down)`] : []),
    `${deadNames.join(", ")} (dead)`,
  ];
  return `Skipped ${parts.join(", ")}${s.round !== null ? ` · Round ${s.round}` : ""}`;
}
