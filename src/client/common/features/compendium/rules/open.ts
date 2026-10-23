// FR-CMP-69 client API `openRules(entryId?)`: opens `cmp.rules` as a user open (`by: "user"`,
// seams S3 / S14: window memory and MRU apply; an open one is fronted, not moved) and, given an
// entry id, shows that card: on its page, expanded and scrolled into view, or alone in the search
// view when no page lists it. Callers: Open in Rules (`cmp-rule-open`), the palette's rule rows
// (FR-SHELL-188) and its Rules command.
import { useCallback } from "react";
import type { OpenBy } from "../../play-shell/manager";
import { useOpenWindow } from "../../play-shell/ShellContext";
import { RULES_KIND } from "./logic";
import { targetCard } from "./nav";

export type OpenWindowFn = (kind: string, instance?: string, opts?: { by?: OpenBy }) => void;

export function openRules(open: OpenWindowFn, entryId?: string) {
  if (entryId !== undefined) targetCard(entryId);
  open(RULES_KIND, undefined, { by: "user" });
}

/** `openRules` bound to this client's window manager. */
export function useOpenRules(): (entryId?: string) => void {
  const open = useOpenWindow();
  return useCallback((entryId?: string) => openRules(open, entryId), [open]);
}
