// FR-MAP-76 companion marker (the `companion` token overlay: a paw badge in the owner's colour on
// owned non-PC tokens, BL-35's small-cell rules). Pure: the store each client holds (companions-fixture).
import { describe, expect, test } from "bun:test";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { ROLE_ACCENT_FALLBACK } from "../campaign-management/colors";
import { chipGlyph } from "../scenes-map/canvas-icons";
import { decorateToken } from "../scenes-map/decorations";
import { labelRow, type Measure, MORE_BADGE_ID, type Pill } from "../scenes-map/label";
import { tokenOverlays } from "../scenes-map/token-overlays";
import { companionStore } from "./companions-fixture";
import { COMPANION_MARKER_ID, companionBadge, sideBadge } from "./token-overlay";

const token = (o: Partial<TokenView>): TokenView =>
  ({
    id: "t-owl",
    sceneId: "s1",
    name: "Owlbear",
    col: 0,
    row: 7,
    size: "large",
    hidden: false,
    imageAssetId: null,
    ownerPlayerId: "p1",
    characterId: null,
    ...o,
  }) as TokenView;

const OWLBEAR = token({});
const MIRA = token({ id: "t-mira", name: "Mira", size: "medium", characterId: "ch-mira" });
const GOBLIN = token({ id: "t-gob", name: "Goblin", size: "small", ownerPlayerId: null });
const WOLF = token({ id: "t-wolf", name: "Wolf", size: "medium", ownerPlayerId: "p2" });

/** `store` with the Owlbear's combatant bound to its token (as `cbt.addCombatant` binds it). */
function bound(store: RecordStore, combatantId = "owlbear", tokenId = "t-owl"): RecordStore {
  const rows = store.records.combatant ?? {};
  const row = rows[combatantId] as Record<string, unknown>;
  return {
    ...store,
    records: { ...store.records, combatant: { ...rows, [combatantId]: { ...row, tokenId } } },
  };
}

/** No started encounter (a pet out of a fight). */
const outOfFight = (store: RecordStore): RecordStore => ({
  ...store,
  records: { ...store.records, encounter: {}, combatant: {} },
});

const view = (client: "dm" | "player") => ({ client, selected: false, targeting: false });

/** Fixed-pitch fake, as label.test.ts. */
const measure: Measure = (text, font, bold) => [...text].length * font * (bold ? 0.6 : 0.5);

const overlaps = (a: Pill, b: Pill, dx = 0, dy = 0) =>
  a.x < b.x + dx + b.width &&
  b.x + dx < a.x + a.width &&
  a.y < b.y + dy + b.height &&
  b.y + dy < a.y + a.height;

describe("FR-MAP-76 companion marker", () => {
  test("FR-MAP-76 companion marker: owned characterId = null tokens only, a paw in the owner's colour, 'Player 1's companion'", () => {
    const store = companionStore("dm");
    expect(companionBadge(OWLBEAR, store)).toEqual({
      id: COMPANION_MARKER_ID,
      icon: "paw-print",
      tone: "neutral",
      label: "Player 1's companion",
      color: "#e69f00",
      compact: true,
    });
    expect(companionBadge(WOLF, store)?.color).toBe("#56b4e9");
    expect(companionBadge(WOLF, store)?.label).toBe("Player 2's companion");
    // A PC token (owned, with a character) and an unowned monster: no marker.
    expect(companionBadge(MIRA, store)).toBeNull();
    expect(companionBadge(GOBLIN, store)).toBeNull();
    // The glyph is the lucide paw, not a letter.
    expect("path" in chipGlyph("paw-print", "Player 1's companion")).toBe(true);
  });

  test("FR-MAP-76 companion marker: the same badge on the DM's and every player's client (a pure token rule, no combat data)", () => {
    const paw = companionBadge(OWLBEAR, companionStore("dm"));
    if (!paw) throw new Error("no paw");
    const badges = (store: RecordStore, client: "dm" | "player") =>
      decorateToken(tokenOverlays, OWLBEAR, outOfFight(store), view(client)).badges;
    for (const [store, client] of [
      [companionStore("dm"), "dm"],
      [companionStore("p1"), "player"],
      [companionStore("p2"), "player"],
    ] as const) {
      expect(badges(store, client)).toContainEqual(paw);
    }
    // In a fight it joins combat's badges (after them, registry order).
    const inFight = decorateToken(
      tokenOverlays,
      OWLBEAR,
      bound(companionStore("p2")),
      view("player"),
    );
    expect(inFight.badges.at(-1)?.id).toBe(COMPANION_MARKER_ID);
    expect(decorateToken(tokenOverlays, MIRA, companionStore("dm"), view("dm")).badges).toEqual([]);
  });

  test("FR-MAP-76 companion marker: colour via colorOf: a palette key → its hex, an unknown owner → the player accent", () => {
    const store = companionStore("p2");
    const keyed = {
      ...store,
      records: {
        ...store.records,
        player: { ...store.records.player, p1: { id: "p1", name: "Player 1", color: "rose" } },
      },
    } as RecordStore;
    expect(companionBadge(OWLBEAR, keyed)?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(companionBadge(OWLBEAR, keyed)?.color).not.toBe("rose");
    const gone = companionBadge(token({ ownerPlayerId: "p9" }), store);
    expect(gone?.color).toBe(ROLE_ACCENT_FALLBACK.player);
    expect(gone?.label).toBe("Player's companion");
  });

  test("FR-MAP-76 companion marker: always a chip, even zoomed in on a Large token; compact below 48 px (BL-35: chip + '+N', or '+N'), never over a name", () => {
    const store = companionStore("dm");
    const paw = companionBadge(OWLBEAR, store);
    if (!paw) throw new Error("no paw");
    const ally = sideBadge({
      id: "owlbear",
      kind: "monster",
      side: "ally",
      publicSide: "ally",
    } as never);
    if (!ally) throw new Error("no side badge");
    for (const footprint of [1, 2]) {
      const side = 70 * footprint;
      for (const badges of [[paw], [ally, paw]]) {
        for (const px of [24, 32, 40, 44, 48, 64, 96]) {
          const scale = px / 70;
          const r = labelRow("Owlbear", badges, side, 70, scale, measure);
          const neighbour = labelRow("Mira", [], 70, 70, scale, measure);
          for (const b of r.badges) {
            const at = `${footprint}×${footprint} ${px} px ${b.id}`;
            expect(overlaps(b, r.name) ? `${at} covers its name` : "ok").toBe("ok");
            for (const [dx, dy] of [
              [0, -70],
              [side, -70],
              [-70, -70],
              [side, 0],
              [-70, 0],
            ] as const) {
              const hit = overlaps(b, neighbour.name, dx, dy);
              expect(hit ? `${at} covers the name at ${dx},${dy}` : "ok").toBe("ok");
            }
          }
          const mine = r.badges.find((b) => b.id === COMPANION_MARKER_ID);
          const more = r.badges.find((b) => b.id === MORE_BADGE_ID);
          // Drawn as a chip (never the long text), or listed in the "+N"'s hover.
          if (mine) expect(mine.compact).toBe(true);
          else expect(more?.full?.split(", ")).toContain("Player 1's companion");
          if (px >= 48) expect(mine?.compact).toBe(true);
        }
      }
    }
    // Alone on a 1×1 at 24 px (the fit floor): still its chip.
    const alone = labelRow("Owlbear", [paw], 70, 70, 24 / 70, measure);
    expect(alone.badges).toMatchObject([{ id: COMPANION_MARKER_ID, compact: true }]);
  });
});
