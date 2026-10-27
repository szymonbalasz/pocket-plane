// DICE sprint 7 (GM1) client: the superseded line (FR-DICE-65), entry actions (FR-DICE-68) and
// "throw once" (FR-DICE-66). Static render of `GameLog` over a fake sync store; the throw source
// over a real `applyEvent`.
import { afterEach, describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { applyEvent, emptyStore, type RecordStore } from "@shared/protocol/store";
import { StarIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { landing } from "../dice-extras/landing";
import { newRollEntries } from "../dice-extras/throw-source";
import { actionsFor, type EntryAction } from "./entry-actions";
import { focusLogEntry, logFocus } from "./focus";
import { GameLog } from "./GameLog";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+3",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 4, kept: true }],
  constant: 3,
  total: 7,
  natural: 4,
  label: "Perception",
  ...p,
});

const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-21T10:00:00.000Z",
  kind: "roll",
  category: "skill-check",
  public: true,
  undone: false,
  rollerRole: "player",
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload: [item()],
  rollIds: ["r1"],
  encounterId: null,
  supersededBy: null,
  ...o,
});

const OLD = entry({ supersededBy: "e2" });
const NEW = entry({
  id: "e2",
  n: 2,
  payload: [
    item({
      rollId: "r2",
      dice: [{ faces: 20, value: 17, kept: true }],
      total: 20,
      natural: 17,
      replaces: { entryId: "e1", total: 7 },
    }),
  ],
  rollIds: ["r2"],
});

const byId = <T extends { id: string }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

function store(entries: GameLogEntryView[], features: string[] = [GEMS_FEATURE]): RecordStore {
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role: "player", playerId: "p1" },
    records: {
      campaign: byId([{ id: "c1", name: "C", features }]),
      [GAME_LOG_ENTRY_TYPE]: byId(entries),
      player: byId([{ id: "p1", name: "Player 1" }]),
    },
  } as unknown as RecordStore;
}

function render(
  entries: GameLogEntryView[],
  actions: readonly EntryAction[] = [],
  s?: RecordStore,
) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: s ?? store(entries),
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <GameLog actions={actions} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const rows = (html: string) => html.split('data-testid="dice-log-entry"').slice(1);

afterEach(() => {
  logFocus.clear(logFocus.api.getState().seq);
  landing.api.setState({ holding: new Map() });
});

describe("FR-DICE-65 superseded line", () => {
  test('FR-DICE-65 superseded line: struck + dimmed, data-superseded, a "rerolled" Badge naming the new line; the new line reads "(reroll, was 7)"', () => {
    const [old, next] = rows(render([OLD, NEW]));
    expect(old).toContain('data-superseded="true"');
    expect(old).toMatch(/class="[^"]*line-through[^"]*opacity-60/);
    expect(old).toMatch(/data-testid="dice-log-rerolled" data-record-id="e2"/);
    expect(old).toContain(">rerolled<");
    expect(next).toContain('data-superseded="false"');
    expect(next).not.toContain("dice-log-rerolled");
    expect(next).not.toContain("line-through");
    expect(next).toContain("(reroll, was 7)");
  });

  test('FR-DICE-65 superseded line: undone and superseded → "undone" only; the badge jumps to the new line', () => {
    const html = render([{ ...OLD, undone: true }, NEW]);
    const [old] = rows(html);
    expect(old).not.toContain("dice-log-rerolled");
    expect(old).toContain(">undone<");
    focusLogEntry("e2");
    expect(logFocus.api.getState().entryId).toBe("e2");
  });
});

describe("FR-DICE-68 entry actions", () => {
  const test1: EntryAction = {
    id: "test.star",
    order: 1,
    available: (_s, e) => e.id === "e2",
    Icon: StarIcon,
    label: "Star it",
    run: () => Promise.resolve(),
  };

  test("FR-DICE-68 entry actions: empty registry → no action markup; a test action on its lines only, hidden until hover / focus", () => {
    const none = render([OLD, NEW]);
    // (By test ID: the chip slot's class names the confirm, `group-has-[…confirm]`.)
    expect(none).not.toContain('data-testid="dice-log-action');
    const [old, next] = rows(render([OLD, NEW], [test1]));
    expect(old).not.toContain('data-testid="dice-log-action');
    expect(next).toMatch(
      /data-testid="dice-log-action" data-value="test.star" data-record-id="e2" aria-label="Star it"/,
    );
    expect(next).toMatch(
      /data-testid="dice-log-actions" class="[^"]*opacity-0[^"]*group-hover\/entry:opacity-100/,
    );
    // The row is the hover group; FR-KIT-40 (K12): the actions lead the right column, before
    // the time and the result boxes, so rows with and without actions keep the boxes aligned.
    expect(next).toContain("group/entry");
    expect(next?.indexOf("dice-log-actions")).toBeLessThan(
      next?.indexOf("dice-log-entry-total") ?? Number.NEGATIVE_INFINITY,
    );
  });

  test("FR-DICE-68 entry actions: `feature` off → hidden; `clients` filters by role; order kept", () => {
    const gated: EntryAction = { ...test1, id: "test.gated", feature: GEMS_FEATURE };
    const dmOnly: EntryAction = { ...test1, id: "test.dm", order: 0, clients: ["dm"] };
    const second: EntryAction = { ...test1, id: "test.second", order: 5 };
    const on = store([NEW]);
    const off = store([NEW], []);
    expect(actionsFor([second, gated, dmOnly], on, NEW).map((a) => a.id)).toEqual([
      "test.gated",
      "test.second",
    ]);
    expect(actionsFor([gated], off, NEW)).toEqual([]);
    expect(rows(render([NEW], [gated], off))[0]).not.toContain('data-testid="dice-log-action');
  });
});

describe("FR-DICE-66 throw once", () => {
  test("FR-DICE-66 throw once: a reroll frame throws only the new entry; the supersede upsert and the spend line never", () => {
    const spend = entry({
      id: "e3",
      n: 2,
      kind: "gem.spend",
      category: "other",
      payload: { characterId: "m", gem: "inspiration", count: 1 },
      rollIds: [],
    });
    const prior = store([entry()]);
    const next = { ...NEW, n: 3 };
    const frame = {
      type: "event" as const,
      seq: 1,
      cause: { name: "GemSpent" },
      changes: [
        { type: GAME_LOG_ENTRY_TYPE, op: "upsert" as const, id: "e3", data: spend },
        { type: GAME_LOG_ENTRY_TYPE, op: "upsert" as const, id: "e2", data: next },
        { type: GAME_LOG_ENTRY_TYPE, op: "upsert" as const, id: "e1", data: OLD },
      ],
    };
    const applied = applyEvent(prior, frame);
    if (!applied.ok) throw new Error("gap");
    const after = applied.store;
    expect(newRollEntries(frame, prior, after).map((e) => e.id)).toEqual(["e2"]);
  });
});
