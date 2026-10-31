// FR-SHARE-04, -06: what a share says, as markdown-lite (FR-CMP-26). Pure: the server builds the
// payload with these, so a client can only post text the sender may read.
import { withDamageBonus } from "@shared/character-sheet/logic";
import type { BodyOf, CompendiumKind } from "@shared/compendium/schemas";
import type { Attack } from "@shared/entities/schemas";
import { SHARE_LINE_MAX, SHARE_TEXT_MAX, SHARE_TITLE_MAX, type SharePayload } from "./schemas";

const fact = (label: string, value: string | undefined) =>
  value?.trim() ? `**${label}:** ${value.trim()}` : null;

const paragraphs = (parts: readonly (string | null | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p?.trim())).join("\n\n");

/** FR-SHARE-04: an entry's text, its facts first, as the compendium shows them. Monsters: never. */
export function entryShareText(e: { kind: CompendiumKind; body: unknown }): string {
  switch (e.kind) {
    case "spell": {
      const b = e.body as BodyOf<"spell">;
      const components = b.material ? `${b.components} (${b.material})` : b.components;
      const facts = [
        fact("Casting Time", b.castingTime),
        fact("Range", b.range),
        fact("Components", components),
        fact("Duration", b.duration),
      ].filter((f) => f !== null);
      return paragraphs([
        facts.join("\n"),
        b.text,
        b.higherLevel ? `**At Higher Levels.** ${b.higherLevel}` : null,
      ]);
    }
    case "item": {
      const b = e.body as BodyOf<"item">;
      const facts = [
        fact("Cost", b.cost),
        fact("Weight", b.weight),
        fact("Damage", b.damage),
        fact("Properties", b.properties),
        fact("Armor Class", b.ac),
      ].filter((f) => f !== null);
      return paragraphs([facts.join("\n"), b.text]);
    }
    case "condition":
    case "feature":
    case "rule":
      return (e.body as { text: string }).text.trim();
    case "monster":
      throw new Error("Monsters are not shared");
  }
}

/** FR-SHARE-04: a row's own notes after the looked-up text. */
export const withNotes = (text: string, notes: string): string =>
  paragraphs([text, notes.trim() ? `**Notes.** ${notes.trim()}` : null]);

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

/** FR-SHARE-04: "+8 · 2d6+5 slashing + 2d6 fire", the sheet's attack line. */
export function attackShareLine(a: Attack): string {
  const bonus = a.bonus ?? 0;
  const base = withDamageBonus(a.damage, bonus);
  return [
    `${signed(a.toHit + bonus)} · ${a.damageType ? `${base} ${a.damageType}` : base}`,
    ...(a.extraDamage ?? []).map((x) => `+ ${x.damage} ${x.type}`),
  ].join(" ");
}

const clipTo = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

/** FR-SHARE-06: the payload within its limits; a cut text ends in "…" and sets `cut`. */
export function sharePayload(p: { title: string; line: string; text: string }): SharePayload {
  const text = p.text.trim();
  const fits = text.length <= SHARE_TEXT_MAX;
  return {
    title: clipTo(p.title.trim(), SHARE_TITLE_MAX),
    line: clipTo(p.line.trim(), SHARE_LINE_MAX),
    text: clipTo(text, SHARE_TEXT_MAX),
    ...(fits ? {} : { cut: true as const }),
  };
}
