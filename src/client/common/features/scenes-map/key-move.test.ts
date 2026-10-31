// FR-MAP-124: which way a key points, the pacing of steps, whom a player's keys move, the camera.
import { describe, expect, test } from "bun:test";
import { arrowStep, type KeyStep, KeySteps, ownKeyTarget, panToShow, REPEAT_MS } from "./key-move";

const plain = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
const RIGHT: KeyStep = { dx: 1, dy: 0 };
const UP: KeyStep = { dx: 0, dy: -1 };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A send whose answers the test gives, one by one. */
function answered() {
  const sent: KeyStep[] = [];
  const answers: { ok(): void; no(): void }[] = [];
  const steps = new KeySteps((s) => {
    sent.push(s);
    return new Promise((ok, no) => {
      answers.push({ ok: () => ok(undefined), no: () => no(new Error("refused")) });
    });
  });
  return { sent, answers, steps };
}

describe("FR-MAP-124 arrow keys", () => {
  test("a plain arrow is a step, one way", () => {
    expect(arrowStep({ ...plain, key: "ArrowUp" })).toEqual({ dx: 0, dy: -1 });
    expect(arrowStep({ ...plain, key: "ArrowDown" })).toEqual({ dx: 0, dy: 1 });
    expect(arrowStep({ ...plain, key: "ArrowLeft" })).toEqual({ dx: -1, dy: 0 });
    expect(arrowStep({ ...plain, key: "ArrowRight" })).toEqual({ dx: 1, dy: 0 });
    expect(arrowStep({ ...plain, key: "a" })).toBeNull();
  });

  test("with a modifier the key stays the browser's", () => {
    for (const mod of ["ctrlKey", "altKey", "metaKey", "shiftKey"]) {
      expect(arrowStep({ ...plain, key: "ArrowLeft", [mod]: true })).toBeNull();
    }
  });

  test("one step at a time: quick presses wait their turn, in order", async () => {
    const { sent, answers, steps } = answered();
    steps.press(RIGHT, false, 0);
    steps.press(UP, false, 1);
    steps.press(RIGHT, false, 2);
    expect(sent).toEqual([RIGHT]);
    answers[0]?.ok();
    await flush();
    expect(sent).toEqual([RIGHT, UP]);
    answers[1]?.ok();
    await flush();
    expect(sent).toEqual([RIGHT, UP, RIGHT]);
  });

  test("a held key: repeats are paced, and none piles up behind a step on its way", async () => {
    const { sent, answers, steps } = answered();
    steps.press(RIGHT, false, 0);
    steps.press(RIGHT, true, 30);
    answers[0]?.ok();
    await flush();
    steps.press(RIGHT, true, REPEAT_MS - 1);
    expect(sent).toHaveLength(1);
    steps.press(RIGHT, true, REPEAT_MS);
    expect(sent).toHaveLength(2);
  });

  test("a refusal ends the run: what waits is dropped, a held key stays quiet, a fresh press goes", async () => {
    const { sent, answers, steps } = answered();
    steps.press(RIGHT, false, 0);
    steps.press(UP, false, 1);
    answers[0]?.no();
    await flush();
    expect(sent).toEqual([RIGHT]);
    steps.press(RIGHT, true, 1000);
    expect(sent).toEqual([RIGHT]);
    steps.press(RIGHT, false, 1001);
    expect(sent).toEqual([RIGHT, RIGHT]);
  });

  test("nothing to send (at the edge): no wait, a waiting press isn't stuck", () => {
    const sent: KeyStep[] = [];
    const steps = new KeySteps((s) => {
      sent.push(s);
      return null;
    });
    steps.press(RIGHT, false, 0);
    steps.press(UP, false, 1);
    expect(sent).toEqual([RIGHT, UP]);
  });

  test("another scene drops what was waiting; a late answer from the last one changes nothing", async () => {
    const { sent, answers, steps } = answered();
    steps.press(RIGHT, false, 0);
    steps.press(UP, false, 1);
    steps.reset();
    answers[0]?.ok();
    await flush();
    expect(sent).toEqual([RIGHT]);
    steps.press(UP, false, 2);
    expect(sent).toEqual([RIGHT, UP]);
    answers[1]?.no();
    await flush();
    steps.press(RIGHT, true, 1000);
    expect(sent).toEqual([RIGHT, UP]);
  });

  test("a player's keys: the own token last pressed, else the character's, else the first", () => {
    const pet = { id: "pet", characterId: null };
    const mira = { id: "mira", characterId: "c1" };
    expect(ownKeyTarget([pet, mira], "pet")).toBe(pet);
    expect(ownKeyTarget([pet, mira], null)).toBe(mira);
    expect(ownKeyTarget([pet, mira], "gone")).toBe(mira);
    expect(ownKeyTarget([pet], null)).toBe(pet);
    expect(ownKeyTarget([], null)).toBeNull();
  });

  describe("the camera keeps up", () => {
    const cam = { x: 0, y: 0, scale: 2 };
    const area = { x: 100, y: 50, w: 400, h: 300 };

    test("inside the area: the same camera", () => {
      expect(panToShow(cam, { x: 60, y: 40, w: 10, h: 10 }, area)).toBe(cam);
    });

    test("past an edge: the smallest pan, zoom unchanged", () => {
      expect(panToShow(cam, { x: 240, y: 40, w: 20, h: 10 }, area)).toEqual({
        x: -20,
        y: 0,
        scale: 2,
      });
      expect(panToShow(cam, { x: 40, y: 10, w: 10, h: 10 }, area)).toEqual({
        x: 20,
        y: 30,
        scale: 2,
      });
    });

    test("bigger than the area: that axis stays", () => {
      expect(panToShow(cam, { x: 0, y: 40, w: 1000, h: 10 }, area)).toBe(cam);
    });
  });
});
