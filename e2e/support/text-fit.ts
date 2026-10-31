// Does a window's text really fit? Reads the laid-out page, so a squeezed column or a word wider
// than the window shows whatever classes drew it (the DM's rule: text a person reads shows whole).
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Ordinary words split across two lines: what a squeezed column does ("Seari / ng"). A word of more
 * than `longest` characters is expected to break, so it doesn't count.
 */
export const brokenWords = (scope: Locator, longest = 24) =>
  scope.evaluate((root, longest) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const m of (n.textContent ?? "").matchAll(/[^\s\-–—/·:,]+/g)) {
        if (m[0].length > longest) continue;
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        if (new Set(rects.map((r) => Math.round(r.top))).size > 1) {
          const at = n.parentElement?.closest("[data-testid]")?.getAttribute("data-testid");
          out.push(`${m[0]} (${at ?? "?"})`);
        }
      }
    }
    return out;
  }, longest);

/** Anything drawn past the window's right edge, and any part of it that scrolls sideways. */
export const pastTheEdge = (win: Locator) =>
  win.evaluate((w) => {
    const right = w.getBoundingClientRect().right;
    const all = [...w.querySelectorAll<HTMLElement>("*")].filter(
      // A tab strip scrolls sideways on purpose (FR-SHELL-170).
      (e) =>
        e.getClientRects().length > 0 &&
        !e.closest(".sr-only, [role=tablist]") &&
        !e.querySelector(":scope > [role=tablist]"),
    );
    const name = (e: HTMLElement) => e.dataset.testid ?? e.dataset.slot ?? e.tagName;
    return {
      past: all
        .filter((e) => e.getBoundingClientRect().right > right + 1)
        .slice(0, 6)
        .map(name),
      scrolls: all
        .filter((e) => {
          const x = getComputedStyle(e).overflowX;
          return (x === "auto" || x === "scroll") && e.scrollWidth > e.clientWidth + 1;
        })
        .map((e) => `${name(e)} +${e.scrollWidth - e.clientWidth}`),
    };
  });

/** Drags the window's resize handle until it is `w` px wide (and `h` px high, if given). */
export async function resizeTo(page: Page, win: Locator, w: number, h?: number) {
  const box = await win.boundingBox();
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !handle) throw new Error("no resize handle");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  const dx = w - box.width;
  const dy = h === undefined ? 0 : h - box.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await win.boundingBox())?.width ?? 0)).toBe(w);
  if (h !== undefined) {
    await expect.poll(async () => Math.round((await win.boundingBox())?.height ?? 0)).toBe(h);
  }
}

/** Drags the window by its title bar so its top-left corner lands at (`x`, `y`). */
export async function moveTo(page: Page, win: Locator, x: number, y: number) {
  const title = await win.getByTestId("ui-window-title").boundingBox();
  const box = await win.boundingBox();
  if (!title || !box) throw new Error("no title bar");
  const grab = { x: title.x + 40, y: title.y + title.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(x + (grab.x - box.x), y + (grab.y - box.y), { steps: 5 });
  await page.mouse.up();
}

/** One DM intent over a socket of its own (hello → snapshot → intent → ack result). */
export function dmIntent(page: Page, secret: string, name: string, payload: unknown) {
  return page.evaluate(
    ([secret, name, payload]) =>
      new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; result?: unknown };
          if (f.type === "snapshot") {
            ws.send(
              JSON.stringify({ type: "intent", intentId: crypto.randomUUID(), name, payload }),
            );
          } else if (f.type === "ack") {
            ws.close();
            resolve(f.result);
          } else if (f.type === "reject" || f.type === "error") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [secret, name, payload] as const,
  );
}
