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
    for (const c of ["-mx-6", "-mt-6", "border-b", "items-center", "min-h-10", "pr-12"])
      expect(bar).toContain(c);
    // The description is not inside the bar.
    const header = m.slice(at(m, "dialog-header"), m.indexOf("</div>", at(m, "dialog-header")));
    expect(header).not.toContain("dialog-description");
    expect(header).toContain("dialog-title");
    // The built-in close: after the body, top 12 px = centred in the 40 px bar; footer right-aligned.
    expect(at(m, "dialog-close")).toBeGreaterThan(at(m, "dialog-footer"));
    expect(tag(m, "dialog-close")).toMatch(/aria-label="Close"/);
    expect(tag(m, "dialog-close")).toContain("top-3");
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

describe("FR-KIT-71 every dialog titled", () => {
  test("FR-KIT-71 every dialog titled: each file with a DialogContent renders a DialogTitle (in a DialogHeader, or as its own bar)", () => {
    const sources = files(CLIENT).map((p) => ({
      file: relative(CLIENT, p).replaceAll("\\", "/"),
      text: readFileSync(p, "utf8"),
    }));
    const dialogs = sources.filter((s) => s.text.includes("<DialogContent"));
    expect(dialogs.length).toBeGreaterThan(30);
    const untitled = dialogs.filter((s) => !s.text.includes("<DialogTitle")).map((s) => s.file);
    expect(untitled).toEqual([]);
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
