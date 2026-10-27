// TT2 roll requests, client (FR-DICEX-75, -83, -84, -86–89, FR-NOTE-59, -61, FR-DICE-84): the
// prompt's roll (expression the server builds, answer intent, Roll + Decline only for its owner,
// outcomes), the DM's row, the request sound's trigger, the composer's targets and input, the
// cards' rows and the roll bar's Request…. Static renders over a fake sync store.
import { afterEach, describe, expect, test } from "bun:test";
import { ROLL_REQUEST_KIND, type RollRequestRecord } from "@shared/dice-extras/requests";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { CharacterStatBlock } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { GameLog } from "../dice-roll-log/GameLog";
import { actionButton, toastsFor } from "../notifications/logic";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { DmPrompt, PlayerPrompt } from "./PromptBody";
import { rollRequestDmView, rollRequestPlayerView } from "./PromptViews";
import { popupRows } from "./popup-logic";
import { answerIntent, promptExpression, promptOutcome } from "./prompt-logic";
import { RequestsWindow } from "./RequestsWindow";
import {
  anyOpen,
  composerInput,
  requestOrder,
  resultsPreset,
  rollOfChoice,
  targetOptions,
  targetText,
} from "./request-logic";
import { promptArrived } from "./request-sound";
import { DICEX_REQUESTS_KIND } from "./window-kind";

const stats = CharacterStatBlock.parse({
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  attacks: [],
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
  skills: { perception: "proficient" },
  level: 1,
  className: "Fighter",
});
const mira = { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1", statBlock: stats };
const thorn = { id: "thorn", kind: "character", name: "Thorn", ownerPlayerId: "p2" };
const ghost = { id: "ghost", kind: "character", name: "Ghost", ownerPlayerId: null };
const PERCEPTION = { kind: "skill", key: "perception", expression: null } as const;

const prompt = (
  o: Partial<NotificationRecord> = {},
  dc: number | null = null,
): NotificationRecord =>
  ({
    id: "n1",
    campaignId: "c1",
    seq: 1,
    kind: ROLL_REQUEST_KIND,
    audience: "player",
    audiencePlayerId: "p1",
    text: dc === null ? "DM: Perception · Mira" : `DM: Perception · Mira · DC ${dc}`,
    payload: {
      requestId: "r1",
      characterId: "mira",
      characterName: "Mira",
      roll: PERCEPTION,
      label: "Perception",
      dc,
      mode: "advantage",
    },
    actionLabel: "Roll",
    actionRole: "player",
    actionPlayerId: "p1",
    state: "pending",
    resolution: null,
    closedAt: null,
    closedByRole: null,
    closedByPlayerId: null,
    byRole: "dm",
    byPlayerId: null,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...o,
  }) as NotificationRecord;

const target = (characterId: string, name: string, o: object = {}) => ({
  characterId,
  playerId: characterId === "mira" ? "p1" : "p2",
  name,
  notificationId: `n-${characterId}`,
  state: "open" as const,
  entryId: null,
  total: null,
  natural: null,
  success: null,
  at: null,
  ...o,
});
const request = (
  id: string,
  seq: number,
  o: Partial<RollRequestRecord> = {},
): RollRequestRecord => ({
  id,
  campaignId: "c1",
  seq,
  roll: PERCEPTION,
  label: "Perception",
  dc: 15,
  dcShown: false,
  mode: "normal",
  results: "hidden",
  state: "open",
  targets: [
    target("mira", "Mira", {
      state: "rolled",
      entryId: "e1",
      total: 18,
      natural: 20,
      success: true,
    }),
    target("thorn", "Thorn"),
  ],
  createdAt: "2026-10-22T00:00:00.000Z",
  closedAt: null,
  ...o,
});

function render(
  node: ReactNode,
  you: { role: "dm" | "player"; playerId: string | null },
  records: Record<string, Record<string, unknown>> = {},
) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", ...you },
          records: { entity: { mira, thorn, ghost }, ...records },
        },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ShellProvider registry={createWindowRegistry(you.role, [])}>{node}</ShellProvider>
        </TooltipProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}
const P1 = { role: "player" as const, playerId: "p1" };
const P2 = { role: "player" as const, playerId: "p2" };
const DM = { role: "dm" as const, playerId: null };
/** The view's body as the lazy chunk renders it (the static render can't wait for `lazy`). */
const Body = (v: typeof rollRequestPlayerView, n: NotificationRecord) => {
  const R = v === rollRequestDmView ? DmPrompt : PlayerPrompt;
  return <R notification={n} />;
};

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("TT2 roll requests (client)", () => {
  test("FR-DICEX-83 prompt roll path: Roll is a roll button over the sheet's expression → dicex.answerRequest", () => {
    // Perception: WIS +3, proficient +2 at level 1.
    expect(promptExpression(PERCEPTION, stats, null)).toBe("1d20+5");
    expect(promptExpression({ kind: "save", key: "dex", expression: null }, stats, null)).toBe(
      "1d20+2",
    );
    expect(promptExpression({ kind: "custom", key: null, expression: "1d100" }, null, null)).toBe(
      "1d100",
    );
    const p = { requestId: "r1", characterId: "mira" };
    expect(answerIntent(p, { mode: "advantage" })).toEqual({ ...p, mode: "advantage" });
    expect(
      answerIntent(p, {
        mode: "normal",
        manual: [{ diceTotal: 12 }],
        manualParts: [[{ key: "e:x", entry: { diceTotal: 3 } }]],
      }),
    ).toEqual({
      ...p,
      mode: "normal",
      manual: { diceTotal: 12 },
      manualParts: [{ key: "e:x", entry: { diceTotal: 3 } }],
    });
    const html = render(Body(rollRequestPlayerView, prompt()), P1);
    expect(html).toContain('data-testid="dicex-prompt-roll"');
    expect(html).toContain('data-testid="dicex-prompt-decline"');
    expect(html).toContain("DM: Perception · Mira");
  });

  test("FR-KIT-57 inline action (K9, K6 gap 9): the player's Roll + Decline sit right of the text (the card's time line then falls under the text), Decline a small stone button", () => {
    const html = render(Body(rollRequestPlayerView, prompt()), P1);
    expect(html).toMatch(/data-testid="dicex-prompt"[^>]*class="flex flex-wrap items-center/);
    // Text first, then the actions in one right-aligned group, the outcome on its own line.
    expect(html).toMatch(
      /<span class="min-w-0 flex-\[1_1_5rem\]">DM: Perception · Mira<\/span><span class="ml-auto flex shrink-0/,
    );
    const decline = html.match(/<button[^>]*data-testid="dicex-prompt-decline"[^>]*>/)?.[0] ?? "";
    expect(decline).toContain('data-variant="outline"');
    expect(decline).toContain('data-size="sm"');
  });

  test("FR-NOTE-59 prompt view: Roll + Decline only for its owner while pending; resolved rows read the outcome", () => {
    expect(render(Body(rollRequestPlayerView, prompt()), P2)).not.toContain("dicex-prompt-roll");
    const out = (resolution: unknown, state = "resolved") =>
      promptOutcome({ state, resolution } as NotificationRecord);
    expect(out({ outcome: "rolled", total: 17 })).toBe("Rolled 17");
    expect(out({ outcome: "declined" })).toBe("Declined");
    expect(out({ outcome: "missed" })).toBe("Closed");
    expect(out(null, "pending")).toBeNull();
    const done = render(
      Body(
        rollRequestPlayerView,
        prompt({ state: "resolved", resolution: { outcome: "rolled", total: 17 } }),
      ),
      P1,
    );
    expect(done).toContain("Rolled 17");
    expect(done).not.toContain("dicex-prompt-roll");
    // The view has no generic action: the toast's own action button never shows.
    const v = { role: "player" as const, playerId: "p1" };
    expect(actionButton(prompt(), v, true, rollRequestPlayerView)).toBe("none");
  });

  test("FR-NOTE-59 prompt views: the body chunk loads lazily; until then the row shows its text", () => {
    const R = rollRequestPlayerView.render as NonNullable<typeof rollRequestPlayerView.render>;
    expect(render(<R notification={prompt({}, 15)} />, P1)).toContain(
      "DM: Perception · Mira · DC 15",
    );
  });

  test("FR-NOTE-61 FR-DICEX-88 DM view: ‹PC› · ‹label› + Open requests, no cue, no action, no toast per answer (player-owned)", () => {
    const html = render(Body(rollRequestDmView, prompt()), DM);
    expect(html).toContain("Mira · Perception");
    expect(html).toContain('data-testid="dicex-prompt-open-requests"');
    expect(toastsFor(prompt(), { role: "dm", playerId: null })).toBe(false);
    expect(html).not.toContain("dicex-prompt-roll");
    expect(rollRequestDmView.cueTokens?.(prompt(), emptyStore(), null)).toEqual([]);
    expect(actionButton(prompt(), { role: "dm", playerId: null }, true, rollRequestDmView)).toBe(
      "none",
    );
  });

  test("FR-DICEX-89 request sound: a new pending prompt of this player in a live frame; never the DM, another's, or a resolve", () => {
    const frame = (name: string, data: object) => ({
      cause: { name },
      changes: [{ type: "notification", id: "n1", op: "upsert" as const, data }],
    });
    const p = prompt();
    expect(promptArrived(frame("NotificationCreated", p), P1)).toBe(true);
    expect(promptArrived(frame("NotificationCreated", p), P2)).toBe(false);
    expect(promptArrived(frame("NotificationCreated", p), DM)).toBe(false);
    expect(promptArrived(frame("NotificationResolved", { ...p, state: "resolved" }), P1)).toBe(
      false,
    );
    expect(promptArrived(frame("NotificationCreated", { ...p, kind: "test" }), P1)).toBe(false);
  });

  test("FR-DICEX-75 composer targets: ownerless or hidden PCs can't be picked; All PCs = the eligible", () => {
    const store = {
      ...emptyStore(),
      records: {
        entity: { mira, thorn, ghost },
        encounter: { e1: { id: "e1", status: "started" } },
        combatant: {
          c1: {
            id: "c1",
            encounterId: "e1",
            entityId: "thorn",
            kind: "pc",
            active: true,
            hidden: true,
          },
        },
      },
    };
    expect(targetOptions(store as never)).toEqual([
      { id: "ghost", name: "Ghost", blocked: "No player" },
      { id: "mira", name: "Mira", blocked: null },
      { id: "thorn", name: "Thorn", blocked: "Hidden from players" },
    ]);
    const form = {
      choice: "save:dex",
      expression: "",
      targets: ["mira"],
      dc: "15",
      dcShown: true,
      mode: "advantage" as const,
      results: "public" as const,
      label: "",
    };
    expect(composerInput(form)).toEqual({
      input: {
        roll: { kind: "save", key: "dex", expression: null },
        characterIds: ["mira"],
        dc: 15,
        dcShown: true,
        mode: "advantage",
        results: "public",
      },
    });
    expect(composerInput({ ...form, targets: [] })).toEqual({
      error: "Pick at least one character",
    });
    expect(composerInput({ ...form, dc: "41" })).toEqual({ error: "DC: a whole number 1–40" });
    expect(composerInput({ ...form, choice: "custom" })).toEqual({ error: "Type the dice" });
    expect(rollOfChoice("custom", " 1d100 ")).toEqual({
      kind: "custom",
      key: null,
      expression: "1d100",
    });
    // FR-DICEX-77: the eye's preset follows the category's public setting.
    expect(resultsPreset("skill:perception", (c) => c === "skill-check")).toBe("public");
    expect(resultsPreset("save:dex", (c) => c === "skill-check")).toBe("hidden");
  });

  test("FR-DICEX-86 requests window: the composer opens folded while a request is open; cards open first", () => {
    const open = request("r-open", 2);
    const closed = request("r-closed", 1, { state: "closed" });
    expect(requestOrder([closed, open]).map((r) => r.id)).toEqual(["r-open", "r-closed"]);
    expect([anyOpen([open]), anyOpen([closed])]).toEqual([true, false]);
    const both = render(<RequestsWindow />, DM, {
      "roll-request": { "r-open": open, "r-closed": closed },
    });
    expect(both).toMatch(/data-testid="dicex-request-fold" data-state="closed"/);
    expect(both).not.toContain('data-testid="dicex-request-roll"');
    expect(
      [...both.matchAll(/data-testid="dicex-request-card" data-record-id="([^"]+)"/g)].map(
        (m) => m[1],
      ),
    ).toEqual(["r-open", "r-closed"]);
    const html = render(<RequestsWindow />, DM, { "roll-request": { "r-closed": closed } });
    for (const id of [
      "dicex-requests",
      "dicex-request-roll",
      "dicex-request-all",
      "dicex-request-dc",
      "dicex-request-dc-shown",
      "dicex-request-mode",
      "dicex-request-results",
      "dicex-request-label",
      "dicex-request-send",
    ]) {
      expect([id, html.includes(`data-testid="${id}"`)]).toEqual([id, true]);
    }
    expect(html).toMatch(
      /data-testid="dicex-request-target" data-record-id="ghost" data-state="blocked"/,
    );
    expect(DICEX_REQUESTS_KIND).toBe("dicex.requests");
  });

  test("FR-DICEX-87 FR-DICEX-85 request card (pass / fail on the DM's card only): per target Waiting / total ✓ ✗ / Declined / No roll, nat 20; Roll for missing, Close", () => {
    expect(targetText(target("m", "M"))).toBe("Waiting");
    expect(targetText(target("m", "M", { state: "rolled", total: 18, success: true }))).toBe(
      "18 ✓",
    );
    expect(targetText(target("m", "M", { state: "rolled", total: 9, success: false }))).toBe("9 ✗");
    expect(targetText(target("m", "M", { state: "rolled", total: 9, success: null }))).toBe("9");
    expect(targetText(target("m", "M", { state: "declined" }))).toBe("Declined");
    expect(targetText(target("m", "M", { state: "missed" }))).toBe("No roll");
    const html = render(<RequestsWindow />, DM, { "roll-request": { r1: request("r1", 1) } });
    expect(html).toMatch(
      /data-testid="dicex-request-target-row" data-record-id="mira" data-state="rolled" data-total="18" data-success="true"/,
    );
    expect(html).toContain("nat 20");
    expect(html).toContain("Waiting");
    expect(html).toContain('data-testid="dicex-request-missing"');
    expect(html).toContain('data-testid="dicex-request-close"');
    expect(html).toContain("DC 15 (hidden)");
  });

  test("FR-DICEX-84 hidden result surfaces: a hidden answer's popup row is marked hidden (eye-off)", () => {
    const entry = {
      id: "e1",
      n: 1,
      kind: "roll",
      category: "skill-check",
      public: false,
      audiencePlayerId: "p1",
      actorName: "Mira",
      rollerRole: "player",
      rollerPlayerId: "p1",
      undone: false,
      supersededBy: null,
      at: "2026-10-22T00:00:00.000Z",
      rollIds: ["r1"],
      payload: [
        {
          rollId: "r1",
          expression: "1d20+5",
          mode: "normal",
          manual: false,
          dice: [{ faces: 20, value: 12, kept: true }],
          constant: 5,
          total: 17,
          natural: 12,
          label: "Perception",
          answer: true,
        },
      ],
    } as unknown as GameLogEntryView;
    expect(popupRows([entry])[0]).toMatchObject({ actor: "Mira", hidden: true });
    expect(popupRows([{ ...entry, public: true } as GameLogEntryView])[0]?.hidden).toBe(false);
  });

  test("FR-DICE-84 request button: the DM's roll bar has Request… (options row); players never", () => {
    const store = new Map([
      ["pp.dice.options.v1.c1.dm", "1"],
      ["pp.dice.options.v1.c1.p1", "1"],
    ]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    const dm = render(<GameLog dmTools={<span />} />, DM);
    expect(dm).toContain('data-testid="dicex-request-open"');
    expect(render(<GameLog />, P1)).not.toContain("dicex-request-open");
  });
});
