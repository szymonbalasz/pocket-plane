// Kit parity K1 (§6.4, FR-KIT-40–47 + the slice's FR-KIT-01/03/04/07 checks): the Game log's
// 40-px row over a fake sync store (static render), the entry Tooltip body, the copy and the
// re-pin helpers with fakes.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEntry } from "@shared/dice-roll-log/line";
import { copyText } from "@shared/dice-roll-log/row";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { colorHex } from "../campaign-management/colors";
import { landing } from "../dice-extras/landing";
import { EntryDetails, GameLog } from "./GameLog";
import {
  copiedRows,
  createStickToBottom,
  type FontsLike,
  type MutationObserverLike,
  repinOn,
  rowTime,
} from "./logic";

const AT = "2026-10-17T21:14:00.000Z";
const item = (o: Record<string, unknown> = {}) => ({
  rollId: "r1",
  expression: "1d20+9",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 20, kept: true }],
  constant: 9,
  total: 29,
  natural: 20,
  label: "Longbow attack",
  ...o,
});
const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: AT,
  kind: "roll",
  category: "attack",
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
const damage = entry({
  id: "e2",
  n: 2,
  category: "damage",
  payload: [
    item({
      rollId: "r2",
      expression: "2d8+4",
      label: "Longbow damage",
      dice: [
        { faces: 8, value: 5, kept: true },
        { faces: 8, value: 7, kept: true },
      ],
      constant: 4,
      total: 16,
      natural: null,
      manual: true,
    }),
  ],
  rollIds: ["r2"],
});
/** The DM's apply line (`cbt.hp`): neutral; its amount boxed (K8). */
const hp = entry({
  id: "e3",
  n: 3,
  kind: "cbt.hp",
  category: "damage",
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "DM",
  payload: { targetName: "Goblin", kind: "damage", amount: 16 },
  rollIds: [],
});

function render(
  entries: GameLogEntryView[],
  role: "dm" | "player" = "player",
  node?: React.ReactNode,
) {
  const store = {
    ...emptyStore(),
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {
      [GAME_LOG_ENTRY_TYPE]: Object.fromEntries(entries.map((e) => [e.id, e])),
      campaign: { c1: { id: "c1", name: "C", dmColor: "amber" } },
      player: { p1: { id: "p1", campaignId: "c1", name: "Player 1", color: "jade" } },
    },
  } as unknown as RecordStore;
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node ?? <GameLog />}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** Each row's `<li>` by record id: its opening tag and body. */
function rows(markup: string) {
  const out = new Map<string, { li: string; body: string }>();
  for (const m of markup.matchAll(/<li data-testid="dice-log-entry"([^>]*)>([\s\S]*?)<\/li>/g)) {
    const id = /data-record-id="([^"]+)"/.exec(m[1] ?? "")?.[1] ?? "";
    out.set(id, { li: m[1] ?? "", body: m[2] ?? "" });
  }
  return out;
}
const row = (markup: string, id: string) => rows(markup).get(id) ?? { li: "", body: "" };
/** Where each test ID first opens in `body`. */
const at = (body: string, id: string) => body.indexOf(`data-testid="${id}"`);
const tag = (body: string, id: string) =>
  new RegExp(`<\\w+[^>]*data-testid="${id}"[^>]*>`).exec(body)?.[0] ?? "";

afterEach(() => landing.api.setState({ holding: new Map() }));

describe("FR-KIT-40 row grid", () => {
  test("FR-KIT-40 row grid: one 40-px row, medallion · what · time · boxes · chips · actions, attributes kept", () => {
    const r = row(render([entry(), damage]), "e2");
    expect(r.li).toContain('data-slot="log-row"');
    expect(r.li).toMatch(/class="[^"]*\bgrid\b[^"]*\bh-10\b/);
    for (const a of [
      "data-record-id",
      "data-roller",
      "data-public",
      "data-undone",
      "data-superseded",
      "data-focused",
      "data-landed",
    ])
      expect(r.li).toContain(a);
    const order = [
      "kit-medallion",
      "dice-log-entry-text",
      "dice-log-entry-time",
      "dice-log-entry-total",
      "dice-log-entry-manual",
    ].map((id) => at(r.body, id));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The category chip moved into the Tooltip (FR-KIT-45).
    expect(r.body).not.toContain(">Damage<");
  });

  test("FR-KIT-40 row grid: the DM's hidden icon sits before the name; undone and rerolled stay struck, the rerolled button kept", () => {
    const hidden = row(render([entry({ public: false })], "dm"), "e1").body;
    expect(at(hidden, "dice-log-entry-hidden")).toBeGreaterThan(at(hidden, "kit-medallion"));
    expect(at(hidden, "dice-log-entry-hidden")).toBeLessThan(at(hidden, "dice-log-entry-actor"));
    const undone = row(render([entry({ undone: true })]), "e1").body;
    expect(tag(undone, "dice-log-entry-text")).toContain("line-through");
    expect(tag(undone, "dice-log-entry-total")).toContain("line-through");
    expect(undone).toMatch(/>undone</);
    const re = row(render([entry({ supersededBy: "e9" }), entry({ id: "e9", n: 9 })]), "e1").body;
    expect(tag(re, "dice-log-entry-text")).toMatch(/line-through[^"]*opacity-60/);
    expect(tag(re, "dice-log-rerolled")).toContain('data-record-id="e9"');
  });
});

describe("FR-KIT-41 medallion colour", () => {
  test("FR-KIT-41 medallion colour: the actor's initial on its name colour; an uncoloured line neutral", () => {
    const html = render([entry(), hp]);
    const mira = tag(row(html, "e1").body, "kit-medallion");
    expect(mira).toContain(`background-color:${colorHex("jade")}`);
    expect(row(html, "e1").body).toMatch(/data-testid="kit-medallion"[^>]*>M</);
    const dm = tag(row(html, "e3").body, "kit-medallion");
    expect(dm).toContain("bg-muted");
    expect(dm).not.toContain("style=");
    expect(dm).toContain('data-size="md"');
  });
});

describe("FR-KIT-42 row action text", () => {
  test("FR-KIT-42 row action text: 'Name · action' on one line; other kinds without the actor", () => {
    const html = render([entry(), hp]);
    const what = (id: string) =>
      /data-testid="dice-log-entry-text"[^>]*>([\s\S]*?)<\/span><\/span>/
        .exec(row(html, id).body)?.[1]
        ?.replace(/<[^>]+>/g, "");
    expect(what("e1")).toBe("Mira · Longbow attack");
    // K8: a combat line reads as a short action; its number is a box.
    expect(what("e3")).toBe("DM · Goblin takes damage");
    expect(tag(row(html, "e1").body, "dice-log-entry-text")).toContain("truncate");
    expect(tag(row(html, "e1").body, "dice-log-entry-actor")).toContain(
      `color:${colorHex("jade")}`,
    );
  });
});

describe("FR-KIT-43 time", () => {
  test("FR-KIT-43 time: HH:MM local from e.at, hidden below a 360-px row (container query)", () => {
    const d = new Date(AT);
    const two = (n: number) => String(n).padStart(2, "0");
    expect(rowTime(AT)).toBe(`${two(d.getHours())}:${two(d.getMinutes())}`);
    expect(rowTime("nope")).toBe("");
    const html = render([entry()]);
    const t = tag(row(html, "e1").body, "dice-log-entry-time");
    expect(t).toMatch(new RegExp(`datetime="${AT}"`, "i"));
    expect(t).toMatch(/class="hidden [^"]*@min-\[360px\]\/log:inline/);
    expect(row(html, "e1").body).toContain(`>${rowTime(AT)}</time>`);
    expect(html).toMatch(/<ul class="@container\/log /);
  });
});

describe("FR-KIT-44 outcome", () => {
  test("FR-KIT-44 outcome: a box per total with its roll id and outcome; the physical chip after the boxes", () => {
    const html = render([
      entry(),
      damage,
      entry({
        id: "e4",
        n: 4,
        category: "healing",
        payload: [item({ natural: null, label: "Cure" })],
      }),
    ]);
    const crit = tag(row(html, "e1").body, "dice-log-entry-total");
    expect(crit).toContain('data-record-id="r1"');
    expect(crit).toContain('data-outcome="crit"');
    expect(crit).toContain('data-slot="kit-result"');
    expect(crit).toContain('tabindex="0"'); // FR-KIT-03 / -45: focus opens the Tooltip
    expect(row(html, "e1").body).toMatch(/data-testid="dice-log-entry-total"[^>]*>29</);
    expect(tag(row(html, "e2").body, "dice-log-entry-total")).toContain('data-outcome="damage"');
    expect(tag(row(html, "e4").body, "dice-log-entry-total")).toContain('data-outcome="heal"');
    const d = row(html, "e2").body;
    expect(at(d, "dice-log-entry-manual")).toBeGreaterThan(at(d, "dice-log-entry-total"));
    // No box on a line without numbers (a side change).
    const side = entry({
      id: "e5",
      kind: "cbt.side",
      payload: { targetName: "Wolf", side: "ally" },
      rollIds: [],
    });
    expect(render([side])).not.toContain("dice-log-entry-total");
  });

  test("FR-KIT-44 outcome: at most 2 boxes, then '+N'", () => {
    const three = entry({
      payload: [
        item(),
        item({ rollId: "r2", label: "B", natural: 3, total: 12 }),
        item({ rollId: "r3", label: "C", natural: 4, total: 13 }),
      ],
    });
    const body = row(render([three]), "e1").body;
    expect(body.match(/data-testid="dice-log-entry-total"/g)).toHaveLength(2);
    expect(body).toMatch(/data-testid="dice-log-entry-more"[^>]*>\+1</);
    expect(body).not.toContain(">13<");
  });

  test("FR-KIT-44 held: '…' with no outcome, no Tooltip and no number until the landing", () => {
    landing.api.setState({ holding: new Map([["e1", 6000]]) });
    const three = entry({
      payload: [item(), item({ rollId: "r2", total: 12 }), item({ rollId: "r3", total: 13 })],
    });
    const body = row(render([three]), "e1").body;
    for (const m of body.matchAll(/<span[^>]*data-testid="dice-log-entry-total"[^>]*>([^<]*)</g)) {
      expect(m[0]).not.toContain("data-outcome");
      expect(m[0]).not.toContain("tabindex");
      expect(m[1]).toBe("…");
    }
    expect(tag(body, "dice-log-entry-more")).not.toContain("tabindex");
    expect(body).not.toMatch(/>(29|12|13)</);
    expect(body).not.toContain("natural");
  });
});

describe("K8 combat rows (K6 gaps 1, 2)", () => {
  /** Mira's Longbow hit on Goblin as the DM sees it (AC in `dmPayload`). */
  const attack = entry({
    id: "e6",
    kind: "cbt.attack",
    rollerRole: "dm",
    rollerPlayerId: null,
    payload: {
      targetName: "Goblin",
      attackName: "Longbow",
      damageType: "piercing",
      toHit: { dice: 17, constant: 4, total: 21, natural: 17 },
      hit: true,
      damage: 8,
      multiplier: "normal",
      crit: false,
    },
    dmPayload: {
      targetAc: 15,
      hitComputed: true,
      toHitRolled: 21,
      damageRolled: 8,
      damageTotal: 8,
      applied: 8,
      overkill: 0,
      overrides: { toHit: false, hit: false, damage: false },
    },
    rollIds: [],
  });

  test("FR-KIT-42 row action text (K8): a cbt.attack row reads 'Mira · Longbow attack vs Goblin' with a to-hit and a damage box; the maths only in the full line", () => {
    for (const role of ["dm", "player"] as const) {
      const body = row(render([attack], role), "e6").body;
      const what = /data-testid="dice-log-entry-text"[^>]*>([\s\S]*?)<\/span><\/span>/
        .exec(body)?.[1]
        ?.replace(/<[^>]+>/g, "");
      expect(what).toBe("Mira · Longbow attack vs Goblin");
      const boxes = [
        ...body.matchAll(/<span[^>]*data-testid="dice-log-entry-total"[^>]*>([^<]*)</g),
      ];
      expect(boxes.map((m) => m[1])).toEqual(["21", "8"]);
      expect(boxes[0]?.[0]).toContain('data-outcome="plain"');
      expect(boxes[1]?.[0]).toContain('data-outcome="damage"');
      // No roll record behind a combat line's numbers.
      for (const m of boxes) expect(m[0]).not.toContain("data-record-id");
    }
    // FR-KIT-46: the full line stays the screen-reader / copy text (the DM's with its AC).
    const dm = row(render([attack], "dm"), "e6").body;
    expect(dm).toContain("Mira attacks Goblin: 17 + 4 = 21 vs AC 15 — hit! 8 piercing damage");
    // A player's copy of the entry has no `dmPayload` (the server's filter): no AC anywhere.
    const player = row(render([{ ...attack, dmPayload: null }], "player"), "e6").body;
    expect(player).toContain("Mira attacks Goblin: 17 + 4 = 21 — DM: hit. 8 piercing damage");
    expect(player).not.toContain("AC 15");
  });

  test("FR-KIT-44 outcome (K8): an 'attack + damage' roll row's damage box is red (`damage`)", () => {
    const both = entry({
      payload: [
        item({ natural: 14, total: 18, dice: [{ faces: 20, value: 14, kept: true }] }),
        item({
          rollId: "r2",
          expression: "1d8+2",
          label: "Longbow damage (piercing)",
          dice: [{ faces: 8, value: 5, kept: true }],
          constant: 2,
          total: 7,
          natural: null,
        }),
      ],
      rollIds: ["r1", "r2"],
    });
    const body = row(render([both]), "e1").body;
    const tags = [...body.matchAll(/<span[^>]*data-testid="dice-log-entry-total"[^>]*>/g)];
    expect(tags[0]?.[0]).toContain('data-outcome="plain"');
    expect(tags[1]?.[0]).toContain('data-outcome="damage"');
    expect(tags[1]?.[0]).toContain('data-record-id="r2"');
  });
});

describe("FR-KIT-45 tooltip content", () => {
  test("FR-KIT-45 tooltip content: time, the dice per roll, the full line with its chips, then the category", () => {
    const html = render([damage], "player", <EntryDetails e={damage} />);
    const text = html.replace(/<[^>]+>/g, "|");
    const time = new Date(damage.at).toLocaleTimeString();
    const order = [
      time,
      "2d8+4: [5, 7] + 4",
      "Mira — Longbow damage: 5 + 7 + 4 = 16",
      "Damage",
    ].map((s) => text.indexOf(s.split(" ")[0] as string));
    expect(html).toContain(time);
    expect(html).toContain("2d8+4: [5, 7] + 4");
    expect(html.match(/data-testid="dice-log-die"/g)).toHaveLength(2);
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(">Damage</span>");
    // The physical badge keeps its text in the line; the row chip has the test ID.
    expect(html).not.toContain("dice-log-entry-manual");
  });
});

describe("FR-KIT-46 copy", () => {
  test("FR-KIT-46 copy: each row holds its full line (today's text, held as shown) for copy and screen readers; the visible row is aria-hidden", () => {
    const html = render([entry(), damage]);
    const line = (id: string) =>
      /<span data-line="true" class="sr-only">([^<]*)</.exec(row(html, id).body)?.[1];
    expect(line("e1")).toBe(copyText(formatEntry(entry()).segments));
    expect(line("e2")).toBe("Mira — Longbow damage: 5 + 7 + 4 = 16 physical");
    expect(tag(row(html, "e1").body, "dice-log-entry-text")).toContain('aria-hidden="true"');
    landing.api.setState({ holding: new Map([["e1", 6000]]) });
    expect(
      /<span data-line="true" class="sr-only">([^<]*)</.exec(
        row(render([entry()]), "e1").body,
      )?.[1],
    ).toBe("Mira — Longbow attack: … + 9 = …");
  });

  test("FR-KIT-46 copy: the rows a selection touches, one line each; none touched → the browser copies", () => {
    const list = [
      { id: "a", line: "Mira — Perception: 4 + 3 = 7" },
      { id: "b", line: "Goblin — Scimitar: 12 + 4 = 16" },
      { id: "c", line: "DM — Mira takes 5 damage" },
    ];
    const pick = (ids: string[]) =>
      copiedRows(
        list,
        (r) => ids.includes(r.id),
        (r) => r.line,
      );
    expect(pick(["a", "b"])).toBe("Mira — Perception: 4 + 3 = 7\nGoblin — Scimitar: 12 + 4 = 16");
    expect(pick(["c"])).toBe("DM — Mira takes 5 damage");
    expect(pick([])).toBeNull();
  });
});

describe("FR-KIT-47 repin on theme", () => {
  function fakes() {
    const observers: { cb: () => void; on: boolean; options?: unknown }[] = [];
    const Observer = class {
      o: (typeof observers)[number];
      constructor(cb: () => void) {
        this.o = { cb, on: false };
        observers.push(this.o);
      }
      observe(_t: never, options: unknown) {
        this.o.on = true;
        this.o.options = options;
      }
      disconnect() {
        this.o.on = false;
      }
    } as unknown as MutationObserverLike;
    const listeners = new Set<() => void>();
    const fonts: FontsLike = {
      addEventListener: (_t, cb) => listeners.add(cb),
      removeEventListener: (_t, cb) => listeners.delete(cb),
    };
    const fire = () => {
      for (const o of observers) if (o.on) o.cb();
    };
    return { Observer, fonts, listeners, fire, observers };
  }

  test("FR-KIT-47 repin on theme: a pinned list re-pins after an <html> attribute change and after fonts load", () => {
    const f = fakes();
    const view = { scrollTop: 100, scrollHeight: 300, clientHeight: 200 };
    const stick = createStickToBottom();
    stick.scrolled(view);
    expect(stick.atBottom).toBe(true);
    const off = repinOn(view, stick, {}, f.Observer, f.fonts);
    expect(f.observers[0]?.options).toEqual({ attributes: true });
    view.scrollHeight = 360; // a theme with taller rows
    f.fire();
    expect(view.scrollTop).toBe(360);
    view.scrollHeight = 380; // late web fonts
    for (const cb of f.listeners) cb();
    expect(view.scrollTop).toBe(380);
    off();
    expect(f.listeners.size).toBe(0);
    expect(f.observers[0]?.on).toBe(false);
  });

  test("FR-KIT-47 repin on theme: a list scrolled up keeps its position", () => {
    const f = fakes();
    const view = { scrollTop: 0, scrollHeight: 600, clientHeight: 200 };
    const stick = createStickToBottom();
    stick.scrolled(view);
    expect(stick.atBottom).toBe(false);
    repinOn(view, stick, {}, f.Observer, f.fonts);
    view.scrollHeight = 700;
    f.fire();
    for (const cb of f.listeners) cb();
    expect(view.scrollTop).toBe(0);
  });
});

describe("FR-KIT-01 same DOM per theme", () => {
  test("FR-KIT-01 same DOM per theme: the log renders the same markup under Simple Dark and Gilt & Stone; no theme read", () => {
    const [a, b] = (["default", "gilt"] as const).map((t) =>
      render(
        [entry(), damage, hp],
        "dm",
        <div data-theme={t}>
          <GameLog />
        </div>,
      ).replace(t, "·"),
    );
    expect(a).toBe(b ?? "");
    expect(readFileSync(join(import.meta.dir, "GameLog.tsx"), "utf8")).not.toMatch(
      /data-theme|useTheme/,
    );
  });
});

describe("FR-KIT-03 reachable", () => {
  test("FR-KIT-03 reachable: the entry actions keep their hover group (focus-within, no-hover devices); every row control present", () => {
    const body = row(
      render([entry({ supersededBy: "e9" }), entry({ id: "e9", n: 9 })], "dm"),
      "e1",
    ).body;
    for (const id of ["dice-log-entry-text", "dice-log-entry-total", "dice-log-rerolled"])
      expect(at(body, id)).toBeGreaterThanOrEqual(0);
    // The actions group is the registry's (none in this store); its classes are FR-DICE-68's.
    const src = readFileSync(join(import.meta.dir, "entry-action-button.tsx"), "utf8");
    expect(src).toMatch(
      /focus-within:opacity-100 group-hover\/entry:opacity-100[^"]*\[@media\(hover:none\)\]:opacity-100/,
    );
    expect(tag(body, "dice-log-entry-total")).toContain('tabindex="0"');
  });
});

describe("FR-KIT-04 player rows show no new fields", () => {
  test("FR-KIT-04 player rows show no new fields: a row's text is its line's, the time and its totals; a line without an actor shows no name", () => {
    // A player's side line: no actor segment (the DM's name stays out, FR-CBT-99).
    const side = entry({
      id: "e5",
      n: 5,
      kind: "cbt.side",
      rollerRole: "dm",
      rollerPlayerId: null,
      actorName: "DM",
      payload: { targetName: "Wolf", side: "ally" },
      rollIds: [],
    });
    const html = render([entry(), damage, side]);
    for (const e of [entry(), damage, side]) {
      const r = row(html, e.id);
      const visible = r.body
        .replace(/<span data-line="true" class="sr-only">[^<]*<\/span>/, "")
        .replace(/<[^>]+>/g, " ");
      const allowed = `${copyText(formatEntry(e).segments)} · ${rowTime(e.at)}`;
      for (const word of visible.split(/\s+/).filter(Boolean))
        expect(allowed).toContain(word.replace(/^·$/, "·"));
    }
    const s = row(html, "e5").body;
    expect(s).not.toContain("dice-log-entry-actor");
    expect(s).not.toContain("kit-medallion");
    expect(s).not.toMatch(/>DM</);
  });
});

describe("FR-KIT-07 slots present", () => {
  const GILT = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8");
  const KIT = GILT.slice(GILT.indexOf("/* KIT: log"));

  test("FR-KIT-07 slots present: log-row, log-what, log-time on the row, styled by gilt.css's one KIT log block", () => {
    const html = render([entry()]);
    for (const slot of ["log-row", "log-what", "log-time", "kit-medallion", "kit-result"]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
    expect(GILT.match(/\/\* KIT: log/g)?.length).toBe(1);
    for (const slot of ["log-row", "log-what", "log-time"])
      expect(KIT).toContain(`[data-slot="${slot}"]`);
  });
});
