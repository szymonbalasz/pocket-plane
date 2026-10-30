// BL-162: a line that names the actor reads a label without the repeated name.
import { describe, expect, test } from "bun:test";
import { labelAfterActor } from "./actor-label";

describe("BL-162 labelAfterActor", () => {
  test("BL-162 a label opening with the actor loses the name, whatever its case or outer spaces", () => {
    expect(labelAfterActor("Goblin — Hooked Blade attack", "Goblin")).toBe("Hooked Blade attack");
    expect(labelAfterActor("goblin — Hooked Blade attack", "GOBLIN")).toBe("Hooked Blade attack");
    expect(labelAfterActor("  Goblin — Bite  ", " Goblin ")).toBe("Bite");
  });

  test("BL-162 only the first name goes: a later one is the label's own", () => {
    expect(labelAfterActor("Goblin — Goblin — Bite", "Goblin")).toBe("Goblin — Bite");
  });

  test("BL-162 an unrelated label stays as it is", () => {
    expect(labelAfterActor("Perception", "Mira")).toBe("Perception");
    expect(labelAfterActor("Wolf — Bite attack", "Mira")).toBe("Wolf — Bite attack");
    expect(labelAfterActor("Bite — Goblin", "Goblin")).toBe("Bite — Goblin");
  });

  test("BL-162 an actor named like a part of the label's name: nothing stripped", () => {
    expect(labelAfterActor("Goblin Boss — Bite", "Goblin")).toBe("Goblin Boss — Bite");
    expect(labelAfterActor("Hobgoblin — Bite", "goblin")).toBe("Hobgoblin — Bite");
    expect(labelAfterActor("Goblin — Bite", "Gob")).toBe("Goblin — Bite");
    // Not a pattern: the name's characters are plain text.
    expect(labelAfterActor("Goblin — Bite", "G.blin")).toBe("Goblin — Bite");
  });

  test("BL-162 the name with nothing after it, a hyphen and empty text stay as they are", () => {
    expect(labelAfterActor("Goblin", "Goblin")).toBe("Goblin");
    expect(labelAfterActor("Goblin —", "Goblin")).toBe("Goblin —");
    expect(labelAfterActor("Goblin - Bite", "Goblin")).toBe("Goblin - Bite");
    expect(labelAfterActor("", "Goblin")).toBe("");
    expect(labelAfterActor("Bite", "")).toBe("Bite");
  });
});
