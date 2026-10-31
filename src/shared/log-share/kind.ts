// Log-entry kind `share.entry` (FR-SHARE-05): "Mira shares Fireball", then the full text. Public
// like any line; no DM-only part. The row keeps the head and shows the text below it; the copied
// line (FR-KIT-46) carries both.
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { LOG_KIND_SHARE, SharePayload } from "./schemas";

/** FR-SHARE-08: what a folded share says instead of its text. */
export const FOLDED_TEXT = "An older share: its text is no longer kept.";

export const shareLogKind = defineLogKind<SharePayload>({
  kind: LOG_KIND_SHARE,
  payload: SharePayload,
  formatLine: ({ actorName, payload: p }) => {
    const out: LineSegment[] = [
      { text: actorName, style: "actor" },
      { text: ` shares ${p.title}` },
    ];
    if (p.line) out.push({ text: ` (${p.line})`, style: "muted" });
    if (p.folded) out.push({ text: `\n${FOLDED_TEXT}`, style: "muted" });
    else if (p.text) out.push({ text: `\n${p.text}` });
    return out;
  },
});
