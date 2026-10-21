// FR-SHELL-85: play-shell §7's sprint-7 size table, per client: every window type's default
// (FR-SHELL-51; fitted for the protected ones the default layout places), useful (FR-SHELL-79,
// with the client's band) and min size at the four reference sizes (1280×720, 1280×800,
// 1440×900, 1600×900). The registry-driven tests assert each registered kind against it, so a
// size change is a reviewed table edit. A kind another track registers adds its row in its own
// branch (FR-SHELL-86). Test-only data; nothing here runs in the app.
import type { Size } from "./registry";

type Four = readonly [Size, Size, Size, Size];
export interface SizeRow {
  default: Four;
  /** Null for a protected (`defaultOpen`) window: placed by the default layout, never parked. */
  useful: Four | null;
  min: Size;
}

const s = (w: number, h: number): Size => ({ w, h });
const all = (w: number, h: number): Four => [s(w, h), s(w, h), s(w, h), s(w, h)];
const four = (a: Size, b: Size, c: Size, d: Size): Four => [a, b, c, d];

/** Rows both clients register the same way. */
const shared: Record<string, SizeRow> = {
  "cmp.compendium": { default: all(440, 560), useful: all(440, 400), min: s(320, 360) },
  "party.board": { default: all(440, 560), useful: all(440, 400), min: s(340, 360) },
  "party.handout": { default: all(640, 560), useful: all(640, 400), min: s(360, 320) },
  "shell.prefs": { default: all(360, 560), useful: all(360, 400), min: s(320, 280) },
  "dicex.tray": { default: all(360, 300), useful: all(360, 300), min: s(300, 240) },
  "charx.companion": { default: all(320, 360), useful: all(320, 360), min: s(280, 240) },
};

export const SIZE_TABLE: Record<"dm" | "player", Record<string, SizeRow>> = {
  dm: {
    "cbt.initiative": { default: all(400, 500), useful: null, min: s(320, 240) },
    "dice.log": {
      default: four(s(690, 160), s(690, 160), s(1150, 240), s(1150, 240)),
      useful: null,
      min: s(300, 160),
    },
    ...shared,
    "note.history": {
      default: all(360, 480),
      useful: four(s(360, 412), s(360, 480), s(360, 480), s(360, 480)),
      min: s(280, 240),
    },
    "cbt.encounters": { default: all(440, 512), useful: all(440, 412), min: s(360, 320) },
    "ent.creatures": { default: all(340, 512), useful: all(340, 360), min: s(300, 240) },
    "map.scenes": { default: all(260, 440), useful: all(260, 360), min: s(240, 240) },
    "camp.players": { default: all(400, 340), useful: all(400, 340), min: s(360, 200) },
    "char.sheet": { default: all(320, 440), useful: all(320, 360), min: s(280, 320) },
  },
  player: {
    "cbt.initiative": { default: all(280, 400), useful: null, min: s(240, 200) },
    "char.sheet": {
      default: four(s(320, 338), s(320, 418), s(320, 440), s(320, 440)),
      useful: null,
      min: s(280, 320),
    },
    "dice.log": {
      default: four(s(510, 160), s(510, 160), s(850, 280), s(850, 280)),
      useful: null,
      min: s(300, 160),
    },
    ...shared,
    "note.history": {
      default: all(360, 480),
      useful: four(s(360, 412), s(360, 480), s(360, 472), s(360, 472)),
      min: s(280, 240),
    },
  },
};

/** The client's band at the four sizes (FR-SHELL-79). */
export const BANDS: Record<"dm" | "player", readonly number[]> = {
  dm: [412, 492, 512, 512],
  player: [412, 492, 472, 472],
};

/** Test-mode window types (FR-SHELL-20): not product windows, no row. */
export const TEST_KINDS: ReadonlySet<string> = new Set(["shell.test", "sync.probes", "asset.test"]);
