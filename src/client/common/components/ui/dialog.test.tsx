// FR-KIT-70 / -71: a dialog is a small window: its header is a title bar flush with the top, the
// close sits in it, the description and content sit in a padded body; every dialog in both
// clients has a title. Static server render (the portal's content rendered in place).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  splitDialogClasses,
} from "./overlays";

/** `DialogContent` rendered in place of its portal. */
function dialog(children: React.ReactNode, className?: string): string {
  const portal = DialogContent({ children, className }) as React.ReactElement<{
    children: React.ReactNode;
  }>;
  return renderToStaticMarkup(<Dialog open>{portal.props.children}</Dialog>);
}

/** The opening tag of the first element with `data-slot=slot`. */
const tag = (markup: string, slot: string) =>
  new RegExp(`<\\w+[^>]*data-slot="${slot}"[^>]*>`).exec(markup)?.[0] ?? "";
/** Index of the element with `data-slot=slot`, -1 if absent. */
const at = (markup: string, slot: string) => markup.indexOf(`data-slot="${slot}"`);

/** A description a caller wraps in its own component (End encounter's `EndConfirmDescription`). */
function WrappedDescription() {
  return <DialogDescription>3 monsters still stand. Initiative clears.</DialogDescription>;
}

function Form() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit creature</DialogTitle>
      </DialogHeader>
      <form className="grid grid-cols-2 gap-3">x</form>
    </>
  );
}

describe("FR-KIT-70 dialog bar", () => {
  test("FR-KIT-70 dialog bar: the header is a bar flush with the top (title left, rule under it), the description and content in the padded body, the close centred in the bar", () => {
    const m = dialog(
      <>
        <DialogHeader>
          <DialogTitle>End “Goblin ambush”?</DialogTitle>
          <DialogDescription>Initiative clears.</DialogDescription>
        </DialogHeader>
        <p>content</p>
        <DialogFooter>
          <button type="button">Keep fighting</button>
        </DialogFooter>
      </>,
    );
    const content = tag(m, "dialog-content");
    expect(content).toContain("max-w-md");
    expect(content).not.toMatch(/\bp-6\b/);
    // Body (padded) holds the bar first, then the description, the content and the footer.
    expect(tag(m, "dialog-body")).toMatch(/class="gap-4 p-6 grid"/);
    const order = [
      "dialog-body",
      "dialog-header",
      "dialog-title",
      "dialog-description",
      "dialog-footer",
    ];
    const idx = order.map((s) => at(m, s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // The bar cancels the body's padding: flush with the top and both sides, a rule under it.
    const bar = tag(m, "dialog-header");
    for (const c of ["-mx-6", "-mt-6", "border-b", "items-center", "min-h-10", "pl-6", "pr-4"])
      expect(bar).toContain(c);
    // The description is not inside the bar.
    const header = m.slice(at(m, "dialog-header"), m.indexOf("</div>", at(m, "dialog-header")));
    expect(header).not.toContain("dialog-description");
    expect(header).toContain("dialog-title");
    // The built-in × is the bar's last item (a flex item of an `items-center` bar: centred for any
    // title height, re-test #2), after the title; the corner × is hidden while a bar exists.
    const closes = [...m.matchAll(/<button[^>]*data-slot="dialog-close"[^>]*>/g)].map((x) => x[0]);
    expect(closes).toHaveLength(2);
    expect(header.indexOf("dialog-close")).toBeGreaterThan(header.indexOf("dialog-title"));
    expect(closes[0]).toMatch(/aria-label="Close"/);
    expect(closes[0]).toContain("ml-auto shrink-0");
    expect(closes[0]).not.toContain("absolute");
    expect(closes[1]).toContain(
      "[[data-slot=dialog-content]:has([data-slot=dialog-header])&gt;&amp;]:hidden",
    );
    expect(at(m, "dialog-footer")).toBeLessThan(m.lastIndexOf('data-slot="dialog-close"'));
    expect(tag(m, "dialog-footer")).toContain("justify-end");
  });

  test("FR-KIT-70 dialog bar: a header rendered by a form component is a bar too; a caller's flex column carries on in the body", () => {
    const m = dialog(<Form />, "flex max-h-[85vh] flex-col sm:max-w-md");
    expect(tag(m, "dialog-header")).toContain("-mt-6");
    expect(tag(m, "dialog-body")).toContain("flex min-h-0 flex-1 flex-col");
    expect(tag(m, "dialog-content")).toContain("flex-col");
  });

  test("FR-KIT-70 dialog bar: a title outside a header makes its own bar; a screen-reader-only title (image lightbox) none", () => {
    const own = dialog(
      <>
        <DialogTitle>Delete Goblin?</DialogTitle>
        <DialogDescription>Gone for good.</DialogDescription>
      </>,
    );
    expect(at(own, "dialog-header")).toBeGreaterThan(-1);
    expect(at(own, "dialog-header")).toBeLessThan(at(own, "dialog-title"));
    expect(tag(own, "dialog-header")).toContain("-mt-6");
    const sr = dialog(<DialogTitle className="sr-only">Goblin</DialogTitle>);
    expect(at(sr, "dialog-header")).toBe(-1);
    expect(at(sr, "dialog-title")).toBeGreaterThan(-1);
  });

  test("FR-KIT-70 dialog bar: the bar holds only the title; a description a caller wraps in its own component goes under the bar, in the body (End encounter)", () => {
    const m = dialog(
      <>
        <DialogHeader>
          <DialogTitle>End “Goblin ambush”?</DialogTitle>
          <WrappedDescription />
        </DialogHeader>
        <DialogFooter>f</DialogFooter>
      </>,
    );
    const start = at(m, "dialog-header");
    const bar = m.slice(start, m.indexOf("</div>", start));
    expect(bar).toContain("dialog-title");
    expect(bar).not.toContain("dialog-description");
    expect(bar).not.toContain("monsters");
    // Description after the bar, before the footer, inside the body.
    expect(at(m, "dialog-description")).toBeGreaterThan(start);
    expect(at(m, "dialog-description")).toBeLessThan(at(m, "dialog-footer"));
    expect(at(m, "dialog-description")).toBeGreaterThan(at(m, "dialog-body"));
  });

  test("FR-KIT-70 dialog bar: a caller's padding and gap replace the body's own, so a chrome-less image lightbox keeps its size (no 24 px band)", () => {
    expect(splitDialogClasses("w-auto max-w-[90vw] p-4 pt-10")).toEqual({
      frame: "w-auto max-w-[90vw]",
      body: "p-4 pt-10",
    });
    expect(
      splitDialogClasses("flex max-h-[90vh] sm:max-w-md gap-3 sm:p-2 pointer-events-auto"),
    ).toEqual({
      frame: "flex max-h-[90vh] sm:max-w-md pointer-events-auto",
      body: "gap-3 sm:p-2",
    });
    // The lightbox as main drew it: the frame has no padding of its own, the body is p-4 pt-10.
    const m = dialog(
      <DialogTitle className="sr-only">Goblin</DialogTitle>,
      "w-auto max-w-[90vw] p-4 pt-10",
    );
    expect(tag(m, "dialog-content")).not.toMatch(/\bp[tblrxy]?-\d/);
    const body = tag(m, "dialog-body");
    expect(body).toContain("p-4 pt-10");
    expect(body).not.toContain("p-6");
    expect(at(m, "dialog-header")).toBe(-1);
  });

  test("FR-KIT-70 dialog bar: a layer above the shell (zIndex) reaches the overlay and the content", () => {
    const portal = DialogContent({ children: "x", zIndex: 1_000_000_000 }) as React.ReactElement<{
      children: React.ReactNode;
    }>;
    const m = renderToStaticMarkup(<Dialog open>{portal.props.children}</Dialog>);
    expect(tag(m, "dialog-overlay")).toContain("z-index:1000000000");
    expect(tag(m, "dialog-content")).toContain("z-index:1000000000");
  });
});

// ---- FR-KIT-71 ----

const CLIENT = join(import.meta.dir, "../../..");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}
/** Dialogs whose only title is screen-reader-only, with the reason (they draw no bar). */
const SR_ONLY_TITLE: Record<string, string> = {
  "common/features/compendium/gallery.tsx": "image lightbox: the picture is the content",
};
/** Raw Radix dialogs outside the Dialog parts (no title bar), with the reason. */
const RAW_RADIX: Record<string, string> = {
  "common/features/pause/PauseControl.tsx": "pause card preview: the card itself, chrome-less",
  "common/features/play-shell/palette/Palette.tsx": "command palette: a search field, no window",
  "common/features/play-shell/palette/ShortcutsSheet.tsx": "shortcut sheet over the palette",
};

describe("FR-KIT-71 every dialog titled", () => {
  test("FR-KIT-71 every dialog titled: each file with a DialogContent renders a DialogTitle (in a DialogHeader, or as its own bar)", () => {
    const sources = files(CLIENT).map((p) => ({
      file: relative(CLIENT, p).replaceAll("\\", "/"),
      text: readFileSync(p, "utf8"),
    }));
    const dialogs = sources.filter((s) => s.text.includes("<DialogContent"));
    expect(dialogs.length).toBeGreaterThan(30);
    // A title is a `<DialogTitle>` element or the component handed to a part (`TitleAs`).
    const untitled = dialogs
      .filter((s) => !/<DialogTitle\b|=\{DialogTitle\}/.test(s.text))
      .map((s) => s.file);
    expect(untitled).toEqual([]);
    // The player's present popup is on the Dialog parts now (title bar + close gem).
    const present = sources.find(
      (s) => s.file === "player/features/party-board/present-popup.tsx",
    )?.text;
    expect(present).toContain("<DialogContent");
    expect(present).toContain("TitleAs={DialogTitle}");
    // Every other dialog goes through the parts: raw Radix dialogs only where listed.
    const raw = sources
      .filter((s) => !s.file.startsWith("common/components/ui/"))
      .filter((s) => /import \{[^}]*\bDialog as \w+[^}]*\} from "radix-ui"/.test(s.text))
      .map((s) => s.file);
    expect(raw.sort()).toEqual(Object.keys(RAW_RADIX).sort());
    // A title the reader can't see draws no bar: only the listed ones.
    const srOnly = sources
      .filter((s) => /<DialogTitle[^>]*className="[^"]*\bsr-only\b/.test(s.text))
      .map((s) => s.file);
    expect(srOnly.sort()).toEqual(Object.keys(SR_ONLY_TITLE).sort());
    // Headers carry a title (Radix's a11y rule): every DialogHeader opens onto a DialogTitle.
    const headless = sources.flatMap((s) =>
      [...s.text.matchAll(/<DialogHeader>\s*(<\w+)/g)]
        .filter((m) => m[1] !== "<DialogTitle")
        .map(() => s.file),
    );
    expect(headless).toEqual([]);
  });
});
