// FR-CMP-19 (S4) / FR-ENT-29: the Credits link in the Compendium list view (both clients, also
// with nothing imported), the About dialog's body (source attribution + "Token art": 14 icons,
// Lorc / Delapouite, CC BY 3.0, game-icons.net) and how Credits finds the imported sources.
import { describe, expect, test } from "bun:test";
import type { AppType } from "@server/app";
import type { SourceAttribution } from "@shared/compendium/rest";
import { emptyStore } from "@shared/protocol/store";
import { hc } from "hono/client";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { Api } from "../../api";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { CompendiumBody } from "./CompendiumWindow";
import { AboutBody, fetchCreditSources } from "./credits";
import type { Role } from "./logic";
import { resetCmpNav } from "./nav";
import { eagerApi } from "./search";

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

  test("FR-CMP-19 FR-CMPX-18 Credits reads the sources from one call: every book, no search or entry reads", async () => {
    const urls: URL[] = [];
    const book: SourceAttribution = {
      key: "5et-mm",
      name: "Monster Manual",
      licence: "User-supplied (5etools)",
      attribution: "Monster Manual — © Wizards of the Coast.",
      url: null,
      version: "v",
      abbr: "MM",
    };
    const fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      urls.push(url);
      return Response.json({ sources: [SRD, book] });
    }) as typeof globalThis.fetch;
    const api = hc<AppType>("http://127.0.0.1:1", { fetch }) as Api;
    expect(await fetchCreditSources(eagerApi(api))).toEqual([SRD, book]);
    expect(urls.map((u) => u.pathname)).toEqual(["/api/compendium/credits"]);
  });

  test("FR-CMPX-18 About lists a book's credit", () => {
    const html = render(
      "dm",
      <AboutBody
        sources={[
          {
            ...SRD,
            key: "5et-mm",
            name: "Monster Manual",
            licence: "User-supplied (5etools)",
            attribution:
              "Monster Manual — © Wizards of the Coast. Read from your own 5etools files for use at your table.",
            url: null,
          },
        ]}
      />,
    );
    expect(html).toContain('data-testid="cmp-about-source" data-record-id="5et-mm"');
    expect(text(html)).toContain("Read from your own 5etools files for use at your table.");
    expect(html).not.toContain("cmp-about-rules");
  });
});
