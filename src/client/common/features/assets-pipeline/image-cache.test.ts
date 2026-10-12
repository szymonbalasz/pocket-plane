import { describe, expect, test } from "bun:test";
import { assetPath } from "@shared/assets-pipeline/schemas";
import { ImageCache, type LoadableImage } from "./image-cache";

class FakeImage implements LoadableImage {
  static made: FakeImage[] = [];
  src = "";
  onload: (() => unknown) | null = null;
  onerror: (() => unknown) | null = null;
  constructor() {
    FakeImage.made.push(this);
  }
  load() {
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

const fresh = () => {
  FakeImage.made = [];
  return new ImageCache(() => new FakeImage());
};

describe("asset image loader (FR-ASSET-16)", () => {
  test("FR-ASSET-16 assetUrl builds /api/assets/:id/:file", () => {
    expect(assetPath("AbC_-012345678901234567", "thumb")).toBe(
      "/api/assets/AbC_-012345678901234567/thumb",
    );
  });

  test("FR-ASSET-16 one load per URL shared by all consumers; loading → ready", () => {
    const c = fresh();
    const url = assetPath("A".repeat(22), "display");
    let calls = 0;
    c.subscribe(url, () => calls++);
    const a = c.get(url);
    const b = c.get(url);
    expect(a).toBe(b);
    expect(FakeImage.made).toHaveLength(1);
    expect(FakeImage.made[0]?.src).toBe(url);
    expect(a.state).toBe("loading");
    FakeImage.made[0]?.load();
    expect(c.get(url).state).toBe("ready");
    expect(calls).toBe(1);
    expect(c.get(assetPath("A".repeat(22), "thumb"))).not.toBe(a);
  });

  test("FR-ASSET-16 error retries once after a reconnect snapshot, then is final", () => {
    const c = fresh();
    const url = assetPath("B".repeat(22), "thumb");
    c.get(url);
    FakeImage.made[0]?.fail();
    expect(c.get(url).state).toBe("error");
    expect(FakeImage.made).toHaveLength(1); // no retry by itself

    c.retryErrors();
    expect(c.get(url).state).toBe("loading");
    expect(FakeImage.made).toHaveLength(2);
    c.retryErrors(); // a second consumer reacting to the same snapshot: no extra load
    expect(FakeImage.made).toHaveLength(2);
    FakeImage.made[0]?.load(); // stale element: ignored
    expect(c.get(url).state).toBe("loading");
    FakeImage.made[1]?.fail();
    expect(c.get(url).state).toBe("error");

    c.retryErrors();
    expect(FakeImage.made).toHaveLength(2);
    expect(c.get(url).state).toBe("error");
  });

  test("FR-ASSET-16 a retry can succeed", () => {
    const c = fresh();
    const url = assetPath("C".repeat(22), "display");
    c.get(url);
    FakeImage.made[0]?.fail();
    c.retryErrors();
    FakeImage.made[1]?.load();
    expect(c.get(url).state).toBe("ready");
    expect(c.get(url).image).toBe(FakeImage.made[1] as FakeImage);
  });
});
