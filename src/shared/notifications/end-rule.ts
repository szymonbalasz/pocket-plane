// Encounter-scoped kinds (FR-NOTE-23, ADR-0034): a kind may declare an end rule; its pending
// rows of an encounter are dismissed when that encounter ends. The rule is a shared constant
// exported by the kind owner from `@shared/<feature>` and referenced by the server kind
// definition and the kind's client views, so clients can count what End will close.

export interface EncounterEndRule {
  onEncounterEnd: "dismiss";
  /** The encounter a row belongs to, from its stored payload; null = none (never dismissed). */
  encounterIdOf(payload: unknown): string | null;
}

/** True if a pending row with this payload closes when `encounterId` ends. */
export function endsWithEncounter(
  rule: EncounterEndRule | undefined,
  payload: unknown,
  encounterId: string,
): boolean {
  return rule?.onEncounterEnd === "dismiss" && rule.encounterIdOf(payload) === encounterId;
}

/** Load check (FR-NOTE-23): a rule that dismisses must say where its encounter id is. */
export function checkEndRule(kind: string, rule: EncounterEndRule | undefined): void {
  if (rule === undefined) return;
  if (rule.onEncounterEnd !== "dismiss") {
    throw new Error(`Notification kind "${kind}": unknown onEncounterEnd "${rule.onEncounterEnd}"`);
  }
  if (typeof rule.encounterIdOf !== "function") {
    throw new Error(`Notification kind "${kind}": an end rule needs encounterIdOf`);
  }
}
