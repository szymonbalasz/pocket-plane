import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { RowError } from "./RowError";

const LONG =
  "The server refused this change because the handout was edited elsewhere a moment ago.";
const client = resolve(import.meta.dir, "../../..");
const src = (file: string) => readFileSync(resolve(client, file), "utf8");

describe("full text: Party Manager row errors", () => {
  test("full text: a row error shows the whole message on its own line, wrapped, no tooltip", () => {
    const html = renderToStaticMarkup(<RowError>{LONG}</RowError>);
    expect(html).toContain(`>${LONG}</span>`);
    expect(html).toContain('role="alert"');
    expect(html).toContain("w-full basis-full break-words");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("max-w-");
    expect(html).not.toContain("title=");
    expect(html).not.toContain("data-state");
  });

  test("full text: the handout row shows its error whole and grows for it", () => {
    const menu = src("dm/features/party-board/board-window.tsx");
    expect(menu).toContain("{error && <RowError>{error}</RowError>}");
    expect(menu).not.toContain("max-w-24");
    expect(src("common/features/party-board/HandoutList.tsx")).toContain(
      "has-[[data-slot=party-row-error]]:flex-wrap",
    );
  });

  test("full text: the companion row shows its error whole and grows for it", () => {
    const menu = src("dm/features/party-board/companion-menu.tsx");
    expect(menu).toContain("<RowError>{put.error}</RowError>");
    expect(menu).not.toContain("max-w-24");
    const line = src("common/features/party-board/Companions.tsx");
    expect(line).toContain("has-[[data-slot=party-row-error]]:flex-wrap");
    expect(line).toContain("has-[[data-slot=party-row-error]]:contents");
  });
});
