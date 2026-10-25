// FR-CBTX-25 skip cue: dead PCs join FR-CBT-50's "Skipped …" Toast as "(dead)". One copy for the
// Initiative window's step and the palette's N / Shift+N (BL-94). Sprint 11 (BL-110): a down
// `in-owner-turn` companion (no rank) is named when its owner's turn starts. Sprint 12 (BL-122):
// one skip toast at a time; every acked step replaces it (or clears it when nobody was skipped).
import { inTurnCompanionsOf, skippedOnStep, skippedText } from "@shared/combat-tracker/rules";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { createElement } from "react";
import { toast } from "sonner";
import { deadPc } from "./logic";

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

/**
 * FR-CBT-50 / FR-CBTX-25: the skip cue of a Next / Prev from the encounter's active rows at send
 * time (a dead PC skips like a monster at 0), and the dead names for `skipText`. Rows without a
 * rank never take a turn of their own (FR-CBT-107); BL-110: the target's down in-turn companions
 * are named too.
 */
export function stepSkip(
  store: RecordStore,
  rows: readonly CombatantView[],
  enc: { round: number; turnCombatantId?: string | null },
  direction: "next" | "prev",
): { skipped: ReturnType<typeof skippedOnStep>; dead: Set<string> } {
  const dead = new Set(rows.filter((c) => deadPc(store, c)).map((c) => c.name));
  const view = rows.map((c) => ({
    id: c.id,
    name: c.name,
    seq: c.seq ?? 0,
    kind: c.kind,
    entityId: c.entityId,
    active: c.active !== false,
    position: c.position ?? null,
    turnMode: c.turnMode ?? null,
    ownerCharacterId: c.ownerCharacterId ?? null,
    removed: c.removed === true,
    hpCurrent: c.hpCurrent ?? null,
    initiative: c.initiative ?? null,
  }));
  const turnRows = view.map((r) =>
    dead.has(r.name) ? { ...r, kind: "monster" as const, hpCurrent: 0 } : r,
  );
  const skipped = skippedOnStep(turnRows, enc.round, enc.turnCombatantId ?? null, direction, (id) =>
    inTurnCompanionsOf(view, id),
  );
  return { skipped, dead };
}

let skipToastId: string | null = null;
let skipToastSeq = 0;

/**
 * FR-CBT-50, BL-122: after an acked Next / Prev (Initiative window, palette N / Shift+N), the
 * step's skip toast replaces the one showing; a step that skipped nobody only clears it, so a Prev
 * right after a skipping Next never shows the Next's names. A fresh id per toast: the replacement
 * gets its own full time in the stack.
 */
export function showStepSkip(step: ReturnType<typeof stepSkip>): void {
  if (skipToastId !== null) toast.dismiss(skipToastId);
  skipToastId = null;
  if (!step.skipped) return;
  skipToastSeq += 1;
  skipToastId = `cbt-init-skipped-${skipToastSeq}`;
  toast(
    createElement("span", { "data-testid": "cbt-init-skipped" }, skipText(step.skipped, step.dead)),
    { id: skipToastId },
  );
}
