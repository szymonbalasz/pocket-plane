// "Clean text" for reminders and strongholds (REM §6, HOLD §6): trimmed, control characters
// removed; multi-line fields keep `\n` (`\r\n` → `\n`). Bounds count characters after cleaning.
import { cleanText } from "@shared/notifications/schemas";
import { z } from "zod";

// biome-ignore lint/suspicious/noControlCharactersInRegex: REM / HOLD clean text keeps only \n.
const LINE_CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** Multi-line clean text: `\r\n` → `\n`, every control character but `\n` removed, trimmed. */
export function cleanLines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(LINE_CONTROL_CHARS, "").trim();
}

const bounded = (clean: (s: string) => string, min: number, max: number, label: string) =>
  z
    .string()
    .max(4 * max)
    .transform(clean)
    .pipe(
      z.string().min(min, `${label}: required`).max(max, `${label}: at most ${max} characters`),
    );

/** One-line clean text, `min`–`max` characters. */
export const cleanLine = (min: number, max: number, label: string) =>
  bounded(cleanText, min, max, label);

/** Multi-line clean text (keeps `\n`), `min`–`max` characters. */
export const cleanMultiline = (min: number, max: number, label: string) =>
  bounded(cleanLines, min, max, label);
