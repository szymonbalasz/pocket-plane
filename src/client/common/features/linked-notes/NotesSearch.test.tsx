// FR-NOTES-22 search box and results, static render (N4 r1): a plain text box with only the
// kit's clear button; snippets with the matching words marked; results vs "Searching…".
import { describe, expect, test } from "bun:test";
import type { NoteSearchResponse } from "@shared/linked-notes/search";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import {
  NarrowSearchButton,
  NoteSearchBox,
  NoteSearchResults,
  SearchingLine,
  showsResults,
} from "./NotesSearch";
import type { NoteSearch } from "./search";

const html = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {node}
    </TooltipProvider>,
  );
const noop = () => {};
const page: NoteSearchResponse = {
  results: [
    {
      id: "n1",
      title: "Burnt Ledger",
      snippet: "Found in Duke Varen's office.",
      marks: [[22, 28]],
    },
    { id: "n2", title: "Duke Varen", snippet: "Keeps the ledger close.", marks: [] },
  ],
  more: false,
};
const at = (state: NoteSearch["state"], p: NoteSearchResponse | null) => ({
  page: p,
  state,
  retry: noop,
});

describe("FR-NOTES-22 notes search UI", () => {
  test("FR-NOTES-22 the box is a plain text box (no browser clear button), only the kit's ×", () => {
    const empty = html(<NoteSearchBox q="" onChange={noop} />);
    expect(empty).toContain('type="text"');
    expect(empty).not.toContain('type="search"');
    expect(empty).toContain('role="searchbox"');
    expect(empty).toContain('placeholder="Search notes…"');
    expect(empty).not.toContain("notes-search-clear");
    const typed = html(<NoteSearchBox q="duke" onChange={noop} />);
    expect(typed.match(/notes-search-clear/g)).toHaveLength(1);
  });

  test("FR-NOTES-22 snippets mark the matching words; a first-line snippet is plain", () => {
    const out = html(<NoteSearchResults search={at("ready", page)} onPick={noop} />);
    expect(out).toContain(
      'Found in Duke Varen&#x27;s <mark data-testid="notes-search-mark" class="rounded-sm bg-primary/25 px-px text-foreground">office</mark>.',
    );
    expect(out.match(/<mark/g)).toHaveLength(1);
    expect(out).toContain("Keeps the ledger close.");
  });

  test("FR-NOTES-22 typing keeps what is shown until an answer: the list with Searching…, then the last results", () => {
    // First request in flight: no results yet, the list stays, "Searching…".
    expect(showsResults("du", at("loading", null))).toBe(false);
    expect(html(<SearchingLine q="du" search={at("loading", null)} />)).toContain("Searching…");
    // Next request in flight: the last results stay up (no blank, no "No notes match").
    expect(showsResults("duk", at("loading", page))).toBe(true);
    const busy = html(<NoteSearchResults search={at("loading", page)} onPick={noop} />);
    expect(busy).toContain("Burnt Ledger");
    expect(busy).not.toContain("notes-search-empty");
    expect(html(<SearchingLine q="duk" search={at("loading", page)} />)).toBe("");
    // No query: neither.
    expect(showsResults("", at("ready", page))).toBe(false);
    expect(html(<SearchingLine q=" ' " search={at("idle", null)} />)).toBe("");
  });

  test("FR-NOTES-22 an error keeps the last results with Retry", () => {
    const out = html(<NoteSearchResults search={at("error", page)} onPick={noop} />);
    expect(out).toContain("notes-search-retry");
    expect(out).toContain("Burnt Ledger");
    expect(showsResults("x", at("error", null))).toBe(true);
  });

  test("FR-NOTES-22 narrow: the Search button has a text label, not only an icon", () => {
    const out = html(<NarrowSearchButton onClick={noop} />);
    expect(out).toMatch(/data-testid="notes-search-narrow"[^>]*>.*Search<\/button>/s);
  });
});
