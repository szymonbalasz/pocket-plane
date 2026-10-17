// e2e-bundle: rule-triggers
// Thin weapon-parts flow in combat (S4-1b; MOD §13.1 steps 3–4, FR-CBT-81, -82, -84, -85): the
// DM sets up Brakka's Flame Tongue greatsword +1 (`2d6+4` slashing + `2d6` fire) and Fire Ward
// on Goblin over the DM's own socket (the `rules-effects` bundle is S4-4's, the row editor
// S4-1a's); player-1 rolls Flame Tongue Attack + damage → the card lists both parts; the DM's
// popup shows the fire chip preset "Half (Fire Ward)" on Goblin → Apply → the players' line reads
// "— DM: hit. … slashing + … fire (half) damage". Rules, leaks, crits: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** Setup: one DM intent over a socket of its own (hello → snapshot → intent → ack result). */
function dmIntent(page: Page, secret: string, name: string, payload: unknown) {
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

test("FR-CBT-81 FR-CBT-82 FR-CBT-84 FR-CBT-85 Flame Tongue: parts on the card, fire chip Half (Fire Ward), players' line credits the DM", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  const init = await openWindow(dm, "cbt.initiative");
  const goblin = await idByName(init, "Goblin");
  const brakka = recordId("char-brakka", "entity");
  await dmIntent(dm, secret, "char.putRow", {
    creatureId: brakka,
    list: "attacks",
    row: {
      name: "Flame Tongue greatsword",
      toHit: 7,
      damage: "2d6+4",
      damageType: "slashing",
      bonus: 1,
      extraDamage: [{ damage: "2d6", type: "fire" }],
    },
  });
  const { presetId } = (await dmIntent(dm, secret, "mod.putPreset", {
    preset: {
      characterId: null,
      name: "Fire Ward",
      modifiers: [{ kind: "defense", types: ["fire"], level: "resistance" }],
      durationRounds: null,
      concentration: false,
      note: "",
    },
  })) as { presetId: string };
  await dmIntent(dm, secret, "mod.apply", {
    targets: [{ combatantId: goblin }],
    preset: { presetId },
  });

  // Player 1: Brakka's sheet → Actions → Flame Tongue Attack + damage.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(brakka);
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Flame Tongue" })
    .getByTestId("charx-roll-attack-damage")
    .click();

  // DM: the pending card lists both parts; the popup's fire chip on Goblin presets Half.
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/\d+ slashing \+ \d+ fire/);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await expect(
    popup.locator('[data-testid="cbt-popup-damage-part"][data-value="1"]'),
  ).toBeVisible();
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  const part = trow.locator('[data-testid="cbt-popup-target-part"][data-value="0"]');
  await expect(part).toContainText("fire");
  await expect(part.getByTestId("cbt-popup-target-part-mult")).toHaveAttribute(
    "data-value",
    "half",
  );
  await expect(part.getByTestId("mod-popup-part-defense")).toHaveText("Half (Fire Ward)");
  await expect(trow.getByTestId("cbt-popup-target-mult")).toHaveAttribute("data-value", "normal");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);

  // The outcome line: players read "— DM: hit." (BL-10); the DM's line keeps its own words.
  const p1Log = await openWindow(p1, "dice.log");
  await expect(
    p1Log
      .getByTestId("dice-log-entry")
      .filter({ hasText: /— DM: (hit\.|critical hit!) \d+ slashing \+ \d+ fire \(half\) damage/ }),
  ).toHaveCount(1);
  const dmLog = await openWindow(dm, "dice.log");
  await expect(
    dmLog.getByTestId("dice-log-entry").filter({ hasText: /vs AC \d+ — .*fire \(half\)/ }),
  ).toHaveCount(1);
});
