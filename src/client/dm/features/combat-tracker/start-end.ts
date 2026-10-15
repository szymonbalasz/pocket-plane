// DM Start / End around the intents (pure; bun test): the End confirm's pending-card count
// (FR-CBT-59) and the windows that follow the DM's own acked Start / End (FR-CBT-60).
import { endsWithEncounter } from "@shared/notifications/end-rule";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { ENCOUNTERS_KIND, INITIATIVE_KIND } from "@ui/features/combat-tracker/window";
import type { NotificationView } from "@ui/features/notifications/views";
import type { WindowAction } from "@ui/features/play-shell/manager";

/**
 * FR-CBT-59: pending notifications End will dismiss = those whose DM view entry carries an end
 * rule with "dismiss" and whose `encounterIdOf(payload)` is this encounter. Kinds without a rule
 * (e.g. a concentration card with the same `encounterId`) don't count.
 */
export function endPendingCount(
  notes: readonly NotificationRecord[],
  viewOf: (kind: string) => Pick<NotificationView, "endRule"> | undefined,
  encounterId: string,
): number {
  return notes.filter(
    (n) =>
      n.state === "pending" && endsWithEncounter(viewOf(n.kind)?.endRule, n.payload, encounterId),
  ).length;
}

/** The End confirm's second sentence; 0 → none (first sentence only). */
export function endPendingText(n: number): string {
  if (n === 0) return "";
  // P3 glitch 9: one card reads in the singular.
  return n === 1
    ? "1 pending card will be dismissed: apply it first if it counts."
    : `${n} pending cards will be dismissed: apply them first if they count.`;
}

export const END_FIRST_SENTENCE = "Combatants leave the initiative list.";

export interface ShellEffects {
  dispatch(action: WindowAction): void;
  noteAppearance(): void;
}

/**
 * FR-CBT-60: send `cbt.start`; once **this tab's** intent is acked, Initiative opens and comes to
 * front, Encounters minimises, then one appearance is noted (the map refits if still fitted). A
 * reject or a dropped connection (`undefined`) changes nothing; nothing here runs on snapshots.
 */
export async function startAndFollow(
  send: () => Promise<unknown>,
  fx: ShellEffects,
): Promise<unknown> {
  const r = await send();
  if (r === undefined) return r;
  fx.dispatch({ type: "open", kind: INITIATIVE_KIND });
  fx.dispatch({ type: "minimise", kind: ENCOUNTERS_KIND });
  fx.noteAppearance();
  return r;
}

/** FR-CBT-60: send `cbt.end`; once acked, this tab's Initiative minimises (launcher keeps it). */
export async function endAndFollow(
  send: () => Promise<unknown>,
  fx: Pick<ShellEffects, "dispatch">,
): Promise<unknown> {
  const r = await send();
  if (r === undefined) return r;
  fx.dispatch({ type: "minimise", kind: INITIATIVE_KIND });
  return r;
}

/**
 * P3 glitch 3 (amends FR-CBT-60): once per page load, at the first live store with the layout
 * applied, an open Initiative with no started encounter minimises (empty, it only covered the
 * map; the launcher keeps it), and one appearance is noted so a fitted map refits into the room.
 * Opened again by the DM, it stays open.
 */
export function idleInitiativeOnLoad(o: { started: boolean; open: boolean }, fx: ShellEffects) {
  if (o.started || !o.open) return;
  fx.dispatch({ type: "minimise", kind: INITIATIVE_KIND });
  fx.noteAppearance();
}
