// Conditions (FR-CBTX-03): the 5e 2014 list, keys + one-line reminders in our own words (no rules
// text). Reminders only: no mechanics are automated except FR-CBTX-11 (incapacitating conditions
// end concentration).
import { z } from "zod";

export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralysed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
  "exhaustion",
] as const;
export const Condition = z.enum(CONDITIONS);
export type Condition = z.infer<typeof Condition>;

/** Exhaustion carries a level 1–6; every other condition none (FR-CBTX-04). */
export const EXHAUSTION_LEVEL_MIN = 1;
export const EXHAUSTION_LEVEL_MAX = 6;
export const ExhaustionLevel = z.int().min(EXHAUSTION_LEVEL_MIN).max(EXHAUSTION_LEVEL_MAX);

export const CONDITION_INFO: Readonly<Record<Condition, { name: string; reminder: string }>> = {
  blinded: {
    name: "Blinded",
    reminder: "Can't see; attacks against it are easier, its own harder.",
  },
  charmed: {
    name: "Charmed",
    reminder: "Won't harm the charmer; the charmer has the upper hand socially.",
  },
  deafened: { name: "Deafened", reminder: "Can't hear; fails anything that needs hearing." },
  frightened: {
    name: "Frightened",
    reminder: "Worse at rolls while the source is in sight; can't move closer to it.",
  },
  grappled: {
    name: "Grappled",
    reminder: "Speed is 0 until it breaks free or the grappler lets go.",
  },
  incapacitated: { name: "Incapacitated", reminder: "No actions or reactions." },
  invisible: {
    name: "Invisible",
    reminder: "Unseen without help; its attacks are easier, attacks against it harder.",
  },
  paralysed: { name: "Paralysed", reminder: "Can't move or act; close hits are critical." },
  petrified: {
    name: "Petrified",
    reminder: "Turned to stone: can't move or act, resists most damage.",
  },
  poisoned: { name: "Poisoned", reminder: "Worse at attacks and ability checks." },
  prone: {
    name: "Prone",
    reminder: "Crawls or stands up; close attacks against it are easier, ranged harder.",
  },
  restrained: {
    name: "Restrained",
    reminder: "Speed 0; worse at attacks and Dex saves, easier to hit.",
  },
  stunned: { name: "Stunned", reminder: "Can't move or act; fails Str and Dex saves." },
  unconscious: {
    name: "Unconscious",
    reminder: "Out cold: drops what it holds, falls prone, close hits are critical.",
  },
  exhaustion: {
    name: "Exhaustion",
    reminder: "Cumulative levels 1–6; each level adds a penalty, 6 is death.",
  },
};

/** FR-CBTX-11: adding one of these to a concentrating target ends its concentration. */
export const INCAPACITATING_CONDITIONS: readonly Condition[] = [
  "incapacitated",
  "paralysed",
  "petrified",
  "stunned",
  "unconscious",
];
