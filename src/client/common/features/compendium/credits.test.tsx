// FR-CMP-19 (S4) / FR-ENT-29: the Credits link in the Compendium list view (both clients, also
// with nothing imported), the About dialog's body (source attribution + "Token art": 14 icons,
// Lorc / Delapouite, CC BY 3.0, game-icons.net) and how Credits finds the imported sources.
import { describe, expect, test } from "bun:test";
import type { SearchResponse, SourceAttribution } from "@shared/compendium/rest";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { Api } from "../../api";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { CompendiumBody } from "./CompendiumWindow";
import { AboutBody, sourceProbes } from "./credits";
import type { Role } from "./logic";
import { resetCmpNav } from "./nav";

const SRD: SourceAttribution = {
  key: "srd-5.1",
  name: "SRD 5.1",
  licence: "CC BY 4.0",
  attribution: "This work includes material taken from the System Reference Document 5.1.",
  url: "https://api.open5e.com/",
  version: "mini",
};

function store(role: Role) {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

const render = (role: Role, node: ReactNode) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store(role)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("FR-ENT-29 licence credits", () => {
  test("FR-CMP-19 Credits link in the list view footer, DM and player, before anything loads", () => {
    for (const role of ["dm", "player"] as const) {
      resetCmpNav();
      const html = render(role, <CompendiumBody api={{} as Api} viewer={role} />);
      expect(html).toContain('data-testid="cmp-credits"');
      expect(text(html)).toContain("Credits");
    }
  });

  test("FR-ENT-29 About body: 'Token art' with the 14 icons, Lorc / Delapouite, CC BY 3.0, game-icons.net", () => {
    const html = render("player", <AboutBody sources={[]} />);
    expect(html).toContain('data-testid="cmp-about-token-art"');
    expect(html.match(/data-testid="cmp-about-token-art-row"/g)).toHaveLength(14);
    const t = text(html);
    for (const s of ["Token art", "Lorc", "Delapouite", "CC BY 3.0", "game-icons.net"]) {
      expect(t).toContain(s);
    }
    expect(t).toContain("Humanoid: visored-helm (Lorc)");
    expect(t).toContain("Giant: giant (Delapouite)");
    expect(html).toContain('href="https://game-icons.net/1x1/lorc/dread-skull.html"');
    // Nothing imported: no source section.
    expect(html).not.toContain("cmp-about-source");
  });

  test("FR-CMP-19 About body with an imported source: its attribution beside the token art", () => {
    const html = render("dm", <AboutBody sources={[SRD]} />);
    expect(html).toContain('data-testid="cmp-about-source" data-record-id="srd-5.1"');
    expect(text(html)).toContain("System Reference Document 5.1");
    expect(html.indexOf("cmp-about-source")).toBeLessThan(html.indexOf("cmp-about-token-art"));
  });

  test("FR-CMP-19 Credits reads one entry per imported source label; homebrew has none", () => {
    const row = (id: string, sourceLabel: string) => ({
      id,
      kind: "spell" as const,
      name: id,
      sourceLabel,
      line: "",
    });
    const page: SearchResponse = {
      results: [row("h1", "Homebrew"), row("a", "SRD 5.1"), row("b", "SRD 5.1"), row("c", "X")],
      nextCursor: null,
    };
    expect(sourceProbes(page)).toEqual(["a", "c"]);
    expect(sourceProbes({ results: [row("h1", "Homebrew")], nextCursor: null })).toEqual([]);
  });
});
