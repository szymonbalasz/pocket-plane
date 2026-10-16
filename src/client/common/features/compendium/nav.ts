// Compendium window navigation (FR-CMP-18, -22, -23): query, tab, filters and the open view.
// One window per client, so one store per client bundle. `listNonce` / `entryNonce` bump to
// refetch (open, Back, the DM's own writes): results are read on demand, never pushed.
import { createStore, useStore } from "zustand";
import type { CmpTab, Filters } from "./logic";

export type CmpView =
  | { mode: "list" }
  | { mode: "entry"; entryId: string }
  /** An imported definition (token menu Stat block, entryless results): resolved to its entry. */
  | { mode: "definition"; definitionId: string };

export interface CmpNav {
  q: string;
  tab: CmpTab;
  filters: Filters;
  view: CmpView;
  listNonce: number;
  entryNonce: number;
}

const initial = (): CmpNav => ({
  q: "",
  tab: "all",
  filters: {},
  view: { mode: "list" },
  listNonce: 0,
  entryNonce: 0,
});

export const cmpNav = createStore<CmpNav>(initial);

export const useCmpNav = <T>(select: (s: CmpNav) => T): T => useStore(cmpNav, select);

export const setQuery = (q: string) => cmpNav.setState({ q });
/** Filters are per kind: a new tab starts without any. */
export const setTab = (tab: CmpTab) =>
  cmpNav.setState((s) => (s.tab === tab ? s : { tab, filters: {} }));
export const setFilters = (filters: Filters) => cmpNav.setState({ filters });
export const openEntry = (entryId: string) =>
  cmpNav.setState((s) => ({ view: { mode: "entry", entryId }, entryNonce: s.entryNonce + 1 }));
export const openDefinition = (definitionId: string) =>
  cmpNav.setState((s) => ({
    view: { mode: "definition", definitionId },
    entryNonce: s.entryNonce + 1,
  }));
/** Back: the list again, refetched (FR-CMP-23); its scroll is kept (the list stays mounted). */
export const backToList = () =>
  cmpNav.setState((s) => ({ view: { mode: "list" }, listNonce: s.listNonce + 1 }));
/** Refetch whatever is shown (window open, the DM's own writes). */
export const refetch = () =>
  cmpNav.setState((s) => ({ listNonce: s.listNonce + 1, entryNonce: s.entryNonce + 1 }));
export const resetCmpNav = () => cmpNav.setState(initial());
