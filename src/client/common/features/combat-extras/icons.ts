// Effect icons (FR-CBTX-29): one lucide icon per condition key, one for custom effects, one for
// concentration. The name goes on the token overlay (`TokenIcon.icon`); the component on chips.
import type { Condition } from "@shared/combat-extras/conditions";
import type { EffectKind } from "@shared/combat-extras/schemas";
import {
  ArrowDownToLineIcon,
  BanIcon,
  BatteryLowIcon,
  BrainIcon,
  EarOffIcon,
  EyeOffIcon,
  FlaskConicalIcon,
  FrownIcon,
  GhostIcon,
  HandIcon,
  HeartIcon,
  LinkIcon,
  type LucideIcon,
  MoonIcon,
  MountainIcon,
  SparklesIcon,
  TagIcon,
  ZapIcon,
} from "lucide-react";

const CONDITION_ICONS: Record<Condition, [string, LucideIcon]> = {
  blinded: ["eye-off", EyeOffIcon],
  charmed: ["heart", HeartIcon],
  deafened: ["ear-off", EarOffIcon],
  frightened: ["frown", FrownIcon],
  grappled: ["hand", HandIcon],
  incapacitated: ["ban", BanIcon],
  invisible: ["ghost", GhostIcon],
  paralysed: ["zap", ZapIcon],
  petrified: ["mountain", MountainIcon],
  poisoned: ["flask-conical", FlaskConicalIcon],
  prone: ["arrow-down-to-line", ArrowDownToLineIcon],
  restrained: ["link", LinkIcon],
  stunned: ["sparkles", SparklesIcon],
  unconscious: ["moon", MoonIcon],
  exhaustion: ["battery-low", BatteryLowIcon],
};

const CUSTOM: [string, LucideIcon] = ["tag", TagIcon];
const CONCENTRATION: [string, LucideIcon] = ["brain", BrainIcon];

function pick(e: { kind: EffectKind; condition: Condition | null }): [string, LucideIcon] {
  if (e.kind === "concentration") return CONCENTRATION;
  if (e.kind === "condition" && e.condition) return CONDITION_ICONS[e.condition];
  return CUSTOM;
}

export const effectIconName = (e: { kind: EffectKind; condition: Condition | null }) => pick(e)[0];
export const EffectIcon = (e: { kind: EffectKind; condition: Condition | null }) => pick(e)[1];
export const conditionIcon = (c: Condition) => CONDITION_ICONS[c][1];

/** `data-value` of a chip / token icon: the condition key, `custom` or `concentration`. */
export const effectValue = (e: { kind: EffectKind; condition: Condition | null }) =>
  e.kind === "condition" && e.condition ? e.condition : e.kind;
