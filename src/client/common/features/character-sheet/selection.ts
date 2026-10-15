// Which creature the `char.sheet` window shows (CHARX §8): the picker's selection, the NPC sheet
// the DM last opened (FR-CHARX-31) and a pending "open in edit mode" (a just-created character,
// FR-CHARX-30). One store per page. The selection is remembered per browser (FR-CHARX-47):
// `localStorage` `pp.sheet.v1.<campaignId>.<dm | playerId>`, never sent to the server.
import { z } from "zod";
import { createStore } from "zustand";

export interface SheetSelection {
  selectedId: string | null;
  /** DM: the definition last opened via Creatures → Sheet (picker keeps it). */
  npcId: string | null;
  /** Open this creature in edit mode once it is in the store (with the creation hint). */
  editId: string | null;
}

export const sheetSelection = createStore<SheetSelection>(() => ({
  selectedId: null,
  npcId: null,
  editId: null,
}));

// ---------- picker memory (FR-CHARX-47) ----------

export const sheetMemoryKey = (
  campaignId: string,
  role: "dm" | "player",
  playerId: string | null,
) => `pp.sheet.v1.${campaignId}.${role === "dm" ? "dm" : (playerId ?? "unknown")}`;

export const SheetMemory = z.strictObject({ selectedId: z.string().min(1).max(64) });

export type SheetMemoryBackend = Pick<Storage, "getItem" | "setItem">;

/** A stored id still shown by the picker: as one of its options, or (DM) as the last NPC. */
export type Eligibility = (id: string) => "option" | "npc" | null;

/**
 * Per-page memory binding. `getBackend` may throw; any storage failure → memory only for this
 * page, one console warning, no error UI (FR-SHELL-17's rule). Invalid entry → default + warning;
 * the next change overwrites it.
 */
export function createSheetMemory(
  getBackend: () => SheetMemoryBackend = () => window.localStorage,
  // No error → message only (no trailing "undefined" in the console).
  warn: (msg: string, err?: unknown) => void = (m, e) =>
    e === undefined ? console.warn(m) : console.warn(m, e),
) {
  const memory = new Map<string, string>();
  let failed = false;
  let boundKey: string | null = null;
  /** Chosen by an action before the key was known (sheet window not yet mounted). */
  let pending = false;
  const fail = (what: string, err: unknown) => {
    if (!failed) warn(`character-sheet: picker memory ${what} failed; keeping it in memory`, err);
    failed = true;
  };
  const read = (key: string): string | null => {
    let raw: string | null = memory.get(key) ?? null;
    if (!failed) {
      try {
        raw = getBackend().getItem(key);
      } catch (err) {
        fail("read", err);
      }
    }
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const m = SheetMemory.safeParse(parsed);
    if (!m.success) {
      warn(`character-sheet: invalid picker memory "${key}"; using the default`);
      return null;
    }
    return m.data.selectedId;
  };
  const write = (key: string, id: string) => {
    const text = JSON.stringify({ selectedId: id } satisfies z.infer<typeof SheetMemory>);
    memory.set(key, text);
    if (failed) return;
    try {
      getBackend().setItem(key, text);
    } catch (err) {
      fail("write", err);
    }
  };
  return {
    /** A picker change, `openSheetFor` or create: stored now, or once the key is bound. */
    touched(id: string | null) {
      if (!boundKey) pending = true;
      else if (id) write(boundKey, id);
    },
    /**
     * After the first snapshot of the page (and on a campaign switch): restore the stored choice
     * if still eligible; a choice made before the key was known wins and is stored instead.
     * Returns the patch to apply.
     */
    bind(key: string, current: string | null, eligible: Eligibility): Partial<SheetSelection> {
      if (key === boundKey) return {};
      boundKey = key;
      if (pending) {
        pending = false;
        if (current) write(key, current);
        return {};
      }
      const id = read(key);
      const how = id ? eligible(id) : null;
      if (!id || !how) return {};
      return how === "npc" ? { selectedId: id, npcId: id } : { selectedId: id };
    },
  };
}

let memory = createSheetMemory();

/** Tests: a fresh memory over `backend`. */
export function resetSheetMemory(m: ReturnType<typeof createSheetMemory> = createSheetMemory()) {
  memory = m;
  sheetSelection.setState({ selectedId: null, npcId: null, editId: null });
}

/** CharacterSheet calls this once `you` and the first snapshot are in (FR-CHARX-47). */
export function bindSheetMemory(key: string, eligible: Eligibility) {
  const patch = memory.bind(key, sheetSelection.getState().selectedId, eligible);
  if (Object.keys(patch).length) sheetSelection.setState(patch);
}

function choose(patch: Partial<SheetSelection> & { selectedId: string }) {
  sheetSelection.setState(patch);
  memory.touched(patch.selectedId);
}

export const selectSheet = (id: string) => choose({ selectedId: id });

/** Creatures → Sheet (DM), G8 Review: show that definition / character. */
export function openSheetFor(id: string, kind: "character" | "monster") {
  choose(kind === "monster" ? { selectedId: id, npcId: id } : { selectedId: id });
}

export const requestEdit = (id: string) => choose({ selectedId: id, editId: id });
export const clearEditRequest = () => sheetSelection.setState({ editId: null });
