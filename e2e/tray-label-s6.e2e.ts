// e2e-bundle: session-sim-9
// Thin sprint-6 fixes for the dice tray and kept templates (track WF; play-shell §13 F11, F12).
// WF5: the tray keeps Roll visible at its min size with dice staged, 12 d6 included
// (FR-DICEX-53, -54); the real part heights match the pure layout's budget. WF6: Player 1
// hovers Player 2's kept Thunderwave (its area, then its label pill, then away) and reads
// "· by Player 2" only while hovered, the grown pill keeping it (FR-SCN-52). The only intent:
// the DM shows Goblin Ambush to players (as combat-trails does).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { gridPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/**
 * sim-9 presents a handout to Player 1 (P0 h2): close its popup when it shows (once per player,
 * so only on the file's first visit; it arrives with the snapshot, so after live).
 */
async function closePresented(page: Page) {
  const dialog = page.getByRole("dialog");
  await page.waitForTimeout(500);
  if ((await dialog.count()) === 0) return;
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** FR-DICEX-53's testable outcome, read from the real layout. */
const trayFacts = (win: Locator) =>
  win.evaluate((w) => {
    const roll = w.querySelector<HTMLElement>(
      '[data-testid="dicex-tray-roll"], [data-testid="dicex-tray-again"]',
    );
    const tray = w.querySelector<HTMLElement>('[data-testid="dicex-tray"]');
    const area = w.querySelector<HTMLElement>('[data-testid="dicex-tray-area"]');
    if (!roll || !tray || !area) throw new Error("tray parts missing");
    const wr = w.getBoundingClientRect();
    const r = roll.getBoundingClientRect();
    const body = tray.parentElement as HTMLElement;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const part = (name: string) =>
      w.querySelector(`[data-tray-part="${name}"]`)?.getBoundingClientRect().height ?? null;
    return {
      win: { w: Math.round(wr.width), h: Math.round(wr.height) },
      inside: r.left >= wr.left && r.right <= wr.right && r.top >= wr.top && r.bottom <= wr.bottom,
      hit: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      dice: area.clientHeight - 12,
      scale: Number(tray.dataset.scale),
      notation: Number(tray.dataset.notationScale),
      parts: {
        header: part("header"),
        palette: part("palette"),
        expression: part("expression"),
        bar: part("bar"),
      },
    };
  });

test("FR-DICEX-53 tray Roll visible at min: 2d6 + 1d8 + 1 and 12 d6 as opened and at 300×240, Roll inside and hit, body not scrolling; FR-DICEX-54 12 d6 group at min", async ({
  browser,
}) => {
  const p1 = await rolePage(browser);
  await p1.goto(e2eEnv().link("Player 1"));
  await live(p1);
  await closePresented(p1);
  const tray = await openWindow(p1, "dicex.tray");
  for (const f of [6, 6, 8]) {
    await tray.locator(`[data-testid="dicex-tray-palette"][data-value="${f}"]`).click();
  }
  await tray.getByTestId("dicex-tray-constant").fill("1");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(3);
  const preview = tray.getByTestId("dicex-tray-preview");

  const check = async (size?: { w: number; h: number }) => {
    const f = await trayFacts(tray);
    if (size) expect(f.win).toEqual(size);
    // Placement may open it narrower than 360 × 300 (PC footprints, FR-SHELL-58): never below min.
    expect(f.win.w).toBeGreaterThanOrEqual(300);
    expect(f.win.h).toBeGreaterThanOrEqual(240);
    expect(f.inside).toBe(true);
    expect(f.hit).toBe("dicex-tray-roll");
    expect(f.bodyScrolls).toBe(false);
    // The pure layout's budget (TRAY_PART_PX) is what the browser draws; the notation row grows
    // with a tray above its useful size (FR-DICEX-96: 28 px × the notation scale).
    const expression = Math.round(28 * f.notation);
    expect(f.parts).toEqual({ header: 24, palette: 28, expression, bar: 33 });
    if (size) expect(f.scale).toBe(1);
    expect(f.dice).toBeGreaterThanOrEqual(40);
    return f;
  };

  // As opened (450 × 375 since T5, or placement's shrunk size down to useful / min).
  await check();
  await expect(preview).toHaveAttribute("data-cell", "40");

  // Resize to the min (the frame clamps at 300 × 240; from up to 450 × 375 since T5).
  const handle = await tray.getByTestId("ui-window-resize").boundingBox();
  if (!handle) throw new Error("no resize handle");
  await drag(p1, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, -300, -300);
  const min = await check({ w: 300, h: 240 });
  expect(min.dice).toBe(41);
  await expect(preview).toHaveAttribute("data-cell", "40");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(3);

  // 12 d6 at min: no row of 28 holds them → one die "×12", still no scroll, Roll in place.
  await tray.getByTestId("dicex-tray-expression").fill("12d6");
  await expect(preview).toHaveAttribute("data-grouped", "true");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(1);
  await expect(tray.getByTestId("dicex-tray-die")).toHaveAttribute("data-group", "12");
  await check({ w: 300, h: 240 });
  await expect(preview).not.toHaveAttribute("data-scroll", "true");
});

/** The kept template `id`'s label: its text, `hovered` attr and page rect; its covered cells. */
const labelOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    type KNode = {
      id(): string;
      getAttr(a: string): unknown;
      getClientRect(): { x: number; y: number; width: number; height: number };
      findOne(s: string): (KNode & { text(): string }) | undefined;
    };
    type KStage = { container(): HTMLElement; find(s: string): KNode[] };
    const st = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0] as KStage;
    const box = st.container().getBoundingClientRect();
    const label = st.find(".scn-template-label").find((n) => n.id() === id);
    const group = st.find(".scn-template").find((n) => n.id() === id);
    if (!label || !group) return null;
    const r = label.getClientRect();
    return {
      text: label.findOne(".scn-template-label-text")?.text() ?? "",
      hovered: label.getAttr("hovered") === true,
      rect: { x: box.left + r.x, y: box.top + r.y, w: r.width, h: r.height },
      cells: String(group.getAttr("cells") ?? "")
        .split(" ")
        .filter(Boolean)
        .map((c) => c.split(",").map(Number) as [number, number]),
      /** Squares of every other drawn template (Web overlaps Thunderwave). */
      others: st
        .find(".scn-template")
        .filter((n) => n.id() !== id)
        .flatMap((n) => String(n.getAttr("cells") ?? "").split(" ")),
    };
  }, id);

/** Whether page point `p` is on the bare map canvas (no window or chrome over it). */
const onCanvas = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(
    (p) =>
      document.elementFromPoint(p.x, p.y)?.closest('[data-testid="map-canvas"]') !== null &&
      document.elementFromPoint(p.x, p.y)?.tagName === "CANVAS",
    p,
  );

test("FR-SCN-52 template label on hover: Player 1 hovers Player 2's kept Thunderwave (area, then label) → '· by Player 2'; away → gone; the grown pill keeps it", async ({
  browser,
}) => {
  const { link, recordId, secret } = e2eEnv();
  const thunderwave = recordId("mt-templates", "aoe-template", 0);
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  await showToPlayers(dm, "Goblin Ambush");

  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresented(p1);
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(async () => (await labelOf(p1, thunderwave))?.text ?? null).not.toBeNull();
  const start = await labelOf(p1, thunderwave);
  if (!start) throw new Error("no Thunderwave label");
  expect(start.text).not.toContain("by Player 2");
  expect(start.hovered).toBe(false);

  // A covered square's centre away from the pill, on the bare canvas.
  let onArea: { x: number; y: number } | null = null;
  for (const [c, r] of start.cells) {
    if (start.others.includes(`${c},${r}`)) continue;
    const p = await gridPoint(p1, c + 0.5, r + 0.5);
    const inPill =
      p.x >= start.rect.x - 8 &&
      p.x <= start.rect.x + start.rect.w + 120 &&
      p.y >= start.rect.y - 8 &&
      p.y <= start.rect.y + start.rect.h + 8;
    if (!inPill && (await onCanvas(p1, p))) {
      onArea = p;
      break;
    }
  }
  if (!onArea) throw new Error("no clear Thunderwave square");
  await p1.mouse.move(onArea.x - 4, onArea.y - 4);
  await p1.mouse.move(onArea.x, onArea.y, { steps: 3 });
  await expect.poll(async () => (await labelOf(p1, thunderwave))?.text).toContain("· by Player 2");
  expect((await labelOf(p1, thunderwave))?.hovered).toBe(true);

  // Away (no template there): back to the short caption.
  // The canvas point farthest from the area among a few on the bare canvas.
  let away: { x: number; y: number } | null = null;
  for (const p of [
    { x: 760, y: 220 },
    { x: 640, y: 400 },
    { x: 900, y: 500 },
  ]) {
    if (await onCanvas(p1, p)) {
      away = p;
      break;
    }
  }
  if (!away) throw new Error("no bare canvas point");
  await p1.mouse.move(away.x, away.y, { steps: 3 });
  await expect
    .poll(async () => (await labelOf(p1, thunderwave))?.text)
    .not.toContain("by Player 2");
  expect((await labelOf(p1, thunderwave))?.hovered).toBe(false);

  // The label pill itself, then its grown right end: still hovered (no flicker); away → gone.
  const small = (await labelOf(p1, thunderwave))?.rect;
  if (!small) throw new Error("no pill");
  await p1.mouse.move(small.x + small.w / 2, small.y + small.h / 2, { steps: 3 });
  await expect.poll(async () => (await labelOf(p1, thunderwave))?.hovered).toBe(true);
  const grown = (await labelOf(p1, thunderwave))?.rect;
  if (!grown) throw new Error("no pill");
  expect(grown.w).toBeGreaterThan(small.w);
  const states: boolean[] = [];
  for (let i = 1; i <= 6; i++) {
    await p1.mouse.move(
      small.x + small.w / 2 + ((grown.w - small.w / 2 - 3) * i) / 6,
      grown.y + grown.h / 2,
    );
    states.push((await labelOf(p1, thunderwave))?.hovered ?? false);
  }
  expect(states).toEqual([true, true, true, true, true, true]);
  await p1.mouse.move(away.x, away.y, { steps: 3 });
  await expect.poll(async () => (await labelOf(p1, thunderwave))?.hovered).toBe(false);
});
