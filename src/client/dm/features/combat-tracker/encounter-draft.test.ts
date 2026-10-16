// F1 (C3 walkthrough): with the Encounters editor open, a full SRD import (≈ 1,000 upsert frames,
// many `imported-entity`) threw React #185. The editor re-derived its server draft from a fresh
// record array on every render and its "adopt server state" effect replaced the draft each time:
// a render loop, which the import's forced sync renders turned into #185. The loop is modelled
// with React's rules (setState with the same object is a no-op; a new one re-renders and the
// effect runs again because `server` changed).
import { describe, expect, test } from "bun:test";
import type { EncounterEntryRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { adoptServerDraft, type Draft, draftOf, sameDraft } from "./encounter-draft";

const encounter = {
  id: "enc-1",
  name: "Ambush at the Ford",
  partyCharacterIds: null,
  createTokens: true,
  addHidden: false,
} as unknown as EncounterRecord;
const entry = (seq: number, definitionId: string, quantity: number) =>
  ({
    id: `e${seq}`,
    encounterId: "enc-1",
    seq,
    definitionId,
    quantity,
    hpMode: "average",
  }) as unknown as EncounterEntryRecord;

type Records = Record<string, Record<string, unknown>>;

/**
 * One mounted editor: each render builds `server` from `Object.values` of the store's entries (a
 * fresh array per render, as `useRecords`), then its effect runs if `server` changed. Returns
 * the renders the frames caused (stops at `cap`: a loop).
 */
function runEditor(
  frames: readonly Records[],
  adopt: (current: Draft, server: Draft) => Draft,
  cap = 10_000,
): number {
  let store = frames[0] as Records;
  let state: Draft | null = null;
  let lastServer: Draft | null = null;
  let renders = 0;
  const render = () => {
    renders++;
    const entries = Object.values(store["encounter-entry"] ?? {}) as EncounterEntryRecord[];
    const server = draftOf(encounter, entries); // new object every render
    state ??= server;
    // useEffect(..., [server]): runs whenever `server` is a new object.
    if (server !== lastServer) {
      lastServer = server;
      const next = adopt(state, server);
      if (next !== state) {
        state = next;
        return true; // setState → another render
      }
    }
    return false;
  };
  for (const f of frames) {
    store = f;
    while (render() && renders < cap) {
      // re-render while state keeps changing
    }
    if (renders >= cap) return renders;
  }
  return renders;
}

/** A store version per frame: entries unchanged, `imported-entity` grows (an import). */
function importFrames(n: number): Records[] {
  const entries = { e1: entry(1, "gob", 2), e2: entry(2, "ogre", 1) };
  const out: Records[] = [];
  let imported: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    imported = { ...imported, [`def-${i}`]: { id: `def-${i}` } };
    out.push({ "encounter-entry": entries, "imported-entity": imported });
  }
  return out;
}

describe("F1 Encounters editor draft adoption", () => {
  test("F1 same content keeps the draft object; a server change replaces it; local edits differ", () => {
    const a = draftOf(encounter, [entry(2, "ogre", 1), entry(1, "gob", 2)]);
    const b = draftOf(encounter, [entry(1, "gob", 2), entry(2, "ogre", 1)]);
    expect(a).not.toBe(b);
    expect(sameDraft(a, b)).toBe(true);
    expect(adoptServerDraft(a, b)).toBe(a);
    const c = draftOf(encounter, [entry(1, "gob", 3), entry(2, "ogre", 1)]);
    expect(adoptServerDraft(a, c)).toBe(c);
    expect(sameDraft(a, { ...a, partyCharacterIds: ["mira"] })).toBe(false);
    expect(
      sameDraft({ ...a, partyCharacterIds: ["mira"] }, { ...a, partyCharacterIds: ["mira"] }),
    ).toBe(true);
    expect(sameDraft(a, { ...a, name: "Other" })).toBe(false);
  });

  test("F1 300 imported-entity upsert frames with the editor mounted → one render per frame, no loop", () => {
    const frames = importFrames(300);
    expect(runEditor(frames, adoptServerDraft)).toBe(300);
    // The replaced-every-time effect it fixes never settles (the #185 loop).
    expect(runEditor(frames, (_d, server) => server, 5_000)).toBe(5_000);
  });
});
