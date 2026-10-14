// Entry → line (FR-DICE-18, FR-DICE-20, FR-DICE-21). Unknown kinds or payloads render as
// "Unsupported entry"; undone entries get an "undone" badge (clients also strike the line).
import type { RollCategory } from "@shared/events/dice-roll-log";
import type { LineSegment } from "./kind-types";
import { getLogKind } from "./kinds";

export const UNSUPPORTED_ENTRY = "Unsupported entry";

export interface EntryLike {
  kind: string;
  actorName: string;
  payload: unknown;
  dmPayload?: unknown;
  undone?: boolean;
  category?: RollCategory;
}

export function formatEntry(entry: EntryLike): { segments: LineSegment[]; supported: boolean } {
  const def = getLogKind(entry.kind);
  const payload = def?.payload.safeParse(entry.payload);
  if (!def || !payload?.success) {
    return { segments: [{ text: UNSUPPORTED_ENTRY, style: "muted" }], supported: false };
  }
  let dmPayload: unknown = null;
  if (def.dmPayload && entry.dmPayload !== undefined && entry.dmPayload !== null) {
    const d = def.dmPayload.safeParse(entry.dmPayload);
    if (d.success) dmPayload = d.data;
  }
  let segments: LineSegment[];
  try {
    segments = def.formatLine({
      actorName: entry.actorName,
      payload: payload.data,
      dmPayload,
      category: entry.category,
    });
  } catch {
    return { segments: [{ text: UNSUPPORTED_ENTRY, style: "muted" }], supported: false };
  }
  if (entry.undone) segments = [...segments, { text: " " }, { text: "undone", style: "badge" }];
  return { segments, supported: true };
}
