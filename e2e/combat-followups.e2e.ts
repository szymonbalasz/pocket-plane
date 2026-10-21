// e2e-bundle: fu-s7-e2e
// Sprint 7 FU-combat (play-shell §13 U7–U12, U14, thin): DM (A) 1440×900, player-1 (B, Mira +
// Brakka) and player-2 (C, Thorn) 1280×800 on `fu-s7`'s running Goblin Ambush. Brakka's in-turn
// companions are one row each with ⋯ holding Attack ▸ (FR-CBT-142), names wrap between words at
// 320 (FR-CBT-143); the Summon… radios are named (FR-CBT-151); C's concentration chip opens its
// menu and ends it, A gets the summon card (FR-CBTX-59–61). End: the dialog lists the summon
// tokens and the charmed Goblin 2 (FR-CBT-144); afterwards no Fire Elemental token for anyone
// (FR-CBT-145) and the drake's and the Owlbear's tokens still carry the paw (FR-MAP-88). Start
// "Escort to the Ford": the kept-HP note, Goblin 2 at 4 / 7 (FR-CBT-141), the drake still marked.
// The editor at 360 × 320: names whole, actions visible, Back by test ID (FR-CBT-146, -147, -149).
// Rules, redaction, crash: bun test (kept-hp, pet-owner, fu-combat-sync, fu-combat-crash).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Drags the window's resize corner by (dx, dy); the shell clamps to the min size. */
async function resizeBy(page: Page, win: Locator, dx: number, dy: number) {
  const h = await win.getByTestId("ui-window-resize").boundingBox();
  if (!h) throw new Error("no resize handle");
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}

/** A combatant's id by its exact name in `scope`'s rows or lines. */
async function idOf(scope: Locator, name: string): Promise<string> {
  const n = scope.locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`).first();
  await expect(n).toBeVisible();
  return n.evaluate(
    (el) =>
      el
        .closest("[data-testid='cbt-init-companion'], [data-testid='cbt-init-row']")
        ?.getAttribute("data-record-id") ?? "",
  );
}

/** FR-CBT-143: words of `name` split across lines (each word's glyphs measured with a Range). */
function brokenWords(scope: Locator, name: string): Promise<string[]> {
  return scope.evaluate((w, name) => {
    const el = w.querySelector<HTMLElement>(
      `[data-testid="cbt-init-row-name"][data-value="${name}"]`,
    );
    if (!el) return [`missing ${name}`];
    const text = [...el.querySelectorAll("span")].map((s) => s.firstChild).filter(Boolean);
    const bad: string[] = [];
    for (const node of text as Text[]) {
      const s = node.textContent ?? "";
      for (const m of s.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(node, m.index ?? 0);
        r.setEnd(node, (m.index ?? 0) + m[0].length);
        const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
        if (tops.size > 1) bad.push(m[0]);
      }
    }
    return bad;
  }, name);
}

const markerIds = async (page: Page) =>
  (await konvaNodes(page, "map-token-companion")).map((n) => n.id);

/** FR-MAP-76 / -88: the token's paw drawn as its own chip (never folded into "+N", FU3). */
function pawShown(page: Page, tokenId: string): Promise<boolean> {
  return page.evaluate((id) => {
    type KNode = {
      id(): string;
      name(): string;
      isVisible(): boolean;
      getAttr(a: string): unknown;
    };
    const K = (window as unknown as { Konva?: { stages: { find(s: unknown): KNode[] }[] } }).Konva;
    const mine = (K?.stages[0]?.find((n: KNode) => n.id() === id) ?? []).filter((n) =>
      n.isVisible(),
    );
    return mine.some((n) => n.name() === "map-token-companion");
  }, tokenId);
}

test("FR-CBT-141 FR-CBT-142 FR-CBT-143 FR-CBT-144 FR-CBT-145 FR-CBT-146 FR-CBT-147 FR-CBT-149 FR-CBT-151 FR-CBTX-59 FR-CBTX-60 FR-CBTX-61 FR-MAP-88 fu-s7-e2e: compact lines, concentration chip, End's summon line and tokens, kept HP, markers, editor", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1280, height: 800 });
  await p2.goto(link("Player 2"));
  await live(p2);

  const ambush = recordId("battlemap", "scene");
  await showToPlayers(dm, "Goblin Ambush");
  const scenes = shellWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  for (const page of [dm, p1, p2]) {
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }
  await scenes.getByTestId("ui-window-close").click();
  const drakeToken = recordId("pet-drake", "token");
  const owlToken = recordId("pet-owlbear", "token");

  const init = await openWindow(dm, "cbt.initiative");
  const drake = await idOf(init, "Drake Companion");
  const fe2 = await idOf(init, "Fire Elemental 2");

  await test.step("FR-CBT-142 compact companion line (DM): one row, ⋯ holds Attack ▸ … Companion ▸", async () => {
    for (const id of [drake, fe2]) {
      const line = init.locator(`[data-testid="cbt-init-companion"][data-record-id="${id}"]`);
      await expect(line.getByTestId("cbt-init-row-hp")).toHaveText(/^\d+ \/ \d+$/);
      await expect(line.getByTestId("cbt-init-row-card")).toBeVisible();
      expect((await line.boundingBox())?.height ?? 99).toBeLessThanOrEqual(32);
    }
    await init
      .locator(`[data-testid="cbt-init-companion-menu"][data-record-id="${drake}"]`)
      .click();
    for (const id of ["cbt-init-row-attack", "cbt-init-row-hp-adjust", "cbt-init-row-companion"]) {
      await expect(dm.getByTestId(id).first()).toBeVisible();
    }
    await expect(dm.getByTestId("cbtx-init-row-effect-new").first()).toBeVisible();
    await dm.keyboard.press("Escape");
  });

  await test.step("FR-CBT-151 accessible names: the Summon… dialog's turn-mode radios", async () => {
    await init.getByTestId("cbt-init-summon").click();
    const dialog = dm.getByTestId("cbt-summon");
    for (const name of ["After the owner", "In the owner's turn", "Own initiative"]) {
      await expect(dialog.getByRole("radio", { name })).toBeVisible();
    }
    await dm.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("FR-CBT-143 no mid-word break at 320 (DM) and 280 (player)", async () => {
    const before = (await init.boundingBox())?.width ?? 0;
    await resizeBy(dm, init, 320 - before - 100, 0);
    await expect.poll(async () => Math.round((await init.boundingBox())?.width ?? 0)).toBe(320);
    for (const name of ["Drake Companion", "Fire Elemental 2"]) {
      await expect.poll(() => brokenWords(init, name)).toEqual([]);
    }
    const pInit = await openWindow(p1, "cbt.initiative");
    const pw = (await pInit.boundingBox())?.width ?? 0;
    await resizeBy(p1, pInit, 280 - pw - 100, 0);
    for (const name of ["Drake Companion", "Fire Elemental 2"]) {
      await expect.poll(() => brokenWords(pInit, name)).toEqual([]);
    }
  });

  await test.step("FR-CBTX-59 FR-CBTX-60 FR-CBTX-61 C's concentration chip: whole or icon-only, its menu, End → A's card", async () => {
    const cInit = await openWindow(p2, "cbt.initiative");
    const chip = cInit.getByTestId("cbtx-conc-chip").first();
    await expect(chip).toBeVisible();
    const badge = chip.locator("[data-conc]");
    const compact = await badge.getAttribute("data-compact");
    if (compact === "false") await expect(badge).toContainText("Conjure Elemental");
    // B doesn't own Thorn: no menu, only the Tooltip.
    const bInit = await openWindow(p1, "cbt.initiative");
    await expect(bInit.getByTestId("cbtx-conc-chip")).toHaveCount(0);
    await chip.click();
    const menu = p2.getByTestId("cbtx-conc-menu");
    await expect(menu.getByTestId("cbtx-conc-title")).toHaveText(
      "Concentrating: Conjure Elemental",
    );
    await menu.getByTestId("cbtx-conc-end").click();
    await expect(menu).toBeHidden();
    await expect(cInit.getByTestId("cbtx-conc-chip")).toHaveCount(0);
    await expect(
      dm.getByText(/Thorn lost concentration \(Conjure Elemental\): Fire Elemental 3/).first(),
    ).toBeVisible();
    // U9: Turn hostile from A's card (FE 3: owner, Ally and paw gone; its token still goes at End).
    await dm.getByTestId("cbt-summon-hostile").first().click();
    await expect(dm.getByTestId("cbt-summon-hostile")).toHaveCount(0);
  });

  await test.step("FR-CBT-144 FR-CBT-145 FR-MAP-88 End: the dialog's summon + charmed lines; summon tokens gone; pets' paws kept", async () => {
    // cp-combat's three summons' tokens (Mira's, Brakka's, Thorn's Fire Elementals).
    const feTokens = [0, 1, 2].map((i) => recordId("cp-combat", "token", i));
    expect(await tokenNode(dm, feTokens[1] as string)).not.toBeNull();
    await init.getByTestId("cbt-init-end").click();
    const summons = dm.getByTestId("cbt-init-end-summons");
    await expect(summons).toContainText("Summoned creatures' tokens are removed:");
    for (const name of ["Fire Elemental 2", "Fire Elemental 3"]) {
      await expect(summons).toContainText(name);
    }
    await expect(dm.getByTestId("cbt-init-end-charmed")).toHaveText(
      "Mira's charmed Goblin 2 stays as a monster.",
    );
    await dm.getByTestId("cbt-init-end-confirm").click();
    await expect(launcherButton(dm, "cbt.initiative")).not.toHaveAttribute("data-state", "open");
    // No Fire Elemental token on any client (the hostile FE 3's too); the pets' stay, with a paw.
    for (const page of [dm, p1, p2]) {
      await expect
        .poll(async () =>
          (await konvaNodes(page, "map-token")).filter((n) => feTokens.includes(n.id)),
        )
        .toEqual([]);
    }
    for (const page of [dm, p1]) {
      await expect
        .poll(() => markerIds(page))
        .toEqual(expect.arrayContaining([drakeToken, owlToken]));
    }
    expect(await tokenNode(dm, drakeToken)).not.toBeNull();
  });

  await test.step("FR-CBT-141 Start 'Escort to the Ford': the kept-HP note; Goblin 2 keeps 4 / 7; the drake keeps its paw", async () => {
    const enc = await openWindow(dm, "cbt.encounters");
    await enc
      .locator(
        `[data-testid="cbt-enc-row"][data-record-id="${recordId("enc-friendly", "encounter")}"]`,
      )
      .click();
    await enc.getByTestId("cbt-enc-start").click();
    await expect(dm.getByTestId("cbt-enc-start-kept-note")).toHaveText(
      "Monsters that were in an earlier fight keep their HP.",
    );
    await dm.getByTestId("cbt-enc-start-confirm").click();
    await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "open");
    const escort = await openWindow(dm, "cbt.initiative");
    const g2 = await idOf(escort, "Goblin 2");
    await expect(
      escort.locator(`[data-testid="cbt-init-row-hp"][data-record-id="${g2}"]`),
    ).toHaveText("HP 4/7");
    // FR-MAP-88: both pets' tokens still carry the paw, drawn as its own chip: at Start's refit
    // (34 px cells) the medium drake's label row keeps the paw before the "+N" (FU3).
    for (const page of [dm, p2]) {
      await expect.poll(() => pawShown(page, owlToken)).toBe(true);
      await expect.poll(() => pawShown(page, drakeToken)).toBe(true);
    }
  });

  await test.step("FR-CBT-146 FR-CBT-147 FR-CBT-149 the editor at 360 × 320: names whole, actions inside, Back", async () => {
    const enc = await openWindow(dm, "cbt.encounters");
    const box = (await enc.boundingBox()) ?? { width: 0, height: 0 };
    await resizeBy(dm, enc, 360 - box.width - 100, 320 - box.height - 100);
    await expect.poll(async () => Math.round((await enc.boundingBox())?.width ?? 0)).toBe(360);
    const names = await enc.getByTestId("cbt-enc-entry-name").evaluateAll((els) =>
      els.map((e) => ({
        w: e.getBoundingClientRect().width,
        cut: e.scrollWidth > e.clientWidth + 0.5 || (e.textContent ?? "").includes("…"),
      })),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toEqual({ w: expect.any(Number), cut: false });
    for (const n of names) expect(n.w).toBeGreaterThanOrEqual(96);
    const win = (await enc.boundingBox()) ?? { y: 0, height: 0 };
    const end = (await enc.getByTestId("cbt-enc-end").boundingBox()) ?? { y: 9999, height: 0 };
    expect(end.y + end.height).toBeLessThanOrEqual(win.y + win.height);
    await enc.getByTestId("cbt-enc-editor-back").click();
    await expect(enc.getByTestId("cbt-enc-list")).toBeVisible();
  });
});
