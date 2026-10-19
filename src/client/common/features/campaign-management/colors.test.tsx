// FR-CAMP-28 `colorOf` over fake stores (no DOM: `read` is injected), the hook over a static
// render, and the `--player-<key>` tokens in styles.css against the palette.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PLAYER_COLOR_KEYS, PLAYER_COLORS } from "@shared/campaign-management/colors";
import type { EventFrame } from "@shared/protocol/frames";
import { applyEvent, applySnapshot, type RecordStore } from "@shared/protocol/store";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import {
  type ColorPerson,
  colorKeyOf,
  colorOf,
  playerColorVar,
  ROLE_ACCENT_FALLBACK,
  useColorOf,
} from "./colors";

const YOU = { campaignId: "c1", role: "player" as const, playerId: "p1" };

function store(
  players: { id: string; color: string }[],
  dmColor = "amber",
  campaigns: { id: string; dmColor: string }[] = [],
): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: YOU,
    records: {
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor }, ...campaigns].map((c) => ({
        name: "C",
        ...c,
      })),
      player: players.map((p) => ({ campaignId: "c1", name: p.id, ...p })),
    },
  } as never);
}

/** No theme tokens loaded (bun test): every key falls back to the palette hex. */
const none = () => "";
/** A themed page: tokens resolve to their own values, marked so the read is visible. */
const themed = (name: string) => `var(${name})`;

const S = store([
  { id: "p1", color: "jade" },
  { id: "p2", color: "blue" },
  { id: "p3", color: "magenta" }, // a key this client doesn't know (newer server, edited DB)
]);
const dm: ColorPerson = { role: "dm" };
const p = (playerId: string): ColorPerson => ({ role: "player", playerId });

describe("FR-CAMP-28 colorOf", () => {
  test("FR-CAMP-28 colorOf: player → its key's token; DM → dmColor; unknown player / key → role accent; system → none; tokens read with the hex fallback", () => {
    expect(colorKeyOf(S, p("p1"))).toBe("jade");
    expect(colorKeyOf(S, p("p2"))).toBe("blue");
    expect(colorKeyOf(S, dm)).toBe("amber");
    expect(colorOf(S, p("p1"), none)).toBe(PLAYER_COLORS.jade);
    expect(colorOf(S, p("p2"), none)).toBe("#5b8ff0");
    expect(colorOf(S, dm, none)).toBe("#e69f00");
    // Theme token first.
    expect(colorOf(S, p("p1"), themed)).toBe("var(--player-jade)");
    expect(colorOf(S, dm, themed)).toBe("var(--player-amber)");
    // Unknown key / player / no playerId → today's role accent (theme `--success` / `--warning`).
    expect(colorKeyOf(S, p("p3"))).toBeNull();
    expect(colorOf(S, p("p3"), none)).toBe(ROLE_ACCENT_FALLBACK.player);
    expect(colorOf(S, p("ghost"), none)).toBe("#22c55e");
    expect(colorOf(S, { role: "player" }, none)).toBe("#22c55e");
    expect(colorOf(S, p("ghost"), themed)).toBe("var(--success)");
    expect(colorOf(store([], "teal"), dm, none)).toBe(ROLE_ACCENT_FALLBACK.dm);
    expect(colorOf(store([], "teal"), dm, themed)).toBe("var(--warning)");
    // System actor: no colour at all, whatever the store holds.
    expect(colorKeyOf(S, { role: "system" })).toBeNull();
    expect(colorOf(S, { role: "system" }, themed)).toBeNull();
    expect(colorOf(S, { role: "system", playerId: "p1" }, none)).toBeNull();
  });

  test("FR-CAMP-28 colorOf: the DM colour is the connection's campaign; a store without campaign records falls back", () => {
    const two = store([], "yellow", [{ id: "c0", dmColor: "rose" }]);
    expect(colorKeyOf(two, dm)).toBe("yellow");
    const empty = { you: YOU, records: {} };
    expect(colorKeyOf(empty, dm)).toBeNull();
    expect(colorOf(empty, dm, none)).toBe("#eab308");
    expect(colorOf(empty, p("p1"), none)).toBe("#22c55e");
  });

  test("FR-CAMP-28 colorOf: useColorOf recolours on a player upsert (OQ-CAMP-21: derived, nothing resent)", () => {
    const render = (s: RecordStore, person: ColorPerson) => {
      let got: string | null | undefined;
      function Probe() {
        got = useColorOf()(person);
        return null;
      }
      const sync = createStore<SyncState>()(() => ({ state: "live", store: s }) as never);
      renderToStaticMarkup(
        <SyncContext.Provider value={sync}>
          <Probe />
        </SyncContext.Provider>,
      );
      return got;
    };
    expect(render(S, p("p1"))).toBe(PLAYER_COLORS.jade);
    const frame = {
      type: "event",
      seq: 1,
      changes: [
        {
          op: "upsert",
          type: "player",
          id: "p1",
          data: { id: "p1", campaignId: "c1", name: "p1", color: "rose" },
        },
      ],
    };
    const next = applyEvent(S, frame as unknown as EventFrame);
    if (!next.ok) throw new Error("gap");
    expect(render(next.store, p("p1"))).toBe(PLAYER_COLORS.rose);
    expect(render(next.store, { role: "system" })).toBeNull();
  });

  test("FR-CAMP-28 colorOf: styles.css defines --player-<key> for all 8 keys with the palette's hex", () => {
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    for (const k of PLAYER_COLOR_KEYS) {
      const m = new RegExp(`${playerColorVar(k)}:\\s*(#[0-9a-f]{6});`).exec(css);
      expect({ k, hex: m?.[1] }).toEqual({ k, hex: PLAYER_COLORS[k] });
    }
  });
});
