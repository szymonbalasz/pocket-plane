// DM Start / End around the intents (pure; bun test): the End confirm's pending-card count
// (FR-CBT-59), its summon-token and charmed lines (FR-CBT-144, sprint 7) and the windows that
// follow the DM's own acked Start / End (FR-CBT-60).
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
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

/** FR-CBT-141's Start-dialog note (OQ-CBT-92 A; no per-row numbers: the DM store can't know). */
export const START_KEPT_NOTE = "Monsters that were in an earlier fight keep their HP.";

/** FR-CBT-141: the note shows whenever a monster (not a pet) binding takes a placed token. */
export const startKeptNoteShown = (
  rows: readonly { kind: string; pet?: boolean; binding: "token" | "new" | "none" }[],
) => rows.some((r) => r.kind === "monster" && !r.pet && r.binding === "token");

/** FR-CBT-144: names listed before "and N more". */
export const END_SUMMONS_SHOWN = 5;

type EndRow = Pick<
  CombatantRecord,
  | "encounterId"
  | "seq"
  | "kind"
  | "entityId"
  | "name"
  | "active"
  | "tokenId"
  | "summoned"
  | "pet"
  | "ownerCharacterId"
>;

/**
 * FR-CBT-144 (OQ-CBT-94 A), from the DM's store at open time: the summons End will take tokens
 * from (FR-CBT-145's set: every active summoned row with a token, any owner, removed ones too; a
 * dismissed one is inactive, its token gone) and each charmed companion (an owned non-pet,
 * non-summoned row) with its owner PC's name. Row (`seq`) order.
 */
export function endLeavers(
  rows: readonly EndRow[],
  encounterId: string,
  characterName: (id: string) => string | undefined,
): { summons: string[]; charmed: { owner: string; name: string }[] } {
  const mine = rows.filter((r) => r.encounterId === encounterId).sort((a, b) => a.seq - b.seq);
  const summons = mine.filter((r) => r.active && r.summoned && r.tokenId !== null);
  const charmed = mine.filter(
    (r) => r.active && r.ownerCharacterId !== null && !r.pet && !r.summoned,
  );
  const ownerName = (id: string) =>
    mine.find((r) => r.kind === "pc" && r.entityId === id)?.name ?? characterName(id) ?? "";
  return {
    summons: summons.map((r) => r.name),
    charmed: charmed.map((r) => ({ owner: ownerName(r.ownerCharacterId as string), name: r.name })),
  };
}

/** FR-CBT-144: "Summoned creatures' tokens are removed: A, B." (≤ 5 names, then "and N more"). */
export function endSummonsText(names: readonly string[]): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, END_SUMMONS_SHOWN).join(", ");
  const more = names.length - END_SUMMONS_SHOWN;
  return `Summoned creatures' tokens are removed: ${shown}${more > 0 ? ` and ${more} more` : ""}.`;
}

/** FR-CBT-144 / #310 (2): "Mira's charmed Goblin 2 stays as a monster." */
export const endCharmedText = (c: { owner: string; name: string }) =>
  `${c.owner}'s charmed ${c.name} stays as a monster.`;

export interface ShellEffects {
  dispatch(action: WindowAction): void;
  noteAppearance(): void;
  /**
   * Resolves once the page has laid out the acked Start (a frame), so Initiative's content height
   * is measured with the new rows before it is placed (FR-SHELL-39, -40). Absent: no wait.
   */
  settle?(): Promise<void>;
}

/**
 * FR-CBT-60: send `cbt.start`; once **this tab's** intent is acked, Encounters minimises, then
 * Initiative opens and comes to front, then one appearance is noted (the map refits if still
 * fitted). Encounters goes first so Initiative's placement sees the layout after Start
 * (FR-SHELL-41: it may take Encounters' spot, never another window's), after one layout frame
 * (`settle`) so it is placed at the height its rows take. A reject or a dropped connection
 * (`undefined`) changes nothing; nothing here runs on snapshots.
 */
export async function startAndFollow(
  send: () => Promise<unknown>,
  fx: ShellEffects,
): Promise<unknown> {
  const r = await send();
  if (r === undefined) return r;
  await fx.settle?.();
  fx.dispatch({ type: "minimise", kind: ENCOUNTERS_KIND });
  fx.dispatch({ type: "open", kind: INITIATIVE_KIND, by: "feature" }); // FR-SHELL-41
  await fx.settle?.(); // FR-CBT-150: the map's refit sees Initiative's grown height
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
