// DM Preferences (FR-SHELL-70–72, -75; FR-CAMP-35 Account): the registered window and sections,
// section owners against the specs' front matter, Log out in the Account section, and the chip
// restoring a Preferences window WF's screen-full rule auto-minimised.
import { expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyStore } from "@shared/protocol/store";
import { chipAction, prefsState } from "@ui/features/play-shell/IdentityChip";
import { launcherKinds } from "@ui/features/play-shell/layout-checks";
import {
  PREFS_KIND,
  PreferencesWindow,
  sectionIdProblems,
  shownSections,
} from "@ui/features/play-shell/PreferencesWindow";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { dmPrefSections } from "../../pref-sections";
import { LogoutContext } from "../campaign-management/AccountSection";

// The players panel pulls in the DM session (localStorage, window.location at import); no DOM
// in bun test, and the shell only needs the window definition here.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

/** Every spec's `prefix:` front matter, lowercased (FR-SHELL-75). */
function specPrefixes(): Set<string> {
  const dir = fileURLToPath(new URL("../../../../../docs/specs/", import.meta.url));
  const out = new Set<string>();
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith(".md")) continue;
    const m = /^prefix:\s*([A-Z]+)\s*$/m.exec(readFileSync(path.join(dir, f), "utf8"));
    if (m?.[1]) out.add(m[1].toLowerCase());
  }
  return out;
}

test("FR-SHELL-71 prefs window (DM): shell.prefs registered with no launcher entry, restoreOpen false, S3 numbers", () => {
  const def = dmWindows.get(PREFS_KIND);
  expect(def).toMatchObject({
    title: "Preferences",
    defaultSize: { w: 360, h: 560 },
    minOpenH: 400,
    minSize: { w: 320, h: 280 },
    defaultPosition: { anchor: "top-right", dx: 12 },
    restoreOpen: false,
  });
  expect(def?.launcher).toBeUndefined();
  expect(def?.defaultOpen).toBeFalsy();
});

test("FR-SHELL-72 sections (DM): Your colour, Dice, Layout, Account; no Sound while the DM has no alert; ids unique", () => {
  const dm = { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } } as never;
  expect(shownSections(dmPrefSections, dm).map((s) => s.id)).toEqual([
    "camp.color",
    "dicex.dice",
    "shell.layout",
    "camp.account",
  ]);
  // Before the first snapshot there is no own colour to pick.
  expect(shownSections(dmPrefSections, emptyStore()).map((s) => s.id)).not.toContain("camp.color");
  const ids = dmPrefSections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("FR-SHELL-75 section owners (DM): every id's prefix is a docs/specs front-matter prefix; no duplicate", () => {
  const prefixes = specPrefixes();
  expect(prefixes.has("shell")).toBe(true);
  expect(sectionIdProblems(dmPrefSections, prefixes)).toEqual([]);
});

test("FR-CAMP-35 account: the DM's Account section holds Log out (camp-logout), wired to the play page's logout; disabled without one", () => {
  const sync = createStore<SyncState>()(
    () => ({ state: "live", store: emptyStore() }) as unknown as SyncState,
  );
  const html = (logout: (() => void) | null) =>
    renderToStaticMarkup(
      <SyncContext.Provider value={sync}>
        <LogoutContext.Provider value={logout}>
          {/* Layout needs the shell; Account alone. */}
          <PreferencesWindow sections={dmPrefSections.filter((s) => s.id === "camp.account")} />
        </LogoutContext.Provider>
      </SyncContext.Provider>,
    );
  const tag = (s: string) => /<button[^>]*data-testid="camp-logout"[^>]*>/.exec(s)?.[0] ?? "";
  const on = html(() => {});
  expect(on).toContain('data-record-id="camp.account"');
  expect(tag(on)).not.toContain("disabled=");
  expect(on).toContain(">Log out</button>");
  expect(tag(html(null))).toContain("disabled=");
});

test("FR-SHELL-70 chip restores (DM): Preferences auto-minimised by WF's screen-full rule (FR-SHELL-47) reads minimised; a click restores it, open", () => {
  const backend = new Map<string, string>();
  const vp = { w: 1280, h: 720 };
  const c = createShellController({
    registry: dmWindows,
    storage: createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    })),
    viewport: () => vp,
  });
  c.restore("k");
  const all = new Set(dmWindows.defs.map((d) => d.kind));
  const click = () => c.dispatch(chipAction(c.store.getState().windows, all), all);
  click();
  expect(prefsState(c.store.getState().windows)).toBe("open");
  for (const kind of launcherKinds(dmWindows, all)) {
    c.dispatch({ type: "open", kind }, all);
    if (prefsState(c.store.getState().windows) === "minimised") break;
  }
  expect(prefsState(c.store.getState().windows)).toBe("minimised");
  expect(c.store.getState().autoMinimised.has(`${PREFS_KIND}:main`)).toBe(true);
  click();
  expect(prefsState(c.store.getState().windows)).toBe("open");
});
