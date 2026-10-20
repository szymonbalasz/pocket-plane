// FR-CAMP-27 picker (CAMP §13 client row): the swatch model over fake holders, the Popover body
// and trigger over a static render, and the send / reject path with an injected sender.
import { describe, expect, test } from "bun:test";
import { PLAYER_COLOR_KEYS, PLAYER_COLORS } from "@shared/campaign-management/colors";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { IntentRejected } from "../../sync/connection";
import { SyncContext, type SyncState } from "../../sync/store";
import {
  type ColorHolders,
  ColorPopover,
  ColorSwatches,
  colorSwatches,
  pickColor,
  SET_COLOR_INTENT,
} from "./ColorPopover";

const H: ColorHolders = {
  dmColor: "amber",
  players: [
    { id: "p1", name: "Player 1", color: "jade" },
    { id: "p2", name: "Player 2", color: "blue" },
  ],
};
const hex = (k: keyof typeof PLAYER_COLORS) => PLAYER_COLORS[k];
const byKey = (target: string | null, h = H) =>
  Object.fromEntries(colorSwatches(h, target, hex).map((s) => [s.key, s]));

/** `camp-color-swatch` buttons of a static render: value → its attributes. */
function swatchAttrs(html: string) {
  const out: Record<string, { disabled: boolean; state?: string; takenBy?: string }> = {};
  for (const m of html.matchAll(/<button[^>]*data-testid="camp-color-swatch"[^>]*>/g)) {
    const tag = m[0];
    const value = /data-value="([^"]+)"/.exec(tag)?.[1] ?? "";
    out[value] = {
      disabled: / disabled=""/.test(tag),
      state: /data-state="([^"]+)"/.exec(tag)?.[1],
      takenBy: /data-taken-by="([^"]+)"/.exec(tag)?.[1],
    };
  }
  return out;
}

function snapshotStore(players: { id: string; name: string; color: string }[], dmColor: string) {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role: "player", playerId: "p1" },
    records: {
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor }],
      player: players.map((p) => ({ campaignId: "c1", ...p })),
    },
  } as never);
}

function renderWith(store: RecordStore, state: string, node: React.ReactNode) {
  const sync = createStore<SyncState>()(
    () => ({ state, store, connection: { sendIntent: async () => ({}) } }) as never,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const plain = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {node}
    </TooltipProvider>,
  );

describe("FR-CAMP-27 picker", () => {
  test("FR-CAMP-27 picker: player target → 8 swatches in palette order, own checked, the DM's and other players' keys taken", () => {
    const list = colorSwatches(H, "p1", hex);
    expect(list.map((s) => s.key)).toEqual([...PLAYER_COLOR_KEYS]);
    expect(list.map((s) => s.hex)).toEqual(PLAYER_COLOR_KEYS.map((k) => PLAYER_COLORS[k]));
    const s = byKey("p1");
    expect(s.jade).toMatchObject({ checked: true, takenBy: null, label: "Jade" });
    expect(s.blue).toMatchObject({
      checked: false,
      takenBy: "p2",
      label: "Blue — taken by Player 2",
    });
    expect(s.amber).toMatchObject({ takenBy: "dm", label: "Amber — taken by DM" });
    expect(s.rose).toMatchObject({ checked: false, takenBy: null, label: "Rose" });
    expect(list.filter((x) => x.checked)).toHaveLength(1);
  });

  test("FR-CAMP-27 picker: DM target (null) → the DM colour checked, every player's key taken, never by `dm`", () => {
    const s = byKey(null);
    expect(s.amber).toMatchObject({ checked: true, takenBy: null });
    expect(s.jade).toMatchObject({ takenBy: "p1", label: "Jade — taken by Player 1" });
    expect(s.blue?.takenBy).toBe("p2");
    expect(Object.values(s).some((x) => x.takenBy === "dm")).toBe(false);
    // The DM editing Player 2's row: Player 1's key and the DM's are taken, Player 2's checked.
    const p2 = byKey("p2");
    expect(p2.blue?.checked).toBe(true);
    expect(p2.jade?.takenBy).toBe("p1");
    expect(p2.amber?.takenBy).toBe("dm");
  });

  test("FR-CAMP-27 picker: all 8 held (a 9th player's repeated default) → every swatch but the own is taken, each naming its taker", () => {
    const players = PLAYER_COLOR_KEYS.slice(1).map((color, i) => ({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      color,
    }));
    const h: ColorHolders = {
      dmColor: "amber",
      players: [...players, { id: "p9", name: "Player 9", color: "jade" }],
    };
    const s = colorSwatches(h, "p9", hex);
    // Jade is the own key (shared with Player 1's): checked and free; the other 7 name their taker.
    expect(s.filter((x) => x.takenBy === null).map((x) => x.key)).toEqual(["jade"]);
    expect(s.find((x) => x.checked)?.key).toBe("jade");
    expect(s.find((x) => x.key === "sky")?.label).toBe("Sky — taken by Player 2");
    expect(s.find((x) => x.key === "amber")?.label).toBe("Amber — taken by DM");
  });

  test("FR-CAMP-27 picker: static render → taken swatches disabled with the taker, own `data-state=checked`; not live → all disabled", () => {
    const swatches = colorSwatches(H, "p1", hex);
    const live = swatchAttrs(
      plain(<ColorSwatches swatches={swatches} disabled={false} onPick={() => {}} />),
    );
    expect(Object.keys(live)).toEqual([...PLAYER_COLOR_KEYS]);
    expect(live.jade).toEqual({ disabled: false, state: "checked", takenBy: undefined });
    expect(live.blue).toEqual({ disabled: true, state: "unchecked", takenBy: "p2" });
    expect(live.amber).toEqual({ disabled: true, state: "unchecked", takenBy: "dm" });
    expect(live.rose).toEqual({ disabled: false, state: "unchecked", takenBy: undefined });
    const html = plain(<ColorSwatches swatches={swatches} disabled={false} onPick={() => {}} />);
    expect(html).toContain('aria-label="Blue — taken by Player 2"');
    expect(html).toContain('aria-label="Rose"');
    expect(html).toContain(`background-color:${PLAYER_COLORS.rose}`);
    const offline = swatchAttrs(
      plain(<ColorSwatches swatches={swatches} disabled onPick={() => {}} />),
    );
    expect(Object.values(offline).every((s) => s.disabled)).toBe(true);
  });

  test("FR-CAMP-27 picker: a click sends `camp.setColor {playerId, color}` (DM colour: null)", async () => {
    const sent: [string, unknown][] = [];
    const send = async (n: string, p: unknown) => {
      sent.push([n, p]);
      return {};
    };
    await pickColor(send, "p1", "rose");
    await pickColor(send, null, "yellow");
    expect(SET_COLOR_INTENT).toBe("camp.setColor");
    expect(sent).toEqual([
      ["camp.setColor", { playerId: "p1", color: "rose" }],
      ["camp.setColor", { playerId: null, color: "yellow" }],
    ]);
  });

  test("FR-CAMP-27 picker: reject → the Toast handler gets the server's message; the trigger keeps the server's colour", async () => {
    const rejected: unknown[] = [];
    const err = new IntentRejected("conflict", "Taken by Player 2");
    await pickColor(
      async () => {
        throw err;
      },
      "p1",
      "blue",
      (e) => rejected.push(e),
    );
    expect(rejected).toEqual([err]);
    expect((rejected[0] as Error).message).toBe("Taken by Player 2");
    // Not optimistic: the trigger reads the record, which the reject never touched.
    const store = snapshotStore(
      [
        { id: "p1", name: "Player 1", color: "jade" },
        { id: "p2", name: "Player 2", color: "blue" },
      ],
      "amber",
    );
    const html = renderWith(
      store,
      "live",
      <ColorPopover target="p1" testId="camp-my-color" size={12} tip="Your colour" />,
    );
    expect(html).toContain('data-testid="camp-my-color"');
    expect(html).toContain('data-value="jade"');
    expect(html).toContain(`background-color:${PLAYER_COLORS.jade}`);
    expect(html).toContain('aria-label="Your colour: Jade"');
    // Closed: no Popover body in the page.
    expect(html).not.toContain("camp-color-popover");
  });

  test("FR-CAMP-27 picker: the DM trigger reads `campaign.dmColor`; a row trigger carries `data-record-id`", () => {
    const store = snapshotStore([{ id: "p1", name: "Player 1", color: "rose" }], "yellow");
    const dm = renderWith(
      store,
      "reconnecting",
      <ColorPopover target={null} testId="camp-color-dm" size={16} tip="Your colour (DM)" />,
    );
    expect(dm).toContain('data-testid="camp-color-dm"');
    expect(dm).toContain('data-value="yellow"');
    // Not live: the trigger still opens the Popover (its swatches are the disabled ones).
    expect(dm).not.toMatch(/data-testid="camp-color-dm"[^>]* disabled=""/);
    const row = renderWith(
      store,
      "live",
      <ColorPopover
        target="p1"
        testId="camp-player-color"
        recordId="p1"
        size={16}
        tip="Player 1's colour"
      />,
    );
    expect(row).toContain('data-record-id="p1"');
    expect(row).toContain('data-value="rose"');
  });
});

describe("FR-CAMP-32 / -36 sprint-5 picker on hex records (PF0, until PF2's ColorPicker)", () => {
  const HX: ColorHolders = {
    dmColor: PLAYER_COLORS.amber,
    players: [
      { id: "p1", name: "Player 1", color: PLAYER_COLORS.jade },
      { id: "p2", name: "Player 2", color: "#b388ff" },
    ],
  };

  test("FR-CAMP-32 distance rule: hex holders; a free lavender blocks Blue and Sky by distance, naming Player 2; own Jade checked", () => {
    const s = byKey("p1", HX);
    expect(s.jade).toMatchObject({ checked: true, takenBy: null });
    expect(s.amber).toMatchObject({ takenBy: "dm", label: "Amber — taken by DM" });
    for (const k of ["blue", "sky"] as const) {
      expect(s[k]).toMatchObject({
        takenBy: "p2",
        label: `${k === "blue" ? "Blue" : "Sky"} — too close to Player 2's colour for colour-blind players`,
      });
    }
    expect(s.rose).toMatchObject({ takenBy: null, checked: false });
  });

  test("FR-CAMP-36 colorOf hex: the trigger paints the stored hex; data-value is the palette name, or the hex for a free colour", () => {
    const store = snapshotStore(
      [
        { id: "p1", name: "Player 1", color: PLAYER_COLORS.jade },
        { id: "p2", name: "Player 2", color: "#b388ff" },
      ],
      PLAYER_COLORS.amber,
    );
    const mine = renderWith(
      store,
      "live",
      <ColorPopover target="p1" testId="camp-my-color" size={12} tip="Your colour" />,
    );
    expect(mine).toContain('data-value="jade"');
    expect(mine).toContain('aria-label="Your colour: Jade"');
    const free = renderWith(
      store,
      "live",
      <ColorPopover target="p2" testId="camp-player-color" size={16} tip="Player 2's colour" />,
    );
    expect(free).toContain('data-value="#b388ff"');
    expect(free).toContain("background-color:#b388ff");
    expect(free).toContain("Player 2&#x27;s colour: #b388ff");
  });
});
