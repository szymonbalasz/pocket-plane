// Log-entry kind registry (FR-DICE-18, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line in the list for each of its kinds; nothing else changes here.
import type { AnyLogKind } from "./kind-types";
import { rollKind } from "./roll-kind";

const kinds: AnyLogKind[] = [
  rollKind, // roll (dice-roll-log, FR-DICE-20)
];

const byKind = new Map<string, AnyLogKind>();
for (const k of kinds) {
  if (byKind.has(k.kind)) throw new Error(`Log-entry kind "${k.kind}" registered twice`);
  byKind.set(k.kind, k);
}

/** The registered kind, or undefined (server: `internal`; client: "Unsupported entry"). */
export function getLogKind(kind: string): AnyLogKind | undefined {
  return byKind.get(kind);
}

export const logKindNames = (): string[] => [...byKind.keys()];
