// FR-NOTE-50 (sprint 8, WF4): one stack per client. While the notifications runtime claims the
// toast region, sonner's own Toaster isn't rendered (its toasts show in the stack's alert class);
// before the shell (nothing claims it) the Toaster is the region's fallback.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { claimToastStack, ShellToaster } from "./ShellToaster";

const html = () => {
  const g = globalThis as { window?: unknown };
  g.window = { innerWidth: 1440, innerHeight: 900 };
  try {
    return renderToStaticMarkup(<ShellToaster client="dm" />);
  } finally {
    delete g.window;
  }
};

describe("FR-NOTE-50 toast policy", () => {
  test("FR-NOTE-50 toast policy: sonner's Toaster renders only while no stack claims the region; the claim is released once", () => {
    const sonner = /aria-label="Notifications alt\+T"/;
    expect(html()).toMatch(sonner);
    const release = claimToastStack();
    const second = claimToastStack();
    try {
      expect(html()).not.toMatch(sonner);
      release();
      release(); // idempotent
      expect(html()).not.toMatch(sonner);
    } finally {
      second();
    }
    expect(html()).toMatch(sonner);
    expect(html()).toContain('data-testid="ui-roll-popups"');
  });
});
