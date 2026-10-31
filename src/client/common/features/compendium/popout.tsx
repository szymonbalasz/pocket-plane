// FR-CMP-76: entries popped out of the Compendium, one `cmp.entry` window each. What each instance
// shows lives here, in client memory, as the window itself does (FR-SHELL-201: never stored, so a
// reload closes them). The same entry popped out again is the same window.
import { createStore, useStore } from "zustand";
import type { WindowProps } from "../play-shell/registry";
import type { CmpView } from "./nav";

export type PopoutTarget = Exclude<CmpView, { mode: "list" }>;

interface Popout {
  target: PopoutTarget;
  /** The entry's name once it has loaded: the window's title. */
  name?: string;
}

const popouts = createStore<Readonly<Record<string, Popout>>>(() => ({}));
let next = 0;

const same = (a: PopoutTarget, b: PopoutTarget) =>
  a.mode === "entry"
    ? b.mode === "entry" && a.entryId === b.entryId
    : b.mode === "definition" && a.definitionId === b.definitionId;

/** The window instance showing `target`: the one it already has, else a new one. */
export function popoutInstance(target: PopoutTarget): string {
  const all = popouts.getState();
  const found = Object.keys(all).find((k) => {
    const p = all[k];
    return p !== undefined && same(p.target, target);
  });
  if (found !== undefined) return found;
  next += 1;
  const instance = `entry-${next}`;
  popouts.setState({ ...all, [instance]: { target } });
  return instance;
}

export function setPopoutName(instance: string, name: string) {
  const p = popouts.getState()[instance];
  if (p && p.name !== name) popouts.setState({ [instance]: { ...p, name } });
}

export const usePopoutTarget = (instance: string) => useStore(popouts, (s) => s[instance]?.target);

export const POPOUT_TITLE = "Compendium entry";

const titleIn = (all: Readonly<Record<string, Popout>>, instance: string) =>
  all[instance]?.name ?? POPOUT_TITLE;

/** What the title bar says now: the entry's name, once loaded. */
export const popoutTitle = (instance: string) => titleIn(popouts.getState(), instance);

export function PopoutTitle({ instance }: WindowProps) {
  return <>{useStore(popouts, (s) => titleIn(s, instance))}</>;
}

/** Tests: forget every pop-out. */
export const resetPopouts = () => popouts.setState({}, true);
