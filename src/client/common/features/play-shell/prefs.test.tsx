// Preferences window and identity chip (FR-SHELL-70–76): the chip and sections as static renders
// over a fake sync store (no DOM in bun test), the click / reset / storage rules through the
// real shell and alert controllers on in-memory storage.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layoutKey } from "@shared/play-shell/layout";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { SoundControls, soundSection } from "./AlertLayer";
import {
  type AlertController,
  createAlertController,
  createTitleMarker,
  speakerState,
} from "./alerts";
import { type AudioContextLike, createAudioEngine } from "./audio";
import { ChipView, chipAction, chipTip, IdentityChip, prefsState } from "./IdentityChip";
import { defaultLayout } from "./manager";
import { PlayFrame } from "./PlayFrame";
import {
  definePrefSection,
  layoutSection,
  PREFS_KIND,
  PreferencesWindow,
  type PrefSection,
  prefsWindow,
  sectionIdProblems,
  shownSections,
} from "./PreferencesWindow";
import { createWindowRegistry, defineWindow, type ShellClient } from "./registry";
import { ShellProvider } from "./ShellContext";
import { createShellController } from "./shell-store";
import { createSoundSettingsStorage, soundKey } from "./sound-settings";
import { createLayoutStorage, type StorageBackend } from "./storage";

// The shell reads the viewport, its title marker takes `document`: stubs suffice for a static render.
const g = globalThis as { window?: unknown; document?: unknown };
beforeAll(() => {
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  };
  // The launcher measures labels on a canvas: none here (it falls back to estimates).
  g.document = { title: "", hidden: false, createElement: () => ({ getContext: () => null }) };
});
afterAll(() => {
  delete g.window;
  delete g.document;
});

const VP = { w: 1440, h: 900 };
const JADE = "#3fb68b";
const AMBER = "#e69f00";

function memoryBackend(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const backend: StorageBackend = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { data, backend };
}

/** Stub Web Audio context (the surface `ping` uses), already running. */
function runningAudio(): AudioContextLike {
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const node = { connect() {} };
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    resume: async () => {},
    createOscillator: () => ({ ...node, type: "sine", frequency: param, start() {}, stop() {} }),
    createGain: () => ({ ...node, gain: param }),
  };
  // Structural stub; not a full AudioContext.
  return ctx as unknown as AudioContextLike;
}

function alerts(backend: StorageBackend) {
  return createAlertController({
    audio: createAudioEngine({ create: runningAudio }),
    storage: createSoundSettingsStorage(() => backend),
    toast: () => {},
    title: createTitleMarker({ hidden: false, title: "Pocket Plane" }),
  });
}

/** The Sound section at the controller's current state (a static render reads no live store). */
function Sound({ controller }: { controller: AlertController }) {
  const s = controller.store.getState();
  return <SoundControls settings={s.settings} state={speakerState(s)} controller={controller} />;
}

/** A launcher window beside Preferences, so "on top" and "behind" can be told apart. */
const other = defineWindow({
  kind: "cmp.other",
  title: "Other",
  clients: ["dm", "player"],
  defaultSize: { w: 300, h: 300 },
  minSize: { w: 200, h: 200 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: () => null, label: "Other", order: 1 },
  component: () => null,
});

const registryOf = (client: ShellClient) =>
  createWindowRegistry(client, [other, prefsWindow(client, [layoutSection])]);

function shell(client: ShellClient = "player", backend = memoryBackend().backend) {
  const registry = registryOf(client);
  const c = createShellController({
    registry,
    storage: createLayoutStorage(() => backend),
    viewport: () => VP,
  });
  c.restore(layoutKey("c1", client === "dm" ? { role: "dm" } : { playerId: "p1" }));
  const all = new Set(registry.defs.map((d) => d.kind));
  const click = () => c.dispatch(chipAction(c.store.getState().windows, all), all);
  const prefs = () => c.store.getState().windows.find((w) => w.kind === PREFS_KIND);
  return { c, all, click, prefs, registry };
}

function storeFor(client: ShellClient): RecordStore {
  const you =
    client === "dm"
      ? { campaignId: "c1", role: "dm" as const, playerId: null }
      : { campaignId: "c1", role: "player" as const, playerId: "p1" };
  return {
    ...emptyStore(),
    you,
    records: {
      campaign: { c1: { id: "c1", name: "Fixture Campaign", dmColor: AMBER } },
      player: { p1: { id: "p1", campaignId: "c1", name: "Player 1", color: JADE } },
    },
  } as RecordStore;
}

function render(client: ShellClient, node: React.ReactNode) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: storeFor(client),
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ShellProvider registry={registryOf(client)}>{node}</ShellProvider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** The opening tag of the first element with `testId`. */
const tagOf = (html: string, testId: string) =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";

describe("identity chip", () => {
  test("FR-SHELL-70 chip opens Preferences (DM + player): dot = colorOf(you) in data-color, name, closed; players carry the sound state, the DM none; a click opens with by user, on top closes, behind fronts", () => {
    const dm = render("dm", <IdentityChip client="dm" />);
    expect(tagOf(dm, "ui-prefs-chip-dot")).toContain(`data-color="${AMBER}"`);
    expect(tagOf(dm, "ui-prefs-open")).toContain('data-state="closed"');
    expect(tagOf(dm, "ui-prefs-open")).not.toContain("data-sound-state");
    expect(dm).toContain(">DM</span>");
    const player = render("player", <IdentityChip client="player" />);
    expect(tagOf(player, "ui-prefs-chip-dot")).toContain(`data-color="${JADE}"`);
    expect(player).toContain(">Player 1</span>");
    // No interaction yet: audio locked (FR-SHELL-25).
    expect(tagOf(player, "ui-prefs-open")).toContain('data-sound-state="locked"');
    expect(tagOf(player, "ui-prefs-open")).toContain(
      'aria-label="Preferences · click anywhere to enable sounds"',
    );

    // Muted (or volume 0): the volume-x glyph after the name.
    const muted = renderToStaticMarkup(
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ChipView name="Player 1" color={JADE} state="closed" sound="muted" />
      </TooltipProvider>,
    );
    expect(tagOf(muted, "ui-prefs-open")).toContain('data-sound-state="muted"');
    expect(muted).toContain('data-testid="ui-prefs-chip-sound"');
    expect(muted).toContain("lucide-volume-x");
    const on = renderToStaticMarkup(
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ChipView name="Player 1" color={JADE} state="open" sound="on" />
      </TooltipProvider>,
    );
    expect(on).not.toContain("ui-prefs-chip-sound");
    expect(chipTip("on")).toBe("Preferences");
    expect(chipTip("muted")).toBe("Preferences · sound muted");
    expect(chipTip(null)).toBe("Preferences");

    // Clicks: closed → open (user); on top → closed; behind another window → front.
    const s = shell();
    expect(prefsState(s.c.store.getState().windows)).toBe("closed");
    expect(chipAction([], s.all)).toEqual({ type: "open", kind: PREFS_KIND, by: "user" });
    s.click();
    expect(prefsState(s.c.store.getState().windows)).toBe("open");
    s.c.dispatch({ type: "open", kind: "cmp.other" }, s.all);
    s.click(); // behind Other → front, still open
    expect(s.prefs()?.state).toBe("open");
    const z = s.c.store.getState().windows.find((w) => w.kind === "cmp.other")?.z ?? 0;
    expect(s.prefs()?.z ?? 0).toBeGreaterThan(z);
    s.click(); // on top → closed
    expect(prefsState(s.c.store.getState().windows)).toBe("closed");
  });

  test("FR-SHELL-70 chip restores: minimised from its title bar → data-state minimised; a click restores it at the same rect, open", () => {
    const s = shell();
    s.click();
    const rect = { ...s.prefs() };
    s.c.dispatch({ type: "minimise", kind: PREFS_KIND }, s.all);
    expect(prefsState(s.c.store.getState().windows)).toBe("minimised");
    s.click();
    const w = s.prefs();
    expect(w?.state).toBe("open");
    expect({ x: w?.x, y: w?.y, w: w?.w, h: w?.h }).toEqual({
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
    });
  });

  test("FR-SHELL-70 the frame: chip at the far right of a 48-px top bar in both clients; no speaker (ui-sound-button) anywhere", () => {
    for (const client of ["dm", "player"] as const) {
      const html = render(client, <PlayFrame client={client} topLeft={<span>left</span>} />);
      const bar = /<header[^>]*data-testid="ui-topbar"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
      expect(tagOf(bar, "ui-topbar")).toContain("height:48px");
      expect(bar).toContain('data-testid="ui-prefs-open"');
      // After the connection indicator.
      expect(bar.indexOf("sync-connection-status")).toBeLessThan(bar.indexOf("ui-prefs-open"));
      expect(html).not.toContain("ui-sound-button");
      expect(html).not.toContain("camp-logout");
    }
  });
});

// Kit-parity §6.2 (K5): the top bar's three zones, the status pill and the launcher in the centre.
describe("kit-parity top bar", () => {
  const bar = (client: ShellClient, status?: React.ReactNode) => {
    const html = render(
      client,
      <PlayFrame client={client} topLeft={<span>title</span>} topStatus={status} />,
    );
    return /<header[^>]*data-testid="ui-topbar"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  };
  const at = (html: string, testId: string) => html.indexOf(`data-testid="${testId}"`);

  test("FR-KIT-10 bar zones: left = the title, centre = the launcher, right = status, items, chip (order kept); same in both clients", () => {
    for (const client of ["dm", "player"] as const) {
      const html = bar(client);
      const order = [
        "ui-topbar-left",
        "ui-topbar-centre",
        "ui-launcher",
        "ui-topbar-right",
        "ui-topbar-status",
        "sync-connection-status",
        "ui-prefs-open",
      ].map((id) => at(html, id));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(tagOf(html, "ui-topbar")).toContain("height:48px");
      // The title zone is capped so the launcher keeps room; the right cluster never shrinks.
      expect(tagOf(html, "ui-topbar-left")).toContain("max-width:30%");
      expect(tagOf(html, "ui-topbar-right")).toContain("shrink-0");
      expect(tagOf(html, "ui-topbar-centre")).toContain("flex-1");
      // The "⋯" menu (Reset layout) always fits: the title shrinks first.
      expect(tagOf(html, "ui-topbar-centre")).toContain("min-width:66px");
    }
  });

  test('FR-KIT-13 status pill: one group (`ui-topbar-status`, slot `topbar-status`): a dot and "Live" (`sync-connection-status`, data-state kept), then the DM\'s presence part', () => {
    const presence = (
      <button type="button" data-testid="ui-presence-badge">
        0/2 online
      </button>
    );
    const html = bar("dm", presence);
    const pill = /<div[^>]*data-testid="ui-topbar-status"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(tagOf(html, "ui-topbar-status")).toContain('data-slot="topbar-status"');
    expect(tagOf(pill, "sync-connection-status")).toContain('data-state="live"');
    expect(pill.replace(/<[^>]+>/g, "")).toBe("Live0/2 online");
    expect(at(pill, "sync-connection-status")).toBeLessThan(at(pill, "ui-presence-badge"));
    // Players: the connection part only.
    const player = bar("player");
    expect(player).not.toContain("ui-presence-badge");
    expect(tagOf(player, "ui-topbar-status")).not.toBe("");
  });

  test("FR-KIT-14 launcher in the top bar: in the centre zone, not at the bottom; the bar's own frame is gone (no fill, no shadow)", () => {
    for (const client of ["dm", "player"] as const) {
      const html = bar(client);
      const centre = html.slice(at(html, "ui-topbar-centre"), at(html, "ui-topbar-right"));
      expect(centre).toContain('data-testid="ui-launcher"');
      const nav = tagOf(html, "ui-launcher");
      expect(nav).not.toMatch(/\b(absolute|bottom-3|shadow-lg|bg-background\/85)\b/);
    }
  });

  test("FR-KIT-13 K13 identity chip: the kit's framed stone chip (outline, 30 px, 14-px body text), the dot, the name and the gear inside", () => {
    const dm = render("dm", <IdentityChip client="dm" />);
    const chip = tagOf(dm, "ui-prefs-open");
    expect(chip).toContain('data-variant="outline"');
    expect(chip).toContain("h-[30px] gap-[7px] px-2.5 text-sm font-normal");
    const inner = dm.slice(dm.indexOf('data-testid="ui-prefs-open"'));
    const order = ["ui-prefs-chip-dot", ">DM<", "lucide-settings"].map((x) => inner.indexOf(x));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("FR-KIT-13 K13 status: plain muted 13-px text as the kit's `.live` (no pill frame); the red-gem unread badge slot", () => {
    const status = tagOf(bar("dm"), "ui-topbar-status");
    expect(status).toContain("text-[13px]");
    expect(status).toContain("text-muted-foreground");
    for (const pill of ["rounded-full", "border", "px-2.5", "h-6"])
      expect(status).not.toContain(pill);
    // The badge keeps its count and test ID; a theme draws it from its slot (Gilt & Stone: a gem).
    const src = readFileSync(join(import.meta.dir, "Launcher.tsx"), "utf8");
    expect(src).toMatch(/-launcher-badge`\}\s+data-count=\{badge\}\s+data-slot="launcher-badge"/);
    const gilt = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8");
    const block = gilt.slice(gilt.indexOf("/* KIT: round 3"));
    expect(block).toContain('[data-slot="launcher-badge"]::before');
    expect(block).toMatch(/rotate: 45deg;[\s\S]*var\(--gem\)/);
  });
});

describe("Preferences window", () => {
  test("FR-SHELL-71 prefs window: shell.prefs, no launcher, restoreOpen false, 360 × 560, minOpenH 400, min 320 × 280, top-right dx 12; a stored-open entry loads closed", () => {
    const def = prefsWindow("player", []);
    expect(def).toMatchObject({
      kind: "shell.prefs",
      title: "Preferences",
      clients: ["player"],
      defaultSize: { w: 360, h: 560 },
      minOpenH: 400,
      minSize: { w: 320, h: 280 },
      defaultPosition: { anchor: "top-right", dx: 12 },
      restoreOpen: false,
    });
    expect(def.launcher).toBeUndefined();
    expect(def.defaultOpen).toBeFalsy();
    const { backend } = memoryBackend();
    const a = shell("player", backend);
    a.click();
    expect(a.prefs()?.state).toBe("open");
    const b = shell("player", backend); // a reload on the same browser storage
    expect(b.prefs()?.state ?? "closed").toBe("closed");
  });

  test("FR-SHELL-72 sections: stacked in order with a heading each; available false → not rendered", () => {
    const mk = (id: string, order: number, available?: () => boolean): PrefSection =>
      definePrefSection({ id, title: id, order, available, Component: () => <i>{id}</i> });
    const sections = [
      mk("shell.layout", 80),
      mk("camp.color", 10),
      mk("dicex.dice", 30, () => false),
      mk("shell.sound", 20),
    ];
    expect(shownSections(sections, emptyStore()).map((s) => s.id)).toEqual([
      "camp.color",
      "shell.sound",
      "shell.layout",
    ]);
    // A throwing `available` hides the section (logged), never the window.
    const quiet = console.warn;
    console.warn = () => {};
    try {
      const bad = mk("cbt.bad", 5, () => {
        throw new Error("boom");
      });
      expect(shownSections([bad], emptyStore())).toEqual([]);
    } finally {
      console.warn = quiet;
    }
    const html = render("player", <PreferencesWindow sections={sections} />);
    const ids = [...html.matchAll(/data-testid="ui-prefs-section" data-record-id="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids).toEqual(["camp.color", "shell.sound", "shell.layout"]);
    expect(html).toContain('data-testid="ui-prefs-window"');
    expect(html).toContain(">shell.sound</h3>");
    expect(html).not.toContain("dicex.dice");
  });

  test("FR-SHELL-73 sound moved: an existing pp.sound.v1 entry {muted, 40} shows in the section; Mute off → the next alert plays; volume persisted; Test plays ping; locked hint while locked", () => {
    const key = soundKey("c1", "p1");
    const { data, backend } = memoryBackend({ [key]: JSON.stringify({ muted: true, volume: 40 }) });
    const c = alerts(backend);
    c.setOwner(key);
    c.unlock(); // the click that opened Preferences (FR-SHELL-25)
    const html = renderToStaticMarkup(<Sound controller={c} />);
    expect(tagOf(html, "ui-sound-mute")).toContain('aria-checked="true"');
    expect(tagOf(html, "ui-sound-volume")).toContain('data-value="40"');
    expect(html).toContain('data-testid="ui-sound-test"');
    expect(speakerState(c.store.getState())).toBe("muted");
    c.alert({ id: "shell.test", title: "Test alert", sound: "ping" });
    expect(c.store.getState().lastSound).toBe("ping:muted:1");
    c.setSettings({ muted: false }); // the section's Switch
    c.alert({ id: "shell.test", title: "Test alert", sound: "ping" });
    expect(c.store.getState().lastSound).toBe("ping:played:2");
    expect(JSON.parse(data.get(key) ?? "")).toEqual({ muted: false, volume: 40 });
    const again = alerts(backend); // remount: the same key, read again
    again.setOwner(key);
    expect(again.store.getState().settings).toEqual({ muted: false, volume: 40 });
    expect(c.test()).toBe("played");
    expect(soundSection).toMatchObject({ id: "shell.sound", title: "Sound", order: 20 });

    // Locked (no interaction yet): the hint; unlocked: none.
    const locked = createAlertController({
      audio: createAudioEngine({ create: () => null }),
      storage: createSoundSettingsStorage(() => memoryBackend().backend),
      toast: () => {},
      title: createTitleMarker({ hidden: false, title: "" }),
    });
    expect(renderToStaticMarkup(<Sound controller={locked} />)).toContain(
      "Click anywhere to enable sounds",
    );
    expect(renderToStaticMarkup(<Sound controller={c} />)).not.toContain(
      "Click anywhere to enable sounds",
    );
  });

  test("FR-SHELL-74 reset from Preferences: the default layout written, shell.prefs closed", () => {
    for (const client of ["dm", "player"] as const) {
      const { data, backend } = memoryBackend();
      const s = shell(client, backend);
      s.click();
      s.c.dispatch({ type: "open", kind: "cmp.other" }, s.all);
      expect(s.prefs()?.state).toBe("open");
      s.c.dispatch({ type: "reset" }, s.all); // the section's Reset layout Button
      expect(s.prefs()?.state ?? "closed").toBe("closed");
      expect(s.c.store.getState().windows).toEqual(defaultLayout(s.registry, VP));
      const key = layoutKey("c1", client === "dm" ? { role: "dm" } : { playerId: "p1" });
      expect(JSON.parse(data.get(key) ?? "{}").windows).toEqual([]);
    }
    const html = render("dm", <PreferencesWindow sections={[layoutSection]} />);
    expect(html).toContain('data-testid="ui-prefs-reset-layout"');
    expect(html).toContain(
      "Puts every window back where it starts and forgets where you moved them.",
    );
  });

  test("FR-SHELL-75 section owners: a fake zzz.test entry fails, a duplicate id fails, a bad id fails", () => {
    const prefixes = new Set(["shell", "camp"]);
    const mk = (id: string) =>
      definePrefSection({ id, title: id, order: 1, Component: () => null });
    expect(sectionIdProblems([mk("shell.sound"), mk("camp.account")], prefixes)).toEqual([]);
    expect(sectionIdProblems([mk("zzz.test")], prefixes)).toEqual([
      'zzz.test: unknown spec prefix "zzz"',
    ]);
    expect(sectionIdProblems([mk("shell.sound"), mk("shell.sound")], prefixes)).toEqual([
      "shell.sound: registered twice",
    ]);
    expect(sectionIdProblems([mk("Sound")], prefixes)).toEqual(["Sound: not <prefix>.<name>"]);
  });

  test("FR-SHELL-76 no new keys: open Preferences, change sound, reset layout → every browser key is a known prefix", () => {
    const { data, backend } = memoryBackend();
    const s = shell("player", backend);
    const c = alerts(backend);
    c.setOwner(soundKey("c1", "p1"));
    s.click();
    c.setSettings({ volume: 40 });
    c.setSettings({ muted: true });
    s.c.dispatch({ type: "reset" }, s.all);
    const known = ["pp.sound.v1.", "pp.dicex.v2.", "pp.layout.v1."];
    expect([...data.keys()].filter((k) => !known.some((p) => k.startsWith(p)))).toEqual([]);
    expect(data.size).toBe(2);
  });
});
