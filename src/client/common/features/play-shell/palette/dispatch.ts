// The one shortcut dispatcher (FR-SHELL-190, ADR-0067 §2): what a `keydown` does. It acts on a
// registry key only when (i) no `blocksInput` overlay is up, (ii) the target is not a typing
// target and not inside a dialog, menu or listbox (the palette chord excepted: it works from text
// fields), (iii) not a repeat, not composing, (iv) the key matches exactly (`keys.ts`); single
// keys only while they are on (FR-SHELL-193). Pure: the overlay feeds it the event and the page.
import { isTypingTarget } from "../keys";
import { isSingleKey, type KeyLike, matchesKey } from "./keys";
import type { PaletteCommand, When } from "./types";

/** `data-test-last-shortcut`'s outcome (FR-SHELL-197). */
export type Outcome = "ran" | "typing" | "paused" | "off" | "disabled";

export interface KeyEventLike extends KeyLike {
  repeat: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

export interface DispatchEnv {
  /** This client's commands, feature switches applied. */
  commands: readonly PaletteCommand[];
  /** `Mod` = ⌘. */
  mac: boolean;
  /** A `blocksInput` overlay is up (FR-SHELL-128). */
  blocked: boolean;
  /** A modal dialog / alert dialog other than the palette's own is open (FR-SHELL-180). */
  modalOpen: boolean;
  singleKey: boolean;
  when(c: PaletteCommand): When;
}

export interface Decision {
  command: PaletteCommand;
  outcome: Outcome;
}

/** Dialogs, menus and listboxes: their keys are theirs (FR-SHELL-190 (ii)). */
const WIDGET_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

interface ClosestLike {
  closest?: (selector: string) => unknown;
}

function insideWidget(target: EventTarget | null): boolean {
  const t = target as ClosestLike | null;
  return typeof t?.closest === "function" && t.closest(WIDGET_SELECTOR) !== null;
}

/** The command `e` presses, or null (no registry key: not ours, nothing recorded). */
export function commandFor(
  e: KeyLike,
  commands: readonly PaletteCommand[],
  mac: boolean,
): PaletteCommand | null {
  return commands.find((c) => c.keys?.some((k) => matchesKey(k, e, mac))) ?? null;
}

/**
 * What the dispatcher does with `e`: null = not a shortcut (or a repeat / IME key: ignored);
 * else the command and its outcome. Only `ran` acts (`preventDefault` + run).
 */
export function decide(e: KeyEventLike, env: DispatchEnv): Decision | null {
  if (e.repeat || e.isComposing) return null;
  const command = commandFor(e, env.commands, env.mac);
  if (!command) return null;
  const decision = (outcome: Outcome): Decision => ({ command, outcome });
  if (env.blocked) return decision("paused");
  const single = command.keys?.some((k) => isSingleKey(k) && matchesKey(k, e, env.mac)) ?? false;
  if (single) {
    if (isTypingTarget(e.target) || insideWidget(e.target)) return decision("typing");
    if (!env.singleKey) return decision("off");
  } else if (env.modalOpen) {
    return decision("disabled");
  }
  return decision(env.when(command) === true ? "ran" : "disabled");
}

/**
 * A modal dialog or alert dialog is open that isn't the palette's (`[data-palette]`): Radix
 * modal content blocks outside pointer events on `body`; popovers (role dialog, not modal) don't.
 */
export function modalDialogOpen(doc: Pick<Document, "querySelector" | "body">): boolean {
  if (doc.querySelector('[role="alertdialog"]')) return true;
  if (doc.body?.style.pointerEvents !== "none") return false;
  return doc.querySelector('[role="dialog"][data-state="open"]:not([data-palette])') !== null;
}
