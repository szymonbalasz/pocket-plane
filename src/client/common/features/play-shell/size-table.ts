// FR-SHELL-85, -100: play-shell §7's size table, per client: every window type's default
// (FR-SHELL-51; fitted for the protected ones the default layout places), useful (FR-SHELL-79,
// -100, with the client's band) and min size at the four reference sizes (1280×720, 1280×800,
// 1440×900, 1600×900), and the useful size's content criterion (checked in a browser by
// `e2e/useful-size.e2e.ts`). The registry-driven tests assert each registered kind against it, so
// a size change is a reviewed table edit. APPEND-ONLY registry (AGENTS §9.9, FR-SHELL-112 (1)): a
// kind another track registers fills its pending row in its own branch. Test-only data; nothing
// here runs in the app.
import type { Size } from "./registry";

type Four = readonly [Size, Size, Size, Size];
export interface SizeRow {
  default: Four;
  useful: Four;
  min: Size;
  /** FR-SHELL-100: what must show, without scrolling, at the useful size (fixture content). */
  criterion: string;
  /** A protected (`defaultOpen`) window: placed in its zone, never put away (FR-SHELL-99). */
  protected?: true;
}

/**
 * A row another track fills when it registers the kind (FR-SHELL-112 (1), review-b #14): skipped
 * while the kind is not registered; a registered kind with a pending row fails the table test.
 */
export interface PendingRow {
  pending: string;
}

const s = (w: number, h: number): Size => ({ w, h });
const all = (w: number, h: number): Four => [s(w, h), s(w, h), s(w, h), s(w, h)];
const four = (a: Size, b: Size, c: Size, d: Size): Four => [a, b, c, d];

/** Rows both clients register the same way. */
const shared: Record<string, SizeRow> = {
  "cmp.compendium": {
    default: all(440, 560),
    useful: all(440, 400),
    min: s(320, 360),
    criterion: "search, filters, 5 rows",
  },
  // PM2 (FR-SHELL-156, OQ-SHELL-78 A): Party Manager, 1.25 × 440 (shown band-capped).
  "party.board": {
    default: all(550, 560),
    useful: all(440, 400),
    min: s(340, 360),
    criterion:
      "Party status: every PC row and its companion rows whole + labels Party status, Handouts, Inventory, Loot whole",
  },
  "party.handout": {
    default: all(640, 560),
    useful: all(640, 400),
    min: s(360, 320),
    criterion: "title + 300 px body",
  },
  "shell.prefs": {
    default: all(360, 560),
    useful: all(360, 400),
    min: s(320, 280),
    criterion: "first 2 sections",
  },
  "dicex.tray": {
    default: all(360, 300),
    useful: all(360, 300),
    min: s(300, 240),
    criterion: "dice, notation, Roll",
  },
  "charx.companion": {
    default: all(320, 360),
    useful: all(320, 360),
    min: s(280, 240),
    criterion: "header, stats, 2 attacks + 3 buttons",
  },
  "stats.board": {
    default: all(400, 412),
    useful: all(400, 360),
    min: s(320, 280),
    criterion: "5 rows names whole, or 2 award cards, or the first 4 Highlights lines (S5)",
  },
  // RS2 (FR-SHELL-171, S2 / S4): Stronghold, no launcher.
  "hold.stronghold": {
    default: all(480, 560),
    useful: all(400, 400),
    min: s(340, 360),
    criterion: "header, tab strip and three facility rows",
  },
  // SP2 (seams S4, FR-CMP-63): short viewports open it band-high.
  "cmp.rules": {
    default: four(s(440, 412), s(440, 412), s(440, 600), s(440, 600)),
    useful: all(420, 360),
    min: s(340, 320),
    criterion: "page Tabs + 3 card headings",
  },
  // SP3 (FR-RECAP-10, S4): Recap, no launcher.
  "recap.session": {
    default: four(s(440, 412), s(440, 560), s(440, 560), s(440, 560)),
    useful: all(400, 360),
    min: s(340, 320),
    criterion: "header + the first 4 fight lines",
  },
};

/** The Game log's row (both clients): FR-SHELL-100's useful 460 × 160. */
const log = (dflt: Four): SizeRow => ({
  default: dflt,
  useful: all(460, 160),
  min: s(300, 160),
  criterion: "3 one-line entries + roll bar",
  protected: true,
});

export const SIZE_TABLE: Record<"dm" | "player", Record<string, SizeRow>> = {
  dm: {
    "cbt.initiative": {
      default: all(400, 500),
      useful: all(400, 380),
      min: s(320, 240),
      criterion: "header, controls, 4 rows",
      protected: true,
    },
    "dice.log": log(four(s(690, 160), s(690, 160), s(1150, 240), s(1150, 240))),
    ...shared,
    "note.history": {
      default: all(360, 480),
      useful: four(s(360, 412), s(360, 480), s(360, 480), s(360, 480)),
      min: s(280, 240),
      criterion: "pending + 3 rows",
    },
    "cbt.encounters": {
      default: all(440, 512),
      useful: all(440, 412),
      min: s(360, 320),
      criterion: "4 entries + Save / Start",
    },
    "ent.creatures": {
      default: all(340, 512),
      useful: all(340, 360),
      min: s(300, 240),
      criterion: "search + 6 rows",
    },
    "map.scenes": {
      default: all(260, 440),
      useful: all(260, 360),
      min: s(240, 240),
      criterion: "Show + 6 rows",
    },
    "camp.players": {
      default: all(400, 340),
      useful: all(400, 340),
      min: s(360, 200),
      criterion: "2 players × 2 lines + add",
    },
    "char.sheet": {
      default: all(320, 440),
      useful: all(320, 360),
      min: s(280, 320),
      criterion: "header, HP / AC, tabs, 3 attack rows + buttons",
    },
    // TT2 (seams S3, FR-DICEX-86): DM roll requests.
    "dicex.requests": {
      default: all(360, 460),
      useful: all(360, 400),
      min: s(300, 320),
      criterion: "composer folded + a 6-row card",
    },
  },
  player: {
    "cbt.initiative": {
      default: all(280, 400),
      useful: all(280, 320),
      min: s(240, 200),
      criterion: "header + 4 rows",
      protected: true,
    },
    "char.sheet": {
      default: four(s(320, 338), s(320, 418), s(320, 440), s(320, 440)),
      useful: all(320, 338),
      min: s(280, 320),
      criterion: "header, HP / AC, tabs, 3 attack rows + buttons",
      protected: true,
    },
    "dice.log": log(four(s(510, 160), s(510, 160), s(850, 280), s(850, 280))),
    ...shared,
    "note.history": {
      default: all(360, 480),
      useful: four(s(360, 412), s(360, 480), s(360, 472), s(360, 472)),
      min: s(280, 240),
      criterion: "pending + 3 rows",
    },
  },
};

/**
 * FR-SHELL-112 (1): pending rows of kinds other tracks register after WF1 (append-only; the owner
 * replaces its pending row with the real one in `SIZE_TABLE` in its branch).
 */
export const PENDING_ROWS: Record<"dm" | "player", Record<string, PendingRow>> = {
  dm: {},
  player: {},
};

/** The client's band at the four sizes (FR-SHELL-79). */
export const BANDS: Record<"dm" | "player", readonly number[]> = {
  dm: [412, 492, 512, 512],
  player: [412, 492, 472, 472],
};

/** Test-mode window types (FR-SHELL-20): not product windows, no row. */
export const TEST_KINDS: ReadonlySet<string> = new Set(["shell.test", "sync.probes", "asset.test"]);
